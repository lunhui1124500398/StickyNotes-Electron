const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
    data_path: './data',
    font_family: 'LXGW WenKai, Microsoft YaHei, Segoe UI, sans-serif',
    font_size: 16,
    theme: 'parchment',
    hotkey_show: 'Alt+Shift+S',
    hotkey_hide_all: 'Alt+Shift+H',
    hotkey_popout: 'Alt+Shift+P',
    hotkey_close_stickies: 'Alt+Shift+C',
    hotkey_delete: 'Delete',
    window_width: 900,
    window_height: 650,
    start_minimized: false,
    auto_start: false,
    minimize_to_tray: true,
    editor_line_height: 1.6,
    auto_save_interval: 30,
    show_save_reminder: true  // 是否显示设置保存提醒
};


class ConfigManager {
    constructor() {
        this.appDir = this.getAppDir();
        this.config = this.loadConfig();
    }

    getAppDir() {
        // Lazy load electron app
        const { app } = require('electron');
        if (app.isPackaged) {
            return path.dirname(app.getPath('exe'));
        }
        return __dirname.replace(/[\\/]src$/, '');
    }

    getDataDir() {
        // 使用配置中的路径，或者是默认路径
        // 注意：loadConfig 必须在调用此方法前完成，否则 this.config 为空
        const dataPath = this.config.data_path || DEFAULT_CONFIG.data_path;
        if (path.isAbsolute(dataPath)) {
            return dataPath;
        }
        return path.join(this.appDir, dataPath);
    }

    getUserConfigPath() {
        // 配置文件始终存储在应用根目录下，与数据目录解耦
        return path.join(this.appDir, 'user_config.json');
    }

    loadConfig() {
        const config = { ...DEFAULT_CONFIG };
        const configPath = this.getUserConfigPath();

        // 迁移逻辑：如果新位置不存在配置，尝试从旧的默认位置找
        if (!fs.existsSync(configPath)) {
            const oldDefaultPath = path.join(this.appDir, 'data', 'user_config.json');
            if (fs.existsSync(oldDefaultPath)) {
                try {
                    fs.copyFileSync(oldDefaultPath, configPath);
                    console.log('Migrated config from old location to app root');
                } catch (e) {
                    console.error('Failed to migrate config:', e);
                }
            }
        }

        if (fs.existsSync(configPath)) {
            try {
                const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                Object.assign(config, userConfig);
            } catch (e) {
                console.error('Failed to load user config:', e);
            }
        }
        return config;
    }

    getConfig() {
        return { ...this.config };
    }

    saveConfig(updates) {
        const dataDir = this.getDataDir();
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        Object.assign(this.config, updates);
        const userConfig = {};
        for (const [key, value] of Object.entries(this.config)) {
            if (DEFAULT_CONFIG[key] !== value) {
                userConfig[key] = value;
            }
        }
        fs.writeFileSync(this.getUserConfigPath(), JSON.stringify(userConfig, null, 2), 'utf-8');
        return this.config;
    }

    resetConfig() {
        this.config = { ...DEFAULT_CONFIG };
        const configPath = this.getUserConfigPath();
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
        }
        return this.config;
    }
}

module.exports = ConfigManager;
