let config = { dns: { port: 6767, bind: "0.0.0.0", upstream: ["1.1.1.1", "1.0.0.1"] }, overrides: [] };
let ws;
let autoScroll = true;
let currentDevice = null;
let liveLogs = [];

// Initialize WebSocket
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'init') {
            renderDevices(data.clients);
            data.logs.forEach(log => addLogEntry(log, false));
        } else if (data.type === 'log') {
            addLogEntry(data.entry, true);
            renderDevices(data.clients);
        } else if (data.type === 'clients') {
            renderDevices(data.clients);
        }
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setTimeout(initWebSocket, 2000);
    };
}

function addLogEntry(entry, animate = true) {
    const logsList = document.getElementById('logsList');
    const logDiv = document.createElement('div');
    logDiv.className = 'log-entry' + (animate ? ' animate' : '');
    
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const resultClass = entry.result.includes('REFUSED') ? 'refused' : 
                        entry.result.includes('NXDOMAIN') ? 'nxdomain' : '';
    
    logDiv.innerHTML = `
        <span class="log-time">${time}</span>
        <span class="log-client">${escapeHtml(entry.clientIp)}</span>
        <span class="log-domain">${escapeHtml(entry.domain)}</span>
        <span class="log-type">${escapeHtml(entry.type)}</span>
        <span class="log-result ${resultClass}">${escapeHtml(entry.result)}</span>
    `;
    
    logsList.prepend(logDiv);
    liveLogs.unshift(entry);
    
    // Limit to 200 entries
    if (liveLogs.length > 200) {
        liveLogs.pop();
        if (logsList.children.length > 200) {
            logsList.removeChild(logsList.lastChild);
        }
    }
    
    if (autoScroll) {
        logsList.scrollTop = 0;
    }
}

function renderDevices(clients) {
    const grid = document.getElementById('devicesGrid');
    grid.innerHTML = '';
    
    if (!clients || clients.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">📡</div>
                <h3>No devices yet</h3>
                <p>Devices will appear when they make DNS queries</p>
            </div>
        `;
        return;
    }
    
    clients.sort((a,b) => new Date(b.lastSeen) - new Date(a.lastSeen));
    
    clients.forEach(client => {
        const card = document.createElement('div');
        card.className = 'device-card' + (client.blocked ? ' blocked' : '');
        card.onclick = () => showDeviceDetails(client);
        
        const firstSeen = new Date(client.firstSeen).toLocaleString();
        const lastSeen = new Date(client.lastSeen).toLocaleString();
        
        card.innerHTML = `
            <div class="device-icon">💻</div>
            <div class="device-ip">${escapeHtml(client.ip)}</div>
            <span class="device-status ${client.blocked ? 'blocked' : 'active'}">
                ${client.blocked ? '🚫 Blocked' : '✅ Active'}
            </span>
            <div class="device-stats">
                <div>📊 Queries: ${client.queryCount}</div>
                <div>🕐 Last seen: ${lastSeen}</div>
                <div>👀 First seen: ${firstSeen}</div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function showDeviceDetails(client) {
    currentDevice = client;
    document.getElementById('deviceDetailIp').textContent = client.ip;
    document.getElementById('deviceDetailStatus').textContent = client.blocked ? 'Blocked' : 'Active';
    document.getElementById('deviceDetailFirstSeen').textContent = new Date(client.firstSeen).toLocaleString();
    document.getElementById('deviceDetailLastSeen').textContent = new Date(client.lastSeen).toLocaleString();
    document.getElementById('deviceDetailQueries').textContent = client.queryCount;
    
    const blockBtn = document.getElementById('blockDeviceBtn');
    const unblockBtn = document.getElementById('unblockDeviceBtn');
    
    if (client.blocked) {
        blockBtn.style.display = 'none';
        unblockBtn.style.display = 'inline-flex';
    } else {
        blockBtn.style.display = 'inline-flex';
        unblockBtn.style.display = 'none';
    }
    
    document.getElementById('deviceModal').classList.add('active');
}

async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        config = await res.json();
        renderOverrides();
        populateSettings();
    } catch (err) {
        console.error('Failed to load config:', err);
    }
}

