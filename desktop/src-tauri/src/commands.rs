//! What each job runs. Mirrors the Electron shell's launch table: the scripts,
//! executables and arguments are unchanged, so the backends need no changes.

use crate::paths::AppPaths;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub type Args = Map<String, Value>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub label: String,
    pub executable: String,
    pub args: Vec<String>,
}

fn text(args: &Args, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).filter(|value| !value.is_empty()).map(str::to_string)
}

fn number(args: &Args, key: &str) -> Option<String> {
    let value = args.get(key)?.as_f64().filter(|value| value.is_finite())?;
    Some(if value.fract() == 0.0 { format!("{}", value as i64) } else { value.to_string() })
}

fn logical_threads() -> usize {
    std::thread::available_parallelism().map(usize::from).unwrap_or(1).max(1)
}

fn post_threads() -> String {
    match logical_threads() {
        threads if threads <= 4 => threads.to_string(),
        threads if threads <= 8 => "6".into(),
        threads if threads <= 16 => "10".into(),
        _ => "16".into(),
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub fn resolve_output_dir(paths: &AppPaths, args: &Args) -> Result<PathBuf, String> {
    let configured = text(args, "outputDir").unwrap_or_else(|| "outputs".into());
    let dir = paths.in_data_root(configured.trim());
    fs::create_dir_all(&dir).map_err(|error| format!("{}: {error}", dir.display()))?;
    Ok(dir)
}

/// `<prefix>_YYYYMMDD_HHMMSS` in UTC, as the Electron shell named them.
fn timestamped_dir(output_dir: &Path, prefix: &str) -> Result<PathBuf, String> {
    let stamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let dir = output_dir.join(format!("{prefix}_{stamp}"));
    fs::create_dir_all(&dir).map_err(|error| format!("{}: {error}", dir.display()))?;
    Ok(dir)
}

/// A session's `audio.wav` gets its transcript beside it; any other file gets
/// `<name>_<suffix>.txt` in the output folder.
pub fn transcript_output_path(audio_path: &Path, output_dir: &Path, suffix: &str) -> PathBuf {
    let name = audio_path.file_name().map(|name| name.to_string_lossy().to_lowercase()).unwrap_or_default();
    if name == "audio.wav" {
        return audio_path.with_file_name(format!("{suffix}.txt"));
    }
    let stem = audio_path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_else(|| "audio".into());
    output_dir.join(format!("{stem}_{suffix}.txt"))
}

fn without_txt(path: PathBuf) -> String {
    let text = path_text(&path);
    text.strip_suffix(".txt").map(str::to_string).unwrap_or(text)
}

fn capture_args(args: &Args) -> Vec<String> {
    let mut extra = Vec::new();
    if let Some(seconds) = number(args, "previewSeconds") {
        extra.extend(["--preview-seconds".into(), seconds]);
    }
    if let Some(device) = text(args, "systemDevice") {
        extra.extend(["--system-device".into(), device]);
    }
    if args.get("includeMic").and_then(Value::as_bool) == Some(true) {
        extra.push("--include-mic".into());
        if let Some(device) = text(args, "micDevice") {
            extra.extend(["--mic-device".into(), device]);
        }
    }
    extra
}

/// The recognition language: auto (detected per utterance), zh, yue, en or ja.
/// Settings saved before languages existed have none, and keep Japanese.
pub fn language(args: &Args) -> &'static str {
    match args.get("language").and_then(Value::as_str) {
        Some("auto") => "auto",
        Some("zh") => "zh",
        Some("yue") => "yue",
        Some("en") => "en",
        _ => "ja",
    }
}

/// Qwen3-ASR takes language names; an empty one lets it detect the language.
fn qwen_language(language: &str) -> &'static str {
    match language {
        "zh" => "Chinese",
        "yue" => "Cantonese",
        "en" => "English",
        "ja" => "Japanese",
        _ => "",
    }
}

/// Traditional (HK) unless Simplified is chosen: the recognizers' own output is
/// Simplified (SenseVoice) or a mix of both (Whisper).
fn chinese_script(args: &Args) -> &'static str {
    match args.get("chineseScript").and_then(Value::as_str) {
        Some("simplified") => "simplified",
        _ => "traditional",
    }
}

