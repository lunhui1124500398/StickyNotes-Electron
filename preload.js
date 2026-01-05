const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getNotes: (includeHidden = false) => ipcRenderer.invoke('get-notes', includeHidden),
    getNote: (noteId) => ipcRenderer.invoke('get-note', noteId),
    createNote: (data) => ipcRenderer.invoke('create-note', data),
    updateNote: (noteId, data) => ipcRenderer.invoke('update-note', noteId, data),
    deleteNote: (noteId) => ipcRenderer.invoke('delete-note', noteId),
    toggleHidden: (noteId) => ipcRenderer.invoke('toggle-hidden', noteId),
    unhideAll: () => ipcRenderer.invoke('unhide-all'),
    searchNotes: (query) => ipcRenderer.invoke('search-notes', query),

    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (updates) => ipcRenderer.invoke('save-config', updates),

    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),

    openSticky: (noteId, title, options) => ipcRenderer.send('open-sticky', noteId, title, options),
    closeSticky: (noteId) => ipcRenderer.send('close-sticky', noteId),
    setStickyOnTop: (noteId, onTop) => ipcRenderer.send('set-sticky-on-top', noteId, onTop),

    onConfigChanged: (callback) => {
        ipcRenderer.on('config-changed', (event, config) => callback(config));
    }
});