// app.js — BMS Monitor frontend logic (mobile-first)

function getVaultKey() {
  let key = localStorage.getItem('bms_vault_key');
  if (!key) {
    key = 'vlt_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('bms_vault_key', key);
  }
  return key;
}

// Automatically attach private vault key to all requests
const _origFetch = window.fetch;
window.fetch = function(url, options = {}) {
  options = { ...options };
  options.headers = options.headers || {};
  if (options.headers instanceof Headers) {
    options.headers.set('X-Vault-Key', getVaultKey());
  } else {
    options.headers['X-Vault-Key'] = getVaultKey();
  }
  return _origFetch(url, options);
};

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  filters:     { theatres: [], dates: [], timeFrom: '', timeTo: '' },
  editFilters: { theatres: [], dates: [] },
  cleanedUrl:  '',
  activeTab:   'monitors',  // mobile active tab
};

// ── Init ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadEmailConfig();
  loadMonitors();
  loadTheatreSuggestions();           // populate Add form datalist
  // On mobile, default to "monitors" tab
  if (isMobile()) switchTab('monitors');
  // Auto-refresh every 30 s
  setInterval(loadMonitors, 30_000);
});

// ── Theatre presets & autocomplete ─────────────────────────────────────────
const PRESET_THEATRES = [
  "Asian Lakshmikala Cinepride: Moosapet",
  "Miraj Cinemas: Cine Town, Miyapur",
  "Mallikarjuna 70mm A/C DTS: Kukatpally",
  "Bhramaramba 70MM A/C 4K Dolby: Kukatpally",
  "Cinepolis: Lulu Mall, Hyderabad",
];

function addPresetTheatre(selectEl, mode) {
  const val = selectEl.value;
  if (!val) return;
  if (mode === 'add') {
    if (!state.filters.theatres.includes(val)) {
      state.filters.theatres.push(val);
      renderTags('theatreTags', state.filters.theatres, 'theatre', removeFilter);
      updateFilterBadge();
    }
  } else if (mode === 'edit') {
    if (!state.editFilters.theatres.includes(val)) {
      state.editFilters.theatres.push(val);
      renderEditTags('editTheatreTags', state.editFilters.theatres, 'theatre');
    }
  }
  selectEl.value = '';
}

// Fetches all known theatre names from every monitor's snapshot
// and populates the <datalist> for the Add form.
async function loadTheatreSuggestions() {
  try {
    const res      = await api('GET', '/api/theatres');
    const theatres = await res.json();
    const all = Array.from(new Set([...PRESET_THEATRES, ...theatres]));
    populateDatalist('theatreSuggestions', all);
  } catch {
    populateDatalist('theatreSuggestions', PRESET_THEATRES);
  }
}

// Fetches theatre names from a specific monitor's snapshot
// and populates the <datalist> for the Edit modal.
async function loadEditTheatreSuggestions(monitorId) {
  try {
    const res      = await api('GET', `/api/monitors/${monitorId}/theatres`);
    const theatres = await res.json();
    const all = Array.from(new Set([...PRESET_THEATRES, ...theatres]));
    populateDatalist('editTheatreSuggestions', all);
  } catch {
    populateDatalist('editTheatreSuggestions', PRESET_THEATRES);
  }
}

function populateDatalist(datalistId, options) {
  const dl = document.getElementById(datalistId);
  if (!dl) return;
  dl.innerHTML = options
    .map(t => `<option value="${esc(t)}">`)
    .join('');
}

function isMobile() { return window.innerWidth < 640; }

// ── Mobile tab switching ───────────────────────────────────────────────────
function switchTab(tab) {
  state.activeTab = tab;
  const add      = document.getElementById('panelAdd');
  const monitors = document.getElementById('panelMonitors');

  if (!isMobile()) {
    add.classList.remove('hidden');
    monitors.classList.remove('hidden');
    return;
  }

  add.classList.toggle('hidden', tab !== 'add');
  monitors.classList.toggle('hidden', tab !== 'monitors');

  // Update tab bar active state
  ['add', 'monitors'].forEach(t => {
    document.getElementById(`btn-${t}`)?.classList.toggle('active', t === tab);
  });
}

