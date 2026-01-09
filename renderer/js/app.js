/**
 * StickyNotes - 主应用逻辑
 * 
 * 处理便利贴CRUD、Markdown编辑、设置管理等功能
 */

// ============================================
// 全局状态
// ============================================

const state = {
    notes: [],
    currentNote: null,
    config: {},
    isPreviewMode: true,  // 默认开启预览
    isSplitMode: true,    // 默认分屏模式
    showHidden: false,
    autoSaveTimer: null,
    recordingHotkey: null,  // 正在录制的快捷键字段
    searchQuery: '',  // 当前搜索关键词
    settingsChanged: false,  // 设置是否有未保存的更改
};


// DOM 元素引用
// ============================================

const elements = {
    notesList: document.getElementById('notes-list'),
    searchInput: document.getElementById('search-input'),
    editor: document.getElementById('editor'),
    preview: document.getElementById('preview'),
    noteTitle: document.getElementById('note-title'),
    statusText: document.getElementById('status-text'),
    wordCount: document.getElementById('word-count'),
    settingsModal: document.getElementById('settings-modal'),
    editorContainer: document.querySelector('.editor-container'),
    editorHeader: document.getElementById('editor-header'),
};

// ============================================
// Markdown 配置
// ============================================

function initMarked() {
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,      // 支持换行
            gfm: true,         // GitHub风格Markdown
            headerIds: false,  // 禁用header id
            mangle: false,     // 禁用email地址混淆
        });
        console.log('Marked.js configured');
    }
}

// ============================================
// 便利贴管理
// ============================================

async function loadNotes() {
    try {
        // 清除搜索状态
        state.searchQuery = '';
        state.notes = await window.electronAPI.getNotes(state.showHidden);
        renderNotesList();

        // 如果没有选中的便利贴，选中第一个
        if (!state.currentNote && state.notes.length > 0) {
            selectNote(state.notes[0].id);
        } else if (state.notes.length === 0) {
            showEmptyState();
        }
    } catch (error) {
        console.error('Failed to load notes:', error);
        showStatus('加载便利贴失败', 'error');
    }
}

function renderNotesList() {
    elements.notesList.innerHTML = '';

    if (state.notes.length === 0) {
        elements.notesList.innerHTML = '<div class="empty-list" style="padding: 20px; text-align: center; opacity: 0.6;">没有便利贴</div>';
        return;
    }

    state.notes.forEach(note => {
        const item = createNoteItem(note, state.searchQuery);
        elements.notesList.appendChild(item);
    });
}

// 高亮文本中的搜索关键词
function highlightText(text, query) {
    if (!query || !text) return escapeHtml(text);

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    const parts = text.split(regex);

    return parts.map(part => {
        if (part.toLowerCase() === query.toLowerCase()) {
            return `<mark class="search-highlight">${escapeHtml(part)}</mark>`;
        }
        return escapeHtml(part);
    }).join('');
}

