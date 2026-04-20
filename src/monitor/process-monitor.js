// ============================================================
// SEB — Process Monitor
// Detects and kills forbidden processes during exam.
// Design Doc §2.2.3 + Thinking §3.7
// ============================================================

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class ProcessMonitor {
    /**
     * @param {object} logger - Logger instance
     * @param {object} activityMonitor - ActivityMonitor instance
     * @param {object} policyEngine - PolicyEngine instance
     */
    constructor(logger, activityMonitor, policyEngine) {
        this.logger = logger;
        this.activityMonitor = activityMonitor;
        this.policyEngine = policyEngine;
        this._interval = null;
        this._killCounts = {}; // Track how many times each process was killed
        this._isScanning = false;
    }

    /**
     * Start periodic process scanning.
     */
    start() {
        const intervalMs = this.policyEngine.getMonitoringConfig().processCheckIntervalMs || 3000;
        this.logger.log('INFO', 'PROCESS', `Process monitor started (interval: ${intervalMs}ms)`);

        // Run immediately, then on interval
        this.scan();
        this._interval = setInterval(() => this.scan(), intervalMs);
    }

    /**
     * Stop process scanning.
     */
    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        this.logger.log('INFO', 'PROCESS', 'Process monitor stopped');
    }

    /**
     * Scan for forbidden processes and handle violations.
     */
    async scan() {
        if (this._isScanning) return; // Prevent overlapping scans
        this._isScanning = true;

        try {
            // Get list of running processes (cross-platform)
            const isWin = process.platform === 'win32';
            const cmd = isWin ? 'tasklist /FO CSV /NH' : 'ps -eo comm,pid --no-headers 2>/dev/null';
            const { stdout } = await execAsync(cmd);
            const lines = stdout.trim().split('\n').filter(l => l.trim());

            const forbiddenProcesses = this.policyEngine.getForbiddenProcesses();
            const detected = [];

            for (const line of lines) {
                let processName, pid;
                if (isWin) {
                    // CSV format: "process.exe","1234","Console","1","12,345 K"
                    const parts = line.split(',');
                    processName = (parts[0] || '').replace(/"/g, '').replace(/\.exe$/i, '');
                    pid = (parts[1] || '').replace(/"/g, '');
                } else {
                    const parts = line.trim().split(/\s+/);
                    processName = parts[0] || '';
                    pid = parts[1] || '';
                }

                for (const forbidden of forbiddenProcesses) {
                    if (processName.toLowerCase().includes(forbidden.toLowerCase())) {
                        detected.push({ name: processName, pid, matchedRule: forbidden });
                    }
                }
            }

            // Handle detections
            for (const proc of detected) {
                this.activityMonitor.recordEvent('PROCESS_VIOLATION', {
                    processName: proc.name,
                    pid: proc.pid,
                    matchedRule: proc.matchedRule
                });

                // Track kill counts
                this._killCounts[proc.name] = (this._killCounts[proc.name] || 0) + 1;

                // Attempt to kill the forbidden process
                try {
                    const killCmd = isWin ? `taskkill /F /PID ${proc.pid}` : `kill -9 ${proc.pid} 2>/dev/null`;
                    await execAsync(killCmd);
                    this.logger.log('WARN', 'PROCESS', `Killed forbidden process: ${proc.name} (PID: ${proc.pid})`, {
                        killCount: this._killCounts[proc.name]
                    });
                } catch (killErr) {
                    this.logger.log('WARN', 'PROCESS', `Failed to kill: ${proc.name} (PID: ${proc.pid}) — may need elevated privileges`);
                }

                // Escalate if process keeps respawning
                if (this._killCounts[proc.name] >= 3) {
                    this.logger.log('ALERT', 'PROCESS', `Process "${proc.name}" keeps respawning (killed ${this._killCounts[proc.name]} times)`);
                }
            }
        } catch (err) {
            // ps command might fail — log but don't crash
            this.logger.log('WARN', 'PROCESS', `Process scan error: ${err.message}`);
        } finally {
            this._isScanning = false;
        }
    }

    /**
     * Perform initial scan to detect and warn about existing forbidden processes.
     * @returns {Array} List of forbidden processes that are currently running
     */
    async initialScan() {
        try {
            const isWin = process.platform === 'win32';
            const cmd = isWin ? 'tasklist /FO CSV /NH' : 'ps -eo comm --no-headers 2>/dev/null';
            const { stdout } = await execAsync(cmd);
            const lines = stdout.trim().split('\n').filter(l => l.trim());
            const forbiddenProcesses = this.policyEngine.getForbiddenProcesses();
            const found = [];

            for (const line of lines) {
                let processName;
                if (isWin) {
                    processName = (line.split(',')[0] || '').replace(/"/g, '').replace(/\.exe$/i, '');
                } else {
                    processName = line.trim();
                }
                for (const forbidden of forbiddenProcesses) {
                    if (processName.toLowerCase().includes(forbidden.toLowerCase())) {
                        found.push(processName);
                    }
                }
            }

            return [...new Set(found)]; // Deduplicate
        } catch {
            return [];
        }
    }

    /**
     * Check for virtual machine environment.
     * @returns {{ isVM: boolean, type: string|null }}
     */
    async detectVM() {
        if (process.platform === 'win32') {
            // Windows VM detection
            try {
                const { stdout } = await execAsync('wmic computersystem get model');
                const lower = stdout.toLowerCase();
                if (lower.includes('virtualbox')) return { isVM: true, type: 'VirtualBox' };
                if (lower.includes('vmware')) return { isVM: true, type: 'VMware' };
                if (lower.includes('virtual')) return { isVM: true, type: 'Virtual Machine' };
            } catch { }
            return { isVM: false, type: null };
        }

        // Linux VM detection
        const checks = [
            { cmd: 'systemd-detect-virt 2>/dev/null', parse: (out) => out.trim() !== 'none' && out.trim() !== '' ? out.trim() : null },
            {
                cmd: 'cat /sys/class/dmi/id/product_name 2>/dev/null', parse: (out) => {
                    const lower = out.toLowerCase();
                    if (lower.includes('virtualbox')) return 'VirtualBox';
                    if (lower.includes('vmware')) return 'VMware';
                    if (lower.includes('qemu') || lower.includes('kvm')) return 'QEMU/KVM';
                    if (lower.includes('hyper-v')) return 'Hyper-V';
                    return null;
                }
            },
            { cmd: 'lscpu 2>/dev/null | grep -i hypervisor', parse: (out) => out.trim() ? 'Hypervisor detected' : null }
        ];

        for (const check of checks) {
            try {
                const { stdout } = await execAsync(check.cmd);
                const result = check.parse(stdout);
                if (result) {
                    return { isVM: true, type: result };
                }
            } catch {
                // Command failed or returned non-zero — skip
            }
        }

        return { isVM: false, type: null };
    }

    /**
     * Get kill statistics.
     */
    getStats() {
        return { ...this._killCounts };
    }
}

module.exports = ProcessMonitor;