window.addEventListener('resize', () => {
  if (!isMobile()) {
    document.getElementById('panelAdd').classList.remove('hidden');
    document.getElementById('panelMonitors').classList.remove('hidden');
  } else {
    switchTab(state.activeTab);
  }
});

// ── Toast ──────────────────────────────────────────────────────────────────
let _toastTimer = null;
function toast(msg, type = 'info') {
  const el  = document.getElementById('toast');
  const box = document.getElementById('toastMsg');
  const cls = {
    info:    'text-zinc-100',
    success: 'text-green-300',
    error:   'text-red-400',
  };
  box.className = `bg-zinc-800/95 border border-zinc-700 rounded-2xl px-4 py-3 text-sm shadow-xl slide-up max-w-xs backdrop-blur ${cls[type] || ''}`;
  box.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ── URL cleaning ───────────────────────────────────────────────────────────
function onUrlInput(value) {
  const hasBms = /https?:\/\/in\.bookmyshow\.com\//i.test(value);
  // Extra text = more than just the URL (multiline share text)
  const extraText = hasBms && (value.trim().includes('\n') ||
    value.trim() !== (value.match(/https?:\/\/in\.bookmyshow\.com\/[^\s]*/i)?.[0] || ''));

  document.getElementById('cleanBtnWrap').classList.toggle('hidden', !extraText);
  document.getElementById('urlPreview').classList.add('hidden');

  // If it's already a clean BMS URL, auto-parse
  const clean = value.trim().match(/^https?:\/\/in\.bookmyshow\.com\/[^\s]+$/i);
  if (clean) {
    state.cleanedUrl = clean[0];
    showUrlPreview(state.cleanedUrl);
    autoDetect(state.cleanedUrl);
  } else {
    state.cleanedUrl = '';
  }
}

async function cleanUrl() {
  const text = document.getElementById('urlInput').value;
  const btn  = document.getElementById('cleanBtn');
  btn.innerHTML = '<span class="spin">⟳</span> Extracting…';
  btn.disabled  = true;
  try {
    const res  = await api('POST', '/api/clean-url', { text });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'No URL found', 'error'); return; }
    state.cleanedUrl = data.url;
    document.getElementById('urlInput').value = data.url;
    document.getElementById('cleanBtnWrap').classList.add('hidden');
    showUrlPreview(data.url);
    if (data.name) document.getElementById('movieName').value = data.name;
    if (data.city) document.getElementById('movieCity').value = data.city;
    if (data.language) document.getElementById('movieLanguage').value = data.language;
    toast('✓ URL extracted!', 'success');
  } catch { toast('Network error', 'error'); }
  finally {
    btn.innerHTML = '<span>🧹</span> <span>Extract BookMyShow URL</span>';
    btn.disabled  = false;
  }
}

function showUrlPreview(url) {
  document.getElementById('urlPreviewText').textContent = url;
  document.getElementById('urlPreview').classList.remove('hidden');
}

async function autoDetect(url) {
  try {
    const res  = await api('POST', '/api/clean-url', { text: url });
    const data = await res.json();
    if (res.ok) {
      if (data.name && !document.getElementById('movieName').value)
        document.getElementById('movieName').value = data.name;
      if (data.city && !document.getElementById('movieCity').value)
        document.getElementById('movieCity').value = data.city;
      if (data.language && !document.getElementById('movieLanguage').value)
        document.getElementById('movieLanguage').value = data.language;
    }
  } catch { /* silent */ }
}

function togglePresetChip(val, btn) {
  const idx = state.filters.theatres.indexOf(val);
  if (idx >= 0) {
    state.filters.theatres.splice(idx, 1);
  } else {
    state.filters.theatres.push(val);
  }
  renderTags('theatreTags', state.filters.theatres, 'theatre', removeFilter);
  syncPresetChips();
  updateFilterBadge();
}

function syncPresetChips() {
  document.querySelectorAll('.preset-chip').forEach(btn => {
    const text = btn.textContent || '';
    const isSelected = state.filters.theatres.some(t => {
      if (text.includes('Moosapet')) return t.includes('Moosapet');
      if (text.includes('Miyapur')) return t.includes('Miyapur');
      if (text.includes('Mallikarjuna Kukatpally')) return t.includes('Mallikarjuna');
      if (text.includes('Bhramaramba Kukatpally')) return t.includes('Bhramaramba');
      if (text.includes('Lulu Mall')) return t.includes('Lulu Mall');
      return false;
    });
    if (isSelected) {
      btn.className = 'preset-chip chip bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-700/80 py-1 px-2.5 text-xs transition active:scale-95 font-medium';
    } else {
      btn.className = 'preset-chip chip bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/60 py-1 px-2.5 text-xs transition active:scale-95';
    }
  });
}

