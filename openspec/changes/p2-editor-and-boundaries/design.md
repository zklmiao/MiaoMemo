# Design

## Context

See `proposal.md` for motivation and `specs/` for behavior. The current renderer uses regex replacements for inline emphasis and line-index attributes for preview checkboxes; the store serializes a `Db` with no version, assumes unique ids, and keeps every corruption backup; the installer uses Tauri's default WebView2 install mode. The P2 work is intentionally independent of P0/P1 so it can land after the data and interaction fixes.

## Goals / Non-Goals

**Goals:**

- Make editor behavior correct for common Markdown/list cases without adding a Markdown dependency.
- Preserve title fidelity (dates, hyphenated words).
- Make checkbox toggling robust against stale rendered indices.
- Add small, explicit UI states for scrollbars and missing notes.
- Add bounded, versioned data resilience without breaking old `notes.json` files.
- Make installer prerequisites and version consistency explicit and testable.

**Non-Goals:**

- Full CommonMark support, links, images, code fences, or tables.
- Replacing `notes.json` with a database.
- Reworking persistence close/quit semantics (P0) or window/menu architecture (P1).
- Adding an auto-updater in this change; only documenting the posture.

## Decisions

### 1. Replace regex emphasis with a small ordered scanner

Current regex ordering causes `***text***` to form unbalanced tags. Implement a scanner that:

1. escapes HTML first;
2. finds contiguous runs of `*`;
3. treats runs of 3 as bold+italic, 2 as bold, 1 as italic;
4. requires a closing run and leaves unmatched markers literal;
5. produces balanced `<strong>`/`<em>` tags for nested spans.

The scanner is small enough to unit-test directly and avoids a full Markdown library. `parseMarkdownInline` remains the single entry point so list/checklist/header rendering share the same behavior.

**Alternative considered:** adding `markdown-it`/`marked`. It solves the problem but brings a large runtime and a different rendering model for a deliberately minimal preview. Revisit only if code blocks/links become requirements.

### 2. List editing is handled in the textarea keydown handler

The handler already owns Enter continuation and the IME guard. Extend it:

- Compute the current line and the caret's position inside the list prefix.
- **Enter:** if the line is a list item with non-empty content, insert the prefix as today; if the line is only a list prefix (empty item), remove the prefix and insert a plain newline.
- **Shift+Enter:** bypass prefix insertion and let the browser insert a line break.
- **Tab/Shift+Tab:** only when the caret is on a list line, replace the leading indentation with two spaces per level (max three levels); otherwise leave the default focus behavior.

The preview renderer already maps two leading spaces to one level; keep that mapping as the single source of truth.

**Alternative considered:** a contenteditable editor. It would complicate selection, IME, and persistence; the textarea is intentionally simple.

### 3. Title extraction strips only leading Markdown markers

Change both the JS `extractTitleFromText` and the Rust migration helper to:

1. take the first non-empty line (or first line as today);
2. remove leading `#` heading markers and surrounding emphasis markers;
3. preserve hyphens inside the remaining text;
4. trim and truncate to 16 characters.

Keep the two implementations aligned with shared test cases (date, heading, emphasis, hyphenated word). A future refactor could generate the JS/Rust constants from one source, but that is out of scope.

### 4. Checkbox mapping uses a content fingerprint fallback

Keep `data-line-index` as the fast path, but also store a stable fingerprint (normalized raw line + occurrence count) on each rendered checkbox. On click:

1. if the current line at the stored index still matches the fingerprint, toggle it;
2. otherwise search the current text for exactly one line matching the fingerprint;
3. if one match is found, toggle that line;
4. if zero or multiple matches are found, re-render the preview and do not toggle.

This avoids silently toggling the wrong task when the text changed between render and click, while keeping normal clicks O(1).

### 5. UI polish is additive and theme-aware

- Scrollbar thumb uses a darker neutral (`rgba(0,0,0,0.18)` normal, `0.32` hover) across all light themes; no per-theme variables needed.
- Add a small hidden `.memo-state` overlay with a message and actions. `initNote` shows it when data is null or loading fails, hides the editor/footer, and offers retry/close. The initial page indicator uses `— / —` or the real count only after load; never a fake `2 / 2`.
- Keep the welcome note as the normal empty-start behavior; the error state is only for an existing window whose note cannot be loaded.

