# Spec Delta

## Purpose

Defines optional product-experience improvements for managing many notes, respecting motion preferences, supporting a dark appearance, and using a real Windows acrylic material without regressing legibility.

## ADDED Requirements

### Requirement: Users can manage a large note set without opening every window

The system SHALL provide a note-management surface (or equivalent flow) that lists persisted notes with their titles and lets the user open/focus one note at a time. "Show all" MUST NOT create an unbounded number of native windows for a large note set.

#### Scenario: Twenty stored notes

- **WHEN** the user invokes "show all" with twenty stored notes
- **THEN** a manageable list or bounded selection UI appears instead of twenty simultaneous windows

#### Scenario: Focus a note from the manager

- **WHEN** the user selects a note in the manager
- **THEN** that note's window opens or is focused, and the manager remains usable

### Requirement: Motion follows the operating-system preference

When the operating system requests reduced motion, the app SHALL disable or shorten non-essential transitions and animations. Essential feedback such as focus outlines and save status MUST remain visible.

#### Scenario: Reduced motion enabled

- **WHEN** `prefers-reduced-motion: reduce` is active
- **THEN** menu/dialog scaling and other decorative transitions are removed or shortened

#### Scenario: Focus remains visible

- **WHEN** reduced motion is active
- **THEN** keyboard focus outlines and status text are still perceivable

### Requirement: Dark appearance remains legible and persistent

If a dark appearance is offered, it SHALL apply to the note surfaces, menus, dialogs, and text with readable contrast, and the user's choice SHALL persist across restarts.

#### Scenario: Switch to dark appearance

- **WHEN** the user selects the dark appearance
- **THEN** note text, menus, and dialogs remain readable and the choice survives a restart

#### Scenario: Theme and appearance interact

- **WHEN** a colored note theme is used in dark appearance
- **THEN** the accent and text colors remain legible and the theme selection is not lost

### Requirement: Real acrylic is an explicit, testable mode

If a native Windows acrylic mode is offered, the system SHALL use a real system window material rather than only CSS transparency, and the mode SHALL be disableable. If the platform or composition mode does not support it, or the material fails to apply, the app MUST fall back to the existing translucent CSS material.

#### Scenario: Acrylic supported

- **WHEN** the user enables the acrylic mode on a supported Windows build
- **THEN** the window uses the system material and the note text and controls remain visible and interactive

#### Scenario: Acrylic unsupported or failed

- **WHEN** the acrylic mode is requested on an unsupported machine/composition mode, or applying the material fails
- **THEN** the app falls back to the translucent CSS material and the note text and controls remain visible and interactive (no black/blank window)
