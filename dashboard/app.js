// ─── Synqto Standalone Operations Dashboard Engine ───

const STORAGE_KEY = 'synqto_dashboard_server_url';
let currentServerUrl = localStorage.getItem(STORAGE_KEY) || 'http://localhost:8080';
let activeFilterLevel = 'ALL';
let isStreamPaused = false;
let allRoomsCache = [];
let allLogsCache = [];
let pollTimer = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('input-server-url');
  if (urlInput) {
    urlInput.value = currentServerUrl;
    urlInput.addEventListener('change', (e) => {
      setServerUrl(e.target.value.trim());
    });
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        setServerUrl(e.target.value.trim());
      }
    });
  }

  updatePresetButtons();
  triggerManualRefresh();

  // Start polling every 2 seconds
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollServer, 2000);
});

// Configure Server Target URL
function setServerUrl(url) {
  if (!url) return;
  // Strip trailing slash
  currentServerUrl = url.replace(/\/+$/, '');
  localStorage.setItem(STORAGE_KEY, currentServerUrl);

  const urlInput = document.getElementById('input-server-url');
  if (urlInput) urlInput.value = currentServerUrl;

  updatePresetButtons();
  triggerManualRefresh();
}

function updatePresetButtons() {
  const btnLocal = document.getElementById('btn-preset-local');
  const btnProd = document.getElementById('btn-preset-prod');

  if (btnLocal && btnProd) {
    btnLocal.classList.toggle('active', currentServerUrl.includes('localhost') || currentServerUrl.includes('127.0.0.1'));
    btnProd.classList.toggle('active', currentServerUrl.includes('onrender.com'));
  }
}

// Manual Refresh Trigger
async function triggerManualRefresh() {
  await pollServer();
}

// Main Polling Loop
async function pollServer() {
  const isHealthy = await testPingEndpoint();
  if (isHealthy) {
    await Promise.all([
      fetchMetrics(),
      fetchRooms(),
      !isStreamPaused ? fetchLogs() : Promise.resolve()
    ]);
  }
}

