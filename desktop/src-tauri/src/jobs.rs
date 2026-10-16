//! Running backend processes: one job at a time, plus asset downloads.
//!
//! Each process gets a reader thread per stream that splits its output into
//! lines and sends the UI one event per read: captions as small updates, the
//! rest as timestamped log lines. A waiter thread reports the exit only after
//! both streams have closed, so no output arrives after it.

use crate::assets;
use crate::captions::{Captions, Handled};
use crate::commands::{self, Args, CommandSpec};
use crate::paths::AppPaths;
use crate::wav;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const COOPERATIVE_STOP: Duration = Duration::from_secs(10);
const LAST_ERROR_CHARS: usize = 1200;
const STDERR_TAIL_BYTES: usize = 8192;

struct Job {
    pid: u32,
    stop_file: Option<PathBuf>,
    /// Held open for the job's life: `record-enter` stops when stdin closes.
    _stdin: Option<ChildStdin>,
}

#[derive(Default)]
struct State {
    next_id: u32,
    jobs: HashMap<u32, Job>,
    stopping: HashSet<u32>,
    downloads: HashMap<String, u32>,
}

#[derive(Clone)]
pub struct Jobs {
    state: Arc<Mutex<State>>,
    paths: Arc<AppPaths>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub process_id: u32,
    pub label: String,
}

fn now_stamp() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}

fn strip_ansi(text: &str) -> String {
    static ANSI: OnceLock<Regex> = OnceLock::new();
    ANSI.get_or_init(|| Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]").unwrap()).replace_all(text, "").into_owned()
}

fn stamp_log_line(line: &str, now: &str) -> String {
    static STAMPED: OnceLock<Regex> = OnceLock::new();
    if STAMPED.get_or_init(|| Regex::new(r"^\[\d{2}:\d{2}:\d{2}\]").unwrap()).is_match(line) {
        line.to_string()
    } else {
        format!("[{now}] {line}")
    }
}

fn recording_path(line: &str, repo_root: &Path) -> Option<PathBuf> {
    static RECORDING: OnceLock<Regex> = OnceLock::new();
    let found = RECORDING.get_or_init(|| Regex::new(r"(?i)^Recording:\s*(.+\.wav)\s*$").unwrap()).captures(line)?;
    let path = PathBuf::from(found[1].trim());
    Some(if path.is_absolute() { path } else { repo_root.join(path) })
}

/// The WAV a capture job announces it is writing: `Recording:` from the live
/// scripts, `Writing:` from record_audio.py.
fn saved_audio_path(line: &str, repo_root: &Path) -> Option<PathBuf> {
    static SAVED: OnceLock<Regex> = OnceLock::new();
    let found =
        SAVED.get_or_init(|| Regex::new(r"(?i)^(?:Recording|Writing):\s*(.+\.wav)\s*$").unwrap()).captures(line)?;
    let path = PathBuf::from(found[1].trim());
    Some(if path.is_absolute() { path } else { repo_root.join(path) })
}

/// Splits a byte stream into lines on `\n` or `\r`, so progress bars that
/// redraw with `\r` still arrive line by line.
fn for_each_read(mut stream: impl Read, mut on_lines: impl FnMut(Vec<String>)) {
    let mut buffer = [0u8; 8192];
    let mut pending: Vec<u8> = Vec::new();
    loop {
        let read = match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        pending.extend_from_slice(&buffer[..read]);
        let mut lines = Vec::new();
        while let Some(end) = pending.iter().position(|&byte| byte == b'\n' || byte == b'\r') {
            let line: Vec<u8> = pending.drain(..=end).collect();
            let text = String::from_utf8_lossy(&line[..line.len() - 1]).into_owned();
            if !text.trim().is_empty() {
                lines.push(strip_ansi(&text));
            }
        }
        if !lines.is_empty() {
            on_lines(lines);
        }
    }
    let rest = String::from_utf8_lossy(&pending).into_owned();
    if !rest.trim().is_empty() {
        on_lines(vec![strip_ansi(&rest)]);
    }
}

