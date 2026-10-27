# Proposal

## Why

The Tauri migration moved note persistence into Rust, but three data-loss windows remain: a window can close or the tray can quit before the renderer's last asynchronous `update_note` reaches the store; a transient read error is currently treated as an empty database and may be overwritten; and write failures are only logged to a stderr stream that release builds do not expose. These are silent-failure scenarios in an app whose only user data is the note database, so they must be closed before adding features.

## What Changes

- Add a close/quit handshake: intercept OS close requests, request a renderer flush, close only after acknowledgment, and use a bounded timeout fallback; apply the same flow to tray quit and `quit_app`.
- Make startup read errors safe: distinguish "file not found" from "file unreadable", enter a read-only/startup-error state on the latter, never create-and-save a welcome database over an unreadable file, and attempt a backup.
- Make write failures observable and recoverable: keep dirty state, retry with backoff, write structured logs to a file, expose save status to the UI, and prevent a silent quit when the final flush fails.
- Preserve the existing atomic `tmp → rename` write, 250 ms debounce, corrupt-JSON backup, legacy Electron import, and extra `.tmp` recovery behavior.
- Add regression coverage for immediate close, immediate tray quit, unreadable database, and failed write scenarios.

## Capabilities

### New Capabilities

- `note-persistence`: owns durable note storage, startup recovery, corrupt/unreadable database handling, debounced writes, close/quit flush guarantees, and user-visible persistence failures.

### Modified Capabilities

<!-- No existing main specs yet. -->

## Impact

- Rust: `src-tauri/src/store.rs` (load/error states, flush retry, logging, tests), `src-tauri/src/main.rs` (close/quit handshake, exit guard, window event handling).
- Frontend: `src/renderer.js` and `src/api.js` (flush acknowledgment protocol, save status), possibly `src/index.html`/`src/style.css` for a small status indicator.
- Tests/docs: `tests/MANUAL.md`, `tests/run-all.js` or new Rust tests, `TODO.md` checkboxes.
- Dependencies: possibly `tauri-plugin-log` (or a small file-logging module) for release-visible diagnostics; no `notes.json` schema change.
