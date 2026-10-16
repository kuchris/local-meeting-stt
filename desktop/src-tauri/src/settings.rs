//! `settings.json`, shared with the earlier Electron shell.
//!
//! The UI owns the shape. This side only guarantees a file exists and that an
//! unreadable file is never overwritten with defaults.

use serde_json::{json, Value};
use std::fs;
use std::path::Path;

pub fn default_settings() -> Value {
    json!({
        "outputDir": "outputs",
        "qwen": { "chunkSeconds": 60, "tokens": 4096, "batch": 16 },
        "ui": { "locale": "en", "theme": "system" }
    })
}

pub fn read(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        let settings = default_settings();
        write(path, &settings)?;
        return Ok(settings);
    }
    let text = fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
    match serde_json::from_str::<Value>(&text) {
        Ok(value) if value.is_object() => Ok(value),
        // Keep the unreadable file aside before anything writes over it.
        _ => {
            let aside = path.with_extension("json.unreadable");
            let _ = fs::copy(path, &aside);
            Err(format!("{} could not be parsed; a copy was kept at {}", path.display(), aside.display()))
        }
    }
}

pub fn write(path: &Path, settings: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    // Write beside and rename, so a crash mid-write never leaves half a file.
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, format!("{text}\n")).map_err(|error| error.to_string())?;
    fs::rename(&temp, path).map_err(|error| error.to_string())
}
