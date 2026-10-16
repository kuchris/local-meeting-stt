//! Where the backends live (repo root) and where user data goes (data root).
//!
//! A source checkout runs from `desktop/src-tauri/target/<profile>/`, a portable
//! folder runs with the executable beside `python_backend/`. Both are found by
//! walking up from the executable and the working directory.

use std::env;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct AppPaths {
    /// Holds `python_backend/` and `whisper_cpp/` launch scripts; child processes start here.
    pub repo_root: PathBuf,
    /// Holds `settings.json`, `models/`, `outputs/` and `runtime/`.
    pub data_root: PathBuf,
    pub runtime_dir: PathBuf,
    pub settings_path: PathBuf,
}

fn is_repo_root(candidate: &Path) -> bool {
    candidate.join("python_backend").join("record_audio.py").is_file()
}

fn with_ancestors(start: &Path, levels: usize) -> Vec<PathBuf> {
    start.ancestors().take(levels + 1).map(Path::to_path_buf).collect()
}

fn exe_dir() -> Option<PathBuf> {
    env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf))
}

fn resolve_repo_root() -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(root) = env::var_os("LOCAL_MEETING_STT_ROOT") {
        candidates.push(PathBuf::from(root));
    }
    if let Some(dir) = exe_dir() {
        candidates.extend(with_ancestors(&dir, 5));
    }
    if let Ok(cwd) = env::current_dir() {
        candidates.extend(with_ancestors(&cwd, 3));
    }
    candidates
        .iter()
        .find(|candidate| is_repo_root(candidate))
        .cloned()
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_data_root(repo_root: &Path) -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(root) = env::var_os("LOCAL_MEETING_STT_DATA_ROOT") {
        candidates.push(PathBuf::from(root));
    }
    if let Some(dir) = exe_dir() {
        candidates.push(dir);
    }
    candidates
        .into_iter()
        .find(|candidate| candidate.join("settings.json").is_file())
        .unwrap_or_else(|| repo_root.to_path_buf())
}

impl AppPaths {
    pub fn resolve() -> Self {
        let repo_root = resolve_repo_root();
        let data_root = resolve_data_root(&repo_root);
        let runtime_dir = data_root.join("runtime");
        let settings_path = data_root.join("settings.json");
        Self { repo_root, data_root, runtime_dir, settings_path }
    }

    /// A configured path is relative to the data root unless it is absolute.
    pub fn in_data_root(&self, configured: &str) -> PathBuf {
        let path = Path::new(configured);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.data_root.join(path)
        }
    }

    pub fn webview_data_dir(&self) -> PathBuf {
        self.runtime_dir.join("webview-data")
    }
}
