const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { DEFAULT_NOTE_WIDTH, DEFAULT_NOTE_HEIGHT, extractTitleFromText, isNoteEmpty, makeNoteId, createDefaultNote } = require('./noteUtils');
const { atomicWriteFileSync, loadDBFromDisk: loadDBFromDiskRaw, cleanupStaleTmp, createMemoryStore } = require('./dbStore');

// NOTE: 窗口透明效果依赖 GPU 加速，绝不能调用 app.disableHardwareAcceleration()。

// 测试隔离：支持 --user-data-dir=<path> 覆盖 userData（自动化/手工测试隔离用）。
// 必须在 app.getPath('userData') 之前调用 setPath 才生效。
for (const arg of process.argv) {
  if (arg.startsWith('--user-data-dir=')) {
    const customDir = arg.slice('--user-data-dir='.length).replace(/^"|"$/g, '');
    if (customDir) {
      try {
        fs.mkdirSync(customDir, { recursive: true });
        app.setPath('userData', customDir);
      } catch (e) {
        console.error('Failed to set custom userData dir:', e);
      }
    }
  }
}

// Path for storing note data
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'notes.json');
const iconPath = path.join(__dirname, 'icon.ico');

const DEFAULT_FLUSH_DELAY_MS = 250;

let tray = null;
const windows = new Map(); // noteId -> BrowserWindow

// ---- 统一持久化层（内存缓存 + 单防抖刷盘，解决跨便签丢数据/双写竞争） ----
// 真实逻辑位于 dbStore.createMemoryStore，tests 直接测该模块（非复刻），避免虚假 pass。
function loadDBFromDisk() {
  return loadDBFromDiskRaw(dbPath);
}

const memStore = createMemoryStore({
  load: loadDBFromDisk,
  delay: DEFAULT_FLUSH_DELAY_MS,
  onFlush: (data) => {
    try {
      atomicWriteFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Error writing notes database:', e);
    }
  }
});

function getDB() {
  return memStore.get();
}

function schedulePersist() {
  memStore.schedule();
}

function flushDBSync() {
  try {
    memStore.flushSync();
  } catch (e) {
    console.error('Error writing notes database:', e);
  }
}

// Stagger coordinates for cascading windows
function getCascadePosition(noteWidth = DEFAULT_NOTE_WIDTH, noteHeight = DEFAULT_NOTE_HEIGHT) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const count = windows.size;
  const x = Math.max(50, Math.floor((width - noteWidth) / 2) + (count % 8) * 30 + 150);
  const y = Math.max(50, Math.floor((height - noteHeight) / 2) - 100 + (count % 8) * 30);
  return { x, y };
}

// Initialize default notes if empty
function initializeDB() {
  const db = getDB();
  if (!db.notes || db.notes.length === 0) {
    const pos = getCascadePosition();
    db.notes = [
      {
        id: makeNoteId(),
        pages: [{ title: '欢迎使用 MiaoMemo!', content: '# 欢迎使用 MiaoMemo! \n\n这是一款极简风格的 Windows 桌面悬浮亚克力便签。\n\n**✨ 待办清单 🗒️**\n- [ ] **新增任务**：输入 `- [ ] 任务内容` 即可自动渲染为精美的圆角复选框。\n- [x] **已完成任务**：直接用鼠标点击复选框即可快捷勾选，此条为已完成演示。\n\n**✨ 极简操作：**\n- **拖拽**：按住顶部空白处（拖拽条位置）即可移动便签。\n- **置顶 📌**：点击顶部左侧图钉，锁定便签在最上层。\n- **调色 🎨**：在便签区域内右键，选择“更换主题”即可切换 6 种色系。\n- **自动保存**：写完即走，无需手动保存。\n- **新建 `+`**：点击底部 `+` 即可在桌面新建一个便签。' }],
        currentPageIndex: 0,
        color: 'white',
        x: pos.x,
        y: pos.y,
        width: DEFAULT_NOTE_WIDTH,
        height: DEFAULT_NOTE_HEIGHT,
        isPinned: false
      }
    ];
    schedulePersist();
  }
}

// Migrate and clean the database on startup:
// - Normalize pages[] entries from string to {title, content} format
// - Remove notes where all pages are empty
// - Drop legacy isCollapsed flag (fold feature removed, see renderer)
function migrateDB() {
  const db = getDB();
  if (!db.notes || db.notes.length === 0) return;

  let changed = false;

  db.notes = db.notes.filter(note => {
    if (!note.pages || note.pages.length === 0) {
      changed = true;
      return false; // remove notes with no pages
    }

    // Normalize each page: string → {title, content}
    note.pages = note.pages.map(page => {
      if (typeof page === 'string') {
        changed = true;
        return { title: extractTitleFromText(page), content: page };
      }
      return page;
    });

    if (note.isCollapsed !== undefined) {
      delete note.isCollapsed;
      changed = true;
    }

    // Check if all pages are empty
    if (isNoteEmpty(note)) {
      changed = true;
      return false; // remove completely empty notes
    }

    return true;
  });

  if (changed) {
    schedulePersist();
    console.log(`DB migration: cleaned, ${db.notes.length} remaining notes`);
  }
}