function setTimePreset(from, to, btn) {
  document.getElementById('timeFrom').value = from;
  document.getElementById('timeTo').value   = to;
  document.querySelectorAll('.time-preset-btn').forEach(b => {
    b.classList.remove('bg-bms/20', 'border-bms/60', 'text-bms', 'font-semibold');
    b.classList.add('bg-zinc-800/80', 'border-zinc-700/60', 'text-zinc-300');
  });
  if (btn) {
    btn.classList.remove('bg-zinc-800/80', 'border-zinc-700/60', 'text-zinc-300');
    btn.classList.add('bg-bms/20', 'border-bms/60', 'text-bms', 'font-semibold');
  }
  updateFilterBadge();
}

// ── Filter management ──────────────────────────────────────────────────────
function toggleFilters() {
  const panel   = document.getElementById('filtersPanel');
  const chevron = document.getElementById('filterChevron');
  const open    = panel.classList.toggle('hidden');
  chevron.style.transform = open ? '' : 'rotate(180deg)';
}

function addFilter(type) {
  if (type === 'theatre') {
    const inp = document.getElementById('theatreInput');
    const v   = inp.value.trim();
    if (!v || state.filters.theatres.includes(v)) { inp.value = ''; return; }
    state.filters.theatres.push(v); inp.value = '';
    renderTags('theatreTags', state.filters.theatres, 'theatre', removeFilter);
  } else {
    const inp = document.getElementById('dateInput');
    const v   = inp.value;
    if (!v || state.filters.dates.includes(v)) { inp.value = ''; return; }
    state.filters.dates.push(v); inp.value = '';
    renderTags('dateTags', state.filters.dates, 'date', removeFilter);
  }
  syncPresetChips();
  updateFilterBadge();
}

function removeFilter(type, val) {
  if (type === 'theatre') state.filters.theatres = state.filters.theatres.filter(v => v !== val);
  else                    state.filters.dates    = state.filters.dates.filter(v => v !== val);
  renderTags(type === 'theatre' ? 'theatreTags' : 'dateTags',
             type === 'theatre' ? state.filters.theatres : state.filters.dates,
             type, removeFilter);
  syncPresetChips();
  updateFilterBadge();
}

function renderTags(containerId, items, type, removeFn) {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  items.forEach(val => {
    const label = type === 'date' ? fmtDate(val) : val;
    const span  = document.createElement('span');
    span.className = 'chip bg-zinc-700 text-zinc-300 text-xs hover:bg-red-900/40 hover:text-red-300 transition cursor-pointer';
    span.innerHTML = `${esc(label)} <span class="ml-0.5 text-zinc-500" onclick="removeFilter('${type}','${esc(val)}')">✕</span>`;
    c.appendChild(span);
  });
}

function updateFilterBadge() {
  state.filters.timeFrom = document.getElementById('timeFrom').value;
  state.filters.timeTo   = document.getElementById('timeTo').value;
  const n = state.filters.theatres.length + state.filters.dates.length +
            (state.filters.timeFrom || state.filters.timeTo ? 1 : 0);
  const b = document.getElementById('filterBadge');
  b.textContent = `${n} active`;
  b.classList.toggle('hidden', n === 0);
}

