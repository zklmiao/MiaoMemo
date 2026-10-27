# Tasks

## 1. Save protocol performance

- [ ] 1.1 Add an `update_page` command that updates one page atomically and leaves other pages unchanged; verify with Rust tests for title/content updates and out-of-range indices.
- [ ] 1.2 Switch ordinary renderer edits to `update_page` and keep `update_note` for structural/page-index/color/pin changes; verify a large note edit only sends the affected page.
- [ ] 1.3 Replace the promise-chain save queue with a latest-wins queue (one in-flight, one pending snapshot, structural barriers); verify fast typing and interleaved add/delete page tests persist the final state.
- [ ] 1.4 Add a performance regression test that fails if a normal edit sends the full page list or if an older snapshot overwrites a newer one; verify the test observes payload shape/order.

## 2. Geometry throttling

- [ ] 2.1 Add a per-window 100 ms geometry throttle and capture the final bounds on close/quit before the final flush; verify a simulated burst stays within the update bound.
- [ ] 2.2 Verify drag/resize followed by immediate quit persists the final coordinates and size in `notes.json`.
- [ ] 2.3 Add the geometry burst/quit case to the manual checklist; verify the on-disk coordinates match the final window state.

## 3. Serialized window manager

- [ ] 3.1 Implement a `WindowManager` command queue/worker for create/close/show-all/pin/quit and route existing call sites through it; verify repeated show-all and rapid create produce exactly one window per note.
- [ ] 3.2 Remove thread-per-operation creation/close/pin paths and keep window creation off the main thread's blocking path; verify no regression in open/close latency or close flush behavior.
- [ ] 3.3 Add a window-manager error/health signal; verify a failed create is logged and does not leave an invisible note without feedback.
- [ ] 3.4 Add Rust tests for the manager queue ordering/idempotence (using a test double for the native window handle); verify ordered create/close/pin states.

## 4. Note-management surface

- [ ] 4.1 Add a `list_notes` command returning id/title/color/pinned metadata without full content; verify it returns all persisted notes and no page content.
- [ ] 4.2 Add a management window listing notes and opening/focusing one on selection; verify twenty stored notes produce one management window, not twenty note windows.
- [ ] 4.3 Keep an explicit "open all" secondary action and verify it still routes through the window manager; verify the manager remains usable after opening a note.
- [ ] 4.4 Apply the local-only navigation policy to the management window and verify external navigation is rejected.
- [ ] 4.5 Add manual cases for management list, focus/open, and large note sets; verify note windows and `notes.json` are unchanged by listing.

## 5. Optional visual modes

- [ ] 5.1 Add `prefers-reduced-motion` CSS overrides and verify decorative transitions are removed while focus/status remain visible.
- [ ] 5.2 Add an opt-in dark appearance with CSS variable overrides and a persisted preference; verify all six themes, menus, and dialogs remain legible after restart.
- [ ] 5.3 Run a real-acrylic spike using Tauri effects or `window-vibrancy` behind a flag; verify a supported machine uses the native material and an unsupported/failed case falls back to the existing CSS without a black window.
- [ ] 5.4 Add visual-mode manual cases to `tests/MANUAL.md`; verify reduced motion, dark contrast, and acrylic fallback are recorded.

## 6. Engineering quality and CI

- [ ] 6.1 Split window/tray/command/monitor code out of `main.rs` (and store modules if useful) without behavior changes; verify the full test suite and a release build still pass.
- [ ] 6.2 Add `cargo fmt --check`, `cargo clippy -- -D warnings`, and JS lint scripts; verify they fail on a deliberate warning/lint violation and pass on the current tree.
- [ ] 6.3 Add a Windows CI workflow running npm install/test, Rust fmt/clippy/test, and a release build; verify the workflow is documented and reproducible locally.
- [ ] 6.4 Add dependency audit (`cargo audit`, `npm audit --omit=dev`) to the release checklist or schedule; verify a known advisory blocks or is documented.
- [ ] 6.5 Run the public command/`memoAPI` inventory required by the baseline `project-development` dead-command rule; remove or document any unused surface and verify `deleteNote` is wired by P1.
- [ ] 6.6 Add an optional `tauri-driver` e2e smoke test for create/edit/close/reopen; if it cannot run reliably on Windows, document the scripted manual gate instead.

## 7. Integration and release check

- [ ] 7.1 Run `npm test`, `cargo fmt --check`, `cargo clippy -- -D warnings`, and a release build; verify all gates are green.
- [ ] 7.2 Run the manual matrix for rapid create, large note set, drag/quit geometry, reduced motion, dark appearance, and acrylic fallback; record on-disk and visual results.
