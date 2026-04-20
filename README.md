<div align="center">
  <img src="src/assets/icon.png" alt="SEB Logo" width="120" height="120" />
  <h1>Safe Examination Browser (SEB)</h1>
  <p><strong>The Ultimate Open-Resource Proctoring & Secure Kiosk Sandbox</strong></p>

  <p>
    <a href="https://github.com/iitroorkee/seb"><img src="https://img.shields.io/badge/Release-v1.0.0-blue.svg" alt="Release Version"></a>
    <img src="https://img.shields.io/badge/Node.js-v20+-47848f?style=flat&logo=node.js" alt="Node.js">
    <img src="https://img.shields.io/badge/Built%20With-Electron%2041.2.1-47848f?style=flat&logo=electron" alt="Electron">
    <img src="https://img.shields.io/badge/Database-SQLite3%20%2B%20AES256-green.svg" alt="Database">
    <img src="https://img.shields.io/badge/Platform-Linux%20%7C%20Windows-lightgrey.svg" alt="Platform">
  </p>
</div>

---

## 📖 Comprehensive Table of Contents
1. [The Problem Statement & The SEB Solution](#1-the-problem-statement--the-seb-solution)
2. [Executive Features Breakdown & Novelty](#2-executive-features-breakdown--novelty)
3. [Deep Architectural Analysis (The Ring Model)](#3-deep-architectural-analysis-the-ring-model)
4. [Exhaustive Code & Folder Analysis](#4-exhaustive-code--folder-analysis)
   - [The Orchestrator (`/src/main/`)](#the-orchestrator-srcmain)
   - [The Enforcers (`/src/monitor/`)](#the-enforcers-srcmonitor)
   - [The Vault (`/src/database/`)](#the-vault-srcdatabase)
   - [The Gatekeeper (`/src/proxy/`)](#the-gatekeeper-srcproxy)
   - [The Interface (`/src/renderer/`)](#the-interface-srcrenderer)
   - [OS Shell Hooks (`/scripts/`)](#os-shell-hooks-scripts)
5. [In-Depth Security Protocols](#5-in-depth-security-protocols)
6. [Database Schema & Cryptography](#6-database-schema--cryptography)
7. [Installation, Build, & Execution Guide](#7-installation-build--execution-guide)
8. [Comprehensive User Workflows](#8-comprehensive-user-workflows)
9. [Screenshots of the System](#9-screenshots-of-the-system)
10. [Software Engineering Methodology](#10-software-engineering-methodology)
11. [Future Roadmap & Conclusions](#11-future-roadmap--conclusions)

---

## 1. The Problem Statement & The SEB Solution

### ⚠️ The Problem Vector
The shift to remote testing has exposed severe vulnerabilities in traditional browser-based proctoring. Modern cheating methods trivially bypass standard Chrome extensions or lightweight lockdown browsers. 
* **The "Alt-Tab" / "Workspace Switch" Vector:** Test takers rapidly switch to a secondary Virtual Desktop to invoke ChatGPT or reference material.
* **The "Virtual Machine" Layer:** Savvy students run the examination software *inside* an isolated VirtualBox environment, while utilizing the host machine perfectly untouched to communicate via Discord.
* **The "Hardware Injection" Vector:** Students plug in hidden USB rubber ducky keystroke injectors or pre-loaded mass storage drives after the exam begins.
* **The "Black-Box" Limitations:** Commercial tools enforce "block-everything" protocols. If a university wishes to proctor an exam where students are *allowed* to use Wikipedia, standard lockdown browsers fail because they cannot intelligently selectively whitelist domains based on dynamic rules.

### 🛡️ The SEB Solution
**Safe Examination Browser (SEB)** is built upon the ideology of **"Trust through Immediate Sterilization."** 
Instead of relying on browser-level warnings, SEB utilizes Electron coupled with strict `root` Linux shell hooks. It actively drops the OS into a hardened Kiosk Mode, suppresses GNOME/KDE taskbars, forcibly unmounts `usb-storage` kernel drivers, intercepts network requests through an internal TCP node-proxy for regex-based URL filtering, records an encrypted PiP (Picture-in-Picture) 30FPS composite webcam stream, and pipes every micro-violation into a local SQLite database layered with an unbreakable AES-256 Hash Chain.

---

## 2. Executive Features Breakdown & Novelty

### 🚀 Core Novelty & Innovations
The distinguishing aspect of this system lies not merely in the collection of restriction features, but in the architecture that ties them together:
* **Layered Security Architecture:** Rather than relying on a single enforcement mechanism, the system employs multiple independent rings. If a keyboard shortcut slips through the DOM, the external network proxy and C++ OS hooks still hold the perimeter securely.
* **Policy-Driven Control via JSON:** Security rules are completely decoupled from enforcement logic. Administrators can inject dynamic JSON configs to hot-reload blocking behaviors on active machines.
* **Dynamic Network Isolation:** We abandoned `/etc/hosts` DNS poisoning entirely for a far superior localized proxy routing engine, analyzing raw HTTP `CONNECT` methodologies.
* **Runtime Behavioral Adaptation:** The active observer doesn't just block issues—it creates temporal heat-maps of candidate offenses. Rapid consecutive blur-events trigger automated escalations rather than static responses.

### ⚙️ Executive Features 
1. **Native OS Kiosk Sterilization:** Binds the window manager completely. Hooks Linux `gsettings` to destroy the Super/Meta key overlay, forces `AlwaysOnTop`, blocks TTY (Ctrl+Alt+F2) switching, and disables SysRq panic reboots.
2. **Aggressive VM & Unauthorized Process Hunting:** Continuous background polling looking for Discord, OBS, Slack, Chrome, IDEs. Instantly issues `kill -9` signals without prompt. Automatically identifies environments like VMware, QEMU/KVM, Hyper-V, and VirtualBox by scanning `/sys/class/dmi/id/product_name` and CPU hypervisor flags.
3. **Forensic Ledger DB:** Every mouse blur, every network violation, every blocked snippet of keyboard macro code is piped into the data layer. A continuous SHA-256 rolling hash binds each row to the previous, guaranteeing any manual deletion of a log breaks the chain and illuminates corruption for an Administrator.
4. **Live-Compositing Video Engine:** Fetches 1080p Webview Canvas elements alongside 720p HD Webcams using WebRTC. Blends them inside HTML5 canvas with millisecond timestamps dynamically and converts the stream to `.webm` Blob chunks to bypass memory bottlenecks.
5. **Real-time Admin Hot-Reload:** Policy rules (like `allowedDomains` or `forbiddenProcesses`) are edited via a dark-mode JSON dashboard. Hitting save securely re-encrypts the policy in SQLite and hot-reloads the running Node proxies instantly.

---

## 3. Deep Architectural Analysis (The Ring Model)

Because SEB handles highly untrusted user actions (e.g., executing JavaScript inside `webview` contexts), lateral movement must be avoided at all costs. SEB abstracts privilege using a concentric Ring Model:

* **Ring 0 — Root OS (`lockdown.sh`)**: The most privileged environment. Disables the `systemd` logind sleep calls, overwrites IP-tables if network restriction is enabled, and modifies the UDEV rules specifically to kill active USB mass storage authorizations exactly when the start sequence is invoked. 
* **Ring 1 — Internal Domain Proxy**: Operating on `127.0.0.1:18080`, this serves as the routing gateway. Evaluates `CONNECT` methodologies. Web sockets are filtered; allowed lists are checked entirely prior to DNS resolution, mitigating host-file attacks.
* **Ring 2 — The Node.js Orchestrator (`main.js`)**: Employs `process.env.ELECTRON_RUN_AS_NODE` bans. Injects native filesystem hooks. Spawns the AES cipher engines, operates `better-sqlite3`, manages IPC sockets, and dictates application lifecycles.
* **Ring 3 — Context Isolation (`preload.js`)**: The Electron ContextBridge. Strips the HTML renderer of raw `fs` or `child_process` requirements. Translates strictly `window.seb.login()` variables to IPC calls. 
* **Ring 4 — The Renderer UI**: The CSS-Grid driven `index.html`. Handles real-time video compositing, layout formatting, active login tokens, and UI events. This is completely disposable. If compromised via XSS, it cannot breach Ring 2.

---

## 4. Exhaustive Code & Folder Analysis

The project hierarchy separates the core monitoring engines from UI modules effectively minimizing the attack surface.

### The Orchestrator (`/src/main/`)
* **`main.js`**: The colossal entry point.
  * *Initialization Sequence:* It first checks `remote-debugging-port` to deny developer-mode tampering.
  * *Anti-Key Hooks:* Includes dynamic `gsettings set org.gnome.mutter overlay-key ''` execution arrays to strip GNOME of its GUI shell operations. 
  * *Elevation Sequence:* Deploys `pkexec bash scripts/lockdown.sh` dynamically upon boot, projecting a "Securing Environment" HTML element OVER the active DOM so the user cannot interact with the desktop while privileges evaluate.
* **`ipc-handlers.js`**: Manages all `ipcMain.handle` boundaries for policy requests, SQLite inserts, and Window Manager signals.
* **`shortcut-blocker.js`**: Intercepts generic `Alt+Tab`, `Alt+F4`, `Ctrl+C` via electron `globalShortcut.register` loops.

### The Enforcers (`/src/monitor/`)
* **`process-monitor.js`**: Evaluates operating systems dynamically. If `linux`, runs `ps -eo comm,pid --no-headers`; if `win32`, runs `tasklist /FO CSV /NH`. Loops over `forbiddenProcesses` policies. Tracks *Kill Counts*. If a process like `discord` res-spawns 3 times, triggers an `ALERT` escalation automatically. Contains the hardcore array of `systemd-detect-virt` logic for Hypervisor checking.
* **`clipboard-monitor.js`**: Periodically forces `clipboard.clear()` to absolutely deny cross-app copy/paste functionality.
* **`activity-monitor.js`**: The escalation matrix. Funnels normal events safely, elevates blurs to Warnings, and pushes unauthorized window injections directly to `TERMINATE`.
* **`focus-monitor.js`**: Rebounds window focus. If an underlying OS popup steals the user's cursor, the monitor aggressively brings SEB `focus()` back under 100 milliseconds.

### The Vault (`/src/database/`)
* **`db.js`**: Handles schemas. The `_encrypt(plaintext)` block generates a random 16-byte `crypto.randomBytes(16)` Initial Vector (IV), routes into `aes-256-gcm`, assigns the `authTag`, and writes to SQLite. Generates `sha256` password salts naturally on user-creation. Provides all CRUD and ledger-verification logic (`verifyLogIntegrity`).

### The Gatekeeper (`/src/proxy/`)
* **`proxy-server.js`**: Establishes a raw `http.createServer()`. Handles standard requests directly, but uses the `CONNECT` interface to govern HTTPS pipes. Compares `req.url` hostings against `config.allowedDomains` (e.g. `*.github.com, wikipedia.org`). Forwards active `net.Socket` to port 443 if allowed, forcibly `socket.end('HTTP/1.1 403 Forbidden')` if denied.

### The Interface (`/src/renderer/`)
* **`renderer.js`**: A masterclass in front-end manipulation.
  * *Video Compositing Engine:* It calls `navigator.mediaDevices.getUserMedia` fetching desktop stream and webcam streams. Uses a virtual `canvas` running `requestAnimationFrame` at 30 FPS to draw the primary desktop output utilizing `ctx.drawImage` while pasting a 320x240 WebCam stream squarely in the corner with a red stroke overlay. It simultaneously stamps an immutable digital `Date().toLocaleString()` and "Remaining Time" clock directly onto the video frames prior to piping via `MediaRecorder`.
  * *State Switching:* Handles the visual translation of login to proxy-dashboards seamlessly. 
* **`lockdown.js`**: Injected immediately upon page transition. Overrides `<body oncontextmenu="return false;">`, and forcibly hooks DOM `copy`, `cut`, `paste`, `dragstart`, stopping text-highlight leakage.

### OS Shell Hooks (`/scripts/`)
* **`lockdown.sh`**: Heavy-handed daemon executed as Root.
  * Blocks Kernel `SysRq`.
  * Re-routes logind events preventing lid-shut suspensions.
  * Aliases `install usb-storage /bin/false` and runs `udevadm control` to freeze peripheral additions.
  * Edits `xorg.conf.d` applying purely mathematical `DontVTSwitch` and `DontZap`.
  * Iterates completely through massive arrays spanning from `obs`, `wireshark`, `qbittorrent`, to AI clients like `lmstudio` and IDEs (`pycharm`, `code`), executing ruthless `pkill -9 -f` algorithms instantly.
* **`restore.sh`**: Safely unwinds these policies without bricking the local Desktop environment upon test closure.

---

## 5. In-Depth Security Protocols

The layered protections within SEB form a hardened envelope.

* **Anti-Circumvention Kiosk Mode**: We utilize Chromium's native `kiosk` flags but enhance it with Window Manager overrides to stop "Overlay shell" environments from triggering if the Windows/Super key is manipulated.
* **WebRTC PiP Monitoring**: We actively stream both the User's behavior and the Desktop behavior without sending it to a remote API. Storing it as discrete `chunks` bypassing native v8 `Blob` memory saturation issues locally.
* **Continuous Proxy Network Isolation**: Rather than doing unreliable `/etc/hosts` poisoning which fails to address raw-IP connections, SEB implements a local Proxy inside Electron, actively checking connection targets against the `policy.json` whitelist, creating a true Intranet experience inside the Wild Web.
* **Robust Hardware Management**: `udev` rules explicitly disable new block-level devices post-boot. You cannot cheat using a thumb drive.

---

## 6. Database Schema & Cryptography

SEB guarantees data integrity using local block-ledgering logic directly inside SQLite (`/data/seb.db`).

### Encrypted AES-256-GCM Storage
Logs and policies are not stored in plaintext. They are passed directly through the application's master key into a cipher stream.

### The Hash-Chain Ledger Protocol 
Every record inside the `logs` table has a `hash`.
**Algorithm:** `Hash = SHA256 ( previous_hash + timestamp + log_level + module + encrypted_data )`
If Row #35 is tampered with or deleted manually by the student using a DB browser, the `previous_hash` expected by Row #36 will instantly misalign. During an admin's audit inside the dashboard, clicking **"Verify Log Integrity"** evaluates this chain sequentially. Once it fails, SEB flashes red and points precisely to the tampered row index.

### Primary SQLite Tables
- **Users**: `id` | `username` | `password_hash` (sha256) | `salt` | `role` (student/admin)
- **Exams**: `exam_id` | `title` | `duration` | `external_url`
- **Logs**: `user_id` | `level` | `module` | `encrypted_data` | `iv` | `auth_tag` | `hash`
- **Policies (Hot-Reload Configuration)**: `name` | `encrypted_policy` | `iv` | `auth_tag` | `hash` 

---

## 7. Installation, Build, & Execution Guide

SEB utilizes `electron-builder` optimized predominantly for Linux Desktop architectures (Ubuntu, Debian, Fedora), though it contains targets for `win32`. Native Node C++ binding compilation relies heavily on standard toolchains.

### Environment Requirements
- **Node.js** (v20 or higher recommended)
- **Python 3** & **Build-Essential (C++ headers)** for `better-sqlite3` bindings execution.
- System tools: `gsettings`, `pgrep`, `udevadm`, `iptables`.

### Compilation & Build 
```bash
# 1. Clone Source
git clone https://github.com/iitroorkee/seb.git
cd seb

# 2. Extract Dependencies 
# Note: Ensure you are not running this as root during install!
npm install

# 3. Compile Architecture Build
npm run build
```
The output lands in `/dist/`. This generates a strictly optimized `seb_1.0.0_amd64.deb` Debian package and an `.AppImage` binary. 
`sudo apt install -y ./dist/seb_1.0.0_amd64.deb` will map the binary perfectly into the system environment variables.

### Local Development / Debugging Execution
To run locally without producing a bundled `.deb`:
```bash
npm run start
```
*Note: Secure mode involving `pkexec` and `lockdown.sh` requires starting via `npm run start:secure`.*

---

## 8. Comprehensive User Workflows

### 👨‍🎓 Operations: The Student Protocol
1. Launch SEB. The screen instantly maximizes, blinding the rest of the OS.
2. A generic Linux `Authentication` UI spawns requiring root acceptance. The `lockdown.sh` executes. Screen recordings commence. 
3. User logs in utilizing `student1` | `exam2026` against salted credentials.
4. User selects "Start Exam". They navigate only towards explicitly permitted hubs (e.g. Codeforces). Opening a tab to an unlisted `discord.com` throws a "403 Network Blocked" warning while internally recording a metric to the DB.
5. Upon session conclusion, the encrypted hash-chains are validated locally, the background screen-composite `webm` video downloads silently into the local directory, and `restore.sh` breaks down the Kiosk mode safely.

### 👮 Operations: The Admin / Proctor Protocol
1. Admin logs in using elevated roles (`admin1` | `admin2026`).
2. SEB bypasses the exam portal entirely and drops into the **Admin Dashboard**.
3. **Log Engine:** Admin selects a User from the Dropdown. SEB instantly runs AES-256 Decryption natively locally, spilling all events accurately on-screen formatted by severity (Red for process injections, Blue for general network traffic). 
4. **Policy Engine Live Editor:** An embedded code editor displays `policy.json`. A proctor edits `maxFocusLosses: 3` to `5`, clicks 'Save'. SEB flashes a hot-reload IPC update. Active proxy layers instantly fetch the newest limitations without reloading the system, all while storing the previous policy inside the `policies` SQLite log.

---

## 9. Screenshots of the System

This section showcases the UI visualization of the application under various operational conditions.
*(System Screenshots placeholder — integrate appropriate image files during production deployment)*
1. **The Lockdown Boot Splashtop**: Showcasing the `pkexec` root elevation request and system sealing operations.
2. **Student Examination Hub**: Displaying the Picture-in-Picture running live with the active webview proxying external exams safely.
3. **Admin Dashboard (Hash Ledger)**: Capturing the decrypted SQLite viewer proving internal forensic capability. 
4. **Active Violation Escalation**: Illuminating the red-flash "TERMINATING SESSION" sequence when consecutive anomalies stack limit thresholds.

---

## 10. Software Engineering Methodology

Developing a dual-layer OS and Application security system required strict Software Development Life Cycle (SDLC) adherence.
1. **Iterative Agile Evolutionary Development**: We split the development into continuous, deliverable milestones. Ring 0 shell hooks, the proxy server, the UI, and the cryptographic layers were developed as independent modules, subsequently integrated in progressive evolutions.
2. **Pair Programming in Security Ecosystems**: Crucial integrations (e.g., SQLite AES encryption keys, root IPC handoffs) utilized structured Pair Programming to guarantee bugs didn't create secondary exploits.
3. **Modular CI/CD Design**: The usage of `electron-builder` allowed identical build outputs across Linux environments consistently without breaking paths, making the integration lifecycle completely automated across `npm run build` scripts.

---

## 11. Future Roadmap & Conclusions

This system guarantees profound trust in BYOD (Bring Your Own Device) environments where an institution demands robust evidence-based proctoring rather than intrusive network snooping.
* **eBPF System Transitions:** We aim to migrate from `ps -eo` polling intervals to utilizing direct kernel `eBPF` observability. This would allow zero-latency hooking of `execve` kernel queries to nuke cheat-clients natively instead of relying on a Javascript Node interval latency.
* **Enterprise Cloud Connect:** Abstracting the database cryptology away from local `/data/seb.db` and linking SEB to dedicated GraphQL kubernetes-managed websockets, centralizing logging arrays across populations ranging in the tens of thousands automatically! 
* **Embedded AI:** Injecting ONNX WASM models onto the Renderer stream. Detecting cell-phones or gaze tracking dynamically entirely on the device CPU without requiring massive video uploads.

---

<div align="center">
  <p><strong>Designed and Architected by Group 13, Indian Institute of Technology Roorkee (IITR)</strong></p>
  <p><i>Building uncompromising digital sanctuaries for absolute analytical assessment.</i></p>
  
  ### 👥 Group 13 Development Team
  | Name | Enrollment No. | Primary Role / Contribution | Contact Email |
  |------|---------------|-------------------------------|---------------|
  | **Akshat Srivastava** | `24114010` | Lead Architecture & OS Hooks | `asrivastava@CS.iitr.ac.in` |
  | **Shubham Singla** | `24114093` | Proxy & Network Isolation | `ssingla@CS.iitr.ac.in` |
  | **Yash Jain** | `24114108` | Database Crypto & Hash-Chaining | `yjain@CS.iitr.ac.in` |
  | **Pushkar Jain** | `24114071` | Video Compositing & Electron UI | `pjain@CS.iitr.ac.in` |
  | **Aditya Yadav** | `24114007` | Process Monitor & Escalation Engine | `ayadav@CS.iitr.ac.in` |
  | **Divyanshu Meena** | `24114034` | Policy Engine & Admin Dashboard | `dmeena@CS.iitr.ac.in` |

</div>
