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

const saveStatusEl = document.getElementById('saveStatus');
const pageMenuBtn = document.getElementById('pageMenuBtn');
const menuDeleteNote = document.getElementById('menuDeleteNote');
const noteDeleteOverlay = document.getElementById('noteDeleteOverlay');
const cancelDeleteNoteBtn = document.getElementById('cancelDeleteNoteBtn');
const confirmDeleteNoteBtn = document.getElementById('confirmDeleteNoteBtn');

const memoState = document.getElementById('memoState');
const memoStateMessage = document.getElementById('memoStateMessage');
const memoStateRetryBtn = document.getElementById('memoStateRetryBtn');
const memoStateCloseBtn = document.getElementById('memoStateCloseBtn');
const pageActionGuard = window.NoteUtils.createPageActionGuard();

// Note state
let isPinned = false;

// Multi-page state: array of { title: string, content: string }
let notePages = [{ title: '', content: '' }];
let currentPageIndex = 0;

// Serialize IPC writes so a slow earlier save can never overwrite a newer one.
let saveChain = Promise.resolve();
let lastStoreHealth = null;
let lastUpdateFailed = false;

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
    .then((result) => {
      // update_note returns false when the note no longer exists.
      lastUpdateFailed = result === false;
    })
    .catch((e) => {
      lastUpdateFailed = true;
      console.error('updateNote failed:', e);
    });
  return saveChain;
}

// Persist the current page immediately. Every input already queues an update,
// so this mainly guarantees ordering before page switches and window close.
// Returns false when the final update could not be delivered, so close/quit
// handlers can avoid acknowledging a flush that did not happen.
async function flushPendingSave() {
  syncCurrentPage();
  await safeUpdateNote({
    pages: notePages,
    currentPageIndex: currentPageIndex
  });
  return !lastUpdateFailed;
}

// --- Persistence health status -------------------------------------------------

function updateSaveStatus(health) {
  if (!saveStatusEl) return;
  lastStoreHealth = health || null;
  saveStatusEl.classList.remove('saving', 'error', 'readonly');

  // 后台写入线程失联时商店转为同步直写：数据仍会落盘，但要在状态里说明。
  const degradedNote = health && health.degraded
    ? '\n（后台写入器不可用，正在直接写入磁盘）'
    : '';

  if (!health) {
    saveStatusEl.textContent = '—';
    saveStatusEl.title = '保存状态';
    saveStatusEl.disabled = true;
    return;
  }

  if (health.readOnly) {
    saveStatusEl.textContent = '只读';
    saveStatusEl.classList.add('readonly');
    saveStatusEl.title = health.lastError || '数据库不可写';
    saveStatusEl.disabled = true;
    return;
  }

  if (health.lastError) {
    saveStatusEl.textContent = '保存失败';
    saveStatusEl.classList.add('error');
    saveStatusEl.title = `${health.lastError}（点击重试）`;
    saveStatusEl.disabled = false;
    return;
  }

  if (health.dirty) {
    saveStatusEl.textContent = '保存中…';
    saveStatusEl.classList.add('saving');
    saveStatusEl.title = '正在写入磁盘' + degradedNote;
    saveStatusEl.disabled = true;
    return;
  }

  const time = health.lastSuccess
    ? new Date(health.lastSuccess).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  saveStatusEl.textContent = '已保存';
  saveStatusEl.title = (time ? `最后保存 ${time}` : '已保存') + degradedNote;
  saveStatusEl.disabled = true;
}

async function retrySaveFromStatus() {
  if (!lastStoreHealth || !lastStoreHealth.lastError || lastStoreHealth.readOnly) return;
  try {
    const health = await window.memoAPI.retrySave();
    lastUpdateFailed = false;
    updateSaveStatus(health);
  } catch (e) {
    console.error('retrySave failed:', e);
  }
}

if (saveStatusEl) {
  saveStatusEl.addEventListener('click', retrySaveFromStatus);
}

// --- Dialog focus management ---------------------------------------------------

function openDialog(overlay, initialFocusEl) {
  overlay._trigger = document.activeElement;
  overlay.classList.add('open');
  const focusTarget = initialFocusEl || overlay.querySelector('button');
  if (focusTarget) focusTarget.focus();
}