function createNoteItem(note, searchQuery = '') {
    const div = document.createElement('div');
    div.className = 'note-item' + (state.currentNote?.id === note.id ? ' active' : '');
    div.dataset.id = note.id;

    // 格式化日期
    const date = new Date(note.updated_at);
    const dateStr = formatDate(date);

    // 如果有搜索上下文，显示高亮的搜索结果
    let previewHtml;
    if (searchQuery && note.matchContext) {
        previewHtml = highlightText(note.matchContext, searchQuery);
    } else {
        // 默认预览（去除Markdown标记）
        const preview = note.content
            .replace(/[#*_`~\[\]]/g, '')
            .substring(0, 50);
        previewHtml = searchQuery ? highlightText(preview, searchQuery) : escapeHtml(preview);
    }

    // 标题也支持高亮
    const titleHtml = searchQuery ? highlightText(note.title, searchQuery) : escapeHtml(note.title);

    div.innerHTML = `
        <div class="note-item-title">${titleHtml}</div>
        <div class="note-item-preview">${previewHtml}</div>
        <div class="note-item-date">${dateStr}</div>
        <div class="note-item-badges">
            ${note.is_hidden ? '<span class="badge hidden">隐藏</span>' : ''}
            ${note.is_pinned ? '<span class="badge">置顶</span>' : ''}
        </div>
    `;

    div.addEventListener('click', () => selectNote(note.id));

    return div;
}

async function selectNote(noteId) {
    // 保存当前便利贴
    if (state.currentNote) {
        await saveCurrentNote();
    }

    const note = state.notes.find(n => n.id === noteId);
    if (!note) return;

    state.currentNote = note;

    // 隐藏空状态，显示编辑器
    hideEmptyState();

    // 更新UI
    elements.noteTitle.value = note.title;
    elements.editor.value = note.content;
    updatePreview();
    updateWordCount();

    // 更新列表选中状态
    document.querySelectorAll('.note-item').forEach(item => {
        item.classList.toggle('active', item.dataset.id === noteId);
    });

    // 显示编辑器区域
    elements.editorHeader.style.display = 'flex';
    elements.editorContainer.style.display = 'flex';

    showStatus('已加载便利贴');
}

async function createNote() {
    try {
        const note = await window.electronAPI.createNote({
            title: '新便利贴',
            content: ''
        });

        state.notes.unshift(note);
        renderNotesList();
        selectNote(note.id);

        // 聚焦标题输入框
        elements.noteTitle.select();

        showStatus('已创建新便利贴');
    } catch (error) {
        console.error('Failed to create note:', error);
        showStatus('创建便利贴失败', 'error');
    }
}

async function saveCurrentNote() {
    if (!state.currentNote) return;

    const title = elements.noteTitle.value.trim() || '无标题';
    const content = elements.editor.value;

    // 检查是否有变化
    if (state.currentNote.title === title && state.currentNote.content === content) {
        return;
    }

    try {
        const updated = await window.electronAPI.updateNote(state.currentNote.id, {
            title,
            content
        });

        // 更新本地状态
        state.currentNote.title = updated.title;
        state.currentNote.content = updated.content;
        state.currentNote.updated_at = updated.updated_at;

        // 更新列表
        const item = document.querySelector(`.note-item[data-id="${state.currentNote.id}"]`);
        if (item) {
            item.querySelector('.note-item-title').textContent = title;
            item.querySelector('.note-item-preview').textContent = content.substring(0, 50);
            item.querySelector('.note-item-date').textContent = formatDate(new Date());
        }

        showStatus('已保存');
    } catch (error) {
        console.error('Failed to save note:', error);
        showStatus('保存失败', 'error');
    }
}

async function deleteCurrentNote() {
    if (!state.currentNote) return;

    if (!confirm('确定要删除这个便利贴吗？（可在回收站恢复）')) {
        return;
    }

    try {
        await window.electronAPI.deleteNote(state.currentNote.id);

        // 从列表中移除
        const index = state.notes.findIndex(n => n.id === state.currentNote.id);
        state.notes.splice(index, 1);

        state.currentNote = null;
        renderNotesList();

        // 选择下一个便利贴
        if (state.notes.length > 0) {
            selectNote(state.notes[0].id);
        } else {
            showEmptyState();
        }

        showStatus('已删除');
    } catch (error) {
        console.error('Failed to delete note:', error);
        showStatus('删除失败', 'error');
    }
}

async function toggleHiddenNote() {
    if (!state.currentNote) return;

    try {
        const result = await window.electronAPI.toggleHidden(state.currentNote.id);
        state.currentNote.is_hidden = result.is_hidden;

        showStatus(result.is_hidden ? '已隐藏' : '已显示');

        // 如果不显示隐藏便利贴，需要刷新列表
        if (!state.showHidden && result.is_hidden) {
            await loadNotes();
        } else {
            renderNotesList();
        }
    } catch (error) {
        console.error('Failed to toggle hidden:', error);
        showStatus('操作失败', 'error');
    }
}

// 显示所有隐藏的便利贴（解隐藏）
async function unhideAllNotes() {
    try {
        await window.electronAPI.unhideAll();
        showStatus('已显示所有隐藏便利贴');
        await loadNotes();
    } catch (error) {
        console.error('Failed to unhide all notes:', error);
        showStatus('操作失败', 'error');
    }
}

// 弹出当前便利贴为浮动窗口
async function popoutCurrentNote() {
    console.log('popoutCurrentNote called, currentNote:', state.currentNote);

    if (!state.currentNote) {
        showStatus('请先选择一个便利贴');
        return;
    }

    // 先保存当前便利贴
    await saveCurrentNote();

    const noteId = state.currentNote.id;
    const note = state.currentNote;

    // 计算窗口位置和大小
    const options = {
        width: note.width || 320,
        height: note.height || 280,
        x: note.position_x || 100,
        y: note.position_y || 100
    };

    console.log('Opening sticky with:', { noteId, title: note.title, options });
    console.log('electronAPI available:', !!window.electronAPI);
    console.log('openSticky available:', !!(window.electronAPI && window.electronAPI.openSticky));

    // 使用 Electron API 打开浮动窗口
    if (window.electronAPI && window.electronAPI.openSticky) {
        window.electronAPI.openSticky(noteId, note.title, options);
        showStatus('已弹出为浮动便利贴');
    } else {
        console.error('electronAPI.openSticky not available!');
        showStatus('无法打开浮动窗口');
    }
}

function showEmptyState() {
    elements.editorHeader.style.display = 'none';

    // 隐藏编辑器和预览
    if (elements.editor) {
        elements.editor.style.display = 'none';
    }
    if (elements.preview) {
        elements.preview.style.display = 'none';
    }

    // 显示空状态提示
    let emptyState = document.getElementById('empty-state');
    if (!emptyState) {
        emptyState = document.createElement('div');
        emptyState.id = 'empty-state';
        emptyState.className = 'empty-state';
        emptyState.innerHTML = `
            <div class="empty-icon">📝</div>
            <h3>还没有便利贴</h3>
            <p>点击左上角的 + 按钮创建第一个便利贴</p>
        `;
        elements.editorContainer.appendChild(emptyState);
    } else {
        emptyState.style.display = 'flex';
    }
}

// 隐藏空状态并恢复编辑器
function hideEmptyState() {
    const emptyState = document.getElementById('empty-state');
    if (emptyState) {
        emptyState.style.display = 'none';
    }

    // 显示编辑器和预览
    if (elements.editor) {
        elements.editor.style.display = 'block';
    }
    if (elements.preview) {
        elements.preview.style.display = 'block';
    }
    elements.editorContainer.style.display = 'flex';
}

// ============================================
// Markdown 渲染
// ============================================

function updatePreview() {
    if (typeof marked !== 'undefined' && elements.preview) {
        try {
            elements.preview.innerHTML = marked.parse(elements.editor.value || '');
        } catch (e) {
            console.error('Markdown parse error:', e);
            elements.preview.innerHTML = '<p style="color: red;">Markdown解析错误</p>';
        }
    }
}

function togglePreview() {
    state.isSplitMode = !state.isSplitMode;

    if (state.isSplitMode) {
        elements.editorContainer.classList.add('split');
        elements.preview.classList.add('active');
    } else {
        elements.editorContainer.classList.remove('split');
        elements.preview.classList.remove('active');
    }

    updatePreview();
}

// ============================================
// 搜索
// ============================================

async function searchNotes(query) {
    state.searchQuery = query.trim();

    if (!state.searchQuery) {
        await loadNotes();
        return;
    }

    try {
        state.notes = await window.electronAPI.searchNotes(query);
        renderNotesList();
    } catch (error) {
        console.error('Search failed:', error);
        showStatus('搜索失败', 'error');
    }
}

// ============================================
// 设置
// ============================================

async function loadConfig() {
    try {
        state.config = await window.electronAPI.getConfig();
        applyConfig();
    } catch (error) {
        console.error('Failed to load config:', error);
        // 使用默认配置
        state.config = {
            font_size: 16,
            font_family: 'LXGW WenKai, Microsoft YaHei, sans-serif',
            theme: 'parchment',
            auto_start: false,
            auto_save_interval: 30
        };
    }
}

function applyConfig() {
    const config = state.config;
    console.log('Applying config, theme:', config.theme);

    // 应用字体大小
    document.documentElement.style.setProperty('--font-size-base', config.font_size + 'px');

    // 应用字体样式
    document.documentElement.style.setProperty('--font-family', config.font_family);

    // 应用主题
    if (config.theme && config.theme !== 'parchment') {
        document.body.dataset.theme = config.theme;
        console.log('Theme applied:', config.theme);
    } else {
        delete document.body.dataset.theme;
        console.log('Theme reset to parchment (default)');
    }


    // 更新设置面板UI
    const fontSizeInput = document.getElementById('setting-font-size');
    const fontSizeValue = document.getElementById('font-size-value');
    if (fontSizeInput) {
        fontSizeInput.value = config.font_size;
        fontSizeValue.textContent = config.font_size + 'px';
    }

    // 字体预设和自定义输入
    const fontPresetSelect = document.getElementById('setting-font-preset');
    const fontFamilyInput = document.getElementById('setting-font-family');
    if (fontPresetSelect && fontFamilyInput) {
        const fontFamily = config.font_family || '';
        // 检查是否是预设字体
        const options = Array.from(fontPresetSelect.options).map(o => o.value);
        if (options.includes(fontFamily)) {
            fontPresetSelect.value = fontFamily;
            fontFamilyInput.style.display = 'none';
        } else {
            fontPresetSelect.value = 'custom';
            fontFamilyInput.value = fontFamily;
            fontFamilyInput.style.display = 'block';
        }
    }

    const themeSelect = document.getElementById('setting-theme');
    if (themeSelect) {
        themeSelect.value = config.theme || 'parchment';
    }

    const autoStartCheckbox = document.getElementById('setting-auto-start');
    if (autoStartCheckbox) {
        autoStartCheckbox.checked = config.auto_start;
    }

    const saveReminderCheckbox = document.getElementById('setting-save-reminder');
    if (saveReminderCheckbox) {
        saveReminderCheckbox.checked = config.show_save_reminder !== false;
    }

    const dataPathInput = document.getElementById('setting-data-path');
    if (dataPathInput) {
        dataPathInput.value = config.data_path || './data';
    }

    // 更新快捷键显示
    const hotkeyShow = document.getElementById('hotkey-show');
    const hotkeyHide = document.getElementById('hotkey-hide');
    const hotkeyPopout = document.getElementById('hotkey-popout');
    const hotkeyCloseStickies = document.getElementById('hotkey-close-stickies');
    const hotkeyDelete = document.getElementById('hotkey-delete');
    if (hotkeyShow) hotkeyShow.value = config.hotkey_show || 'alt+shift+s';
    if (hotkeyHide) hotkeyHide.value = config.hotkey_hide_all || 'ctrl+h';
    if (hotkeyPopout) hotkeyPopout.value = config.hotkey_popout || 'alt+shift+p';
    if (hotkeyCloseStickies) hotkeyCloseStickies.value = config.hotkey_close_stickies || 'alt+shift+c';
    if (hotkeyDelete) hotkeyDelete.value = config.hotkey_delete || 'delete';

    // 更新完整路径显示
    updateResolvedDataPath();
}


// 更新显示完整的数据路径
async function updateResolvedDataPath() {
    const resolvedPathEl = document.getElementById('resolved-data-path');
    if (resolvedPathEl && window.electronAPI && window.electronAPI.getResolvedDataPath) {
        try {
            const resolvedPath = await window.electronAPI.getResolvedDataPath();
            resolvedPathEl.textContent = resolvedPath;
            resolvedPathEl.title = resolvedPath;
        } catch (e) {
            resolvedPathEl.textContent = '无法获取路径';
        }
    }
}


async function saveConfig(updates) {
    try {
        state.config = await window.electronAPI.saveConfig(updates);
        applyConfig();
        showStatus('设置已保存');
    } catch (error) {
        console.error('Failed to save config:', error);
        showStatus('保存设置失败', 'error');
    }
}

function openSettings() {
    elements.settingsModal.classList.add('active');
    state.settingsChanged = false;  // 重置更改状态
}

async function closeSettings() {
    // 如果有未保存的更改，且开启了提醒
    if (state.settingsChanged && state.config.show_save_reminder !== false) {
        const shouldSave = confirm('设置已更改但未保存。\n\n点击「确定」保存设置，点击「取消」放弃更改。');
        if (shouldSave) {
            // 触发保存按钮点击
            document.getElementById('btn-save-settings').click();
            return;  // 保存操作会关闭设置面板
        }
    }

    elements.settingsModal.classList.remove('active');

    // 如果正在录制快捷键，需要恢复
    if (state.recordingHotkey) {
        state.recordingHotkey = null;
        // 重新注册快捷键
        if (window.electronAPI && window.electronAPI.stopHotkeyRecording) {
            await window.electronAPI.stopHotkeyRecording();
        }
    }

    // 移除所有录制状态
    document.querySelectorAll('.hotkey-input').forEach(input => {
        input.classList.remove('recording');
    });

    // 恢复原始配置（撤销实时预览的更改）
    applyConfig();
    state.settingsChanged = false;
}




// ============================================
// 快捷键录制
// ============================================

async function startHotkeyRecording(inputElement, configKey) {
    // 清除其他录制状态
    document.querySelectorAll('.hotkey-input').forEach(input => {
        input.classList.remove('recording');
    });

    // 通知主进程临时注销全局快捷键，避免录制时被拦截
    if (window.electronAPI && window.electronAPI.startHotkeyRecording) {
        await window.electronAPI.startHotkeyRecording();
    }

    // 保存原始值，用于按下相同快捷键时恢复显示
    const originalValue = inputElement.value;
    inputElement.classList.add('recording');
    inputElement.value = '请按下快捷键...';
    state.recordingHotkey = { element: inputElement, configKey, originalValue };
}

async function handleHotkeyRecording(e) {
    if (!state.recordingHotkey) return;

    e.preventDefault();
    e.stopPropagation();

    // 忽略单独的修饰键
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        return;
    }

    // 构建快捷键字符串
    const parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');

    // 获取按键
    let key = e.key.toLowerCase();
    if (key === ' ') key = 'space';
    parts.push(key);

    const hotkey = parts.join('+');

    // 更新输入框 - 即使和原来相同也要显示
    state.recordingHotkey.element.value = hotkey;
    state.recordingHotkey.element.classList.remove('recording');

    // 标记设置已更改（确保快捷键更改后未保存会提醒）
    state.settingsChanged = true;

    // 清除录制状态
    state.recordingHotkey = null;

    // 通知主进程重新注册快捷键
    if (window.electronAPI && window.electronAPI.stopHotkeyRecording) {
        await window.electronAPI.stopHotkeyRecording();
    }
}


// ============================================
// 工具函数
// ============================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(date) {
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) {
        return '刚刚';
    } else if (diff < 3600000) {
        return Math.floor(diff / 60000) + ' 分钟前';
    } else if (diff < 86400000) {
        return Math.floor(diff / 3600000) + ' 小时前';
    } else if (diff < 604800000) {
        return Math.floor(diff / 86400000) + ' 天前';
    } else {
        return date.toLocaleDateString('zh-CN');
    }
}

