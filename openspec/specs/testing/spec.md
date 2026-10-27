# testing Specification

## Purpose

Defines the test layers, isolation rules, release gates, and evidence requirements for MiaoMemo so that note persistence and window behavior are verified against real artifacts rather than inferred from the absence of visible errors.

## Requirements

### Requirement: Tests use real modules and isolated data

Automated tests SHALL exercise the real implementation modules, not copies of their logic. Tests that touch persistence MUST use a temporary or isolated data directory and MUST NOT read or write the developer's real `notes.json` or legacy Electron data.

#### Scenario: Rust persistence test

- **WHEN** a Rust store test writes a database
- **THEN** it uses a unique temporary directory and removes it after the test

#### Scenario: Manual GUI test

- **WHEN** a tester exercises the app manually
- **THEN** the app is started with `MIAOMEMO_DATA_DIR` pointing to a fresh directory and the real user data is untouched

### Requirement: Persistence tests verify the on-disk result

Every test or manual case that changes note data SHALL verify the resulting `notes.json` content, not only the absence of an error or a successful UI action. The expected marker, note id, page count, or geometry MUST be stated in the test.

#### Scenario: Save verification

- **WHEN** a test edits a note and expects persistence
- **THEN** it reads `notes.json` and asserts the exact marker or field value

#### Scenario: Close verification

- **WHEN** a test closes a note window
- **THEN** it asserts whether the note id remains in `notes.json` or was removed

### Requirement: Bug fixes include a regression test or a scripted reproducer

A fix for a reproducible bug SHALL add a test or scripted manual reproducer that fails on the previous behavior and passes after the fix. If automation is impractical, the manual checklist entry MUST describe the exact steps and the on-disk oracle.

#### Scenario: Persistence race fix

- **WHEN** a close/quit race is fixed
- **THEN** a regression case performs the immediate close/quit and asserts the last edit is present on disk

#### Scenario: UI bug fix

- **WHEN** a menu or page-action bug is fixed
- **THEN** a manual or automated case reproduces the previous failure and verifies the corrected behavior

### Requirement: Tests are falsifiable and use negative controls

Automated suites that could pass while a bug remains SHALL include a negative control or an assertion strong enough to distinguish fixed from broken behavior. A test MUST NOT rely solely on "no error was reported" as its oracle; it SHALL assert an observable artifact such as on-disk content, a returned value, a log or health event, or an explicit UI state.

#### Scenario: Negative control for a logic fix

- **WHEN** a fix changes detection logic that previously misbehaved
- **THEN** the suite contains a case that fails under the previous logic and passes after the fix

#### Scenario: Assertion strength

- **WHEN** a persistence test reports PASS
- **THEN** it has asserted the expected on-disk or returned artifact, not merely the absence of an error

### Requirement: Test layers cover the critical boundaries

The project SHALL maintain Rust unit tests for the store and pure window helpers, JS unit tests for pure frontend helpers, and manual or e2e coverage for webview-dependent flows. Critical flows include note create/edit/close/quit, corrupt or unreadable databases, failed writes, single-instance behavior, page navigation/deletion, queue handling, and local-only navigation.

#### Scenario: Persistence boundary

- **WHEN** the test suite runs
- **THEN** it covers corrupt JSON, invalid note structures, unreadable files, failed writes, legacy migration, and trailing `.tmp` recovery

#### Scenario: Webview boundary

- **WHEN** a release candidate is checked
- **THEN** the manual/e2e matrix covers close/quit, page actions, menus, delete-note, editor/list flows, window placement under rapid creation, and navigation denial

### Requirement: Release checks are mandatory and repeatable

A release candidate SHALL pass formatting, static analysis, JS tests, Rust tests, and a release build. The manual checklist MUST be executed for changes that affect persistence, windows, menus, or packaging, and the results MUST be recorded.

#### Scenario: Release gate

- **WHEN** a release build is prepared
- **THEN** `cargo fmt --check`, the project's lint/static analysis, JS tests, Rust tests, and `npm run build` all pass

#### Scenario: Manual record

- **WHEN** a manual case is executed
- **THEN** the record includes the isolated directory, PASS/FAIL, and the `notes.json` diff or relevant excerpt

### Requirement: Tests and logs do not contain private user content

Test fixtures, logs, screenshots committed to the repository, and issue reports SHALL NOT include real user note content. Persistence logs MUST record paths, ids, counts, and error categories without logging note bodies.

#### Scenario: Logging a failure

- **WHEN** a persistence failure is logged
- **THEN** the log contains the error category and note id if needed, but not the note text

#### Scenario: Test fixture

- **WHEN** a fixture or screenshot is added to the repository
- **THEN** it uses synthetic content rather than a real note backup

### Requirement: Test data and build artifacts are cleaned up

Temporary test directories, generated databases, and build artifacts SHALL be removed or kept outside version control. The repository MUST NOT commit `node_modules`, `src-tauri/target`, generated test data, or personal backups.

#### Scenario: Test cleanup

- **WHEN** an automated test finishes
- **THEN** its temporary database directory is removed or isolated outside the repository

#### Scenario: Repository check

- **WHEN** changes are reviewed
- **THEN** ignored build/test artifacts are not tracked and no real `notes.json` is present
