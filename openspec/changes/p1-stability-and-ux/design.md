# Design

## Context

See `proposal.md` for motivation and `specs/` for required behavior. The current Tauri app creates windows through `WebviewWindowBuilder`, computes cascade positions from `app.webview_windows().len()`, restores stored coordinates directly, and performs page actions inside async click handlers without a busy guard. The menu markup is mouse-oriented: the theme submenu is CSS `:hover` only, page-menu items are non-focusable `div`s, and the confirmation overlays do not manage focus. The command surface accepts a `note_id` from any note webview.

## Goals / Non-Goals

**Goals:**

- Make window placement deterministic and monitor-safe.
- Ensure one native window per note and make creation failures observable.
- Serialize page actions so double-clicks are idempotent.
- Make all note menus and confirmation dialogs keyboard-operable.
- Provide an explicit, confirmed note deletion action.
- Restrict note webviews to the local frontend and bind note commands to the calling window.

**Non-Goals:**

- Reworking the editor or Markdown renderer (P2).
- Persistence protocol/error handling (P0).
- Performance refactors such as latest-wins saves or a window actor (backlog).
- Adding a general-purpose settings window or multi-note dashboard.

## Decisions

### 1. Position new notes from a monotonic in-memory slot

`AppState` gets an `AtomicUsize` cascade slot. Each new note increments the slot and uses `slot % 8` for the cascade offset. Existing notes keep their persisted coordinates. This removes the dependency on native window creation timing and avoids stacking when several create actions run before the first window exists.

Cascade placement uses the primary monitor's **work area**, not its full size, converted to logical coordinates. A helper returns `(x, y)` clamped to the work area.

**Alternative considered:** deriving the slot from `store.notes_count()`. It still helps, but deleting notes can reset the count and recreate an earlier offset; a monotonic counter is more predictable.

### 2. Restored bounds are clamped to connected monitor work areas

Before building a window, compute the stored rectangle and compare it with every monitor's logical work area. If it intersects a work area, clamp its position so the whole window fits inside that work area; when the window cannot fit entirely (smaller work area than the window), keep at least the header visible. If it intersects none, place it in the primary work area with the current cascade offset. Width/height remain bounded by the existing minimum size.

All work-area math is done in logical coordinates converted from `Monitor::work_area()` and each monitor's `scale_factor`, so mixed-DPI monitor sets are handled consistently; a unit test covers a rectangle saved on a different-DPI monitor.

Tauri's `Monitor::work_area()` already returns the usable rectangle, so no platform-specific API is needed.

### 3. Page actions use a single busy guard

Add a renderer-level `pageActionBusy` flag. Next/previous/delete handlers call a helper that:

1. returns immediately if busy;
2. sets busy and disables page controls;
3. awaits `flushPendingSave()`;
4. re-reads `currentPageIndex` and page count;
5. performs at most one mutation and reload;
6. clears busy in `finally`.

This makes double-clicks idempotent and also prevents a page switch from racing a pending save. Delete confirmation uses the same guard, so a double-click cannot delete two pages.

### 4. Submenu uses a measured left/right flip

On context-menu open, measure the menu and submenu widths. If the submenu would cross the right edge, add a `submenu-left` class that positions it with `right: 98%` instead of `left: 98%`. Clamp vertical placement so the menu stays inside the viewport. The CSS remains inside `.memo-container`; flipping is preferred over removing `overflow: hidden`, which is needed for rounded corners and layout containment.

If both left and right placements would overflow on a very narrow window, the menu falls back to a centered overlay position with `max-width` fitting the viewport. This is a fallback, not the default.

### 5. Menus and dialogs follow a small accessibility pattern