function closeDialog(overlay) {
  if (!overlay.classList.contains('open')) return;
  overlay.classList.remove('open');
  const trigger = overlay._trigger;
  if (trigger && typeof trigger.focus === 'function') trigger.focus();
  overlay._trigger = null;
}

function trapDialogFocus(overlay, e) {
  const focusables = [...overlay.querySelectorAll('button')].filter((b) => !b.disabled);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function bindDialog(overlay, cancelHandler) {
  overlay.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelHandler();
    } else if (e.key === 'Tab') {
      trapDialogFocus(overlay, e);
    }
  });
}

// --- Page action serialization ---------------------------------------------------

const pageActionButtons = [prevPageBtn, nextPageBtn, addPageBtn, deletePageBtn, pageMenuBtn];

function setPageControlsDisabled(disabled) {
  for (const button of pageActionButtons) {
    if (button) button.disabled = disabled;
  }
}

async function runPageAction(action) {
  if (!pageActionGuard.begin()) return;
  setPageControlsDisabled(true);
  try {
    await action();
  } finally {
    pageActionGuard.end();
    updatePageControls();
    setPageControlsDisabled(false);
  }
}

// --- Missing note / load failure state -----------------------------------------

// 便签数据不可用时的显式状态：隐藏编辑器与页脚（不显示假页码），提供
// 重试/关闭。文案不得暗示“已保存”——此时根本无从保存。
function showUnavailableState(reason) {
  document.body.classList.add('note-unavailable');
  if (memoStateMessage) {
    memoStateMessage.textContent = reason || '便签数据不可用：内容可能已被删除，或数据库暂时无法读取。';
  }
  if (memoState) memoState.hidden = false;
}

function hideUnavailableState() {
  document.body.classList.remove('note-unavailable');
  if (memoState) memoState.hidden = true;
}

// Initialize Note Data
async function initNote() {
  if (!noteId) return;

  let note = null;
  try {
    note = await window.memoAPI.getNoteData(noteId);
  } catch (e) {
    console.error('getNoteData failed:', e);
    showUnavailableState('加载便签数据失败：请重试或关闭窗口。');
    return;
  }
  if (!note) {
    showUnavailableState();
    return;
  }
  hideUnavailableState();

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
    const selected = item.getAttribute('data-color') === colorName;
    if (selected) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
    item.setAttribute('aria-checked', selected ? 'true' : 'false');
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
  // 复选框指纹表：行号 -> {line, nth, total}，点击时用于校验/回找源行。
  // total 必须是“相同规范化行的最终总数”，因此先全量统计再渲染。
  const fingerprints = {};
  const checklistTotals = new Map();
  const checklistSeen = new Map();
  for (const line of lines) {
    if (/^\s*-\s*\[[ xX]\]/.test(line)) {
      const key = line.trim();
      checklistTotals.set(key, (checklistTotals.get(key) || 0) + 1);
    }
  }

  const rendered = lines.map((line, index) => {
    // Match checklist: optional whitespace + "- [ ]" or "- [x]" + text
    const checkMatch = line.match(/^(\s*-\s*)\[([ xX])\]\s*(.*)$/);
    if (checkMatch) {
      const isChecked = checkMatch[2].toLowerCase() === 'x';
      const content = checkMatch[3];
      const key = line.trim();
      const nth = checklistSeen.get(key) || 0;
      checklistSeen.set(key, nth + 1);
      fingerprints[index] = JSON.stringify({ line: key, nth, total: checklistTotals.get(key) });
      // 与无序列表共用“2 空格 = 1 层”的缩进映射（最多 3 层）
      const leadingSpaces = checkMatch[1].replace(/\t/g, '  ').length;
      const level = Math.min(Math.floor(leadingSpaces / 2) + 1, 3);
      const indentPadding = (level - 1) * 28;
      return `<div class="preview-line checklist-item" data-line-index="${index}"${indentPadding ? ` style="padding-left: ${indentPadding}px;"` : ''}>
        <span class="preview-checkbox${isChecked ? ' checked' : ''}" data-line-index="${index}" tabindex="0" role="checkbox" aria-checked="${isChecked}" aria-label="任务复选框第 ${index + 1} 行"></span>
        <span class="item-text">${renderInlineMarkdown(content)}</span>
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
        <span class="item-text">${renderInlineMarkdown(content)}</span>
      </div>`;
    }

    // Headers
    if (line.startsWith('# ')) {
      return `<h1 class="preview-line" style="margin: 4px 0; font-size: 22px;">${renderInlineMarkdown(line.substring(2))}</h1>`;
    }
    if (line.startsWith('## ')) {
      return `<h2 class="preview-line" style="margin: 4px 0; font-size: 18px;">${renderInlineMarkdown(line.substring(3))}</h2>`;
    }

    // Default plain line
    return `<div class="preview-line" data-line-index="${index}">${renderInlineMarkdown(line) || '&nbsp;'}</div>`;
  });

  memoPreview.innerHTML = rendered.join('');

  // innerHTML 拼接路径不做属性转义，指纹经 setAttribute 写入以避免转义分歧。
  memoPreview.querySelectorAll('.preview-checkbox').forEach((checkbox) => {
    const fp = fingerprints[checkbox.getAttribute('data-line-index')];
    if (fp) checkbox.setAttribute('data-fingerprint', fp);
  });
}

