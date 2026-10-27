const noteId = window.memoAPI.noteId;

const memoContainer = document.getElementById('memoContainer');
const memoHeader = document.getElementById('memoHeader');
const memoTextarea = document.getElementById('memoTextarea');
const memoPreview = document.getElementById('memoPreview');
const memoTitleInput = document.getElementById('memoTitleInput');

const pinBtn = document.getElementById('pinBtn');
const addNoteBtn = document.getElementById('addNoteBtn');
const closeBtn = document.getElementById('closeBtn');

const contextMenu = document.getElementById('contextMenu');
const menuNewNote = document.getElementById('menuNewNote');
const themeSubmenu = document.getElementById('themeSubmenu');

const pagesMenu = document.getElementById('pagesMenu');
const pagesMenuList = document.getElementById('pagesMenuList');
const pageIndicatorContainer = document.getElementById('pageIndicatorContainer');

const confirmOverlay = document.getElementById('confirmOverlay');
const cancelCloseBtn = document.getElementById('cancelCloseBtn');
const closeWindowBtn = document.getElementById('closeWindowBtn');
const quitAppBtn = document.getElementById('quitAppBtn');

// Multi-page UI Element hooks
const prevPageBtn = document.getElementById('prevPageBtn');
const pageIndicator = document.getElementById('pageIndicator');
const nextPageBtn = document.getElementById('nextPageBtn');
const addPageBtn = document.getElementById('addPageBtn');
const deletePageBtn = document.getElementById('deletePageBtn');

const pageConfirmOverlay = document.getElementById('pageConfirmOverlay');
const cancelDeletePageBtn = document.getElementById('cancelDeletePageBtn');
const confirmDeletePageBtn = document.getElementById('confirmDeletePageBtn');

// Note state
let isPinned = false;

// Multi-page state: array of { title: string, content: string }
let notePages = [{ title: '', content: '' }];
let currentPageIndex = 0;

// Serialize IPC writes so a slow earlier save can never overwrite a newer one.
let saveChain = Promise.resolve();

// --- Helpers (真实逻辑位于 noteUtils.js，经 <script> 以 window.NoteUtils 注入；此处取用全局，杜绝复刻漂移) ---
const NoteUtilsGlobal = (typeof window !== 'undefined' && window.NoteUtils) ? window.NoteUtils : null;

