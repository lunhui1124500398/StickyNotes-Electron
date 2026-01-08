const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage, dialog } = require('electron');
const path = require('path');
const NotesManager = require('./src/notes-manager');
const ConfigManager = require('./src/config');

// 禁用 GPU 磁盘缓存以消除权限错误警告
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');
app.commandLine.appendSwitch('disable-gpu-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');

// 设置缓存路径到用户数据目录，避免权限问题
app.setPath('cache', path.join(app.getPath('userData'), 'cache'));

let mainWindow = null;
let tray = null;
const stickyWindows = new Map();
let notesManager = null;
let configManager = null;

function createMainWindow() {
    const config = configManager.getConfig();

    mainWindow = new BrowserWindow({
        width: config.window_width || 900,
        height: config.window_height || 650,
        minWidth: 600,
        minHeight: 400,
        frame: false,
        resizable: true,
        show: !config.start_minimized,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createStickyWindow(noteId, title, options = {}) {
    console.log('createStickyWindow called with:', { noteId, title, options });

    if (stickyWindows.has(noteId)) {
        console.log('Sticky window already exists, focusing');
        stickyWindows.get(noteId).focus();
        return;
    }

    console.log('Creating new sticky window');
    const stickyWin = new BrowserWindow({
        width: options.width || 320,
        height: options.height || 280,
        x: options.x || 100,
        y: options.y || 100,
        frame: false,
        resizable: true,
        alwaysOnTop: options.alwaysOnTop || false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    const stickyPath = path.join(__dirname, 'renderer', 'sticky.html');
    console.log('Loading sticky.html from:', stickyPath);

    stickyWin.loadFile(stickyPath, {
        query: { id: noteId }
    });

    stickyWin.on('closed', () => {
        stickyWindows.delete(noteId);
    });

    stickyWindows.set(noteId, stickyWin);
    console.log('Sticky window created successfully');
}

function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    let trayIcon;

    try {
        trayIcon = nativeImage.createFromPath(iconPath);
        if (trayIcon.isEmpty()) {
            trayIcon = nativeImage.createEmpty();
        }
    } catch (e) {
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('StickyNotes');

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show Window', click: () => showMainWindow() },
        { type: 'separator' },
        { label: 'Hide All Notes', click: () => hideAllStickies() },
        { label: 'Show All Notes', click: () => showAllStickies() },
        { type: 'separator' },
        { label: 'Quit', click: () => quitApp() }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => showMainWindow());
}

function showMainWindow() {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
}

function hideAllStickies() {
    stickyWindows.forEach((win) => win.hide());
}

function showAllStickies() {
    stickyWindows.forEach((win) => win.show());
}

function closeAllStickies() {
    stickyWindows.forEach((win) => win.close());
    stickyWindows.clear();
}

function quitApp() {
    app.isQuitting = true;
    closeAllStickies();
    app.quit();
}

function registerHotkeys() {
    const config = configManager.getConfig();
    try {
        if (config.hotkey_show) {
            globalShortcut.register(config.hotkey_show, showMainWindow);
        }
        if (config.hotkey_hide_all) {
            globalShortcut.register(config.hotkey_hide_all, hideAllStickies);
        }
        if (config.hotkey_close_stickies) {
            globalShortcut.register(config.hotkey_close_stickies, closeAllStickies);
        }
        if (config.hotkey_popout) {
            globalShortcut.register(config.hotkey_popout, () => {
                // 发送弹出消息到主窗口
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('trigger-popout');
                }
            });
        }
    } catch (e) {
        console.error('Failed to register hotkeys:', e);
    }
}

function setupIpcHandlers() {
    ipcMain.handle('get-notes', async (event, includeHidden) => {
        return notesManager.getAllNotes(includeHidden);
    });

    ipcMain.handle('get-note', async (event, noteId) => {
        return notesManager.getNote(noteId);
    });

    ipcMain.handle('create-note', async (event, data) => {
        return notesManager.createNote(data.title, data.content);
    });

    ipcMain.handle('update-note', async (event, noteId, data) => {
        return notesManager.updateNote(noteId, data);
    });

    ipcMain.handle('delete-note', async (event, noteId) => {
        return notesManager.deleteNote(noteId);
    });

    ipcMain.handle('toggle-hidden', async (event, noteId) => {
        return notesManager.toggleHidden(noteId);
    });

    ipcMain.handle('unhide-all', async () => {
        return notesManager.unhideAll();
    });

    ipcMain.handle('search-notes', async (event, query) => {
        return notesManager.searchNotes(query);
    });

    ipcMain.handle('get-config', async () => {
        return configManager.getConfig();
    });

    ipcMain.handle('save-config', async (event, updates) => {
        const oldDataPath = configManager.getDataDir();
        const result = configManager.saveConfig(updates);
        const newDataPath = configManager.getDataDir();

        // 如果数据路径变化，重新初始化 NotesManager
        if (oldDataPath !== newDataPath) {
            notesManager = new NotesManager(newDataPath);
            console.log('NotesManager reinitialized with new data path:', newDataPath);
        }
        return result;
    });

    ipcMain.handle('select-folder', async (event) => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: '选择数据存储文件夹',
            properties: ['openDirectory', 'createDirectory']
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    });

    ipcMain.on('window-minimize', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) win.minimize();
    });

    ipcMain.on('window-maximize', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            if (win.isMaximized()) win.unmaximize();
            else win.maximize();
        }
    });

    ipcMain.on('window-close', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            if (win === mainWindow) win.hide();
            else win.close();
        }
    });

    ipcMain.on('open-sticky', (event, noteId, title, options) => {
        console.log('IPC open-sticky received:', { noteId, title, options });
        createStickyWindow(noteId, title, options);
    });

    ipcMain.on('close-sticky', (event, noteId) => {
        const win = stickyWindows.get(noteId);
        if (win) win.close();
    });

    ipcMain.on('set-sticky-on-top', (event, noteId, onTop) => {
        const win = stickyWindows.get(noteId);
        if (win) win.setAlwaysOnTop(onTop);
    });
}

app.whenReady().then(() => {
    configManager = new ConfigManager();
    notesManager = new NotesManager(configManager.getDataDir());

    setupIpcHandlers();
    createMainWindow();
    createTray();
    registerHotkeys();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // Keep running with tray
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
    app.isQuitting = true;
});