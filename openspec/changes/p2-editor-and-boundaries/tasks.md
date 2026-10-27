# Tasks

## 1. Inline parsing and title extraction

- [x] 1.1 Replace the regex-only inline parser with a small ordered emphasis scanner that handles `***`, `**`, and `*` with balanced output; verify JS tests for triple, mixed, nested, and unmatched markers.
- [x] 1.2 Align `extractTitleFromText` in `src/noteUtils.js` and the Rust migration helper so leading Markdown markers are removed but hyphens inside dates/words are preserved; verify shared cases in `tests/test-title-extract.js` and Rust tests.
- [x] 1.3 Add a preview regression case for a line containing bold and italic together; verify no raw asterisks or unbalanced tags appear.

## 2. List editing and checkbox mapping

- [x] 2.1 Add Shift+Enter line-break handling before the list-continuation path; verify Shift+Enter inside a task item does not create a new item.
- [x] 2.2 Add empty-list-item Enter handling that removes the prefix and exits the list; verify an empty `- [ ]` line becomes a plain line.
- [x] 2.3 Add Tab/Shift+Tab indentation for list lines with a maximum of three levels; verify focus stays in the textarea and the preview depth changes.
- [x] 2.4 Add a content fingerprint to rendered checkbox rows and a fallback lookup before toggling; verify a programmatic text change does not cause the wrong line to be toggled.
- [x] 2.5 Add manual editor cases for IME Enter, Shift+Enter, empty-item exit, Tab/Shift+Tab, and checkbox toggling; verify the on-disk Markdown after each case.

## 3. UI states and scrollbar polish

- [x] 3.1 Adjust the preview scrollbar thumb colors for all six light themes; verify visibility on the white theme with overflowing content.
- [x] 3.2 Add a missing-note/loading/error state that hides the editor and page placeholder, offers retry/close, and never shows a fake `2 / 2`; verify with a deleted note id and a forced load error.
- [x] 3.3 Update the initial page indicator to a neutral placeholder until data loads; verify no misleading page count is visible during startup.
- [x] 3.4 Add manual cases for missing note and load failure to `tests/MANUAL.md`; verify the error state does not imply the note was saved.

## 4. Data resilience

- [x] 4.1 Add duplicate-id detection and repair on load; verify a Rust test with two notes sharing an id produces unique ids and a backup.
- [x] 4.2 Add `schemaVersion` with a current version, legacy upgrade, and future-version refusal; verify Rust tests for missing, current, and newer versions.
- [x] 4.3 Add backup pruning with a retention limit that preserves the newest backup and unrelated files; verify with temporary backup files.
- [x] 4.4 Replace unwrap-based mutex locking with poison recovery and detect worker-channel loss; verify a poisoned-lock test and a channel-failure test leave the store usable or report a health error.
- [x] 4.5 Update the data-format documentation and manual recovery notes; verify the documented old/new `notes.json` examples load as described.

## 5. Packaging and release checks

- [x] 5.1 Add `scripts/check-versions.mjs` and run it before `tauri build`, implementing the baseline `project-development` version rule; verify a deliberately mismatched version fails with a clear message.
- [x] 5.2 Configure the default installer's WebView2 mode (`embedBootstrapper`) and declare the network prerequisite in README/release notes; verify the offline behavior is the bootstrapper's own visible abort, not a silent completion.
- [x] 5.3 Provide and document an offline installer build variant using `offlineInstaller`; verify the produced installer completes installation and launches without network.
- [x] 5.4 Update README/AGENTS with the signing posture (unsigned, SmartScreen warning) and the absence of an auto-updater; verify the release notes match the actual build output.

## 6. Integration and release check

- [x] 6.1 Run `npm test`, `cargo fmt --check`, and the P2 manual editor/UI/data cases; verify JS and Rust suites are green.
- [x] 6.2 Run `npm run build` and verify the version check passes and the installer is produced; run the scrollbar, missing-note, title-date, triple-emphasis, and checkbox-fingerprint cases against the release build.