// 行内 Markdown（粗体/斜体）由 NoteUtils 的强调扫描器处理，保证
// `***text***` 等混合强调产出平衡标签；renderer 只保留 HTML 转义降级路径。
function renderInlineMarkdown(text) {
  if (NoteUtilsGlobal && typeof NoteUtilsGlobal.parseMarkdownInline === 'function') {
    return NoteUtilsGlobal.parseMarkdownInline(text);
  }
  return escapeHtml(text);
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
    toggleFromPreviewCheckbox(checkbox);
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
    toggleFromPreviewCheckbox(checkbox);
  }
});

function toggleFromPreviewCheckbox(checkbox) {
  const lineIndex = parseInt(checkbox.getAttribute('data-line-index'), 10);
  const fingerprint = checkbox.getAttribute('data-fingerprint') || '';
  toggleCheckboxInSource(Number.isNaN(lineIndex) ? -1 : lineIndex, fingerprint);
}

const CHECKBOX_LINE_RE = /^\s*-\s*\[[ xX]\]/;

// 用指纹（规范化行文本 + 出现序号 + 总数）在当前文本中定位要翻转的行。
// 渲染时记录的行号可能已过期：只有映射仍然可信时才翻转，否则重建预览，
// 绝不猜测另一行（避免点 A 行却翻转了 B 行）。
function resolveCheckboxTarget(lineIndex, fingerprint) {
  const lines = memoTextarea.value.split('\n');
  let fp = null;
  try {
    fp = JSON.parse(fingerprint);
  } catch {
    fp = null;
  }
  if (!fp || typeof fp.line !== 'string') return null;
  const nth = Number.isInteger(fp.nth) ? fp.nth : 0;
  const total = Number.isInteger(fp.total) ? fp.total : 1;

  const candidates = [];
  lines.forEach((raw, idx) => {
    if (raw.trim() === fp.line && CHECKBOX_LINE_RE.test(raw)) candidates.push(idx);
  });

  // 快路径：存储的行号仍然持有同一条清单行（且其出现序号未变）。
  if (candidates.includes(lineIndex) && candidates.indexOf(lineIndex) === nth) {
    return { lines, target: lineIndex };
  }
  // 回退：相同清单行的数量与渲染时一致时，按出现序号回找。
  if (candidates.length === total && nth < candidates.length) {
    return { lines, target: candidates[nth] };
  }
  return null;
}