function extractTitleFromText(text, maxLen = 16) {
  if (NoteUtilsGlobal) {
    return NoteUtilsGlobal.extractTitleFromText(text, maxLen);
  }
  if (!text) return '';
  const firstLine = text.trim().split('\n')[0] || '';
  return firstLine.replace(/[#*`_\-]/g, '').trim().substring(0, maxLen);
}

function syncCurrentPage() {
  notePages[currentPageIndex] = {
    title: memoTitleInput.value,
    content: memoTextarea.value
  };
}

function getSubmenuItems() {
  return themeSubmenu.querySelectorAll('.submenu-item');
}

async function safeUpdateNote(fields) {
  // Deep-copy immediately: queued writes must not observe later page mutations.
  const payload = JSON.parse(JSON.stringify(fields));
  saveChain = saveChain
    .then(() => window.memoAPI.updateNote(noteId, payload))
    .catch((e) => {
      console.error('updateNote failed:', e);
    });
  return saveChain;
}

// Persist the current page immediately. Every input already queues an update,
// so this mainly guarantees ordering before page switches and window close.
async function flushPendingSave() {
  syncCurrentPage();
  await safeUpdateNote({
    pages: notePages,
    currentPageIndex: currentPageIndex
  });
}

// Initialize Note Data
async function initNote() {
  if (!noteId) return;

  let note = null;
  try {
    note = await window.memoAPI.getNoteData(noteId);
  } catch (e) {
    console.error('getNoteData failed:', e);
    return;
  }
  if (!note) return;

  // Apply visual settings
  isPinned = note.isPinned || false;

  // Set Theme
  applyTheme(note.color || 'white');

  // Handle database migration for multi-page support with titles
  if (note.pages && Array.isArray(note.pages)) {
    notePages = note.pages.map(page => {
      if (typeof page === 'string') {
        return {
          title: extractTitleFromText(page),
          content: page
        };
      }
      return {
        title: page.title || '',
        content: page.content || ''
      };
    });
  } else {
    const rawContent = note.content || '';
    notePages = [{
      title: extractTitleFromText(rawContent),
      content: rawContent
    }];
  }

  currentPageIndex = note.currentPageIndex !== undefined ? note.currentPageIndex : 0;
  if (currentPageIndex >= notePages.length) {
    currentPageIndex = 0;
  }

  // Load active page contents
  loadPageContent();

  // Set Pinned state
  if (isPinned) {
    pinBtn.classList.add('pinned');
    pinBtn.setAttribute('aria-pressed', 'true');
  }

  // Focus editor if current page is empty (enter edit mode directly)
  if (notePages[currentPageIndex].content === '' && notePages[currentPageIndex].title === '') {
    switchToEditMode();
    memoTitleInput.focus();
  }
}

// Load content and update controls for the active page index
function loadPageContent() {
  memoTitleInput.value = notePages[currentPageIndex]?.title || '';
  memoTextarea.value = notePages[currentPageIndex]?.content || '';
  updatePageControls();
  switchToPreviewMode();
  // If page is empty, go straight to edit mode so focus() lands on a visible field
  if (!memoTitleInput.value && !memoTextarea.value) {
    switchToEditMode();
  }
}

function updatePageControls() {
  const totalPages = notePages.length;
  pageIndicator.textContent = `${currentPageIndex + 1} / ${totalPages}`;

  prevPageBtn.disabled = currentPageIndex <= 0;
  nextPageBtn.disabled = currentPageIndex >= totalPages - 1;
  deletePageBtn.disabled = totalPages <= 1;
}

// Apply theme class and highlight corresponding context submenu color dot
function applyTheme(colorName) {
  // Remove only theme-* classes to preserve future body classes
  [...document.body.classList]
    .filter(c => c.startsWith('theme-'))
    .forEach(c => document.body.classList.remove(c));
  document.body.classList.add(`theme-${colorName}`);

  // Highlight active submenu item color dot (re-query: static DOM but robust)
  getSubmenuItems().forEach(item => {
    if (item.getAttribute('data-color') === colorName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// Auto-save to the Rust backend on every edit. The backend coalesces disk writes;
// keeping the IPC write immediate removes the old 400ms close/quit data-loss window.
function triggerAutoSave() {
  syncCurrentPage();
  void safeUpdateNote({
    pages: notePages,
    currentPageIndex: currentPageIndex
  });
}

// Add Note Button
addNoteBtn.addEventListener('click', () => {
  try {
    const p = window.memoAPI.createNote();
    if (p && typeof p.catch === 'function') {
      p.catch(e => console.error('createNote failed:', e));
    }
  } catch (e) {
    console.error('createNote failed:', e);
  }
});

// Title input listener to trigger auto save
memoTitleInput.addEventListener('input', () => {
  triggerAutoSave();
});

// Text Area inputs
memoTextarea.addEventListener('input', () => {
  triggerAutoSave();
});

// Switch to preview mode when textarea loses focus
memoTextarea.addEventListener('blur', (e) => {
  // Use timeout to allow action buttons or checkbox click handler to run first
  setTimeout(() => {
    // If the active element is still something that shouldn't trigger preview, skip
    if (document.activeElement === memoTextarea || document.activeElement === memoTitleInput) return;
    switchToPreviewMode();
  }, 180);
});

// Render Preview function
function renderPreview() {
  const text = memoTextarea.value;
  if (!text.trim()) {
    memoPreview.innerHTML = `<div style="opacity: 0.3; font-style: italic;">在此输入便签内容... (点击编辑)</div>`;
    return;
  }

  const lines = text.split('\n');
  const rendered = lines.map((line, index) => {
    // Match checklist: optional whitespace + "- [ ]" or "- [x]" + text
    const checkMatch = line.match(/^(\s*-\s*)\[([ xX])\]\s*(.*)$/);
    if (checkMatch) {
      const isChecked = checkMatch[2].toLowerCase() === 'x';
      const content = checkMatch[3];
      return `<div class="preview-line checklist-item" data-line-index="${index}">
        <span class="preview-checkbox${isChecked ? ' checked' : ''}" data-line-index="${index}" tabindex="0" role="checkbox" aria-checked="${isChecked}" aria-label="任务复选框第 ${index + 1} 行"></span>
        <span class="item-text">${parseMarkdownInline(content)}</span>
      </div>`;
    }

    // Unordered list (multi-level: -, *, + with indentation)
    const ulMatch = line.match(/^(\s*)([-*+])(\s+)(.*)$/);
    if (ulMatch) {
      const leadingSpaces = ulMatch[1].replace(/\t/g, '  ').length;
      const level = Math.min(Math.floor(leadingSpaces / 2) + 1, 3);
      const content = ulMatch[4];
      const bulletChars = ['•', '◦', '▪'];
      const fontSizes = ['18px', '16px', '14px'];
      const bulletSizes = ['28px', '26px', '24px'];
      const opacities = ['0.65', '0.5', '0.35'];
      return `<div class="preview-line unordered-list-item" data-level="${level}" style="padding-left: ${(level - 1) * 28}px; font-size: ${fontSizes[level - 1]};">
        <span class="list-bullet" aria-hidden="true" style="font-size: ${bulletSizes[level - 1]}; opacity: ${opacities[level - 1]};">${bulletChars[level - 1]}</span>
        <span class="item-text">${parseMarkdownInline(content)}</span>
      </div>`;
    }

    // Headers
    if (line.startsWith('# ')) {
      return `<h1 class="preview-line" style="margin: 4px 0; font-size: 22px;">${parseMarkdownInline(line.substring(2))}</h1>`;
    }
    if (line.startsWith('## ')) {
      return `<h2 class="preview-line" style="margin: 4px 0; font-size: 18px;">${parseMarkdownInline(line.substring(3))}</h2>`;
    }

    // Default plain line
    return `<div class="preview-line" data-line-index="${index}">${parseMarkdownInline(line) || '&nbsp;'}</div>`;
  });

  memoPreview.innerHTML = rendered.join('');
}

// Simple HTML escaping and inline markdown parser (bold, italic)
function parseMarkdownInline(text) {
  let html = escapeHtml(text);
  // Bold **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  return html;
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Switch between preview and edit mode
function switchToEditMode() {
  memoPreview.style.display = 'none';
  memoTextarea.style.display = 'block';
  memoTextarea.focus();
}

function switchToPreviewMode() {
  renderPreview();
  memoTextarea.style.display = 'none';
  memoPreview.style.display = 'block';
}

// Click listener on Preview container
memoPreview.addEventListener('click', (e) => {
  // If clicked on checkbox, toggle checkbox state
  const checkbox = e.target.closest('.preview-checkbox');
  if (checkbox) {
    e.stopPropagation();
    const lineIndex = parseInt(checkbox.getAttribute('data-line-index'));
    toggleCheckboxAtLine(lineIndex);
    return;
  }

  // Otherwise, switch to edit mode
  switchToEditMode();
});

// Keyboard support for preview checkboxes (Space / Enter)
memoPreview.addEventListener('keydown', (e) => {
  const checkbox = e.target.closest ? e.target.closest('.preview-checkbox') : null;
  if (checkbox && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    const lineIndex = parseInt(checkbox.getAttribute('data-line-index'));
    toggleCheckboxAtLine(lineIndex);
  }
});

// Toggle checkbox in raw text
function toggleCheckboxAtLine(lineIndex) {
  const lines = memoTextarea.value.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return;
  const checkMatch = line.match(/^(\s*-\s*)\[([ xX])\]\s*(.*)$/);
  if (checkMatch) {
    const indent = checkMatch[1];
    const isChecked = checkMatch[2].toLowerCase() === 'x';
    const newStatus = isChecked ? ' ' : 'x';
    const content = checkMatch[3];

    lines[lineIndex] = `${indent}[${newStatus}] ${content}`;
    memoTextarea.value = lines.join('\n');

    // Save and update UI
    triggerAutoSave();
    renderPreview();
  }
}

// Click to toggle interactive markdown checkboxes (- [ ] / - [x])
memoTextarea.addEventListener('click', (e) => {
  const textarea = e.target;
  const pos = textarea.selectionStart;
  const val = textarea.value;

  // Find start and end of the clicked line
  const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
  const lineEnd = val.indexOf('\n', pos);
  const actualEnd = lineEnd === -1 ? val.length : lineEnd;
  const currentLine = val.substring(lineStart, actualEnd);

  // Match checkbox pattern at the beginning of the line: optional whitespace + "- [ ]" or "- [x]"
  const match = currentLine.match(/^(\s*-\s*\[[ xX]\]\s*)/);
  if (match) {
    // Locate the brackets in the current line
    const braceStart = currentLine.indexOf('[');
    const braceEnd = currentLine.indexOf(']');

    // Check if user clicked within the brackets [ ] or [x]
    const clickOffset = pos - lineStart;
    if (clickOffset >= braceStart && clickOffset <= braceEnd + 1) {
      const isChecked = currentLine.charAt(braceStart + 1).toLowerCase() === 'x';
      const newStatus = isChecked ? ' ' : 'x';

      const checkboxContentIndex = lineStart + braceStart + 1;
      const newVal = val.substring(0, checkboxContentIndex) + newStatus + val.substring(checkboxContentIndex + 1);

      textarea.value = newVal;
      textarea.selectionStart = textarea.selectionEnd = pos; // Restore cursor position

      triggerAutoSave();
    }
  }
});

// Pinned State Toggle
pinBtn.addEventListener('click', async () => {
  isPinned = !isPinned;
  pinBtn.classList.toggle('pinned', isPinned);
  pinBtn.setAttribute('aria-pressed', String(isPinned));
  await safeUpdateNote({ isPinned });
});

// Right-click Context Menu implementation
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // Don't show context menu if clicking action buttons in header or footer
  if (e.target.closest('.header-actions') || e.target.closest('.memo-footer') || e.target.closest('.confirm-overlay') || e.target.closest('.pages-menu')) return;

  // Hide pages menu if open
  pagesMenu.style.display = 'none';

  // Clamp to viewport to avoid overflow
  const menuW = 130;
  const menuH = 80;
  const x = Math.min(e.clientX, window.innerWidth - menuW - 4);
  const y = Math.min(e.clientY, window.innerHeight - menuH - 4);
  contextMenu.style.left = `${Math.max(0, x)}px`;
  contextMenu.style.top = `${Math.max(0, y)}px`;
  contextMenu.style.display = 'block';
});

// Single global click handler: dismiss context menu + pages menu
document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    contextMenu.style.display = 'none';
  }
  if (!pagesMenu.contains(e.target) && !pageIndicatorContainer.contains(e.target)) {
    pagesMenu.style.display = 'none';
  }
});

// Dismiss menus on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    contextMenu.style.display = 'none';
    pagesMenu.style.display = 'none';
  }
});

