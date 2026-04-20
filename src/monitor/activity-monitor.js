// ============================================================
// SEB — Activity Monitor
// Central event aggregator for all monitoring modules.
// Design Doc §2.2.3: Monitoring Module
// ============================================================

const { EventEmitter } = require('events');

class ActivityMonitor extends EventEmitter {
    /**
     * @param {object} logger - Logger instance
     * @param {object} monitoringConfig - Monitoring config from policy
     */
    constructor(logger, monitoringConfig = {}) {
        super();
        this.logger = logger;
        this.config = monitoringConfig;

        // Violation counters
        this.violations = {
            focusLoss: 0,
            shortcutAttempt: 0,
            clipboardAccess: 0,
            processViolation: 0,
            navigationBlocked: 0,
            total: 0
        };

        // Timeline of events
        this.timeline = [];

        // Current escalation level
        this.escalationLevel = 'NORMAL'; // NORMAL → WARNING → ALERT → TERMINATE

        // Total time out of focus (ms)
        this.totalOutOfFocusMs = 0;
        this._lastBlurTime = null;
    }

    /**
     * Record a monitoring event and check escalation.
     * @param {'FOCUS_LOSS'|'SHORTCUT_ATTEMPT'|'CLIPBOARD_ACCESS'|'PROCESS_VIOLATION'|'NAVIGATION_BLOCKED'|'FOCUS_RESTORED'} type
     * @param {object} [details]
     */
    recordEvent(type, details = {}) {
        const event = {
            timestamp: new Date().toISOString(),
            type,
            details,
            escalationLevel: this.escalationLevel
        };

        this.timeline.push(event);

        // Update counters based on event type
        switch (type) {
            case 'FOCUS_LOSS':
                this.violations.focusLoss++;
                this.violations.total++;
                this._lastBlurTime = Date.now();
                this.logger.log('VIOLATION', 'FOCUS', `Focus lost — count: ${this.violations.focusLoss}`, details);
                break;

            case 'FOCUS_RESTORED':
                if (this._lastBlurTime) {
                    const duration = Date.now() - this._lastBlurTime;
                    this.totalOutOfFocusMs += duration;
                    this._lastBlurTime = null;
                    this.logger.log('INFO', 'FOCUS', `Focus restored after ${duration}ms`, {
                        duration,
                        totalOutOfFocusMs: this.totalOutOfFocusMs
                    });
                }
                break;

            case 'SHORTCUT_ATTEMPT':
                this.violations.shortcutAttempt++;
                this.violations.total++;
                this.logger.log('WARN', 'KEYBOARD', `Shortcut attempt: ${details.keyCombo || 'unknown'}`, details);
                break;

            case 'CLIPBOARD_ACCESS':
                this.violations.clipboardAccess++;
                this.violations.total++;
                this.logger.log('VIOLATION', 'CLIPBOARD', `Clipboard access blocked: ${details.action || 'unknown'}`, details);
                break;

            case 'PROCESS_VIOLATION':
                this.violations.processViolation++;
                this.violations.total++;
                this.logger.log('VIOLATION', 'PROCESS', `Forbidden process detected: ${details.processName || 'unknown'}`, details);
                break;

            case 'NAVIGATION_BLOCKED':
                this.violations.navigationBlocked++;
                this.violations.total++;
                this.logger.log('WARN', 'NAV', `Navigation blocked: ${details.url || 'unknown'}`, details);
                break;
        }

        // Check escalation
        this._checkEscalation();

        // Emit for UI updates
        this.emit('event', event);
        return event;
    }

    /**
     * Check if violation counts exceed thresholds and escalate.
     */
    _checkEscalation() {
        const thresholds = this.config.escalationThresholds || { warning: 2, alert: 5, terminate: 10 };
        const total = this.violations.total;
        const prevLevel = this.escalationLevel;

        if (total >= thresholds.terminate) {
            this.escalationLevel = 'TERMINATE';
        } else if (total >= thresholds.alert) {
            this.escalationLevel = 'ALERT';
        } else if (total >= thresholds.warning) {
            this.escalationLevel = 'WARNING';
        } else {
            this.escalationLevel = 'NORMAL';
        }

        // Log escalation changes
        if (this.escalationLevel !== prevLevel) {
            this.logger.log(
                this.escalationLevel === 'TERMINATE' ? 'ALERT' : 'WARN',
                'MONITOR',
                `Escalation: ${prevLevel} → ${this.escalationLevel}`,
                { totalViolations: total, violations: { ...this.violations } }
            );
            this.emit('escalation', this.escalationLevel, this.violations);
        }

        // Check specific thresholds from policy
        if (this.violations.focusLoss > (this.config.maxBlurEvents || 3)) {
            if (!this._focusAlertSent) {
                this._focusAlertSent = true;
                this.logger.log('ALERT', 'FOCUS', `Blur threshold exceeded: ${this.violations.focusLoss}/${this.config.maxBlurEvents}`, {
                    count: this.violations.focusLoss,
                    threshold: this.config.maxBlurEvents
                });
                this.emit('blur-threshold-exceeded', this.violations.focusLoss);
            }
        }
    }

    /**
     * Get current monitoring status (for UI display).
     */
    getStatus() {
        return {
            escalationLevel: this.escalationLevel,
            violations: { ...this.violations },
            totalOutOfFocusMs: this.totalOutOfFocusMs,
            timelineLength: this.timeline.length,
            isCurrentlyBlurred: this._lastBlurTime !== null
        };
    }

    /**
     * Get the full event timeline.
     */
    getTimeline() {
        return [...this.timeline];
    }

    /**
     * Reset all counters (e.g., for a new exam session).
     */
    reset() {
        this.violations = {
            focusLoss: 0,
            shortcutAttempt: 0,
            clipboardAccess: 0,
            processViolation: 0,
            navigationBlocked: 0,
            total: 0
        };
        this.timeline = [];
        this.escalationLevel = 'NORMAL';
        this.totalOutOfFocusMs = 0;
        this._lastBlurTime = null;
        this._focusAlertSent = false;
    }
}

module.exports = ActivityMonitor;
