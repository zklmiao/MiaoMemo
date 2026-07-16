const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getNoteData: (noteId) => ipcRenderer.invoke('get-note-data', noteId),
  updateNote: (noteId, updatedFields) => ipcRenderer.invoke('update-note', noteId, updatedFields),
  createNote: () => ipcRenderer.invoke('create-note'),
  deleteNote: (noteId) => ipcRenderer.invoke('delete-note', noteId),
  toggleCollapse: (noteId, isCollapsed, height) => ipcRenderer.invoke('toggle-collapse', noteId, isCollapsed, height),
  closeWindow: (noteId) => ipcRenderer.invoke('close-window', noteId),
  quitApp: () => ipcRenderer.invoke('quit-app')
});
