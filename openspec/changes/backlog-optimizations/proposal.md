# Proposal

## Why

The current implementation is functional but carries avoidable cost: every keystroke sends the full page array through IPC and queues a save snapshot, window operations spawn a thread per action, geometry events update the store on every move/resize, the window and store code live in two large files, and there is no CI/clippy/e2e gate. These do not block normal use, but they increase latency, race surface, and maintenance cost as the app grows. This backlog is intentionally non-blocking and should be scheduled after the P0/P1 correctness work.

## What Changes

- Add latest-wins save coalescing and a page-scoped update command for ordinary edits; keep full-page updates for structural changes (add/delete/reorder pages).
- Throttle window geometry persistence to reduce lock/channel traffic during drag and resize.
- Introduce a serialized window manager (single command queue or actor) for create/close/always-on-top, show windows after page load, and avoid thread-per-operation.
- Add a "manage notes" surface for "show all" so a large note set does not open dozens of windows at once.
- Plan optional visual enhancements: dark mode, reduced-motion support, theme-aware menus, and a real Windows acrylic mode evaluated behind a setting/flag.
- Split `main.rs`/`store.rs` into focused modules and remove dead code/duplicated constants.
- Add quality gates: `cargo clippy -- -D warnings`, `cargo fmt --check`, JS lint, CI on Windows, dependency audit, and an optional `tauri-driver` e2e harness.
- Extend test coverage for persistence, window placement, renderer state machines, and release packaging.

## Capabilities

### New Capabilities

- `performance`: covers save-request coalescing, page-scoped updates, geometry throttling, and measurable IPC/main-thread cost.
- `engineering-quality`: covers serialized window operations, module boundaries, static analysis/CI gates, dependency auditing, and e2e/scripted release checks.
- `product-experience`: covers note-set management, optional dark mode/reduced motion, and the real-acrylic decision.

### Modified Capabilities

<!-- No existing main specs yet; note-persistence, window-lifecycle, note-interaction, and ipc-security are introduced by earlier changes. -->

## Impact

- Frontend: `src/renderer.js`, `src/api.js`, `src/index.html`, `src/style.css` (save protocol, geometry, manage-notes surface, optional visual modes).
- Rust: `src-tauri/src/main.rs`, `src-tauri/src/store.rs`, new `window_manager.rs`/`commands.rs`/`tray.rs`/`monitor.rs` modules, `Cargo.toml` if clippy/e2e tooling is added.
- Build/CI: new scripts, `.github/workflows` or equivalent, optional `tauri-driver`, optional `window-vibrancy` dependency for real acrylic.
- No `notes.json` schema change is required; the save protocol remains backward compatible.
- This change is explicitly non-blocking and may be split into independent follow-up changes.
