# Spec Delta

## Purpose

Defines the observable behavior of page navigation, note deletion, context menus, and keyboard interaction so that note actions are predictable for mouse, keyboard, and assistive-technology users.

## ADDED Requirements

### Requirement: Page actions are serialized

The system SHALL execute each page navigation or page deletion action at most once. While a page action is pending, additional next/previous/delete activations MUST be ignored or queued behind the first action, and the resulting page index MUST be computed from the state after the first action completes.

#### Scenario: Next is double-clicked

- **WHEN** the user double-clicks the next-page button
- **THEN** the note advances exactly one page, not two

#### Scenario: Delete is double-clicked on an empty page

- **WHEN** the user double-clicks the delete-page button on an empty page
- **THEN** exactly one page is removed and at least one page remains

#### Scenario: Delete confirmation is double-clicked

- **WHEN** the user double-clicks the confirm button in the delete-page dialog
- **THEN** exactly one page is deleted and the remaining page count is correct

### Requirement: The theme submenu is fully visible near window edges

When the context menu is opened near the right or bottom edge of the note window, the system SHALL position the theme submenu so that every theme item remains fully visible and clickable. The submenu MUST flip to the opposite side or use an overlay that is not clipped by the note container.

#### Scenario: Right-click near the right edge

- **WHEN** the user right-clicks near the right edge of a default-width note
- **THEN** the complete theme submenu is visible inside the window and all six theme items can be selected

#### Scenario: Right-click near the bottom edge

- **WHEN** the user right-clicks near the bottom edge
- **THEN** the context menu and submenu are repositioned so every item remains inside the note window's viewport

### Requirement: Menus and dialogs are keyboard operable

The page-jump menu, theme submenu, context menu, and confirmation dialogs SHALL be reachable and operable with a keyboard. Menu items MUST expose a visible focus state and support Enter/Space activation. Dialogs MUST move focus into the dialog, keep Tab focus inside it, close on Escape or the cancel action, and return focus to the trigger.

#### Scenario: Keyboard page jump

- **WHEN** the user focuses the page indicator and presses Enter, then selects a page with the keyboard
- **THEN** the note jumps to the selected page without requiring a mouse

#### Scenario: Keyboard theme selection

- **WHEN** the user opens the context menu and navigates to the theme submenu with the keyboard
- **THEN** the theme items are reachable and selecting one changes the theme

#### Scenario: Dialog focus and Escape

- **WHEN** a confirmation dialog opens and the user presses Tab or Escape
- **THEN** focus remains inside the dialog while it is open, Escape closes it, and focus returns to the button that opened it

### Requirement: A non-empty note can be deleted

The system SHALL provide a user-facing action to delete the current note, including notes with content. The action MUST require confirmation. Confirming SHALL remove the note from `notes.json`, close its window, and update the remaining note set; cancelling MUST leave the note and its window unchanged.

#### Scenario: Delete a note with content

- **WHEN** the user chooses "delete note" for a note containing text and confirms
- **THEN** the note is removed from `notes.json`, its window closes, and reopening the app does not show it

#### Scenario: Cancel note deletion

- **WHEN** the user chooses "delete note" and cancels the confirmation
- **THEN** the note and its content remain unchanged

### Requirement: Page indicator exposes accessible page status

The page indicator SHALL use a coherent accessible structure that does not nest interactive controls inside an element claiming to be a button. The current page and total page count SHALL be exposed through an accessible name and a live region (or equivalent) so that a page change updates the announced text.

#### Scenario: Page change is announced

- **WHEN** the current page changes
- **THEN** the live region's content updates to the new current/total value and the indicator's accessible name reflects it

#### Scenario: ARIA structure

- **WHEN** the page indicator markup is inspected
- **THEN** no interactive control is nested inside an element with `role="button"`, and the page-list trigger is itself a focusable control
