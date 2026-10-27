# project-development Specification

## Purpose

Defines the architectural ownership, build/release conventions, and non-negotiable constraints that every MiaoMemo change must follow so the Tauri application stays maintainable, secure, and consistent with its Windows-only product scope.

## Requirements

### Requirement: Persistence is owned by the Rust backend

The Rust backend SHALL be the only component that reads or writes `notes.json`. The frontend MUST interact with notes exclusively through the documented Tauri command facade (`window.memoAPI`), and MUST NOT access the filesystem, construct file paths, or persist note content in browser storage.

#### Scenario: Frontend edit

- **WHEN** a note edit is made in the renderer
- **THEN** it is sent through `window.memoAPI` to a Rust command and the renderer does not read or write `notes.json` directly

#### Scenario: New persistence feature

- **WHEN** a change adds or modifies persistence behavior
- **THEN** the change updates `src-tauri/src/store.rs` and its Rust tests, and does not duplicate persistence logic in JavaScript

### Requirement: Tauri command surface stays explicit and minimal

Every Tauri command exposed to the frontend SHALL have a corresponding `window.memoAPI` method, a capability/security review, and a documented caller. Commands that are no longer used MUST be removed or assigned an owner and removal plan.

#### Scenario: Adding a command

- **WHEN** a change adds a Tauri command
- **THEN** the change updates the Rust handler registration, `src/api.js`, the capability configuration if needed, and the command documentation

#### Scenario: Dead command

- **WHEN** a command or `memoAPI` method has no caller
- **THEN** the change removes it or records an explicit owner and removal plan

### Requirement: Frontend assets and build configuration stay aligned

All frontend assets SHALL live under `src/`, and the Tauri configuration SHALL continue to use that directory as the frontend source. Any new asset origin (script, style, font, image) MUST be reflected in the CSP, and any new build input MUST be listed in the appropriate manifest.

#### Scenario: New frontend file

- **WHEN** a change adds a script, stylesheet, font, or static asset
- **THEN** the file is placed under `src/`, the CSP/frontend configuration permits it, and a dev or release smoke run loads the app without CSP violations

#### Scenario: Build input

- **WHEN** a change adds a file required at runtime
- **THEN** the packaged application includes it and a release build confirms the file is present

### Requirement: Window and layout invariants are preserved

The application SHALL keep its transparent, frameless, tray-resident note windows and the layout invariants that prevent overlap: header and footer remain non-shrinking, and body/editor/preview remain shrinkable with a zero minimum height. Dragging MUST use the Tauri drag-region mechanism and its capability, not Electron-only APIs.

#### Scenario: Window resize

- **WHEN** a note window is resized to a small size
- **THEN** the header, body, editor/preview, and footer do not overlap

#### Scenario: Drag region

- **WHEN** the user drags the header area
- **THEN** the window moves through the Tauri drag-region mechanism and buttons remain clickable

### Requirement: No Electron runtime or dependency is reintroduced

The project SHALL remain a Tauri 2 + Rust application. Electron, Electron Builder, Node-based preload/main-process code, and Electron data files MUST NOT be reintroduced as runtime dependencies or build inputs.

#### Scenario: Dependency review

- **WHEN** a dependency or build change is proposed
- **THEN** it does not add Electron or an Electron-only runtime requirement

#### Scenario: Legacy data

- **WHEN** the application reads legacy Electron data
- **THEN** that behavior is a one-time import in Rust and does not reintroduce an Electron runtime

### Requirement: Release manifests and versions stay synchronized

The version in `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `package.json` SHALL match for every release. `Cargo.lock` SHALL be committed, and the release build command MUST fail or warn when versions or required runtime files diverge.

#### Scenario: Version bump

- **WHEN** a release version is changed
- **THEN** all three manifests are updated together and the release check passes

#### Scenario: Lockfile

- **WHEN** Rust dependencies change
- **THEN** `Cargo.lock` is updated and committed

### Requirement: Security defaults are preserved

Note webviews SHALL load only local application content, SHALL keep a restrictive CSP, SHALL use the smallest practical Tauri capability set, and SHALL NOT expose arbitrary filesystem or shell access to page content.

#### Scenario: New capability

- **WHEN** a change needs a new Tauri capability
- **THEN** the capability is narrowly scoped and documented, and remote content remains unable to invoke note commands

#### Scenario: Navigation

- **WHEN** page content attempts to navigate to a non-application URL
- **THEN** the navigation is rejected by the application boundary

### Requirement: Behavior changes carry documentation and a verification plan

A behavior-changing proposal SHALL update the relevant user or developer documentation and specify how the behavior will be verified. Architecture or data-path changes MUST update `AGENTS.md`; user-facing behavior changes MUST update `README.md` and the manual checklist.

#### Scenario: User-facing change

- **WHEN** a change alters a user-visible flow
- **THEN** the README and `tests/MANUAL.md` describe the new behavior and its verification steps

#### Scenario: Architecture change

- **WHEN** a change moves ownership between Rust and the frontend or changes the data path
- **THEN** `AGENTS.md` is updated in the same change
