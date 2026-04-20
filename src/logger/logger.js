// ============================================================
// SEB — Logger
// Timestamped, tamper-evident logging with SHA-256 hash chain.
// Design Doc Table 1: "Records all events with timestamps."
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Logger {
    /**
     * @param {object} config - Logging configuration from policy
     * @param {string} config.directory - Log directory path
     * @param {number} config.flushIntervalMs - How often to flush buffered entries
     * @param {boolean} config.hashChain - Enable SHA-256 hash chain
     * @param {number} config.maxBufferSize - Max entries before force flush
     * @param {string} basePath - Base path for resolving relative log directory
     */
    constructor(config = {}, basePath = '') {
        this.config = {
            directory: config.directory || 'logs',
            flushIntervalMs: config.flushIntervalMs || 10000,
            hashChain: config.hashChain !== false,
            maxBufferSize: config.maxBufferSize || 100
        };

        this.basePath = basePath || path.join(__dirname, '..', '..');
        this.logDir = path.resolve(this.basePath, this.config.directory);
        this.buffer = [];
        this.previousHash = 'genesis';
        this.sessionId = this._generateSessionId();
        this.logFilePath = path.join(
            this.logDir,
            `session-${this.sessionId}.jsonl`
        );
        this.flushInterval = null;
        this.entryCount = 0;
        this.sessionStartTime = new Date().toISOString();
        this.database = null;
        this.currentUserId = null;

        // Violation counters for summary
        this.counters = {
            total: 0,
            byLevel: {},
            byModule: {}
        };
    }

    /**
     * Initialize the logger: create log directory and start flush timer.
     */
    init() {
        // Ensure log directory exists
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        // Start periodic flush
        this.flushInterval = setInterval(() => {
            this.flush();
        }, this.config.flushIntervalMs);

        // Log session start
        this.log('INFO', 'LOGGER', 'Session started', {
            sessionId: this.sessionId,
            logFile: this.logFilePath,
            hashChainEnabled: this.config.hashChain
        });

        return this;
    }

    /**
     * Attach a database reference for encrypted log piping.
     */
    setDatabase(db) {
        this.database = db;
    }

    /**
     * Set the current user ID for log attribution.
     */
    setUserId(userId) {
        this.currentUserId = userId;
    }

    /**
     * Log an event.
     * @param {'INFO'|'WARN'|'VIOLATION'|'ALERT'|'NOTICE'} level
     * @param {string} module - Source module (FOCUS, KEYBOARD, CLIPBOARD, PROCESS, NAV, AUTH, EXAM, LOGGER)
     * @param {string} message - Human-readable description
     * @param {object} [details] - Additional structured data
     */
    log(level, module, message, details = null) {
        const entry = {
            ts: new Date().toISOString(),
            seq: ++this.entryCount,
            level: level,
            module: module,
            msg: message
        };

        if (details) {
            entry.details = details;
        }

        // Compute hash chain
        if (this.config.hashChain) {
            const payload = this.previousHash + JSON.stringify(entry);
            entry.hash = crypto.createHash('sha256').update(payload).digest('hex');
            this.previousHash = entry.hash;
        }

        // Update counters
        this.counters.total++;
        this.counters.byLevel[level] = (this.counters.byLevel[level] || 0) + 1;
        this.counters.byModule[module] = (this.counters.byModule[module] || 0) + 1;

        // Buffer the entry
        this.buffer.push(entry);

        // Pipe to encrypted database
        if (this.database) {
            try {
                this.database.insertLog(
                    this.currentUserId,
                    this.sessionId,
                    level,
                    module,
                    message,
                    details
                );
            } catch (err) {
                console.error(`[Logger] DB write failed: ${err.message}`);
            }
        }

        // Console output (for development)
        const color = this._levelColor(level);
        const tsString = new Date(entry.ts).toLocaleTimeString();
        console.log(`[${tsString}] ${color}[SEB][${level}][${module}]${'\x1b[0m'} ${message}`);

        // Force flush if buffer is full
        if (this.buffer.length >= this.config.maxBufferSize) {
            this.flush();
        }

        return entry;
    }

    /**
     * Flush buffered entries to disk.
     */
    flush() {
        if (this.buffer.length === 0) return;

        const lines = this.buffer.map(entry => JSON.stringify(entry)).join('\n') + '\n';

        try {
            fs.appendFileSync(this.logFilePath, lines, 'utf-8');
        } catch (err) {
            console.error(`[Logger] Failed to flush: ${err.message}`);
        }

        this.buffer = [];
    }

    /**
     * Get session summary (for export / admin view).
     */
    getSessionSummary() {
        return {
            sessionId: this.sessionId,
            startTime: this.sessionStartTime,
            currentTime: new Date().toISOString(),
            totalEvents: this.entryCount,
            counters: { ...this.counters },
            logFile: this.logFilePath
        };
    }

    /**
     * Export full session log as parsed JSON array.
     */
    exportSession() {
        this.flush(); // Ensure all buffered entries are written

        try {
            const raw = fs.readFileSync(this.logFilePath, 'utf-8');
            return raw
                .split('\n')
                .filter(line => line.trim())
                .map(line => JSON.parse(line));
        } catch (err) {
            console.error(`[Logger] Export failed: ${err.message}`);
            return [];
        }
    }

    /**
     * Verify hash chain integrity.
     * @returns {{ valid: boolean, brokenAt: number|null }}
     */
    verifyIntegrity() {
        const entries = this.exportSession();
        let prevHash = 'genesis';

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!entry.hash) continue; // Hash chain not enabled for this entry

            const { hash, ...rest } = entry;
            const payload = prevHash + JSON.stringify(rest);
            const expected = crypto.createHash('sha256').update(payload).digest('hex');

            if (hash !== expected) {
                return { valid: false, brokenAt: i, entry: entry };
            }
            prevHash = hash;
        }

        return { valid: true, brokenAt: null };
    }

    /**
     * Shut down the logger gracefully.
     */
    shutdown() {
        this.log('INFO', 'LOGGER', 'Session ended', {
            totalEvents: this.entryCount,
            summary: this.counters
        });
        this.flush();

        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
    }

    // ---- Private helpers ----

    _generateSessionId() {
        const now = new Date();
        const date = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const rand = crypto.randomBytes(4).toString('hex');
        return `${date}-${rand}`;
    }

    _levelColor(level) {
        const colors = {
            'INFO': '\x1b[36m',      // Cyan
            'NOTICE': '\x1b[37m',    // White
            'WARN': '\x1b[33m',      // Yellow
            'VIOLATION': '\x1b[31m', // Red
            'ALERT': '\x1b[35m'      // Magenta
        };
        return colors[level] || '\x1b[37m';
    }
}

module.exports = Logger;