/// Language and Chinese script for the live scripts (live_transcribe.py, live_cpp.py).
fn recognition_args(args: &Args) -> Vec<String> {
    vec!["--language".into(), language(args).into(), "--chinese-script".into(), chinese_script(args).into()]
}

fn script(label: &str, path: &str, args: Vec<String>) -> CommandSpec {
    let mut all = vec!["/c".to_string(), path.to_string()];
    all.extend(args);
    CommandSpec { label: label.into(), executable: "cmd.exe".into(), args: all }
}

/// File transcription jobs read an existing audio file.
pub fn reads_input_audio(kind: &str) -> bool {
    matches!(
        kind,
        "cpp-gpu"
            | "cpp-cpu"
            | "cpp-vulkan"
            | "cpp-npu"
            | "cpp-openvino-gpu"
            | "qwen-gpu"
            | "qwen-cpu"
            | "qwen17-gpu"
            | "qwen17-cpu"
    )
}

/// Python capture jobs stop on the stop file: they close their WAV and release
/// the model first. Everything else is terminated.
pub fn is_cooperative(kind: &str) -> bool {
    (kind.starts_with("live-") && !kind.starts_with("live-cpp-stream-loopback")) || kind.starts_with("record-")
}

pub fn is_loopback_stream(kind: &str) -> bool {
    kind.starts_with("live-cpp-stream-loopback")
}

/// Jobs whose cached uv environment is used as is (`UV_OFFLINE=1`). Online, uv
/// rechecks the package indexes on every start: about 2 s for Qwen (pinned in
/// qwen-requirements.txt) and 14 s for SenseVoice on CUDA, whose sherpa-onnx
/// CUDA wheels are listed on a large --find-links page. A job whose cache is
/// missing is rerun online.
pub fn prefers_offline(kind: &str) -> bool {
    kind.starts_with("qwen") || kind.starts_with("live-sensevoice")
}

/// Whether uv itself failed because `--offline` kept it from resolving the
/// environment (packages or interpreter not cached), as opposed to the script
/// failing. Both end with exit code 1 or 2, so only uv's own hints tell.
pub fn failed_offline(stderr: &str) -> bool {
    stderr.contains("because the network was disabled") || stderr.contains("uv is set to offline mode")
}

fn whisper_cli(paths: &AppPaths, runtime: &str) -> String {
    path_text(&paths.data_root.join("whisper_cpp").join(runtime).join("Release").join("whisper-cli.exe"))
}

fn small_model(paths: &AppPaths) -> String {
    path_text(&paths.data_root.join("whisper_cpp").join("models").join("ggml-small.bin"))
}

fn openvino(paths: &AppPaths, audio: &str, output: String, device: &str, language: &str) -> Vec<String> {
    [
        "-m",
        &small_model(paths),
        "-f",
        audio,
        "-l",
        language,
        "-oved",
        device,
        "-t",
        "8",
        "-bs",
        "1",
        "-bo",
        "1",
        "-nf",
        "-nt",
        "-np",
        "-otxt",
        "-of",
        &output,
    ]
    .iter()
    .map(|value| value.to_string())
    .collect()
}

