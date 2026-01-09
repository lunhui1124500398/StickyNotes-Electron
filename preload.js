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
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getResolvedDataPath: () => ipcRenderer.invoke('get-resolved-data-path'),
    startHotkeyRecording: () => ipcRenderer.invoke('start-hotkey-recording'),
    stopHotkeyRecording: () => ipcRenderer.invoke('stop-hotkey-recording'),


    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),

    openSticky: (noteId, title, options) => ipcRenderer.send('open-sticky', noteId, title, options),
    closeSticky: (noteId) => ipcRenderer.send('close-sticky', noteId),
    setStickyOnTop: (noteId, onTop) => ipcRenderer.send('set-sticky-on-top', noteId, onTop),
    resizeWindow: (width, height) => ipcRenderer.send('resize-window', width, height),


    // 通知主窗口笔记已更改
    notifyNoteChanged: (noteId) => ipcRenderer.send('note-changed', noteId),

    onConfigChanged: (callback) => {
        ipcRenderer.on('config-changed', (event, config) => callback(config));
    },

    onTriggerPopout: (callback) => {
        ipcRenderer.on('trigger-popout', () => callback());
    },

    // 监听笔记变更通知
    onNoteChanged: (callback) => {
        ipcRenderer.on('note-changed', (event, noteId) => callback(noteId));
    },

    // 监听全局快捷键触发的隐藏当前便利贴
    onTriggerToggleHidden: (callback) => {
        ipcRenderer.on('trigger-toggle-hidden', () => callback());
    },

    // 监听全局快捷键触发的删除当前便利贴
    onTriggerDelete: (callback) => {
        ipcRenderer.on('trigger-delete', () => callback());
    }
});

