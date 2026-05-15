# Local Meeting STT Design

## Direction

Fixed desktop operator panel for local audio/STT work. The app should feel clean and utilitarian, with a Cal.com-like grayscale palette instead of a colorful developer console.

References:
- Cal.com colors: grayscale brand, strong black/white contrast, sparse color use.
- Warp DESIGN.md: compact controls and terminal-style output areas.
- Linear DESIGN.md: hairline borders and dense product UI.
- ElevenLabs DESIGN.md: transcript/audio context and quiet voice-product mood.

## Tokens

- Canvas: `#ffffff`
- Surface: `#ffffff`
- Surface soft: `#f8f9fa`
- Hairline: `#e5e7eb`
- Ink: `#111111`
- Body: `#374151`
- Muted: `#6b7280`
- Error: `#b42318`

## Rules

- Keep the interface compact and scan-friendly.
- Use a fixed desktop layout; resizing the window should not rearrange the major regions.
- Keep navigation in the sidebar, controls in the left work panel, output/logs in the right work panel.
- The sidebar may collapse, but it should remain visible as a compact icon rail rather than disappearing.
- Prefer grayscale surfaces, hairline borders, and monospace transcript/log areas.
- Use compact icon buttons for repeated utility actions such as refresh, open folder, and device chooser.
- Device selection should keep the readable device name in the row text and use a small chooser icon on the right.
- Avoid decorative cards, marketing hero sections, and large empty whitespace.
