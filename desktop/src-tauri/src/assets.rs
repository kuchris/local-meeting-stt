//! The local models and runtimes each backend needs. Checks paths only, not
//! hardware support or file integrity.

use crate::paths::AppPaths;
use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub relative_path: &'static str,
    pub exists: bool,
    pub downloadable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<&'static str>,
}

struct Asset {
    id: &'static str,
    label: &'static str,
    relative_path: &'static str,
    downloadable: bool,
    note: Option<&'static str>,
}

const ASSETS: &[Asset] = &[
    Asset { id: "qwen", label: "Qwen3-ASR", relative_path: "models/Qwen3-ASR-0.6B", downloadable: true, note: None },
    Asset {
        id: "faster-whisper",
        label: "faster-whisper small",
        relative_path: "models/faster-whisper-small",
        downloadable: true,
        note: None,
    },
    Asset {
        id: "whisper-cpp-cpu",
        label: "whisper.cpp CPU",
        relative_path: "whisper_cpp/bin_cpu/Release/whisper-cli.exe",
        downloadable: true,
        note: None,
    },
    Asset {
        id: "whisper-cpp-cuda",
        label: "whisper.cpp CUDA",
        relative_path: "whisper_cpp/bin_cuda/Release/whisper-cli.exe",
        downloadable: true,
        note: None,
    },
    Asset {
        id: "whisper-cpp-vulkan",
        label: "whisper.cpp Vulkan",
        relative_path: "whisper_cpp/bin_vulkan/Release/whisper-server.exe",
        downloadable: false,
        note: Some("Build locally; not available from the asset downloader."),
    },
    Asset {
        id: "whisper-cpp-openvino",
        label: "whisper.cpp OpenVINO",
        relative_path: "whisper_cpp/bin_openvino/Release/whisper-server.exe",
        downloadable: false,
        note: Some("Separate local build; requires the OpenVINO encoder model."),
    },
    Asset {
        id: "whisper-cpp-openvino-model-xml",
        label: "whisper.cpp OpenVINO small encoder XML",
        relative_path: "whisper_cpp/models/ggml-small-encoder-openvino.xml",
        downloadable: false,
        note: Some("Generated locally from the small model for OpenVINO."),
    },
    Asset {
        id: "whisper-cpp-openvino-model-bin",
        label: "whisper.cpp OpenVINO small encoder BIN",
        relative_path: "whisper_cpp/models/ggml-small-encoder-openvino.bin",
        downloadable: false,
        note: Some("Generated locally from the small model for OpenVINO."),
    },
    Asset {
        id: "whisper-cpp-vulkan-loopback",
        label: "whisper.cpp Vulkan loopback",
        relative_path: "whisper_cpp/bin_vulkan_loopback/Release/whisper-stream-loopback.exe",
        downloadable: false,
        note: Some("Custom local build; see whisper_cpp/vulkan-loopback-custom-build.md."),
    },
    Asset {
        id: "whisper-cpp-base-model",
        label: "whisper.cpp base model",
        relative_path: "whisper_cpp/models/ggml-base.bin",
        downloadable: true,
        note: None,
    },
    Asset {
        id: "whisper-cpp-turbo-model",
        label: "whisper.cpp large-v3-turbo model",
        relative_path: "whisper_cpp/models/ggml-large-v3-turbo.bin",
        downloadable: true,
        note: None,
    },
    Asset {
        id: "whisper-cpp-model",
        label: "whisper.cpp small model",
        relative_path: "whisper_cpp/models/ggml-small.bin",
        downloadable: true,
        note: None,
    },
];

pub fn label(asset_id: &str) -> String {
    ASSETS.iter().find(|asset| asset.id == asset_id).map_or(asset_id.to_string(), |asset| asset.label.into())
}

pub fn check(paths: &AppPaths) -> Vec<AssetStatus> {
    ASSETS
        .iter()
        .map(|asset| {
            let path = paths.data_root.join(asset.relative_path);
            // The live CPU/CUDA backends also need the resident server beside the CLI.
            let needs_server = matches!(asset.id, "whisper-cpp-cpu" | "whisper-cpp-cuda");
            let exists = path.exists() && (!needs_server || path.with_file_name("whisper-server.exe").exists());
            AssetStatus {
                id: asset.id,
                label: asset.label,
                relative_path: asset.relative_path,
                exists,
                downloadable: asset.downloadable,
                note: asset.note,
            }
        })
        .collect()
}

/// Parses `ASSET_PROGRESS <id> <percent> <text>` lines from download_assets.py.
pub fn parse_progress(asset_id: &str, line: &str) -> Option<(u8, String)> {
    let mut parts = line.trim_end().splitn(4, char::is_whitespace);
    if parts.next()? != "ASSET_PROGRESS" || parts.next()? != asset_id {
        return None;
    }
    let percent: u32 = parts.next()?.parse().ok()?;
    let text = parts.next().unwrap_or("").trim().to_string();
    Some((percent.min(100) as u8, text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_lines_are_read_for_their_asset_only() {
        assert_eq!(
            parse_progress("qwen", "ASSET_PROGRESS qwen 42 model.safetensors"),
            Some((42, "model.safetensors".into()))
        );
        assert_eq!(parse_progress("qwen", "ASSET_PROGRESS qwen 140"), Some((100, String::new())));
        assert_eq!(parse_progress("qwen", "ASSET_PROGRESS whisper-cpp-model 10 x"), None);
        assert_eq!(parse_progress("qwen", "Downloading qwen"), None);
    }
}
