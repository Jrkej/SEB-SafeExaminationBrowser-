// ============================================================
// SEB — Main Process Entry Point
// Orchestrates all modules: policy, logger, proxy, monitors,
// lockdown, window creation.
// Design Doc §2.2.1, Listing 1: Initialization Pseudocode
// ============================================================

const { app, clipboard, session } = require('electron');
const path = require('path');
const { exec } = require('child_process');

// Silence internal Chromium UI / X11 warnings (e.g. atom_cache.cc _NET_RESTACK_WINDOW)
app.commandLine.appendSwitch('log-level', '3');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// ---- Module imports ----
const PolicyEngine = require('../policy/policy-engine');
const Logger = require('../logger/logger');
const WindowManager = require('./window-manager');
const ShortcutBlocker = require('./shortcut-blocker');
const IPCHandlers = require('./ipc-handlers');
const ActivityMonitor = require('../monitor/activity-monitor');
const FocusMonitor = require('../monitor/focus-monitor');
const ProcessMonitor = require('../monitor/process-monitor');
const ClipboardMonitor = require('../monitor/clipboard-monitor');
const KeyboardMonitor = require('../monitor/keyboard-monitor');
const ProxyServer = require('../proxy/proxy-server');
const SebDatabase = require('../database/db');

// ---- Anti-tamper checks (Phase 12) ----
// Detect --remote-debugging-port
if (process.argv.some(a => a.includes('remote-debugging'))) {
    console.error('[SEB] SECURITY VIOLATION: Remote debugging detected. Exiting.');
    process.exit(1);
}
// Detect ELECTRON_RUN_AS_NODE
if (process.env.ELECTRON_RUN_AS_NODE) {
    console.error('[SEB] SECURITY VIOLATION: Running as Node.js. Exiting.');
    process.exit(1);
}

// ---- Global state ----
let policyEngine, logger, windowManager, shortcutBlocker, ipcHandlers;
let activityMonitor, focusMonitor, processMonitor, clipboardMonitor, keyboardMonitor;
let proxyServer, database;
let _originalOverlayKey = null;

// ---- Super Key Disable/Restore (Linux) ----

function disableSuperKey(logger) {
    try {
        // Save original GNOME overlay-key setting
        exec('gsettings get org.gnome.mutter overlay-key', (err, stdout) => {
            if (!err && stdout.trim()) {
                _originalOverlayKey = stdout.trim();
            }
        });

        // Disable GNOME Activities overlay (Super key -> Activities)
        exec("gsettings set org.gnome.mutter overlay-key ''", (err) => {
            if (!err) {
                logger.log('INFO', 'SYSTEM', 'Disabled GNOME Super key overlay (Activities)');
            }
        });

        // Disable Super key in GNOME Shell keybindings
        exec("gsettings set org.gnome.desktop.wm.keybindings panel-main-menu '[]'", (err) => {
            if (!err) {
                logger.log('INFO', 'SYSTEM', 'Disabled panel-main-menu Super key binding');
            }
        });

        // KDE Plasma: disable Meta key for Application Launcher
        exec("kwriteconfig5 --file kwinrc --group ModifierOnlyShortcuts --key Meta '' 2>/dev/null", () => { });
        exec('qdbus org.kde.KWin /KWin reconfigure 2>/dev/null', () => { });

        logger.log('INFO', 'SYSTEM', 'Super key disable commands issued');
    } catch (err) {
        logger.log('WARN', 'SYSTEM', `Failed to disable Super key: ${err.message}`);
    }
}

function restoreSuperKey() {
    try {
        // Restore GNOME overlay-key
        const key = _originalOverlayKey || "'Super_L'";
        exec(`gsettings set org.gnome.mutter overlay-key ${key}`, () => { });

        // Restore GNOME panel-main-menu
        exec("gsettings set org.gnome.desktop.wm.keybindings panel-main-menu \"['<Super>']\"", () => { });

        // KDE Plasma: restore
        exec("kwriteconfig5 --file kwinrc --group ModifierOnlyShortcuts --key Meta 'org.kde.plasmashell,/PlasmaShell,org.kde.PlasmaShell,activateLauncherMenu' 2>/dev/null", () => { });
        exec('qdbus org.kde.KWin /KWin reconfigure 2>/dev/null', () => { });
    } catch (err) {
        console.error('[SEB] Failed to restore Super key:', err);
    }
}

// ---- Initialization ----