### 6. Data resilience is layered onto the existing JSON contract

- Add `schemaVersion` with `#[serde(default)]` and `CURRENT_SCHEMA_VERSION = 1`. Missing/zero is upgraded in memory and persisted on the next successful write. A higher version puts the store in the existing read-only/error state (from P0) and is never downgraded.
- Deduplicate ids after normalization: keep the first id, regenerate later duplicates, mark the database dirty, and back up the original file before the repair write.
- Retain at most 10 corruption backups, always keeping the newest. Prune only files matching the application's `notes.json.corrupt-*.bak` pattern.
- Replace `.lock().unwrap()` with a poison-recovery helper. If the worker channel send fails, mark the store degraded and attempt a direct `flush_now`; do not silently stop scheduled writes. Surface the degraded state through the same health channel introduced in P0.
- No change to the page/note shape; old files remain readable.

### 7. Packaging uses an explicit WebView2 policy; the version check implements the baseline rule

- Default installer uses `embedBootstrapper` for a small download; README/release notes declare that WebView2 runtime installation may require network access. The "visible failure" oracle is the WebView2 bootstrapper's own abort dialog — the project does not build a custom NSIS prerequisite screen.
- Provide an optional offline build config (`tauri.offline.conf.json` or a documented `--config` override) using `offlineInstaller` so the offline scenario installs without network.
- NSIS language/install experience is configured explicitly (or documented) per the release-packaging requirement.
- Add `scripts/check-versions.mjs` that reads `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `package.json`; `npm run build` runs it first and fails on mismatch. This implements the baseline `project-development` version rule; the rule itself is not re-declared in this change's spec delta.
- Document that artifacts are currently unsigned, SmartScreen may warn, and no auto-updater is enabled. If an updater is added later, it must verify signatures.

### 8. Test strategy

- JS unit tests for the inline scanner (triple/mixed/unmatched emphasis), title extraction (dates, headings), and pure list/tab transformations where extractable.
- Rust unit tests for duplicate-id repair, schema-version upgrade/refusal, backup pruning, and poison/degraded writer behavior.
- DOM-dependent checkbox/scrollbar/error-state behavior stays in the manual checklist until a webview e2e harness exists.
- Version-check script test with a temporary mismatched manifest.

## Risks / Trade-offs

- **Custom emphasis scanner** → Edge cases may remain. Mitigation: keep the grammar intentionally small and test unmatched/triple/mixed cases; leave unmatched markers literal.
- **Tab hijacking** → Users may expect Tab to move focus. Mitigation: only intercept when the caret is on a list line; document the behavior.
- **Schema version refusal** → A future file could make the app read-only. Mitigation: clear error, backup, and no automatic downgrade; document the recovery path.
- **Backup pruning** → A user could lose an old but valuable backup. Mitigation: keep the newest 10, never prune unrelated files, and document the retention count.
- **Installer size vs offline support** → `offlineInstaller` is much larger. Mitigation: default to the bootstrapper and provide an explicit offline build variant.
- **Fingerprint matching** → Duplicate identical checklist lines are ambiguous. Mitigation: use occurrence count; if still ambiguous, re-render and require another click rather than guessing.

## Migration Plan

1. Land the editor scanner/list/title changes with JS tests; update the Rust title helper and its tests.
2. Add the checkbox fingerprint and UI state/scrollbar changes; verify existing note rendering.
3. Add schema version/dedupe/backup pruning/poison handling with Rust tests; verify old `notes.json` loads unchanged.
4. Add the version-check script and packaging config; produce both default and offline installers if desired.
5. Run the full test suite and the P2 manual cases; no forced data migration for existing users.

## Open Questions

- Whether the checklist fingerprint should use a hash or the normalized raw line plus occurrence count. The normalized line is simpler to debug; choose it unless notes become long enough that attribute size matters.
- Whether to ship the offline installer by default. This is a release-size decision; the spec allows either as long as the prerequisite is explicit.
