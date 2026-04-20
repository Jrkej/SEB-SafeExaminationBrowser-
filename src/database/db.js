// ============================================================
// SEB — Database Module
// SQLite + AES-256-GCM encrypted, hash-chained log storage.
// Users are stored with salted SHA-256 password hashes.
// ============================================================

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Master encryption key — derived from a fixed app secret + machine ID.
// In production, this should be stored in OS keychain or hardware token.
const APP_SECRET = 'SEB-SECURE-EXAM-BROWSER-2026-MASTER-KEY';

class SebDatabase {
    /**
     * @param {string} dbDir - Directory to store seb.db
     */
    constructor(dbDir) {
        this.dbDir = dbDir;
        if (!fs.existsSync(this.dbDir)) {
            fs.mkdirSync(this.dbDir, { recursive: true });
        }
        this.dbPath = path.join(this.dbDir, 'seb.db');
        this.db = null;
        this.encryptionKey = crypto.scryptSync(APP_SECRET, 'seb-salt-v1', 32);
        this.previousHash = 'genesis';
    }

    /**
     * Initialize the database: open connection, create tables, seed defaults.
     */
    init() {
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');

        this._createTables();
        this._seedDefaults();

        // Load the latest hash for chain continuity
        const lastLog = this.db.prepare(
            'SELECT hash FROM logs ORDER BY id DESC LIMIT 1'
        ).get();
        if (lastLog) {
            this.previousHash = lastLog.hash;
        }

        return this;
    }

