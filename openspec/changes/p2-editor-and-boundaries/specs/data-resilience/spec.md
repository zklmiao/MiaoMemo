# Spec Delta

## Purpose

Defines how the note database tolerates duplicate identifiers, schema evolution, backup growth, and degraded writer threads without silently losing or mis-associating notes.

## ADDED Requirements

### Requirement: Duplicate note ids are repaired on load

The loader SHALL detect duplicate note ids. The first occurrence MAY keep its id; later duplicates MUST receive a new unique id or be merged deterministically. The repair MUST be persisted and MUST NOT drop note content silently.

#### Scenario: Two notes share an id

- **WHEN** `notes.json` contains two notes with the same id
- **THEN** both notes open as distinct windows after load, and the repaired database contains unique ids

#### Scenario: Repair is persisted

- **WHEN** duplicate ids are repaired during startup
- **THEN** the next read of `notes.json` shows unique ids and the backup policy has preserved the original file

### Requirement: Database schema version is recorded

The database SHALL carry a schema version when written. Files without a version MUST remain readable and MUST be upgraded in memory; the next successful write MUST persist the current version. Unknown future versions MUST not be silently downgraded or overwritten.

#### Scenario: Legacy file without a version

- **WHEN** an existing `notes.json` has no schema version
- **THEN** it loads successfully and the next write records the current version

#### Scenario: Future schema version

- **WHEN** the file declares a schema version newer than the application supports
- **THEN** the app refuses to overwrite it and reports a compatibility error

### Requirement: Corruption backups are bounded

The system SHALL retain a bounded number of corruption backups and SHALL not delete the most recent backup. Backup pruning MUST only affect files created by the application's backup mechanism.

#### Scenario: Many corrupt starts

- **WHEN** the application starts repeatedly with corrupt data
- **THEN** the oldest backups are pruned while the newest backup and the original file remain intact

#### Scenario: Unrelated files

- **WHEN** the backup directory contains files not created by the application
- **THEN** those files are not deleted by backup pruning

### Requirement: Store writer failures do not silently stop persistence

If the background writer thread panics, exits, or loses its channel, the store SHALL detect the condition and either restart the worker or surface a persistence error. Scheduled writes MUST NOT silently disappear without a health signal.

#### Scenario: Worker channel is closed

- **WHEN** a scheduled write cannot reach the worker
- **THEN** the store reports a degraded persistence state and the next flush attempts a direct write

#### Scenario: Mutex is poisoned

- **WHEN** a thread panics while holding the store lock
- **THEN** subsequent store operations recover the lock or return an explicit error instead of panicking the application
