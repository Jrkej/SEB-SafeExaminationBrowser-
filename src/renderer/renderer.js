// ============================================================
// SEB — Renderer Logic
// Handles UI: login, exam list, exam, admin dashboard.
// ============================================================

(function () {
    'use strict';

    // ---- State ----
    // ---- Global State ----
    let currentUser = null;
    let currentExam = null;
    let examTimer = null;
    let remainingSeconds = 0;
    let examAnswers = {};
    let currentMediaRecorder = null;
    let recordedChunks = [];
    let screenRecorder = null;
    let screenChunks = [];
    let webcamRecorder = null;
    let webcamChunks = [];

    // ---- Page Management ----
    function showPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const page = document.getElementById(`page-${pageId}`);
        if (page) page.classList.add('active');
    }

    // ---- Login ----
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('login-id').value.trim();
        const password = document.getElementById('login-password').value;
        const btn = document.getElementById('login-btn');

        btn.disabled = true;
        btn.querySelector('span').textContent = 'Signing in...';
        loginError.classList.add('hidden');

        try {
            const result = await window.seb.login(id, password);

            if (result.success) {
                currentUser = result;
                if (result.role === 'admin') {
                    showPage('admin');
                    initAdminDashboard();
                } else {
                    document.getElementById('student-name').textContent = result.name || result.id;
                    showPage('exam-list');
                    loadExamList();
                }
            } else {
                loginError.textContent = result.error || 'Invalid credentials';
                loginError.classList.remove('hidden');
                shakeElement(loginForm);
            }
        } catch (err) {
            console.error('Login Error:', err);
            loginError.textContent = 'Connection error: ' + err.message;
            loginError.classList.remove('hidden');
        }

        btn.disabled = false;
        btn.querySelector('span').textContent = 'Sign In';
    });

    // Allow Enter key in login form
    document.getElementById('login-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loginForm.dispatchEvent(new Event('submit'));
    });

    // ---- Logout ----
    document.getElementById('btn-logout')?.addEventListener('click', logout);
    document.getElementById('btn-admin-logout')?.addEventListener('click', logout);

    function logout() {
        currentUser = null;
        currentExam = null;
        if (examTimer) clearInterval(examTimer);
        document.getElementById('login-id').value = '';
        document.getElementById('login-password').value = '';
        showPage('login');
        document.getElementById('session-indicator').classList.add('hidden');
    }

    // ---- Exam List ----
    async function loadExamList() {
        const container = document.getElementById('exam-cards-container');
        container.innerHTML = '<p class="loading-text">Loading exams...</p>';

        try {
            const exams = await window.seb.getExams();

            if (exams.length === 0) {
                container.innerHTML = '<p class="empty-text">No exams assigned to you at this time.</p>';
                return;
            }

            container.innerHTML = exams.map(exam => `
        <div class="exam-card" data-id="${exam.id}">
          <div class="exam-card-header">
            <h3>${exam.title}</h3>
            <span class="exam-status status-${exam.status}">${exam.status}</span>
          </div>
          <div class="exam-card-body">
            <div class="exam-meta">
              <span>📅 ${exam.date}</span>
              <span>⏱️ ${exam.duration} min</span>
              <span>📝 ${exam.questions} questions</span>
            </div>
          </div>
          <div class="exam-card-footer">
            <button class="btn-primary btn-start-exam" data-id="${exam.id}" data-title="${exam.title}" data-duration="${exam.duration}"
              ${exam.status !== 'available' ? 'disabled' : ''}>
              ${exam.status === 'available' ? 'Start Exam' : exam.status === 'completed' ? 'Completed' : 'Upcoming'}
            </button>
          </div>
        </div>
      `).join('');

            // Attach event listeners
            container.querySelectorAll('.btn-start-exam').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (!btn.disabled) {
                        startExam(btn.dataset.id, btn.dataset.title, parseInt(btn.dataset.duration));
                    }
                });
            });

            // External URL loader
            document.getElementById('btn-load-external')?.addEventListener('click', () => {
                let url = document.getElementById('external-url-input').value.trim();
                let mins = parseInt(document.getElementById('external-url-duration')?.value) || 120;
                if (url) {
                    if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                    }
                    startExam('external', 'External Exam Portal', mins, url, true);
                }
            });
        } catch (err) {
            container.innerHTML = '<p class="error-text">Failed to load exams. Please try again.</p>';
        }
    }

    // ---- Exam Session ----
    async function startExam(examId, title, durationMinutes, customUrl = null, requireManualStart = false) {
        try {
            currentExam = { id: examId, title, duration: durationMinutes };
            examAnswers = {};

            document.getElementById('session-indicator').classList.remove('hidden');

            // Always show Start Exam button — user clicks it to begin timer + recording
            document.getElementById('session-status-text').textContent = 'Prep Phase — Click Start Exam when ready';
            const startBtn = document.getElementById('btn-start-loaded-exam');
            if (startBtn) startBtn.style.display = 'block';
            const recStatus = document.getElementById('exam-recording-status');
            if (recStatus) recStatus.style.display = 'none';

            // Create exam webview
            const container = document.getElementById('exam-webview-container');
            container.innerHTML = '';

            const webview = document.createElement('webview');
            webview.id = 'exam-webview';
            webview.src = customUrl || 'pages/exam-content.html';
            webview.style.cssText = 'width: 100%; height: 100%; display: flex; flex: 1;';
            webview.setAttribute('allowpopups', 'false');
            container.appendChild(webview);

            // Update title for external URLs
            if (customUrl) {
                try {
                    const titleDisplay = document.getElementById('exam-title-display');
                    if (titleDisplay) titleDisplay.textContent = new URL(customUrl).hostname;
                } catch { }
            }

            // Browser Controls wiring
            const urlBar = document.getElementById('browser-url-bar');

            document.getElementById('btn-browser-back')?.addEventListener('click', () => {
                if (webview.canGoBack()) webview.goBack();
            });
            document.getElementById('btn-browser-forward')?.addEventListener('click', () => {
                if (webview.canGoForward()) webview.goForward();
            });
            document.getElementById('btn-browser-reload')?.addEventListener('click', () => {
                webview.reload();
            });
            document.getElementById('btn-browser-go')?.addEventListener('click', () => {
                let url = urlBar.value.trim();
                if (url) {
                    if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                    }
                    webview.loadURL(url);
                }
            });
            urlBar?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') document.getElementById('btn-browser-go')?.click();
            });

            // Navigation control on webview
            webview.addEventListener('did-start-navigation', async (e) => {
                if (urlBar) urlBar.value = e.url; // Update UI address bar

                if (e.url && !e.url.startsWith('file://') && e.url !== 'about:blank') {
                    const allowed = await window.seb.checkUrlAllowed(e.url);
                    if (!allowed) {
                        webview.stop();
                        window.seb.reportViolation('NAVIGATION_BLOCKED', { url: e.url });
                    }
                }
            });

            webview.addEventListener('did-navigate', (e) => {
                if (urlBar) urlBar.value = e.url;
            });
            webview.addEventListener('did-navigate-in-page', (e) => {
                if (urlBar) urlBar.value = e.url;
            });

            // Keyboard capture inside webview
            webview.addEventListener('dom-ready', () => {
                webview.executeJavaScript(`
                    document.addEventListener('keydown', (e) => {
                        console.log("SEB_KEYPRESS: " + e.key);
                    });
                `);
            });

            // Read the console messages from webview to capture keys
            webview.addEventListener('console-message', (e) => {
                if (e.message.startsWith('SEB_KEYPRESS: ')) {
                    const key = e.message.substring(14);
                    // Use reportViolation as a generic IPC event logger 
                    window.seb.reportViolation('KEYPRESS', { key });
                }
            });

            // Set up explicit "Start Exam" hook
            document.getElementById('btn-start-loaded-exam').onclick = async () => {
                document.getElementById('btn-start-loaded-exam').style.display = 'none';
                document.getElementById('exam-recording-status').style.display = 'flex';
                document.getElementById('session-status-text').textContent = 'Exam Active';

                const result = await window.seb.startExam(currentExam.id);
                if (!result.success) return;

                remainingSeconds = currentExam.duration * 60;
                startTimer();

                // Start Screen Video Capture Compositing
                try {
                    const sourceId = await window.seb.getDesktopSource();
                    let screenStream = null;
                    let webCamStream = null;

                    if (sourceId) {
                        screenStream = await navigator.mediaDevices.getUserMedia({
                            audio: false,
                            video: {
                                mandatory: {
                                    chromeMediaSource: 'desktop',
                                    chromeMediaSourceId: sourceId,
                                    minWidth: 1280,
                                    minHeight: 720
                                }
                            }
                        });
                    }

                    try {
                        webCamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    } catch (e) {
                        console.warn("No webcam found.");
                    }

                    if (screenStream || webCamStream) {
                        const canvas = document.createElement('canvas');
                        canvas.width = 1280;
                        canvas.height = 720;
                        const ctx = canvas.getContext('2d');

                        const screenVideo = document.createElement('video');
                        screenVideo.muted = true;
                        screenVideo.autoplay = true;
                        if (screenStream) screenVideo.srcObject = screenStream;

                        const webCamVideo = document.getElementById('webcam-video');
                        if (webCamStream && webCamVideo) {
                            webCamVideo.srcObject = webCamStream;
                            // Don't show webcam preview on screen — it records silently
                        }

                        const drawFrame = () => {
                            ctx.fillStyle = '#000';
                            ctx.fillRect(0, 0, canvas.width, canvas.height);

                            // Draw Screen
                            if (screenStream && screenVideo.readyState >= 2) {
                                ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
                            }

                            // Draw Webcam PIP (top right)
                            if (webCamStream && webCamVideo && webCamVideo.readyState >= 2) {
                                const pipWidth = 320;
                                const pipHeight = 240;
                                ctx.drawImage(webCamVideo, canvas.width - pipWidth - 20, 20, pipWidth, pipHeight);
                                ctx.strokeStyle = 'red';
                                ctx.lineWidth = 4;
                                ctx.strokeRect(canvas.width - pipWidth - 20, 20, pipWidth, pipHeight);
                            }

                            // Draw Timestamp and Timer Overlay
                            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                            ctx.fillRect(20, 20, 420, 90);

                            ctx.fillStyle = '#fff';
                            ctx.font = '24px monospace';
                            const ts = new Date().toLocaleString();
                            ctx.fillText(`Time: ${ts}`, 40, 50);

                            if (remainingSeconds > 0) {
                                const m = Math.floor(remainingSeconds / 60);
                                const s = remainingSeconds % 60;
                                ctx.fillText(`Remaining: ${m}m ${s}s`, 40, 85);
                            }

                            window.recordAnimationId = requestAnimationFrame(drawFrame);
                        };
                        drawFrame();

                        const compositeStream = canvas.captureStream(30);
                        if (webCamStream && webCamStream.getAudioTracks().length > 0) {
                            compositeStream.addTrack(webCamStream.getAudioTracks()[0]);
                        }

                        const options = { mimeType: 'video/webm' };

                        // 1. Composite recorder (screen + webcam PIP + overlays)
                        currentMediaRecorder = new MediaRecorder(compositeStream, options);
                        recordedChunks = [];
                        currentMediaRecorder.ondataavailable = (e) => {
                            if (e.data.size > 0) recordedChunks.push(e.data);
                        };
                        currentMediaRecorder.addEventListener('stop', () => {
                            cancelAnimationFrame(window.recordAnimationId);
                        });
                        currentMediaRecorder.start();

                        // 2. Raw screen recorder (independent)
                        if (screenStream) {
                            screenRecorder = new MediaRecorder(screenStream, options);
                            screenChunks = [];
                            screenRecorder.ondataavailable = (e) => {
                                if (e.data.size > 0) screenChunks.push(e.data);
                            };
                            screenRecorder.start();
                        }

                        // 3. Raw webcam recorder (independent)
                        if (webCamStream) {
                            webcamRecorder = new MediaRecorder(webCamStream, options);
                            webcamChunks = [];
                            webcamRecorder.ondataavailable = (e) => {
                                if (e.data.size > 0) webcamChunks.push(e.data);
                            };
                            webcamRecorder.start();
                        }
                    }
                } catch (err) {
                    console.warn('Could not start screen compositing:', err);
                }
            };

            showPage('exam');
        } catch (err) {
            console.error('Failed to start exam:', err);
        }
    }

    function startTimer() {
        if (examTimer) clearInterval(examTimer);

        examTimer = setInterval(() => {
            remainingSeconds--;
            const m = Math.floor(remainingSeconds / 60);
            const s = (remainingSeconds % 60).toString().padStart(2, '0');

            // Optional traditional timer element if on standard portal
            const display = document.getElementById('exam-duration-display');
            if (display) display.textContent = `${m}:${s}`;

            // Top Toolbar timer updates
            const topTimer = document.getElementById('exam-top-timer');
            if (topTimer) topTimer.textContent = `${m}m ${s}s`;

            const topTimestamp = document.getElementById('exam-top-timestamp');
            if (topTimestamp) topTimestamp.textContent = new Date().toLocaleTimeString();

            if (remainingSeconds <= 0) {
                confirmSubmitExam(true);
            }
        }, 1000);
    }

    // ---- Exam / Session End ----
    document.getElementById('btn-end-session')?.addEventListener('click', () => {
        showSubmitModal();
    });

    function showSubmitModal() {
        const modal = document.getElementById('submit-modal');
        const summary = document.getElementById('submit-summary');

        summary.innerHTML = `
      <div class="summary-stats">
        <p>Are you sure you want to end your proctored session?</p>
      </div>
    `;

        modal.classList.remove('hidden');
    }

    document.getElementById('btn-cancel-submit')?.addEventListener('click', () => {
        document.getElementById('submit-modal').classList.add('hidden');
    });

    document.getElementById('btn-confirm-submit')?.addEventListener('click', () => {
        confirmSubmitExam(false);
    });

    document.querySelector('.modal-overlay')?.addEventListener('click', () => {
        document.getElementById('submit-modal').classList.add('hidden');
    });

    async function confirmSubmitExam(autoSubmitted) {
        if (examTimer) clearInterval(examTimer);
        document.getElementById('submit-modal').classList.add('hidden');

        try {
            await window.seb.submitExam(currentExam.id, examAnswers);
        } catch (err) {
            console.error('Submit failed:', err);
        }

        // Show completion
        document.getElementById('session-status-text').textContent = autoSubmitted ? 'Auto-Submitted' : 'Submitted';

        // Stop all recorders and save videos
        const ts = Date.now();
        try {
            // Save composite recording (screen + webcam PIP + overlays)
            if (currentMediaRecorder && currentMediaRecorder.state !== 'inactive') {
                currentMediaRecorder.addEventListener('stop', () => {
                    const blob = new Blob(recordedChunks, { type: 'video/webm' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `session-recording-${ts}.webm`;
                    a.click();
                });
                currentMediaRecorder.stop();
            }

            // Save raw screen recording
            if (screenRecorder && screenRecorder.state !== 'inactive') {
                screenRecorder.addEventListener('stop', () => {
                    const blob = new Blob(screenChunks, { type: 'video/webm' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `screen-recording-${ts}.webm`;
                    a.click();
                });
                screenRecorder.stop();
            }

            // Save raw webcam recording
            if (webcamRecorder && webcamRecorder.state !== 'inactive') {
                webcamRecorder.addEventListener('stop', () => {
                    const blob = new Blob(webcamChunks, { type: 'video/webm' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `webcam-recording-${ts}.webm`;
                    a.click();
                });
                webcamRecorder.stop();
            }

            // Clean up streams
            document.getElementById('webcam-video').srcObject?.getTracks().forEach(t => t.stop());
            // webcam container already hidden
        } catch (e) {
            console.error('Failed to save recordings', e);
        }

        // Remove webview
        const container = document.getElementById('exam-webview-container');
        container.innerHTML = `
                        < div class="exam-complete" >
        <div class="complete-icon">${autoSubmitted ? '⏰' : '✅'}</div>
        <h2>${autoSubmitted ? 'Time\'s Up! Exam Auto-Submitted' : 'Exam Submitted Successfully'}</h2>
        <p>Your responses have been recorded securely.</p>
        <button class="btn-primary" onclick="document.getElementById('page-exam').classList.remove('active'); document.getElementById('page-exam-list').classList.add('active');">Return to Dashboard</button>
      </div >
                        `;

        currentExam = null;
    }

    // ---- Admin Dashboard ----
    async function initAdminDashboard() {
        // Load policy into editor textarea
        try {
            const policy = await window.seb.getPolicy();
            const editor = document.getElementById('policy-editor');
            if (editor) editor.value = JSON.stringify(policy, null, 2);
        } catch { }

        refreshMonitoringStats();
        loadUsersList();
        loadPolicyHistory();
    }

    // --- Policy Editor ---
    document.getElementById('btn-save-policy')?.addEventListener('click', async () => {
        const editor = document.getElementById('policy-editor');
        const msgEl = document.getElementById('policy-save-msg');

        try {
            const policyObj = JSON.parse(editor.value);
            const result = await window.seb.savePolicy(policyObj);
            if (result.success) {
                msgEl.innerHTML = '<span style="color: #4CAF50; font-weight: bold;">✅ Policy saved & encrypted in database.</span>';
                loadPolicyHistory();
            } else {
                msgEl.innerHTML = `<span style="color: #f44336;">❌ ${result.error}</span>`;
            }
        } catch (err) {
            msgEl.innerHTML = `<span style="color: #f44336;">❌ Invalid JSON: ${err.message}</span>`;
        }
    });

    document.getElementById('btn-reset-policy')?.addEventListener('click', async () => {
        try {
            const policy = await window.seb.getPolicy();
            const editor = document.getElementById('policy-editor');
            if (editor) editor.value = JSON.stringify(policy, null, 2);
            document.getElementById('policy-save-msg').innerHTML = '<span style="color: var(--text-secondary);">Reset to current active policy.</span>';
        } catch { }
    });

    async function loadPolicyHistory() {
        try {
            const history = await window.seb.getPolicyHistory();
            const container = document.getElementById('policy-history');
            if (history.length === 0) {
                container.innerHTML = '<p style="color: var(--text-secondary);">No policy changes recorded yet.</p>';
                return;
            }
            container.innerHTML = history.map(h => `
                <div style="padding: 4px 0; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between;">
                    <span>🔐 ${h.updated_at}</span>
                    <span>by @${h.username || 'system'}</span>
                    <span style="font-family: monospace; font-size: 10px; color: var(--accent);">${h.hash.substring(0, 16)}…</span>
                </div>
            `).join('');
        } catch { }
    }

    // --- User Management ---
    async function loadUsersList() {
        try {
            const users = await window.seb.getAllUsers();
            const container = document.getElementById('users-list');
            const userSelect = document.getElementById('log-user-select');

            // Populate list
            container.innerHTML = users.map(u => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--border);">
                    <div>
                        <span style="font-weight: 600; color: var(--text-primary);">${u.name}</span>
                        <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">@${u.username}</span>
                        <span style="background: ${u.role === 'admin' ? '#4CAF50' : 'var(--accent)'}; color: white; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">${u.role}</span>
                    </div>
                    <button class="btn-delete-user btn-danger" data-id="${u.id}" style="padding: 2px 10px; font-size: 11px; height: 24px;">Delete</button>
                </div>
            `).join('');

            // Populate user dropdown for log viewer
            userSelect.innerHTML = '<option value="all">— All Users —</option>' +
                users.map(u => `<option value="${u.id}">${u.name} (@${u.username})</option>`).join('');

            // Delete buttons
            container.querySelectorAll('.btn-delete-user').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (confirm(`Delete user ID ${btn.dataset.id}?`)) {
                        await window.seb.deleteUser(parseInt(btn.dataset.id));
                        loadUsersList();
                    }
                });
            });
        } catch (err) {
            console.error('Failed to load users:', err);
        }
    }

    document.getElementById('btn-create-user')?.addEventListener('click', async () => {
        const username = document.getElementById('new-user-username').value.trim();
        const password = document.getElementById('new-user-password').value;
        const name = document.getElementById('new-user-name').value.trim();
        const role = document.getElementById('new-user-role').value;
        const msgEl = document.getElementById('user-create-msg');

        if (!username || !password || !name) {
            msgEl.textContent = 'All fields are required.';
            msgEl.style.color = '#f44336';
            return;
        }

        const result = await window.seb.createUser(username, password, name, role);
        if (result.success) {
            msgEl.textContent = `✅ User "${username}" created successfully.`;
            msgEl.style.color = '#4CAF50';
            document.getElementById('new-user-username').value = '';
            document.getElementById('new-user-password').value = '';
            document.getElementById('new-user-name').value = '';
            loadUsersList();
        } else {
            msgEl.textContent = `❌ ${result.error}`;
            msgEl.style.color = '#f44336';
        }
    });

    // --- Monitoring ---
    document.getElementById('btn-refresh-stats')?.addEventListener('click', refreshMonitoringStats);

    async function refreshMonitoringStats() {
        try {
            const status = await window.seb.getSessionStatus();
            if (status.monitor) {
                document.getElementById('stat-escalation').textContent = status.monitor.escalationLevel;
                document.getElementById('stat-violations').textContent = status.monitor.violations.total;
                document.getElementById('stat-blur').textContent = status.monitor.violations.focusLoss;
                document.getElementById('stat-shortcuts').textContent = status.monitor.violations.shortcutAttempt;
                document.getElementById('stat-blocked-urls').textContent = status.monitor.violations.navigationBlocked;

                const escalation = document.getElementById('stat-escalation');
                escalation.className = 'stat-value escalation-' + status.monitor.escalationLevel.toLowerCase();
            }
        } catch { }
    }

    // --- Per-User Encrypted Log Viewer ---
    document.getElementById('btn-load-logs')?.addEventListener('click', async () => {
        try {
            const selectedUser = document.getElementById('log-user-select').value;
            let logs;
            if (selectedUser === 'all') {
                logs = await window.seb.getAllLogs();
            } else {
                logs = await window.seb.getLogsForUser(parseInt(selectedUser));
            }

            const viewer = document.getElementById('log-entries');
            if (logs.length === 0) {
                viewer.innerHTML = '<p style="color: var(--text-secondary); padding: 12px;">No logs found for this user.</p>';
                return;
            }

            viewer.innerHTML = logs.slice(0, 100).map(entry => `
                <div class="log-entry log-${entry.level?.toLowerCase()}">
                    <span class="log-time">${new Date(entry.timestamp || entry.ts).toLocaleTimeString()}</span>
                    <span class="log-level">${entry.level}</span>
                    <span class="log-module">${entry.module}</span>
                    <span class="log-msg">${entry.msg}</span>
                    ${entry.username ? `<span style="color: var(--accent); font-size: 10px; margin-left: 6px;">@${entry.username}</span>` : ''}
                </div>
            `).join('');
        } catch (err) {
            console.error('Failed to load logs:', err);
        }
    });

    // --- Hash Chain Integrity Verification ---
    document.getElementById('btn-verify-integrity')?.addEventListener('click', async () => {
        try {
            const result = await window.seb.verifyLogIntegrity();
            const el = document.getElementById('integrity-result');
            if (result.valid) {
                el.innerHTML = `<span style="color: #4CAF50; font-weight: bold;">✅ Hash chain intact — ${result.totalEntries} entries verified. No tampering detected.</span>`;
            } else {
                el.innerHTML = `<span style="color: #f44336; font-weight: bold;">❌ TAMPERING DETECTED at row ${result.rowId}! Hash chain broken at entry ${result.brokenAt}.</span>`;
            }
        } catch (err) {
            alert('Failed to verify integrity: ' + err.message);
        }
    });

    // ---- Window Controls ----
    document.getElementById('btn-minimize')?.addEventListener('click', () => {
        window.seb.minimizeWindow();
    });
    document.getElementById('btn-maximize')?.addEventListener('click', () => {
        window.seb.maximizeWindow();
    });
    document.getElementById('btn-close')?.addEventListener('click', () => {
        window.seb.closeWindow();
    });

    // ---- Utility ----
    function shakeElement(el) {
        el.classList.add('shake');
        setTimeout(() => el.classList.remove('shake'), 500);
    }

    // ---- Start on login page ----
    showPage('login');

})();