function toggleCheckboxInSource(lineIndex, fingerprint) {
  const resolved = resolveCheckboxTarget(lineIndex, fingerprint);
  if (!resolved) {
    // 行号/指纹失效（文本在渲染后被程序改动）：重建映射，等待下一次点击。
    renderPreview();
    return;
  }

  const { lines, target } = resolved;
  const match = lines[target].match(/^(\s*-\s*)(\[[ xX]\])(\s*)(.*)$/);
  if (!match) return;
  // 注意：match[2] 含方括号（`[x]`/`[ ]`），比较必须带括号；编辑态路径取的是
  // 括号内字符，两处不要混淆（2026-10 回归：漏掉括号导致永远写入 [x]）。
  const isChecked = match[2].toLowerCase() === '[x]';
  lines[target] = `${match[1]}[${isChecked ? ' ' : 'x'}]${match[3]}${match[4]}`;
  memoTextarea.value = lines.join('\n');

  // Save and update UI
  triggerAutoSave();
  renderPreview();
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

// --- Menus: context menu, theme submenu, page-jump menu -----------------------

let contextMenuTrigger = null;
let pagesMenuTrigger = null;

function menuFocusableItems(container) {
  return [...container.querySelectorAll('[role="menuitem"],[role="menuitemradio"]')]
    .filter((el) => el.offsetParent !== null);
}

function focusMenuItemAt(items, index) {
  const i = (index % items.length + items.length) % items.length;
  items[i].focus();
}

function hideContextMenu(restoreFocus = false) {
  contextMenu.style.display = 'none';
  if (restoreFocus && contextMenuTrigger && typeof contextMenuTrigger.focus === 'function') {
    contextMenuTrigger.focus();
  }
  contextMenuTrigger = null;
}

function hidePagesMenu(restoreFocus = false) {
  pagesMenu.style.display = 'none';
  pageMenuBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus && pagesMenuTrigger && typeof pagesMenuTrigger.focus === 'function') {
    pagesMenuTrigger.focus();
  }
  pagesMenuTrigger = null;
}

function openContextMenu(x, y, viaKeyboard = false) {
  hidePagesMenu();
  contextMenu.style.display = 'block';
  contextMenu.style.left = '0px';
  contextMenu.style.top = '0px';

  const menuRect = contextMenu.getBoundingClientRect();
  const menuW = menuRect.width;
  const menuH = menuRect.height;
  const submenuWidth = themeSubmenu.offsetWidth || 100;

  const left = Math.max(4, Math.min(x, window.innerWidth - menuW - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - menuH - 4));
  contextMenu.classList.toggle(
    'submenu-left',
    left + menuW + submenuWidth > window.innerWidth - 4
  );
  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;

  contextMenuTrigger = viaKeyboard ? document.activeElement : null;
  if (viaKeyboard) {
    const first = contextMenu.querySelector('.menu-item');
    if (first) first.focus();
  }
}

function isAnyDialogOpen() {
  return [confirmOverlay, pageConfirmOverlay, noteDeleteOverlay]
    .some((overlay) => overlay.classList.contains('open'));
}

// Don't show context menu over header/footer buttons, menus, or dialogs
function contextMenuSuppressed(target) {
  return !!target.closest('.header-actions') || !!target.closest('.memo-footer')
    || !!target.closest('.confirm-overlay') || !!target.closest('.pages-menu');
}

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (contextMenuSuppressed(e.target) || isAnyDialogOpen()) return;
  openContextMenu(e.clientX, e.clientY, false);
});

// Keyboard entry point for the context menu (Menu key / Shift+F10).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
  const onEditable = e.target instanceof Element && !!e.target.closest('input, textarea');
  if (onEditable || isAnyDialogOpen()) return;
  e.preventDefault();
  openContextMenu(window.innerWidth / 2 - 65, window.innerHeight / 2 - 40, true);
});

// Single global click handler: dismiss context menu + pages menu
document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    hideContextMenu();
  }
  if (!pagesMenu.contains(e.target) && !pageMenuBtn.contains(e.target)) {
    hidePagesMenu();
  }
});

// Dismiss menus on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (contextMenu.style.display === 'block') hideContextMenu(true);
    if (pagesMenu.style.display === 'block') hidePagesMenu(true);
  }
});

