#!/bin/bash
# ============================================================
# SEB — OS-Level Lockdown  v4.1
# Kills user-space apps and hardens the session.
# Does NOT reboot / suspend / power off.
#
# Usage: sudo ./lockdown.sh enable [exam_server_ip]
#        sudo ./lockdown.sh disable
#        sudo ./lockdown.sh status
#
# Kill order:
#   Stage 1 — Browsers        (SIGTERM → 3 s wait → SIGKILL)
#   Stage 2 — All other apps  (SIGTERM → 3 s wait → SIGKILL)
# ============================================================

LOCKFILE="/var/run/seb-lockdown"
KEYMAP_FILE="/root/seb-orig-keymap.txt"
IPTABLES_SAVE="/root/seb-iptables.rules"
UDEV_RULE="/etc/udev/rules.d/99-seb-usb.rules"
USB_MODPROBE="/etc/modprobe.d/seb-usb.conf"
XCONF="/etc/X11/xorg.conf.d/99-seb-novtswitch.conf"
EXAM_SERVER_IP="${2:-}"
SEB_PID="${3:-}"

# Protected PID list (populated in do_enable before any kill)
PROTECTED=""
# Running total of process-names terminated
TOTAL_KILLED=0

set -uo pipefail

log()  { echo "  [+] $*"; }
warn() { echo "  [!] $*"; }
die()  { echo "❌  $*" >&2; exit 1; }

require_root()    { [ "$EUID" -eq 0 ] || die "Must be run as root (sudo)."; }
already_enabled() { [ -f "${LOCKFILE}.pid" ]; }

# ── Build protected PID set (this script + SEB + their descendants) ─────────
get_protected_pids() {
    local pids="$$ $PPID"
    
    local seb_root="${SEB_PID}"
    if [ -z "$seb_root" ]; then
        seb_root=$(awk '/^PPid:/{print $2}' "/proc/$PPID/status" 2>/dev/null) || seb_root=1
    fi
    [ -n "$seb_root" ] && [ "$seb_root" -gt 1 ] && pids="$pids $seb_root"

    get_descendants() {
        local parent="$1"
        local children
        children=$(pgrep -P "$parent" 2>/dev/null || true)
        for c in $children; do
            echo "$c"
            get_descendants "$c"
        done
    }

    local seb_desc
    [ -n "$seb_root" ] && [ "$seb_root" -gt 1 ] && seb_desc=$(get_descendants "$seb_root")
    
    local our_desc
    our_desc=$(get_descendants "$PPID")

    pids="$pids $seb_desc $our_desc"
    echo "$pids" | tr ' ' '\n' | sort -u | grep -v '^$' | paste -sd '|'
}

# ── Filter out protected PIDs from a newline-separated list ──────────────────
filter_protected() {
    local raw="$1"
    if [ -z "$PROTECTED" ]; then
        # Nothing to protect against — return as-is
        echo "$raw"
    else
        echo "$raw" | grep -vE "^(${PROTECTED})$" 2>/dev/null || true
    fi
}

# ── Gracefully terminate a named group of processes ──────────────────────────
# Usage: kill_group "Group Label" proc1 proc2 ...
#   1. SIGTERM all matching (non-protected) PIDs
#   2. Wait GRACE_SECS seconds
#   3. SIGKILL any survivors
kill_group() {
    local label="$1"; shift
    local procs=("$@")
    local grace_secs=3
    local group_killed=0
    local had_procs=0

    echo ""
    echo "  ── $label ──"

    # Pass 1: SIGTERM
    for proc in "${procs[@]}"; do
        local pids
        pids=$(pgrep -ix "$proc" 2>/dev/null || true)
        [ -z "$pids" ] && continue

        local safe
        safe=$(filter_protected "$pids")
        [ -z "$safe" ] && continue

        echo "$safe" | xargs -r kill -15 2>/dev/null || true
        had_procs=1
        group_killed=$((group_killed + 1))
        log "SIGTERM → $proc"
    done

    # If anything was found, wait then SIGKILL survivors
    if [ "$had_procs" -eq 1 ]; then
        echo "  [*] Waiting ${grace_secs}s for graceful exit..."
        sleep "$grace_secs"

        for proc in "${procs[@]}"; do
            local pids
            pids=$(pgrep -ix "$proc" 2>/dev/null || true)
            [ -z "$pids" ] && continue

            local safe
            safe=$(filter_protected "$pids")
            [ -z "$safe" ] && continue

            echo "$safe" | xargs -r kill -9 2>/dev/null || true
            log "SIGKILL  → $proc (did not exit in time)"
        done
    else
        log "No running processes found for: $label"
    fi

    log "$label done — $group_killed process name(s) handled"
    TOTAL_KILLED=$((TOTAL_KILLED + group_killed))
}

