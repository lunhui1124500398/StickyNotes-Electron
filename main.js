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

    // 获取当前主题以设置窗口背景色
    const config = configManager.getConfig();
    let bgColor = '#f5e6c8'; // 默认羊皮纸色
    if (config.theme === 'dark') {
        bgColor = '#1e1e1e';
    } else if (config.theme === 'light') {
        bgColor = '#ffffff';
    }

    console.log('Creating new sticky window with theme:', config.theme);
    const stickyWin = new BrowserWindow({
        width: options.width || 320,
        height: options.height || 280,
        minWidth: 200,
        minHeight: 150,
        x: options.x || 100,
        y: options.y || 100,
        frame: false,
        resizable: true,
        alwaysOnTop: options.alwaysOnTop || false,
        skipTaskbar: true,
        show: false, // 先隐藏，等内容加载完再显示
        backgroundColor: bgColor, // 设置背景色防止白屏
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });


    // 内容加载完成后再显示窗口
    stickyWin.once('ready-to-show', () => {
        stickyWin.show();
        console.log('Sticky window ready and shown');
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

// 触发主窗口的"隐藏当前便利贴"功能
function toggleHiddenCurrentNote() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('trigger-toggle-hidden');
    }
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

function unregisterHotkeys() {
    globalShortcut.unregisterAll();
}

// 将小写快捷键转换为 Electron 需要的格式 (Alt+Shift+S)
function formatHotkeyForElectron(hotkey) {
    if (!hotkey) return '';
    return hotkey.split('+').map(part => {
        const p = part.trim().toLowerCase();
        if (p === 'ctrl') return 'Ctrl';
        if (p === 'alt') return 'Alt';
        if (p === 'shift') return 'Shift';
        if (p === 'meta' || p === 'cmd' || p === 'command') return 'Meta';
        if (p === 'space') return 'Space';
        // 单个字母转大写
        if (p.length === 1) return p.toUpperCase();
        // 其他键首字母大写
        return p.charAt(0).toUpperCase() + p.slice(1);
    }).join('+');
}

// 验证快捷键是否有效（只包含 ASCII 字符，且格式正确）
function isValidHotkey(hotkey) {
    if (!hotkey || typeof hotkey !== 'string') return false;
    // 快捷键只能包含 ASCII 字符
    if (!/^[\x00-\x7F]+$/.test(hotkey)) return false;
    // 必须包含 + 分隔符或是单个键
    const parts = hotkey.split('+');
    if (parts.length === 0) return false;
    // 每个部分都不能为空
    for (const part of parts) {
        if (!part.trim()) return false;
    }
    return true;
}

function registerHotkeys() {
    const config = configManager.getConfig();
    try {
        if (config.hotkey_show && isValidHotkey(config.hotkey_show)) {
            const formatted = formatHotkeyForElectron(config.hotkey_show);
            console.log('Registering hotkey_show:', formatted);
            globalShortcut.register(formatted, showMainWindow);
        }
        if (config.hotkey_hide_all && isValidHotkey(config.hotkey_hide_all)) {
            const formatted = formatHotkeyForElectron(config.hotkey_hide_all);
            console.log('Registering hotkey_hide_all:', formatted);
            globalShortcut.register(formatted, toggleHiddenCurrentNote);
        }
        if (config.hotkey_close_stickies && isValidHotkey(config.hotkey_close_stickies)) {
            const formatted = formatHotkeyForElectron(config.hotkey_close_stickies);
            console.log('Registering hotkey_close_stickies:', formatted);
            globalShortcut.register(formatted, closeAllStickies);
        }
        if (config.hotkey_popout && isValidHotkey(config.hotkey_popout)) {
            const formatted = formatHotkeyForElectron(config.hotkey_popout);
            console.log('Registering hotkey_popout:', formatted);
            globalShortcut.register(formatted, () => {
                // 发送弹出消息到主窗口
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('trigger-popout');
                }
            });
        }
        if (config.hotkey_delete && isValidHotkey(config.hotkey_delete)) {
            const formatted = formatHotkeyForElectron(config.hotkey_delete);
            console.log('Registering hotkey_delete:', formatted);
            globalShortcut.register(formatted, () => {
                // 发送删除消息到主窗口
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('trigger-delete');
                }
            });
        }
    } catch (e) {
        console.error('Failed to register hotkeys:', e);
    }
}


// 广播配置变更到所有窗口
function broadcastConfigChange(config) {
    // 广播到主窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('config-changed', config);
    }
    // 广播到所有浮动窗口
    stickyWindows.forEach((win) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('config-changed', config);
        }
    });
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

        // 重新注册快捷键（实现热更新）
        unregisterHotkeys();
        registerHotkeys();
        console.log('Hotkeys re-registered after config change');

        // 广播配置变更到所有窗口（实现主题热更新）
        broadcastConfigChange(result);

        return result;
    });

    // 快捷键录制模式 - 开始录制时临时注销全局快捷键
    ipcMain.handle('start-hotkey-recording', async () => {
        console.log('Start hotkey recording - unregistering all hotkeys');
        unregisterHotkeys();
        return true;
    });

    // 快捷键录制模式 - 结束录制时重新注册快捷键
    ipcMain.handle('stop-hotkey-recording', async () => {
        console.log('Stop hotkey recording - re-registering hotkeys');
        registerHotkeys();
        return true;
    });

    // 获取解析后的完整数据路径
    ipcMain.handle('get-resolved-data-path', async () => {
        return configManager.getDataDir();
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

    // 笔记变更通知 - 转发到主窗口
    ipcMain.on('note-changed', (event, noteId) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('note-changed', noteId);
        }
    });

    // 窗口调整大小
    ipcMain.on('resize-window', (event, width, height) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            win.setSize(Math.round(width), Math.round(height));
        }
    });

    // 刷新窗口焦点 - 解决 confirm() 对话框后窗口焦点异常的问题
    ipcMain.on('refocus-window', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            // 通过 blur 和 focus 强制刷新窗口焦点状态
            win.blur();
            win.focus();
        }
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