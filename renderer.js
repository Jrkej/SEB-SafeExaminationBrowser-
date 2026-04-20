// ============================================================
// SEB — Simple Electron Browser | Renderer
// ============================================================

const DEFAULT_URL = 'https://www.google.com';
const tabsContainer = document.getElementById('tabs-container');
const webviewContainer = document.getElementById('webview-container');
const urlBar = document.getElementById('url-bar');
const loadingSpinner = document.getElementById('loading-spinner');
const securityIndicator = document.getElementById('security-indicator');

let tabs = [];
let activeTabId = null;
let tabCounter = 0;

// ---- Helpers ------------------------------------------------

function ensureProtocol(url) {
    url = url.trim();
    if (!url) return DEFAULT_URL;
    // If it looks like a search query, use Google
    if (!url.includes('.') && !url.startsWith('http') && !url.startsWith('file://')) {
        return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
    if (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url)) {
        return 'https://' + url;
    }
    return url;
}

function truncateTitle(title, maxLen = 24) {
    if (!title) return 'New Tab';
    return title.length > maxLen ? title.substring(0, maxLen) + '…' : title;
}

// ---- Tab Management -----------------------------------------

function createTab(url = DEFAULT_URL) {
    const id = ++tabCounter;

    // Create webview
    const webview = document.createElement('webview');
    webview.setAttribute('src', url);
    webview.setAttribute('id', `webview-${id}`);
    webview.style.width = '100%';
    webview.style.height = '100%';
    webview.style.position = 'absolute';
    webview.style.top = '0';
    webview.style.left = '0';
    webview.style.display = 'none';
    webview.setAttribute('allowpopups', '');
    webviewContainer.appendChild(webview);

    // Create tab element
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.id = id;
    tabEl.innerHTML = `
    <span class="tab-title">New Tab</span>
    <button class="tab-close" title="Close Tab">
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>
  `;
    tabsContainer.appendChild(tabEl);

    // Tab click → switch
    tabEl.addEventListener('click', (e) => {
        if (!e.target.closest('.tab-close')) {
            switchTab(id);
        }
    });

    // Tab close
    tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(id);
    });

    // Webview events
    webview.addEventListener('did-start-loading', () => {
        if (id === activeTabId) {
            loadingSpinner.classList.remove('hidden');
        }
    });

    webview.addEventListener('did-stop-loading', () => {
        if (id === activeTabId) {
            loadingSpinner.classList.add('hidden');
        }
    });

    webview.addEventListener('did-navigate', (e) => {
        const tab = tabs.find(t => t.id === id);
        if (tab) tab.url = e.url;
        if (id === activeTabId) updateUrlBar(e.url);
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
        if (e.isMainFrame) {
            const tab = tabs.find(t => t.id === id);
            if (tab) tab.url = e.url;
            if (id === activeTabId) updateUrlBar(e.url);
        }
    });

    webview.addEventListener('page-title-updated', (e) => {
        const tab = tabs.find(t => t.id === id);
        if (tab) {
            tab.title = e.title;
            tabEl.querySelector('.tab-title').textContent = truncateTitle(e.title);
        }
    });

    webview.addEventListener('page-favicon-updated', (e) => {
        const tab = tabs.find(t => t.id === id);
        if (tab && e.favicons && e.favicons.length > 0) {
            tab.favicon = e.favicons[0];
            // Could add favicon rendering to tab
        }
    });

    // Handle new-window requests by opening in a new tab
    webview.addEventListener('new-window', (e) => {
        e.preventDefault();
        createTab(e.url);
    });

    const tabData = { id, url, title: 'New Tab', favicon: null, webview, tabEl };
    tabs.push(tabData);
    switchTab(id);

    return tabData;
}

function switchTab(id) {
    activeTabId = id;

    tabs.forEach(tab => {
        const isActive = tab.id === id;
        tab.webview.style.display = isActive ? 'flex' : 'none';
        tab.tabEl.classList.toggle('active', isActive);
        if (isActive) {
            updateUrlBar(tab.url);
        }
    });
}

