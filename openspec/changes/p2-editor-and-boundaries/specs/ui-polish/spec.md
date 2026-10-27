# Spec Delta

## Purpose

Defines small but trust-affecting visual and state details in the note UI, including scrollbar visibility and behavior when note data is unavailable.

## ADDED Requirements

### Requirement: Preview scrollbars remain visible on light themes

The note preview scrollbar SHALL have sufficient contrast against all six light themes. The scrollbar thumb MUST be discoverable without hovering and MUST remain distinguishable on hover.

#### Scenario: Long note on white theme

- **WHEN** a note with overflowing content is displayed in the white theme
- **THEN** the preview scrollbar thumb is visible against the light preview background

#### Scenario: Scrollbar hover

- **WHEN** the user hovers the preview scrollbar
- **THEN** the thumb becomes more prominent without disappearing against the background

### Requirement: Missing note data produces an explicit state

If a note window cannot load its note data, the UI SHALL show an explicit unavailable/error state instead of a placeholder page count and empty editor. The state MUST offer a way to close the window or retry, and MUST NOT imply that the note was saved.

#### Scenario: Note not found

- **WHEN** a note window requests data for a note id that no longer exists
- **THEN** the editor, footer, and page placeholder are hidden, an explicit unavailable-note state is shown, and no fake page count is displayed

#### Scenario: Load command fails

- **WHEN** loading note data returns an error
- **THEN** the window reports the failure and offers retry or close
