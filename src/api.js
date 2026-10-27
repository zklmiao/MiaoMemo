// Tauri IPC adapter. Each note window's label is its note id, so no query
// string is needed. The method signatures intentionally mirror the previous
// preload API to keep renderer.js focused on UI logic.
(function () {
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || !tauri.window) {
    throw new Error('Tauri global API is unavailable (withGlobalTauri must be enabled)');
  }

  const invoke = tauri.core.invoke;
  const currentWindow = tauri.window.getCurrentWindow();
  const currentNoteId = currentWindow.label;

  window.memoAPI = {
    noteId: currentNoteId,
    getNoteData: (noteId) => invoke('get_note_data', { noteId: noteId || currentNoteId }),
    updateNote: (noteId, fields) => invoke('update_note', { noteId: noteId || currentNoteId, fields }),
    createNote: () => invoke('create_note'),
    deleteNote: (noteId) => invoke('delete_note', { noteId: noteId || currentNoteId }),
    closeWindow: (noteId) => invoke('close_window', { noteId: noteId || currentNoteId }),
    quitApp: () => invoke('quit_app')
  };
}());