// Context Menu: Create New Note
function handleMenuNewNote() {
  try {
    const p = window.memoAPI.createNote();
    if (p && typeof p.catch === 'function') {
      p.catch(err => console.error('createNote failed:', err));
    }
  } catch (e) {
    console.error('createNote failed:', e);
  }
  contextMenu.style.display = 'none';
}
menuNewNote.addEventListener('click', handleMenuNewNote);
menuNewNote.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    handleMenuNewNote();
  }
});

// Context Submenu: Switch Themes
function bindThemeItem(item) {
  const activate = async () => {
    const selectedColor = item.getAttribute('data-color');
    applyTheme(selectedColor);
    contextMenu.style.display = 'none';
    await safeUpdateNote({ color: selectedColor });
  };
  item.addEventListener('click', activate);
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  });
}
getSubmenuItems().forEach(bindThemeItem);

// --- Page outline jump-to-page menu ---

// Render and populate the page jump menu
function renderPagesMenu() {
  pagesMenuList.innerHTML = '';
  notePages.forEach((page, index) => {
    const item = document.createElement('div');
    item.className = 'pages-menu-item';
    item.setAttribute('role', 'menuitem');
    if (index === currentPageIndex) {
      item.classList.add('active');
      item.setAttribute('aria-current', 'true');
    }

    // Get title display name: Priority title, then text first line, then 无标题
    let titleText = (page.title || '').trim();
    if (!titleText) {
      titleText = extractTitleFromText(page.content || '');
    }
    titleText = titleText || '无标题';

    item.textContent = `${index + 1}. ${titleText}`;

    // Click item to jump
    item.addEventListener('click', async () => {
      // Flush pending edits before switching to avoid stale-timer overwrite
      await flushPendingSave();

      currentPageIndex = index;
      loadPageContent();
      pagesMenu.style.display = 'none';
      await safeUpdateNote({ currentPageIndex });
    });

    pagesMenuList.appendChild(item);
  });
}