# ════════════════════════════════════════════════════════════════════════════════
do_enable() {
    require_root

    echo "🔒 Enabling SEB OS-level lockdown..."
    echo "$$" > "${LOCKFILE}.pid"

    # ── 1. SysRq ──────────────────────────────────────────────────────────────
    echo 0 > /proc/sys/kernel/sysrq || true
    log "SysRq disabled"

    # ── 2. Prevent idle/lid/suspend via logind ────────────────────────────────
    if [ -f /etc/systemd/logind.conf ]; then
        cp /etc/systemd/logind.conf /root/seb-logind.conf.bak
        cat >> /etc/systemd/logind.conf <<'LOGIND'

# --- SEB exam lockdown overrides ---
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
IdleAction=ignore
LOGIND
        # NOTE: Do NOT reload logind here (systemctl kill -s HUP systemd-logind).
        # Reloading logind while X11/Wayland is active collapses the display.
        # The on-disk config is read by logind on-demand for lid/suspend events.
        log "logind lid/suspend/idle actions set to ignore (on-disk, no reload)"
    else
        warn "/etc/systemd/logind.conf not found — skipping logind config"
    fi

    # Mask Ctrl+Alt+Del so it cannot reboot the machine during an exam
    systemctl mask ctrl-alt-del.target 2>/dev/null || true
    log "ctrl-alt-del.target masked"

    # ── 3. USB Storage ────────────────────────────────────────────────────────
    echo 'install usb-storage /bin/false' > "$USB_MODPROBE"
    rmmod usb_storage 2>/dev/null || true
    cat > "$UDEV_RULE" <<'EOF'
ACTION=="add", SUBSYSTEMS=="usb", SUBSYSTEM=="block", \
    RUN{program}="/bin/sh -c 'echo 0 > /sys$devpath/authorized'"
EOF
    udevadm control --reload-rules 2>/dev/null || true
    udevadm trigger              2>/dev/null || true
    log "USB storage blocked"

    # ── 4. VT / TTY switching ─────────────────────────────────────────────────

    # 4a. Strip Console_ keys from live keymap in a single sed pass
    if command -v dumpkeys >/dev/null 2>&1 && command -v loadkeys >/dev/null 2>&1; then
        dumpkeys > "$KEYMAP_FILE" 2>/dev/null || true
        # Replace Console_1 … Console_12 with nul in one pass on the saved file
        sed 's/Console_[0-9]\+/nul/g' "$KEYMAP_FILE" | loadkeys 2>/dev/null || true
        log "VT keybindings stripped"
    else
        warn "dumpkeys/loadkeys not found — skipping keymap strip"
    fi

    # 4b. Mask getty on tty2–tty6
    if command -v systemctl >/dev/null 2>&1; then
        for tty in 2 3 4 5 6; do
            systemctl mask --now "getty@tty${tty}.service" 2>/dev/null || true
        done
        log "getty@tty{2-6} masked"
    fi

    # 4c. X11 DontVTSwitch + DontZap
    mkdir -p /etc/X11/xorg.conf.d
    cat > "$XCONF" <<'EOF'
Section "ServerFlags"
    Option "DontVTSwitch" "true"
    Option "DontZap"      "true"
EndSection
EOF
    log "X11 DontVTSwitch + DontZap enabled"

    # ── 5. Network restriction (optional) ────────────────────────────────────
    if [ -n "$EXAM_SERVER_IP" ]; then
        iptables-save > "$IPTABLES_SAVE" 2>/dev/null || true

        # OUTPUT chain: lo → ESTABLISHED → exam IP → DROP
        iptables -I OUTPUT 1 -o lo                                 -j ACCEPT
        iptables -I OUTPUT 2 -m state --state ESTABLISHED,RELATED  -j ACCEPT
        iptables -I OUTPUT 3 -d "$EXAM_SERVER_IP"                  -j ACCEPT
        iptables -I OUTPUT 4                                        -j DROP

        # INPUT chain: lo → ESTABLISHED → exam IP → DROP
        iptables -I INPUT  1 -i lo                                  -j ACCEPT
        iptables -I INPUT  2 -m state --state ESTABLISHED,RELATED   -j ACCEPT
        iptables -I INPUT  3 -s "$EXAM_SERVER_IP"                   -j ACCEPT
        iptables -I INPUT  4                                         -j DROP

        log "Network restricted to $EXAM_SERVER_IP"
    else
        warn "No exam server IP — network NOT restricted"
    fi

    # ── 6. Staged termination of user-space applications ─────────────────────
    echo ""
    echo "  [*] Building protected PID set..."
    PROTECTED=$(get_protected_pids)
    echo "  [*] Protected PIDs: ${PROTECTED:-<none>}"

    # ── Stage 1: Browsers — pkill -9 -f (kills main + all subprocesses) ────────
    # pkill -f matches the full command line, so it catches Firefox/Chrome
    # subprocesses ("Web Content", "GPU Process", "RDD Process", etc.)
    # that pgrep -ix misses.
    echo ""
    echo "  ── Stage 1 — Browsers (pkill -9 -f) ──"
    BROWSER_PATTERNS=(
        firefox chrome chromium google-chrome
        brave brave-browser
        msedge microsoft-edge
        opera vivaldi epiphany
        midori falkon qutebrowser luakit surf
    )
    for bpat in "${BROWSER_PATTERNS[@]}"; do
        local pids
        pids=$(pgrep -if "$bpat" 2>/dev/null || true)
        if [ -n "$pids" ]; then
            local safe
            safe=$(filter_protected "$pids")
            if [ -n "$safe" ]; then
                echo "$safe" | xargs -r kill -9 2>/dev/null || true
                log "SIGKILL (filtered) → $bpat"
            fi
        fi
    done
    # Brief pause then sweep again for any stragglers
    sleep 1
    for bpat in "${BROWSER_PATTERNS[@]}"; do
        local pids
        pids=$(pgrep -if "$bpat" 2>/dev/null || true)
        if [ -n "$pids" ]; then
            local safe
            safe=$(filter_protected "$pids")
            if [ -n "$safe" ]; then
                echo "$safe" | xargs -r kill -9 2>/dev/null || true
            fi
        fi
    done
    log "Stage 1 — All browser processes killed"

    # ── Stage 2: Communications ───────────────────────────────────────────────
    COMMS=(
        firefox
        zoom zoom-us zoomus
        teams ms-teams msteams
        skype skypeforlinux
        discord slack
        telegram telegram-desktop
        whatsapp signal signal-desktop
        element fractal nheko wire threema viber
        mumble teamspeak ts3client
        hexchat pidgin empathy
    )
    kill_group "Stage 2 — Communications" "${COMMS[@]}"

    # ── Stage 3: Remote-access / screen-sharing ───────────────────────────────
    REMOTE=(
        anydesk teamviewer teamviewerd
        remmina xrdp xrdp-sesman
        rdesktop freerdp xfreerdp
        vncviewer tigervnc tightvncserver
        x11vnc krdc vinagre rustdesk
        barrier synergy
    )
    kill_group "Stage 3 — Remote Access" "${REMOTE[@]}"

    # ── Stage 4: Screen recorders / capture tools ─────────────────────────────
    RECORDERS=(
        firefox
        obs obs-studio ffmpeg vlc
        recordmydesktop gtk-recordmydesktop
        simplescreenrecorder kazam vokoscreen
        screenkey peek flameshot scrot
        xvidcap byzanz
    )
    kill_group "Stage 4 — Recorders & Capture" "${RECORDERS[@]}"

    # ── Stage 5: AI clients ───────────────────────────────────────────────────
    AI_CLIENTS=(
        firefox
        chatgpt claude copilot
        lmstudio jan gpt4all msty poe perplexity
    )
    kill_group "Stage 5 — AI Clients" "${AI_CLIENTS[@]}"

    # ── Stage 6: IDEs & editors ───────────────────────────────────────────────
    IDES=(
        firefox
        code vscode vscodium
        idea clion pycharm webstorm goland
        eclipse netbeans atom sublime_text subl
        gedit kate mousepad pluma leafpad
        emacs vim nvim neovide
        jupyter jupyter-notebook jupyter-lab
        spyder rstudio thonny geany brackets
    )
    kill_group "Stage 6 — IDEs & Editors" "${IDES[@]}"

    # ── Stage 7: Document viewers & note-taking ───────────────────────────────
    DOCS=(
        firefox
        libreoffice soffice
        evince okular zathura mupdf
        obsidian notion joplin cherrytree
        xournalpp xournal zotero calibre
        typora ghostwriter
    )
    kill_group "Stage 7 — Docs & Viewers" "${DOCS[@]}"

    # ── Stage 8: Misc (file managers, p2p, network tools, VMs) ───────────────
    MISC=(
        firefox
        nautilus thunar dolphin nemo pcmanfm
        transmission qbittorrent deluge rtorrent
        filezilla lftp
        nm-applet nm-connection-editor
        blueman blueman-manager
        virtualbox vmware virt-manager qemu
        wine wine64 wireshark tcpdump
        nmap netcat
        antigravity
    )
    kill_group "Stage 8 — Miscellaneous" "${MISC[@]}"

    # ── Stop relevant background services cleanly ─────────────────────────────
#      *  Restarting the terminal because the connection to the shell process was lost... 
# oh-my-bash/check_for_upgrade: Failed to get a lock.  Please make sure that no
# other process is trying to update Oh My Bash and remove
    # echo ""
    # echo "  [*] Stopping background services..."
    # for svc in ollama teamviewerd anydesk xrdp vncserver x11vnc; do
    #     if systemctl is-active --quiet "$svc" 2>/dev/null; then
    #         systemctl stop "$svc" 2>/dev/null \
    #             && log "Stopped service: $svc" \
    #             || warn "Could not stop service: $svc"
    #     fi
    # done

    # # ── 9. Active Background Guard ───────────────────────────────────────────
    # # Continuously enforces the lockdown rules while active.
    # echo ""
    # echo "  [*] Launching background AV device and screen recorder guard..."
    # (
    #     while [ -f "${LOCKFILE}.pid" ]; do
    #         # 1. Kill unauthorized hardware device access (Mic/Webcam)
    #         local dev_pids
    #         dev_pids=$(fuser /dev/video* /dev/snd/pcmC*c 2>/dev/null | grep -oEe '[0-9]+' | sort -u || true)
    #         if [ -n "$dev_pids" ]; then
    #             local unauthorized
    #             unauthorized=$(filter_protected "$dev_pids")
    #             if [ -n "$unauthorized" ]; then
    #                 echo "$unauthorized" | xargs -r kill -9 2>/dev/null || true
    #             fi
    #         fi

    #         # 2. Re-sweep for unauthorized applications (Screen Recorders, Browsers, etc.)
    #         for bpat in "${BROWSER_PATTERNS[@]}" "${COMMS[@]}" "${REMOTE[@]}" "${RECORDERS[@]}" "${AI_CLIENTS[@]}" "${IDES[@]}" "${DOCS[@]}" "${MISC[@]}"; do
    #             local pids
    #             pids=$(pgrep -if "$bpat" 2>/dev/null || true)
    #             if [ -n "$pids" ]; then
    #                 local safe
    #                 safe=$(filter_protected "$pids")
    #                 if [ -n "$safe" ]; then
    #                     echo "$safe" | xargs -r kill -9 2>/dev/null || true
    #                 fi
    #             fi
    #         done

    #         sleep 3
    #     done
    # ) &
    # disown

    echo ""
    log "All kill stages complete — $TOTAL_KILLED process name(s) terminated in total"

    echo ""
    echo "✅ OS lockdown active."
    [ -n "$EXAM_SERVER_IP" ] \
        && echo "   Network : only $EXAM_SERVER_IP permitted." \
        || echo "   Network : unrestricted (no exam IP supplied)."
    echo "   Lid/sleep: suppressed via logind."
    echo "   USB      : blocked."
    echo "   VT switch: disabled."
    echo "   Ctrl+Alt+Del: masked."
}