// ── Submit monitor ─────────────────────────────────────────────────────────
async function submitMonitor() {
  // Auto-add leftover text in inputs if user forgot to click '+' button
  const pendingTheatre = document.getElementById('theatreInput')?.value.trim();
  if (pendingTheatre && !state.filters.theatres.includes(pendingTheatre)) {
    addFilter('theatre');
  }
  const pendingDate = document.getElementById('dateInput')?.value;
  if (pendingDate && !state.filters.dates.includes(pendingDate)) {
    addFilter('date');
  }

  const url   = (state.cleanedUrl || document.getElementById('urlInput').value).trim();
  const email = document.getElementById('alertEmail').value.trim();
  const errEl = document.getElementById('formError');
  errEl.classList.add('hidden');

  if (!url)   { showFormError('Please enter a BookMyShow URL'); return; }
  if (!email) { showFormError('Please enter your email address'); return; }

  setBtnLoading('submitBtn', 'submitIcon', 'submitLabel', true, '⟳', 'Starting…');

  const filterDates = state.filters.dates.map(d => fmtDate(d));

  try {
    const res  = await api('POST', '/api/monitors', {
      url,
      name:             document.getElementById('movieName').value.trim(),
      city:             document.getElementById('movieCity').value.trim(),
      language:         document.getElementById('movieLanguage').value.trim(),
      email_to:         email,
      filter_theatres:  state.filters.theatres,
      filter_dates:     filterDates,
      filter_time_from: state.filters.timeFrom,
      filter_time_to:   state.filters.timeTo,
      interval_minutes: parseInt(document.getElementById('intervalSelect').value),
    });
    const data = await res.json();
    if (!res.ok) { showFormError(data.error || 'Failed'); return; }

    resetForm();
    loadMonitors();
    if (isMobile()) switchTab('monitors');
    toast(`✅ Monitoring "${data.name}"`, 'success');
  } catch { showFormError('Network error — is the server running?'); }
  finally { setBtnLoading('submitBtn', 'submitIcon', 'submitLabel', false, '🔔', 'Start Monitoring'); }
}

function showFormError(msg) {
  const el = document.getElementById('formError');
  el.textContent = msg; el.classList.remove('hidden');
}