    // ================================================================
    // SCHEMA
    // ================================================================
    _createTables() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student', 'admin')),
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS exams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exam_id TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL DEFAULT 60,
                questions INTEGER NOT NULL DEFAULT 0,
                external_url TEXT,
                status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'upcoming', 'completed')),
                date TEXT
            );

            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                session_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                level TEXT NOT NULL,
                module TEXT NOT NULL,
                encrypted_data TEXT NOT NULL,
                iv TEXT NOT NULL,
                auth_tag TEXT NOT NULL,
                hash TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id);
            CREATE INDEX IF NOT EXISTS idx_logs_session ON logs(session_id);

            CREATE TABLE IF NOT EXISTS policies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL DEFAULT 'active',
                encrypted_policy TEXT NOT NULL,
                iv TEXT NOT NULL,
                auth_tag TEXT NOT NULL,
                hash TEXT NOT NULL,
                updated_by INTEGER,
                updated_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (updated_by) REFERENCES users(id)
            );
        `);
    }

    // ================================================================
    // DEFAULT SEED DATA
    // ================================================================
    _seedDefaults() {
        const userCount = this.db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
        if (userCount === 0) {
            // Seed default admin and student
            this.createUser('admin1', 'admin2026', 'Admin User', 'admin');
            this.createUser('student1', 'exam2026', 'Test Student', 'student');
        }

        const examCount = this.db.prepare('SELECT COUNT(*) as cnt FROM exams').get().cnt;
        if (examCount === 0) {
            this.db.prepare(`
                INSERT INTO exams (exam_id, title, duration_minutes, questions, status, date)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('exam-001', 'Software Engineering Mid-Term', 60, 30, 'available', '2026-04-20');

            this.db.prepare(`
                INSERT INTO exams (exam_id, title, duration_minutes, questions, status, date)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('exam-002', 'Data Structures Final Exam', 120, 50, 'upcoming', '2026-04-25');
        }
    }

    // ================================================================
    // AES-256-GCM ENCRYPTION
    // ================================================================
    _encrypt(plaintext) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return {
            encrypted,
            iv: iv.toString('hex'),
            authTag
        };
    }

    _decrypt(encrypted, ivHex, authTagHex) {
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    // ================================================================
    // PASSWORD HASHING
    // ================================================================
    _hashPassword(password, salt) {
        return crypto.createHash('sha256').update(salt + password).digest('hex');
    }

    // ================================================================
    // USER CRUD
    // ================================================================
    createUser(username, password, name, role = 'student') {
        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = this._hashPassword(password, salt);

        try {
            this.db.prepare(`
                INSERT INTO users (username, password_hash, salt, name, role)
                VALUES (?, ?, ?, ?, ?)
            `).run(username, passwordHash, salt, name, role);
            return { success: true };
        } catch (err) {
            if (err.message.includes('UNIQUE')) {
                return { success: false, error: 'Username already exists' };
            }
            return { success: false, error: err.message };
        }
    }

    authenticateUser(username, password) {
        const user = this.db.prepare(
            'SELECT * FROM users WHERE username = ?'
        ).get(username);

        if (!user) return { success: false, error: 'Invalid credentials' };

        const hash = this._hashPassword(password, user.salt);
        if (hash !== user.password_hash) {
            return { success: false, error: 'Invalid credentials' };
        }

        return {
            success: true,
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role
        };
    }

    getAllUsers() {
        return this.db.prepare(
            'SELECT id, username, name, role, created_at FROM users'
        ).all();
    }

    deleteUser(userId) {
        this.db.transaction(() => {
            // Detach logs and policies to preserve hash-chain ledger integrity
            this.db.prepare('UPDATE logs SET user_id = NULL WHERE user_id = ?').run(userId);
            this.db.prepare('UPDATE policies SET updated_by = NULL WHERE updated_by = ?').run(userId);

            // Delete the user
            this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
        })();
        return { success: true };
    }

    // ================================================================
    // EXAM CRUD
    // ================================================================
    getAllExams() {
        return this.db.prepare('SELECT * FROM exams').all();
    }

    // ================================================================
    // ENCRYPTED LOG OPERATIONS
    // ================================================================

    /**
     * Insert a log entry with AES-256-GCM encryption and SHA-256 hash chaining.
     */
    insertLog(userId, sessionId, level, module, message, details = null) {
        const timestamp = new Date().toISOString();
        const logData = JSON.stringify({ msg: message, details });

        // Encrypt the log payload
        const { encrypted, iv, authTag } = this._encrypt(logData);

        // Hash chain: hash = SHA-256(previousHash + timestamp + level + module + encrypted)
        const chainPayload = this.previousHash + timestamp + level + module + encrypted;
        const hash = crypto.createHash('sha256').update(chainPayload).digest('hex');
        this.previousHash = hash;

        this.db.prepare(`
            INSERT INTO logs (user_id, session_id, timestamp, level, module, encrypted_data, iv, auth_tag, hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userId, sessionId, timestamp, level, module, encrypted, iv, authTag, hash);
    }

    /**
     * Get decrypted logs for a specific user (admin only).
     */
    getLogsForUser(userId, limit = 200) {
        const rows = this.db.prepare(`
            SELECT * FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT ?
        `).all(userId, limit);

        return rows.map(row => {
            try {
                const decrypted = JSON.parse(this._decrypt(row.encrypted_data, row.iv, row.auth_tag));
                return {
                    id: row.id,
                    session_id: row.session_id,
                    timestamp: row.timestamp,
                    level: row.level,
                    module: row.module,
                    msg: decrypted.msg,
                    details: decrypted.details,
                    hash: row.hash
                };
            } catch {
                return {
                    id: row.id,
                    session_id: row.session_id,
                    timestamp: row.timestamp,
                    level: row.level,
                    module: row.module,
                    msg: '[DECRYPTION FAILED — TAMPERED]',
                    hash: row.hash
                };
            }
        });
    }

    /**
     * Get all logs decrypted (admin only).
     */
    getAllLogs(limit = 500) {
        const rows = this.db.prepare(`
            SELECT logs.*, users.username FROM logs
            LEFT JOIN users ON logs.user_id = users.id
            ORDER BY logs.id DESC LIMIT ?
        `).all(limit);

        return rows.map(row => {
            try {
                const decrypted = JSON.parse(this._decrypt(row.encrypted_data, row.iv, row.auth_tag));
                return {
                    id: row.id,
                    username: row.username || 'system',
                    session_id: row.session_id,
                    timestamp: row.timestamp,
                    level: row.level,
                    module: row.module,
                    msg: decrypted.msg,
                    details: decrypted.details,
                    hash: row.hash
                };
            } catch {
                return {
                    id: row.id,
                    username: row.username || 'system',
                    session_id: row.session_id,
                    timestamp: row.timestamp,
                    level: row.level,
                    module: row.module,
                    msg: '[DECRYPTION FAILED — TAMPERED]',
                    hash: row.hash
                };
            }
        });
    }

    /**
     * Verify the hash chain integrity of all logs.
     */
    verifyLogIntegrity() {
        const rows = this.db.prepare('SELECT * FROM logs ORDER BY id ASC').all();
        let prevHash = 'genesis';

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const chainPayload = prevHash + row.timestamp + row.level + row.module + row.encrypted_data;
            const expected = crypto.createHash('sha256').update(chainPayload).digest('hex');

            if (row.hash !== expected) {
                return { valid: false, brokenAt: i, rowId: row.id };
            }
            prevHash = row.hash;
        }

        return { valid: true, totalEntries: rows.length };
    }

    /**
     * Close the database connection.
     */
    close() {
        if (this.db) {
            this.db.close();
        }
    }

    // ================================================================
    // ENCRYPTED POLICY STORAGE
    // ================================================================

    /**
     * Save policy JSON to the database with AES-256-GCM encryption.
     * Stores a hash so tampering is detectable.
     */
    savePolicy(policyObj, adminUserId = null) {
        const plaintext = JSON.stringify(policyObj);
        const { encrypted, iv, authTag } = this._encrypt(plaintext);
        const hash = crypto.createHash('sha256').update(plaintext).digest('hex');

        this.db.prepare(`
            INSERT INTO policies (name, encrypted_policy, iv, auth_tag, hash, updated_by)
            VALUES ('active', ?, ?, ?, ?, ?)
        `).run(encrypted, iv, authTag, hash, adminUserId);

        return { success: true };
    }

    /**
     * Get the latest active policy, decrypted.
     * Returns null if no policy is stored yet.
     */
    getActivePolicy() {
        const row = this.db.prepare(
            "SELECT * FROM policies WHERE name = 'active' ORDER BY id DESC LIMIT 1"
        ).get();

        if (!row) return null;

        try {
            const decrypted = this._decrypt(row.encrypted_policy, row.iv, row.auth_tag);
            const policy = JSON.parse(decrypted);

            // Verify integrity
            const expectedHash = crypto.createHash('sha256').update(decrypted).digest('hex');
            if (expectedHash !== row.hash) {
                return { _tampered: true, _error: 'Policy hash mismatch — database tampered' };
            }

            return policy;
        } catch {
            return { _tampered: true, _error: 'Decryption failed — policy corrupted' };
        }
    }

    /**
     * Get policy change history (admin only).
     */
    getPolicyHistory(limit = 20) {
        const rows = this.db.prepare(`
            SELECT policies.id, policies.hash, policies.updated_at, users.username
            FROM policies
            LEFT JOIN users ON policies.updated_by = users.id
            WHERE policies.name = 'active'
            ORDER BY policies.id DESC LIMIT ?
        `).all(limit);
        return rows;
    }
}

module.exports = SebDatabase;
