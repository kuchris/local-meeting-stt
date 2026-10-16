//! Turns a live backend's stdout into caption lines.
//!
//! Ported from the Electron renderer (`electron` branch) so the UI only applies small updates: each
//! update says from which line the transcript changed, and what the unfinished
//! (partial) caption now reads.
//!
//! Backends speak three dialects:
//! - `@@PARTIAL\t<text>` / `@@FINAL\t<text>`: the Python live scripts (revisable previews).
//! - `[HH:MM:SS] text`: older live scripts; appended unless already shown.
//! - plain lines: the Vulkan loopback stream; every line is a hypothesis merged
//!   into the last few lines.

use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Line {
    pub time: String,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Update {
    /// The first line index that changed; lines from here on are replaced by `lines`.
    pub from: usize,
    pub lines: Vec<Line>,
    /// The caption still being recognized, or `None` when there is none.
    pub partial: Option<Line>,
}

/// What a stdout line turned out to be.
#[derive(Debug, PartialEq, Eq)]
pub enum Handled {
    /// A caption; the log does not need it.
    Caption,
    /// A loopback stream caption; logged with this text.
    CaptionLogged(String),
    /// The transcript file's path.
    TranscriptPath(String),
    /// Not a caption: log it as is.
    Log,
}

pub struct Captions {
    lines: Vec<Line>,
    partial: Option<Line>,
    loopback_stream: bool,
    dirty_from: Option<usize>,
    partial_dirty: bool,
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid caption regex"))
}

fn stamp_re() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    re(&CELL, r"^\[(\d{2}:\d{2}:\d{2})\]\s*")
}

fn stamped_line_re() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    re(&CELL, r"^\[\d{2}:\d{2}:\d{2}\]\s+")
}

pub fn normalize_japanese_spacing(text: &str) -> String {
    static KANA: OnceLock<Regex> = OnceLock::new();
    static BEFORE_PUNCT: OnceLock<Regex> = OnceLock::new();
    static AFTER_OPEN: OnceLock<Regex> = OnceLock::new();
    static SPACES: OnceLock<Regex> = OnceLock::new();
    let text = text.trim();
    let text = re(&KANA, r"([\x{3040}-\x{30ff}\x{3400}-\x{9fff}])\s+([\x{3040}-\x{30ff}\x{3400}-\x{9fff}])")
        .replace_all(text, "$1$2");
    let text = re(&BEFORE_PUNCT, r"\s+([\x{3001}\x{3002}\x{ff01}\x{ff1f}])").replace_all(&text, "$1");
    let text = re(&AFTER_OPEN, r"([\x{300c}\x{300e}\x{ff08}])\s+").replace_all(&text, "$1");
    re(&SPACES, r"\s+").replace_all(&text, " ").into_owned()
}

fn compact_transcript_key(text: &str) -> String {
    static PUNCT: OnceLock<Regex> = OnceLock::new();
    let normalized = normalize_japanese_spacing(text);
    re(
        &PUNCT,
        r#"[\s\x{3000}\x{3001}\x{3002}\x{ff01}\x{ff1f}.,!?'"`()\[\]{}<>\x{300c}\x{300d}\x{300e}\x{300f}\x{ff08}\x{ff09}\x{3010}\x{3011}]"#,
    )
    .replace_all(&normalized, "")
    .to_lowercase()
}

fn chars(text: &str) -> Vec<char> {
    text.chars().collect()
}

fn ends_starts_overlap(previous: &[char], incoming: &[char], size: usize) -> bool {
    previous[previous.len() - size..] == incoming[..size]
}

fn compact_overlap_length(previous: &str, incoming: &str) -> usize {
    let (previous, incoming) = (chars(previous), chars(incoming));
    let max = previous.len().min(incoming.len());
    (4..=max).rev().find(|&size| ends_starts_overlap(&previous, &incoming, size)).unwrap_or(0)
}

struct Merge {
    merged: String,
    same_phrase: bool,
}

