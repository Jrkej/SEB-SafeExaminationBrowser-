// ============================================================
// SEB — Preload Script
// Secure context bridge between main process and renderer.
// Only exposes safe APIs — no Node.js in renderer.
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('seb', {
    // ---- Window Controls ----
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),

    // ---- Policy ----
    getPolicy: () => ipcRenderer.invoke('get-policy'),
    onPolicyUpdate: (callback) => {
        ipcRenderer.on('policy-updated', (_, policy) => callback(policy));
    },

    // ---- Authentication ----
    login: (userId, password) => ipcRenderer.invoke('auth-login', userId, password),

    // ---- Exam ----
    getExams: () => ipcRenderer.invoke('get-exams'),
    startExam: (examId) => ipcRenderer.invoke('start-exam', examId),
    submitExam: (examId, answers) => ipcRenderer.invoke('submit-exam', examId, answers),

    // ---- Monitoring ----
    reportViolation: (type, details) => ipcRenderer.send('violation', type, details),
    reportClipboardAttempt: (action) => ipcRenderer.send('clipboard-attempt', action),
    getSessionStatus: () => ipcRenderer.invoke('get-session-status'),
    getSessionLogs: () => ipcRenderer.invoke('get-session-logs'),
    verifyLogIntegrity: () => ipcRenderer.invoke('verify-log-integrity'),
    getDesktopSource: () => ipcRenderer.invoke('get-desktop-source'),

    // ---- Navigation ----
    checkUrlAllowed: (url) => ipcRenderer.invoke('check-url-allowed', url),

    // ---- Admin: User Management ----
    getAllUsers: () => ipcRenderer.invoke('admin-get-all-users'),
    createUser: (username, password, name, role) => ipcRenderer.invoke('admin-create-user', username, password, name, role),
    deleteUser: (userId) => ipcRenderer.invoke('admin-delete-user', userId),

    // ---- Admin: Log Viewer ----
    getLogsForUser: (userId) => ipcRenderer.invoke('admin-get-logs-for-user', userId),
    getAllLogs: () => ipcRenderer.invoke('admin-get-all-logs'),

    // ---- Admin: Policy Management ----
    savePolicy: (policyObj) => ipcRenderer.invoke('admin-save-policy', policyObj),
    getPolicyHistory: () => ipcRenderer.invoke('admin-get-policy-history'),

    // ---- Alerts ----
    onAlert: (callback) => {
        ipcRenderer.on('alert', (_, alert) => callback(alert));
    },

    // ---- Escalation ----
    onEscalation: (callback) => {
        ipcRenderer.on('escalation', (_, level, violations) => callback(level, violations));
    }
});

// Expose a flag indicating this is the SEB environment
contextBridge.exposeInMainWorld('isSEB', true);

