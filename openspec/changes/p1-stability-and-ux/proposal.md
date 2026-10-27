# Proposal

## Why

The Tauri migration preserved the note UI, but several edge behaviors are still unreliable: rapid note creation can stack windows at one position, restored windows can appear on a disconnected monitor, double-clicking page controls can skip or delete two pages, the theme submenu is clipped near the right edge, and keyboard users cannot reach the page/theme menus or dialogs. The app also exposes a `delete_note` command with no user-facing way to invoke it. These are user-visible reliability and accessibility gaps, not new features.

## What Changes

- Serialize note-window creation and use a monotonic position source so rapid `+` / tray actions never stack new notes at the same coordinates.
- Clamp restored window bounds to a currently connected monitor work area; move fully off-screen notes back to the primary display.
- Add a page-action guard so double-clicking next/previous/delete cannot skip or delete two pages.
- Flip the theme submenu to the left near the window's right edge (or render it in an unclipped overlay) and include submenu width in menu positioning.
- Make page-jump menus, the theme submenu, and confirmation dialogs keyboard-operable with visible focus, Escape handling, and a focus trap for dialogs.
- Add an explicit "delete current note" action with confirmation, wired to the existing `delete_note` command.
- Reject remote navigation and new windows in note webviews; validate that `get_note_data`/`update_note` callers use their own window label as `note_id`.

## Capabilities

### New Capabilities

- `window-lifecycle`: covers note-window creation, cascading placement, restored geometry visibility, and window creation/close ordering.
- `note-interaction`: covers page navigation/deletion actions, context-menu/submenu behavior, note deletion, and keyboard/assistive interaction with the note UI.
- `ipc-security`: covers the boundary between note webviews and Tauri commands, including navigation restrictions and caller/note identity validation.

### Modified Capabilities

<!-- No existing main specs yet; note-persistence is introduced by p0-data-safety. -->

## Impact

- Rust: `src-tauri/src/main.rs` (position counter, monitor clamp, navigation guard, sender checks, delete command), `src-tauri/capabilities/default.json` if new window permissions are needed.
- Frontend: `src/renderer.js` (page guards, submenu geometry, keyboard handlers, delete-note flow, focus management), `src/index.html`, `src/style.css`, `src/api.js`.
- Tests/docs: `tests/MANUAL.md`, new or extended JS/Rust tests, `TODO.md` checkboxes.
- No `notes.json` schema change and no new runtime dependency is expected.
