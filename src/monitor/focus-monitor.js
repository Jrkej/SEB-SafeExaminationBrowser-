// ============================================================
// SEB — Focus Monitor
// Tracks window blur/focus events with durations and counts.
// Design Doc §2.2.3, Listing 3: Monitoring Module
// ============================================================

class FocusMonitor {
    /**
     * @param {BrowserWindow} mainWindow - Electron BrowserWindow
     * @param {object} logger - Logger instance
     * @param {object} activityMonitor - ActivityMonitor instance
     * @param {object} monitoringConfig - Monitoring config from policy
     */
    constructor(mainWindow, logger, activityMonitor, monitoringConfig = {}) {
        this.mainWindow = mainWindow;
        this.logger = logger;
        this.activityMonitor = activityMonitor;
        this.config = monitoringConfig;

        this.blurCount = 0;
        this.focusRestoreDelayMs = monitoringConfig.focusRestoreDelayMs || 100;
        this._active = false;
    }

    /**
     * Start monitoring window focus.
     */
    start() {
        if (this._active) return;
        this._active = true;

        this.mainWindow.on('blur', this._onBlur.bind(this));
        this.mainWindow.on('focus', this._onFocus.bind(this));
        this.mainWindow.on('minimize', this._onMinimize.bind(this));
        this.mainWindow.on('hide', this._onHide.bind(this));

        this.logger.log('INFO', 'FOCUS', 'Focus monitor started');
    }

    /**
     * Stop monitoring.
     */
    stop() {
        this._active = false;
        this.mainWindow.removeAllListeners('blur');
        this.mainWindow.removeAllListeners('focus');
        this.mainWindow.removeAllListeners('minimize');
        this.mainWindow.removeAllListeners('hide');
        this.logger.log('INFO', 'FOCUS', 'Focus monitor stopped');
    }

    /**
     * Handle window blur (lost focus).
     * Design Doc §2.2.3: "on window blur event: increment blurCount"
     */
    _onBlur() {
        if (!this._active) return;

        this.blurCount++;
        this.activityMonitor.recordEvent('FOCUS_LOSS', {
            blurCount: this.blurCount,
            threshold: this.config.maxBlurEvents || 3
        });

        // Immediately attempt to restore focus
        setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.show();
                this.mainWindow.focus();
                this.mainWindow.moveTop();
                // On Linux, some WMs need setAlwaysOnTop to be toggled
                this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
            }
        }, this.focusRestoreDelayMs);
    }

    /**
     * Handle window focus (regained).
     */
    _onFocus() {
        if (!this._active) return;
        this.activityMonitor.recordEvent('FOCUS_RESTORED');
    }

    /**
     * Handle minimize — prevent and restore immediately.
     */
    _onMinimize(event) {
        if (!this._active) return;
        if (event && event.preventDefault) {
            event.preventDefault();
        }
        this.mainWindow.restore();
        this.mainWindow.show();
        this.mainWindow.focus();
        this.logger.log('WARN', 'FOCUS', 'Minimize attempt blocked');
    }

    /**
     * Handle hide — restore immediately.
     */
    _onHide() {
        if (!this._active) return;
        this.mainWindow.show();
        this.mainWindow.focus();
        this.logger.log('WARN', 'FOCUS', 'Window hide attempt blocked');
    }

    /**
     * Get current stats.
     */
    getStats() {
        return {
            blurCount: this.blurCount,
            threshold: this.config.maxBlurEvents || 3,
            thresholdExceeded: this.blurCount > (this.config.maxBlurEvents || 3)
        };
    }
}

module.exports = FocusMonitor;