function showStatus(message, type = 'info') {
    elements.statusText.textContent = message;
    elements.statusText.className = type;

    // 3秒后恢复
    setTimeout(() => {
        elements.statusText.textContent = '就绪';
        elements.statusText.className = '';
    }, 3000);
}

function updateWordCount() {
    const text = elements.editor.value;
    const count = text.length;
    elements.wordCount.textContent = count + ' 字';
}

// ============================================
// 自动保存
// ============================================

function startAutoSave() {
    if (state.autoSaveTimer) {
        clearInterval(state.autoSaveTimer);
    }

    const interval = (state.config.auto_save_interval || 30) * 1000;
    state.autoSaveTimer = setInterval(() => {
        if (state.currentNote) {
            saveCurrentNote();
        }
    }, interval);
}

// ============================================
// 快捷键处理
// ============================================

function handleKeyboard(e) {
    // 如果正在录制快捷键
    if (state.recordingHotkey) {
        handleHotkeyRecording(e);
        return;
    }

    // Ctrl+N: 新建便利贴
    if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        createNote();
    }

    // Ctrl+S: 保存
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCurrentNote();
    }

    // Ctrl+P: 切换预览
    if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        togglePreview();
    }

    // Ctrl+H: 隐藏当前便利贴
    if (e.ctrlKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        toggleHiddenNote();
    }

    // Ctrl+B: 加粗
    if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        wrapSelection('**', '**');
    }

    // Ctrl+I: 斜体
    if (e.ctrlKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        wrapSelection('*', '*');
    }

    // Ctrl+K: 链接
    if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const url = prompt('输入链接URL:');
        if (url) {
            wrapSelection('[', `](${url})`);
        }
    }

    // Escape: 关闭设置
    if (e.key === 'Escape') {
        closeSettings();
    }
}