async function initialize() {
    const basePath = path.join(__dirname, '..', '..');

    // ---- Step 1: Load policy ----
    policyEngine = new PolicyEngine(path.join(basePath, 'config', 'policy.json'));
    policyEngine.load();

    // ---- Step 2: Start logger ----
    logger = new Logger(policyEngine.getLoggingConfig(), process.cwd());
    logger.init();

    // ---- Step 2.5: Initialize database ----
    const dbDir = path.join(process.cwd(), 'data');
    database = new SebDatabase(dbDir);
    database.init();
    logger.setDatabase(database);
    logger.log('INFO', 'DATABASE', `Database initialized at ${dbDir}/seb.db`);

    logger.log('INFO', 'SYSTEM', 'SEB initializing...', {
        version: '1.0.0',
        platform: process.platform,
        arch: process.arch,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        nodeVersion: process.versions.node
    });

    // ---- Step 3: Initialize monitors ----
    const monitoringConfig = policyEngine.getMonitoringConfig();
    activityMonitor = new ActivityMonitor(logger, monitoringConfig);
    keyboardMonitor = new KeyboardMonitor(logger, activityMonitor, monitoringConfig);
    clipboardMonitor = new ClipboardMonitor(clipboard, logger, activityMonitor, monitoringConfig);
    processMonitor = new ProcessMonitor(logger, activityMonitor, policyEngine);

    // ---- Step 4: Start proxy (if enabled) ----
    const proxyConfig = policyEngine.getProxyConfig();
    if (proxyConfig.enabled) {
        proxyServer = new ProxyServer(logger, policyEngine);
        try {
            const port = await proxyServer.start();

            // Configure Electron session to use proxy
            await session.defaultSession.setProxy({
                proxyRules: `http=http://127.0.0.1:${port};https=http://127.0.0.1:${port}`,
                proxyBypassRules: '<local>'
            });

            logger.log('INFO', 'PROXY', `Browser traffic routed through proxy on port ${port}`);
        } catch (err) {
            logger.log('ALERT', 'PROXY', `Failed to start proxy: ${err.message}. Running without network isolation.`);
            proxyServer = null;
        }
    }

    // ---- Step 5: CSP headers and Download Pipeline ----
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http:; " +
                    "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com; " +
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
                    "img-src 'self' data: blob: https: http:;"
                ]
            }
        });
    });

    session.defaultSession.on('will-download', (event, item, webContents) => {
        const path = require('path');
        const fs = require('fs');
        const videoLogDir = path.join(process.cwd(), 'logs', 'videos');
        if (!fs.existsSync(videoLogDir)) {
            fs.mkdirSync(videoLogDir, { recursive: true });
        }

        const filePath = path.join(videoLogDir, item.getFilename());
        item.setSavePath(filePath);
        logger.log('INFO', 'SYSTEM', `Intercepted recording download, silently saving to: ${filePath}`);
    });

    // ---- Step 5.5: Create window FIRST (fullscreen kiosk covers desktop) ----
    const examMode = policyEngine.isExamMode();
    windowManager = new WindowManager(policyEngine, logger);
    const mainWindow = windowManager.createWindow(examMode);

    // ---- Step 11 (Moved up): Register IPC handlers ----
    ipcHandlers = new IPCHandlers({
        windowManager,
        policyEngine,
        logger,
        activityMonitor,
        clipboardMonitor,
        proxyServer,
        processMonitor,
        database
    });
    ipcHandlers.register();

    // Show a "Securing environment" splash while lockdown runs behind it
    if (examMode) {
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.executeJavaScript(`
                if (!document.getElementById('seb-lockdown-splash')) {
                    const d = document.createElement('div');
                    d.id = 'seb-lockdown-splash';
                    d.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:#0d0d1a;color:#fff;font-family:Inter,system-ui,sans-serif;flex-direction:column';
                    d.innerHTML = '<div style="font-size:2rem;font-weight:700;margin-bottom:1rem">🔒 Securing Environment...</div><div style="font-size:1rem;opacity:0.7">Closing unauthorized applications</div>';
                    document.body.appendChild(d);
                }
            `).catch(() => { });
        });
    }

    // Load a blank page first (splash will overlay it)
    windowManager.loadPage('index.html');

    // ---- Step 6: Run OS lockdown BEHIND the fullscreen window (Linux) ----
    if (process.platform === 'linux') {
        try {
            let lockdownScript = path.join(basePath, 'scripts', 'lockdown.sh');
            lockdownScript = lockdownScript.replace('app.asar', 'app.asar.unpacked');
            const fs = require('fs');
            if (fs.existsSync(lockdownScript)) {
                try {
                    // Temporarily disable alwaysOnTop so the pkexec password dialog can be seen!
                    if (examMode && mainWindow) {
                        mainWindow.setAlwaysOnTop(false);
                    }

                    console.log(`[SEB] Expecting OS privilege prompt...`);

                    const { spawn } = require('child_process');
                    const child = spawn('pkexec', ['bash', lockdownScript, 'enable']);

                    let stdoutBuf = '';
                    let stderrBuf = '';

                    const streamLog = (data) => {
                        const text = data.toString();
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.executeJavaScript(`
                                if (!document.getElementById('seb-lockdown-logs')) {
                                    const container = document.getElementById('seb-lockdown-splash');
                                    if (container) {
                                        const logs = document.createElement('div');
                                        logs.id = 'seb-lockdown-logs';
                                        logs.style.cssText = 'width:80%;max-width:800px;height:250px;background:#000;color:#0f0;font-family:monospace;padding:1rem;overflow-y:auto;text-align:left;font-size:0.85rem;margin-top:2rem;border-radius:4px;white-space:pre-wrap;text-shadow:none;border:1px solid #333;';
                                        container.appendChild(logs);
                                    }
                                }
                                const logs = document.getElementById('seb-lockdown-logs');
                                if (logs) {
                                    logs.appendChild(document.createTextNode(${JSON.stringify(text)}));
                                    logs.scrollTop = logs.scrollHeight;
                                }
                            `).catch(() => { });
                        }
                    };

                    child.stdout.on('data', (d) => { stdoutBuf += d; streamLog(d); });
                    child.stderr.on('data', (d) => { stderrBuf += d; streamLog(d); });

                    await new Promise((resolve, reject) => {
                        child.on('close', (code) => {
                            if (code === 0) resolve();
                            else reject(new Error('Process exited with code ' + code));
                        });
                        child.on('error', reject);
                    });

                    // Restore alwaysOnTop immediately after auth
                    if (examMode && mainWindow) {
                        mainWindow.setAlwaysOnTop(true, 'screen-saver');
                    }

                    if (stdoutBuf) console.log(`[LOCKDOWN-STDOUT]\n${stdoutBuf}`);
                    if (stderrBuf) console.error(`[LOCKDOWN-STDERR]\n${stderrBuf}`);

                    logger.log('INFO', 'LOCKDOWN', `OS-level lockdown enabled`);
                } catch (err) {
                    if (examMode && mainWindow) mainWindow.setAlwaysOnTop(true, 'screen-saver');
                    console.error(`[SEB] OS lockdown failed or password rejected: ${err.message}`);
                    if (err.stdout) console.log(`[LOCKDOWN-STDOUT]\n${err.stdout}`);
                    if (err.stderr) console.error(`[LOCKDOWN-STDERR]\n${err.stderr}`);
                    logger.log('ERROR', 'LOCKDOWN', `OS lockdown failed. Stopping SEB launch.`);

                    app.quit();
                    return;
                }
            } else {
                logger.log('WARN', 'LOCKDOWN', `lockdown.sh not found at ${lockdownScript}`);
            }
        } catch (err) {
            logger.log('WARN', 'LOCKDOWN', `Failed to run lockdown script: ${err.message}`);
        }
    }

    // Remove the securing splash now that lockdown is done
    if (examMode && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(`
            const splash = document.getElementById('seb-lockdown-splash');
            if (splash) splash.remove();
        `).catch(() => { });
    }

    // ---- Step 7: Start focus monitor AFTER lockdown (no false violations) ----
    focusMonitor = new FocusMonitor(mainWindow, logger, activityMonitor, monitoringConfig);
    if (examMode) {
        focusMonitor.start();
    }

    // ---- Step 8: Register shortcut blockers ----
    shortcutBlocker = new ShortcutBlocker(logger, keyboardMonitor);
    if (examMode) {
        shortcutBlocker.register();
    }

    // ---- Step 8.5: Disable Super/Meta key at desktop level ----
    if (examMode && process.platform === 'linux') {
        disableSuperKey(logger);
    }

    // ---- Step 9: Start clipboard monitor ----
    if (examMode && policyEngine.isFeatureDisabled('clipboardAccess')) {
        clipboardMonitor.start();
    }

    // ---- Step 10: Start process monitor ----
    if (examMode) {
        // Check for VM
        const vmResult = await processMonitor.detectVM();
        if (vmResult.isVM) {
            logger.log('WARN', 'SYSTEM', `Virtual machine detected: ${vmResult.type}`, vmResult);
        }

        // Check for existing forbidden processes
        const existingForbidden = await processMonitor.initialScan();
        if (existingForbidden.length > 0) {
            logger.log('WARN', 'PROCESS', `Forbidden processes detected at startup: ${existingForbidden.join(', ')}`);
        }

        processMonitor.start();
    }

    // ---- Step 12: Watch policy for hot-reload ----
    policyEngine.watch();
    policyEngine.on('updated', (newPolicy) => {
        logger.log('INFO', 'POLICY', 'Policy hot-reloaded');
        ipcHandlers.notifyPolicyUpdate(policyEngine.getSanitizedPolicy());
    });

    // ---- Step 13: Handle escalation events ----
    activityMonitor.on('escalation', (level, violations) => {
        ipcHandlers.sendAlert(`Security escalation: ${level}`, level);
        if (level === 'TERMINATE') {
            logger.log('ALERT', 'SYSTEM', 'Session termination triggered by escalation', violations);
            // In production, this would end the exam
        }
    });

    // Page already loaded at Step 5.5 (before lockdown, with splash overlay)

    logger.log('INFO', 'SYSTEM', 'SEB initialization complete', {
        examMode,
        proxyEnabled: proxyConfig.enabled,
        proxyPort: proxyConfig.enabled ? proxyConfig.port : null
    });
}