# ════════════════════════════════════════════════════════════════════════════════
do_disable() {
    require_root
    if ! already_enabled; then
        warn "No active lockdown detected. Continuing cleanup anyway..."
    fi

    echo "🔓 Disabling SEB OS-level lockdown..."

    # 1. Restore logind
    # Reloading logind while an X/Wayland session is active drops session
    # tracking and collapses the display. Only send SIGHUP when it is safe.
    _logind_reload_safe() {
        [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] || return 1
        loginctl list-sessions --no-legend 2>/dev/null \
            | awk '{print $3}' | grep -qiE '^(x11|wayland|mir)$' && return 1
        return 0
    }
    if [ -f /root/seb-logind.conf.bak ]; then
        cp /root/seb-logind.conf.bak /etc/systemd/logind.conf
        rm -f /root/seb-logind.conf.bak
    else
        # Fallback: strip the appended block
        if [ -f /etc/systemd/logind.conf ]; then
            sed -i '/^# --- SEB exam lockdown overrides ---/,/^IdleAction=ignore/d' \
                /etc/systemd/logind.conf 2>/dev/null || true
        else
            warn "No logind backup found and logind.conf missing — skipping"
        fi
    fi
    # ── NEVER reload logind — doing so collapses the display ─────────────
    # The on-disk restore is picked up automatically on next login.
    warn "logind reload skipped to protect the display — changes take effect on next login."
    log "logind.conf restored (on-disk)"

    # 2. Restore SysRq
    echo 1 > /proc/sys/kernel/sysrq || true
    log "SysRq restored"

    # 3. Unmask Ctrl+Alt+Del
    systemctl unmask ctrl-alt-del.target 2>/dev/null || true
    log "ctrl-alt-del.target unmasked"

    # 4. Unblock USB
    rm -f "$USB_MODPROBE" "$UDEV_RULE"
    udevadm control --reload-rules 2>/dev/null || true
    modprobe usb-storage 2>/dev/null && log "usb-storage reloaded" || true

    # 5. Restore VT keybindings
    if [ -f "$KEYMAP_FILE" ] && command -v loadkeys >/dev/null 2>&1; then
        loadkeys "$KEYMAP_FILE" 2>/dev/null && log "Keymap restored" || warn "loadkeys failed"
        rm -f "$KEYMAP_FILE"
    else
        warn "Keymap backup not found or loadkeys unavailable — skipping"
    fi

    # 6. Unmask and restart getty
    if command -v systemctl >/dev/null 2>&1; then
        for tty in 2 3 4 5 6; do
            systemctl unmask "getty@tty${tty}.service" 2>/dev/null || true
            systemctl start  "getty@tty${tty}.service" 2>/dev/null || true
        done
        log "getty@tty{2-6} restored"
    fi

    # 7. Remove X11 VT restriction
    rm -f "$XCONF"
    log "X11 VT restrictions removed"

    # 8. Restore iptables
    if [ -f "$IPTABLES_SAVE" ]; then
        iptables-restore < "$IPTABLES_SAVE" 2>/dev/null \
            && log "iptables restored" \
            || warn "iptables restore failed — check manually"
        rm -f "$IPTABLES_SAVE"
    else
        warn "No iptables backup found — flushing rules and setting ACCEPT policy"
        iptables -F INPUT  2>/dev/null || true
        iptables -F OUTPUT 2>/dev/null || true
        iptables -P INPUT  ACCEPT 2>/dev/null || true
        iptables -P OUTPUT ACCEPT 2>/dev/null || true
    fi

    # 9. Cleanup lockfile
    rm -f "${LOCKFILE}.pid"

    echo ""
    echo "✅ OS lockdown deactivated. System is back to normal."
}

# ════════════════════════════════════════════════════════════════════════════════
do_status() {
    if already_enabled; then
        echo "🔒 Lockdown : ACTIVE  (pid: $(cat "${LOCKFILE}.pid" 2>/dev/null))"
    else
        echo "🔓 Lockdown : INACTIVE"
    fi

    echo ""
    echo "   SysRq          : $(cat /proc/sys/kernel/sysrq 2>/dev/null || echo 'unknown')"
    echo "   USB block       : $([ -f "$USB_MODPROBE" ] && echo "YES" || echo "no")"
    echo "   VT X11 cfg      : $([ -f "$XCONF" ]        && echo "YES" || echo "no")"
    echo "   iptables backup : $([ -f "$IPTABLES_SAVE" ] && echo "$IPTABLES_SAVE" || echo "not saved")"
    echo "   Ctrl+Alt+Del    : $(systemctl is-enabled ctrl-alt-del.target 2>/dev/null || echo 'unknown')"
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "${1:-}" in
    enable)  do_enable  ;;
    disable) do_status ;;
    status)  do_status  ;;
    *)
        echo "Usage: $0 {enable [exam_server_ip] | disable | status}"
        exit 1
        ;;
esac