# Spec Delta

## Purpose

Defines the release artifact behavior for first install, version consistency, and the documented signing/update posture.

## ADDED Requirements

### Requirement: WebView2 install mode is explicit and safe

The release SHALL declare which WebView2 install mode it uses and whether that mode requires network access. If the runtime is missing and cannot be installed, the installer MUST abort with a visible failure rather than completing without a working app. An offline variant that embeds the WebView2 runtime SHALL install without network access.

#### Scenario: Offline variant on an offline machine

- **WHEN** the offline installer variant runs on a machine without WebView2 and without network access
- **THEN** installation completes and the app launches

#### Scenario: Bootstrapper variant without network

- **WHEN** the bootstrapper variant runs on a machine without WebView2 and without network access
- **THEN** installation does not complete as if the app works, and the network prerequisite is declared in the README/release notes

#### Scenario: Online machine without WebView2

- **WHEN** the installer runs on a machine without WebView2 but with network access
- **THEN** the runtime is installed and the app launches after installation

### Requirement: Installer language and experience are explicit

The NSIS installer language set and install experience SHALL be explicitly configured or documented in the release notes, matching the product's primary audience.

#### Scenario: Default install experience

- **WHEN** a user runs the default installer
- **THEN** the installer language/experience matches the documented configuration instead of an unstated default

### Requirement: Signing and update posture is explicit

Release artifacts SHALL be code-signed or explicitly documented as unsigned. If an automatic update mechanism is introduced, update metadata and payloads MUST be verified before installation.

#### Scenario: Unsigned release

- **WHEN** a release is published without a code-signing certificate
- **THEN** the release notes state that SmartScreen may warn users and explain the expected behavior

#### Scenario: Signed update

- **WHEN** an update is delivered through the updater
- **THEN** the signature is verified and an invalid signature aborts the update
