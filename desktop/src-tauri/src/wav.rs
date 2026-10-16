//! Fixes the RIFF and data sizes of a PCM WAV whose writer stopped before
//! closing it (a killed recorder leaves zeros there and players see no audio).

use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

/// Returns `Ok(true)` when the header was rewritten, `Ok(false)` when it was
/// already right or the file is not a plain 44-byte-header PCM WAV.
pub fn repair_pcm_header(path: &Path) -> std::io::Result<bool> {
    if !path.is_file() {
        return Ok(false);
    }
    let size = path.metadata()?.len();
    if size <= 44 || size > u64::from(u32::MAX) {
        return Ok(false);
    }
    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let mut header = [0u8; 44];
    if file.read(&mut header)? != header.len() {
        return Ok(false);
    }
    let u32_at = |offset: usize| u32::from_le_bytes(header[offset..offset + 4].try_into().unwrap());
    let u16_at = |offset: usize| u16::from_le_bytes(header[offset..offset + 2].try_into().unwrap());
    if &header[0..4] != b"RIFF" || &header[8..12] != b"WAVE" || &header[12..16] != b"fmt " || &header[36..40] != b"data"
    {
        return Ok(false);
    }
    if u16_at(20) != 1 {
        return Ok(false);
    }
    let riff_size = (size - 8) as u32;
    let data_size = (size - 44) as u32;
    if u32_at(4) == riff_size && u32_at(40) == data_size {
        return Ok(false);
    }
    file.seek(SeekFrom::Start(4))?;
    file.write_all(&riff_size.to_le_bytes())?;
    file.seek(SeekFrom::Start(40))?;
    file.write_all(&data_size.to_le_bytes())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn header(riff: u32, data: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend(b"RIFF");
        bytes.extend(riff.to_le_bytes());
        bytes.extend(b"WAVEfmt ");
        bytes.extend(16u32.to_le_bytes());
        bytes.extend(1u16.to_le_bytes()); // PCM
        bytes.extend(1u16.to_le_bytes()); // mono
        bytes.extend(16_000u32.to_le_bytes());
        bytes.extend(32_000u32.to_le_bytes());
        bytes.extend(2u16.to_le_bytes());
        bytes.extend(16u16.to_le_bytes());
        bytes.extend(b"data");
        bytes.extend(data.to_le_bytes());
        bytes
    }

    #[test]
    fn unfinished_header_is_repaired_once() {
        let dir = std::env::temp_dir().join(format!("lmstt-wav-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("audio.wav");
        let mut bytes = header(0, 0);
        bytes.extend(vec![0u8; 3200]);
        fs::write(&path, &bytes).unwrap();

        assert!(repair_pcm_header(&path).unwrap());
        let fixed = fs::read(&path).unwrap();
        assert_eq!(u32::from_le_bytes(fixed[4..8].try_into().unwrap()), 3200 + 36);
        assert_eq!(u32::from_le_bytes(fixed[40..44].try_into().unwrap()), 3200);
        assert!(!repair_pcm_header(&path).unwrap());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn other_files_are_left_alone() {
        let dir = std::env::temp_dir().join(format!("lmstt-wav-other-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("notes.wav");
        fs::write(&path, vec![7u8; 100]).unwrap();
        assert!(!repair_pcm_header(&path).unwrap());
        assert_eq!(fs::read(&path).unwrap(), vec![7u8; 100]);
        fs::remove_dir_all(&dir).unwrap();
    }
}
