# Design

## Context

See `proposal.md` for motivation. The current implementation has three persistence layers that interact: the renderer queues edits through `window.memoAPI.updateNote`, the Rust `Store` keeps an in-memory `Db` with a 250 ms debounce and atomic `tmp → rename`, and window lifecycle code flushes the store on `CloseRequested` / quit. The missing piece is a protocol between the webview and the Rust window lifecycle: Rust currently assumes every edit has already crossed IPC when a window is destroyed.

Existing constraints:

- `notes.json` has no schema version; the change must remain backward compatible.
- The app is tray-resident and uses `skip_taskbar`, so an off-screen or silently exited app is hard to recover.
- Release builds use `windows_subsystem = "windows"`; stderr is not visible.
- Tauri commands and window operations are dispatched through the main event loop; blocking that loop while waiting for a renderer would deadlock.

## Goals / Non-Goals

**Goals:**

- Establish a request/acknowledgment flush protocol for window close and application quit.
- Make every persistence failure observable to the user and to a durable log.
- Never overwrite an existing database that could not be read.
- Keep existing storage behavior and data format unchanged.
- Add regression tests for the new lifecycle and error paths.

**Non-Goals:**

- Replacing `notes.json` with SQLite or adding multi-device sync.
- Changing note/page semantics or the JSON schema.
- Implementing autosave UI redesign beyond a compact status indicator.
- Guaranteeing that edits survive an external process kill or power loss mid-write; the atomic write keeps the file intact, but unflushed edits may be lost.
- Solving unrelated UI/accessibility findings from `TODO.md` P1/P2.

## Decisions

### 1. Close/quit uses an explicit flush request and acknowledgment

Rust tracks at most one pending flush per window (a boolean plus a generation counter). On `WindowEvent::CloseRequested`:

1. If a flush is already pending, prevent the close and return.
2. Otherwise, prevent the close, bump the generation, and emit `miao://flush-before-close` with that generation.
3. The renderer listens for the event, awaits its existing `saveChain` (or sends a final `update_note` snapshot), then invokes `flush_ack` with the generation it observed.
4. Rust clears the pending flag, applies the empty-note cleanup **only after acknowledgment**, flushes the store, and closes the window.
5. A timeout task (about 1.5 s) closes the window without deleting the note, records the timeout in the log or store health event, and marks the note as possibly unsaved.

Tray quit and in-app quit use the same event with a different purpose (`miao://flush-before-quit`). A quit coordinator emits to every open window, collects `flush_ack` responses, then flushes the store and sets the quitting flag before `app.exit(0)`. If any window times out or the final flush fails, the coordinator shows a native dialog offering "retry" and "quit without saving"; it does not silently exit.

**Why not wait synchronously on the main thread?** Tauri window events and commands run through the event loop; blocking it would prevent the renderer's acknowledgment from being processed. The coordinator uses `tauri::async_runtime::spawn` plus a channel/condvar and only touches windows from the main-thread dispatcher.

**Alternative considered:** Removing empty-note cleanup entirely. That avoids the delete race but leaves blank notes forever and does not solve the last-edit loss. The handshake addresses both.

### 2. Read errors become a first-class startup state

`load_db_from_disk` returns an explicit outcome:

```text
LoadOutcome {
  db,
  needs_save,
  skipped_notes,
  backup_path,
  read_error: Option<String>,
  safe_to_write: bool,
}
```

- `NotFound` → empty database, safe to write, normal welcome-note initialization.
- Parse/structure error → existing backup behavior, empty database, safe to write.
- Other read errors → `safe_to_write = false`, no welcome note is persisted, original file is untouched, and the error is surfaced.
- The store exposes a `read_only` flag; `flush_now` returns a typed error while it is set.
- Startup shows a native error dialog with the path and a "retry" action. If retry still fails, the application exits without writing; no read-only viewer mode is introduced.

### 3. Write failures use a health state, backoff, and file logging

The store publishes a `StoreHealth` snapshot:

```text
StoreHealth { dirty, last_success, last_error, retry_count }
```

- The debounce worker retries with bounded exponential backoff (250 ms, 1 s, 5 s, 30 s cap) while the generation is unchanged.
- A successful write clears `dirty` and publishes a saved event.
- A failed write keeps `dirty`, publishes an error event, and writes a structured log entry (no note content).
- `flush_now` returns the error; close/quit coordinators treat it as a failure and show a confirmation dialog.
- The renderer shows a compact status: saving, saved, or save failed. On failure it offers retry.

**Logging choice:** use `tauri-plugin-log` with a file target in the app log directory. This is preferred over a custom logger because it handles rotation, log levels, and Windows paths; the plugin's global API is not exposed to the frontend. If the dependency is undesirable, a small `std::fs` logger with a rotating file is the fallback.

**Dialog choice:** use `tauri-plugin-dialog` for native error/quit-confirmation dialogs. A custom HTML modal would also work but duplicates blocking-dialog behavior and adds another window lifecycle to maintain. The plugin is the v1 choice; an in-app modal is only a fallback if the extra capability surface becomes a blocker.

### 4. Close-time empty-note deletion is gated by the flush acknowledgment

The current `CloseRequested` handler calls `remove_if_empty` immediately. It will instead:

- On the custom close path, the renderer calls `close_window` after `flushPendingSave`; Rust removes empty notes as today.
- On the OS close path, Rust waits for `flush_ack`; only then does it call `remove_if_empty`.
- On timeout, Rust closes the window without deleting the note, preserving the possibility of recovery from `notes.json`.

This keeps the existing empty-note cleanup for intentional closes while making the OS path conservative.

### 5. Tests exercise the protocol, not just the store

- Rust unit tests cover read-error classification, read-only behavior, write retry, timeout state transitions, and gated empty-note deletion.
- The coordinator accepts an injectable timeout/clock and an acknowledgment channel, so lifecycle tests do not require a real webview.
- Manual GUI cases cover Alt+F4 and tray quit immediately after typing, with disk inspection as the oracle.
- The existing manual checklist's 1-second wait is replaced by an immediate action.

## Risks / Trade-offs

- **Close latency** → A close or quit can take up to the timeout (about 1.5 s). Mitigation: use a short timeout, show a "saving" state, and keep the timeout configurable in one constant.
- **Renderer unresponsive** → The timeout closes the window and retains the note; the last edit may still be lost. Mitigation: log the event, keep the note, and document that a hung renderer cannot be force-flushed.
- **Quit blocking** → A persistent write failure would block quit. Mitigation: show a native dialog with "retry" and an explicit "quit without saving" option; never make the user unable to exit.
- **Additional dependencies** → `tauri-plugin-log` and `tauri-plugin-dialog` add capability/config surface. Mitigation: keep permissions minimal and initialize them in one place; both are official Tauri plugins.
- **Double close/event storms** → Repeated Alt+F4 can emit multiple close events. Mitigation: per-window pending request ids; subsequent events are ignored while pending.
- **Read-only ambiguity** → A transient read error could put the app in read-only mode. Mitigation: offer retry; only persist after a successful read; never create a welcome note over the file.

## Migration Plan

1. Add the new load outcome/read-only state and tests; no data format migration.
2. Add the flush event/ack command and coordinator behind the existing custom close path first.
3. Wire OS close and tray quit to the coordinator; update the manual checklist.
4. Add logging/dialog plugins and expose store health to the renderer.
5. Release build and run the P0 regression cases; rollback is a code revert because `notes.json` is unchanged.

## Open Questions

None. The save-status indicator defaults to a compact footer status; the dialog and log plugins are the v1 choices per Decisions 2 and 3.
