# Spec Delta

## Purpose

Defines how note windows are created, placed, restored, and kept visible across monitors so that every note has exactly one usable window.

## ADDED Requirements

### Requirement: Rapid note creation produces distinct window positions

The system SHALL assign a distinct cascade position to every newly created note, even when multiple create actions occur before the previous window has finished opening. Positions of notes created in the same burst SHALL differ by at least the configured cascade step in the x or y axis, and the position SHALL NOT depend on whether the previous native window has already appeared.

#### Scenario: Two notes created in quick succession

- **WHEN** the user creates two notes within the window-creation latency window
- **THEN** the two windows' top-left positions differ by at least one cascade step in the x or y axis

#### Scenario: Tray double-click followed by another create

- **WHEN** the user creates a note from the tray and immediately creates another from a note window
- **THEN** both notes receive distinct positions separated by at least one cascade step

### Requirement: Restored windows remain on a connected display

The system SHALL validate stored window coordinates against the currently connected monitor work areas before showing a note. A note whose stored bounds do not intersect any connected display MUST be moved to a visible work area. The system SHALL use the work area, not the full monitor rectangle, so windows are not placed under the taskbar.

#### Scenario: Monitor was disconnected

- **WHEN** a note was stored on a secondary monitor that is no longer connected
- **THEN** the note opens fully inside a connected monitor's work area

#### Scenario: Stored position overlaps only the taskbar area

- **WHEN** the stored position would place the note under the taskbar
- **THEN** the window is adjusted into the usable work area

#### Scenario: Coordinates saved on a different-DPI monitor

- **WHEN** the stored coordinates were saved on a monitor with a different scale factor
- **THEN** the window is clamped into a connected work area using logical coordinates and does not open straddling an invisible region between displays

### Requirement: A note has at most one native window

The system SHALL guarantee that a note id maps to at most one open native window. Repeated create/show-all/single-instance actions for an already open note MUST focus the existing window instead of creating a duplicate. If window creation fails, the note MUST remain persisted and the failure MUST be observable.

#### Scenario: Show all is triggered twice

- **WHEN** the user triggers "show all notes" twice in quick succession
- **THEN** each note opens exactly one window and receives focus rather than creating duplicates

#### Scenario: Window creation fails

- **WHEN** the native window for a persisted note cannot be created
- **THEN** the note remains in `notes.json`, no window opens for it, and the failure is recorded in the application log or surfaced as a window-manager error
