// app.js — BMS Monitor frontend logic (mobile-first)

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

// ── Theatre autocomplete ───────────────────────────────────────────────────
// Fetches all known theatre names from every monitor's snapshot
// and populates the <datalist> for the Add form.
async function loadTheatreSuggestions() {
  try {
    const res      = await api('GET', '/api/theatres');
    const theatres = await res.json();
    populateDatalist('theatreSuggestions', theatres);
  } catch { /* silent — autocomplete is a nice-to-have */ }
}

// Fetches theatre names from a specific monitor's snapshot
// and populates the <datalist> for the Edit modal.
async function loadEditTheatreSuggestions(monitorId) {
  try {
    const res      = await api('GET', `/api/monitors/${monitorId}/theatres`);
    const theatres = await res.json();
    populateDatalist('editTheatreSuggestions', theatres);
  } catch { /* silent */ }
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
    }
  } catch { /* silent */ }
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
  updateFilterBadge();
}

function removeFilter(type, val) {
  if (type === 'theatre') state.filters.theatres = state.filters.theatres.filter(v => v !== val);
  else                    state.filters.dates    = state.filters.dates.filter(v => v !== val);
  renderTags(type === 'theatre' ? 'theatreTags' : 'dateTags',
             type === 'theatre' ? state.filters.theatres : state.filters.dates,
             type, removeFilter);
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
  ['urlInput','alertEmail','movieName','movieCity'].forEach(id => document.getElementById(id).value = '');
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

  if (!monitors.length) {
    container.innerHTML = `
      <div class="text-center py-20 text-zinc-700">
        <div class="text-5xl mb-4 opacity-40">🎬</div>
        <div class="text-sm font-medium">No monitors yet</div>
        <div class="text-xs mt-1 text-zinc-600">Tap <strong>Add</strong> to get started</div>
      </div>`;
    return;
  }

  container.innerHTML = '';
  monitors.forEach(m => container.appendChild(makeCard(m)));
}

function makeCard(m) {
  const card = document.createElement('div');
  card.className = 'bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-3 fade-in';

  const S = {
    active: { dot: 'bg-green-500',  label: 'Active',  text: 'text-green-400' },
    paused: { dot: 'bg-yellow-500', label: 'Paused',  text: 'text-yellow-400' },
    error:  { dot: 'bg-red-500',    label: 'Error',   text: 'text-red-400' },
  }[m.status] || { dot: 'bg-zinc-500', label: m.status, text: 'text-zinc-400' };

  const filters = [];
  if (m.filter_theatres?.length)
    filters.push(`<span class="chip bg-zinc-800 text-zinc-500 text-xs">🏢 ${esc(m.filter_theatres.join(', '))}</span>`);
  if (m.filter_dates?.length)
    filters.push(`<span class="chip bg-zinc-800 text-zinc-500 text-xs">📅 ${esc(m.filter_dates.join(', '))}</span>`);
  if (m.filter_time_from || m.filter_time_to)
    filters.push(`<span class="chip bg-zinc-800 text-zinc-500 text-xs">⏰ ${esc(m.filter_time_from||'any')}–${esc(m.filter_time_to||'any')}</span>`);
  if (!filters.length)
    filters.push('<span class="chip bg-zinc-800/50 text-zinc-700 text-xs">All shows</span>');

  const checked  = m.last_checked ? timeAgo(m.last_checked) : 'Never';
  const nextRun  = m.next_run ? timeFromNow(m.next_run) : '—';

  card.innerHTML = `
    <!-- Top row -->
    <div class="flex items-start justify-between gap-2 mb-2">
      <div class="min-w-0">
        <div class="font-semibold text-sm truncate text-zinc-100">${esc(m.name)}</div>
        <div class="text-xs text-zinc-600 mt-0.5">${esc(m.city||'—')} · every ${m.interval_minutes} min</div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0 mt-0.5">
        <span class="w-2 h-2 rounded-full ${S.dot} shrink-0"></span>
        <span class="text-xs font-medium ${S.text}">${S.label}</span>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap gap-1.5 mb-2">${filters.join('')}</div>

    <!-- Error -->
    ${m.last_error ? `<div class="text-xs text-red-400 bg-red-950/30 rounded-lg px-3 py-2 mb-2 leading-snug">⚠ ${esc(m.last_error)}</div>` : ''}

    <!-- Stats -->
    <div class="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-600 mb-3">
      <span>Checked: <span class="text-zinc-400">${checked}</span></span>
      <span>Next: <span class="text-zinc-400">${nextRun}</span></span>
      <span>Alerts: <span class="text-zinc-400">${m.alert_count||0}</span></span>
    </div>

    <!-- Actions — two rows on very small screens -->
    <div class="flex flex-wrap gap-2">
      <button onclick="checkNow(${m.id})"
        class="text-xs bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 px-3 py-2 rounded-lg transition">
        ↻ Check
      </button>
      <button onclick="togglePause(${m.id},'${m.status}')"
        class="text-xs bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 px-3 py-2 rounded-lg transition">
        ${m.status === 'active' ? '⏸ Pause' : '▶ Resume'}
      </button>
      <button onclick="openEdit(${m.id})"
        class="text-xs bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 px-3 py-2 rounded-lg transition">
        ✏ Edit
      </button>
      ${(m.alert_count||0) > 0 ? `
      <button onclick="openHistory(${m.id},'${esc(m.name)}')"
        class="text-xs bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 px-3 py-2 rounded-lg transition">
        📋 History
      </button>` : ''}
      <button onclick="deleteMonitor(${m.id},'${esc(m.name)}')"
        class="text-xs bg-zinc-800 hover:bg-red-950/50 active:bg-red-950 text-zinc-500 hover:text-red-400 px-3 py-2 rounded-lg transition ml-auto">
        🗑
      </button>
    </div>
  `;
  return card;
}

// ── Monitor actions ────────────────────────────────────────────────────────
async function checkNow(id) {
  toast('Check triggered…');
  await api('POST', `/api/monitors/${id}/check`);
  setTimeout(loadMonitors, 5000);
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

    if (cfg.configured) {
      dot.className   = 'w-1.5 h-1.5 rounded-full bg-green-500 shrink-0';
      label.textContent = cfg.from?.split('@')[0] || 'Email ✓';
      if (mIcon) mIcon.textContent = '✅';
    } else {
      dot.className   = 'w-1.5 h-1.5 rounded-full bg-red-500 shrink-0';
      label.textContent = 'Setup needed';
      if (mIcon) mIcon.textContent = '⚠️';
    }

    // Show cloud mode notice if applicable
    document.getElementById('cloudModeNotice')?.classList.toggle('hidden', !cfg.cloud_managed);
    document.getElementById('emailFormFields')?.classList.toggle('opacity-50', cfg.cloud_managed);
    document.getElementById('emailFormFields')?.classList.toggle('pointer-events-none', cfg.cloud_managed);

    document.getElementById('cfgFrom').value = cfg.from || '';
    document.getElementById('cfgTo').value   = cfg.to   || '';
  } catch { /* silent */ }
}

function openEmailModal()  { document.getElementById('emailModal').classList.remove('hidden'); loadEmailConfig(); }
function closeEmailModal() { document.getElementById('emailModal').classList.add('hidden'); }

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
