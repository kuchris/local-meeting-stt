//! Recording sessions: folders in the output folder that hold an `audio.wav`.

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcripts {
    live: bool,
    cpp_cpu: bool,
    cpp_gpu: bool,
    cpp_turbo_gpu: bool,
    cpp_vulkan: bool,
    cpp_npu: bool,
    cpp_openvino_gpu: bool,
    qwen_cpu: bool,
    qwen_gpu: bool,
    qwen17_cpu: bool,
    qwen17_gpu: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSession {
    id: String,
    name: String,
    folder_path: String,
    audio_path: String,
    audio_size: u64,
    modified_time: f64,
    transcripts: Transcripts,
}

pub fn list(output_dir: &Path) -> Vec<OutputSession> {
    let Ok(entries) = fs::read_dir(output_dir) else { return Vec::new() };
    let mut sessions: Vec<OutputSession> = entries
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter_map(|entry| {
            let folder = entry.path();
            let audio = folder.join("audio.wav");
            let meta = audio.metadata().ok().filter(|meta| meta.is_file())?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1000.0);
            let has = |name: &str| folder.join(name).is_file();
            let folder_text = folder.to_string_lossy().into_owned();
            Some(OutputSession {
                id: folder_text.clone(),
                name: entry.file_name().to_string_lossy().into_owned(),
                folder_path: folder_text,
                audio_path: audio.to_string_lossy().into_owned(),
                audio_size: meta.len(),
                modified_time: modified,
                transcripts: Transcripts {
                    live: has("live_transcript.txt"),
                    cpp_cpu: has("cpp_cpu_transcript.txt"),
                    cpp_gpu: has("cpp_gpu_transcript.txt"),
                    cpp_turbo_gpu: has("cpp_turbo_gpu_transcript.txt"),
                    cpp_vulkan: has("cpp_vulkan_transcript.txt"),
                    cpp_npu: has("cpp_npu_transcript.txt"),
                    cpp_openvino_gpu: has("cpp_openvino_gpu_transcript.txt"),
                    qwen_cpu: has("qwen_cpu_transcript.txt"),
                    qwen_gpu: has("qwen_gpu_transcript.txt"),
                    qwen17_cpu: has("qwen17_cpu_transcript.txt"),
                    qwen17_gpu: has("qwen17_gpu_transcript.txt"),
                },
            })
        })
        .collect();
    sessions.sort_by(|left, right| right.modified_time.total_cmp(&left.modified_time));
    sessions
}
