# Spec Delta

## Purpose

Defines the security boundary between note webviews and the Rust command surface so that a note window can only affect its own note and cannot navigate into untrusted content.

## ADDED Requirements

### Requirement: Note webviews reject remote navigation

Each note webview SHALL only load the application's local frontend. Navigation to an HTTP(S) or other non-application URL MUST be blocked. The system MUST NOT expose the Tauri command surface to a page that is not the application's own frontend.

#### Scenario: Drag-and-drop a remote URL

- **WHEN** a remote URL is dropped onto a note window
- **THEN** the webview stays on the local note page and the remote page does not receive IPC access

#### Scenario: Programmatic navigation attempt

- **WHEN** page content attempts to navigate the note webview to a non-application origin
- **THEN** the navigation is cancelled and the current note remains open

### Requirement: Note webviews cannot open arbitrary new windows

A note webview SHALL NOT create additional native windows or webviews through page content. "New window" requests MUST be denied; note creation remains an explicit application command.

#### Scenario: Window.open from note content

- **WHEN** note content attempts to open a new window
- **THEN** no new native window is created and the request is ignored

### Requirement: Note commands are bound to the calling note

The note read and update commands SHALL verify that the calling webview's label matches the requested note id. A request from note A for note B's data or content MUST be rejected without modifying note B.

#### Scenario: Cross-note update attempt

- **WHEN** a note window for note A invokes the update command with note B's id
- **THEN** the request returns a failure and note B's content on disk is unchanged

#### Scenario: Cross-note read attempt

- **WHEN** a note window for note A requests note B's data
- **THEN** the request is rejected and no note B content is returned

### Requirement: Invalid command payloads are rejected safely

The note update command SHALL reject payloads that are not valid note fields, including invalid page structures, invalid colors, or out-of-range page indices. Rejection MUST NOT partially mutate the stored note.

#### Scenario: Malformed pages payload

- **WHEN** the frontend sends an update with a malformed page list
- **THEN** the command returns an error and the existing note remains unchanged

#### Scenario: Oversized payload

- **WHEN** an update exceeds the configured note/page size limit
- **THEN** the command rejects the update and reports the limit instead of writing it to disk
