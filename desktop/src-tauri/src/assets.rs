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
    /// Left out of "Download missing"; downloaded from its own row.
    pub optional: bool,
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
    Asset {
        id: "qwen",
        label: "Qwen3-ASR 0.6B",
        relative_path: "models/Qwen3-ASR-0.6B",
        downloadable: true,
        note: None,
    },
    Asset {
        id: "qwen-1.7b",
        label: "Qwen3-ASR 1.7B",
        relative_path: "models/Qwen3-ASR-1.7B",
        downloadable: true,
        note: Some("Optional, about 4.4 GB. More accurate, needs more GPU memory."),
    },
    Asset {
        id: "sensevoice-small",
        label: "SenseVoice-Small (CPU)",
        relative_path: "models/SenseVoiceSmall",
        downloadable: true,
        note: Some("Chinese, Cantonese, English, Japanese live captions on CPU; about 230 MB."),
    },
    Asset {
        id: "sensevoice-small-gpu",
        label: "SenseVoice-Small (GPU)",
        relative_path: "models/SenseVoiceSmall-fp32",
        downloadable: true,
        note: Some("Optional, about 900 MB. The first GPU run also downloads NVIDIA CUDA libraries (about 1.5 GB)."),
    },
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

const OPTIONAL: &[&str] = &["qwen-1.7b", "sensevoice-small-gpu"];

/// Files that must all be present, beyond the asset's own path. A sharded
/// model only counts once every shard has finished: huggingface_hub moves a
/// file into place when its download completes, so a paused download is missing one.
fn required_files(asset_id: &str) -> &'static [&'static str] {
    match asset_id {
        "qwen-1.7b" => &[
            "config.json",
            "preprocessor_config.json",
            "model-00001-of-00002.safetensors",
            "model-00002-of-00002.safetensors",
        ],
        "sensevoice-small" => &["model.int8.onnx", "tokens.txt"],
        "sensevoice-small-gpu" => &["model.onnx", "tokens.txt"],
        _ => &[],
    }
}

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
            let exists = path.exists()
                && (!needs_server || path.with_file_name("whisper-server.exe").exists())
                && required_files(asset.id).iter().all(|file| path.join(file).is_file());
            AssetStatus {
                id: asset.id,
                label: asset.label,
                relative_path: asset.relative_path,
                exists,
                downloadable: asset.downloadable,
                optional: OPTIONAL.contains(&asset.id),
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
    fn a_sharded_model_counts_only_when_every_shard_is_there() {
        let root = std::env::temp_dir().join(format!("lmstt-assets-{}", std::process::id()));
        let model = root.join("models").join("Qwen3-ASR-1.7B");
        std::fs::create_dir_all(&model).unwrap();
        for file in ["config.json", "preprocessor_config.json", "model-00001-of-00002.safetensors"] {
            std::fs::write(model.join(file), b"x").unwrap();
        }
        let paths = AppPaths {
            repo_root: root.clone(),
            data_root: root.clone(),
            runtime_dir: root.join("runtime"),
            settings_path: root.join("settings.json"),
        };
        let status = |paths: &AppPaths| check(paths).into_iter().find(|asset| asset.id == "qwen-1.7b").unwrap();
        assert!(!status(&paths).exists, "a missing shard means a paused download");
        assert!(status(&paths).optional);
        std::fs::write(model.join("model-00002-of-00002.safetensors"), b"x").unwrap();
        assert!(status(&paths).exists);
        std::fs::remove_dir_all(&root).unwrap();
    }

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
