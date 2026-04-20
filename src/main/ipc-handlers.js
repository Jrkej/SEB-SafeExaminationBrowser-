// ============================================================
// SEB — IPC Handlers
// Handles communication between main process and renderer.
// Now uses database for auth, exams, and encrypted log queries.
// ============================================================

const { ipcMain, desktopCapturer } = require('electron');

class IPCHandlers {
    /**
     * @param {object} deps - All module dependencies
     */
    constructor(deps) {
        this.windowManager = deps.windowManager;
        this.policyEngine = deps.policyEngine;
        this.logger = deps.logger;
        this.activityMonitor = deps.activityMonitor;
        this.clipboardMonitor = deps.clipboardMonitor;
        this.proxyServer = deps.proxyServer;
        this.processMonitor = deps.processMonitor;
        this.database = deps.database;
        this.examActive = false;
        this.currentUserId = null;
    }

    /**
     * Register all IPC handlers.
     */
    register() {
        // ---- Window controls ----
        ipcMain.on('window-minimize', () => {
            const win = this.windowManager.getWindow();
            if (win) win.minimize();
        });

        ipcMain.on('window-maximize', () => {
            const win = this.windowManager.getWindow();
            if (win) {
                if (win.isMaximized()) win.unmaximize();
                else win.maximize();
            }
        });

        ipcMain.on('window-close', () => {
            const win = this.windowManager.getWindow();
            if (win) {
                if (this.examActive) {
                    this.logger.log('WARN', 'WINDOW', 'Close attempt blocked - exam currently active');
                    win.webContents.send('alert', { message: 'Window closure is disabled during active exams.', level: 'WARNING' });
                } else {
                    win.closable = true;
                    win.close();
                }
            }
        });

        // ---- Policy ----
        ipcMain.handle('get-policy', () => {
            return this.policyEngine.getSanitizedPolicy();
        });

        // ---- Auth (Database-driven) ----
        ipcMain.handle('auth-login', (event, username, password) => {
            if (this.database) {
                const result = this.database.authenticateUser(username, password);
                if (result.success) {
                    this.currentUserId = result.id;
                    this.logger.log('INFO', 'AUTH', `Login successful: ${username} (${result.role})`);
                    this.logger.setUserId(result.id);
                    return { success: true, role: result.role, name: result.name, id: result.username };
                } else {
                    this.logger.log('WARN', 'AUTH', `Login failed: ${username}`);
                    return { success: false, error: 'Invalid credentials' };
                }
            }
            return { success: false, error: 'Database not available' };
        });

        // ---- Exam (Database-driven) ----
        ipcMain.handle('get-exams', () => {
            if (this.database) {
                const exams = this.database.getAllExams();
                return exams.map(e => ({
                    id: e.exam_id,
                    title: e.title,
                    duration: e.duration_minutes,
                    questions: e.questions,
                    status: e.status,
                    date: e.date
                }));
            }
            return [];
        });

        ipcMain.handle('start-exam', (event, examId) => {
            this.examActive = true;
            this.logger.log('INFO', 'EXAM', `Exam started: ${examId}`);
            return { success: true, examId };
        });

        ipcMain.handle('submit-exam', (event, examId, answers) => {
            this.examActive = false;
            this.logger.log('INFO', 'EXAM', `Exam submitted: ${examId}`, {
                answeredCount: answers ? Object.keys(answers).length : 0
            });
            return { success: true, examId };
        });

        // ---- Monitoring ----
        ipcMain.on('violation', (event, type, details) => {
            this.activityMonitor.recordEvent(type, details);
        });

        ipcMain.on('clipboard-attempt', (event, action) => {
            this.clipboardMonitor.recordAttempt(action);
        });

        ipcMain.handle('get-session-status', () => {
            return {
                monitor: this.activityMonitor.getStatus(),
                proxy: this.proxyServer ? this.proxyServer.getStats() : null,
                session: this.logger.getSessionSummary()
            };
        });

        ipcMain.handle('get-session-logs', () => {
            return this.logger.exportSession();
        });

        ipcMain.handle('verify-log-integrity', () => {
            if (this.database) {
                return this.database.verifyLogIntegrity();
            }
            return this.logger.verifyIntegrity();
        });

        // ---- Navigation ----
        ipcMain.handle('check-url-allowed', (event, url) => {
            try {
                const hostname = new URL(url).hostname;
                return this.policyEngine.isDomainAllowed(hostname);
            } catch {
                return false;
            }
        });

        // ---- Desktop Media Capture ----
        ipcMain.handle('get-desktop-source', async () => {
            const sources = await desktopCapturer.getSources({ types: ['screen'] });
            return sources.length > 0 ? sources[0].id : null;
        });

        // ============================================================
        // ADMIN-ONLY: User Management & Per-User Log Retrieval
        // ============================================================

        ipcMain.handle('admin-get-all-users', () => {
            if (this.database) {
                return this.database.getAllUsers();
            }
            return [];
        });

        ipcMain.handle('admin-create-user', (event, username, password, name, role) => {
            if (this.database) {
                const result = this.database.createUser(username, password, name, role);
                this.logger.log('INFO', 'ADMIN', `User created: ${username} (${role})`);
                return result;
            }
            return { success: false, error: 'Database not available' };
        });

        ipcMain.handle('admin-delete-user', (event, userId) => {
            if (this.database) {
                this.database.deleteUser(userId);
                this.logger.log('INFO', 'ADMIN', `User deleted: ID ${userId}`);
                return { success: true };
            }
            return { success: false, error: 'Database not available' };
        });

        ipcMain.handle('admin-get-logs-for-user', (event, userId) => {
            if (this.database) {
                return this.database.getLogsForUser(userId);
            }
            return [];
        });

        ipcMain.handle('admin-get-all-logs', () => {
            if (this.database) {
                return this.database.getAllLogs();
            }
            return [];
        });

        // ============================================================
        // ADMIN-ONLY: Policy Management (Encrypted in DB)
        // ============================================================

        ipcMain.handle('admin-save-policy', (event, policyObj) => {
            if (this.database) {
                try {
                    // Validate the policy before saving
                    const required = ['allowedDomains', 'disabledFeatures', 'monitoring', 'forbiddenProcesses', 'proxy', 'logging'];
                    for (const field of required) {
                        if (!(field in policyObj)) {
                            return { success: false, error: `Missing required field: ${field}` };
                        }
                    }

                    // Save encrypted to database
                    this.database.savePolicy(policyObj, this.currentUserId);

                    // Apply to live policy engine
                    this.policyEngine.policy = policyObj;
                    this.policyEngine.emit('updated', policyObj);
                    this.notifyPolicyUpdate(this.policyEngine.getSanitizedPolicy());

                    // Write to disk too so it persists across restarts
                    const fs = require('fs');
                    fs.writeFileSync(
                        this.policyEngine.configPath,
                        JSON.stringify(policyObj, null, 2),
                        'utf-8'
                    );

                    this.logger.log('INFO', 'ADMIN', 'Policy updated and saved to database');
                    return { success: true };
                } catch (err) {
                    return { success: false, error: err.message };
                }
            }
            return { success: false, error: 'Database not available' };
        });

        ipcMain.handle('admin-get-policy-history', () => {
            if (this.database) {
                return this.database.getPolicyHistory();
            }
            return [];
        });

        this.logger.log('INFO', 'IPC', 'IPC handlers registered (database-enabled)');
    }

    /**
     * Forward policy updates to renderer.
     */
    notifyPolicyUpdate(policy) {
        const win = this.windowManager.getWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('policy-updated', policy);
        }
    }

    /**
     * Send alert to renderer.
     */
    sendAlert(message, level) {
        const win = this.windowManager.getWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('alert', { message, level });
        }
    }
}

module.exports = IPCHandlers;
