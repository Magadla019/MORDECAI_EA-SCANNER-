// MORDECAI_EA SCANNER - frontend app logic
// This file only ever calls read/analysis endpoints on the backend.
// There is no code path anywhere in this app that sends a trade-execution
// command. All trades are placed manually by the user inside MT5.

const STORAGE = {
  token: 'mordecai_token',
  backendUrl: 'mordecai_backend_url',
  theme: 'mordecai_theme',
  running: 'mordecai_running'
};

const state = {
  token: localStorage.getItem(STORAGE.token) || null,
  backendUrl: localStorage.getItem(STORAGE.backendUrl) || '',
  running: localStorage.getItem(STORAGE.running) === 'true',
  authMode: 'login',
  pollTimer: null
};

// ---------------- logo wiring (base64-embedded, never depends on file paths) ----------------
function wireLogos() {
  const src = window.MORDECAI_LOGO_HERO || 'icons/icon-512.png';
  const avatarSrc = window.MORDECAI_LOGO_AVATAR || 'icons/icon-192.png';
  ['login-avatar', 'hero-avatar'].forEach(id => { const el = document.getElementById(id); if (el) el.src = src; });
  ['header-avatar', 'list-avatar'].forEach(id => { const el = document.getElementById(id); if (el) el.src = avatarSrc; });
  const bg = document.getElementById('bg-layer');
  if (bg) bg.style.backgroundImage = `url(${src})`;
}
wireLogos();

// ---------------- helpers ----------------
function api(path, opts = {}) {
  if (!state.backendUrl) throw new Error('Set your backend URL in Settings first');
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  if (!(opts.body instanceof FormData) && opts.body) headers['Content-Type'] = 'application/json';
  return fetch(state.backendUrl.replace(/\/$/, '') + path, { ...opts, headers })
    .then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
      return data;
    });
}

function money(n, currency = '') {
  if (n === null || n === undefined) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(2)} ${currency}`.trim();
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

// ---------------- view navigation ----------------
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  closeDrawer();
  if (name === 'live') refreshLive();
  if (name === 'performance') refreshPerformance();
  if (name === 'signals') refreshSignals();
  if (name === 'mt5') refreshMt5View();
  if (name === 'settings') document.getElementById('settings-backend-url').value = state.backendUrl;
}

document.querySelectorAll('[data-view]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.view));
});
document.querySelectorAll('[data-back]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.back));
});

// ---------------- drawer ----------------
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
document.getElementById('open-menu').addEventListener('click', () => {
  drawer.classList.remove('hidden'); drawerOverlay.classList.remove('hidden');
});
function closeDrawer() { drawer.classList.add('hidden'); drawerOverlay.classList.add('hidden'); }
drawerOverlay.addEventListener('click', closeDrawer);
document.getElementById('drawer-logout').addEventListener('click', logout);

// ---------------- auth ----------------
const authModeLabel = document.getElementById('auth-mode-label');
const authSubmit = document.getElementById('auth-submit');
const authToggle = document.getElementById('auth-toggle');
const authError = document.getElementById('auth-error');

authToggle.addEventListener('click', () => {
  state.authMode = state.authMode === 'login' ? 'register' : 'login';
  authModeLabel.textContent = state.authMode === 'login' ? 'Sign In' : 'Create Account';
  authSubmit.textContent = state.authMode === 'login' ? 'SIGN IN' : 'REGISTER';
  authToggle.textContent = state.authMode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in';
});

authSubmit.addEventListener('click', async () => {
  authError.textContent = '';
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!state.backendUrl) {
    // allow first-time setup: prompt inline before any account exists
    const url = prompt('Enter your backend URL first (from Settings, e.g. https://your-backend.onrender.com):');
    if (!url) return;
    state.backendUrl = url;
    localStorage.setItem(STORAGE.backendUrl, url);
  }
  try {
    const data = await api(`/api/auth/${state.authMode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
    state.token = data.token;
    localStorage.setItem(STORAGE.token, data.token);
    showView('dashboard');
    startPolling();
  } catch (e) {
    authError.textContent = e.message;
  }
});

