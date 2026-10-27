# Spec Delta

## Purpose

Defines the project-level quality gates, window-operation serialization, and dependency/maintenance expectations that keep the Tauri app safe to change.

## ADDED Requirements

### Requirement: Static analysis and tests gate changes

Every proposed change SHALL pass the project's formatting, static analysis, JS tests, Rust tests, and release build checks in CI before it is considered mergeable. Failures MUST be visible on the change rather than left to a manual release step.

#### Scenario: Clippy regression

- **WHEN** a change introduces a clippy warning under `-D warnings`
- **THEN** CI fails and reports the warning location

#### Scenario: Test regression

- **WHEN** a change breaks a JS or Rust test
- **THEN** CI fails and the change is not mergeable

### Requirement: Dependency risk is reviewed

The project SHALL run a dependency audit on a schedule and before releases. High- or critical-severity findings MUST be fixed, upgraded, or explicitly documented with a mitigation before release.

#### Scenario: Vulnerable dependency

- **WHEN** the audit reports a high-severity advisory in a direct or transitive dependency
- **THEN** the release is blocked until the dependency is upgraded or the risk is documented and accepted

### Requirement: Window operations are applied in request order

Create, close, show-all, and always-on-top operations SHALL be applied in request order by a serialized owner. Repeated show-all requests MUST reuse existing windows rather than racing new ones, and a rapid pin toggle MUST leave the native always-on-top state matching the final note state.

#### Scenario: Repeated show-all

- **WHEN** show-all is requested twice while a window is being created
- **THEN** no duplicate window is created and the second request reuses the first result

#### Scenario: Overlapping pin toggle

- **WHEN** pin state is toggled twice quickly
- **THEN** the final native always-on-top state matches the final note state

### Requirement: Release-critical flows have an automated or scripted check

The project SHALL have an automated or scripted end-to-end check for at least: create note, edit and persist, close and reopen, quit and relaunch, and single-instance behavior. If a full webview e2e harness is not available, the scripted manual checklist MUST be versioned and executed for each release candidate.

#### Scenario: Release candidate check

- **WHEN** a release candidate is prepared
- **THEN** the create/edit/close/quit/single-instance checks are executed and their on-disk results are recorded