fn merge_partial_text(previous: &str, incoming: &str) -> Merge {
    let current = normalize_japanese_spacing(previous);
    let next = normalize_japanese_spacing(incoming);
    if current.is_empty() {
        return Merge { merged: next, same_phrase: true };
    }
    if next.is_empty() {
        return Merge { merged: current, same_phrase: true };
    }
    if next.contains(&current) {
        return Merge { merged: next, same_phrase: true };
    }
    if current.contains(&next) {
        return Merge { merged: current, same_phrase: true };
    }
    let (a, b) = (chars(&current), chars(&next));
    let max = a.len().min(b.len());
    for size in (3..=max).rev() {
        if ends_starts_overlap(&a, &b, size) {
            let merged: String = a.iter().chain(b[size..].iter()).collect();
            return Merge { merged, same_phrase: true };
        }
        if ends_starts_overlap(&b, &a, size) {
            let merged: String = b.iter().chain(a[size..].iter()).collect();
            return Merge { merged, same_phrase: true };
        }
    }
    Merge { merged: next, same_phrase: false }
}

fn partial_looks_related(previous: &str, next: &str) -> bool {
    let a = normalize_japanese_spacing(previous);
    let b = normalize_japanese_spacing(next);
    if a.is_empty() || b.is_empty() || a.contains(&b) || b.contains(&a) {
        return true;
    }
    let compact_a: Vec<char> = a.chars().filter(|c| !c.is_whitespace()).collect();
    let compact_b: Vec<char> = b.chars().filter(|c| !c.is_whitespace()).collect();
    let (sa, sb): (String, String) = (compact_a.iter().collect(), compact_b.iter().collect());
    if sa.contains(&sb) || sb.contains(&sa) {
        return true;
    }
    let max = compact_a.len().min(compact_b.len());
    (4..=max).rev().any(|size| {
        ends_starts_overlap(&compact_a, &compact_b, size) || ends_starts_overlap(&compact_b, &compact_a, size)
    })
}

/// Collapses a unit of 2–24 characters repeated four or more times in a row
/// (`(.{n})\1{3,}` → `$1`), whisper's degenerate repetition loop.
fn collapse_repeats(text: &str) -> String {
    let mut current: Vec<char> = text.chars().collect();
    for unit in 2..=24 {
        let mut out = Vec::with_capacity(current.len());
        let mut i = 0;
        while i < current.len() {
            if i + unit * 4 <= current.len() {
                let pattern = &current[i..i + unit];
                if !pattern.contains(&'\n') {
                    let mut repeats = 1;
                    while i + unit * (repeats + 1) <= current.len()
                        && &current[i + unit * repeats..i + unit * (repeats + 1)] == pattern
                    {
                        repeats += 1;
                    }
                    if repeats >= 4 {
                        out.extend_from_slice(pattern);
                        i += unit * repeats;
                        continue;
                    }
                }
            }
            out.push(current[i]);
            i += 1;
        }
        current = out;
    }
    current.into_iter().collect()
}

pub fn clean_transcript_text(text: &str) -> String {
    let normalized = normalize_japanese_spacing(text);
    let collapsed = collapse_repeats(&normalized);
    if normalized.chars().count().saturating_sub(collapsed.chars().count()) > 120 {
        return String::new();
    }
    collapsed
}

pub fn is_hallucination_line(line: &str) -> bool {
    static BRACKETED: OnceLock<Regex> = OnceLock::new();
    let compact: String =
        line.chars().filter(|c| !c.is_whitespace() && !matches!(c, '、' | '。' | '！' | '？')).collect();
    if compact.is_empty() {
        return true;
    }
    const BLOCKED: [&str; 4] = [
        "ご視聴ありがとうございました",
        "ご視聴ありがとうございます",
        "チャンネル登録お願いします",
        "最後までご視聴いただきありがとうございました",
    ];
    if BLOCKED.contains(&compact.as_str()) {
        return true;
    }
    re(&BRACKETED, r"^[（(\[【].*(音楽|拍手|笑|BGM|ノイズ).*[)）\]】]$").is_match(line.trim())
}

fn only_punctuation(text: &str) -> bool {
    !text.is_empty() && text.chars().all(|c| matches!(c, '、' | '。' | '！' | '？' | '.' | ',' | '!' | '?'))
}

