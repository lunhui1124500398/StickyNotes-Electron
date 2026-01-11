const fs = require('fs');
const path = require('path');

class NotesManager {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.notesDir = path.join(dataDir, 'notes');
        this.ensureDirectories();
    }

    ensureDirectories() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        if (!fs.existsSync(this.notesDir)) {
            fs.mkdirSync(this.notesDir, { recursive: true });
        }
    }

    generateId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    parseFrontmatter(content) {
        const lines = content.split('\n');
        if (lines[0] !== '---') return { metadata: {}, content };
        let endIndex = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') { endIndex = i; break; }
        }
        if (endIndex === -1) return { metadata: {}, content };
        const metadata = {};
        for (let i = 1; i < endIndex; i++) {
            const idx = lines[i].indexOf(':');
            if (idx > 0) {
                const key = lines[i].substring(0, idx).trim();
                let val = lines[i].substring(idx + 1).trim();
                if (val === 'true') val = true;
                else if (val === 'false') val = false;
                else if (!isNaN(val) && val !== '') val = Number(val);
                metadata[key] = val;
            }
        }
        return { metadata, content: lines.slice(endIndex + 1).join('\n') };
    }

    createFrontmatter(note) {
        return '---\n' +
            'id: ' + note.id + '\n' +
            'title: ' + note.title + '\n' +
            'created_at: ' + note.created_at + '\n' +
            'updated_at: ' + note.updated_at + '\n' +
            'is_hidden: ' + note.is_hidden + '\n' +
            'is_pinned: ' + note.is_pinned + '\n' +
            'position_x: ' + note.position_x + '\n' +
            'position_y: ' + note.position_y + '\n' +
            'width: ' + note.width + '\n' +
            'height: ' + note.height + '\n' +
            '---\n';
    }

    getSafeFilename(note) {
        // 确保 title 是字符串
        const title = (note.title && typeof note.title === 'string') ? note.title : 'untitled';
        const safeName = title.replace(/[<>:"\/\\|?*]/g, '_').substring(0, 50);
        return note.id.substring(0, 8) + '_' + safeName + '.md';
    }


    getAllNotes(includeHidden) {
        if (!fs.existsSync(this.notesDir)) return [];
        const notes = [];
        for (const file of fs.readdirSync(this.notesDir)) {
            if (!file.endsWith('.md')) continue;
            try {
                const content = fs.readFileSync(path.join(this.notesDir, file), 'utf-8');
                const parsed = this.parseFrontmatter(content);
                const metadata = parsed.metadata;
                const body = parsed.content;
                const note = {
                    id: metadata.id || file.replace('.md', ''),
                    title: metadata.title || 'Untitled',
                    content: body,
                    created_at: metadata.created_at || new Date().toISOString(),
                    updated_at: metadata.updated_at || new Date().toISOString(),
                    is_hidden: metadata.is_hidden || false,
                    is_pinned: metadata.is_pinned || false,
                    position_x: metadata.position_x || 100,
                    position_y: metadata.position_y || 100,
                    width: metadata.width || 300,
                    height: metadata.height || 200
                };
                if (!includeHidden && note.is_hidden) continue;
                notes.push(note);
            } catch (e) { console.error(e); }
        }
        return notes.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    }

    getNote(noteId) {
        return this.getAllNotes(true).find(n => n.id === noteId) || null;
    }

    createNote(title, content) {
        const now = new Date().toISOString();
        const note = {
            id: this.generateId(),
            title: title || 'New Note',
            content: content || '',
            created_at: now,
            updated_at: now,
            is_hidden: false,
            is_pinned: false,
            position_x: 100,
            position_y: 100,
            width: 300,
            height: 200
        };
        this.saveNote(note);
        return note;
    }

    saveNote(note, retryCount = 0) {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 200; // ms

        this.ensureDirectories();
        note.updated_at = new Date().toISOString();
        const filename = this.getSafeFilename(note);

        // 删除旧文件（如果标题改变导致文件名变化）
        try {
            const files = fs.readdirSync(this.notesDir);
            for (const file of files) {
                if (file.startsWith(note.id.substring(0, 8)) && file !== filename) {
                    try {
                        fs.unlinkSync(path.join(this.notesDir, file));
                    } catch (unlinkErr) {
                        console.warn('无法删除旧文件:', file, unlinkErr.message);
                    }
                }
            }
        } catch (e) {
            console.warn('读取目录失败:', e.message);
        }

        // 尝试写入文件，带重试机制
        const filePath = path.join(this.notesDir, filename);
        const content = this.createFrontmatter(note) + note.content;

        try {
            fs.writeFileSync(filePath, content, 'utf-8');
            return note;
        } catch (err) {
            // 如果是权限错误且未达到最大重试次数，则重试
            if ((err.code === 'EPERM' || err.code === 'EBUSY') && retryCount < MAX_RETRIES) {
                console.warn(`文件写入失败 (${err.code})，${RETRY_DELAY}ms 后重试 (${retryCount + 1}/${MAX_RETRIES})...`);
                // 同步等待后重试
                const start = Date.now();
                while (Date.now() - start < RETRY_DELAY) {
                    // 忙等待
                }
                return this.saveNote(note, retryCount + 1);
            }

            // 重试失败或其他错误，抛出异常
            console.error('保存笔记失败:', err);
            throw err;
        }
    }

    updateNote(noteId, updates) {
        const note = this.getNote(noteId);
        if (!note) return null;
        Object.assign(note, updates);
        return this.saveNote(note);
    }

    deleteNote(noteId) {
        for (const file of fs.readdirSync(this.notesDir)) {
            if (file.startsWith(noteId.substring(0, 8))) {
                const trashDir = path.join(this.dataDir, 'trash');
                if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
                fs.renameSync(path.join(this.notesDir, file), path.join(trashDir, file));
                return true;
            }
        }
        return false;
    }

    toggleHidden(noteId) {
        const note = this.getNote(noteId);
        if (!note) return null;
        note.is_hidden = !note.is_hidden;
        return this.saveNote(note);
    }

    unhideAll() {
        this.getAllNotes(true).forEach(n => {
            if (n.is_hidden) {
                n.is_hidden = false;
                this.saveNote(n);
            }
        });
        return true;
    }

    searchNotes(query) {
        if (!query) return this.getAllNotes();
        const q = query.toLowerCase();
        const results = [];

        for (const note of this.getAllNotes()) {
            const titleMatch = note.title.toLowerCase().includes(q);
            const contentMatch = note.content.toLowerCase().includes(q);

            if (titleMatch || contentMatch) {
                // 生成匹配上下文片段
                let matchContext = null;
                let matchIndex = -1;

                if (contentMatch) {
                    matchIndex = note.content.toLowerCase().indexOf(q);
                    const contextStart = Math.max(0, matchIndex - 20);
                    const contextEnd = Math.min(note.content.length, matchIndex + q.length + 30);

                    let prefix = contextStart > 0 ? '...' : '';
                    let suffix = contextEnd < note.content.length ? '...' : '';

                    matchContext = prefix + note.content.substring(contextStart, contextEnd) + suffix;
                }

                results.push({
                    ...note,
                    matchContext,
                    matchIndex,
                    matchLength: q.length,
                    titleMatch,
                    contentMatch
                });
            }
        }

        return results;
    }

}

module.exports = NotesManager;