function wrapSelection(before, after) {
    const textarea = elements.editor;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);

    const newText = text.substring(0, start) + before + selected + after + text.substring(end);
    textarea.value = newText;

    // 恢复光标位置
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = end + before.length;
    textarea.focus();

    updatePreview();
}

// ============================================
// 事件绑定
// ============================================

function bindEvents() {
    // 新建便利贴
    document.getElementById('btn-new-note').addEventListener('click', createNote);

    // 删除便利贴
    document.getElementById('btn-delete-note').addEventListener('click', deleteCurrentNote);

    // 切换预览
    document.getElementById('btn-toggle-preview').addEventListener('click', togglePreview);

    // 切换隐藏
    document.getElementById('btn-toggle-hidden-note').addEventListener('click', toggleHiddenNote);

    // 弹出为浮动窗口
    document.getElementById('btn-popout').addEventListener('click', popoutCurrentNote);

    // 切换显示/隐藏 - 显示隐藏的便利贴
    document.getElementById('btn-show-hidden').addEventListener('click', async () => {
        state.showHidden = !state.showHidden;
        await loadNotes();
        showStatus(state.showHidden ? '👁 查看模式：显示所有便利贴' : '👁‍🗨 查看模式：隐藏私密便利贴');

        // 更新按钮样式
        const btn = document.getElementById('btn-show-hidden');
        btn.style.color = state.showHidden ? 'var(--accent-color)' : '';
        btn.title = state.showHidden ? '当前：显示所有便利贴（点击切换）' : '当前：隐藏私密便利贴（点击切换）';
    });

    // 解除所有隐藏（添加确认）
    document.getElementById('btn-unhide-all').addEventListener('click', async () => {
        if (confirm('确定要取消所有便利贴的隐藏状态吗？\n\n此操作将使所有隐藏的便利贴变为可见。')) {
            await unhideAllNotes();
        }
    });

    // 设置
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('btn-close-settings').addEventListener('click', closeSettings);

    // 点击模态框背景关闭
    elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) {
            closeSettings();
        }
    });

    // 搜索
    elements.searchInput.addEventListener('input', (e) => {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => {
            searchNotes(e.target.value);
        }, 300);
    });

    // 编辑器内容变化
    elements.editor.addEventListener('input', () => {
        updatePreview();
        updateWordCount();
    });

    // 标题变化
    elements.noteTitle.addEventListener('input', () => {
        // 标题实时更新到列表
        if (state.currentNote) {
            const item = document.querySelector(`.note-item[data-id="${state.currentNote.id}"]`);
            if (item) {
                item.querySelector('.note-item-title').textContent = elements.noteTitle.value || '无标题';
            }
        }
    });

    // 设置面板事件 - 实时预览
    document.getElementById('setting-font-size').addEventListener('input', (e) => {
        const size = e.target.value;
        document.getElementById('font-size-value').textContent = size + 'px';
        // 实时预览字体大小
        document.documentElement.style.setProperty('--font-size-base', size + 'px');
        state.settingsChanged = true;
    });

    // 主题实时预览
    document.getElementById('setting-theme').addEventListener('change', (e) => {
        const theme = e.target.value;
        if (theme && theme !== 'parchment') {
            document.body.dataset.theme = theme;
        } else {
            delete document.body.dataset.theme;
        }
        state.settingsChanged = true;
    });

    // 数据文件夹浏览
    const btnBrowseData = document.getElementById('btn-browse-data-path');
    if (btnBrowseData) {
        btnBrowseData.addEventListener('click', async () => {
            if (window.electronAPI && window.electronAPI.selectFolder) {
                const path = await window.electronAPI.selectFolder();
                if (path) {
                    document.getElementById('setting-data-path').value = path;
                    state.settingsChanged = true;
                }
            }
        });
    }

    // 字体预设下拉框 - 实时预览
    const fontPresetSelect = document.getElementById('setting-font-preset');
    const fontFamilyInput = document.getElementById('setting-font-family');
    if (fontPresetSelect && fontFamilyInput) {
        fontPresetSelect.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                fontFamilyInput.style.display = 'block';
                fontFamilyInput.focus();
            } else {
                fontFamilyInput.style.display = 'none';
                // 实时预览字体
                document.documentElement.style.setProperty('--font-family', e.target.value);
            }
            state.settingsChanged = true;
        });

        // 自定义字体输入时也实时预览
        fontFamilyInput.addEventListener('input', (e) => {
            if (e.target.value.trim()) {
                document.documentElement.style.setProperty('--font-family', e.target.value);
            }
            state.settingsChanged = true;
        });

    }


    // 快捷键录制
    document.getElementById('hotkey-show').addEventListener('click', function () {
        startHotkeyRecording(this, 'hotkey_show');
    });
    document.getElementById('hotkey-hide').addEventListener('click', function () {
        startHotkeyRecording(this, 'hotkey_hide_all');
    });
    document.getElementById('hotkey-popout').addEventListener('click', function () {
        startHotkeyRecording(this, 'hotkey_popout');
    });
    document.getElementById('hotkey-close-stickies').addEventListener('click', function () {
        startHotkeyRecording(this, 'hotkey_close_stickies');
    });
    document.getElementById('hotkey-delete').addEventListener('click', function () {
        startHotkeyRecording(this, 'hotkey_delete');
    });

    // 保存设置按钮
    document.getElementById('btn-save-settings').addEventListener('click', async () => {
        // 获取字体设置
        let fontFamily;
        const fontPreset = document.getElementById('setting-font-preset');
        const fontCustom = document.getElementById('setting-font-family');
        if (fontPreset && fontPreset.value === 'custom') {
            fontFamily = fontCustom.value;
        } else if (fontPreset) {
            fontFamily = fontPreset.value;
        } else {
            fontFamily = fontCustom?.value || '';
        }

        // 验证快捷键是否有效（只包含 ASCII 字符）
        function isValidHotkey(val) {
            if (!val || typeof val !== 'string') return false;
            // 不能是中文提示或录制状态
            if (val.includes('请按下') || val.includes('...')) return false;
            // 只能包含 ASCII 字符
            return /^[\x00-\x7F]+$/.test(val);
        }

        // 获取快捷键值，无效时保留原值
        const hotkeyShow = document.getElementById('hotkey-show').value;
        const hotkeyHide = document.getElementById('hotkey-hide').value;
        const hotkeyPopout = document.getElementById('hotkey-popout').value;
        const hotkeyCloseStickies = document.getElementById('hotkey-close-stickies').value;
        const hotkeyDelete = document.getElementById('hotkey-delete').value;

        const oldDataPath = state.config.data_path;
        const updates = {
            font_size: parseInt(document.getElementById('setting-font-size').value),
            font_family: fontFamily,
            theme: document.getElementById('setting-theme').value,
            data_path: document.getElementById('setting-data-path').value,
            auto_start: document.getElementById('setting-auto-start').checked,
            show_save_reminder: document.getElementById('setting-save-reminder').checked,
            hotkey_show: isValidHotkey(hotkeyShow) ? hotkeyShow : state.config.hotkey_show,
            hotkey_hide_all: isValidHotkey(hotkeyHide) ? hotkeyHide : state.config.hotkey_hide_all,
            hotkey_popout: isValidHotkey(hotkeyPopout) ? hotkeyPopout : state.config.hotkey_popout,
            hotkey_close_stickies: isValidHotkey(hotkeyCloseStickies) ? hotkeyCloseStickies : state.config.hotkey_close_stickies,
            hotkey_delete: isValidHotkey(hotkeyDelete) ? hotkeyDelete : state.config.hotkey_delete,
        };

        await saveConfig(updates);
        state.settingsChanged = false;  // 重置更改状态

        // 如果数据路径变化，重新加载便利贴
        if (oldDataPath !== updates.data_path) {
            state.currentNote = null;
            await loadNotes();
            showStatus('数据目录已更改，便利贴已重新加载');
        }

        // 关闭设置面板
        elements.settingsModal.classList.remove('active');
    });


    // 全局快捷键
    document.addEventListener('keydown', handleKeyboard);

    // 关闭窗口前保存
    window.addEventListener('beforeunload', () => {
        if (state.currentNote) {
            saveCurrentNote();
        }
    });
}