/// A line keeps the `[HH:MM:SS]` its backend printed, or takes `now`.
fn stamped(line: &str, now: &str) -> Option<Line> {
    let value = normalize_japanese_spacing(line);
    if value.is_empty() {
        return None;
    }
    if let Some(found) = stamp_re().captures(&value) {
        let text = value[found.get(0).map_or(0, |m| m.end())..].to_string();
        return Some(Line { time: found[1].to_string(), text });
    }
    Some(Line { time: now.to_string(), text: value })
}

impl Captions {
    pub fn new(loopback_stream: bool) -> Self {
        Self { lines: Vec::new(), partial: None, loopback_stream, dirty_from: None, partial_dirty: false }
    }

    fn mark(&mut self, from: usize) {
        self.dirty_from = Some(self.dirty_from.map_or(from, |current| current.min(from)));
    }

    fn set_partial(&mut self, partial: Option<Line>) {
        if self.partial != partial {
            self.partial = partial;
            self.partial_dirty = true;
        }
    }

    fn push(&mut self, line: Line) {
        self.mark(self.lines.len());
        self.lines.push(line);
    }

    fn replace_tail(&mut self, start: usize, line: Line) {
        if self.lines.len() == start + 1 && self.lines[start] == line {
            return;
        }
        self.lines.truncate(start);
        self.mark(start);
        self.lines.push(line);
    }

    fn rendered(&self) -> String {
        self.lines.iter().map(|line| format!("[{}] {}\n", line.time, line.text)).collect()
    }

    fn append_preview_line(&mut self, line: &str, now: &str) {
        let value = normalize_japanese_spacing(line);
        let Some(next) = stamped(&value, now) else { return };
        let rendered = self.rendered();
        if rendered.contains(&value) || rendered.contains(&format!("[{}] {}", next.time, next.text)) {
            return;
        }
        self.push(next);
    }

    fn append_or_merge_final_line(&mut self, line: &str, now: &str) {
        let Some(stamped_value) = stamped(line, now) else { return };
        let value = normalize_japanese_spacing(&stamped_value.text);
        if value.is_empty() || is_hallucination_line(&value) || only_punctuation(&value) {
            return;
        }
        if self.lines.is_empty() {
            self.push(stamped_value);
            return;
        }
        let value_key = compact_transcript_key(&value);
        let lookback = self.lines.len().min(4);
        for count in (1..=lookback).rev() {
            let start = self.lines.len() - count;
            let joined: String = self.lines[start..].iter().map(|line| line.text.as_str()).collect();
            let tail = normalize_japanese_spacing(&joined);
            if tail.is_empty() {
                continue;
            }
            if tail == value || tail.contains(&value) {
                return;
            }
            if value.contains(&tail) {
                self.replace_tail(start, stamped_value);
                return;
            }
            let tail_key = compact_transcript_key(&tail);
            if !tail_key.is_empty() && !value_key.is_empty() {
                if tail_key.contains(&value_key) {
                    return;
                }
                if value_key.contains(&tail_key) {
                    self.replace_tail(start, stamped_value);
                    return;
                }
                let overlap = compact_overlap_length(&tail_key, &value_key);
                let shorter = tail_key.chars().count().min(value_key.chars().count());
                if overlap >= 8 || overlap >= (shorter as f64 * 0.45).floor() as usize {
                    self.replace_tail(start, stamped_value);
                    return;
                }
            }
            let merge = merge_partial_text(&tail, &value);
            if merge.same_phrase || partial_looks_related(&tail, &value) {
                if let Some(line) = stamped(&merge.merged, now) {
                    self.replace_tail(start, line);
                }
                return;
            }
        }
        self.push(stamped_value);
    }

    fn commit_loopback_line(&mut self, line: &str, now: &str) {
        let value = clean_transcript_text(line);
        if value.is_empty() || is_hallucination_line(&value) {
            return;
        }
        self.append_or_merge_final_line(&value, now);
    }

    fn commit_utterance_line(&mut self, line: &str, now: &str) {
        let value = clean_transcript_text(line);
        if value.is_empty() || is_hallucination_line(&value) {
            return;
        }
        if let Some(line) = stamped(&value, now) {
            self.push(line);
        }
    }