function resetForm() {
  ['urlInput','alertEmail','movieName','movieCity','movieLanguage'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('urlPreview').classList.add('hidden');
  document.getElementById('cleanBtnWrap').classList.add('hidden');
  document.getElementById('formError').classList.add('hidden');
  state.cleanedUrl = '';
  state.filters = { theatres: [], dates: [], timeFrom: '', timeTo: '' };
  document.getElementById('theatreTags').innerHTML = '';
  document.getElementById('dateTags').innerHTML    = '';
  document.getElementById('timeFrom').value = '';
  document.getElementById('timeTo').value   = '';
  document.getElementById('filterBadge').classList.add('hidden');
  syncPresetChips();
  document.querySelectorAll('.time-preset-btn').forEach(b => {
    b.classList.remove('bg-bms/20', 'border-bms/60', 'text-bms', 'font-semibold');
    b.classList.add('bg-zinc-800/80', 'border-zinc-700/60', 'text-zinc-300');
  });
}

// ── Load / render monitors ─────────────────────────────────────────────────
async function loadMonitors() {
  try {
    const res      = await api('GET', '/api/monitors');
    const monitors = await res.json();
    renderMonitors(monitors);
  } catch { /* silent on auto-refresh */ }
}

function renderMonitors(monitors) {
  const container = document.getElementById('monitorsContainer');
  document.getElementById('monitorCount').textContent = monitors.length;

  const totalAlerts = monitors.reduce((sum, m) => sum + (m.alert_count || 0), 0);
  const activeCount = monitors.filter(m => m.status === 'active').length;

  const statsEl = document.getElementById('statsBanner');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="grid grid-cols-3 gap-2 mb-4 bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 text-center">
        <div>
          <div class="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Monitors</div>
          <div class="text-sm font-bold text-zinc-200">${monitors.length} <span class="text-xs text-green-400 font-normal">(${activeCount} active)</span></div>
        </div>
        <div>
          <div class="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Alerts Sent</div>
          <div class="text-sm font-bold text-zinc-200">${totalAlerts} 🔔</div>
        </div>
        <div>
          <div class="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Check Freq</div>
          <div class="text-sm font-bold text-zinc-200">15 min</div>
        </div>
      </div>
    `;
  }

  if (!monitors.length) {
    container.innerHTML = `
      <div class="text-center py-16 text-zinc-700 bg-zinc-900/30 border border-zinc-800/60 rounded-2xl p-6">
        <div class="text-5xl mb-3 opacity-40">🎬</div>
        <div class="text-sm font-medium text-zinc-400">No monitors configured</div>
        <div class="text-xs mt-1 text-zinc-500">Add a BookMyShow movie link to start tracking ticket openings!</div>
      </div>`;
    return;
  }

  container.innerHTML = '';
  monitors.forEach(m => container.appendChild(makeCard(m)));
}

function makeCard(m) {
  const card = document.createElement('div');
  card.className = 'bg-zinc-900 border border-zinc-800/90 rounded-2xl p-4 sm:p-4.5 mb-3.5 shadow-lg transition hover:border-zinc-700/80 fade-in';

  const S = {
    active: { dot: 'bg-green-500 shadow-sm shadow-green-500/50', label: 'Active', text: 'text-green-400' },
    paused: { dot: 'bg-yellow-500 shadow-sm shadow-yellow-500/50', label: 'Paused', text: 'text-yellow-400' },
    error:  { dot: 'bg-red-500 shadow-sm shadow-red-500/50',    label: 'Error',   text: 'text-red-400' },
  }[m.status] || { dot: 'bg-zinc-500', label: m.status, text: 'text-zinc-400' };

  // Check if monitor is in pre-booking mode (snapshot has no showtimes yet)
  const isPreBooking = m.status === 'active' && (!m.snapshot || Object.keys(m.snapshot).length === 0 || Object.values(m.snapshot).every(v => typeof v !== 'object' || Object.keys(v).length === 0));

  const filters = [];
  if (m.language)
    filters.push(`<span class="chip bg-red-950/40 text-red-300 border border-red-900/50 text-[11px] font-medium">🗣️ ${esc(m.language)}</span>`);
  if (m.filter_theatres?.length)
    filters.push(`<span class="chip bg-zinc-800 text-zinc-300 border border-zinc-700/60 text-[11px]">🏢 ${esc(m.filter_theatres.join(', '))}</span>`);
  if (m.filter_dates?.length)
    filters.push(`<span class="chip bg-zinc-800 text-zinc-300 border border-zinc-700/60 text-[11px]">📅 ${esc(m.filter_dates.join(', '))}</span>`);
  if (m.filter_time_from || m.filter_time_to)
    filters.push(`<span class="chip bg-zinc-800 text-zinc-300 border border-zinc-700/60 text-[11px]">⏰ ${esc(m.filter_time_from||'any')}–${esc(m.filter_time_to||'any')}</span>`);
  if (!filters.length)
    filters.push('<span class="chip bg-zinc-800/50 text-zinc-500 text-[11px]">All shows & venues</span>');

  const checked = m.last_checked ? timeAgo(m.last_checked) : 'Never';
  const nextRun = m.status === 'paused'
    ? 'Paused'
    : (m.next_run ? timeFromNow(m.next_run) : 'GitHub Actions (~15m)');

  card.innerHTML = `
    <!-- Top row -->
    <div class="flex items-start justify-between gap-2 mb-2">
      <div class="min-w-0">
        <div class="font-bold text-sm sm:text-base truncate text-zinc-100 flex items-center gap-2">
          <span>${esc(m.name)}</span>
        </div>
        <div class="text-xs text-zinc-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span>📍 ${esc(m.city||'—')}</span>
          <span>•</span>
          <span>⏱ Every ${m.interval_minutes} min</span>
        </div>
      </div>
      <div class="flex flex-col items-end gap-1 shrink-0">
        <div class="flex items-center gap-1.5 bg-zinc-800/80 border border-zinc-700/60 rounded-full px-2.5 py-1">
          <span class="w-2 h-2 rounded-full ${S.dot} shrink-0"></span>
          <span class="text-[11px] font-semibold ${S.text}">${S.label}</span>
        </div>
        ${isPreBooking ? `<span class="text-[10px] text-blue-400 bg-blue-950/50 border border-blue-900/50 rounded-md px-1.5 py-0.5 font-medium">⏳ Pre-Booking Mode</span>` : ''}
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap gap-1.5 mb-3">${filters.join('')}</div>

    <!-- Error message if any -->
    ${m.last_error ? `<div class="text-xs text-red-400 bg-red-950/40 border border-red-900/60 rounded-xl px-3 py-2 mb-3 leading-snug flex items-center gap-2"><span>⚠</span> <span>${esc(m.last_error)}</span></div>` : ''}

    <!-- Stats summary bar -->
    <div class="grid grid-cols-3 gap-2 bg-zinc-950/60 border border-zinc-800/60 rounded-xl px-3 py-2 text-xs text-zinc-500 mb-3">
      <div>Checked: <span class="text-zinc-300 font-medium block sm:inline">${checked}</span></div>
      <div>Next Check: <span class="text-zinc-300 font-medium block sm:inline">${nextRun}</span></div>
      <div>Alerts Sent: <span class="text-zinc-300 font-medium block sm:inline">${m.alert_count||0} 🔔</span></div>
    </div>

    <!-- Quick Actions Bar -->
    <div class="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-800/60">
      <a href="${esc(m.url)}" target="_blank"
        class="text-xs bg-bms/10 hover:bg-bms/20 border border-bms/30 text-bms font-semibold px-3 py-2 rounded-xl transition flex items-center gap-1 active:scale-95">
        🎟 Open BMS ↗
      </a>
      <button id="checkBtn-${m.id}" onclick="checkNow(${m.id})"
        class="text-xs bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 px-3 py-2 rounded-xl transition flex items-center gap-1">
        ↻ Check
      </button>
      <button onclick="togglePause(${m.id},'${m.status}')"
        class="text-xs bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 px-3 py-2 rounded-xl transition">
        ${m.status === 'active' ? '⏸ Pause' : '▶ Resume'}
      </button>
      <button onclick="openEdit(${m.id})"
        class="text-xs bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 px-3 py-2 rounded-xl transition">
        ✏ Edit
      </button>
      ${(m.alert_count||0) > 0 ? `
      <button onclick="openHistory(${m.id},'${esc(m.name)}')"
        class="text-xs bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 px-3 py-2 rounded-xl transition">
        📋 History
      </button>` : ''}
      <button onclick="deleteMonitor(${m.id},'${esc(m.name)}')"
        class="text-xs bg-zinc-800/80 hover:bg-red-950/60 active:bg-red-950 text-zinc-500 hover:text-red-400 border border-transparent hover:border-red-900/50 px-2.5 py-2 rounded-xl transition ml-auto">
        🗑
      </button>
    </div>
  `;
  return card;
}

// ── Monitor actions ────────────────────────────────────────────────────────
async function checkNow(id) {
  const btn = document.getElementById(`checkBtn-${id}`);
  if (btn) { btn.innerHTML = '⟳ Checking…'; btn.disabled = true; }
  try {
    const res  = await api('POST', `/api/monitors/${id}/check`);
    const data = await res.json();
    if (res.ok) {
      toast(data.message || '⚡ Check dispatched!', 'success');
    } else {
      toast(data.error || 'Check failed', 'error');
    }
  } catch (err) {
    toast('Network error during check', 'error');
  } finally {
    if (btn) { btn.innerHTML = '↻ Check'; btn.disabled = false; }
    setTimeout(loadMonitors, 4000);
    setTimeout(loadMonitors, 15000);
  }
}

async function togglePause(id, status) {
  const res  = await api('POST', `/api/monitors/${id}/pause`);
  const data = await res.json();
  toast(data.status === 'paused' ? '⏸ Paused' : '▶ Resumed');
  loadMonitors();
}

async function deleteMonitor(id, name) {
  if (!confirm(`Delete monitor for "${name}"?`)) return;
  await api('DELETE', `/api/monitors/${id}`);
  toast(`🗑 Deleted`, 'info');
  loadMonitors();
}

// ── Edit modal ─────────────────────────────────────────────────────────────
async function openEdit(id) {
  const res = await api('GET', `/api/monitors/${id}`);
  const m   = await res.json();
  document.getElementById('editId').value        = m.id;
  document.getElementById('editName').value      = m.name;
  document.getElementById('editLanguage').value  = m.language || '';
  document.getElementById('editEmail').value     = m.email_to;
  document.getElementById('editTimeFrom').value  = m.filter_time_from || '';
  document.getElementById('editTimeTo').value    = m.filter_time_to   || '';
  document.getElementById('editInterval').value  = m.interval_minutes || 15;
  state.editFilters.theatres = m.filter_theatres || [];
  state.editFilters.dates    = m.filter_dates    || [];
  renderEditTags('editTheatreTags', state.editFilters.theatres, 'theatre');
  renderEditTags('editDateTags',    state.editFilters.dates,    'date');
  document.getElementById('editModal').classList.remove('hidden');
  // Populate theatre autocomplete from this monitor's snapshot
  loadEditTheatreSuggestions(id);
}
function closeEditModal() { document.getElementById('editModal').classList.add('hidden'); }

function editAddFilter(type) {
  const inp = document.getElementById(type === 'theatre' ? 'editTheatreInput' : 'editDateInput');
  const val = inp.value.trim() || inp.value;
  if (!val) return;
  const arr = type === 'theatre' ? state.editFilters.theatres : state.editFilters.dates;
  if (!arr.includes(val)) arr.push(val);
  inp.value = '';
  renderEditTags(type === 'theatre' ? 'editTheatreTags' : 'editDateTags', arr, type);
}

function editRemoveFilter(type, val) {
  if (type === 'theatre') state.editFilters.theatres = state.editFilters.theatres.filter(v => v !== val);
  else                    state.editFilters.dates    = state.editFilters.dates.filter(v => v !== val);
  renderEditTags(type === 'theatre' ? 'editTheatreTags' : 'editDateTags',
                 type === 'theatre' ? state.editFilters.theatres : state.editFilters.dates, type);
}

function renderEditTags(cid, items, type) {
  const c = document.getElementById(cid);
  c.innerHTML = '';
  items.forEach(val => {
    const label = type === 'date' ? fmtDate(val) : val;
    const s = document.createElement('span');
    s.className = 'chip bg-zinc-700 text-zinc-300 text-xs cursor-pointer hover:bg-red-900/40 hover:text-red-300 transition';
    s.innerHTML = `${esc(label)} <span onclick="editRemoveFilter('${type}','${esc(val)}')">✕</span>`;
    c.appendChild(s);
  });
}

async function saveEdit() {
  const id = document.getElementById('editId').value;
  const filterDates = state.editFilters.dates.map(d => /^\d{4}-\d{2}-\d{2}$/.test(d) ? fmtDate(d) : d);
  await api('PATCH', `/api/monitors/${id}`, {
    name:             document.getElementById('editName').value.trim(),
    language:         document.getElementById('editLanguage').value.trim(),
    email_to:         document.getElementById('editEmail').value.trim(),
    filter_theatres:  state.editFilters.theatres,
    filter_dates:     filterDates,
    filter_time_from: document.getElementById('editTimeFrom').value,
    filter_time_to:   document.getElementById('editTimeTo').value,
    interval_minutes: parseInt(document.getElementById('editInterval').value),
  });
  closeEditModal(); loadMonitors(); toast('✅ Saved', 'success');
}

// ── Alert history modal ────────────────────────────────────────────────────
async function openHistory(id, name) {
  document.getElementById('historyTitle').textContent = `History — ${name}`;
  document.getElementById('historyContent').innerHTML = '<p class="text-zinc-600 text-sm text-center py-6">Loading…</p>';
  document.getElementById('historyModal').classList.remove('hidden');

  const res    = await api('GET', `/api/monitors/${id}/alerts?limit=30`);
  const alerts = await res.json();
  const div    = document.getElementById('historyContent');
  div.innerHTML = '';

  if (!alerts.length) {
    div.innerHTML = '<p class="text-zinc-600 text-sm text-center py-8">No alerts sent yet.</p>';
    return;
  }

  alerts.forEach(a => {
    const changes = Array.isArray(a.changes) ? a.changes : [];
    const el = document.createElement('div');
    el.className = 'bg-zinc-800 rounded-xl p-3 border border-zinc-700/60';
    el.innerHTML = `
      <div class="text-xs text-zinc-500 mb-2">${fmtTs(a.sent_at)} · ${changes.length} change(s)</div>
      ${changes.map(c => `
        <div class="flex items-center gap-2 text-xs py-1.5 border-b border-zinc-700/40 last:border-0 flex-wrap">
          <span class="text-zinc-600 shrink-0">${esc(c.date||'—')}</span>
          <span class="text-zinc-300 truncate min-w-0">${esc(c.theatre)}</span>
          <span class="text-zinc-500 shrink-0">${esc(c.showtime)}</span>
          <span class="ml-auto shrink-0 text-xs">${esc(c.change)}</span>
        </div>`).join('')}`;
    div.appendChild(el);
  });
}
function closeHistoryModal() { document.getElementById('historyModal').classList.add('hidden'); }

// ── Email config ───────────────────────────────────────────────────────────
async function loadEmailConfig() {
  try {
    const res = await api('GET', '/api/email-config');
    const cfg = await res.json();
    const dot     = document.getElementById('emailDot');
    const label   = document.getElementById('emailLabel');
    const mIcon   = document.getElementById('mobileEmailIcon');

    if (dot) dot.className = cfg.configured ? 'w-1.5 h-1.5 rounded-full bg-green-500 shrink-0' : 'w-1.5 h-1.5 rounded-full bg-red-500 shrink-0';
    if (label) label.textContent = cfg.configured ? (cfg.from?.split('@')[0] || 'Email ✓') : 'Setup needed';
    if (mIcon) mIcon.textContent = cfg.configured ? '✅' : '⚠️';

    const cfgFrom = document.getElementById('cfgFrom');
    if (cfgFrom) cfgFrom.value = cfg.from || '';
    const cfgTo = document.getElementById('cfgTo');
    if (cfgTo) cfgTo.value = cfg.to || '';
  } catch { /* silent */ }
}

async function testCurrentEmailConfig() {
  const btnIcon = document.getElementById('emailTestIcon');
  if (btnIcon) btnIcon.textContent = '⟳ Testing…';
  toast('Sending test email using configured environment credentials…');
  try {
    const res  = await api('POST', '/api/email-config/test');
    const data = await res.json();
    if (res.ok) {
      toast(data.message || '✅ Test email sent!', 'success');
    } else {
      toast(data.message || data.error || 'Failed to send test email', 'error');
    }
  } catch {
    toast('Network error testing email credentials', 'error');
  } finally {
    if (btnIcon) btnIcon.textContent = '✉️ Test';
    loadEmailConfig();
  }
}

async function saveEmailConfig() {
  await api('POST', '/api/email-config', {
    from:         document.getElementById('cfgFrom').value.trim(),
    to:           document.getElementById('cfgTo').value.trim() || document.getElementById('cfgFrom').value.trim(),
    app_password: document.getElementById('cfgPass').value.trim(),
  });
  closeEmailModal(); loadEmailConfig(); toast('✅ Email saved', 'success');
}

async function testEmail() {
  setBtnLoading('testEmailBtn', 'testIcon', null, true, '⟳', null);
  const msg = document.getElementById('emailModalMsg');
  msg.textContent = '';
  try {
    const res  = await api('POST', '/api/email-config/test', {
      from:         document.getElementById('cfgFrom').value.trim(),
      to:           document.getElementById('cfgTo').value.trim() || document.getElementById('cfgFrom').value.trim(),
      app_password: document.getElementById('cfgPass').value.trim(),
    });
    const data = await res.json();
    msg.className   = `text-xs text-center mt-2 min-h-[1rem] ${res.ok ? 'text-green-400' : 'text-red-400'}`;
    msg.textContent = data.message;
  } catch {
    msg.className   = 'text-xs text-center mt-2 min-h-[1rem] text-red-400';
    msg.textContent = 'Network error';
  } finally {
    setBtnLoading('testEmailBtn', 'testIcon', null, false, '📧', null);
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────
function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(path, opts);
}

function setBtnLoading(btnId, iconId, labelId, loading, icon, label) {
  const btn = document.getElementById(btnId);
  if (btn) btn.disabled = loading;
  const ic = document.getElementById(iconId);
  if (ic) { ic.className = loading ? 'spin' : ''; ic.textContent = icon; }
  const lb = labelId && document.getElementById(labelId);
  if (lb && label) lb.textContent = label;
}

function fmtDate(iso) {
  if (!iso) return iso;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
}

function fmtTs(iso) {
  return new Date(iso).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60)   return `${~~s}s ago`;
  if (s < 3600) return `${~~(s/60)}m ago`;
  return `${~~(s/3600)}h ago`;
}

function timeFromNow(iso) {
  const s = (new Date(iso) - Date.now()) / 1000;
  if (s <= 0)   return 'soon';
  if (s < 60)   return `${~~s}s`;
  if (s < 3600) return `${~~(s/60)}m`;
  return `${~~(s/3600)}h`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
