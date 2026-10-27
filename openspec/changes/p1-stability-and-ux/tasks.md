# Tasks

## 1. Window placement and visibility

- [x] 1.1 Add a monotonic cascade slot to `AppState` and replace `webview_windows().len()` in `cascade_position`; verify two rapid create actions produce different coordinates in a Rust unit test.
- [x] 1.2 Add a monitor/work-area clamp helper using `Monitor::work_area()`; apply it to restored bounds in `create_note_window`; verify with unit tests for an on-screen rectangle, a fully off-screen rectangle, and a taskbar-overlapping rectangle.
- [x] 1.3 Make window creation failures observable: return or emit a failure for a note whose native window cannot be created while keeping the note persisted; verify with a test-only invalid label/path and a manual failure log check.
- [x] 1.4 Add manual cases for rapid create, tray double-click create, and disconnected-monitor restore to `tests/MANUAL.md`; verify each case names the on-disk/coordinate oracle.

## 2. Page action serialization

- [x] 2.1 Add a renderer `pageActionBusy` guard and a helper that disables page controls while an action is pending; verify with a JS unit test for the state machine and a manual double-click test.
- [x] 2.2 Re-check `currentPageIndex`/page count after `flushPendingSave()` in next/previous handlers; verify double-clicking next advances exactly one page.
- [x] 2.3 Apply the same guard to empty-page deletion, delete confirmation, and add-page; verify double-clicking delete removes exactly one page and confirmation double-click is idempotent.
- [x] 2.4 Add manual double-click cases for next, previous, delete, and confirm-delete to `tests/MANUAL.md`; verify the expected page count and `notes.json` page array.

## 3. Menus, submenu, and keyboard accessibility

- [x] 3.1 Add measured left/right submenu flipping with a `submenu-left` class and vertical clamping; verify right-click near the right edge shows all six theme items inside the window.
- [x] 3.2 Add roving focus and Arrow/Home/End/Enter/Space/Escape handling to the context menu, theme submenu, and page-jump menu; verify a keyboard-only path can switch theme and jump pages.
- [x] 3.3 Replace the page-indicator `role="button"` wrapper with a group plus a dedicated page-menu button; verify the ARIA tree no longer nests buttons and the page count is announced on change.
- [x] 3.4 Add a dialog focus helper (initial focus, Tab trap, Escape, focus restore) to both confirmation overlays; verify keyboard-only open/cancel/confirm and focus return.
- [x] 3.5 Add keyboard manual cases plus ARIA/DOM verification (roving focus, `aria-live` page status, no nested-button structure) to `tests/MANUAL.md`; verify each action has a visible focus state.

## 4. Note deletion

- [x] 4.1 Add a "delete current note" context-menu item and a confirmation overlay; verify the menu is keyboard reachable and cancelling leaves the note unchanged.
- [x] 4.2 Wire confirmation to `window.memoAPI.deleteNote(noteId)` and verify the Rust command removes the note, flushes, and closes its window; verify `notes.json` no longer contains the id.
- [x] 4.3 Add manual cases for deleting a non-empty note, cancelling deletion, and deleting the last remaining note (welcome-note recreation behavior must be explicit); verify the on-disk note list.

## 5. IPC navigation and caller identity

- [x] 5.1 Add `on_navigation` to note webviews with a centralized local-origin predicate; verify `tauri://localhost` and `http://tauri.localhost` are allowed and an HTTP(S) URL is rejected in a unit test of the predicate.
- [x] 5.2 Add `on_new_window` returning `NewWindowResponse::Deny`; verify a `window.open` attempt from the note page creates no new native window.
- [x] 5.3 Bind `get_note_data`, `update_note`, and `delete_note` to the calling window label; verify a request from note A for note B returns an error and leaves note B unchanged.
- [x] 5.4 Tighten `UpdateNoteFields` validation with page count, content length, color, and page-index limits; verify malformed and oversized payloads are rejected without partial mutation.
- [x] 5.5 Add manual/terminal cases for remote navigation, `window.open`, cross-note update, and oversized payload; verify the app remains on the local note and the log records the rejection.

## 6. Integration and release check

- [x] 6.1 Run `npm test`, `cargo fmt --check`, and the keyboard/double-click manual matrix; verify JS and Rust suites are green.
- [x] 6.2 Run `npm run build` and verify the NSIS installer is produced; run the rapid-create, off-screen restore, right-edge submenu, keyboard navigation, delete-note, and navigation-denial cases against the release build.