    /// Reads one stdout line (ANSI codes already stripped). `now` is `HH:MM:SS`.
    pub fn ingest_line(&mut self, raw: &str, now: &str) -> Handled {
        static TRANSCRIPT: OnceLock<Regex> = OnceLock::new();
        if let Some(found) = re(&TRANSCRIPT, r"Transcript:\s*(.+)").captures(raw) {
            return Handled::TranscriptPath(found[1].trim().to_string());
        }
        let line = raw.trim_start();
        if let Some(text) = line.strip_prefix("@@PARTIAL\t") {
            let partial = stamped(&clean_transcript_text(text), now);
            self.set_partial(partial);
            return if self.loopback_stream {
                Handled::CaptionLogged(format!("preview: {text}"))
            } else {
                Handled::Caption
            };
        }
        if let Some(text) = line.strip_prefix("@@FINAL\t") {
            let final_text = clean_transcript_text(text);
            self.set_partial(None);
            if self.loopback_stream {
                self.commit_loopback_line(&final_text, now);
                return Handled::CaptionLogged(format!("final: {text}"));
            }
            self.commit_utterance_line(&final_text, now);
            return Handled::Caption;
        }
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Handled::Log;
        }
        if self.loopback_stream {
            self.commit_loopback_line(trimmed, now);
            return Handled::CaptionLogged(trimmed.to_string());
        }
        if stamped_line_re().is_match(trimmed) {
            self.append_preview_line(trimmed, now);
            return Handled::Caption;
        }
        Handled::Log
    }

    /// The change since the last call, if anything changed.
    pub fn take_update(&mut self) -> Option<Update> {
        if self.dirty_from.is_none() && !self.partial_dirty {
            return None;
        }
        let from = self.dirty_from.take().unwrap_or(self.lines.len()).min(self.lines.len());
        self.partial_dirty = false;
        Some(Update { from, lines: self.lines[from..].to_vec(), partial: self.partial.clone() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "10:00:00";

    fn texts(captions: &Captions) -> Vec<&str> {
        captions.lines.iter().map(|line| line.text.as_str()).collect()
    }

    #[test]
    fn spacing_between_japanese_characters_is_removed() {
        assert_eq!(normalize_japanese_spacing("  今日は 良い 天気 。 "), "今日は良い天気。");
        // Matches are non-overlapping, as in the Electron renderer's regex: the
        // space after a joined pair survives.
        assert_eq!(normalize_japanese_spacing("  今日 は  良い 天気 。 "), "今日は 良い天気。");
        assert_eq!(normalize_japanese_spacing("「 はい"), "「はい");
        assert_eq!(normalize_japanese_spacing("hello   world"), "hello world");
    }

    #[test]
    fn repetition_loops_collapse() {
        assert_eq!(collapse_repeats("あのあのあのあのあの"), "あの");
        assert_eq!(collapse_repeats("あのあのあの"), "あのあのあの");
        assert_eq!(collapse_repeats("はいはいはいはい、そうです"), "はい、そうです");
    }

    #[test]
    fn long_degenerate_output_is_dropped() {
        let looped = "ありがとう".repeat(40);
        assert_eq!(clean_transcript_text(&looped), "");
    }

    #[test]
    fn hallucinations_are_recognized() {
        assert!(is_hallucination_line("ご視聴ありがとうございました。"));
        assert!(is_hallucination_line("（拍手）"));
        assert!(is_hallucination_line("[音楽]"));
        assert!(is_hallucination_line(" 。 "));
        assert!(!is_hallucination_line("今日の議題は三つです。"));
    }

    #[test]
    fn partial_then_final_commits_one_line() {
        let mut captions = Captions::new(false);
        assert_eq!(captions.ingest_line("@@PARTIAL\t今日の議題", NOW), Handled::Caption);
        let update = captions.take_update().unwrap();
        assert_eq!(update.partial.unwrap().text, "今日の議題");
        assert!(update.lines.is_empty());

        captions.ingest_line("@@FINAL\t今日の議題は三つです。", "10:00:02");
        let update = captions.take_update().unwrap();
        assert_eq!(update.from, 0);
        assert_eq!(update.lines, vec![Line { time: "10:00:02".into(), text: "今日の議題は三つです。".into() }]);
        assert_eq!(update.partial, None);
        assert!(captions.take_update().is_none());
    }

    #[test]
    fn empty_partial_clears_preview() {
        let mut captions = Captions::new(false);
        captions.ingest_line("@@PARTIAL\tはい", NOW);
        captions.take_update();
        captions.ingest_line("@@PARTIAL\t", NOW);
        assert_eq!(captions.take_update().unwrap().partial, None);
    }

    #[test]
    fn hallucinated_final_is_not_committed() {
        let mut captions = Captions::new(false);
        captions.ingest_line("@@FINAL\tご視聴ありがとうございました", NOW);
        assert!(captions.lines.is_empty());
    }

    #[test]
    fn stamped_lines_keep_their_time_and_skip_repeats() {
        let mut captions = Captions::new(false);
        assert_eq!(captions.ingest_line("[09:59:58] こんにちは", NOW), Handled::Caption);
        assert_eq!(captions.ingest_line("[09:59:58] こんにちは", NOW), Handled::Caption);
        assert_eq!(captions.lines, vec![Line { time: "09:59:58".into(), text: "こんにちは".into() }]);
    }

    #[test]
    fn transcript_path_and_logs_are_reported() {
        let mut captions = Captions::new(false);
        assert_eq!(
            captions.ingest_line("Transcript: outputs\\live\\live_transcript.txt", NOW),
            Handled::TranscriptPath("outputs\\live\\live_transcript.txt".into())
        );
        assert_eq!(captions.ingest_line("Loading model small", NOW), Handled::Log);
    }

    #[test]
    fn loopback_hypotheses_merge_into_the_last_line() {
        let mut captions = Captions::new(true);
        captions.ingest_line("今日の会議を", NOW);
        captions.ingest_line("今日の会議を始めます", "10:00:01");
        assert_eq!(texts(&captions), vec!["今日の会議を始めます"]);
        let update = captions.take_update().unwrap();
        assert_eq!(update.from, 0);
        assert_eq!(update.lines.len(), 1);

        captions.ingest_line("まず予算について話します", "10:00:05");
        assert_eq!(texts(&captions), vec!["今日の会議を始めます", "まず予算について話します"]);
        assert_eq!(captions.take_update().unwrap().from, 1);
    }

    #[test]
    fn loopback_lines_already_shown_are_ignored() {
        let mut captions = Captions::new(true);
        captions.ingest_line("今日の会議を始めます", NOW);
        captions.take_update();
        assert_eq!(captions.ingest_line("会議を始めます", NOW), Handled::CaptionLogged("会議を始めます".into()));
        assert!(captions.take_update().is_none());
    }

    #[derive(serde::Deserialize)]
    struct ParityCase {
        name: String,
        loopback: bool,
        steps: Vec<String>,
        expected: ParityExpected,
    }

    #[derive(serde::Deserialize)]
    struct ParityExpected {
        lines: Vec<String>,
        partial: String,
    }

    /// The fixture's `expected` was produced by running the Electron renderer's
    /// own caption functions (electron_app/src/main.tsx on the `electron` branch) on the same steps.
    #[test]
    fn matches_the_electron_renderer() {
        let cases: Vec<ParityCase> = serde_json::from_str(include_str!("../fixtures/caption_parity.json")).unwrap();
        assert!(cases.len() >= 9);
        for case in cases {
            let mut captions = Captions::new(case.loopback);
            for (index, step) in case.steps.iter().enumerate() {
                captions.ingest_line(step, &format!("10:00:{index:02}"));
            }
            let lines: Vec<String> =
                captions.lines.iter().map(|line| format!("[{}] {}", line.time, line.text)).collect();
            assert_eq!(lines, case.expected.lines, "lines: {}", case.name);
            let partial =
                captions.partial.as_ref().map(|line| format!("[{}] {}", line.time, line.text)).unwrap_or_default();
            assert_eq!(partial, case.expected.partial, "partial: {}", case.name);
        }
    }

    #[test]
    fn loopback_control_lines_are_logged_with_their_kind() {
        let mut captions = Captions::new(true);
        assert_eq!(captions.ingest_line("@@PARTIAL\tはい", NOW), Handled::CaptionLogged("preview: はい".into()));
        assert_eq!(captions.ingest_line("@@FINAL\tはい", NOW), Handled::CaptionLogged("final: はい".into()));
    }
}