// Toggle Pages list menu when clicking pageIndicatorContainer
function togglePagesMenu(e) {
  if (e) e.stopPropagation();

  if (pagesMenu.style.display === 'block') {
    pagesMenu.style.display = 'none';
  } else {
    // Hide context menu if open
    contextMenu.style.display = 'none';

    // Sync active page before rendering menu list
    syncCurrentPage();

    // Render and show
    renderPagesMenu();
    pagesMenu.style.display = 'block';
  }
}
pageIndicatorContainer.addEventListener('click', togglePagesMenu);
pageIndicatorContainer.addEventListener('keydown', (e) => {
  // Ignore Enter/Space on the nested prev/next buttons; otherwise their
  // native activation is cancelled and the jump menu opens instead.
  if (e.target !== pageIndicatorContainer) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    togglePagesMenu(e);
  }
});

// Close Note Actions
closeBtn.addEventListener('click', () => {
  confirmOverlay.classList.add('open');
});

// Cancel close dialog
cancelCloseBtn.addEventListener('click', () => {
  confirmOverlay.classList.remove('open');
});

// Close window (flush pending edits first)
closeWindowBtn.addEventListener('click', async () => {
  confirmOverlay.classList.remove('open');
  await flushPendingSave();
  try {
    await window.memoAPI.closeWindow(noteId);
  } catch (e) {
    console.error('closeWindow failed:', e);
  }
});