pub fn build(paths: &AppPaths, kind: &str, args: &Args) -> Result<CommandSpec, String> {
    let output_dir = resolve_output_dir(paths, args)?;
    let out = path_text(&output_dir);
    let audio = text(args, "audioPath");
    let need_audio = || audio.clone().ok_or_else(|| "Choose an audio file first.".to_string());
    let post_output = |suffix: &str| -> Result<String, String> {
        Ok(without_txt(transcript_output_path(Path::new(&need_audio()?), &output_dir, suffix)))
    };
    let lang = language(args);
    // Live jobs that record into a session folder; record-* jobs do not recognize speech.
    let recording = |extra: Vec<String>| {
        let mut all = vec!["--recording-dir".to_string(), out.clone()];
        all.extend(extra);
        all.extend(capture_args(args));
        all.extend(recognition_args(args));
        all
    };

    Ok(match kind {
        "live-sensevoice-cpu" | "live-sensevoice-gpu" => {
            let gpu = kind.ends_with("-gpu");
            let save_wav = args.get("saveWav").and_then(Value::as_bool).unwrap_or(true);
            let mut extra = if save_wav {
                vec![
                    "--save-recording".into(),
                    "--recording-dir".into(),
                    out.clone(),
                    "--session-prefix".into(),
                    "sensevoice_live".into(),
                ]
            } else {
                let output = timestamped_dir(&output_dir, "sensevoice_text")?.join("live_transcript.txt");
                vec!["--output".to_string(), path_text(&output)]
            };
            let model =
                paths.data_root.join("models").join(if gpu { "SenseVoiceSmall-fp32" } else { "SenseVoiceSmall" });
            extra.extend(["--sensevoice-model".into(), path_text(&model)]);
            extra.extend(capture_args(args));
            extra.extend(recognition_args(args));
            if gpu {
                script("Live SenseVoice GPU", r"python_backend\live_sensevoice_gpu.cmd", extra)
            } else {
                script("Live SenseVoice CPU", r"python_backend\live_sensevoice.cmd", extra)
            }
        }
        "live-cpp-turbo-gpu" => script(
            "Live whisper.cpp Turbo GPU",
            r"whisper_cpp\live_cpp.cmd",
            recording(vec![
                "--model".into(),
                "models/ggml-large-v3-turbo.bin".into(),
                "--session-prefix".into(),
                "cpp_turbo_live".into(),
            ]),
        ),
        "record-enter" => {
            let output = timestamped_dir(&output_dir, "meeting")?.join("audio.wav");
            let mut extra = vec!["--until-enter".to_string(), "--output".into(), path_text(&output)];
            extra.extend(capture_args(args));
            script("Record until Enter", r"python_backend\record_meeting.cmd", extra)
        }
        "record-timed" => {
            let duration = number(args, "durationSeconds").unwrap_or_else(|| "3600".into());
            let output = timestamped_dir(&output_dir, "meeting")?.join("audio.wav");
            let mut extra = vec!["--duration".to_string(), duration, "--output".into(), path_text(&output)];
            extra.extend(capture_args(args));
            script("Timed recording", r"python_backend\record_meeting.cmd", extra)
        }
        "cpp-gpu" => CommandSpec {
            label: "whisper.cpp GPU".into(),
            executable: whisper_cli(paths, "bin_cuda"),
            args: vec![
                "-m".into(),
                small_model(paths),
                "-f".into(),
                need_audio()?,
                "-l".into(),
                lang.into(),
                "-otxt".into(),
                "-of".into(),
                post_output("cpp_gpu_transcript")?,
            ],
        },
        "cpp-cpu" => CommandSpec {
            label: "whisper.cpp CPU".into(),
            executable: whisper_cli(paths, "bin_cpu"),
            args: vec![
                "-m".into(),
                small_model(paths),
                "-f".into(),
                need_audio()?,
                "-l".into(),
                lang.into(),
                "-otxt".into(),
                "-of".into(),
                post_output("cpp_cpu_transcript")?,
                "-t".into(),
                post_threads(),
            ],
        },
        "cpp-vulkan" => script(
            "whisper.cpp Vulkan",
            r"whisper_cpp\post_cpp_vulkan.cmd",
            vec![need_audio()?, post_output("cpp_vulkan_transcript")?, "8".into()],
        ),
        "cpp-npu" => CommandSpec {
            label: "whisper.cpp NPU".into(),
            executable: whisper_cli(paths, "bin_openvino"),
            args: openvino(paths, &need_audio()?, post_output("cpp_npu_transcript")?, "NPU", lang),
        },
        "cpp-openvino-gpu" => CommandSpec {
            label: "whisper.cpp OpenVINO GPU".into(),
            executable: whisper_cli(paths, "bin_openvino"),
            args: openvino(paths, &need_audio()?, post_output("cpp_openvino_gpu_transcript")?, "GPU", lang),
        },
        "qwen-gpu" | "qwen-cpu" | "qwen17-gpu" | "qwen17-cpu" => {
            let gpu = kind.ends_with("-gpu");
            let large = kind.starts_with("qwen17");
            let audio = need_audio()?;
            let output = transcript_output_path(
                Path::new(&audio),
                &output_dir,
                match (large, gpu) {
                    (false, true) => "qwen_gpu_transcript",
                    (false, false) => "qwen_cpu_transcript",
                    (true, true) => "qwen17_gpu_transcript",
                    (true, false) => "qwen17_cpu_transcript",
                },
            );
            let requirements = paths.repo_root.join("python_backend").join("qwen-requirements.txt");
            let script_path = paths.repo_root.join("python_backend").join("post_transcribe_qwen.py");
            let model = paths.data_root.join("models").join(if large { "Qwen3-ASR-1.7B" } else { "Qwen3-ASR-0.6B" });
            let mut all: Vec<String> = [
                "run",
                "--no-project",
                "--python",
                "3.11",
                "--index-strategy",
                "unsafe-best-match",
                "--index-url",
                "https://download.pytorch.org/whl/cu128",
                "--extra-index-url",
                "https://pypi.org/simple",
                "--with-requirements",
            ]
            .iter()
            .map(|value| value.to_string())
            .collect();
            all.extend([
                path_text(&requirements),
                "python".into(),
                "-u".into(),
                path_text(&script_path),
                audio,
                "-o".into(),
                path_text(&output),
                "--device".into(),
                (if gpu { "cuda:0" } else { "cpu" }).into(),
                "--language".into(),
                qwen_language(lang).into(),
                "--model".into(),
                path_text(&model),
                "--max-new-tokens".into(),
                number(args, "qwenTokens").unwrap_or_else(|| "4096".into()),
                "--chunk-seconds".into(),
                number(args, "chunkSeconds").unwrap_or_else(|| "60".into()),
                "--batch-size".into(),
                number(args, "qwenBatch").unwrap_or_else(|| "16".into()),
            ]);
            let label = match (large, gpu) {
                (false, true) => "Qwen GPU",
                (false, false) => "Qwen CPU",
                (true, true) => "Qwen 1.7B GPU",
                (true, false) => "Qwen 1.7B CPU",
            };
            CommandSpec { label: label.into(), executable: "uv".into(), args: all }
        }
        _ => return Err(format!("Unknown command: {kind}")),
    })
}