function renderOverrides() {
    const list = document.getElementById('overridesList');
    list.innerHTML = '';
    
    if (!config.overrides || config.overrides.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">📭</div>
                <h3>No overrides yet</h3>
                <p>Add your first DNS override</p>
            </div>
        `;
        return;
    }
    
    config.overrides.forEach(override => {
        const card = document.createElement('div');
        card.className = 'override-card';
        card.innerHTML = `
            <div class="override-info">
                <div class="override-header">
                    <span class="override-name">${escapeHtml(override.name)}</span>
                    <span class="override-badge">${escapeHtml(override.type)}</span>
                    ${!override.enabled ? '<span class="override-badge" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8;">Disabled</span>' : ''}
                </div>
                <div class="override-details">
                    <span>→ <span class="override-value">${escapeHtml(override.value)}</span></span>
                    <span>TTL: ${override.ttl}s</span>
                    ${override.notes ? `<span>📝 ${escapeHtml(override.notes)}</span>` : ''}
                </div>
            </div>
            <div class="override-actions">
                <button class="btn-icon" onclick="editOverride('${escapeHtml(override.id)}')">✏️</button>
                <button class="btn-icon" onclick="deleteOverride('${escapeHtml(override.id)}')">🗑️</button>
            </div>
        `;
        list.appendChild(card);
    });
}

function populateSettings() {
    document.getElementById('dnsPort').value = config.dns?.port || 6767;
    document.getElementById('dnsBind').value = config.dns?.bind || '0.0.0.0';
    document.getElementById('upstreamDns').value = (config.dns?.upstream || ['1.1.1.1', '1.0.0.1']).join(', ');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
        
        if (btn.dataset.tab === 'history') {
            loadLogHistory();
        }
    });
});

// Clear live logs
document.getElementById('clearLiveLogsBtn').addEventListener('click', () => {
    document.getElementById('logsList').innerHTML = '';
    liveLogs = [];
});

// Device modal
document.getElementById('deviceModalClose').addEventListener('click', () => {
    document.getElementById('deviceModal').classList.remove('active');
});

document.getElementById('blockDeviceBtn').addEventListener('click', async () => {
    if (!currentDevice) return;
    await fetch(`/api/clients/${currentDevice.ip}/block`, { method: 'POST' });
    document.getElementById('deviceModal').classList.remove('active');
});

document.getElementById('unblockDeviceBtn').addEventListener('click', async () => {
    if (!currentDevice) return;
    await fetch(`/api/clients/${currentDevice.ip}/unblock`, { method: 'POST' });
    document.getElementById('deviceModal').classList.remove('active');
});

document.getElementById('clearDeviceBtn').addEventListener('click', async () => {
    if (!currentDevice) return;
    if (!confirm('Remove this device from tracking?')) return;
    await fetch(`/api/clients/${currentDevice.ip}`, { method: 'DELETE' });
    document.getElementById('deviceModal').classList.remove('active');
});

document.getElementById('refreshDevicesBtn').addEventListener('click', async () => {
    const res = await fetch('/api/clients');
    renderDevices(await res.json());
});

// Add override
document.getElementById('addOverrideBtn').addEventListener('click', () => {
    document.getElementById('modalTitle').textContent = 'Add Override';
    document.getElementById('overrideId').value = '';
    document.getElementById('overrideName').value = '';
    document.getElementById('overrideType').value = 'A';
    document.getElementById('overrideValue').value = '';
    document.getElementById('overrideTtl').value = '60';
    document.getElementById('overrideNotes').value = '';
    document.getElementById('overrideEnabled').checked = true;
    document.getElementById('overrideModal').classList.add('active');
});

function editOverride(id) {
    const override = config.overrides.find(o => o.id === id);
    if (!override) return;
    document.getElementById('modalTitle').textContent = 'Edit Override';
    document.getElementById('overrideId').value = override.id;
    document.getElementById('overrideName').value = override.name;
    document.getElementById('overrideType').value = override.type;
    document.getElementById('overrideValue').value = override.value;
    document.getElementById('overrideTtl').value = override.ttl || 60;
    document.getElementById('overrideNotes').value = override.notes || '';
    document.getElementById('overrideEnabled').checked = override.enabled !== false;
    document.getElementById('overrideModal').classList.add('active');
}

async function deleteOverride(id) {
    if (!confirm('Delete this override?')) return;
    await fetch(`/api/overrides/${id}`, { method: 'DELETE' });
    loadConfig();
}

// Modal controls
document.getElementById('modalClose').addEventListener('click', () => document.getElementById('overrideModal').classList.remove('active'));
document.getElementById('modalCancel').addEventListener('click', () => document.getElementById('overrideModal').classList.remove('active'));

document.getElementById('modalSave').addEventListener('click', async () => {
    const id = document.getElementById('overrideId').value;
    const override = {
        id: id || undefined,
        name: document.getElementById('overrideName').value.trim(),
        type: document.getElementById('overrideType').value,
        value: document.getElementById('overrideValue').value.trim(),
        ttl: parseInt(document.getElementById('overrideTtl').value) || 60,
        notes: document.getElementById('overrideNotes').value.trim(),
        enabled: document.getElementById('overrideEnabled').checked
    };
    if (!override.name || !override.value) { alert('Name and value required'); return; }
    await fetch('/api/overrides', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(override) });
    document.getElementById('overrideModal').classList.remove('active');
    loadConfig();
});

// Save settings
document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    config.dns = {
        port: parseInt(document.getElementById('dnsPort').value) || 6767,
        bind: document.getElementById('dnsBind').value.trim() || '0.0.0.0',
        upstream: document.getElementById('upstreamDns').value.split(',').map(s => s.trim()).filter(s => s)
    };
    await fetch('/api/config', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(config) });
    alert('Settings saved! DNS server auto-reloads.');
});

// Log history
async function loadLogHistory() {
    const res = await fetch('/api/logs');
    const data = await res.json();
    const select = document.getElementById('logFileSelect');
    const deleteBtn = document.getElementById('deleteLogFileBtn');
    const selectedFile = select.value;
    select.innerHTML = '';
    data.files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.name;
        opt.textContent = f.name;
        select.appendChild(opt);
    });
    deleteBtn.disabled = data.files.length === 0;
    if (data.files.length > 0) {
        const fileToLoad = data.files.some(f => f.name === selectedFile)
            ? selectedFile
            : data.files[0].name;
        select.value = fileToLoad;
        await loadHistoryFile(fileToLoad);
    } else {
        document.getElementById('historyLogsList').innerHTML = `
            <div class="empty-state">
                <h3>No log files</h3>
                <p>DNS query logs will appear here</p>
            </div>
        `;
    }
}

document.getElementById('logFileSelect').addEventListener('change', (e) => {
    loadHistoryFile(e.target.value);
});

document.getElementById('deleteLogFileBtn').addEventListener('click', async () => {
    const select = document.getElementById('logFileSelect');
    const filename = select.value;
    if (!filename) return;
    if (!confirm(`Delete ${filename}? This cannot be undone.`)) return;

    const res = await fetch(`/api/logs/file/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
        alert(data.error || 'Failed to delete log file');
        return;
    }
    await loadLogHistory();
});

async function loadHistoryFile(filename) {
    const res = await fetch(`/api/logs/file/${encodeURIComponent(filename)}`);
    const data = await res.json();
    const list = document.getElementById('historyLogsList');
    list.innerHTML = '';
    const lines = data.content.trim().split('\n').filter(l => l).reverse();
    lines.forEach(line => {
        // Parse log line roughly
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = `<span style="grid-column: 1 / -1; color: var(--text-secondary);">${escapeHtml(line)}</span>`;
        list.appendChild(div);
    });
}

// Close modals on outside click
document.getElementById('overrideModal').addEventListener('click', (e) => { if (e.target.id === 'overrideModal') e.target.classList.remove('active'); });
document.getElementById('deviceModal').addEventListener('click', (e) => { if (e.target.id === 'deviceModal') e.target.classList.remove('active'); });

initWebSocket();
loadConfig();