// Roving focus inside the context menu (submenu items included when visible).
contextMenu.addEventListener('keydown', (e) => {
  if (contextMenu.style.display !== 'block') return;
  const items = menuFocusableItems(contextMenu);
  if (!items.length) return;
  const activeIndex = items.indexOf(document.activeElement);
  const active = activeIndex >= 0 ? items[activeIndex] : null;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      focusMenuItemAt(items, activeIndex < 0 ? 0 : activeIndex + 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      focusMenuItemAt(items, activeIndex < 0 ? items.length - 1 : activeIndex - 1);
      break;
    case 'Home':
      e.preventDefault();
      if (items[0]) items[0].focus();
      break;
    case 'End':
      e.preventDefault();
      if (items[items.length - 1]) items[items.length - 1].focus();
      break;
    case 'ArrowRight':
      if (active && active.id === 'menuThemeParent') {
        e.preventDefault();
        const first = themeSubmenu.querySelector('.submenu-item');
        if (first) first.focus();
      }
      break;
    case 'ArrowLeft':
      if (active && active.closest('.submenu')) {
        e.preventDefault();
        menuThemeParent.focus();
      }
      break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      if (active) active.click();
      break;
    case 'Escape':
      e.preventDefault();
      hideContextMenu(true);
      break;
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
  hideContextMenu();
}
menuNewNote.addEventListener('click', handleMenuNewNote);

// Context Submenu: Switch Themes
function bindThemeItem(item) {
  const activate = async () => {
    const selectedColor = item.getAttribute('data-color');
    applyTheme(selectedColor);
    hideContextMenu();
    await safeUpdateNote({ color: selectedColor });
  };
  item.addEventListener('click', activate);
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
    item.tabIndex = -1;
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
      hidePagesMenu(true);
      await safeUpdateNote({ currentPageIndex });
    });

    pagesMenuList.appendChild(item);
  });
}

// Toggle Pages list menu via the dedicated page-menu button
function togglePagesMenu(e, viaKeyboard = false) {
  if (e) e.stopPropagation();

  if (pagesMenu.style.display === 'block') {
    hidePagesMenu();
    return;
  }

  // Hide context menu if open
  hideContextMenu();

  // Sync active page before rendering menu list
  syncCurrentPage();

  // Render and show
  renderPagesMenu();
  pagesMenu.style.display = 'block';
  pageMenuBtn.setAttribute('aria-expanded', 'true');
  pagesMenuTrigger = pageMenuBtn;
  if (viaKeyboard) {
    const first = pagesMenuList.querySelector('.pages-menu-item');
    if (first) first.focus();
  }
}

pageMenuBtn.addEventListener('click', (e) => togglePagesMenu(e, e.detail === 0));

// Roving focus inside the page-jump menu
pagesMenu.addEventListener('keydown', (e) => {
  if (pagesMenu.style.display !== 'block') return;
  const items = menuFocusableItems(pagesMenu);
  if (!items.length) return;
  const activeIndex = items.indexOf(document.activeElement);

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      focusMenuItemAt(items, activeIndex < 0 ? 0 : activeIndex + 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      focusMenuItemAt(items, activeIndex < 0 ? items.length - 1 : activeIndex - 1);
      break;
    case 'Home':
      e.preventDefault();
      if (items[0]) items[0].focus();
      break;
    case 'End':
      e.preventDefault();
      if (items[items.length - 1]) items[items.length - 1].focus();
      break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      if (items[activeIndex]) items[activeIndex].click();
      break;
    case 'Escape':
      e.preventDefault();
      hidePagesMenu(true);
      break;
  }
});

// Close Note Actions
closeBtn.addEventListener('click', () => {
  openDialog(confirmOverlay, cancelCloseBtn);
});

// Cancel close dialog
cancelCloseBtn.addEventListener('click', () => {
  closeDialog(confirmOverlay);
});

// Close window (flush pending edits first)
closeWindowBtn.addEventListener('click', async () => {
  closeDialog(confirmOverlay);
  const saved = await flushPendingSave();
  if (!saved) {
    console.error('close aborted: the final update was not delivered');
    return;
  }
  try {
    await window.memoAPI.closeWindow(noteId);
  } catch (e) {
    console.error('closeWindow failed:', e);
  }
});

// Quit app entirely (flush first)
quitAppBtn.addEventListener('click', async () => {
  closeDialog(confirmOverlay);
  const saved = await flushPendingSave();
  if (!saved) {
    console.error('quit aborted: the final update was not delivered');
    return;
  }
  try {
    await window.memoAPI.quitApp();
  } catch (e) {
    console.error('quitApp failed:', e);
  }
});