// ============================================
// 初始化
// ============================================

async function init() {
    console.log('StickyNotes initializing...');

    // 初始化Markdown解析器
    // 初始化Markdown解析器
    initMarked();

    // 加载配置
    await loadConfig();

    // 加载便利贴
    await loadNotes();

    // 绑定事件
    bindEvents();

    // 启动自动保存
    startAutoSave();

    // 初始化预览
    updatePreview();

    // 初始化窗口控制按钮 (仅桌面模式有效)
    initWindowControls();

    // 监听全局快捷键触发的弹出事件
    if (window.electronAPI && window.electronAPI.onTriggerPopout) {
        window.electronAPI.onTriggerPopout(() => {
            console.log('Trigger popout received from global hotkey');
            popoutCurrentNote();
        });
    }

    // 监听全局快捷键触发的隐藏当前便利贴事件
    if (window.electronAPI && window.electronAPI.onTriggerToggleHidden) {
        window.electronAPI.onTriggerToggleHidden(() => {
            console.log('Trigger toggle hidden received from global hotkey');
            toggleHiddenNote();
        });
    }

    // 监听全局快捷键触发的删除当前便利贴事件
    if (window.electronAPI && window.electronAPI.onTriggerDelete) {
        window.electronAPI.onTriggerDelete(() => {
            console.log('Trigger delete received from global hotkey');
            deleteCurrentNote();
        });
    }

    // 监听配置变更（实现主题热更新）
    if (window.electronAPI && window.electronAPI.onConfigChanged) {
        window.electronAPI.onConfigChanged((newConfig) => {
            console.log('Config changed, applying new settings:', newConfig);
            state.config = newConfig;
            applyConfig();
        });
    }

    // 监听笔记变更（浮动窗口修改后同步刷新）
    if (window.electronAPI && window.electronAPI.onNoteChanged) {
        window.electronAPI.onNoteChanged(async (noteId) => {
            console.log('Note changed in sticky window:', noteId);
            // 刷新笔记列表
            await loadNotes();
            // 如果当前正在查看被修改的笔记，重新加载
            if (state.currentNote && state.currentNote.id === noteId) {
                await selectNote(noteId);
            }
        });
    }


    showStatus('就绪');
    console.log('StickyNotes ready!');
}


// 初始化窗口控制按钮
function initWindowControls() {
    const controlsEl = document.getElementById('window-controls');

    // 检测是否是 Electron 环境
    const isElectron = window.electronAPI !== undefined;

    if (!isElectron) {
        // 浏览器模式：隐藏控制按钮
        if (controlsEl) {
            controlsEl.style.display = 'none';
        }
        return;
    }

    console.log('Electron detected, initializing window controls');

    // 最小化
    const btnMinimize = document.getElementById('btn-minimize');
    if (btnMinimize) {
        btnMinimize.addEventListener('click', () => {
            window.electronAPI.minimize();
        });
    }

    // 最大化/还原
    const btnMaximize = document.getElementById('btn-maximize');
    if (btnMaximize) {
        btnMaximize.addEventListener('click', () => {
            window.electronAPI.maximize();
        });
    }

    // 关闭（最小化到托盘）
    const btnClose = document.getElementById('btn-close-window');
    if (btnClose) {
        btnClose.addEventListener('click', () => {
            window.electronAPI.close();
        });
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
