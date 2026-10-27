# Design

## Context

See `proposal.md` for motivation. The current renderer sends the full `pages` array on every input and serializes saves through a promise chain; the Rust side spawns an OS thread for each create/close/pin operation; window move/resize updates the store on every event; and there is no CI or static-analysis gate. This backlog must remain non-blocking: each optimization should be independently landable and must not change note semantics or the `notes.json` contract.

## Goals / Non-Goals

**Goals:**

- Reduce IPC payloads and main-thread work for ordinary typing and window dragging.
- Serialize window lifecycle operations behind one owner and preserve existing behavior.
- Provide a scalable note-management flow for large note sets.
- Add optional visual modes without making them prerequisites for correctness.
- Establish CI, linting, dependency auditing, and a place for e2e tests.
- Improve module boundaries and remove dead surface.

**Non-Goals:**

- Changing the note/page data model or storage format.
- Replacing the editor (P2) or persistence protocol (P0).
- Shipping a full design system or dark-mode redesign in this backlog.
- Guaranteeing real acrylic on every Windows 10/11 composition mode.

## Decisions

### 1. Save protocol: page-scoped updates plus latest-wins coalescing

Add a `update_page` command:

```text
update_page(note_id, page_index, page: { title, content })
```

The frontend uses it for ordinary keystrokes. Full `update_note` remains for add/delete/reorder, color, pin, and page-index changes.

The renderer save queue becomes a small state machine:

- `inFlight: boolean`
- `pending: Snapshot | null` (latest only)
- enqueue(snapshot): if in-flight, replace `pending`; else send immediately
- on completion: if `pending`, send it; otherwise idle

Structural changes are enqueued as barriers: they are never replaced by a later page-only snapshot. The queue sends at most one command at a time, so command ordering is deterministic without adding a revision field to the database. If future concurrent writers appear, add a per-note revision; single-window-per-note keeps this out of scope.

**Alternative considered:** keeping the full-page payload and only coalescing. It reduces requests but not payload size; page-scoped updates address both.

### 2. Geometry throttling with final-state capture

Each window event closure keeps an `AtomicU64` of the last persisted timestamp. On move/resize, if less than 100 ms has passed, skip the store update. On close/quit, read the window's current outer position/size and persist it before the final flush. This bounds store/lock traffic during drags while preserving the final geometry.

A dedicated per-window timer is not necessary; the event stream itself supplies the final event in normal use, and close/quit supplies an explicit final read. Tests simulate a burst and assert the update count bound and final coordinates.

### 3. A serialized window manager replaces thread-per-operation

Introduce a `WindowManager` owned by `AppState`:

- a command channel (`Create`, `Close`, `ShowAll`, `SetPinned`, `Quit`)
- one worker thread (or a Tauri async task with a single-consumer queue)
- window operations execute sequentially; command handlers enqueue and return immediately
- the worker owns the cascade counter and the create/close ordering
- errors are reported through the existing store health/log channel or a window-manager error event

Tauri window creation still dispatches to the main event loop; the worker never blocks the main thread. This removes the race where two create threads see no window and avoids one thread per operation. The existing `CloseRequested` handler remains the OS event entry point; the manager coordinates the flush/close sequence from P0 rather than duplicating it.

**Alternative considered:** keep `std::thread::spawn` and add mutexes around create/close. Simpler, but still creates unbounded threads and does not provide an ordered queue.

### 4. "Show all" becomes a note-management surface

Add a dedicated management window (`manage.html` or an in-window overlay) backed by a `list_notes` command that returns id/title/color/pinned/last-modified metadata. The surface lists notes and opens/focuses one on selection. "Show all" opens the manager; an explicit secondary "open all" action remains for users who want the old behavior. Opening a note routes through `WindowManager::Create`.

This avoids opening dozens of windows and gives a natural place for future note operations. The manager is a normal Tauri window with the same local-only navigation policy.

### 5. Dark appearance and reduced motion are additive, optional modes

- Reduced motion is CSS-only via `prefers-reduced-motion: reduce`; no setting needed.
- Dark appearance uses a `data-appearance="dark"` attribute and CSS variable overrides. The preference is stored in `localStorage` (shared by note windows on the same origin) and applied on load. A small toggle can live in the management surface or context menu; the exact placement is a UI task.
- Real acrylic is an experiment, not a default: evaluate Tauri's `window-vibrancy`/`backgroundMaterial` with transparent composition, behind a setting/flag. If the window becomes black or unreadable on a supported/unsupported machine, keep the CSS material. The spec only requires a defined fallback if the mode is offered.

### 6. Quality gates and module boundaries

- CI (GitHub Actions or equivalent Windows runner): `npm ci`, `cargo fmt --check`, `cargo clippy -- -D warnings`, `npm run test:js`, `npm run test:rust`, `npm run build` (or a compile-only build to keep CI time bounded).
- Dependency audit: `cargo audit` and `npm audit --omit=dev` on a schedule and before releases; document accepted risks.
- Module split: `main.rs` keeps the builder/setup; new `window_manager.rs`, `tray.rs`, `commands.rs`, `monitor.rs` (or `windows/` directory); `store.rs` can split into `store/model.rs`, `store/persistence.rs`, `store/worker.rs` if it improves testability. Dead-command/API inventory is owned by the baseline `project-development` requirement; this change only runs the inventory and wires/removes what it reports (`deleteNote` is already live via P1).
- E2E: add an optional `tauri-driver`/WebDriver smoke test for create/edit/close/reopen; if the harness is not stable on Windows, keep the scripted manual checklist as the release gate.

## Risks / Trade-offs

- **Page-scoped update ordering** → A page update and a structural update could interleave. Mitigation: single in-flight queue, structural barriers, and tests that interleave add/delete with page edits.
- **Latest-wins drops intermediate states** → The user only sees final content, but an intermediate state could matter if an error occurs. Mitigation: keep the latest snapshot, retry it on failure, and surface save failure; never clear dirty on a dropped snapshot.
- **Geometry throttling loses the final event** → Mitigation: read window bounds on close/quit and flush; test burst + close.
- **Window manager complexity/deadlock** → Mitigation: worker only dispatches; no blocking joins from command handlers; add timeouts/logging for queued operations.
- **Management window scope** → It can grow into a full note browser. Mitigation: limit to list/open/focus in this backlog; defer rename/reorder/delete bulk actions to separate changes.
- **Dark mode/acrylic visual regressions** → Mitigation: make modes opt-in, keep CSS fallback, and run the six-theme contrast checks.
- **CI time/cost** → Mitigation: cache npm/cargo, run build on a single Windows job, and keep e2e optional until stable.

## Migration Plan

1. Add page-scoped update + latest-wins queue behind the existing `update_note` behavior; verify identical disk output.
2. Add geometry throttling and final-bounds capture; verify drag/quit cases.
3. Introduce `WindowManager` and route create/close/show-all through it; keep the existing tests green.
4. Add the management surface and list command.
5. Add dark/reduced-motion/acrylic experiments behind flags; keep defaults unchanged.
6. Add CI/lint/audit and module split; no data migration.

## Open Questions

- Whether the management surface should be a separate window or an in-note overlay. Both are compatible with the spec; a separate window is simpler for multiple notes and is the default in the task list.
- Whether the real-acrylic experiment should use Tauri's built-in effects or `window-vibrancy`. This is a spike decision; either must preserve the CSS fallback.