function logout() {
  localStorage.removeItem(STORAGE.token);
  state.token = null;
  stopPolling();
  closeDrawer();
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-login').classList.add('active');
}
document.getElementById('btn-logout').addEventListener('click', logout);

// ---------------- theme ----------------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('selected', s.dataset.theme === theme));
  localStorage.setItem(STORAGE.theme, theme);
}
document.querySelectorAll('.swatch').forEach(s => s.addEventListener('click', () => applyTheme(s.dataset.theme)));
applyTheme(localStorage.getItem(STORAGE.theme) || 'red');

// ---------------- settings ----------------
document.getElementById('btn-save-backend').addEventListener('click', () => {
  const url = document.getElementById('settings-backend-url').value.trim();
  state.backendUrl = url;
  localStorage.setItem(STORAGE.backendUrl, url);
  alert('Backend URL saved.');
});

// ---------------- START / STOP ----------------
const engineList = document.getElementById('engine-list');
const ENGINES = ['MARKET STRUCTURE','LIQUIDITY ENGINE','ORDER BLOCK ENGINE','FVG ENGINE','MOMENTUM ENGINE',
                  'EMA FILTER','ATR ENGINE','SESSION ENGINE','NEWS ENGINE','RISK ENGINE'];

function renderEngines(active) {
  engineList.innerHTML = ENGINES.map(name =>
    `<div class="engine"><span>${name}</span><span class="state ${active ? 'active' : 'inactive'}">${active ? 'ACTIVE' : 'INACTIVE'}</span></div>`
  ).join('');
}

function setRunning(running) {
  state.running = running;
  localStorage.setItem(STORAGE.running, String(running));

  const runState = document.getElementById('run-state');
  runState.className = 'run-state ' + (running ? 'running' : 'stopped');
  runState.innerHTML = `<span class="run-dot"></span>${running ? 'RUNNING ●' : 'NOT RUNNING'}`;

  const mainBtn = document.getElementById('btn-toggle-run');
  mainBtn.classList.toggle('is-running', running);
  document.getElementById('toggle-glyph').innerHTML = running
    ? '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="5" y="5" width="14" height="14" rx="2" fill="#fff"/></svg>'
    : '<svg viewBox="0 0 24 24" width="26" height="26"><polygon points="7,4 20,12 7,20" fill="#fff"/></svg>';
  document.getElementById('toggle-label').textContent = running ? 'STOP' : 'START';

  const lrStatus = document.getElementById('lr-status');
  if (lrStatus) { lrStatus.textContent = running ? 'RUNNING' : 'STOPPED'; lrStatus.classList.toggle('run-color', running); }

  renderEngines(running);
}

document.getElementById('btn-toggle-run').addEventListener('click', async () => {
  if (!state.running) {
    document.getElementById('run-state').innerHTML = '<span class="run-dot"></span>SYNCING…';
    try { await refreshMt5Status(); } catch {}
    setRunning(true);
  } else {
    // STOP only pauses scanning/polling in this app. It never touches MT5 positions -
    // there is no code path here or in the backend that can close/modify a trade.
    setRunning(false);
  }
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('Reset the local session? This stops the scanner but does not delete your synced MT5 history or performance data.')) {
    setRunning(false);
  }
});

// ---------------- MT5 status polling ----------------
async function refreshMt5Status() {
  if (!state.backendUrl) return null;
  try {
    const s = await api('/api/sync/status');
    document.getElementById('stat-mt5').textContent = s.connected ? 'CONNECTED' : 'DISCONNECTED';
    document.getElementById('stat-cloud').textContent = 'CONNECTED';
    document.getElementById('stat-lastsync').textContent = fmtTime(s.lastSync);
    if (s.openPositions?.[0]) document.getElementById('stat-symbol').textContent = s.openPositions[0].symbol;
    return s;
  } catch (e) {
    document.getElementById('stat-cloud').textContent = 'CLOUD OFFLINE';
    return null;
  }
}

