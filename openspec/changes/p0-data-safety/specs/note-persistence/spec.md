# Spec Delta

## Purpose

Guarantees that user notes survive window close, application quit, startup I/O failures, and disk write failures without silent data loss.

## ADDED Requirements

### Requirement: Pending edits are flushed before a note window closes

The system SHALL flush the active window's pending note edits and receive acknowledgment before destroying that window. A window close triggered by the OS (for example Alt+F4) and a note close triggered by the in-app close button MUST use the same guarantee. If the renderer does not acknowledge within a bounded timeout, the system MUST close the window without deleting the note, and MUST record the timeout.

#### Scenario: OS close immediately after typing

- **WHEN** the user types the first characters into an empty note and immediately triggers the OS window close
- **THEN** the note and its last edit are present in `notes.json` after reopening, and the note is not deleted as empty

#### Scenario: In-app close immediately after typing

- **WHEN** the user types and immediately confirms the in-app close action
- **THEN** the close waits for the flush acknowledgment, and the typed content is persisted before the window disappears

#### Scenario: Renderer does not acknowledge a close request

- **WHEN** the renderer fails to acknowledge the flush request before the bounded timeout expires
- **THEN** the window closes, the note is retained, and the timeout is recorded in the application log or the store health event

### Requirement: Quit flushes every open note before exiting

When the user quits the application — from the tray menu or the in-app quit action — the system SHALL request a flush from every open note window, wait for acknowledgments or a bounded timeout, and flush the in-memory store before exiting. The system MUST NOT exit while a successful flush is still possible without warning the user.

#### Scenario: Tray quit immediately after typing

- **WHEN** the user types into a note and immediately quits from the tray menu
- **THEN** the last edit is present in `notes.json` after restarting the application

#### Scenario: In-app quit immediately after typing

- **WHEN** the user types into a note and immediately confirms the in-app quit action
- **THEN** the last edit is present in `notes.json` after restarting the application

#### Scenario: One window is unresponsive during quit

- **WHEN** one note window does not acknowledge the quit flush before the timeout
- **THEN** the application shows a quit confirmation offering retry or quit-without-saving (or records the timeout in the application log or store health event), and the note is retained

### Requirement: An unreadable database is never overwritten

The system SHALL distinguish a missing database from a database that exists but cannot be read. On a read failure other than "not found", the system MUST NOT create and persist a replacement database. It MUST attempt to back up the unreadable file, surface a startup error, and keep the existing file untouched unless the user explicitly chooses a recovery action.

#### Scenario: Database is locked by another process

- **WHEN** the application starts while `notes.json` exists but cannot be read because it is locked
- **THEN** the original file remains unchanged, a backup is attempted, and the user sees a startup error instead of a welcome note replacing the database

#### Scenario: Startup with an unreadable database

- **WHEN** the database cannot be read at startup and the user declines retry or retry fails
- **THEN** the application exits (or stays tray-resident with the error visible) without opening note windows from an empty store and without writing `notes.json`

#### Scenario: Database is missing

- **WHEN** no database file exists
- **THEN** the application creates a new database with the welcome note and persists it normally

### Requirement: Write failures are observable, retried, and never reported as saved

The system SHALL retain unsaved state when a disk write fails, retry with backoff, and expose a save-failure status to the interface. A write failure MUST be written to a durable application log. A final flush failure during close or quit MUST prevent the system from claiming that the note was saved.

#### Scenario: Disk write fails

- **WHEN** an edit cannot be written because the target path is unwritable (for example the parent path is a regular file, or the disk is full)
- **THEN** the in-memory change remains dirty, the UI shows a save failure, and the error appears in the application log or the store health event

#### Scenario: Write succeeds on retry

- **WHEN** a transient write failure is followed by a successful retry
- **THEN** the dirty state clears and the UI returns to the saved state without losing the edit

#### Scenario: Final flush fails during quit

- **WHEN** the final flush fails while the user quits the application
- **THEN** the application reports the failure or asks for confirmation instead of exiting as if the data were saved

### Requirement: Existing storage guarantees remain in effect

The system SHALL preserve atomic replacement of `notes.json`, debounced disk writes, corrupt-JSON backup, recovery of a leftover temporary file, and one-time import of legacy Electron data.

#### Scenario: Corrupt JSON is recovered

- **WHEN** `notes.json` contains invalid JSON at startup
- **THEN** the original bytes are copied to a timestamped backup and the application starts from an empty database

#### Scenario: Interrupted atomic write

- **WHEN** the application starts with a leftover temporary database and no main database
- **THEN** a parseable temporary database is promoted instead of being deleted

#### Scenario: Legacy Electron data exists

- **WHEN** the application starts for the first time and legacy Electron notes are present
- **THEN** those notes are imported without modifying the legacy source file

#### Scenario: Killed during an atomic write

- **WHEN** the application is terminated while the temporary database file is being written
- **THEN** `notes.json` is either the previous complete database or the new complete database, never a partially written main file, and it loads cleanly on next start

### Requirement: Persistence failures have regression coverage

The project SHALL include automated or scripted tests for immediate window close, immediate tray quit, unreadable database handling, and failed disk writes. The manual GUI checklist MUST include the same scenarios and verify the on-disk database, not only the absence of visible errors.

#### Scenario: Close and quit regression tests

- **WHEN** the persistence test suite runs
- **THEN** it covers close-before-IPC, quit-before-flush, unreadable-database, and write-failure paths and fails if any path silently loses data

#### Scenario: Manual verification

- **WHEN** a release candidate is tested manually
- **THEN** the tester records the on-disk result for immediate Alt+F4 and immediate tray quit, in addition to the existing close and quit cases
