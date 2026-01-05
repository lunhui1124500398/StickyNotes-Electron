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
};

// API基础URL
const API_BASE = '/api';

// ============================================
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
// API 调用
// ============================================

async function api(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(API_BASE + endpoint, options);
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        showStatus('操作失败: ' + error.message, 'error');
        throw error;
    }
}

// ============================================
// 便利贴管理
// ============================================

async function loadNotes() {
    try {
        const includeHidden = state.showHidden ? 'true' : 'false';
        state.notes = await api(`/notes?include_hidden=${includeHidden}`);
        renderNotesList();

        // 如果没有选中的便利贴，选中第一个
        if (!state.currentNote && state.notes.length > 0) {
            selectNote(state.notes[0].id);
        } else if (state.notes.length === 0) {
            showEmptyState();
        }
    } catch (error) {
        console.error('Failed to load notes:', error);
    }
}

function renderNotesList() {
    elements.notesList.innerHTML = '';

    if (state.notes.length === 0) {
        elements.notesList.innerHTML = '<div class="empty-list" style="padding: 20px; text-align: center; opacity: 0.6;">没有便利贴</div>';
        return;
    }

    state.notes.forEach(note => {
        const item = createNoteItem(note);
        elements.notesList.appendChild(item);
    });
}

function createNoteItem(note) {
    const div = document.createElement('div');
    div.className = 'note-item' + (state.currentNote?.id === note.id ? ' active' : '');
    div.dataset.id = note.id;

    // 获取内容预览（去除Markdown标记）
    const preview = note.content
        .replace(/[#*_`~\[\]]/g, '')
        .substring(0, 50);

    // 格式化日期
    const date = new Date(note.updated_at);
    const dateStr = formatDate(date);

    div.innerHTML = `
        <div class="note-item-title">${escapeHtml(note.title)}</div>
        <div class="note-item-preview">${escapeHtml(preview)}</div>
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
        const note = await api('/notes', 'POST', {
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
        const updated = await api(`/notes/${state.currentNote.id}`, 'PUT', {
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
        await api(`/notes/${state.currentNote.id}`, 'DELETE');

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
    }
}

async function toggleHiddenNote() {
    if (!state.currentNote) return;

    try {
        const result = await api(`/notes/${state.currentNote.id}/toggle-hidden`, 'POST');
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
    }
}

// 显示所有隐藏的便利贴（解隐藏）
async function unhideAllNotes() {
    try {
        await api('/notes/show-all', 'POST');
        showStatus('已显示所有隐藏便利贴');
        await loadNotes();
    } catch (error) {
        console.error('Failed to unhide all notes:', error);
    }
}

// 弹出当前便利贴为浮动窗口
function popoutCurrentNote() {
    if (!state.currentNote) {
        showStatus('请先选择一个便利贴');
        return;
    }

    // 先保存当前便利贴
    saveCurrentNote();

    const noteId = state.currentNote.id;
    const note = state.currentNote;

    // 计算窗口位置和大小
    const width = note.width || 320;
    const height = note.height || 280;
    const left = note.position_x || 100;
    const top = note.position_y || 100;

    // 打开新窗口
    const stickyUrl = `/sticky.html?id=${noteId}`;

    // 尝试使用 pywebview API（如果在桌面模式）
    if (window.pywebview && window.pywebview.api && window.pywebview.api.open_sticky) {
        window.pywebview.api.open_sticky(noteId, note.title, width, height, left, top);
        showStatus('已弹出为浮动便利贴');
    } else {
        // 浏览器模式：打开新标签页/窗口
        const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`;
        const newWindow = window.open(stickyUrl, `sticky_${noteId}`, features);

        if (newWindow) {
            showStatus('已在新窗口打开');
        } else {
            // 弹窗被阻止
            showStatus('请允许弹出窗口或使用桌面模式');
        }
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
    if (!query.trim()) {
        await loadNotes();
        return;
    }

    try {
        state.notes = await api(`/notes/search?q=${encodeURIComponent(query)}`);
        renderNotesList();
    } catch (error) {
        console.error('Search failed:', error);
    }
}

// ============================================
// 设置
// ============================================

async function loadConfig() {
    try {
        state.config = await api('/config');
        applyConfig();
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

function applyConfig() {
    const config = state.config;

    // 应用字体大小
    document.documentElement.style.setProperty('--font-size-base', config.font_size + 'px');

    // 应用字体样式
    document.documentElement.style.setProperty('--font-family', config.font_family);

    // 应用主题
    if (config.theme && config.theme !== 'parchment') {
        document.body.dataset.theme = config.theme;
    } else {
        delete document.body.dataset.theme;
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

    // 更新快捷键显示
    const hotkeyShow = document.getElementById('hotkey-show');
    const hotkeyHide = document.getElementById('hotkey-hide');
    const hotkeyPopout = document.getElementById('hotkey-popout');
    const hotkeyCloseStickies = document.getElementById('hotkey-close-stickies');
    if (hotkeyShow) hotkeyShow.value = config.hotkey_show || 'alt+shift+s';
    if (hotkeyHide) hotkeyHide.value = config.hotkey_hide_all || 'alt+shift+h';
    if (hotkeyPopout) hotkeyPopout.value = config.hotkey_popout || 'alt+shift+p';
    if (hotkeyCloseStickies) hotkeyCloseStickies.value = config.hotkey_close_stickies || 'alt+shift+c';
}

async function saveConfig(updates) {
    try {
        state.config = await api('/config', 'PUT', updates);
        applyConfig();
        showStatus('设置已保存');
    } catch (error) {
        console.error('Failed to save config:', error);
    }
}

function openSettings() {
    elements.settingsModal.classList.add('active');
}

function closeSettings() {
    elements.settingsModal.classList.remove('active');
    state.recordingHotkey = null;
    // 移除所有录制状态
    document.querySelectorAll('.hotkey-input').forEach(input => {
        input.classList.remove('recording');
    });
}

// ============================================
// 快捷键录制
// ============================================

function startHotkeyRecording(inputElement, configKey) {
    // 清除其他录制状态
    document.querySelectorAll('.hotkey-input').forEach(input => {
        input.classList.remove('recording');
    });

    inputElement.classList.add('recording');
    inputElement.value = '请按下快捷键...';
    state.recordingHotkey = { element: inputElement, configKey };
}

function handleHotkeyRecording(e) {
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

    // 更新输入框
    state.recordingHotkey.element.value = hotkey;
    state.recordingHotkey.element.classList.remove('recording');

    // 保存到临时状态（点击保存按钮时才真正保存）
    state.recordingHotkey = null;
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
    if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        createNote();
    }

    // Ctrl+S: 保存
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveCurrentNote();
    }

    // Ctrl+P: 切换预览
    if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        togglePreview();
    }

    // Ctrl+H: 隐藏当前便利贴
    if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        toggleHiddenNote();
    }

    // Ctrl+B: 加粗
    if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        wrapSelection('**', '**');
    }

    // Ctrl+I: 斜体
    if (e.ctrlKey && e.key === 'i') {
        e.preventDefault();
        wrapSelection('*', '*');
    }

    // Ctrl+K: 链接
    if (e.ctrlKey && e.key === 'k') {
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

    // 显示/隐藏 隐藏便利贴
    document.getElementById('btn-show-hidden').addEventListener('click', async () => {
        state.showHidden = !state.showHidden;
        await loadNotes();
        showStatus(state.showHidden ? '显示隐藏便利贴' : '隐藏私密便利贴');

        // 更新按钮样式
        const btn = document.getElementById('btn-show-hidden');
        btn.style.color = state.showHidden ? 'var(--accent-color)' : '';
    });

    // 解隐藏所有
    document.getElementById('btn-unhide-all').addEventListener('click', unhideAllNotes);

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

    // 设置面板事件
    document.getElementById('setting-font-size').addEventListener('input', (e) => {
        document.getElementById('font-size-value').textContent = e.target.value + 'px';
    });

    // 字体预设下拉框
    const fontPresetSelect = document.getElementById('setting-font-preset');
    const fontFamilyInput = document.getElementById('setting-font-family');
    if (fontPresetSelect && fontFamilyInput) {
        fontPresetSelect.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                fontFamilyInput.style.display = 'block';
                fontFamilyInput.focus();
            } else {
                fontFamilyInput.style.display = 'none';
            }
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

        const updates = {
            font_size: parseInt(document.getElementById('setting-font-size').value),
            font_family: fontFamily,
            theme: document.getElementById('setting-theme').value,
            auto_start: document.getElementById('setting-auto-start').checked,
            hotkey_show: document.getElementById('hotkey-show').value,
            hotkey_hide_all: document.getElementById('hotkey-hide').value,
            hotkey_popout: document.getElementById('hotkey-popout').value,
            hotkey_close_stickies: document.getElementById('hotkey-close-stickies').value,
        };
        await saveConfig(updates);
        closeSettings();
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

    showStatus('就绪');
    console.log('StickyNotes ready!');
}

// 初始化窗口控制按钮
function initWindowControls() {
    const controlsEl = document.getElementById('window-controls');

    // 延迟执行，等待pywebview API就绪
    setTimeout(() => {
        // 检测是否是pywebview环境
        const isPywebview = window.pywebview !== undefined;

        if (!isPywebview) {
            // 浏览器模式：隐藏控制按钮
            if (controlsEl) {
                controlsEl.style.display = 'none';
            }
            return;
        }

        console.log('pywebview detected, initializing window controls');

        // 最小化
        const btnMinimize = document.getElementById('btn-minimize');
        if (btnMinimize) {
            btnMinimize.addEventListener('click', async () => {
                try {
                    if (window.pywebview && window.pywebview.api) {
                        await window.pywebview.api.minimize_window();
                    }
                } catch (e) {
                    console.error('Minimize error:', e);
                }
            });
        }

        // 最大化/还原
        const btnMaximize = document.getElementById('btn-maximize');
        if (btnMaximize) {
            btnMaximize.addEventListener('click', async () => {
                try {
                    if (window.pywebview && window.pywebview.api) {
                        await window.pywebview.api.toggle_maximize();
                    }
                } catch (e) {
                    console.error('Maximize error:', e);
                }
            });
        }

        // 关闭（最小化到托盘）
        const btnClose = document.getElementById('btn-close-window');
        if (btnClose) {
            btnClose.addEventListener('click', async () => {
                try {
                    if (window.pywebview && window.pywebview.api) {
                        await window.pywebview.api.close_window();
                    }
                } catch (e) {
                    console.error('Close error:', e);
                }
            });
        }
    }, 500); // 延迟500ms等待pywebview API就绪
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
