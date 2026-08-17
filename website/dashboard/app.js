// ─── Synqto Standalone Operations Dashboard Engine ───

const STORAGE_KEY = 'synqto_dashboard_server_url';
let currentServerUrl = localStorage.getItem(STORAGE_KEY) || 'http://localhost:8080';
let activeTab = 'overview';
let activeLogFilter = 'ALL';
let isStreamPaused = false;
let allRoomsCache = [];
let allLogsCache = [];
let pollTimer = null;
let simulatedWs = null;

// ─── DOM Lifecycle ───

document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('input-server-url');
  if (urlInput) {
    urlInput.value = currentServerUrl;
    urlInput.addEventListener('change', (e) => setServerUrl(e.target.value.trim()));
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') setServerUrl(e.target.value.trim());
    });
  }

  updatePresetButtons();
  triggerManualRefresh();

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollActiveTab, 2000);
});

// ─── Tab Navigation ───

function switchTab(tabId, elBtn) {
  activeTab = tabId;

  // Toggle Tab content
  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.toggle('active', section.id === `tab-${tabId}`);
  });

  // Toggle button styling
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (elBtn) {
    elBtn.classList.add('active');
  } else {
    const matchingBtn = document.querySelector(`.nav-tab-btn[onclick*="'${tabId}'"]`);
    if (matchingBtn) matchingBtn.classList.add('active');
  }

  // Fetch immediately for the active tab
  pollActiveTab();
}

// ─── Server Target URL Configuration ───

