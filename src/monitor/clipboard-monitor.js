// ============================================================
// SEB — Clipboard Monitor
// Periodically clears system clipboard to prevent data exfiltration.
// Design Doc §2.2.3: "on clipboard access attempt: block access"
// ============================================================

class ClipboardMonitor {
    /**
     * @param {object} clipboard - Electron clipboard module
     * @param {object} logger - Logger instance
     * @param {object} activityMonitor - ActivityMonitor instance
     * @param {object} monitoringConfig - Monitoring config from policy
     */
    constructor(clipboard, logger, activityMonitor, monitoringConfig = {}) {
        this.clipboard = clipboard;
        this.logger = logger;
        this.activityMonitor = activityMonitor;
        this.config = monitoringConfig;
        this._interval = null;
        this._clearCount = 0;
    }

    /**
     * Start clipboard monitoring: periodically clear clipboard.
     */
    start() {
        const intervalMs = this.config.clipboardClearIntervalMs || 5000;

        // Clear immediately
        this._clearClipboard('initial');

        // Clear periodically
        this._interval = setInterval(() => {
            this._clearClipboard('periodic');
        }, intervalMs);

        this.logger.log('INFO', 'CLIPBOARD', `Clipboard monitor started (clear interval: ${intervalMs}ms)`);
    }

    /**
     * Stop clipboard monitoring.
     */
    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        this.logger.log('INFO', 'CLIPBOARD', 'Clipboard monitor stopped');
    }

    /**
     * Clear the system clipboard.
     * @param {string} reason - Why clipboard was cleared
     */
    _clearClipboard(reason) {
        try {
            const currentText = this.clipboard.readText();
            const currentImage = this.clipboard.readImage();

            // Only log if there was actually content to clear
            if (currentText || (currentImage && !currentImage.isEmpty())) {
                this._clearCount++;
                this.logger.log('INFO', 'CLIPBOARD', `Clipboard cleared (${reason})`, {
                    hadText: !!currentText,
                    hadImage: currentImage && !currentImage.isEmpty(),
                    clearCount: this._clearCount
                });
            }

            this.clipboard.clear();
        } catch (err) {
            this.logger.log('WARN', 'CLIPBOARD', `Failed to clear clipboard: ${err.message}`);
        }
    }

    /**
     * Record a clipboard access attempt from the renderer.
     * @param {string} action - 'copy', 'cut', or 'paste'
     */
    recordAttempt(action) {
        this.activityMonitor.recordEvent('CLIPBOARD_ACCESS', { action });
        // Clear clipboard again immediately after an attempt
        this._clearClipboard(`after-${action}-attempt`);
    }

    /**
     * Get monitoring stats.
     */
    getStats() {
        return {
            clearCount: this._clearCount,
            isRunning: this._interval !== null
        };
    }
}

module.exports = ClipboardMonitor;