// List editing: Enter continues/exits lists, Shift+Enter breaks lines inside
// an item, Tab/Shift+Tab indent list lines. 预览与缩进共用“2 空格 = 1 层、最多
// 3 层”的映射（0/2/4 个前导空格）。
const LIST_INDENT = '  ';
const LIST_MAX_INDENT_SPACES = 4;

function textareaLineBounds(val, pos) {
  const start = val.lastIndexOf('\n', pos - 1) + 1;
  const rawEnd = val.indexOf('\n', pos);
  return { start, end: rawEnd === -1 ? val.length : rawEnd };
}

// 在清单/列表行上接管 Tab：缩进或减少一层缩进；非列表行保留平台默认行为
// （Tab 移出焦点）。始终 preventDefault，焦点不会离开编辑器。
function handleListIndent(e) {
  const textarea = memoTextarea;
  const startPos = textarea.selectionStart;
  const endPos = textarea.selectionEnd;
  if (startPos !== endPos) return; // 有选区时保留默认行为

  const val = textarea.value;
  const { start: lineStart } = textareaLineBounds(val, startPos);
  const line = val.substring(lineStart, textareaLineBounds(val, startPos).end);

  if (!/^\s*[-*+]\s/.test(line)) return;

  e.preventDefault();
  const leading = line.match(/^[\t ]*/)[0];
  const indentWidth = leading.replace(/\t/g, LIST_INDENT).length;

  if (!e.shiftKey) {
    if (indentWidth >= LIST_MAX_INDENT_SPACES) return; // 已到三层上限，仅吞掉按键
    textarea.value = val.slice(0, lineStart) + LIST_INDENT + val.slice(lineStart);
    textarea.selectionStart = textarea.selectionEnd = startPos + LIST_INDENT.length;
  } else {
    if (indentWidth === 0) return;
    // 减少一层：单个制表符或至多 2 个空格。
    const removeCount = leading[0] === '\t' ? 1 : Math.min(2, leading.length);
    textarea.value = val.slice(0, lineStart) + val.slice(lineStart + removeCount);
    textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, startPos - removeCount);
  }
  triggerAutoSave();
}

// Auto-expand list items on Enter (helpful for task lists)
memoTextarea.addEventListener('keydown', (e) => {
  // Never hijack keys while an IME is composing (Chinese/Japanese input):
  // Enter/Shift+Enter/Tab 都必须先让位于输入法组合。
  if (e.isComposing || e.keyCode === 229) return;

  // Shift+Enter: insert a plain line break inside the current item instead of
  // starting a new list item.
  if (e.key === 'Enter' && e.shiftKey) return;

  if (e.key === 'Enter') {
    const textarea = e.target;
    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;
    const val = textarea.value;

    if (startPos !== endPos) return; // 有选区时保留默认（换行替换选区）

    const { start: lineStart } = textareaLineBounds(val, startPos);
    const currentLine = val.substring(lineStart, startPos);

    // Match "- [ ] ", "- [x] ", or "- " / "* " / "+ " prefix
    const checkListMatch = currentLine.match(/^(\s*-\s*\[[ xX]\]\s*)/);
    const bulletMatch = checkListMatch ? null : currentLine.match(/^(\s*[-*+]\s+)/);

    if (!checkListMatch && !bulletMatch) return;

    const prefix = (checkListMatch || bulletMatch)[1];
    if (currentLine.slice(prefix.length).trim() === '') {
      // Empty list item: drop the prefix and leave the list with a plain line.
      e.preventDefault();
      textarea.value = val.substring(0, lineStart) + '\n' + val.substring(startPos);
      textarea.selectionStart = textarea.selectionEnd = lineStart + 1;
      triggerAutoSave();
      return;
    }

    e.preventDefault();
    // New list item starts unchecked
    const newPrefix = checkListMatch ? prefix.replace(/\[[xX]\]/, '[ ]') : prefix;
    const insertion = '\n' + newPrefix;
    textarea.value = val.substring(0, startPos) + insertion + val.substring(endPos);
    textarea.selectionStart = textarea.selectionEnd = startPos + insertion.length;
    triggerAutoSave();
    return;
  }

  if (e.key === 'Tab') {
    handleListIndent(e);
  }
});

// --- Page Control Event Handlers ---

