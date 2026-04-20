// ============================================================
// SEB — Renderer Lockdown
// Client-side security enforcement loaded in the renderer.
// Addresses: T4 (clipboard), T5 (right-click), T12 (PrintScreen),
//            T13 (drag-drop), visibility detection
// ============================================================

(function () {
    'use strict';

    // Wait for policy to load
    let policy = null;

    async function initLockdown() {
        try {
            policy = await window.seb.getPolicy();
        } catch {
            policy = { disabledFeatures: {}, monitoring: {} };
        }

        const features = policy.disabledFeatures || {};

        // ---- Right-Click Block (T5) ----
        if (features.rightClick) {
            document.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.seb.reportViolation('SHORTCUT_ATTEMPT', { keyCombo: 'right-click' });
                return false;
            }, true);
        }

        // ---- Clipboard Block (T4) ----
        if (features.clipboardAccess) {
            ['copy', 'cut', 'paste'].forEach(eventName => {
                document.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.seb.reportClipboardAttempt(eventName);
                    return false;
                }, true);
            });

            // Also intercept via Selection API
            document.addEventListener('selectstart', (e) => {
                // Allow selection in text inputs for exam answers
                const tag = e.target.tagName?.toLowerCase();
                if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
                    return; // allow
                }
                if (features.textSelection) {
                    e.preventDefault();
                }
            }, true);
        }

        // ---- Drag & Drop Block (T13) ----
        if (features.dragDrop) {
            ['drag', 'dragstart', 'dragend', 'dragover', 'dragenter', 'dragleave', 'drop'].forEach(eventName => {
                document.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }, true);
            });
        }

        // ---- Keyboard Shortcut Block (defense-in-depth) ----
        document.addEventListener('keydown', (e) => {
            const blocked = isBlockedShortcut(e);
            if (blocked) {
                e.preventDefault();
                e.stopPropagation();
                window.seb.reportViolation('SHORTCUT_ATTEMPT', {
                    keyCombo: describeKey(e),
                    source: 'renderer'
                });
                return false;
            }
        }, true);

        // ---- Visibility Change Detection ----
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                window.seb.reportViolation('FOCUS_LOSS', {
                    source: 'visibilitychange',
                    hidden: true
                });
            }
        });

        // ---- Window blur detection ----
        window.addEventListener('blur', () => {
            window.seb.reportViolation('FOCUS_LOSS', {
                source: 'window-blur'
            });
        });

        // ---- Disable print ----
        window.addEventListener('beforeprint', (e) => {
            e.preventDefault();
            window.seb.reportViolation('SHORTCUT_ATTEMPT', { keyCombo: 'print' });
        });

        // ---- Listen for policy updates ----
        window.seb.onPolicyUpdate((newPolicy) => {
            policy = newPolicy;
        });

        // ---- Listen for alerts ----
        window.seb.onAlert((alert) => {
            showAlertBanner(alert.message, alert.level);
        });

        console.log('[SEB Lockdown] Security enforcement active');
    }

    /**
     * Check if a keyboard event is a blocked shortcut.
     */
    function isBlockedShortcut(e) {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const alt = e.altKey;
        const key = e.key?.toLowerCase();
        const code = e.code;

        // DevTools
        if (ctrl && shift && (key === 'i' || key === 'j' || key === 'c')) return true;
        if (key === 'f12') return true;

        // Clipboard
        if (ctrl && (key === 'c' || key === 'v' || key === 'x')) return true;
        if (ctrl && key === 'a') return true; // Select all

        // Print / Save
        if (ctrl && key === 'p') return true;
        if (ctrl && key === 's') return true;

        // New window / tab / close
        if (ctrl && key === 'n') return true;
        if (ctrl && key === 't') return true;
        if (ctrl && key === 'w') return true;
        if (ctrl && key === 'q') return true;

        // Reload
        if (ctrl && key === 'r') return true;
        if (key === 'f5') return true;

        // Fullscreen toggle
        if (key === 'f11') return true;

        // View source
        if (ctrl && key === 'u') return true;

        // Find
        if (ctrl && key === 'f') return true;
        if (ctrl && key === 'g') return true;

        // Zoom
        if (ctrl && (key === '+' || key === '=' || key === '-' || key === '0')) return true;

        // PrintScreen
        if (code === 'PrintScreen') return true;

        // Escape (prevent exiting fullscreen)
        if (key === 'escape') return true;

        // Alt+Tab, Alt+F4
        if (alt && key === 'tab') return true;
        if (alt && key === 'f4') return true;

        // Super key
        if (key === 'meta' || key === 'os') return true;

        return false;
    }

    /**
     * Describe a key event as a human-readable string.
     */
    function describeKey(e) {
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');
        parts.push(e.key || e.code || 'unknown');
        return parts.join('+');
    }

    /**
     * Show a visual alert banner.
     */
    function showAlertBanner(message, level) {
        // Remove existing banner
        const existing = document.getElementById('seb-alert-banner');
        if (existing) existing.remove();

        const banner = document.createElement('div');
        banner.id = 'seb-alert-banner';
        banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      padding: 12px 20px;
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      animation: slideDown 0.3s ease;
      ${level === 'ALERT' || level === 'TERMINATE'
                ? 'background: linear-gradient(135deg, #ff4757, #ff6b6b); color: white;'
                : 'background: linear-gradient(135deg, #ffa502, #ffbe76); color: #333;'}
    `;
        banner.textContent = `⚠️ ${message}`;

        // Add animation keyframes if not present
        if (!document.getElementById('seb-alert-styles')) {
            const style = document.createElement('style');
            style.id = 'seb-alert-styles';
            style.textContent = `
        @keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }
      `;
            document.head.appendChild(style);
        }

        document.body.appendChild(banner);

        // Auto-hide after 5 seconds
        setTimeout(() => {
            if (banner.parentNode) {
                banner.style.transition = 'opacity 0.3s ease';
                banner.style.opacity = '0';
                setTimeout(() => banner.remove(), 300);
            }
        }, 5000);
    }

    // ---- Initialize when DOM is ready ----
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLockdown);
    } else {
        initLockdown();
    }
})();
