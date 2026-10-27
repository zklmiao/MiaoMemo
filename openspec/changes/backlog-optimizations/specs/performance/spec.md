# Spec Delta

## Purpose

Defines measurable performance behavior for note editing, IPC traffic, and window geometry persistence so that the app remains responsive as note size and window count grow.

## ADDED Requirements

### Requirement: Saves are coalesced to the newest snapshot

While a note update is in flight, the frontend SHALL retain only the newest pending snapshot for that note and MAY discard intermediate snapshots. The final content MUST still be persisted, and the backend MUST NOT apply an older snapshot after a newer one.

#### Scenario: Fast typing while IPC is slow

- **WHEN** the user types several characters faster than the update round-trip
- **THEN** the last snapshot is persisted and an older snapshot does not overwrite it

#### Scenario: Save failure and retry

- **WHEN** the newest snapshot fails to send and a retry succeeds
- **THEN** the retried snapshot contains the latest text, not an older queued snapshot

### Requirement: Ordinary edits send only the affected page

An edit to the active page SHALL send only that page's title/content and page identity. Adding, deleting, or reordering pages MAY send the full page list. The receiving command MUST apply the update atomically and MUST leave all other pages unchanged.

#### Scenario: Large note, one page edited

- **WHEN** a note has many pages and the user edits one page
- **THEN** the update payload contains only that page, and every other page's stored title/content values are unchanged after the write

#### Scenario: Structural page change

- **WHEN** the user adds or deletes a page
- **THEN** the full page list is sent and the stored page order matches the UI

### Requirement: Window geometry is persisted at a bounded rate

Move/resize events SHALL NOT trigger an unbounded number of store updates. The system SHALL coalesce geometry changes to a bounded interval while guaranteeing that the final position and size are persisted after the user stops moving/resizing.

#### Scenario: Continuous drag

- **WHEN** the user drags a window for several seconds
- **THEN** geometry updates are coalesced and the final coordinates on disk match the window's final position

#### Scenario: App quits during a drag

- **WHEN** the app quits before the next geometry interval elapses
- **THEN** the final geometry is flushed before exit

### Requirement: Performance behavior is regression-tested

The project SHALL include repeatable checks, using payload inspection and an injectable clock or test double, that fail when a page-scoped edit regresses to sending the full page list, or when geometry updates exceed the coalescing bound defined in the design.

#### Scenario: Full-page regression

- **WHEN** the performance test observes a page-scoped edit whose payload contains the full page list
- **THEN** the test fails and reports the observed payload shape

#### Scenario: Geometry throttle regression

- **WHEN** the test drives a burst of move/resize events through an injectable clock
- **THEN** at most one geometry update is applied per throttle interval, a final update reflects the last position, and the test fails if the update count exceeds that bound
