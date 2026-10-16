//! Audio endpoints, read straight from Windows (WASAPI) instead of starting
//! uv and Python on every refresh.
//!
//! The ids are the endpoint ids the Python `soundcard` package reports, so
//! `--system-device <id>` and `--mic-device <id>` match exactly. Render
//! endpoints are the loopback sources, as `soundcard` lists them.

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct AudioDevice {
    pub name: String,
    pub id: String,
    pub kind: &'static str,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceStatus {
    pub default_speaker: String,
    pub default_microphone: String,
    pub loopbacks: Vec<AudioDevice>,
    pub microphones: Vec<AudioDevice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Parses `record_audio.py --list-devices`, the fallback when WASAPI fails.
pub fn parse_python_listing(output: &str) -> AudioDeviceStatus {
    let mut status = AudioDeviceStatus::default();
    let mut pending: Option<AudioDevice> = None;
    let flush = |status: &mut AudioDeviceStatus, device: Option<AudioDevice>| {
        if let Some(device) = device {
            if device.kind == "loopback" {
                status.loopbacks.push(device);
            } else {
                status.microphones.push(device);
            }
        }
    };
    for line in output.lines() {
        if let Some(name) = line.strip_prefix("Default speaker:") {
            status.default_speaker = name.trim().to_string();
            continue;
        }
        if let Some(name) = line.strip_prefix("Default microphone:") {
            status.default_microphone = name.trim().to_string();
            continue;
        }
        let trimmed = line.trim_start();
        if let Some(id) = trimmed.strip_prefix("id:") {
            if let Some(device) = pending.as_mut() {
                device.id = id.trim().to_string();
            }
            continue;
        }
        let mut parts = trimmed.splitn(2, ' ');
        let (index, rest) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        if index.is_empty() || !index.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let kind = if rest.starts_with("[loopback]") {
            "loopback"
        } else if rest.starts_with("[mic]") {
            "mic"
        } else {
            continue;
        };
        flush(&mut status, pending.take());
        let name = rest.split_once(']').map_or("", |(_, name)| name).trim().to_string();
        pending = Some(AudioDevice { name, id: String::new(), kind });
    }
    flush(&mut status, pending.take());
    status
}

#[cfg(windows)]
pub fn list_native() -> Result<AudioDeviceStatus, String> {
    // COM is initialized per thread; run on a thread of our own.
    std::thread::spawn(wasapi::list).join().map_err(|_| "Audio device listing panicked".to_string())?
}

#[cfg(not(windows))]
pub fn list_native() -> Result<AudioDeviceStatus, String> {
    Err("Native audio device listing is only available on Windows".into())
}

#[cfg(windows)]
mod wasapi {
    use super::{AudioDevice, AudioDeviceStatus};
    use windows::core::Result as WinResult;
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::{
        eCapture, eConsole, eRender, EDataFlow, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
    };

    fn id(device: &IMMDevice) -> WinResult<String> {
        unsafe {
            let raw = device.GetId()?;
            let text = raw.to_string().unwrap_or_default();
            CoTaskMemFree(Some(raw.0 as _));
            Ok(text)
        }
    }

    fn name(device: &IMMDevice) -> WinResult<String> {
        unsafe {
            let store = device.OpenPropertyStore(STGM_READ)?;
            let value = store.GetValue(&PKEY_Device_FriendlyName)?;
            Ok(value.to_string())
        }
    }

    fn endpoints(enumerator: &IMMDeviceEnumerator, flow: EDataFlow, kind: &'static str) -> WinResult<Vec<AudioDevice>> {
        let mut devices = Vec::new();
        unsafe {
            let collection = enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)?;
            for index in 0..collection.GetCount()? {
                let device = collection.Item(index)?;
                devices.push(AudioDevice { name: name(&device)?, id: id(&device)?, kind });
            }
        }
        Ok(devices)
    }

    fn default_name(enumerator: &IMMDeviceEnumerator, flow: EDataFlow) -> String {
        unsafe { enumerator.GetDefaultAudioEndpoint(flow, eConsole) }
            .and_then(|device| name(&device))
            .unwrap_or_default()
    }

    fn read() -> WinResult<AudioDeviceStatus> {
        let enumerator: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
        Ok(AudioDeviceStatus {
            default_speaker: default_name(&enumerator, eRender),
            default_microphone: default_name(&enumerator, eCapture),
            loopbacks: endpoints(&enumerator, eRender, "loopback")?,
            microphones: endpoints(&enumerator, eCapture, "mic")?,
            error: None,
        })
    }

    pub fn list() -> Result<AudioDeviceStatus, String> {
        let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
        let result = read().map_err(|error| error.message().to_string());
        if initialized {
            unsafe { CoUninitialize() };
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_listing_is_parsed() {
        let output = "Default speaker: Speakers (Realtek)\nDefault microphone: Mic (USB)\n\nRecording devices:\n 0 [mic] Mic (USB)\n    id: {0.0.1.00000000}.{a}\n 1 [loopback] Speakers (Realtek)\n    id: {0.0.0.00000000}.{b}\n";
        let status = parse_python_listing(output);
        assert_eq!(status.default_speaker, "Speakers (Realtek)");
        assert_eq!(status.default_microphone, "Mic (USB)");
        assert_eq!(status.microphones.len(), 1);
        assert_eq!(status.microphones[0].id, "{0.0.1.00000000}.{a}");
        assert_eq!(status.loopbacks[0].name, "Speakers (Realtek)");
        assert_eq!(status.loopbacks[0].id, "{0.0.0.00000000}.{b}");
    }
}

#[cfg(all(test, windows))]
mod machine {
    /// Prints this machine's endpoints; compare with `record_audio.py --list-devices`.
    #[test]
    #[ignore = "reads this machine's audio devices"]
    fn print_native_listing() {
        let status = super::list_native().expect("WASAPI listing");
        println!("Default speaker: {}", status.default_speaker);
        println!("Default microphone: {}", status.default_microphone);
        for device in status.loopbacks.iter().chain(status.microphones.iter()) {
            println!("[{}] {} | {}", device.kind, device.name, device.id);
        }
    }
}
