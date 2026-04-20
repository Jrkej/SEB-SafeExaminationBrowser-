// ============================================================
// SEB — Shortcut Blocker
// Registers globalShortcut to intercept dangerous key combos.
// Addresses: T2, T3, T4, T12
// ============================================================

const { globalShortcut } = require('electron');

class ShortcutBlocker {
    /**
     * @param {object} logger - Logger instance
     * @param {object} keyboardMonitor - KeyboardMonitor instance
     */
    constructor(logger, keyboardMonitor) {
        this.logger = logger;
        this.keyboardMonitor = keyboardMonitor;
        this._registered = false;
    }

    /**
     * Register all dangerous shortcuts to be captured/blocked.
     */
    register() {
        if (this._registered) return;

        const shortcuts = [
            // DevTools (T3)
            'CommandOrControl+Shift+I',
            'CommandOrControl+Shift+J',
            'CommandOrControl+Shift+C',
            'F12',

            // Clipboard (T4)
            'CommandOrControl+C',
            'CommandOrControl+V',
            'CommandOrControl+X',
            'CommandOrControl+A',

            // Print / Save
            'CommandOrControl+P',
            'CommandOrControl+S',

            // New window / tab / close
            'CommandOrControl+N',
            'CommandOrControl+T',
            'CommandOrControl+W',
            'CommandOrControl+Q',

            // Reload (prevent clearing state)
            'CommandOrControl+R',
            'CommandOrControl+Shift+R',
            'F5',
            'CommandOrControl+F5',

            // Fullscreen toggle (prevent un-kiosk)
            'F11',

            // Screenshot (T12)
            'PrintScreen',
            'CommandOrControl+PrintScreen',
            'Alt+PrintScreen',

            // System (T1, T2)
            'Alt+Tab',
            'Alt+F4',
            'Alt+Space',
            'CommandOrControl+Alt+Delete',

            // Find (could be used to search content)
            'CommandOrControl+F',
            'CommandOrControl+G',

            // Address bar / URL (if any)
            'CommandOrControl+L',
            'Alt+D',
            'F6',

            // Developer
            'CommandOrControl+U', // View source
            'CommandOrControl+Shift+U',

            // Zoom (could distort exam)
            'CommandOrControl+Plus',
            'CommandOrControl+-',
            'CommandOrControl+0',

            // Super / Meta key
            'Super',
            'Super+L',     // Lock screen
            'Super+D',     // Show desktop
            'Super+E',     // File manager
            'Super+M',     // Minimize all
            'Super+R',     // Run dialog
            'Super+Q',     // Close window (some DEs)
            'Super+A',     // App drawer
            'Super+S',     // Overview (some DEs)
            'Super+Tab',   // Task view
        ];

        let registered = 0;
        let failed = 0;

        for (const combo of shortcuts) {
            try {
                const success = globalShortcut.register(combo, () => {
                    this.keyboardMonitor.recordAttempt(combo);
                });
                if (success) {
                    registered++;
                } else {
                    failed++;
                }
            } catch (err) {
                failed++;
                // Some shortcuts can't be registered (OS grabs them first)
            }
        }

        this._registered = true;
        this.logger.log('INFO', 'KEYBOARD', `Shortcut blocker active: ${registered} registered, ${failed} failed`, {
            registered,
            failed,
            total: shortcuts.length
        });
    }

    /**
     * Unregister all shortcuts.
     */
    unregister() {
        if (!this._registered) return;
        globalShortcut.unregisterAll();
        this._registered = false;
        this.logger.log('INFO', 'KEYBOARD', 'Shortcut blocker deactivated');
    }

    /**
     * Check if shortcuts are registered.
     */
    isActive() {
        return this._registered;
    }
}

module.exports = ShortcutBlocker;
