#!/bin/bash
# ============================================================
# SEB — Restore Script  v4.1
# Reverses all OS-level lockdown changes made by lockdown.sh.
# Run after exam ends or if SEB crashes.
# Usage: sudo ./restore.sh
# ============================================================

set -uo pipefail

LOG_FILE="/tmp/seb-restore.log"
LOCKFILE="/var/run/seb-lockdown"
KEYMAP_FILE="/root/seb-orig-keymap.txt"
IPTABLES_SAVE="/root/seb-iptables.rules"
UDEV_RULE="/etc/udev/rules.d/99-seb-usb.rules"
USB_MODPROBE="/etc/modprobe.d/seb-usb.conf"
XCONF="/etc/X11/xorg.conf.d/99-seb-novtswitch.conf"

log()  { echo "  [+] $*" | tee -a "$LOG_FILE"; }
warn() { echo "  [!] $*" | tee -a "$LOG_FILE"; }


# ── Detect active graphical sessions so we do not reload logind under X/Wayland ─
has_active_graphical_session() {
    local sid active type

    if command -v loginctl >/dev/null 2>&1; then
        while read -r sid _ _ _; do
            [ -z "$sid" ] && continue
            active=$(loginctl show-session "$sid" -p Active --value 2>/dev/null || echo "no")
            type=$(loginctl show-session "$sid" -p Type --value 2>/dev/null || echo "unknown")
            if [ "$active" = "yes" ] && printf '%s\n' "$type" | grep -qiE '^(x11|wayland|mir)$'; then
                return 0
            fi
        done < <(loginctl list-sessions --no-legend 2>/dev/null || true)
    fi

    [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]
}

reload_logind_safely() {
    # ── NEVER reload logind while the user is in a graphical session ──────
    # Sending SIGHUP to systemd-logind while X11/Wayland is active causes it
    # to drop session tracking, which collapses the display server.  Since
    # restore.sh is always invoked while the desktop is still up (after SEB
    # exits), we unconditionally skip the reload.  The on-disk config change
    # is picked up automatically on the next login.
    warn "logind reload skipped to protect the display — changes take effect on next login."
    return 1
}


[ "$EUID" -eq 0 ] || { echo "❌ Must be run as root (sudo)." >&2; exit 1; }

# Ensure log file is writable
touch "$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/seb-restore-$$.log"

{
    echo ""
    echo "🔓 [SEB Restore] Restoring system to normal state..."
    echo "   Timestamp: $(date -Iseconds)"
    echo ""
} | tee -a "$LOG_FILE"

# ── 1. Restore SysRq ──────────────────────────────────────────────────────────
echo 1 > /proc/sys/kernel/sysrq || true
log "SysRq re-enabled"

# ── 2. Restore logind ─────────────────────────────────────────────────────────
# Reloading logind while an X/Wayland session is active drops session tracking
# and collapses the display.  We detect whether a graphical session is running
# and only send SIGHUP when it is safe to do so; otherwise we defer to next login.
_logind_reload_safe() {
    # Returns 0 (safe to reload) only if no graphical session is active.
    # Check both the environment variables inherited from the caller and loginctl.
    if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
        return 1
    fi
    if loginctl list-sessions --no-legend 2>/dev/null \
            | awk '{print $3}' | grep -qiE '^(x11|wayland|mir)$'; then
        return 1
    fi
    return 0
}

if [ -f /root/seb-logind.conf.bak ]; then
    cp /root/seb-logind.conf.bak /etc/systemd/logind.conf
    rm -f /root/seb-logind.conf.bak
    log "logind.conf restored from backup"
else
    # Fallback: strip only the lines we appended
    if [ -f /etc/systemd/logind.conf ]; then
        sed -i '/^# --- SEB exam lockdown overrides ---/,/^IdleAction=ignore/d' \
            /etc/systemd/logind.conf 2>/dev/null || true
        log "logind.conf SEB overrides stripped"
    else
        warn "/etc/systemd/logind.conf missing — cannot restore logind settings"
    fi