function setServerUrl(url) {
  if (!url) return;
  currentServerUrl = url.replace(/\/+$/, '');
  localStorage.setItem(STORAGE_KEY, currentServerUrl);

  const urlInput = document.getElementById('input-server-url');
  if (urlInput) urlInput.value = currentServerUrl;

  updatePresetButtons();
  showToast(`Server target set to ${currentServerUrl}`);
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

// ─── Polling Dispatcher ───

async function triggerManualRefresh() {
  await testPingEndpoint();
  await Promise.all([
    fetchOverviewMetrics(),
    fetchTopologyRooms(),
    fetchSignalingDiagnostics(),
    fetchSystemDiagnostics(),
    fetchClusterStatus(),
    !isStreamPaused ? fetchServerLogs() : Promise.resolve()
  ]);
}

async function pollActiveTab() {
  const isHealthy = await testPingEndpoint();
  if (!isHealthy) return;

  // Always refresh top-level metrics
  await fetchOverviewMetrics();

  switch (activeTab) {
    case 'overview':
      await Promise.all([fetchTopologyRooms(), !isStreamPaused ? fetchServerLogs() : Promise.resolve()]);
      break;
    case 'topology':
      await fetchTopologyRooms();
      break;
    case 'signaling':
      await fetchSignalingDiagnostics();
      break;
    case 'system':
      await Promise.all([fetchSystemDiagnostics(), fetchClusterStatus()]);
      break;
    case 'logs':
      if (!isStreamPaused) await fetchServerLogs();
      break;
  }
}

// ─── Health & Latency Probe ───

async function testPingEndpoint() {
  const indicatorDot = document.getElementById('indicator-dot');
  const labelStatus = document.getElementById('label-connection-status');
  const labelLatency = document.getElementById('label-ping-latency');

  const start = performance.now();
  try {
    const res = await fetch(`${currentServerUrl}/ping`, { cache: 'no-store' });
    const latency = Math.round(performance.now() - start);

    if (res.ok) {
      if (indicatorDot) indicatorDot.classList.remove('offline');
      if (labelStatus) labelStatus.textContent = 'ONLINE';
      if (labelLatency) labelLatency.textContent = `${latency} ms`;
      return true;
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    if (indicatorDot) indicatorDot.classList.add('offline');
    if (labelStatus) labelStatus.textContent = 'OFFLINE';
    if (labelLatency) labelLatency.textContent = 'Unreachable';
    return false;
  }
}

// ─── API 1: /api/metrics (Overview KPI) ───

async function fetchOverviewMetrics() {
  try {
    const res = await fetch(`${currentServerUrl}/api/metrics`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();

    // Active & Total Connections
    setText('val-active-peers', data.activeConnections || 0);
    setText('tag-active-peers', `${data.activeConnections || 0} Live`);
    setText('val-total-peers', `Total Lifetime: ${data.totalConnections || 0}`);

    // Active Rooms
    const activeRooms = Math.max(0, (data.totalRoomsCreated || 0) - (data.totalRoomsClosed || 0));
    setText('val-active-rooms', activeRooms);
    setText('tag-active-rooms', `${activeRooms} Rooms`);
    setText('val-total-rooms', `Created: ${data.totalRoomsCreated || 0}`);
    setText('val-closed-rooms', `Closed: ${data.totalRoomsClosed || 0}`);

    // Signaling Relays
    const totalSignals = (data.offersRelayed || 0) + (data.answersRelayed || 0) + (data.iceRelayed || 0);
    setText('val-total-relays', totalSignals.toLocaleString());
    setText('val-relays-breakdown', `Offers: ${data.offersRelayed || 0} | Answers: ${data.answersRelayed || 0} | ICE: ${data.iceRelayed || 0}`);

    // System Health
    setText('val-memory-allocated', `${(data.memoryAllocMB || 0).toFixed(2)} MB`);
    setText('val-uptime', `Uptime: ${data.uptime || '0s'}`);
    setText('val-goroutines', `${data.goroutines || 0} Goroutines`);
    if (data.goVersion) setText('tag-go-version', data.goVersion);

  } catch (err) {
    console.warn('Metrics fetch error:', err);
  }
}

// ─── API 2: /api/rooms (Room Mesh Topology) ───

async function fetchTopologyRooms() {
  try {
    const res = await fetch(`${currentServerUrl}/api/rooms`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();

    allRoomsCache = data.rooms || [];
    renderRoomsToContainer('container-overview-rooms', allRoomsCache, true);
    renderRoomsToContainer('container-topology-rooms', allRoomsCache, false);

    setText('badge-overview-room-count', `${allRoomsCache.length} Active`);
    setText('badge-topology-room-count', `${allRoomsCache.length} Active`);

  } catch (err) {
    console.warn('Rooms fetch error:', err);
  }
}

function renderRoomsToContainer(containerId, rooms, isSummaryView) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const searchInputId = containerId === 'container-topology-rooms' ? 'input-topology-search' : null;
  const searchQuery = searchInputId ? (document.getElementById(searchInputId)?.value || '').toLowerCase().trim() : '';

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
        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">
          Backbone Leaders: ${room.leaders && room.leaders.length > 0 ? room.leaders.map(lid => `<code>${escapeHtml(lid)}</code>`).join(', ') : 'None'}
        </div>
        <div class="peer-chips-list">
          ${peerChipsHtml || '<span style="font-size: 11px; color: var(--text-muted);">No peers connected</span>'}
        </div>
      </article>
    `;
  }).join('');
}

function filterTopologyRooms() {
  renderRoomsToContainer('container-topology-rooms', allRoomsCache, false);
}

// ─── API 3: /api/network (Signaling & Traffic Breakdown) ───

async function fetchSignalingDiagnostics() {
  try {
    const res = await fetch(`${currentServerUrl}/api/network`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();

    setText('val-traffic-offers', data.offersRelayed || 0);
    setText('val-traffic-answers', data.answersRelayed || 0);
    setText('val-traffic-ice', data.iceRelayed || 0);
    setText('val-traffic-pings', data.pingsReceived || 0);

    setText('tbl-offers', data.offersRelayed || 0);
    setText('tbl-answers', data.answersRelayed || 0);
    setText('tbl-ice', data.iceRelayed || 0);
    setText('tbl-pings', data.pingsReceived || 0);
    setText('tbl-rosters', data.rostersBroadcast || 0);
    setText('tbl-promotions', data.promotions || 0);
    setText('tbl-demotions', data.demotions || 0);
    setText('tbl-ratelimit-blocks', `${data.rateLimitBlocked || 0} blocked`);

    if (data.avgSignalRateSec !== undefined) {
      setText('tag-relay-rate', `${data.avgSignalRateSec.toFixed(1)} msg/s`);
    }

  } catch (err) {
    console.warn('Network diagnostics fetch error:', err);
  }
}

// ─── API 4: /api/system (Deep System & Memory Runtime) ───

async function fetchSystemDiagnostics() {
  try {
    const res = await fetch(`${currentServerUrl}/api/system`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();

    setText('sys-os', data.os || '--');
    setText('sys-arch', data.arch || '--');
    setText('sys-cpu', `${data.numCPU || '--'} Logical Cores`);
    setText('sys-goroutines', `${data.goroutines || 0} Goroutines`);
    setText('sys-goversion', data.goVersion || '--');
    setText('sys-pid', data.pid || '--');
    setText('sys-uptime', data.uptime || '--');

    setText('mem-alloc', `${(data.memoryAllocMB || 0).toFixed(2)} MB`);
    setText('mem-heap-inuse', `${(data.heapInUseMB || 0).toFixed(2)} MB`);
    setText('mem-heap-sys', `${(data.heapSysMB || 0).toFixed(2)} MB`);
    setText('mem-stack-inuse', `${(data.stackInUseMB || 0).toFixed(2)} MB`);
    setText('mem-sys', `${(data.sysMB || 0).toFixed(2)} MB`);
    setText('mem-gc-count', `${data.numGC || 0} cycles`);
    setText('mem-last-gc', data.lastGCTime || '--');
    setText('mem-next-gc', `${(data.nextGCMB || 0).toFixed(2)} MB`);

  } catch (err) {
    console.warn('System diagnostics fetch error:', err);
  }
}

// ─── API 5: /api/cluster (NATS Clustering State) ───

async function fetchClusterStatus() {
  try {
    const res = await fetch(`${currentServerUrl}/api/cluster`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();

    setText('cluster-mode', data.mode || 'in_memory_single_node');

  } catch (err) {
    console.warn('Cluster status fetch error:', err);
  }
}

// ─── API 6: /api/logs (Live Structured Log Streamer) ───

async function fetchServerLogs() {
  try {
    const url = activeLogFilter === 'ALL'
      ? `${currentServerUrl}/api/logs?limit=100`
      : `${currentServerUrl}/api/logs?level=${activeLogFilter}&limit=100`;

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return;
    const logs = await res.json();

    allLogsCache = logs || [];
    renderLogsToTerminal('terminal-overview-logs', allLogsCache.slice(-30));
    renderLogsToTerminal('terminal-logs-full', allLogsCache);

  } catch (err) {
    console.warn('Logs fetch error:', err);
  }
}

function renderLogsToTerminal(terminalId, logs) {
  const terminal = document.getElementById(terminalId);
  if (!terminal) return;

  const searchInput = document.getElementById('input-log-search');
  const query = (terminalId === 'terminal-logs-full' && searchInput) ? searchInput.value.toLowerCase().trim() : '';

  const filtered = logs.filter(l => {
    if (!query) return true;
    if (l.message && l.message.toLowerCase().includes(query)) return true;
    if (l.attrs && JSON.stringify(l.attrs).toLowerCase().includes(query)) return true;
    return false;
  });

  if (filtered.length === 0) {
    terminal.innerHTML = `
      <div class="empty-placeholder" style="padding: 24px;">
        No logs found for filter [${activeLogFilter}]
      </div>
    `;
    return;
  }

  terminal.innerHTML = filtered.map(l => {
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

function filterLogsList() {
  renderLogsToTerminal('terminal-logs-full', allLogsCache);
}

function setLogsFilter(level) {
  activeLogFilter = level;
  document.querySelectorAll('#tab-logs .filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === `btn-lvl-${level}`);
  });
  fetchServerLogs();
}

function toggleLogPause() {
  isStreamPaused = !isStreamPaused;
  const btn = document.getElementById('btn-toggle-stream');
  const icon = document.getElementById('label-pause-icon');

  if (btn && icon) {
    if (isStreamPaused) {
      icon.textContent = '▶';
      btn.innerHTML = `<span id="label-pause-icon">▶</span> Resume`;
      btn.style.borderColor = 'var(--accent-amber)';
      showToast('Live log stream paused');
    } else {
      icon.textContent = '⏸';
      btn.innerHTML = `<span id="label-pause-icon">⏸</span> Pause`;
      btn.style.borderColor = '';
      showToast('Live log stream resumed');
      fetchServerLogs();
    }
  }
}

async function clearServerLogs() {
  try {
    const res = await fetch(`${currentServerUrl}/api/logs`, { method: 'DELETE' });
    if (res.ok) {
      allLogsCache = [];
      renderLogsToTerminal('terminal-logs-full', []);
      showToast('Server ring buffer cleared successfully');
    }
  } catch (err) {
    showToast(`Error clearing logs: ${err.message}`);
  }
}

function exportLogsJson() {
  if (!allLogsCache || allLogsCache.length === 0) {
    showToast('No logs to export');
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    serverUrl: currentServerUrl,
    filterLevel: activeLogFilter,
    logCount: allLogsCache.length,
    logs: allLogsCache,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `synqto-logs-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Logs exported to JSON');
}

// ─── TAB 6: DEVOPS & TESTING SUITE ───

async function runHealthCheckProbe() {
  const terminal = document.getElementById('terminal-tool-output');
  appendTerminalLine(terminal, `Initiating GET ${currentServerUrl}/health probe...`, 'INFO');

  const start = performance.now();
  try {
    const res = await fetch(`${currentServerUrl}/health`);
    const rtt = Math.round(performance.now() - start);
    const body = await res.json();
    appendTerminalLine(terminal, `✓ HTTP 200 OK in ${rtt}ms: ${JSON.stringify(body)}`, 'INFO');
  } catch (err) {
    appendTerminalLine(terminal, `✗ Health probe failed: ${err.message}`, 'ERROR');
  }
}

async function runPingProbe() {
  const terminal = document.getElementById('terminal-tool-output');
  appendTerminalLine(terminal, `Initiating GET ${currentServerUrl}/ping pre-warm probe...`, 'INFO');

  const start = performance.now();
  try {
    const res = await fetch(`${currentServerUrl}/ping`);
    const rtt = Math.round(performance.now() - start);
    const body = await res.json();
    appendTerminalLine(terminal, `✓ HTTP 200 Pong in ${rtt}ms: ${JSON.stringify(body)}`, 'INFO');
  } catch (err) {
    appendTerminalLine(terminal, `✗ Ping probe failed: ${err.message}`, 'ERROR');
  }
}

function runSimulatedWebSocket() {
  const terminal = document.getElementById('terminal-sim-output');
  const btn = document.getElementById('btn-sim-connect');
  const roomId = document.getElementById('input-sim-room')?.value.trim() || 'room:test-console-diag';
  const nickname = document.getElementById('input-sim-nick')?.value.trim() || 'ConsoleTester';

  if (simulatedWs) {
    simulatedWs.close();
    simulatedWs = null;
    btn.textContent = 'Connect Test Peer';
    btn.classList.remove('btn-danger');
    appendTerminalLine(terminal, 'Simulated test peer disconnected.', 'WARN');
    return;
  }

  const wsUrl = currentServerUrl.replace(/^http/, 'ws') + `/ws/${encodeURIComponent(roomId)}`;
  appendTerminalLine(terminal, `Opening WebSocket connection to ${wsUrl}...`, 'INFO');

  try {
    simulatedWs = new WebSocket(wsUrl);

    simulatedWs.onopen = () => {
      btn.textContent = 'Disconnect Peer';
      btn.classList.add('btn-danger');
      appendTerminalLine(terminal, `✓ WebSocket Handshake Upgrade 101 Switching Protocols`, 'INFO');

      // Send join message
      const generatedPeerId = 'sim-peer-' + Math.random().toString(36).substring(2, 8);
      const joinMsg = {
        type: 'room:join',
        roomId: roomId,
        payload: {
          peerId: generatedPeerId,
          nickname: nickname
        }
      };
      simulatedWs.send(JSON.stringify(joinMsg));
      appendTerminalLine(terminal, `→ Sent room:join message (PeerID: ${generatedPeerId}, Nick: ${nickname})`, 'INFO');
    };

    simulatedWs.onmessage = (event) => {
      const raw = event.data.toString();
      const matches = raw.match(/\{.*?\}(?=\{|$)/g) || [raw];
      for (const str of matches) {
        try {
          const msg = JSON.parse(str);
          appendTerminalLine(terminal, `← Received message: type=${msg.type} from=${msg.from || 'server'}`, 'INFO');
        } catch (e) {
          appendTerminalLine(terminal, `← Received raw: ${str}`, 'INFO');
        }
      }
    };

    simulatedWs.onerror = (err) => {
      appendTerminalLine(terminal, `✗ WebSocket Error`, 'ERROR');
    };

    simulatedWs.onclose = (e) => {
      btn.textContent = 'Connect Test Peer';
      btn.classList.remove('btn-danger');
      appendTerminalLine(terminal, `WebSocket closed (Code: ${e.code}, Reason: ${e.reason || 'Normal'})`, 'WARN');
      simulatedWs = null;
    };

  } catch (err) {
    appendTerminalLine(terminal, `Failed to initialize WebSocket: ${err.message}`, 'ERROR');
  }
}

function appendTerminalLine(terminal, text, level = 'INFO') {
  if (!terminal) return;
  const time = new Date().toTimeString().split(' ')[0];
  const row = document.createElement('div');
  row.className = 'log-entry';
  row.innerHTML = `
    <span class="log-timestamp">[${time}]</span>
    <span class="log-level-badge log-level-${level}">${level}</span>
    <span class="log-message-text">${escapeHtml(text)}</span>
  `;
  terminal.appendChild(row);
  terminal.scrollTop = terminal.scrollHeight;
}

// ─── Helpers ───

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 2800);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
