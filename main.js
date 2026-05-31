const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Disable hardware acceleration to resolve transparent window rendering issues on Windows
// app.disableHardwareAcceleration();

// Path for storing note data
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'notes.json');
const iconPath = path.join(__dirname, 'icon.ico');

// Base64 memo icon (32x32 yellow sticky note) - Retained for reference, no longer written automatically since icon.ico is present
const base64Icon = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH6AYbFSUKDC+2XwAAAKBJREFUWMPt1zEKwjAUh/F/ix4g4tBRPIJbT+AO4tLTeC/v4G5tF+8gCkJF8V5CUDD4fC95SUnTJh+t7wUX8iN5efmSgGGYmZnZX2Ui4ggcAQugD5wAz8DY5toG1sDrWJdj22sB5MApIAP2wB7YAdfAuWtsB1wD1/p/tZ0D6+5sT14C3gEDMAKGtq+AEdAAdkC/7t5D6y7M/2VmZmZmZs/1BAM2L3P1655JAAAAAElFTkSuQmCC';

let tray = null;
const windows = new Map(); // noteId -> BrowserWindow
let dbWriteTimeout = null;

// Read DB file
function readDB() {
  try {
    if (fs.existsSync(dbPath)) {
      return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading notes database:', e);
  }
  return { notes: [] };
}

// Write DB file
function writeDB(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing notes database:', e);
  }
}

// Stagger coordinates for cascading windows
function getCascadePosition(noteWidth = 300, noteHeight = 350) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const count = windows.size;
  const x = Math.max(50, Math.floor((width - noteWidth) / 2) + (count % 8) * 30 + 150);
  const y = Math.max(50, Math.floor((height - noteHeight) / 2) - 100 + (count % 8) * 30);
  return { x, y };
}

// Initialize default notes if empty
function initializeDB() {
  const db = readDB();
  if (!db.notes || db.notes.length === 0) {
    const pos = getCascadePosition();
    db.notes = [
      {
        id: 'note-' + Date.now(),
        pages: ['# 欢迎使用 MiaoMemo! \n\n这是一款极简风格的 Windows 桌面悬浮亚克力便签。\n\n**✨ 待办清单 🗒️**\n- [ ] **新增任务**：输入 \`- [ ] 任务内容\` 即可自动渲染为精美的圆角复选框。\n- [x] **已完成任务**：直接用鼠标点击复选框即可快捷勾选，此条为已完成演示。\n\n**✨ 极简操作：**\n- **拖拽**：按住顶部空白处（拖拽条位置）即可移动便签。\n- **置顶 📌**：点击顶部左侧图钉，锁定便签在最上层。\n- **调色 🎨**：在便签区域内右键，选择“更换主题”即可切换 6 种色系。\n- **自动保存**：写完即走，无需手动保存。\n- **新建 `+`**：点击底部 `+` 即可在桌面新建一个便签。'],
        currentPageIndex: 0,
        color: 'white',
        x: pos.x,
        y: pos.y,
        width: 300,
        height: 380,
        isPinned: false,
        isCollapsed: false
      }
    ];
    writeDB(db);
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

  const winHeight = note.isCollapsed ? 34 : (note.height || 350);

  const win = new BrowserWindow({
    width: note.width || 300,
    height: winHeight,
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

  // Auto-save window geometry when moved or resized
  const saveBounds = () => {
    if (win.isDestroyed()) return;
    const bounds = win.getBounds();
    const db = readDB();
    const target = db.notes.find(n => n.id === note.id);
    if (target) {
      target.x = bounds.x;
      target.y = bounds.y;
      // Do not overwrite normal height if window is currently collapsed
      if (!target.isCollapsed) {
        target.width = bounds.width;
        target.height = bounds.height;
      }
      writeDB(db);
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
        ipcMain.emit('create-new-note-event');
      }
    },
    {
      label: '显示所有便签',
      click: () => {
        const db = readDB();
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
    ipcMain.emit('create-new-note-event');
  });
}

// Start-up sequence
app.whenReady().then(() => {
  initializeDB();
  setupTray();

  // Load all notes stored in db
  const db = readDB();
  db.notes.forEach(note => {
    createNoteWindow(note);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const currentDB = readDB();
      if (currentDB.notes.length > 0) {
        currentDB.notes.forEach(note => createNoteWindow(note));
      } else {
        ipcMain.emit('create-new-note-event');
      }
    }
  });
});

// IPC Handler: Get note details
ipcMain.handle('get-note-data', (event, noteId) => {
  const db = readDB();
  return db.notes.find(n => n.id === noteId);
});

// IPC Handler: Update note contents / visual settings
ipcMain.handle('update-note', (event, noteId, updatedFields) => {
  // Use debouncing for saving data to avoid excessive writes
  if (dbWriteTimeout) clearTimeout(dbWriteTimeout);

  const db = readDB();
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

    dbWriteTimeout = setTimeout(() => {
      writeDB(db);
    }, 250);
    return true;
  }
  return false;
});

// IPC Handler: Toggle Collapse height
ipcMain.handle('toggle-collapse', (event, noteId, isCollapsed, height) => {
  const win = windows.get(noteId);
  if (win && !win.isDestroyed()) {
    const db = readDB();
    const note = db.notes.find(n => n.id === noteId);
    if (note) {
      note.isCollapsed = isCollapsed;
      writeDB(db);

      const bounds = win.getBounds();
      const targetHeight = isCollapsed ? 34 : (height || 350);
      win.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: targetHeight
      });
    }
  }
});

// Internal event + IPC Handler: Create new note
const handleCreateNewNote = () => {
  const db = readDB();
  const pos = getCascadePosition();
  const newNote = {
    id: 'note-' + Date.now(),
    pages: [''],
    currentPageIndex: 0,
    color: 'white',
    x: pos.x,
    y: pos.y,
    width: 300,
    height: 350,
    isPinned: false,
    isCollapsed: false
  };

  db.notes.push(newNote);
  writeDB(db);
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
  
  const db = readDB();
  db.notes = db.notes.filter(n => n.id !== noteId);
  writeDB(db);
  return true;
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  app.quit();
});