fi

if reload_logind_safely; then
    log "logind reloaded — lid/suspend/idle behaviour restored immediately"
else
    warn "logind reload skipped — lid/suspend/idle settings will restore on next login"
fi

# ── 2b. Kill systemd-inhibit and restore DPMS ────────────────────────────────
if [ -f /var/run/seb-inhibit.pid ]; then
    kill "$(cat /var/run/seb-inhibit.pid)" 2>/dev/null || true
    rm -f /var/run/seb-inhibit.pid
    log "systemd-inhibit stopped"
fi
if command -v xset >/dev/null 2>&1; then
    xset s on          2>/dev/null || true
    xset +dpms         2>/dev/null || true
    log "DPMS and screensaver restored (xset)"
fi

# ── 3. Restore iptables ───────────────────────────────────────────────────────
if [ -f "$IPTABLES_SAVE" ]; then
    if iptables-restore < "$IPTABLES_SAVE" 2>/dev/null; then
        log "iptables restored from $IPTABLES_SAVE"
    else
        warn "iptables-restore failed — flushing rules and setting ACCEPT policy instead"
        iptables -F INPUT  2>/dev/null || true
        iptables -F OUTPUT 2>/dev/null || true
        iptables -P INPUT  ACCEPT 2>/dev/null || true
        iptables -P OUTPUT ACCEPT 2>/dev/null || true
    fi
    rm -f "$IPTABLES_SAVE"
else
    warn "No iptables backup found — flushing rules and setting ACCEPT policy"
    iptables -F INPUT  2>/dev/null || true
    iptables -F OUTPUT 2>/dev/null || true
    iptables -P INPUT  ACCEPT 2>/dev/null || true
    iptables -P OUTPUT ACCEPT 2>/dev/null || true
fi

# ── 4. Re-enable USB storage ──────────────────────────────────────────────────
rm -f "$USB_MODPROBE" "$UDEV_RULE"
udevadm control --reload-rules 2>/dev/null || true
if modprobe usb-storage 2>/dev/null; then
    log "usb-storage module reloaded"
else
    warn "modprobe usb-storage failed (may already be loaded or not available)"
fi

# ── 5. Restore VT keybindings ─────────────────────────────────────────────────
if [ -f "$KEYMAP_FILE" ] && command -v loadkeys >/dev/null 2>&1; then
    if loadkeys "$KEYMAP_FILE" 2>/dev/null; then
        log "Keymap restored"
    else
        warn "loadkeys failed — keymap may need manual reset"
    fi
    rm -f "$KEYMAP_FILE"
else
    warn "Keymap backup not found or loadkeys unavailable — skipping"
fi

# ── 6. Unmask and restart getty@tty2-6 ───────────────────────────────────────
if command -v systemctl >/dev/null 2>&1; then
    for tty in 2 3 4 5 6; do
        systemctl unmask "getty@tty${tty}.service" 2>/dev/null || true
        systemctl start  "getty@tty${tty}.service" 2>/dev/null || true
    done
    log "getty@tty{2-6} restored"
else
    warn "systemctl not available — getty services not restored"
fi

# ── 7. Remove X11 VT restriction config ──────────────────────────────────────
if [ -f "$XCONF" ]; then
    rm -f "$XCONF"
    log "X11 DontVTSwitch config removed"
else
    log "X11 VT config already absent — nothing to remove"
fi

# ── 8. Re-enable Ctrl+Alt+Del ────────────────────────────────────────────────
systemctl unmask ctrl-alt-del.target 2>/dev/null || true
log "ctrl-alt-del.target unmasked"

# ── 9. Clean up lockfiles ─────────────────────────────────────────────────────
rm -f "${LOCKFILE}.pid" "${LOCKFILE}.inhibit"
rm -f /etc/sudoers.d/seb-restore
log "Lockfile and sudoers rule cleaned up"

{
    echo ""
    echo "✅ System fully restored to normal state."
    echo "   Log saved to: $LOG_FILE"
    echo ""
} | tee -a "$LOG_FILE"