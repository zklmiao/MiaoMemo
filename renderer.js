const noteId = new URLSearchParams(window.location.search).get('id');

const memoContainer = document.getElementById('memoContainer');
const memoHeader = document.getElementById('memoHeader');
const headerTitle = document.getElementById('headerTitle');
const memoTextarea = document.getElementById('memoTextarea');
const memoPreview = document.getElementById('memoPreview');
const memoTitleInput = document.getElementById('memoTitleInput');

const pinBtn = document.getElementById('pinBtn');
const addNoteBtn = document.getElementById('addNoteBtn');
const closeBtn = document.getElementById('closeBtn');

const contextMenu = document.getElementById('contextMenu');
const menuNewNote = document.getElementById('menuNewNote');
const themeSubmenu = document.getElementById('themeSubmenu');
const submenuItems = themeSubmenu.querySelectorAll('.submenu-item');

const pagesMenu = document.getElementById('pagesMenu');
const pagesMenuList = document.getElementById('pagesMenuList');
const pageIndicatorContainer = document.getElementById('pageIndicatorContainer');

const confirmOverlay = document.getElementById('confirmOverlay');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

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
let isCollapsed = false;
let expandedHeight = 350;
let saveTimeout = null;

// Multi-page state: array of { title: string, content: string }
let notePages = [{ title: '', content: '' }];
let currentPageIndex = 0;