// ---- App lifecycle ----

app.whenReady().then(() => {
    initialize().catch(err => {
        console.error('[SEB] Initialization failed:', err);
        app.quit();
    });
});

app.on('window-all-closed', () => {
    shutdown();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    shutdown();
});

app.on('activate', () => {
    if (!windowManager || !windowManager.getWindow()) {
        initialize();
    }
});

// ---- Graceful shutdown ----

let hasShutdown = false;

function shutdown() {
    if (hasShutdown) return;
    hasShutdown = true;

    console.log('[SEB] Shutting down...');

    try {
        // Stop monitors
        if (focusMonitor) focusMonitor.stop();
        if (processMonitor) processMonitor.stop();
        if (clipboardMonitor) clipboardMonitor.stop();

        // Unregister shortcuts
        if (shortcutBlocker) shortcutBlocker.unregister();

        // Stop proxy
        if (proxyServer) proxyServer.stop();

        // Restore Super key
        if (process.platform === 'linux') {
            restoreSuperKey();

            // Auto-run restore script to undo OS lockdown
            // Uses sudo (not pkexec) — lockdown.sh created a sudoers.d rule
            // so restore runs without password prompt (user can't cancel it)
            try {
                const { execSync } = require('child_process');
                let restoreScript = path.join(__dirname, '..', '..', 'scripts', 'restore.sh');
                restoreScript = restoreScript.replace('app.asar', 'app.asar.unpacked');
                const fs = require('fs');
                if (fs.existsSync(restoreScript)) {
                    // execSync(`sudo bash "${restoreScript}"`, { timeout: 15000, stdio: 'pipe' });
                    console.log('[SEB] OS lockdown restored successfully.');
                } else {
                    // Fallback: try lockdown.sh disable
                    let lockdownScript = path.join(__dirname, '..', '..', 'scripts', 'lockdown.sh');
                    lockdownScript = lockdownScript.replace('app.asar', 'app.asar.unpacked');
                    if (fs.existsSync(lockdownScript)) {
                        execSync(`sudo bash "${lockdownScript}" disable`, { timeout: 15000, stdio: 'pipe' });
                        console.log('[SEB] OS lockdown disabled successfully.');
                    }
                }
            } catch (err) {
                console.error('[SEB] Failed to restore OS lockdown:', err.message);
            }
        }

        // Stop policy watcher
        if (policyEngine) policyEngine.stopWatching();

        // Flush and close logger
        if (logger) logger.shutdown();

    } catch (err) {
        console.error('[SEB] Error during shutdown:', err);
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    if (logger) {
        logger.log('ALERT', 'SYSTEM', `Uncaught exception: ${err.message}`, {
            stack: err.stack
        });
        logger.flush();
    }
    console.error('[SEB] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
    if (logger) {
        logger.log('ALERT', 'SYSTEM', `Unhandled rejection: ${reason}`);
        logger.flush();
    }
    console.error('[SEB] Unhandled rejection:', reason);
});