/// With `offline`, uv uses its cached environment without network access
/// (`UV_OFFLINE=1`), including inside the .cmd launchers.
fn spawn(
    spec: &CommandSpec,
    paths: &AppPaths,
    stop_file: Option<&Path>,
    offline: bool,
) -> std::io::Result<std::process::Child> {
    let mut command = Command::new(&spec.executable);
    command
        .args(&spec.args)
        .current_dir(&paths.repo_root)
        .env("PYTHONUTF8", "1")
        .env("PYTHONUNBUFFERED", "1")
        // uv's cache and project environment stay inside the data folder, so a
        // portable folder carries them.
        .env("UV_CACHE_DIR", paths.runtime_dir.join("uv-cache"))
        .env("UV_PROJECT_ENVIRONMENT", paths.runtime_dir.join("venv"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if offline {
        command.env("UV_OFFLINE", "1");
    } else {
        command.env_remove("UV_OFFLINE");
    }
    match stop_file {
        Some(path) => command.env("LOCAL_MEETING_STT_STOP_FILE", path),
        None => command.env_remove("LOCAL_MEETING_STT_STOP_FILE"),
    };
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn()
}

fn kill_tree(pid: u32) -> Result<(), String> {
    let mut command = Command::new("taskkill");
    command.args(["/pid", &pid.to_string(), "/t", "/f"]).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let status = command.status().map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("taskkill failed ({:?})", status.code()))
    }
}

fn display_command(spec: &CommandSpec) -> String {
    let quote = |part: &String| if part.contains(' ') { format!("\"{part}\"") } else { part.clone() };
    std::iter::once(&spec.executable).chain(spec.args.iter()).map(quote).collect::<Vec<_>>().join(" ")
}