// Initialize Note Data
async function initNote() {
  if (!noteId) return;

  const note = await window.electronAPI.getNoteData(noteId);
  if (!note) return;

  // Apply visual settings
  isPinned = note.isPinned || false;
  isCollapsed = note.isCollapsed || false;
  expandedHeight = note.height || 350;

  // Set Theme
  applyTheme(note.color || 'white');

  // Handle database migration for multi-page support with titles
  if (note.pages && Array.isArray(note.pages)) {
    notePages = note.pages.map(page => {
      if (typeof page === 'string') {
        // Extract title from first line as default fallback
        const titleVal = page.trim().split('\n')[0].replace(/[#*`_\-]/g, '').trim().substring(0, 16);
        return {
          title: titleVal || '',
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
    const titleVal = rawContent.trim().split('\n')[0].replace(/[#*`_\-]/g, '').trim().substring(0, 16);
    notePages = [{
      title: titleVal || '',
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
  }

  // Focus editor if current page is empty
  if (notePages[currentPageIndex].content === '') {
    memoTextarea.focus();
  }
}

// Load content and update controls for the active page index
function loadPageContent() {
  memoTitleInput.value = notePages[currentPageIndex]?.title || '';
  memoTextarea.value = notePages[currentPageIndex]?.content || '';
  updateCharCount();
  updatePageControls();
  switchToPreviewMode();
}

function updatePageControls() {
  const totalPages = notePages.length;
  pageIndicator.textContent = `${currentPageIndex + 1} / ${totalPages}`;

  prevPageBtn.disabled = currentPageIndex <= 0;
  nextPageBtn.disabled = currentPageIndex >= totalPages - 1;
  deletePageBtn.disabled = totalPages <= 1;
}

// Extract first line of note for title when collapsed (priority: manually entered title)
function getCollapseTitle() {
  if (notePages[currentPageIndex]?.title?.trim()) {
    return notePages[currentPageIndex].title.trim().substring(0, 16);
  }
  const text = memoTextarea.value.trim();
  if (!text) return '空白便签';
  const firstLine = text.split('\n')[0].replace(/[#*`_\-]/g, '').trim();
  return firstLine.substring(0, 16) || '便签';
}

// Apply theme class and highlight corresponding context submenu color dot
function applyTheme(colorName) {
  // Clear any existing theme classes
  document.body.className = '';
  document.body.classList.add(`theme-${colorName}`);

  // Highlight active submenu item color dot
  submenuItems.forEach(item => {
    if (item.getAttribute('data-color') === colorName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// Update char counter (UI removed in layout, retained as empty function to avoid errors)
function updateCharCount() {
}

// Debounced Auto-save to JSON database
function triggerAutoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);

  // Sync current value to state array immediately
  notePages[currentPageIndex] = {
    title: memoTitleInput.value,
    content: memoTextarea.value
  };

  saveTimeout = setTimeout(async () => {
    await window.electronAPI.updateNote(noteId, { 
      pages: notePages,
      currentPageIndex: currentPageIndex
    });
    
    // Update collapsed title in case it changed
    if (isCollapsed) {
      headerTitle.textContent = getCollapseTitle();
    }
  }, 400);
}

// Track expanded height when window is resized by user
window.addEventListener('resize', () => {
  if (!isCollapsed) {
    expandedHeight = window.outerHeight;
  }
});

// Add Note Button
addNoteBtn.addEventListener('click', () => {
  window.electronAPI.createNote();
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
      const indent = checkMatch[1];
      const isChecked = checkMatch[2].toLowerCase() === 'x';
      const content = checkMatch[3];
      return `<div class="preview-line checklist-item" data-line-index="${index}">
        <span style="opacity: 0.5;">-</span>
        <span class="preview-checkbox${isChecked ? ' checked' : ''}" data-line-index="${index}"></span>
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

// Toggle checkbox in raw text
function toggleCheckboxAtLine(lineIndex) {
  const lines = memoTextarea.value.split('\n');
  const line = lines[lineIndex];
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
  await window.electronAPI.updateNote(noteId, { isPinned });
});

// Right-click Context Menu implementation
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // Don't show context menu if clicking action buttons in header or footer
  if (e.target.closest('.header-actions') || e.target.closest('.memo-footer') || e.target.closest('.confirm-overlay') || e.target.closest('.pages-menu')) return;
  
  // Hide pages menu if open
  pagesMenu.style.display = 'none';

  contextMenu.style.left = `${e.clientX}px`;
  contextMenu.style.top = `${e.clientY}px`;
  contextMenu.style.display = 'block';
});

// Dismiss context menu on click outside
document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    contextMenu.style.display = 'none';
  }
});

// Dismiss context menu on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    contextMenu.style.display = 'none';
    pagesMenu.style.display = 'none';
  }
});

// Context Menu: Create New Note
menuNewNote.addEventListener('click', () => {
  window.electronAPI.createNote();
  contextMenu.style.display = 'none';
});

// Context Submenu: Switch Themes
submenuItems.forEach(item => {
  item.addEventListener('click', async () => {
    const selectedColor = item.getAttribute('data-color');
    applyTheme(selectedColor);
    contextMenu.style.display = 'none';
    await window.electronAPI.updateNote(noteId, { color: selectedColor });
  });
});

// --- Page outline jump-to-page menu ---

// Render and populate the page jump menu
function renderPagesMenu() {
  pagesMenuList.innerHTML = '';
  notePages.forEach((page, index) => {
    const item = document.createElement('div');
    item.className = 'pages-menu-item';
    if (index === currentPageIndex) {
      item.classList.add('active');
    }
    
    // Get title display name: Priority title, then text first line, then 无标题
    let titleText = page.title.trim();
    if (!titleText) {
      const text = page.content.trim();
      if (text) {
        titleText = text.split('\n')[0].replace(/[#*`_\-]/g, '').trim().substring(0, 16);
      }
    }
    titleText = titleText || '无标题';
    
    item.textContent = `${index + 1}. ${titleText}`;
    
    // Click item to jump
    item.addEventListener('click', async () => {
      // Sync current page inputs before switching
      notePages[currentPageIndex] = {
        title: memoTitleInput.value,
        content: memoTextarea.value
      };
      
      currentPageIndex = index;
      loadPageContent();
      pagesMenu.style.display = 'none';
      await window.electronAPI.updateNote(noteId, { currentPageIndex });
    });
    
    pagesMenuList.appendChild(item);
  });
}

// Toggle Pages list menu when clicking pageIndicatorContainer
pageIndicatorContainer.addEventListener('click', (e) => {
  e.stopPropagation();
  
  if (pagesMenu.style.display === 'block') {
    pagesMenu.style.display = 'none';
  } else {
    // Hide context menu if open
    contextMenu.style.display = 'none';
    
    // Sync active page before rendering menu list
    notePages[currentPageIndex] = {
      title: memoTitleInput.value,
      content: memoTextarea.value
    };
    
    // Render and show
    renderPagesMenu();
    pagesMenu.style.display = 'block';
  }
});

// Dismiss pages menu on click outside
document.addEventListener('click', (e) => {
  if (!pagesMenu.contains(e.target) && !pageIndicatorContainer.contains(e.target)) {
    pagesMenu.style.display = 'none';
  }
});

// Delete Entire Note Actions
closeBtn.addEventListener('click', async () => {
  // Safe empty check across all pages
  const isEntireNoteEmpty = notePages.every(page => page.content.trim() === '' && page.title.trim() === '');
  if (isEntireNoteEmpty) {
    await window.electronAPI.deleteNote(noteId);
  } else {
    // Show confirmation overlay
    confirmOverlay.classList.add('open');
  }
});

// Cancel Delete Note Modal
cancelDeleteBtn.addEventListener('click', () => {
  confirmOverlay.classList.remove('open');
});

// Confirm Delete Note Modal
confirmDeleteBtn.addEventListener('click', async () => {
  confirmOverlay.classList.remove('open');
  await window.electronAPI.deleteNote(noteId);
});

// Auto-expand list items on Enter (helpful for task lists)
memoTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const textarea = e.target;
    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;
    const val = textarea.value;
    
    // Get text of current line before Enter was pressed
    const lineStart = val.lastIndexOf('\n', startPos - 1) + 1;
    const currentLine = val.substring(lineStart, startPos);
    
    // Match "- [ ] ", "- [x] ", or "- " prefix
    const checkListMatch = currentLine.match(/^(\s*-\s*\[[ xX]\]\s*)/);
    const bulletMatch = currentLine.match(/^(\s*-\s+)/);
    
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
    notePages[currentPageIndex] = {
      title: memoTitleInput.value,
      content: memoTextarea.value
    };
    currentPageIndex--;
    loadPageContent();
    await window.electronAPI.updateNote(noteId, { currentPageIndex });
  }
});

// Flip to next page
nextPageBtn.addEventListener('click', async () => {
  if (currentPageIndex < notePages.length - 1) {
    notePages[currentPageIndex] = {
      title: memoTitleInput.value,
      content: memoTextarea.value
    };
    currentPageIndex++;
    loadPageContent();
    await window.electronAPI.updateNote(noteId, { currentPageIndex });
  }
});

// Add a new blank page
addPageBtn.addEventListener('click', async () => {
  notePages[currentPageIndex] = {
    title: memoTitleInput.value,
    content: memoTextarea.value
  };
  
  // Insert new empty page after the current page index
  notePages.splice(currentPageIndex + 1, 0, { title: '', content: '' });
  currentPageIndex++;
  
  loadPageContent();
  memoTitleInput.focus(); // Focus the title input of new page first
  await window.electronAPI.updateNote(noteId, { 
    pages: notePages,
    currentPageIndex
  });
});

// Delete active page action
deletePageBtn.addEventListener('click', () => {
  if (notePages.length <= 1) return; // Double protection

  const text = memoTextarea.value.trim();
  const title = memoTitleInput.value.trim();
  if (text === '' && title === '') {
    // If empty page, delete immediately
    deleteCurrentPage();
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
  await deleteCurrentPage();
});

// Internal function to perform page deletion
async function deleteCurrentPage() {
  notePages.splice(currentPageIndex, 1);
  if (currentPageIndex >= notePages.length) {
    currentPageIndex = notePages.length - 1;
  }
  loadPageContent();
  await window.electronAPI.updateNote(noteId, {
    pages: notePages,
    currentPageIndex
  });
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initNote);