function startPolling() {
  refreshMt5Status();
  refreshDashboardExtras();
  stopPolling();
  state.pollTimer = setInterval(() => { refreshMt5Status(); refreshDashboardExtras(); }, 8000);
}
function stopPolling() { if (state.pollTimer) clearInterval(state.pollTimer); }

async function refreshDashboardExtras() {
  const s = await refreshMt5Status().catch(() => null);
  const symLabel = document.getElementById('lr-live-symbol');
  if (symLabel) symLabel.textContent = s?.openPositions?.[0]?.symbol ? `${s.openPositions[0].symbol} · Live` : 'No open positions';

  const plEl = document.getElementById('lr-pl');
  const sparkEl = document.getElementById('lr-spark');
  try {
    const sum = await api('/api/performance/summary');
    if (sum.hasData) {
      plEl.textContent = money(sum.todayPL);
      plEl.className = 'lr-value mono ' + (sum.todayPL >= 0 ? 'pos' : 'neg');
      drawSparkline(sparkEl, sum.equityCurve || []);
    } else {
      plEl.textContent = '—';
      drawSparkline(sparkEl, []);
    }
  } catch {
    if (plEl) plEl.textContent = '—';
    if (sparkEl) drawSparkline(sparkEl, []);
  }
}

// Draws only from real synced equity-curve points - never fabricated data.
// With no data it draws a flat neutral line rather than inventing a trend.
function drawSparkline(svgEl, points) {
  if (!svgEl) return;
  if (!points.length) {
    svgEl.innerHTML = `<line x1="0" y1="14" x2="80" y2="14" stroke="currentColor" stroke-dasharray="2,3" opacity="0.3"/>`;
    return;
  }
  const values = points.map(p => p.equity ?? p.balance ?? 0);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const step = 80 / Math.max(1, values.length - 1);
  const path = values.map((v, i) => `${(i * step).toFixed(1)},${(26 - ((v - min) / range) * 24).toFixed(1)}`).join(' ');
  svgEl.innerHTML = `<polyline points="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// ---------------- MT5 connection view: login tab vs EA tab ----------------
document.querySelectorAll('[data-mt5tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-mt5tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('mt5tab-login').classList.toggle('hidden', btn.dataset.mt5tab !== 'login');
    document.getElementById('mt5tab-ea').classList.toggle('hidden', btn.dataset.mt5tab !== 'ea');
  });
});

document.getElementById('btn-link-mt5').addEventListener('click', async () => {
  const login = document.getElementById('link-login').value.trim();
  const investorPassword = document.getElementById('link-password').value;
  const server = document.getElementById('link-server').value.trim();
  const errEl = document.getElementById('link-error');
  errEl.textContent = '';

  if (!login || !investorPassword || !server) {
    errEl.textContent = 'Login, investor password, and server are all required.';
    return;
  }

  const btn = document.getElementById('btn-link-mt5');
  btn.textContent = 'LINKING…';
  try {
    await api('/api/mt5/link', { method: 'POST', body: JSON.stringify({ login, investorPassword, server }) });
    document.getElementById('link-password').value = '';
    await refreshMt5View();
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.textContent = 'LINK MT5 ACCOUNT DETAILS';
  }
});

document.getElementById('btn-refresh-mt5').addEventListener('click', async () => {
  try {
    const s = await api('/api/sync/status');
    if (s.connectionId) await api(`/api/mt5/${s.connectionId}/refresh`, { method: 'POST' });
    await refreshMt5View();
  } catch (e) { alert(e.message); }
});

// ---------------- MT5 connection view ----------------
document.getElementById('btn-pair').addEventListener('click', async () => {
  try {
    const data = await api('/api/auth/mt5/pair', { method: 'POST' });
    document.getElementById('pairing-token').value = data.deviceToken;
    document.getElementById('pairing-token-box').classList.remove('hidden');
  } catch (e) { alert(e.message); }
});

document.getElementById('btn-mt5-logout').addEventListener('click', async () => {
  try {
    const s = await api('/api/sync/status');
    await api('/api/auth/mt5/logout', { method: 'POST', body: JSON.stringify({ connectionId: s.connectionId }) });
    refreshMt5View();
  } catch (e) { alert(e.message); }
});

async function refreshMt5View() {
  const s = await refreshMt5Status();
  const connected = s?.connected;
  document.getElementById('mt5-disconnected-card').classList.toggle('hidden', !!connected);
  document.getElementById('mt5-connected-card').classList.toggle('hidden', !connected);
  if (connected) {
    document.getElementById('mt5-method').textContent = s.linkMethod === 'login' ? 'LOGIN (MetaApi)' : 'EA / VPS';
    document.getElementById('mt5-broker').textContent = s.broker || '—';
    document.getElementById('mt5-account').textContent = s.account || '—';
    document.getElementById('mt5-server').textContent = s.server || '—';
    document.getElementById('mt5-currency').textContent = s.currency || '—';
    document.getElementById('mt5-balance').textContent = money(s.balance, s.currency);
    document.getElementById('mt5-equity').textContent = money(s.equity, s.currency);
    document.getElementById('mt5-lastsync').textContent = fmtTime(s.lastSync);
    document.getElementById('btn-refresh-mt5').classList.toggle('hidden', s.linkMethod !== 'login');
  }
}

// ---------------- Live trading view ----------------
async function refreshLive() {
  const s = await refreshMt5Status();
  const badge = document.getElementById('live-conn-badge');
  badge.textContent = s?.connected ? '● CONNECTED' : '● OFFLINE';
  document.getElementById('live-balance').textContent = s ? money(s.balance, s.currency) : '—';
  document.getElementById('live-equity').textContent = s ? money(s.equity, s.currency) : '—';
  const positions = s?.openPositions || [];
  document.getElementById('live-openpos').textContent = positions.length;
  const floating = positions.reduce((sum, p) => sum + (p.profit || 0), 0);
  const flEl = document.getElementById('live-floating');
  flEl.textContent = positions.length ? money(floating, s.currency) : '—';
  flEl.className = 'val mono ' + (floating > 0 ? 'pos' : floating < 0 ? 'neg' : '');

  const list = document.getElementById('live-positions-list');
  list.innerHTML = positions.length ? positions.map(p => `
    <div class="row">
      <span class="label">${p.symbol} · ${p.type?.toUpperCase()} ${p.volume}</span>
      <span class="val mono ${p.profit >= 0 ? 'pos' : 'neg'}">${money(p.profit)}</span>
    </div>`).join('') : '<p class="footer-note">No open positions.</p>';
}

// ---------------- Performance view ----------------
async function refreshPerformance() {
  try {
    const sum = await api('/api/performance/summary');
    if (!sum.hasData) {
      ['perf-today','perf-week','perf-month','perf-winrate','perf-pf','perf-total'].forEach(id => document.getElementById(id).textContent = '—');
      document.getElementById('perf-history-list').innerHTML = '<p class="footer-note">No synced trades yet. Connect MT5 and press START.</p>';
      return;
    }
    document.getElementById('perf-today').textContent = money(sum.todayPL);
    document.getElementById('perf-week').textContent = money(sum.weekPL);
    document.getElementById('perf-month').textContent = money(sum.monthPL);
    document.getElementById('perf-winrate').textContent = `${sum.winRate}%`;
    document.getElementById('perf-pf').textContent = sum.profitFactor ? sum.profitFactor.toFixed(2) : '—';
    document.getElementById('perf-total').textContent = sum.totalTrades;

    const hist = await api('/api/performance/history');
    const list = document.getElementById('perf-history-list');
    list.innerHTML = hist.trades.length ? hist.trades.slice(0, 30).map(t => `
      <div class="row">
        <span class="label">${t.symbol} · ${t.direction?.toUpperCase()} ${t.volume} · ${new Date(t.closed_at).toLocaleDateString()}</span>
        <span class="val mono ${t.profit >= 0 ? 'pos' : 'neg'}">${money(t.profit)}</span>
      </div>`).join('') : '<p class="footer-note">No synced trades yet.</p>';
  } catch (e) {
    document.getElementById('perf-history-list').innerHTML = `<p class="footer-note">${e.message}</p>`;
  }
}

// ---------------- Signal history view ----------------
async function refreshSignals() {
  const list = document.getElementById('signals-list');
  try {
    const signals = await api('/api/signals');
    list.innerHTML = signals.length ? signals.map(s => `
      <div class="card">
        <div class="row"><span class="label mono">${s.setup_id}</span><span class="badge">${s.status}</span></div>
        <div class="row"><span class="label">${s.symbol}</span><span class="val ${s.direction === 'buy' ? 'pos' : s.direction === 'sell' ? 'neg' : ''}">${s.direction?.toUpperCase()}</span></div>
        <div class="row"><span class="label">Confidence</span><span class="val mono">${s.confidence ?? '—'}/100</span></div>
        <div class="row"><span class="label">RR</span><span class="val mono">${s.risk_reward ? '1:' + s.risk_reward : '—'}</span></div>
      </div>`).join('') : '<p class="footer-note">No signals yet.</p>';
  } catch (e) {
    list.innerHTML = `<p class="footer-note">${e.message}</p>`;
  }
}

// ---------------- Analytics / screenshot analysis ----------------
let selectedFile = null;
const uploadZone = document.getElementById('upload-zone');
document.getElementById('an-file').addEventListener('change', (e) => {
  selectedFile = e.target.files[0];
  if (!selectedFile) return;
  const reader = new FileReader();
  reader.onload = () => {
    uploadZone.classList.add('has-image');
    uploadZone.innerHTML = `<img src="${reader.result}">`;
  };
  reader.readAsDataURL(selectedFile);
});

const SCAN_STEPS = [
  'Scanning market structure', 'Mapping liquidity zones', 'Detecting order blocks',
  'Detecting FVG', 'Running AI pattern recognition', 'Validating volume & momentum',
  'Calculating risk/reward', 'Finalizing signal'
];

document.getElementById('btn-analyze').addEventListener('click', async () => {
  if (!selectedFile) return alert('Upload a chart screenshot first.');
  const symbol = document.getElementById('an-symbol').value;

  document.getElementById('analytics-form-card').classList.add('hidden');
  document.getElementById('analytics-result-card').classList.add('hidden');
  document.getElementById('analytics-insufficient-card').classList.add('hidden');
  const scanCard = document.getElementById('analytics-scanning-card');
  scanCard.classList.remove('hidden');
  document.getElementById('scan-symbol-label').textContent = symbol;

  const stepsEl = document.getElementById('scan-steps');
  stepsEl.innerHTML = SCAN_STEPS.map(s => `<div class="scan-step" data-step="${s}"><span>○</span> ${s}</div>`).join('');
  const progress = document.getElementById('scan-progress');

  // Visual step-through while the real API call runs in parallel
  let i = 0;
  const stepTimer = setInterval(() => {
    if (i >= SCAN_STEPS.length) return;
    const rows = stepsEl.querySelectorAll('.scan-step');
    rows[i].classList.add('done');
    rows[i].querySelector('span').textContent = '✓';
    rows[i].querySelector('span').classList.add('check');
    i++;
    progress.style.width = `${Math.min(100, (i / SCAN_STEPS.length) * 100)}%`;
  }, 500);

  const formData = new FormData();
  formData.append('screenshot', selectedFile);
  formData.append('symbol', symbol);
  formData.append('timeframe', document.getElementById('an-timeframe').value);
  formData.append('balance', document.getElementById('an-balance').value);
  formData.append('lotSize', document.getElementById('an-lot').value);
  formData.append('positions', document.getElementById('an-positions').value);
  formData.append('riskPercent', document.getElementById('an-risk').value);
  formData.append('targetPips', document.getElementById('an-target').value);

  try {
    const result = await api('/api/analyze/screenshot', { method: 'POST', body: formData });
    clearInterval(stepTimer);
    progress.style.width = '100%';
    setTimeout(() => {
      scanCard.classList.add('hidden');
      if (result.insufficient_data) {
        document.getElementById('insufficient-list').innerHTML =
          (result.missing_info || []).map(m => `<li>${m}</li>`).join('') || '<li>Chart data unclear.</li>';
        document.getElementById('analytics-insufficient-card').classList.remove('hidden');
      } else {
        renderResult(result);
        document.getElementById('analytics-result-card').classList.remove('hidden');
      }
    }, 400);
  } catch (e) {
    clearInterval(stepTimer);
    scanCard.classList.add('hidden');
    document.getElementById('analytics-form-card').classList.remove('hidden');
    alert(e.message);
  }
});

function renderResult(r) {
  const ring = document.getElementById('conf-ring');
  ring.style.setProperty('--pct', r.confidence || 0);
  document.getElementById('conf-num').textContent = r.confidence ?? '—';

  const verdictEl = document.getElementById('result-verdict');
  verdictEl.textContent = r.verdict || 'NO TRADE';
  verdictEl.className = 'verdict ' + (r.direction === 'buy' ? 'buy' : r.direction === 'sell' ? 'sell' : 'no');
  document.getElementById('result-rr').textContent = r.risk_reward ? `Risk/Reward 1:${r.risk_reward}` : 'This is analysis, not a guaranteed outcome.';

  const rows = [
    ['Direction', r.direction?.toUpperCase() || '—'],
    ['Entry', r.entry_low && r.entry_high ? `${r.entry_low} – ${r.entry_high}` : '—'],
    ['Stop Loss', r.stop_loss ?? '—'],
    ['TP1', r.tp1 ?? '—'], ['TP2', r.tp2 ?? '—'], ['TP3', r.tp3 ?? '—'],
    ['Market Structure', r.market_structure || '—'],
    ['Liquidity', r.liquidity || '—'],
    ['Trend', r.trend || '—'],
    ['Momentum', r.momentum || '—'],
  ];
  document.getElementById('result-rows').innerHTML = rows.map(([l, v]) =>
    `<div class="row"><span class="label">${l}</span><span class="val mono">${v}</span></div>`).join('');

  const conflictEl = document.getElementById('result-conflict');
  if (r.target_conflict) {
    conflictEl.textContent = `TARGET CONFLICT: ${r.target_conflict}`;
    conflictEl.classList.remove('hidden');
  } else {
    conflictEl.classList.add('hidden');
  }

  document.getElementById('result-reasoning').innerHTML = (r.reasoning || [])
    .map(x => `<div class="scan-step done"><span class="check">✓</span> ${x}</div>`).join('') || '<p class="footer-note">No confluence details returned.</p>';
}

// ---------------- boot ----------------
// Registration/login is temporarily bypassed - the app opens straight to the
// dashboard. Re-enable by restoring the token check below once auth is wired
// back in. Backend calls that need a token (MT5 status, performance, signals)
// already fail gracefully and just show offline/empty states without one.
renderEngines(false);
showView('dashboard');
startPolling();
setRunning(state.running);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

// ---------------- Install prompt (fires only once Chrome deems the app eligible) ----------------
let deferredInstallPrompt = null;
const installBanner = document.getElementById('install-banner');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBanner.classList.remove('hidden');
});

installBanner.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  installBanner.classList.add('hidden');
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});

window.addEventListener('appinstalled', () => {
  installBanner.classList.add('hidden');
  deferredInstallPrompt = null;
});
