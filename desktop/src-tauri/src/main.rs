#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;
mod captions;
mod commands;
mod devices;
mod jobs;
mod paths;
mod sessions;
mod settings;
mod wav;

use jobs::{Jobs, Started};
use paths::AppPaths;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

type Result<T> = std::result::Result<T, String>;

/// Runs blocking work (dialogs, process stops, WASAPI) off the main thread.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| error.to_string())
}

#[tauri::command]
fn app_info(jobs: State<Jobs>) -> Value {
    let paths = jobs.paths();
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "repoRoot": paths.repo_root,
        "dataRoot": paths.data_root,
    })
}

#[tauri::command]
fn app_ready(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn load_settings(jobs: State<Jobs>) -> Result<Value> {
    settings::read(&jobs.paths().settings_path)
}

#[tauri::command]
fn save_settings(jobs: State<Jobs>, settings: Value) -> Result<Value> {
    if !settings.is_object() {
        return Err("Settings must be an object.".into());
    }
    let path = &jobs.paths().settings_path;
    settings::write(path, &settings)?;
    Ok(json!({ "ok": true, "path": path }))
}

#[tauri::command]
fn check_assets(jobs: State<Jobs>) -> Vec<assets::AssetStatus> {
    assets::check(jobs.paths())
}

#[tauri::command]
async fn list_audio_devices(jobs: State<'_, Jobs>) -> Result<devices::AudioDeviceStatus> {
    if let Ok(status) = blocking(devices::list_native).await? {
        return Ok(status);
    }
    // WASAPI failed: ask the recorder itself, as the Electron shell did.
    let repo_root = jobs.paths().repo_root.clone();
    blocking(move || {
        let mut command = std::process::Command::new("uv");
        command
            .args(["run", "--with", "soundcard", "--with", "soundfile", "--with", "numpy", "--with", "soxr", "python"])
            .arg(Path::new("python_backend").join("record_audio.py"))
            .arg("--list-devices")
            .current_dir(repo_root)
            .env("PYTHONUTF8", "1");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        match command.output() {
            Ok(output) => {
                let mut status = devices::parse_python_listing(&String::from_utf8_lossy(&output.stdout));
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    status.error =
                        Some(if stderr.is_empty() { "Failed to list audio devices.".into() } else { stderr });
                }
                status
            }
            Err(error) => devices::AudioDeviceStatus { error: Some(error.to_string()), ..Default::default() },
        }
    })
    .await
}

#[tauri::command]
fn list_output_sessions(jobs: State<Jobs>, output_dir: String) -> Value {
    let configured = if output_dir.trim().is_empty() { "outputs" } else { output_dir.trim() };
    json!(sessions::list(&jobs.paths().in_data_root(configured)))
}

#[tauri::command]
fn run_command(app: AppHandle, jobs: State<Jobs>, kind: String, args: Option<commands::Args>) -> Result<Started> {
    jobs.run(&app, &kind, &args.unwrap_or_default())
}

#[tauri::command]
async fn stop_command(app: AppHandle, jobs: State<'_, Jobs>, process_id: u32) -> Result<Value> {
    let jobs = jobs.inner().clone();
    let stopped = blocking(move || jobs.stop_blocking(&app, process_id)).await??;
    Ok(json!({ "stopped": stopped }))
}

#[tauri::command]
fn start_asset_download(app: AppHandle, jobs: State<Jobs>, asset_id: String) -> Result<Value> {
    let started = jobs.start_download(&app, &asset_id)?;
    Ok(json!({ "started": started, "assetId": asset_id }))
}

#[tauri::command]
async fn stop_asset_download(app: AppHandle, jobs: State<'_, Jobs>, asset_id: String) -> Result<Value> {
    let jobs = jobs.inner().clone();
    let stopped = blocking(move || jobs.stop_download(&app, &asset_id)).await??;
    Ok(json!({ "stopped": stopped }))
}

#[tauri::command]
async fn pick_audio_file(app: AppHandle, title: String, filter_name: String) -> Result<Option<String>> {
    blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .add_filter(filter_name, &["wav", "mp3", "m4a", "flac", "ogg"])
            .blocking_pick_file()
            .and_then(|path| path.into_path().ok())
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
}

#[tauri::command]
async fn pick_output_folder(app: AppHandle, title: String) -> Result<Option<String>> {
    blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .blocking_pick_folder()
            .and_then(|path| path.into_path().ok())
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
}

#[tauri::command]
fn open_path(app: AppHandle, jobs: State<Jobs>, target: String) -> Result<Value> {
    if target.is_empty() {
        return Ok(json!({ "ok": false }));
    }
    if target.starts_with("https://") || target.starts_with("http://") {
        app.opener().open_url(&target, None::<&str>).map_err(|error| error.to_string())?;
        return Ok(json!({ "ok": true }));
    }
    let path = jobs.paths().in_data_root(&target);
    if !path.exists() && path.extension().is_none() {
        fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    }
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|error| error.to_string())?;
    Ok(json!({ "ok": true }))
}

fn create_main_window(app: &AppHandle, paths: &AppPaths) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("Local Meeting STT")
        .inner_size(1240.0, 780.0)
        .min_inner_size(960.0, 620.0)
        .decorations(false)
        .shadow(true)
        .visible(false)
        .data_directory(paths.webview_data_dir())
        .build()?;
    // The page shows the window once it has painted; this is the fallback.
    let fallback = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        if !fallback.is_visible().unwrap_or(true) {
            let _ = fallback.show();
        }
    });
    Ok(())
}

fn main() {
    let paths = Arc::new(AppPaths::resolve());
    for dir in [paths.runtime_dir.join("uv-cache"), paths.runtime_dir.join("venv"), paths.webview_data_dir()] {
        let _ = fs::create_dir_all(dir);
    }
    let jobs = Jobs::new(paths.clone());
    let quitting = Arc::new(AtomicBool::new(false));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(jobs)
        .setup(move |app| {
            create_main_window(app.handle(), &paths)?;
            Ok(())
        })
        .on_window_event(move |window, event| {
            let WindowEvent::CloseRequested { api, .. } = event else { return };
            let app = window.app_handle().clone();
            let jobs = app.state::<Jobs>().inner().clone();
            if !jobs.busy() {
                return;
            }
            // Recordings must close their WAV and release the model first.
            api.prevent_close();
            if quitting.swap(true, Ordering::SeqCst) {
                return;
            }
            let _ = app.emit("app-closing", ());
            std::thread::spawn(move || {
                jobs.stop_all_blocking(&app);
                app.exit(0);
            });
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            app_ready,
            load_settings,
            save_settings,
            check_assets,
            list_audio_devices,
            list_output_sessions,
            run_command,
            stop_command,
            start_asset_download,
            stop_asset_download,
            pick_audio_file,
            pick_output_folder,
            open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Local Meeting STT");
}