// Create a window for a specific note
function createNoteWindow(note) {
  if (windows.has(note.id)) {
    const win = windows.get(note.id);
    if (!win.isDestroyed()) {
      win.focus();
      return;
    }
  }

  const win = new BrowserWindow({
    width: note.width || DEFAULT_NOTE_WIDTH,
    height: note.height || DEFAULT_NOTE_HEIGHT,
    x: note.x,
    y: note.y,
    frame: false,
    transparent: true,
    alwaysOnTop: note.isPinned || false,
    skipTaskbar: true, // Float on desktop, avoid cluttering taskbar
    hasShadow: true,
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(`file://${path.join(__dirname, 'index.html')}?id=${note.id}`);
  win.setMenu(null);

  win.once('ready-to-show', () => {
    win.show();
  });

  // Auto-save window geometry to memory; flush debounced to disk (no sync I/O per move)
  const saveBounds = () => {
    if (win.isDestroyed()) return;
    const bounds = win.getBounds();
    const db = getDB();
    const target = db.notes.find(n => n.id === note.id);
    if (target) {
      target.x = bounds.x;
      target.y = bounds.y;
      target.width = bounds.width;
      target.height = bounds.height;
      schedulePersist();
    }
  };

  win.on('move', saveBounds);
  win.on('resize', saveBounds);

  win.on('closed', () => {
    windows.delete(note.id);
  });

  windows.set(note.id, win);
}

// Setup System Tray
function setupTray() {
  const trayIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '新建便签 (+)',
      click: () => {
        handleCreateNewNote();
      }
    },
    {
      label: '显示所有便签',
      click: () => {
        const db = getDB();
        db.notes.forEach(note => {
          createNoteWindow(note);
        });
      }
    },
    { type: 'separator' },
    {
      label: '退出 MiaoMemo',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('MiaoMemo 亚克力便签');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    handleCreateNewNote();
  });
}

// Start-up sequence
app.whenReady().then(() => {
  cleanupStaleTmp(dbPath);
  initializeDB();
  migrateDB();   // Clean up empty notes & normalize data format
  setupTray();

  // Load all notes stored in db
  const db = getDB();
  if (db.notes.length > 0) {
    // Only show the first note window on startup; others stay in the DB
    createNoteWindow(db.notes[0]);
  }
});

// 退出前刷盘，防止防抖队列丢失
app.on('before-quit', () => {
  flushDBSync();
});

// IPC Handler: Get note details
ipcMain.handle('get-note-data', (event, noteId) => {
  const db = getDB();
  return db.notes.find(n => n.id === noteId);
});

// IPC Handler: Update note contents / visual settings (memory + debounced flush)
ipcMain.handle('update-note', (event, noteId, updatedFields) => {
  const db = getDB();
  const index = db.notes.findIndex(n => n.id === noteId);
  if (index !== -1) {
    db.notes[index] = { ...db.notes[index], ...updatedFields };

    // Sync settings directly to target BrowserWindow if needed
    const win = windows.get(noteId);
    if (win && !win.isDestroyed()) {
      if (updatedFields.isPinned !== undefined) {
        win.setAlwaysOnTop(updatedFields.isPinned);
      }
    }

    schedulePersist();
    return true;
  }
  return false;
});

// Internal event + IPC Handler: Create new note
const handleCreateNewNote = () => {
  const db = getDB();
  const pos = getCascadePosition();
  const newNote = createDefaultNote(makeNoteId(), pos);

  db.notes.push(newNote);
  schedulePersist();
  createNoteWindow(newNote);
};

ipcMain.on('create-new-note-event', handleCreateNewNote);
ipcMain.handle('create-note', () => {
  handleCreateNewNote();
});

// IPC Handler: Delete note
ipcMain.handle('delete-note', (event, noteId) => {
  const win = windows.get(noteId);
  if (win && !win.isDestroyed()) {
    win.close();
  }

  const db = getDB();
  db.notes = db.notes.filter(n => n.id !== noteId);
  schedulePersist();
  return true;
});

// IPC Handler: Close window (delete note if all pages are empty)
ipcMain.handle('close-window', (event, noteId) => {
  const win = windows.get(noteId);
  if (win && !win.isDestroyed()) {
    win.close();
  }

  // Check if note has any content — if completely empty, remove from DB
  const db = getDB();
  const note = db.notes.find(n => n.id === noteId);
  if (note && isNoteEmpty(note)) {
    db.notes = db.notes.filter(n => n.id !== noteId);
  }
  schedulePersist();
  return true;
});

// IPC Handler: Quit app entirely
ipcMain.handle('quit-app', () => {
  app.isQuitting = true;
  app.quit();
});

// Quit only when explicitly requested; otherwise stay in tray
app.on('window-all-closed', () => {
  if (app.isQuitting) {
    app.quit();
  }
});
