let config = {
    dns: { port: 6767, bind: "0.0.0.0", upstream: ["1.1.1.1", "1.0.0.1"] },
    overrides: []
};

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
                <div class="empty-state-icon">📭</div>
                <h3>No overrides yet</h3>
                <p>Add your first DNS override to route a domain to a custom IP</p>
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
                    ${!override.enabled ? '<span class="override-badge" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; border-color: rgba(148, 163, 184, 0.3);">Disabled</span>' : ''}
                </div>
                <div class="override-details">
                    <span>→ <span class="override-value">${escapeHtml(override.value)}</span></span>
                    <span>TTL: ${override.ttl}s</span>
                    ${override.notes ? `<span>📝 ${escapeHtml(override.notes)}</span>` : ''}
                </div>
            </div>
            <div class="override-actions">
                <button class="btn-icon" onclick="editOverride('${override.id}')" title="Edit">✏️</button>
                <button class="btn-icon" onclick="deleteOverride('${override.id}')" title="Delete">🗑️</button>
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
    });
});

// Add override button
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
    if (!confirm('Are you sure you want to delete this override?')) return;
    
    try {
        await fetch(`/api/overrides/${id}`, { method: 'DELETE' });
        loadConfig();
    } catch (err) {
        alert('Failed to delete override');
    }
}

// Modal controls
document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('overrideModal').classList.remove('active');
});

document.getElementById('modalCancel').addEventListener('click', () => {
    document.getElementById('overrideModal').classList.remove('active');
});

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
    
    if (!override.name || !override.value) {
        alert('Domain name and value are required');
        return;
    }
    
    try {
        await fetch('/api/overrides', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(override)
        });
        document.getElementById('overrideModal').classList.remove('active');
        loadConfig();
    } catch (err) {
        alert('Failed to save override');
    }
});

// Save settings
document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    config.dns = {
        port: parseInt(document.getElementById('dnsPort').value) || 6767,
        bind: document.getElementById('dnsBind').value.trim() || '0.0.0.0',
        upstream: document.getElementById('upstreamDns').value.split(',').map(s => s.trim()).filter(s => s)
    };
    
    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        alert('Settings saved! Restart the DNS server for changes to take effect.');
    } catch (err) {
        alert('Failed to save settings');
    }
});

// Close modal when clicking outside
document.getElementById('overrideModal').addEventListener('click', (e) => {
    if (e.target.id === 'overrideModal') {
        e.target.classList.remove('active');
    }
});

loadConfig();