pub fn asset_download(paths: &AppPaths, asset_id: &str) -> CommandSpec {
    CommandSpec {
        label: crate::assets::label(asset_id),
        executable: "uv".into(),
        args: [
            "run",
            "--with",
            "huggingface-hub",
            "python",
            "python_backend/download_assets.py",
            "--target-root",
            &path_text(&paths.data_root),
            "--only",
            asset_id,
        ]
        .iter()
        .map(|value| value.to_string())
        .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_audio_gets_its_transcript_beside_it() {
        let out = Path::new(r"C:\data\outputs");
        assert_eq!(
            transcript_output_path(Path::new(r"C:\data\outputs\meeting_1\audio.wav"), out, "cpp_cpu_transcript"),
            PathBuf::from(r"C:\data\outputs\meeting_1\cpp_cpu_transcript.txt")
        );
        assert_eq!(
            transcript_output_path(Path::new(r"D:\calls\weekly sync.m4a"), out, "qwen_gpu_transcript"),
            PathBuf::from(r"C:\data\outputs\weekly sync_qwen_gpu_transcript.txt")
        );
    }

    #[test]
    fn capture_args_follow_the_settings() {
        let args: Args = serde_json::from_value(serde_json::json!({
            "previewSeconds": 1.5,
            "systemDevice": "{0.0.0.00000000}.{abc}",
            "includeMic": true,
            "micDevice": ""
        }))
        .unwrap();
        assert_eq!(
            capture_args(&args),
            vec!["--preview-seconds", "1.5", "--system-device", "{0.0.0.00000000}.{abc}", "--include-mic"]
        );
    }

    #[test]
    fn whole_numbers_print_without_a_fraction() {
        let args: Args =
            serde_json::from_value(serde_json::json!({ "durationSeconds": 3600.0, "previewSeconds": 1 })).unwrap();
        assert_eq!(number(&args, "durationSeconds").as_deref(), Some("3600"));
        assert_eq!(number(&args, "previewSeconds").as_deref(), Some("1"));
    }

    fn test_paths(name: &str) -> (PathBuf, AppPaths) {
        let root = std::env::temp_dir().join(format!("lmstt-{name}-{}", std::process::id()));
        let paths = AppPaths {
            repo_root: root.clone(),
            data_root: root.clone(),
            runtime_dir: root.join("runtime"),
            settings_path: root.join("settings.json"),
        };
        (root, paths)
    }

    fn value(spec: &CommandSpec, flag: &str) -> Option<String> {
        spec.args.iter().position(|arg| arg == flag).map(|at| spec.args[at + 1].clone())
    }

    #[test]
    fn the_recognition_language_reaches_every_backend() {
        let (root, paths) = test_paths("lang");
        let with = |extra: serde_json::Value| -> Args {
            let mut args = serde_json::json!({ "audioPath": r"C:\calls\weekly.wav", "outputDir": "outputs" });
            args.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            serde_json::from_value(args).unwrap()
        };
        let yue = with(serde_json::json!({ "language": "yue", "chineseScript": "traditional" }));
        let live = build(&paths, "live-cpp-turbo-gpu", &yue).unwrap();
        assert_eq!(value(&live, "--language").as_deref(), Some("yue"));
        assert_eq!(value(&live, "--chinese-script").as_deref(), Some("traditional"));
        assert_eq!(value(&build(&paths, "cpp-gpu", &yue).unwrap(), "-l").as_deref(), Some("yue"));
        assert_eq!(value(&build(&paths, "qwen17-gpu", &yue).unwrap(), "--language").as_deref(), Some("Cantonese"));
        let auto = with(serde_json::json!({ "language": "auto" }));
        assert_eq!(value(&build(&paths, "qwen-cpu", &auto).unwrap(), "--language").as_deref(), Some(""));
        let sensevoice = build(&paths, "live-sensevoice-cpu", &auto).unwrap();
        assert_eq!(value(&sensevoice, "--language").as_deref(), Some("auto"));
        assert_eq!(value(&sensevoice, "--chinese-script").as_deref(), Some("traditional"));
        let as_is = with(serde_json::json!({ "language": "yue", "chineseScript": "as-is" }));
        assert_eq!(
            value(&build(&paths, "live-sensevoice-gpu", &as_is).unwrap(), "--chinese-script").as_deref(),
            Some("traditional")
        );
        // Removed live modes (Whisper small/base, faster-whisper, Vulkan, OpenVINO) are refused.
        for removed in ["live-meeting", "live-whisper", "live-cpp-gpu", "live-cpp-cpu", "live-cpp-stream-loopback-base"]
        {
            assert!(build(&paths, removed, &auto).is_err(), "{removed}");
        }
        // Settings from before languages existed stay Japanese; unknown values too.
        let old = with(serde_json::json!({}));
        assert_eq!(value(&build(&paths, "cpp-cpu", &old).unwrap(), "-l").as_deref(), Some("ja"));
        assert_eq!(language(&with(serde_json::json!({ "language": "fr" }))), "ja");
        // Recording alone does not recognize speech, and record_audio.py takes no language.
        assert_eq!(value(&build(&paths, "record-enter", &yue).unwrap(), "--language"), None);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn sensevoice_live_kinds_pick_their_model_and_wav() {
        let (root, paths) = test_paths("sensevoice");
        let args: Args =
            serde_json::from_value(serde_json::json!({ "outputDir": "outputs", "language": "zh" })).unwrap();
        let cpu = build(&paths, "live-sensevoice-cpu", &args).unwrap();
        assert!(cpu.args.iter().any(|arg| arg.ends_with("live_sensevoice.cmd")));
        assert!(value(&cpu, "--sensevoice-model").unwrap().ends_with("SenseVoiceSmall"));
        assert!(cpu.args.contains(&"--save-recording".to_string()));
        assert_eq!(value(&cpu, "--session-prefix").as_deref(), Some("sensevoice_live"));
        let no_wav: Args =
            serde_json::from_value(serde_json::json!({ "outputDir": "outputs", "saveWav": false })).unwrap();
        let gpu = build(&paths, "live-sensevoice-gpu", &no_wav).unwrap();
        assert!(gpu.args.iter().any(|arg| arg.ends_with("live_sensevoice_gpu.cmd")));
        assert!(value(&gpu, "--sensevoice-model").unwrap().ends_with("SenseVoiceSmall-fp32"));
        assert!(!gpu.args.contains(&"--save-recording".to_string()));
        assert!(value(&gpu, "--output").unwrap().ends_with("live_transcript.txt"));
        assert!(is_cooperative("live-sensevoice-gpu"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn qwen_batch_defaults_to_16() {
        let root = std::env::temp_dir().join(format!("lmstt-qwen-batch-{}", std::process::id()));
        let paths = AppPaths {
            repo_root: root.clone(),
            data_root: root.clone(),
            runtime_dir: root.join("runtime"),
            settings_path: root.join("settings.json"),
        };
        let args: Args =
            serde_json::from_value(serde_json::json!({ "audioPath": r"C:\calls\weekly.wav", "outputDir": "outputs" }))
                .unwrap();
        let spec = build(&paths, "qwen-gpu", &args).unwrap();
        let at = spec.args.iter().position(|arg| arg == "--batch-size").unwrap();
        assert_eq!(spec.args[at + 1], "16");
        assert_eq!(crate::settings::default_settings()["qwen"]["batch"], 16);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn qwen_17b_uses_its_own_model_and_transcript() {
        let root = std::env::temp_dir().join(format!("lmstt-qwen17-{}", std::process::id()));
        let paths = AppPaths {
            repo_root: root.clone(),
            data_root: root.clone(),
            runtime_dir: root.join("runtime"),
            settings_path: root.join("settings.json"),
        };
        let audio = root.join("outputs").join("meeting_1").join("audio.wav");
        let args: Args =
            serde_json::from_value(serde_json::json!({ "audioPath": audio.to_string_lossy(), "outputDir": "outputs" }))
                .unwrap();
        let spec = build(&paths, "qwen17-gpu", &args).unwrap();
        let value = |flag: &str| spec.args[spec.args.iter().position(|arg| arg == flag).unwrap() + 1].clone();
        assert_eq!(spec.label, "Qwen 1.7B GPU");
        assert!(value("--model").ends_with("Qwen3-ASR-1.7B"));
        assert!(value("-o").ends_with("qwen17_gpu_transcript.txt"));
        assert_eq!(value("--device"), "cuda:0");
        let small = build(&paths, "qwen-cpu", &args).unwrap();
        let model = small.args[small.args.iter().position(|arg| arg == "--model").unwrap() + 1].clone();
        assert!(model.ends_with("Qwen3-ASR-0.6B"));
        assert!(reads_input_audio("qwen17-cpu"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn qwen_and_sensevoice_run_offline_first() {
        assert!(prefers_offline("qwen-gpu") && prefers_offline("qwen-cpu") && prefers_offline("qwen17-gpu"));
        assert!(prefers_offline("live-sensevoice-gpu") && prefers_offline("live-sensevoice-cpu"));
        assert!(!prefers_offline("cpp-gpu") && !prefers_offline("live-cpp-turbo-gpu"));
    }

    #[test]
    fn only_uv_offline_failures_are_retried() {
        // Messages printed by uv 0.12 with an empty cache and with a missing interpreter.
        let packages = "  × No solution found when resolving `--with` dependencies:\n  ╰─▶ Because qwen-asr was not found in the cache and you require\n      qwen-asr==0.0.6, we can conclude that your requirements are\n      unsatisfiable.\n\nhint: Packages were unavailable because the network was disabled. When the network is disabled, registry packages may only be read from the cache.";
        let interpreter = "error: No interpreter found for Python 3.9 in virtual environments, managed installations, search path, or registry\n\nhint: A managed Python download is available for Python 3.9, but uv is set to offline mode";
        let script = "Traceback (most recent call last):\nRuntimeError: CUDA is unavailable. Select Qwen CPU or install the GPU runtime.";
        assert!(failed_offline(packages));
        assert!(failed_offline(interpreter));
        assert!(!failed_offline(script));
        assert!(!failed_offline("Local model missing: models/Qwen3-ASR-0.6B. Download it from Setup first."));
    }

    #[test]
    fn stop_behaviour_matches_the_backend() {
        assert!(is_cooperative("live-cpp-turbo-gpu"));
        assert!(is_cooperative("record-enter"));
        assert!(!is_cooperative("live-cpp-stream-loopback-small"));
        assert!(!is_cooperative("cpp-gpu"));
        assert!(is_loopback_stream("live-cpp-stream-loopback-base"));
    }
}