- Menu items get `tabindex="-1"` and a roving focus index owned by the menu container. ArrowUp/ArrowDown/Home/End move focus; Enter/Space activates; Escape closes and returns focus to the trigger.
- The theme parent gets `tabindex="0"`, `aria-haspopup="menu"`, and `aria-expanded`. Enter/Space/ArrowRight opens the submenu; ArrowLeft/Escape closes it. The submenu also opens on `:focus-within` so keyboard focus can reveal it without a mouse.
- The page indicator container becomes a `role="group"`; the page-number text becomes a button that opens the page menu, and the current/total text is wrapped in an `aria-live="polite"` region so page changes are announced. This removes the nested-button ARIA problem.
- Dialogs use a helper that stores the trigger, focuses the first action, traps Tab/Shift+Tab, closes on Escape, and restores focus. The overlay keeps `role="dialog"` and `aria-modal="true"`.

**Alternative considered:** a full ARIA menu library. The app has only two small menus; a local pattern is less code and avoids a dependency.

### 6. Delete-note action reuses the existing backend command

Add a "删除当前便签" item to the context menu and a confirmation dialog. On confirm, call `window.memoAPI.deleteNote(noteId)`, which invokes `delete_note`; Rust removes the note, flushes, and closes the window. Cancelling preserves the note. This also makes the existing `deleteNote` API live instead of dead code.

### 7. Note webviews enforce a local-only navigation boundary and command identity

`WebviewWindowBuilder` gets:

- `.on_navigation(|url| url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"))`
- `.on_new_window(|_, _| NewWindowResponse::Deny)`

The allowlist covers production (`tauri://localhost`) and development (`http://tauri.localhost`). Other schemes/hosts are rejected.

`get_note_data` and `update_note` take the calling `WebviewWindow` (or `Window`) as an injected command argument and compare `window.label()` with `note_id`. Mismatches return an error and do not touch the store. Frontend helpers already catch command errors, so the UI can show a save-status failure rather than silently proceeding.

`UpdateNoteFields` validation is tightened: non-empty page list, a maximum page count, a maximum content length per page, valid color, and a page index that is clamped or rejected. Limits are named constants so tests and UI can reference them.

### 8. Tests are split by risk

- Rust unit tests cover pure placement/clamping helpers and payload validation; command identity checks are covered by a small helper that can be tested without a real webview.
- Renderer logic that can be extracted (menu flip decision, page-action state machine) gets JS unit tests; DOM-dependent behavior is covered by the manual checklist and, optionally, a `tauri-driver` e2e test.
- Manual cases cover right-edge menus, keyboard-only navigation, double-click page actions, delete/cancel, off-screen restore, rapid create, and navigation denial.

## Risks / Trade-offs

- **Cascade counter is in-memory** → Restarting resets the slot; existing notes keep their stored positions, so this only affects new notes. Acceptable.
- **Window clamping can move a window the user deliberately placed partially off-screen** → Clamp only when the stored rectangle is fully outside a work area or cannot fit; allow partial overlap within a work area where possible. Document the behavior.
- **Focus management can conflict with WebView2 defaults** → Keep the trap small and test with Tab/Escape in the real webview; avoid `inert` until verified.
- **Navigation allowlist must include dev and production origins** → Centralize the predicate and add a unit test for `tauri://` and `http://tauri.localhost`; document that external URLs are intentionally blocked.
- **Sender validation can break future window types** → Every note window's label is its note id by design. If a future non-note window needs these commands, it should call a separate API rather than weaken the check.
- **Payload limits could reject legitimate large notes** → Choose limits well above normal sticky-note usage, surface a clear error, and keep the values in one place.

## Migration Plan

1. Land the placement and monitor-clamp helpers with unit tests; switch new-window creation to them.
2. Add the page-action guard and keyboard menu/dialog behavior; verify with manual keyboard cases.
3. Add delete-note UI and wire the existing command.
4. Add the navigation allowlist and command identity checks; update capabilities only if new permissions are required.
5. Run the full JS/Rust tests and the release-build manual matrix; no `notes.json` migration is needed.

## Open Questions

- Whether the menu flip should be implemented with a CSS class or inline positioning. Both satisfy the spec; the class approach is preferred unless measurement shows layout thrash on open.
- Whether to add a `tauri-driver` e2e harness now or keep DOM cases manual. This affects test infrastructure only, not the behavior contract.
