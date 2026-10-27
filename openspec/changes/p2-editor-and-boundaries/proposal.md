# Proposal

## Why

The core note flow is usable, but the editor still has correctness and usability gaps (`***bold italic***` nesting, no way to exit an empty list item, Shift+Enter hijacked, Tab cannot indent, title extraction removes hyphens), small UI states are misleading (near-invisible preview scrollbar, placeholder page count), corrupted-but-valid data is not deduplicated, and the NSIS installer depends on downloading the WebView2 bootstrapper. These are lower-severity than P0/P1 but directly affect day-to-day note taking and first-install reliability.

## What Changes

- Fix inline emphasis parsing so `***text***` produces correctly nested bold+italic output, and add regression cases for mixed emphasis.
- Add list-editing behavior: Enter on an empty list item exits the list; Shift+Enter inserts a line break instead of a new item; Tab/Shift+Tab indents/outdents list items.
- Preserve hyphens in extracted titles so dates and hyphenated words are not mangled.
- Make preview checkbox interaction stable when rendered line numbers and current text diverge.
- Improve light-theme preview scrollbar contrast and replace the initial `2 / 2` placeholder with a real loading/error state when note data is unavailable.
- Harden data resilience: deduplicate note ids on load, add a schema version, rotate/prune corruption backups, and handle mutex poisoning/worker death without silently stopping scheduled writes.
- Make the WebView2 install mode explicit — an offline-capable variant or a documented network requirement — and run a release version check per the baseline development spec; document the signing/update posture.

## Capabilities

### New Capabilities

- `note-editor`: covers Markdown inline parsing, list continuation/exit/indentation, title extraction, and checkbox interaction mapping.
- `ui-polish`: covers small visual/state details that affect trust in the note UI, including preview scrollbars and missing-note/loading states.
- `data-resilience`: covers duplicate-id repair, schema versioning, backup retention, and degraded store-worker behavior; complements `note-persistence` from P0 without changing the `notes.json` data contract.
- `release-packaging`: covers the WebView2 install mode, installer language/experience, and the documented signing/update posture.

### Modified Capabilities

<!-- No existing main specs yet; note-persistence is introduced by p0-data-safety. -->

## Impact

- Frontend: `src/renderer.js`, `src/noteUtils.js`, `src/style.css`, `src/index.html`, `src/api.js`.
- Rust: `src-tauri/src/store.rs` (dedupe, schema version, backup rotation, worker health), `src-tauri/src/main.rs` if worker health is surfaced.
- Build: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json`, possibly a small version-sync script.
- Tests/docs: `tests/test-title-extract.js`, new renderer/Markdown tests if a DOM harness exists, Rust store tests, `tests/MANUAL.md`, `TODO.md`.
- No change to the `notes.json` shape beyond an optional version field; old files must remain readable.