// Flip to previous page
prevPageBtn.addEventListener('click', async () => {
  await runPageAction(async () => {
    await flushPendingSave();
    if (currentPageIndex > 0) {
      currentPageIndex--;
      loadPageContent();
      await safeUpdateNote({ currentPageIndex });
    }
  });
});

// Flip to next page
nextPageBtn.addEventListener('click', async () => {
  await runPageAction(async () => {
    await flushPendingSave();
    if (currentPageIndex < notePages.length - 1) {
      currentPageIndex++;
      loadPageContent();
      await safeUpdateNote({ currentPageIndex });
    }
  });
});

// Add a new blank page
addPageBtn.addEventListener('click', async () => {
  await runPageAction(async () => {
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
});

// Delete active page action
deletePageBtn.addEventListener('click', async () => {
  if (notePages.length <= 1) return; // Double protection

  const text = memoTextarea.value.trim();
  const title = memoTitleInput.value.trim();
  if (text === '' && title === '') {
    // If empty page, delete immediately (flush first to cancel stale writes)
    await runPageAction(async () => {
      await flushPendingSave();
      await deleteCurrentPage();
    });
  } else {
    // If text exists, prompt overlay
    openDialog(pageConfirmOverlay, cancelDeletePageBtn);
  }
});

// Cancel page deletion modal
cancelDeletePageBtn.addEventListener('click', () => {
  closeDialog(pageConfirmOverlay);
});

// Confirm page deletion modal
confirmDeletePageBtn.addEventListener('click', async () => {
  await runPageAction(async () => {
    closeDialog(pageConfirmOverlay);
    await flushPendingSave();
    await deleteCurrentPage();
  });
});

// Delete-note confirmation (whole note)
menuDeleteNote.addEventListener('click', () => {
  hideContextMenu();
  openDialog(noteDeleteOverlay, cancelDeleteNoteBtn);
});

cancelDeleteNoteBtn.addEventListener('click', () => {
  closeDialog(noteDeleteOverlay);
});

confirmDeleteNoteBtn.addEventListener('click', async () => {
  closeDialog(noteDeleteOverlay);
  try {
    await window.memoAPI.deleteNote(noteId);
  } catch (e) {
    console.error('deleteNote failed:', e);
  }
});

// Missing-note state: retry re-runs initNote, close destroys the window.
memoStateRetryBtn.addEventListener('click', () => {
  hideUnavailableState();
  initNote();
});
memoStateCloseBtn.addEventListener('click', async () => {
  try {
    await window.memoAPI.closeWindow(noteId);
  } catch (e) {
    console.error('closeWindow (unavailable state) failed:', e);
  }
});

// Dialog keyboard support: Escape cancels, Tab stays inside the dialog.
bindDialog(confirmOverlay, () => {
  closeDialog(confirmOverlay);
});
bindDialog(pageConfirmOverlay, () => {
  closeDialog(pageConfirmOverlay);
});
bindDialog(noteDeleteOverlay, () => {
  closeDialog(noteDeleteOverlay);
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

// --- P0 persistence protocol --------------------------------------------------

window.memoAPI.onFlushBeforeClose(async (requestId) => {
  const saved = await flushPendingSave();
  if (!saved) {
    console.error('not acknowledging close: the final update was not delivered');
    return;
  }
  try {
    await window.memoAPI.ackClose(requestId);
  } catch (e) {
    console.error('flush_ack_close failed:', e);
  }
}).catch((e) => console.error('listen flush-before-close failed:', e));

window.memoAPI.onFlushBeforeQuit(async (requestId) => {
  const saved = await flushPendingSave();
  if (!saved) {
    console.error('not acknowledging quit: the final update was not delivered');
    return;
  }
  try {
    await window.memoAPI.ackQuit(requestId);
  } catch (e) {
    console.error('flush_ack_quit failed:', e);
  }
}).catch((e) => console.error('listen flush-before-quit failed:', e));

window.memoAPI.onStoreHealth(updateSaveStatus)
  .catch((e) => console.error('listen store health failed:', e));

window.memoAPI.getStoreStatus()
  .then(updateSaveStatus)
  .catch((e) => console.error('getStoreStatus failed:', e));