// Ping and Latency Health Check
async function testPingEndpoint(e) {
  if (e) e.preventDefault();

  const indicatorDot = document.getElementById('indicator-dot');
  const labelStatus = document.getElementById('label-connection-status');
  const labelLatency = document.getElementById('label-ping-latency');

  const start = performance.now();
  try {
    const res = await fetch(`${currentServerUrl}/ping`, { cache: 'no-store' });
    const latency = Math.round(performance.now() - start);

    if (res.ok) {
      if (indicatorDot) {
        indicatorDot.classList.remove('offline');
      }
      if (labelStatus) labelStatus.textContent = 'ONLINE';
      if (labelLatency) labelLatency.textContent = `${latency} ms`;
      return true;
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    if (indicatorDot) {
      indicatorDot.classList.add('offline');
    }
    if (labelStatus) labelStatus.textContent = 'OFFLINE';
    if (labelLatency) labelLatency.textContent = 'Unreachable';
    return false;
  }
}

// Fetch Metrics KPI
async function fetchMetrics() {
  try {
    const res = await fetch(`${currentServerUrl}/api/metrics`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();

    // Active & Lifetime Connections
    const elActivePeers = document.getElementById('val-active-peers');
    const elTagActivePeers = document.getElementById('tag-active-peers');
    const elTotalPeers = document.getElementById('val-total-peers');

    if (elActivePeers) elActivePeers.textContent = data.activeConnections || 0;
    if (elTagActivePeers) elTagActivePeers.textContent = `${data.activeConnections || 0} Active`;
    if (elTotalPeers) elTotalPeers.textContent = `Total Lifetime: ${data.totalConnections || 0}`;

    // Active Rooms
    const activeRoomsCount = Math.max(0, (data.totalRoomsCreated || 0) - (data.totalRoomsClosed || 0));
    const elActiveRooms = document.getElementById('val-active-rooms');
    const elTagActiveRooms = document.getElementById('tag-active-rooms');
    const elTotalRooms = document.getElementById('val-total-rooms');
    const elClosedRooms = document.getElementById('val-closed-rooms');

    if (elActiveRooms) elActiveRooms.textContent = activeRoomsCount;
    if (elTagActiveRooms) elTagActiveRooms.textContent = `${activeRoomsCount} Rooms`;
    if (elTotalRooms) elTotalRooms.textContent = `Total Created: ${data.totalRoomsCreated || 0}`;
    if (elClosedRooms) elClosedRooms.textContent = `Closed: ${data.totalRoomsClosed || 0}`;

    // Signaling Relays
    const totalSignals = (data.offersRelayed || 0) + (data.answersRelayed || 0) + (data.iceRelayed || 0);
    const elTotalRelays = document.getElementById('val-total-relays');
    const elRelaysBreakdown = document.getElementById('val-relays-breakdown');

    if (elTotalRelays) elTotalRelays.textContent = totalSignals.toLocaleString();
    if (elRelaysBreakdown) {
      elRelaysBreakdown.textContent = `Offers: ${data.offersRelayed || 0} | Answers: ${data.answersRelayed || 0} | ICE: ${data.iceRelayed || 0}`;
    }

    // System Health & Memory
    const elMem = document.getElementById('val-memory-allocated');
    const elUptime = document.getElementById('val-uptime');
    const elGoroutines = document.getElementById('val-goroutines');
    const elGoVersion = document.getElementById('tag-go-version');

    if (elMem) elMem.textContent = `${(data.memoryAllocMB || 0).toFixed(2)} MB`;
    if (elUptime) elUptime.textContent = `Uptime: ${data.uptime || '0s'}`;
    if (elGoroutines) elGoroutines.textContent = `${data.goroutines || 0} Goroutines (GC: ${data.numGC || 0})`;
    if (elGoVersion && data.goVersion) elGoVersion.textContent = data.goVersion;

  } catch (err) {
    console.warn('Error fetching metrics:', err);
  }
}

// Fetch Rooms Topology
async function fetchRooms() {
  try {
    const res = await fetch(`${currentServerUrl}/api/rooms`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();

    allRoomsCache = data.rooms || [];
    renderRooms(allRoomsCache);

    const elTotalBadge = document.getElementById('badge-total-room-count');
    if (elTotalBadge) elTotalBadge.textContent = `${allRoomsCache.length} Active`;

  } catch (err) {
    console.warn('Error fetching rooms:', err);
  }
}

// Render Room Cards
function renderRooms(rooms) {
  const container = document.getElementById('container-rooms-list');
  if (!container) return;

  const searchQuery = (document.getElementById('input-room-search')?.value || '').toLowerCase().trim();

  const filtered = rooms.filter(r => {
    if (!searchQuery) return true;
    if (r.id.toLowerCase().includes(searchQuery)) return true;
    if (r.peers && r.peers.some(p => p.nickname.toLowerCase().includes(searchQuery) || p.id.toLowerCase().includes(searchQuery))) return true;
    return false;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-placeholder">
        ${searchQuery ? `No rooms matching "${escapeHtml(searchQuery)}"` : 'No active rooms currently open on this cluster node.'}
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(room => {
    const leaderSet = new Set(room.leaders || []);
    
    const peerChipsHtml = (room.peers || []).map(p => {
      const isLeader = leaderSet.has(p.id) || p.isLeader;
      const assignedLeader = room.assignments ? room.assignments[p.id] : null;

      return `
        <div class="peer-chip ${isLeader ? 'is-leader' : ''}">
          <span>${isLeader ? '👑' : '👤'}</span>
          <strong>${escapeHtml(p.nickname || p.id)}</strong>
          <span class="peer-chip-role">${isLeader ? 'Trinity Leader' : `Cluster → ${assignedLeader || 'Hub'}`}</span>
        </div>
      `;
    }).join('');

    return `
      <article class="room-card-item">
        <div class="room-item-top">
          <span class="room-id-tag">${escapeHtml(room.id)}</span>
          <span class="quorum-pill">${room.peerCount} Peers • ${room.leaderCount} Trinity Leaders</span>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">
          Backbone Leaders: ${room.leaders && room.leaders.length > 0 ? room.leaders.map(lid => `<code>${lid}</code>`).join(', ') : 'None'}
        </div>
        <div class="peer-chips-list">
          ${peerChipsHtml || '<span style="font-size: 11px; color: var(--text-muted);">No peers connected</span>'}
        </div>
      </article>
    `;
  }).join('');
}

function filterRooms() {
  renderRooms(allRoomsCache);
}

// Fetch Structured Logs
async function fetchLogs() {
  try {
    const url = activeFilterLevel === 'ALL'
      ? `${currentServerUrl}/api/logs?limit=80`
      : `${currentServerUrl}/api/logs?level=${activeFilterLevel}&limit=80`;

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return;
    const logs = await res.json();

    allLogsCache = logs || [];
    renderLogs(allLogsCache);

  } catch (err) {
    console.warn('Error fetching logs:', err);
  }
}

// Render Terminal Logs
function renderLogs(logs) {
  const terminal = document.getElementById('terminal-log-output');
  if (!terminal) return;

  if (!logs || logs.length === 0) {
    terminal.innerHTML = `
      <div class="empty-placeholder" style="padding: 24px;">
        No log entries found for filter [${activeFilterLevel}]
      </div>
    `;
    return;
  }

  terminal.innerHTML = logs.map(l => {
    let attrStr = '';
    if (l.attrs && Object.keys(l.attrs).length > 0) {
      attrStr = Object.entries(l.attrs).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    }

    return `
      <div class="log-entry">
        <span class="log-timestamp">[${l.timestamp}]</span>
        <span class="log-level-badge log-level-${l.level}">${l.level}</span>
        <span class="log-message-text">${escapeHtml(l.message)}</span>
        ${attrStr ? `<span class="log-attrs-text">${escapeHtml(attrStr)}</span>` : ''}
      </div>
    `;
  }).join('');

  if (!isStreamPaused) {
    terminal.scrollTop = terminal.scrollHeight;
  }
}

// Log Level Filter Switcher
function setFilterLevel(level) {
  activeFilterLevel = level;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === `filter-lvl-${level}`);
  });
  fetchLogs();
}

// Toggle Stream Pause
function toggleLogPause() {
  isStreamPaused = !isStreamPaused;
  const btn = document.getElementById('btn-toggle-pause');
  const icon = document.getElementById('icon-pause');

  if (btn && icon) {
    if (isStreamPaused) {
      icon.textContent = '▶';
      btn.title = 'Resume live log stream';
      btn.style.borderColor = 'var(--accent-amber)';
    } else {
      icon.textContent = '⏸';
      btn.title = 'Pause live log stream';
      btn.style.borderColor = '';
      fetchLogs();
    }
  }
}

// Export Logs as JSON
function exportLogsJson() {
  if (!allLogsCache || allLogsCache.length === 0) {
    alert('No log entries available to export.');
    return;
  }

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    serverUrl: currentServerUrl,
    filterLevel: activeFilterLevel,
    logCount: allLogsCache.length,
    logs: allLogsCache,
  };

  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `synqto-telemetry-logs-${Date.now()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

// Security HTML Sanitizer Helper
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
