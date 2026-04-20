// ============================================================
// SEB — Window Manager
// Creates and configures the locked-down BrowserWindow.
// Addresses: T1 (task switch), T3 (devtools), T14 (minimize)
// ============================================================

const { BrowserWindow } = require('electron');
const path = require('path');

class WindowManager {
    /**
     * @param {object} policyEngine - PolicyEngine instance
     * @param {object} logger - Logger instance
     */
    constructor(policyEngine, logger) {
        this.policyEngine = policyEngine;
        this.logger = logger;
        this.mainWindow = null;
    }

    /**
     * Create the locked-down exam browser window.
     * @param {boolean} examMode - If true, apply full lockdown. If false, normal browser.
     * @returns {BrowserWindow}
     */
    createWindow(examMode = true) {
        const preloadPath = path.join(__dirname, '..', 'preload', 'preload.js');
        const features = this.policyEngine.getDisabledFeatures();

        const windowConfig = {
            width: 1280,
            height: 900,
            icon: path.join(__dirname, '..', 'assets', 'icon.png'),
            minWidth: 800,
            minHeight: 600,
            backgroundColor: '#0d0d1a',
            show: false, // Show after ready-to-show to prevent flash
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webviewTag: true,
                devTools: !features.devTools, // Disable if policy says so
                preload: preloadPath,
                spellcheck: false,
                enableWebSQL: false
            }
        };

        if (examMode) {
            // Full lockdown mode
            Object.assign(windowConfig, {
                kiosk: true,
                fullscreen: true,
                alwaysOnTop: true,
                frame: false,
                resizable: false,
                minimizable: false,
                maximizable: false,
                closable: false,
                skipTaskbar: true,
                titleBarStyle: 'hidden',
                autoHideMenuBar: true
            });
        } else {
            // Normal browser mode (for development / admin)
            Object.assign(windowConfig, {
                frame: false,
                titleBarStyle: 'hidden'
            });
        }

        this.mainWindow = new BrowserWindow(windowConfig);

        // Prevent the menu bar from showing on Alt key
        this.mainWindow.setMenuBarVisibility(false);
        this.mainWindow.setAutoHideMenuBar(true);

        // Show window once ready (prevents white flash)
        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow.show();
            if (examMode) {
                this.mainWindow.focus();
                this.mainWindow.moveTop();
            }
            this.logger.log('INFO', 'WINDOW', `Window created (examMode: ${examMode})`);
        });

        // Prevent new windows from being opened
        this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            this.logger.log('WARN', 'WINDOW', `Blocked new window attempt: ${url}`);
            return { action: 'deny' };
        });

        // Prevent navigation in the main window (only webview should navigate)
        this.mainWindow.webContents.on('will-navigate', (event, url) => {
            // Allow navigation to our own pages
            if (url.startsWith('file://')) return;
            event.preventDefault();
            this.logger.log('WARN', 'NAV', `Blocked main window navigation: ${url}`);
        });

        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });

        return this.mainWindow;
    }

    /**
     * Load a renderer page.
     * @param {string} pageName - Page filename (e.g., 'index.html')
     */
    loadPage(pageName) {
        if (!this.mainWindow) return;
        const pagePath = path.join(__dirname, '..', 'renderer', pageName);
        this.mainWindow.loadFile(pagePath);
    }

    /**
     * Get the main window instance.
     */
    getWindow() {
        return this.mainWindow;
    }

    /**
     * Destroy the window.
     */
    destroy() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            // Temporarily allow closing
            this.mainWindow.closable = true;
            this.mainWindow.close();
        }
    }
}

module.exports = WindowManager;