// Quit app entirely (flush first)
quitAppBtn.addEventListener('click', async () => {
  confirmOverlay.classList.remove('open');
  await flushPendingSave();
  try {
    await window.memoAPI.quitApp();
  } catch (e) {
    console.error('quitApp failed:', e);
  }
});

// Auto-expand list items on Enter (helpful for task lists)
memoTextarea.addEventListener('keydown', (e) => {
  // Never hijack Enter while an IME is composing (Chinese/Japanese input).
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    const textarea = e.target;
    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;
    const val = textarea.value;

    // Get text of current line before Enter was pressed
    const lineStart = val.lastIndexOf('\n', startPos - 1) + 1;
    const currentLine = val.substring(lineStart, startPos);

    // Match "- [ ] ", "- [x] ", or "- " / "* " / "+ " prefix
    const checkListMatch = currentLine.match(/^(\s*-\s*\[[ xX]\]\s*)/);
    const bulletMatch = currentLine.match(/^(\s*[-*+]\s+)/);

    if (checkListMatch) {
      e.preventDefault();
      const prefix = '\n' + checkListMatch[1].replace(/\[[xX]\]/, '[ ]'); // New list item starts unchecked
      textarea.value = val.substring(0, startPos) + prefix + val.substring(endPos);
      textarea.selectionStart = textarea.selectionEnd = startPos + prefix.length;
      triggerAutoSave();
    } else if (bulletMatch) {
      e.preventDefault();
      const prefix = '\n' + bulletMatch[1];
      textarea.value = val.substring(0, startPos) + prefix + val.substring(endPos);
      textarea.selectionStart = textarea.selectionEnd = startPos + prefix.length;
      triggerAutoSave();
    }
  }
});

// --- Page Control Event Handlers ---

// Flip to previous page
prevPageBtn.addEventListener('click', async () => {
  if (currentPageIndex > 0) {
    await flushPendingSave();
    currentPageIndex--;
    loadPageContent();
    await safeUpdateNote({ currentPageIndex });
  }
});

// Flip to next page
nextPageBtn.addEventListener('click', async () => {
  if (currentPageIndex < notePages.length - 1) {
    await flushPendingSave();
    currentPageIndex++;
    loadPageContent();
    await safeUpdateNote({ currentPageIndex });
  }
});

// Add a new blank page
addPageBtn.addEventListener('click', async () => {
  await flushPendingSave();

  // Insert new empty page after the current page index
  notePages.splice(currentPageIndex + 1, 0, { title: '', content: '' });
  currentPageIndex++;

  loadPageContent();
  memoTitleInput.focus(); // Focus the title input of new page first
  await safeUpdateNote({
    pages: notePages,
    currentPageIndex
  });
});

// Delete active page action
deletePageBtn.addEventListener('click', async () => {
  if (notePages.length <= 1) return; // Double protection

  const text = memoTextarea.value.trim();
  const title = memoTitleInput.value.trim();
  if (text === '' && title === '') {
    // If empty page, delete immediately (flush first to cancel stale writes)
    await flushPendingSave();
    await deleteCurrentPage();
  } else {
    // If text exists, prompt overlay
    pageConfirmOverlay.classList.add('open');
  }
});

// Cancel page deletion modal
cancelDeletePageBtn.addEventListener('click', () => {
  pageConfirmOverlay.classList.remove('open');
});

// Confirm page deletion modal
confirmDeletePageBtn.addEventListener('click', async () => {
  pageConfirmOverlay.classList.remove('open');
  await flushPendingSave();
  await deleteCurrentPage();
});

// Internal function to perform page deletion
async function deleteCurrentPage() {
  notePages.splice(currentPageIndex, 1);
  if (currentPageIndex >= notePages.length) {
    currentPageIndex = notePages.length - 1;
  }
  loadPageContent();
  await safeUpdateNote({
    pages: notePages,
    currentPageIndex
  });
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initNote);
