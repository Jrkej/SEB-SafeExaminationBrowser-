// ============================================================
// SEB — Policy Engine
// Loads, validates, watches, and exposes policy configuration.
// Design Doc §4: Policy-Driven Control
// ============================================================

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class PolicyEngine extends EventEmitter {
    constructor(configPath) {
        super();
        let defaultPath = path.join(__dirname, '..', '..', 'config', 'policy.json');
        this.configPath = configPath || defaultPath;
        this.configPath = this.configPath.replace('app.asar', 'app.asar.unpacked');
        this.policy = null;
        this._watcher = null;
        this._debounceTimer = null;
    }

    /**
     * Load and validate policy from disk.
     * @returns {object} The loaded policy
     */
    load() {
        try {
            const raw = fs.readFileSync(this.configPath, 'utf-8');
            const parsed = JSON.parse(raw);
            this._validate(parsed);
            this.policy = parsed;
            this.emit('loaded', this.policy);
            return this.policy;
        } catch (err) {
            console.error(`[PolicyEngine] Failed to load policy: ${err.message}`);
            // Fall back to safe defaults
            this.policy = this._getDefaults();
            return this.policy;
        }
    }

    /**
     * Start watching the policy file for changes (hot-reload).
     * Design Doc §4: "support for hot reloading of policies"
     */
    watch() {
        if (this._watcher) return;
        try {
            this._watcher = fs.watch(this.configPath, (eventType) => {
                if (eventType === 'change') {
                    // Debounce: editors often write then rename, causing multiple events
                    clearTimeout(this._debounceTimer);
                    this._debounceTimer = setTimeout(() => {
                        console.log('[PolicyEngine] Policy file changed, reloading...');
                        const oldPolicy = { ...this.policy };
                        this.load();
                        this.emit('updated', this.policy, oldPolicy);
                    }, 500);
                }
            });
        } catch (err) {
            console.error(`[PolicyEngine] Cannot watch policy file: ${err.message}`);
        }
    }

    /**
     * Stop watching the policy file.
     */
    stopWatching() {
        if (this._watcher) {
            this._watcher.close();
            this._watcher = null;
        }
        clearTimeout(this._debounceTimer);
    }

    /**
     * Validate policy object has required fields and correct types.
     */
    _validate(obj) {
        const required = ['allowedDomains', 'disabledFeatures', 'monitoring', 'forbiddenProcesses', 'proxy', 'logging'];
        for (const field of required) {
            if (!(field in obj)) {
                throw new Error(`Missing required policy field: ${field}`);
            }
        }
        if (!Array.isArray(obj.allowedDomains)) {
            throw new Error('allowedDomains must be an array');
        }
        if (typeof obj.disabledFeatures !== 'object') {
            throw new Error('disabledFeatures must be an object');
        }
        if (typeof obj.monitoring !== 'object') {
            throw new Error('monitoring must be an object');
        }
        if (!Array.isArray(obj.forbiddenProcesses)) {
            throw new Error('forbiddenProcesses must be an array');
        }
    }

    /**
     * Get safe defaults if policy file is invalid.
     */
    _getDefaults() {
        return {
            examMode: true,
            allowedDomains: [],
            disabledFeatures: {
                devTools: true,
                rightClick: true,
                clipboardAccess: true,
                externalLinks: true,
                dragDrop: true,
                printScreen: true,
                textSelection: false
            },
            monitoring: {
                maxBlurEvents: 3,
                alertOnShortcutAttempt: true,
                processCheckIntervalMs: 3000,
                clipboardClearIntervalMs: 5000,
                focusRestoreDelayMs: 100,
                maxShortcutAttempts: 10,
                escalationThresholds: { warning: 2, alert: 5, terminate: 10 }
            },
            forbiddenProcesses: [],
            proxy: { port: 18080, enabled: false },
            logging: { directory: 'logs', flushIntervalMs: 10000, hashChain: true, maxBufferSize: 100 }
        };
    }

    // ---- Getters ----

    getAllowedDomains() {
        return this.policy?.allowedDomains || [];
    }

    getDisabledFeatures() {
        return this.policy?.disabledFeatures || {};
    }

    getMonitoringConfig() {
        return this.policy?.monitoring || {};
    }

    getForbiddenProcesses() {
        return this.policy?.forbiddenProcesses || [];
    }

    getProxyConfig() {
        return this.policy?.proxy || {};
    }

    getLoggingConfig() {
        return this.policy?.logging || {};
    }

    getAuthConfig() {
        return this.policy?.auth || { mode: 'local', users: [] };
    }

    getExamConfig() {
        return this.policy?.exam || {};
    }

    isExamMode() {
        return this.policy?.examMode === true;
    }

    /**
     * Check if a domain is in the whitelist.
     * Supports wildcards: "*.university.edu" matches "exam.university.edu"
     */
    isDomainAllowed(hostname) {
        if (!hostname) return false;
        hostname = hostname.toLowerCase().trim();
        const domains = this.getAllowedDomains();

        for (const domain of domains) {
            const d = domain.toLowerCase().trim();
            // Match all
            if (d === '*') return true;
            // Exact match
            if (hostname === d) return true;
            // Wildcard match: *.example.com matches sub.example.com
            if (d.startsWith('*.')) {
                const suffix = d.slice(1); // ".example.com"
                if (hostname.endsWith(suffix) || hostname === d.slice(2)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Check if a process name is in the forbidden list.
     */
    isProcessForbidden(processName) {
        if (!processName) return false;
        const name = processName.toLowerCase().trim();
        return this.getForbiddenProcesses().some(fp =>
            name.includes(fp.toLowerCase())
        );
    }

    /**
     * Check if a specific feature is disabled.
     */
    isFeatureDisabled(featureName) {
        const features = this.getDisabledFeatures();
        return features[featureName] === true;
    }

    /**
     * Get the full policy object (read-only copy for renderer).
     */
    getSanitizedPolicy() {
        if (!this.policy) return {};
        // Don't expose auth credentials to renderer
        const { auth, ...safe } = this.policy;
        return JSON.parse(JSON.stringify(safe));
    }
}

module.exports = PolicyEngine;
