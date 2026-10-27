# Tasks

## 1. Read-only startup protection

- [x] 1.1 Extend `LoadOutcome` with `read_error` and `safe_to_write`; classify `NotFound`, parse/structure errors, and all other read errors differently. Verify with Rust unit tests for a missing file, corrupt JSON, and a path that exists but cannot be read.
- [x] 1.2 Add a read-only/startup-error state to `Store`; make `flush_now` refuse to write while it is set and make `migrate_db` skip welcome-note creation on fatal read errors. Verify `cargo test --manifest-path src-tauri/Cargo.toml` covers "unreadable file is not overwritten".
- [x] 1.3 Add the startup error dialog with the database path and a retry action using `tauri-plugin-dialog`, and write the same error to the application log. Verify manually by starting with an unreadable `notes.json` and confirming the original bytes are unchanged.
- [x] 1.4 Add the read-error scenario to `tests/MANUAL.md` with an explicit on-disk oracle. Verify the checklist names the file, action, and expected unchanged content.

## 2. Observable and retryable writes

- [x] 2.1 Add `tauri-plugin-log` with a file target in the application log directory; replace persistence `eprintln!` calls with structured log entries that exclude note content. Verify the log file is created and contains a flush-failure entry after a simulated failure.
- [x] 2.2 Implement bounded exponential-backoff retries for the debounce worker and keep `dirty` set until a write succeeds. Verify with unit tests that a transient failure is retried and a successful retry clears dirty.
- [x] 2.3 Add a `StoreHealth` snapshot (`dirty`, `last_success`, `last_error`, `retry_count`) and expose it to the frontend through a command and an event. Verify the frontend receives an error event when the store cannot write.
- [x] 2.4 Add a compact save-status indicator (saving / saved / save failed) to the renderer, with a retry action on failure. Verify manually that a failed write is visible and that a successful retry returns the indicator to saved.
- [x] 2.5 Add a Rust test that points the database path at a location whose parent is a regular file (deterministic `ENOTDIR` on Windows) and confirms `flush_now` returns an error, the in-memory edit is retained, and `notes.json` is unchanged.

## 3. Close and quit flush protocol

- [x] 3.1 Add the `miao://flush-before-close` event and `flush_ack` command; track per-window request ids and ignore duplicate close requests while a flush is pending. Verify with a unit-tested coordinator state machine and a manual Alt+F4 test.
- [x] 3.2 Change `CloseRequested` to prevent close, request a flush, and gate empty-note deletion on acknowledgment. Verify that typing into an empty note and immediately pressing Alt+F4 retains both the note and the text.
- [x] 3.3 Add the quit coordinator for both tray quit and the in-app quit action: emit a flush request to every open window, collect acknowledgments, flush the store, then set the quitting flag and exit. Verify that typing and immediately quitting (tray or in-app) retains the text.
- [x] 3.4 Add a bounded timeout (about 1.5 s) and a "quit without saving" confirmation when a window does not acknowledge or the final flush fails on either quit path. Verify with a deliberately blocked renderer that the app logs the timeout, retains the note, and does not silently exit.
- [x] 3.5 Listen for the flush events in `src/renderer.js`, await the existing save chain, and acknowledge only after the final snapshot is sent. Verify the custom close button still closes promptly and the flush test marker is on disk.

## 4. Regression, documentation, and release check

- [x] 4.1 Add Rust tests for read-error classification, read-only writes, retry/backoff, timeout transitions, and gated empty-note deletion. Verify `npm run test:rust` is green.
- [x] 4.2 Update `tests/MANUAL.md` to make Alt+F4 and tray-quit cases immediate (no one-second wait) and to inspect `notes.json` for the exact marker. Verify every case names its disk oracle.
- [x] 4.3 Run `npm test`, `cargo fmt --check`, and `npm run build`; verify the release installer is produced. Run the immediate Alt+F4, immediate tray-quit, unreadable-database, and read-only-write scenarios against the release build.