function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    const tab = tabs[idx];
    tab.webview.remove();
    tab.tabEl.remove();
    tabs.splice(idx, 1);

    if (tabs.length === 0) {
        createTab();
        return;
    }

    if (activeTabId === id) {
        const newIdx = Math.min(idx, tabs.length - 1);
        switchTab(tabs[newIdx].id);
    }
}

function getActiveWebview() {
    const tab = tabs.find(t => t.id === activeTabId);
    return tab ? tab.webview : null;
}

// ---- URL Bar ------------------------------------------------

function updateUrlBar(url) {
    urlBar.value = url || '';
    // Update security indicator
    const isSecure = url && url.startsWith('https://');
    securityIndicator.classList.toggle('secure', isSecure);
    securityIndicator.classList.toggle('insecure', !isSecure);
}

function navigateToUrl() {
    const webview = getActiveWebview();
    if (!webview) return;
    const url = ensureProtocol(urlBar.value);
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) tab.url = url;
    webview.setAttribute('src', url);
    urlBar.blur();
}

// ---- Navigation Buttons -------------------------------------

document.getElementById('btn-back').addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv && wv.canGoBack()) wv.goBack();
});

document.getElementById('btn-forward').addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv && wv.canGoForward()) wv.goForward();
});

document.getElementById('btn-reload').addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv) wv.reload();
});

document.getElementById('btn-home').addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv) {
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab) tab.url = DEFAULT_URL;
        wv.setAttribute('src', DEFAULT_URL);
    }
});

document.getElementById('btn-go').addEventListener('click', navigateToUrl);
document.getElementById('btn-new-tab').addEventListener('click', () => createTab());

// URL bar Enter key
urlBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        navigateToUrl();
    }
    if (e.key === 'Escape') {
        urlBar.blur();
    }
});

// Select all on focus
urlBar.addEventListener('focus', () => {
    setTimeout(() => urlBar.select(), 50);
});

// ---- Keyboard Shortcuts -------------------------------------

document.addEventListener('keydown', (e) => {
    // Ctrl+T → new tab
    if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        createTab();
    }
    // Ctrl+W → close tab
    if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
    }
    // Ctrl+L or F6 → focus URL bar
    if ((e.ctrlKey && e.key === 'l') || e.key === 'F6') {
        e.preventDefault();
        urlBar.focus();
    }
    // Ctrl+R or F5 → reload
    if ((e.ctrlKey && e.key === 'r') || e.key === 'F5') {
        e.preventDefault();
        const wv = getActiveWebview();
        if (wv) wv.reload();
    }
    // Alt+Left → back
    if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        const wv = getActiveWebview();
        if (wv && wv.canGoBack()) wv.goBack();
    }
    // Alt+Right → forward
    if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        const wv = getActiveWebview();
        if (wv && wv.canGoForward()) wv.goForward();
    }
    // Ctrl+Tab → next tab
    if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const idx = tabs.findIndex(t => t.id === activeTabId);
        const next = (idx + 1) % tabs.length;
        switchTab(tabs[next].id);
    }
    // Ctrl+Shift+Tab → previous tab
    if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        const idx = tabs.findIndex(t => t.id === activeTabId);
        const prev = (idx - 1 + tabs.length) % tabs.length;
        switchTab(tabs[prev].id);
    }
});

// ---- Window Controls ----------------------------------------

document.getElementById('btn-minimize').addEventListener('click', () => {
    window.electronAPI.minimizeWindow();
});

document.getElementById('btn-maximize').addEventListener('click', () => {
    window.electronAPI.maximizeWindow();
});

document.getElementById('btn-close').addEventListener('click', () => {
    window.electronAPI.closeWindow();
});

// ---- Init ---------------------------------------------------
createTab(DEFAULT_URL);
