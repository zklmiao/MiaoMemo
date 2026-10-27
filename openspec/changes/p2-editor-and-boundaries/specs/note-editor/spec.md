# Spec Delta

## Purpose

Defines correct, predictable editing behavior for Markdown inline formatting, task lists, list indentation, title derivation, and checkbox interaction.

## ADDED Requirements

### Requirement: Inline emphasis parses mixed bold and italic correctly

The preview renderer SHALL convert `***text***` into correctly nested bold and italic emphasis without producing unbalanced or overlapping HTML tags. Mixed forms such as `**bold and *italic***` MUST remain valid inline HTML.

#### Scenario: Triple emphasis

- **WHEN** a note line contains `***important***`
- **THEN** the preview displays the text as bold and italic with balanced markup

#### Scenario: Mixed emphasis

- **WHEN** a line contains bold and italic spans in the same line
- **THEN** each span is rendered with the intended emphasis and no raw asterisks remain

### Requirement: Task-list Enter creates or exits items predictably

Pressing Enter in a task-list line SHALL continue the list with a new unchecked item when the current item has content. Pressing Enter on an empty task item SHALL remove the list prefix from that line and exit the list instead of creating another empty item. Shift+Enter SHALL insert a line break within the current item rather than creating a new item.

#### Scenario: Continue a task list

- **WHEN** the caret is at the end of `- [ ] Buy milk` and the user presses Enter
- **THEN** a new line `- [ ] ` is created below it

#### Scenario: Exit an empty task item

- **WHEN** the caret is on an empty `- [ ] ` line and the user presses Enter
- **THEN** the prefix is removed and the caret remains on a plain empty line

#### Scenario: Shift+Enter inside a task item

- **WHEN** the user presses Shift+Enter inside a task item
- **THEN** the editor inserts a line break without adding a new checkbox prefix

### Requirement: Tab indents and outdents list items

When the caret is inside a list item, Tab SHALL increase the item's indentation by one level and Shift+Tab SHALL decrease it by one level, without moving focus out of the editor. On a non-list line, Tab MAY retain the platform's default focus behavior.

#### Scenario: Indent a list item

- **WHEN** the caret is on `- item` and the user presses Tab
- **THEN** the line gains one indentation level and the preview shows the next list depth

#### Scenario: Outdent a list item

- **WHEN** the caret is on an indented list item and the user presses Shift+Tab
- **THEN** the line loses one indentation level without leaving the editor

### Requirement: List shortcuts do not hijack IME composition

While an IME composition is active, Shift+Enter, Tab, and Shift+Tab SHALL NOT be intercepted by list editing. The composition MUST continue uninterrupted, and indentation changes MUST NOT be applied until the composition ends.

#### Scenario: Tab during composition

- **WHEN** the user is composing text with an IME and presses Tab inside a list line
- **THEN** the composition is not cancelled and no indentation change is applied while composing

### Requirement: Titles preserve meaningful hyphens

Title extraction from the first content line SHALL remove Markdown heading/emphasis markers but SHALL preserve hyphens inside dates, identifiers, and hyphenated words.

#### Scenario: Date title

- **WHEN** the first line is `2026-10-27 会议记录`
- **THEN** the derived title retains `2026-10-27` instead of concatenating the digits

#### Scenario: Heading marker

- **WHEN** the first line is `# 项目计划`
- **THEN** the derived title is `项目计划` without the leading `#`

### Requirement: Preview checkboxes toggle the correct source line

Toggling a preview checkbox SHALL update the source line that produced that checkbox, even if the rendered line index and the current textarea line index have diverged. If the mapping cannot be trusted, the system SHALL re-render or rebuild the mapping before toggling rather than toggling a different line.

#### Scenario: Re-render before changing text

- **WHEN** the note text is programmatically changed while the preview is visible
- **THEN** the next checkbox click updates the checkbox's current source line, not a stale index

#### Scenario: Normal toggle

- **WHEN** the user clicks the checkbox for a task item
- **THEN** only that item's `[ ]`/`[x]` marker changes in the source text
