// ============================================================
// SEB — Keyboard Monitor
// Tracks and logs all blocked keyboard shortcut attempts.
// Design Doc §2.2.3: "on forbidden shortcut detected: suppress event"
// ============================================================

class KeyboardMonitor {
    /**
     * @param {object} logger - Logger instance
     * @param {object} activityMonitor - ActivityMonitor instance
     * @param {object} monitoringConfig - Monitoring config from policy
     */
    constructor(logger, activityMonitor, monitoringConfig = {}) {
        this.logger = logger;
        this.activityMonitor = activityMonitor;
        this.config = monitoringConfig;

        // Track shortcut attempt counts
        this.attemptCounts = {};
        this.totalAttempts = 0;
        this._alertSent = false;
    }

    /**
     * Record a blocked shortcut attempt (called from main process globalShortcut handler).
     * @param {string} keyCombo - e.g. "Ctrl+Shift+I", "Alt+Tab"
     */
    recordAttempt(keyCombo) {
        this.totalAttempts++;
        this.attemptCounts[keyCombo] = (this.attemptCounts[keyCombo] || 0) + 1;

        this.activityMonitor.recordEvent('SHORTCUT_ATTEMPT', {
            keyCombo,
            attemptNumber: this.attemptCounts[keyCombo],
            totalAttempts: this.totalAttempts
        });

        // Alert if too many attempts
        const maxAttempts = this.config.maxShortcutAttempts || 10;
        if (this.totalAttempts > maxAttempts && !this._alertSent) {
            this._alertSent = true;
            this.logger.log('ALERT', 'KEYBOARD', `Excessive shortcut attempts: ${this.totalAttempts}`, {
                attempts: { ...this.attemptCounts }
            });
        }
    }

    /**
     * Get attempt statistics.
     */
    getStats() {
        return {
            totalAttempts: this.totalAttempts,
            byCombo: { ...this.attemptCounts }
        };
    }

    /**
     * Reset counts (e.g., new exam session).
     */
    reset() {
        this.attemptCounts = {};
        this.totalAttempts = 0;
        this._alertSent = false;
    }
}

module.exports = KeyboardMonitor;