impl Jobs {
    pub fn new(paths: Arc<AppPaths>) -> Self {
        Self { state: Arc::new(Mutex::new(State { next_id: 1, ..State::default() })), paths }
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn busy(&self) -> bool {
        let state = self.state.lock().unwrap();
        !state.jobs.is_empty() || !state.downloads.is_empty()
    }

    fn is_running(&self, process_id: u32) -> bool {
        self.state.lock().unwrap().jobs.contains_key(&process_id)
    }

    fn log(app: &AppHandle, process_id: u32, stream: &str, lines: Vec<String>) {
        let now = now_stamp();
        let lines: Vec<String> = lines.iter().map(|line| stamp_log_line(line.trim_end(), &now)).collect();
        let _ = app
            .emit("process-event", json!({ "type": "log", "processId": process_id, "stream": stream, "lines": lines }));
    }

    pub fn run(&self, app: &AppHandle, kind: &str, args: &Args) -> Result<Started, String> {
        let mut state = self.state.lock().unwrap();
        if !state.jobs.is_empty() {
            return Err("已有工作執行中，請先停止目前工作。".into());
        }
        if commands::reads_input_audio(kind) {
            if let Some(audio) = args.get("audioPath").and_then(Value::as_str) {
                // Let the backend report a real read error; a repair failure is not one.
                let _ = wav::repair_pcm_header(Path::new(audio));
            }
        }
        let spec = commands::build(&self.paths, kind, args)?;
        let process_id = state.next_id;
        state.next_id += 1;
        let stop_file = commands::is_cooperative(kind)
            .then(|| self.paths.runtime_dir.join(format!("stop-{}-{process_id}.request", std::process::id())));
        fs::create_dir_all(&self.paths.runtime_dir).map_err(|error| error.to_string())?;
        if let Some(path) = &stop_file {
            let _ = fs::remove_file(path);
        }
        let offline_first = commands::prefers_offline(kind);
        let mut child = spawn(&spec, &self.paths, stop_file.as_deref(), offline_first)
            .map_err(|error| format!("{}: {error}", spec.executable))?;
        state.jobs.insert(process_id, Job { pid: child.id(), stop_file, _stdin: child.stdin.take() });
        drop(state);

        let command = format!("{}{}", if offline_first { "UV_OFFLINE=1 " } else { "" }, display_command(&spec));
        let _ = app.emit(
            "process-event",
            json!({ "type": "start", "processId": process_id, "kind": kind, "label": spec.label, "command": command }),
        );
        Self::log(app, process_id, "info", vec![format!("Started {}", spec.label), command]);
        self.watch(app, process_id, kind, child, offline_first.then(|| spec.clone()));
        Ok(Started { process_id, label: spec.label })
    }

    /// Starts `online` in place of a job whose offline uv attempt found no
    /// cached environment, unless the job is being stopped. The state lock is
    /// held throughout, so a stop sees either the old process or the new one.
    fn retry_online(&self, app: &AppHandle, process_id: u32, online: &CommandSpec) -> Option<Child> {
        let mut state = self.state.lock().unwrap();
        if state.stopping.contains(&process_id) {
            return None;
        }
        let stop_file = state.jobs.get(&process_id)?.stop_file.clone();
        Self::log(
            app,
            process_id,
            "info",
            vec![
                "Python environment is not cached yet; retrying online to install it.".into(),
                display_command(online),
            ],
        );
        match spawn(online, &self.paths, stop_file.as_deref(), false) {
            Ok(mut child) => {
                let job = state.jobs.get_mut(&process_id)?;
                job.pid = child.id();
                job._stdin = child.stdin.take();
                Some(child)
            }
            Err(error) => {
                Self::log(app, process_id, "stderr", vec![format!("{}: {error}", online.executable)]);
                None
            }
        }
    }

    /// Reads a job's output until it exits, then reports the exit. With
    /// `retry`, an offline attempt that uv could not set up is rerun online
    /// in the same job instead of being reported.
    fn watch(&self, app: &AppHandle, process_id: u32, kind: &str, mut child: Child, retry: Option<CommandSpec>) {
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let recordings: Arc<Mutex<Vec<PathBuf>>> = Arc::default();
        let last_error: Arc<Mutex<String>> = Arc::default();
        let stderr_tail: Arc<Mutex<String>> = Arc::default();
        let kind = kind.to_string();
        let live = kind.starts_with("live-");
        let loopback = commands::is_loopback_stream(&kind);

        let out_reader = {
            let app = app.clone();
            let recordings = recordings.clone();
            let repo_root = self.paths.repo_root.clone();
            thread::spawn(move || {
                let mut captions = Captions::new(loopback);
                for_each_read(stdout, |lines| {
                    let now = now_stamp();
                    let mut log = Vec::new();
                    for line in lines {
                        if let Some(path) = recording_path(line.trim(), &repo_root) {
                            recordings.lock().unwrap().push(path);
                        }
                        if let Some(path) = saved_audio_path(line.trim(), &repo_root) {
                            let _ = app.emit(
                                "process-event",
                                json!({ "type": "audio-path", "processId": process_id, "path": path.to_string_lossy() }),
                            );
                        }
                        if !live {
                            log.push(line);
                            continue;
                        }
                        match captions.ingest_line(&line, &now) {
                            Handled::Caption => {}
                            Handled::CaptionLogged(text) => log.push(text),
                            Handled::TranscriptPath(path) => {
                                let _ = app.emit(
                                    "process-event",
                                    json!({ "type": "transcript-path", "processId": process_id, "path": path }),
                                );
                                log.push(line);
                            }
                            Handled::Log => log.push(line),
                        }
                    }
                    if let Some(update) = captions.take_update() {
                        let _ = app.emit(
                            "process-event",
                            json!({ "type": "captions", "processId": process_id, "from": update.from, "lines": update.lines, "partial": update.partial }),
                        );
                    }
                    if !log.is_empty() {
                        Self::log(&app, process_id, "stdout", log);
                    }
                });
            })
        };
        let err_reader = {
            let app = app.clone();
            let last_error = last_error.clone();
            let stderr_tail = stderr_tail.clone();
            thread::spawn(move || {
                for_each_read(stderr, |lines| {
                    let joined = lines.join("\n");
                    let tail: String = {
                        let chars: Vec<char> = joined.trim().chars().collect();
                        chars[chars.len().saturating_sub(LAST_ERROR_CHARS)..].iter().collect()
                    };
                    *last_error.lock().unwrap() = tail;
                    // uv's error and its hint can arrive in separate reads.
                    let mut all = stderr_tail.lock().unwrap();
                    all.push_str(&joined);
                    all.push('\n');
                    if all.len() > STDERR_TAIL_BYTES {
                        let cut = all.len() - STDERR_TAIL_BYTES;
                        let cut = (cut..all.len()).find(|&index| all.is_char_boundary(index)).unwrap_or(all.len());
                        all.drain(..cut);
                    }
                    drop(all);
                    Self::log(&app, process_id, "stderr", lines);
                });
            })
        };

        let jobs = self.clone();
        let app = app.clone();
        thread::spawn(move || {
            let status = child.wait();
            let _ = out_reader.join();
            let _ = err_reader.join();
            if let Some(online) = retry {
                let failed = status.as_ref().ok().and_then(|status| status.code()) != Some(0);
                if failed && commands::failed_offline(&stderr_tail.lock().unwrap()) {
                    if let Some(next) = jobs.retry_online(&app, process_id, &online) {
                        jobs.watch(&app, process_id, &kind, next, None);
                        return;
                    }
                }
            }
            for path in recordings.lock().unwrap().drain(..) {
                match wav::repair_pcm_header(&path) {
                    Ok(true) => {
                        Self::log(&app, process_id, "stdout", vec![format!("Repaired WAV header: {}", path.display())])
                    }
                    Ok(false) => {}
                    Err(error) => Self::log(
                        &app,
                        process_id,
                        "stderr",
                        vec![format!("Could not repair WAV header: {}", path.display()), error.to_string()],
                    ),
                }
            }
            let code = status.as_ref().ok().and_then(|status| status.code());
            let stopped = {
                let mut state = jobs.state.lock().unwrap();
                if let Some(job) = state.jobs.remove(&process_id) {
                    if let Some(path) = job.stop_file {
                        let _ = fs::remove_file(path);
                    }
                }
                state.stopping.remove(&process_id)
            };
            let exit_text = match &status {
                Ok(_) => format!("Exited with code {}", code.map_or("null".into(), |code| code.to_string())),
                Err(error) => format!("Exited: {error}"),
            };
            Self::log(&app, process_id, "exit", vec![exit_text]);
            let error = last_error.lock().unwrap().clone();
            let _ = app.emit(
                "process-event",
                json!({ "type": "exit", "processId": process_id, "code": code, "stopped": stopped, "lastError": error }),
            );
        });
    }

    /// Asks a cooperative job to finish (stop file, up to 10 s), then
    /// terminates the process tree. Blocks; call it off the main thread.
    pub fn stop_blocking(&self, app: &AppHandle, process_id: u32) -> Result<bool, String> {
        let (pid, stop_file, first) = {
            let mut state = self.state.lock().unwrap();
            let Some(job) = state.jobs.get(&process_id) else { return Ok(false) };
            let (pid, stop_file) = (job.pid, job.stop_file.clone());
            (pid, stop_file, state.stopping.insert(process_id))
        };
        if !first {
            // Another stop is under way: wait for the same outcome.
            let deadline = Instant::now() + COOPERATIVE_STOP + Duration::from_secs(5);
            while self.is_running(process_id) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(100));
            }
            return Ok(true);
        }
        if let Some(path) = stop_file {
            fs::write(&path, "stop\n").map_err(|error| error.to_string())?;
            Self::log(app, process_id, "info", vec!["Stopping: closing recording and releasing model...".into()]);
            let deadline = Instant::now() + COOPERATIVE_STOP;
            while self.is_running(process_id) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(100));
            }
        }
        if self.is_running(process_id) {
            Self::log(
                app,
                process_id,
                "info",
                vec!["Stopping process tree (forced); unfinished transcription may be lost.".into()],
            );
            if let Err(error) = kill_tree(pid) {
                if self.is_running(process_id) {
                    self.state.lock().unwrap().stopping.remove(&process_id);
                    return Err(error);
                }
            }
        }
        Ok(true)
    }

    pub fn running_ids(&self) -> Vec<u32> {
        self.state.lock().unwrap().jobs.keys().copied().collect()
    }

    pub fn start_download(&self, app: &AppHandle, asset_id: &str) -> Result<bool, String> {
        let mut state = self.state.lock().unwrap();
        if state.downloads.contains_key(asset_id) {
            return Ok(false);
        }
        let spec = commands::asset_download(&self.paths, asset_id);
        let mut child =
            spawn(&spec, &self.paths, None, false).map_err(|error| format!("{}: {error}", spec.executable))?;
        state.downloads.insert(asset_id.to_string(), child.id());
        drop(state);

        let emit = |app: &AppHandle, payload: Value| {
            let _ = app.emit("asset-download-event", payload);
        };
        emit(app, json!({ "type": "start", "assetId": asset_id, "label": spec.label }));
        emit(app, json!({ "type": "progress", "assetId": asset_id, "percent": 1, "text": "Starting" }));

        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let out_reader = {
            let (app, asset_id) = (app.clone(), asset_id.to_string());
            thread::spawn(move || {
                for_each_read(stdout, |lines| {
                    for line in &lines {
                        if let Some((percent, text)) = assets::parse_progress(&asset_id, line) {
                            emit(
                                &app,
                                json!({ "type": "progress", "assetId": asset_id, "percent": percent, "text": text }),
                            );
                        }
                    }
                    Self::log(&app, 0, "stdout", lines);
                });
            })
        };
        let err_reader = {
            let app = app.clone();
            thread::spawn(move || for_each_read(stderr, |lines| Self::log(&app, 0, "stderr", lines)))
        };
        let (jobs, app, asset_id) = (self.clone(), app.clone(), asset_id.to_string());
        thread::spawn(move || {
            let code = child.wait().ok().and_then(|status| status.code());
            let _ = out_reader.join();
            let _ = err_reader.join();
            jobs.state.lock().unwrap().downloads.remove(&asset_id);
            if code == Some(0) {
                emit(&app, json!({ "type": "progress", "assetId": asset_id, "percent": 100, "text": "Done" }));
            }
            emit(&app, json!({ "type": "exit", "assetId": asset_id, "code": code }));
        });
        Ok(true)
    }

    pub fn stop_download(&self, app: &AppHandle, asset_id: &str) -> Result<bool, String> {
        let Some(pid) = self.state.lock().unwrap().downloads.get(asset_id).copied() else { return Ok(false) };
        kill_tree(pid)?;
        let _ = app.emit(
            "asset-download-event",
            json!({ "type": "progress", "assetId": asset_id, "percent": 0, "text": "Paused" }),
        );
        Ok(true)
    }

    /// Stops every job and download; used before the app exits.
    pub fn stop_all_blocking(&self, app: &AppHandle) {
        let downloads: Vec<u32> = self.state.lock().unwrap().downloads.values().copied().collect();
        for pid in downloads {
            let _ = kill_tree(pid);
        }
        let handles: Vec<_> = self
            .running_ids()
            .into_iter()
            .map(|id| {
                let (jobs, app) = (self.clone(), app.clone());
                thread::spawn(move || {
                    let _ = jobs.stop_blocking(&app, id);
                })
            })
            .collect();
        for handle in handles {
            let _ = handle.join();
        }
        // Give the waiter threads a moment to finish their WAV repairs.
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.busy() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_split_on_newline_and_carriage_return() {
        let mut seen = Vec::new();
        for_each_read(&b"one\r\ntwo\rthree\n\x1b[32mgreen\x1b[0m\nrest"[..], |lines| seen.extend(lines));
        assert_eq!(seen, vec!["one", "two", "three", "green", "rest"]);
    }

    #[test]
    fn recording_paths_resolve_against_the_repo() {
        let root = Path::new(r"C:\repo");
        assert_eq!(
            recording_path("Recording: outputs\\m\\audio.wav", root),
            Some(PathBuf::from(r"C:\repo\outputs\m\audio.wav"))
        );
        assert_eq!(recording_path("Recording: C:\\x\\audio.WAV", root), Some(PathBuf::from(r"C:\x\audio.WAV")));
        assert_eq!(recording_path("Writing: C:\\x\\audio.wav", root), None);
        assert_eq!(saved_audio_path("Writing: C:\\x\\audio.wav", root), Some(PathBuf::from(r"C:\x\audio.wav")));
        assert_eq!(
            saved_audio_path("Recording: outputs\\m\\audio.wav", root),
            Some(PathBuf::from(r"C:\repo\outputs\m\audio.wav"))
        );
        assert_eq!(saved_audio_path("Saved: C:\\x\\audio.wav (3.0s)", root), None);
    }

    #[test]
    fn log_lines_keep_an_existing_stamp() {
        assert_eq!(stamp_log_line("[09:00:00] ready", "10:00:00"), "[09:00:00] ready");
        assert_eq!(stamp_log_line("ready", "10:00:00"), "[10:00:00] ready");
    }
}
