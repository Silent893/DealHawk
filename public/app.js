/* ─── State ─────────────────────────────────────────────────── */
let currentView = 'jobs';
let wizardStep = 0;
let wizardData = {};
let wizardEditId = null;  // non-null = editing existing job
let listingPage = 0;

const WIZARD_STEPS = [
  { label: 'URL', title: 'Paste listing page URL' },
  { label: 'Scan', title: 'Scanning list page...' },
  { label: 'Deep-Dive Rules', title: 'Set deep-dive conditions' },
  { label: 'Detail Scan', title: 'Scanning detail page...' },
  { label: 'Log Rules', title: 'Set logging filters' },
  { label: 'Save', title: 'Name & schedule' },
];

/* ─── Navigation ───────────────────────────────────────────── */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

function showView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-btn[data-view="${view}"]`);
  if (navBtn) navBtn.classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`${view}-view`);
  if (el) el.classList.add('active');
  if (view === 'jobs') loadJobs();
  if (view === 'listings') loadListings();
  if (view === 'runs') loadRuns();
}

document.getElementById('new-job-btn').addEventListener('click', openWizard);

/* ─── API Helpers ──────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  return res.json();
}

/* ─── Stats Overview ───────────────────────────────────────── */
async function loadStats() {
  try {
    const s = await api('GET', '/stats');
    document.getElementById('stats-overview').innerHTML = `
      <div class="stats-card">
        <div class="stats-card-value stats-card-accent">${s.total_listings || 0}</div>
        <div class="stats-card-label">Total Listings</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value stats-card-success">${s.active_listings || 0}</div>
        <div class="stats-card-label">Active</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value stats-card-danger">${s.sold_listings || 0}</div>
        <div class="stats-card-label">Sold</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value">${s.matched_listings || 0}</div>
        <div class="stats-card-label">Matched</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value stats-card-warning">${s.price_drops_24h || 0}</div>
        <div class="stats-card-label">Price Drops 24h</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value">${s.active_jobs || 0}</div>
        <div class="stats-card-label">Active Jobs</div>
      </div>
    `;
  } catch (e) {
    console.error('Stats load failed:', e);
  }
}

/* ─── Shared Listing Card ──────────────────────────────────── */
function renderListingCard(l) {
  const imgSrc = l.image_path ? `/api/images/${l.image_path}` :
    (l.image_urls && l.image_urls.length > 0 ? l.image_urls[0] : '');
  const detailFields = (typeof l.detail_fields === 'string' ? (() => { try { return JSON.parse(l.detail_fields); } catch { return {}; } })() : l.detail_fields) || {};
  const detailHtml = Object.entries(detailFields).slice(0, 5).map(([k, v]) =>
    `<div class="listing-card-detail-row"><span class="listing-card-detail-key">${esc(k)}</span><span>${esc(String(v))}</span></div>`
  ).join('');

  const statusClass = l.status === 'sold' ? 'listing-badge-sold'
    : l.status === 'excluded' ? 'listing-badge-sold' : 'listing-badge-active';
  const statusLabel = l.status === 'sold' ? '🔴 Sold'
    : l.status === 'excluded' ? '⛔ Excluded' : '🟢 Active';

  // Price comparison badges
  let priceCompHtml = '';
  if (l.prev_price && parseFloat(l.prev_price) !== parseFloat(l.price_value)) {
    const prev = parseFloat(l.prev_price), curr = parseFloat(l.price_value);
    const diff = curr - prev, pct = prev ? ((diff / prev) * 100).toFixed(1) : 0;
    priceCompHtml += diff < 0
      ? `<span class="price-drop-badge drop">🔻 ${pct}%</span>`
      : `<span class="price-drop-badge rise">🔺 +${pct}%</span>`;
  }
  if (l.job_avg_price && l.price_value) {
    const avg = parseFloat(l.job_avg_price), price = parseFloat(l.price_value);
    const diff = ((price - avg) / avg * 100).toFixed(0);
    if (Math.abs(diff) < 3) priceCompHtml += '<span class="price-drop-badge" style="background:rgba(100,100,100,0.15);color:var(--text-muted)">≈ avg</span>';
    else priceCompHtml += diff < 0
      ? `<span class="price-drop-badge drop">${diff}% avg</span>`
      : `<span class="price-drop-badge rise">+${diff}% avg</span>`;
  }

  // Price changes / velocity
  const changes = parseInt(l.price_changes) || 0;
  let velocityBadge = '';
  if (changes >= 3) velocityBadge = '<span style="color:var(--success);font-size:0.72rem;margin-left:4px">🔻🔻🔻 Motivated seller</span>';
  else if (changes >= 2) velocityBadge = '<span style="color:var(--warning);font-size:0.72rem;margin-left:4px">🔻🔻</span>';

  // Listing age
  let ageText = '';
  if (l.posted_at) {
    const days = Math.floor((Date.now() - new Date(l.posted_at).getTime()) / 86400000);
    if (days === 0) ageText = '🆕 Today';
    else if (days === 1) ageText = '1 day ago';
    else if (days < 7) ageText = `${days} days ago`;
    else if (days < 30) ageText = `${Math.floor(days / 7)}w ago`;
    else ageText = `${Math.floor(days / 30)}mo ago`;
  }

  return `
    <div class="listing-card ${l.status === 'sold' || l.status === 'excluded' ? 'listing-sold' : ''}">
      ${imgSrc ? `<img class="listing-card-img" src="${imgSrc}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
      <div class="listing-card-body">
        <div class="listing-card-title">
          <a href="${l.url}" target="_blank" style="color:inherit;text-decoration:none">${esc(l.title || l.slug)}</a>
        </div>
        <div class="listing-card-price">
          ${esc(l.price || '')} ${priceCompHtml} ${velocityBadge}
        </div>
        ${l.sub_location ? `<div style="font-size:0.75rem;color:var(--text-muted)">📍 ${esc(l.sub_location)}${l.location ? ', ' + esc(l.location) : ''}</div>` : ''}
        ${ageText ? `<div style="font-size:0.72rem;color:var(--text-muted)">🕐 Posted ${ageText}</div>` : ''}
        <div class="listing-card-details">
          ${l.size_text ? `<div class="listing-card-detail-row"><span class="listing-card-detail-key">Size</span><span>${esc(l.size_text)}</span></div>` : ''}
          ${l.location && !l.sub_location ? `<div class="listing-card-detail-row"><span class="listing-card-detail-key">Location</span><span>${esc(l.location)}</span></div>` : ''}
          ${l.phone ? `<div class="listing-card-detail-row"><span class="listing-card-detail-key">Phone</span><span>${esc(l.phone)}</span></div>` : ''}
          ${detailHtml}
        </div>
      </div>
      <div class="listing-card-footer">
        <span class="${statusClass}">${statusLabel}</span>
        <span>${l.job_name || ''} · ${new Date(l.first_seen_at).toLocaleDateString()}</span>
        <button class="btn btn-sm btn-ghost" onclick="showPriceChart(${l.id}, '${esc(l.title || l.slug)}')" title="Price history">📈</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleMatch(${l.id})" title="${l.matched_log ? 'Unmatch' : 'Match'}">${l.matched_log ? '⭐' : '☆'}</button>
        ${l.status !== 'excluded' ? `<button class="btn btn-sm btn-ghost" onclick="excludeListing(${l.id})" title="Exclude">⛔</button>` : ''}
      </div>
    </div>`;
}

/* ─── Jobs View ────────────────────────────────────────────── */
async function loadJobs() {
  loadStats();
  const jobs = await api('GET', '/jobs');
  const grid = document.getElementById('jobs-grid');
  const empty = document.getElementById('jobs-empty');

  if (jobs.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = jobs.map(j => {
    const avgP = j.avg_price ? formatPrice(parseFloat(j.avg_price)) : '—';
    const badges = [];
    if (parseInt(j.new_7d) > 0) badges.push(`<span style="color:#22c55e;font-size:0.75rem">🆕 ${j.new_7d} new</span>`);
    if (parseInt(j.price_drops) > 0) badges.push(`<span style="color:#f59e0b;font-size:0.75rem">💰 ${j.price_drops} drops</span>`);
    if (parseInt(j.sold_7d) > 0) badges.push(`<span style="color:#ef4444;font-size:0.75rem">🔴 ${j.sold_7d} sold</span>`);

    return `
    <div class="job-card" style="cursor:pointer" onclick="openJobDetail(${j.id}, '${esc(j.name)}')">
      <div class="job-card-header">
        <span class="job-card-title">${esc(j.name)}</span>
        <span class="job-card-badge ${j.active ? 'badge-active' : 'badge-paused'}">
          ${j.active ? 'Active' : 'Paused'}
        </span>
      </div>
      <div class="job-card-url" style="font-size:0.72rem;max-height:36px;overflow:hidden">${esc(j.url.split('\n')[0])}${j.url.includes('\n') ? ' (+' + (j.url.split('\n').length - 1) + ' more)' : ''}</div>
      ${badges.length > 0 ? `<div style="display:flex;gap:10px;margin:6px 0;flex-wrap:wrap">${badges.join('')}</div>` : ''}
      <div class="job-card-stats">
        <div class="stat">
          <div class="stat-value">${avgP}</div>
          <div class="stat-label">Avg Price</div>
        </div>
        <div class="stat">
          <div class="stat-value">${j.matched_count || 0}</div>
          <div class="stat-label">Matched</div>
        </div>
        <div class="stat">
          <div class="stat-value">${j.active_count || 0}</div>
          <div class="stat-label">Active</div>
        </div>
        <div class="stat">
          <div class="stat-value">${j.frequency_hours}h</div>
          <div class="stat-label">Frequency</div>
        </div>
      </div>
      <div class="job-card-meta">
        ${j.last_run_at ? 'Last run: ' + new Date(j.last_run_at).toLocaleString() : 'Never run'}
        ${j.category ? ' · ' + esc(j.category) : ''}
      </div>
      <div class="job-card-actions" onclick="event.stopPropagation()">
        <button class="btn btn-sm btn-primary" onclick="triggerRun(${j.id})">▶ Run Now</button>
        <button class="btn btn-sm btn-ghost" onclick="editJob(${j.id})">✏️ Edit</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleJob(${j.id}, ${!j.active})">
          ${j.active ? '⏸ Pause' : '▶ Resume'}
        </button>
        <button class="btn btn-sm btn-danger" onclick="deleteJob(${j.id}, '${esc(j.name)}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

async function triggerRun(id) {
  await api('POST', `/jobs/${id}/run`);
  alert('Job started! Check the run history for progress.');
}

async function toggleJob(id, active) {
  await api('PUT', `/jobs/${id}`, { active });
  loadJobs();
}

async function deleteJob(id, name) {
  if (!confirm(`Delete job "${name}" and all its listings?`)) return;
  await api('DELETE', `/jobs/${id}`);
  loadJobs();
}

async function excludeListing(id) {
  if (!confirm('Exclude this listing? It won\'t reappear on future scrapes.')) return;
  await api('PATCH', `/listings/${id}/exclude`);
  loadListings();
}

async function toggleMatch(id) {
  await api('PATCH', `/listings/${id}/match`);
  loadListings();
}

/* ─── Listings View ────────────────────────────────────────── */
async function loadListings() {
  const jobFilter = document.getElementById('listing-job-filter').value;
  const matchedOnly = document.getElementById('listing-matched-filter').checked;

  // Populate job filter dropdown
  const jobs = await api('GET', '/jobs');
  const select = document.getElementById('listing-job-filter');
  const current = select.value;
  select.innerHTML = '<option value="">All Jobs</option>' +
    jobs.map(j => `<option value="${j.id}" ${j.id == current ? 'selected' : ''}>${esc(j.name)}</option>`).join('');

  const params = new URLSearchParams();
  if (jobFilter) params.set('job_id', jobFilter);
  if (matchedOnly) params.set('matched_only', 'true');
  const statusFilter = document.getElementById('listing-status-filter')?.value;
  if (statusFilter) params.set('status', statusFilter);
  const searchVal = document.getElementById('listing-search')?.value?.trim();
  if (searchVal) params.set('search', searchVal);
  const sortVal = document.getElementById('listing-sort')?.value;
  if (sortVal) params.set('sort', sortVal);
  params.set('limit', '30');
  params.set('offset', listingPage * 30);

  const data = await api('GET', `/listings?${params}`);
  const grid = document.getElementById('listings-grid');

  if (!data.listings || data.listings.length === 0) {
    grid.innerHTML = '<div class="empty-state"><p>No listings found.</p></div>';
    document.getElementById('listings-pagination').innerHTML = '';
    return;
  }

  grid.innerHTML = data.listings.map(l => renderListingCard(l)).join('');

  // Pagination
  const totalPages = Math.ceil(data.total / 30);
  const pag = document.getElementById('listings-pagination');
  pag.innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="listingPage=Math.max(0,listingPage-1);loadListings()" ${listingPage === 0 ? 'disabled' : ''}>← Prev</button>
    <span>Page ${listingPage + 1} of ${totalPages}</span>
    <button class="btn btn-sm btn-ghost" onclick="listingPage++;loadListings()" ${listingPage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
  `;
}

/* ─── Runs View ────────────────────────────────────────────── */
async function loadRuns() {
  const runs = await api('GET', '/runs');
  const wrap = document.getElementById('runs-table-wrap');
  if (!runs || runs.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><p>No scrape runs yet.</p></div>';
    return;
  }
  wrap.innerHTML = `
    <table class="runs-table">
      <thead><tr>
        <th>Job</th><th>Started</th><th>Duration</th><th>Found</th><th>New</th><th>Deep-Dived</th><th>Re-checked</th><th>Price Δ</th><th>Sold</th><th>Error</th>
      </tr></thead>
      <tbody>
        ${runs.map(r => {
    const dur = r.finished_at ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000) + 's' : 'running...';
    return `<tr>
            <td>${esc(r.job_name || '?')}</td>
            <td>${new Date(r.started_at).toLocaleString()}</td>
            <td>${dur}</td>
            <td>${r.listings_found ?? '—'}</td>
            <td>${r.new_listings ?? '—'}</td>
            <td>${r.deep_dived ?? '—'}</td>
            <td>${r.rechecked ?? '—'}</td>
            <td style="color:${r.price_changes > 0 ? 'var(--warning)' : 'var(--text-muted)'}">${r.price_changes ?? '—'}</td>
            <td style="color:${r.sold_detected > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${r.sold_detected ?? '—'}</td>
            <td style="color:${r.error ? 'var(--danger)' : 'var(--text-muted)'}">${r.error ? esc(r.error) : '—'}</td>
          </tr>`;
  }).join('')}
      </tbody>
    </table>
  `;
}

/* ─── Wizard ───────────────────────────────────────────────── */
function openWizard() {
  wizardStep = 0;
  wizardEditId = null;
  wizardData = { url: '', card_fields: [], detail_fields: [], deep_dive_rules: [], log_rules: [], samples: [], detailData: null };
  document.getElementById('wizard-overlay').style.display = 'flex';
  renderWizard();
}

async function editJob(id) {
  const jobs = await api('GET', '/jobs');
  const job = jobs.find(j => j.id === id);
  if (!job) return;

  wizardEditId = id;
  wizardData = {
    url: job.url,
    name: job.name,
    category: job.category || '',
    frequency: job.frequency_hours,
    card_fields: job.card_fields || [],
    detail_fields: job.detail_fields || [],
    deep_dive_rules: job.deep_dive_rules || [],
    log_rules: job.log_rules || [],
    samples: [],
    detailData: null,
  };
  // Jump to deep-dive rules step (skip URL input and list scan)
  wizardStep = 2;
  document.getElementById('wizard-overlay').style.display = 'flex';
  renderWizard();
}

function closeWizard() {
  document.getElementById('wizard-overlay').style.display = 'none';
}

function renderWizard() {
  const indicators = document.getElementById('step-indicators');
  indicators.innerHTML = WIZARD_STEPS.map((s, i) =>
    `<div class="step-dot ${i === wizardStep ? 'active' : (i < wizardStep ? 'done' : '')}">${s.label}</div>`
  ).join('');

  document.getElementById('wizard-title').textContent = wizardEditId
    ? `Edit Job — ${WIZARD_STEPS[wizardStep].title}`
    : WIZARD_STEPS[wizardStep].title;
  document.getElementById('wizard-back').style.visibility = (wizardStep > 0 && !(wizardEditId && wizardStep <= 2)) ? 'visible' : 'hidden';

  const nextBtn = document.getElementById('wizard-next');
  nextBtn.textContent = wizardStep === WIZARD_STEPS.length - 1
    ? (wizardEditId ? 'Save Changes' : 'Create Job')
    : 'Next';

  // Auto-advance steps (scanning)
  if (wizardStep === 1) { nextBtn.style.display = 'none'; scanListStep(); return; }
  if (wizardStep === 3) { nextBtn.style.display = 'none'; scanDetailStep(); return; }
  nextBtn.style.display = '';

  const body = document.getElementById('wizard-body');

  switch (wizardStep) {
    case 0: renderUrlStep(body); break;
    case 2: renderDeepDiveStep(body); break;
    case 4: renderLogRulesStep(body); break;
    case 5: renderSaveStep(body); break;
  }
}

function renderUrlStep(body) {
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">ikman.lk Listing Page URL(s)</label>
      <textarea class="form-input" id="wiz-url" rows="3" placeholder="https://ikman.lk/en/ads/sri-lanka/cars?enum.body=convertible&#10;https://ikman.lk/en/ads/sri-lanka/cars?query=convertible" style="resize:vertical;font-family:inherit;font-size:0.85rem">${esc(wizardData.url)}</textarea>
    </div>
    <p style="color:var(--text-muted);font-size:0.82rem">Paste one or more ikman.lk URLs, one per line. Multiple URLs will be combined and deduplicated by listing. The first URL is used for field scanning.</p>
  `;
}

async function scanListStep() {
  const body = document.getElementById('wizard-body');
  body.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Scanning list page for cards...</p></div>';

  // Use first URL for scanning
  const firstUrl = wizardData.url.split('\n').map(u => u.trim()).find(u => u.startsWith('http')) || wizardData.url;

  try {
    const result = await api('POST', '/scan/list', { url: firstUrl });
    wizardData.card_fields = result.fields;
    wizardData.samples = result.samples;
    wizardData.totalCards = result.totalCards;

    body.innerHTML = `
      <p style="margin-bottom:12px;color:var(--success)">✓ Found ${result.totalCards} cards with ${result.fields.length} fields</p>
      <table class="sample-table">
        <thead><tr>${result.fields.map(f => `<th>${esc(f.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${result.samples.slice(0, 3).map(s => `<tr>${result.fields.map(f =>
      `<td>${esc(String(s[f.key] ?? ''))}</td>`
    ).join('')}</tr>`).join('')}
        </tbody>
      </table>
    `;
    document.getElementById('wizard-next').style.display = '';
  } catch (err) {
    body.innerHTML = `<p style="color:var(--danger)">Error: ${esc(err.message || 'Failed to scan')}</p>`;
    document.getElementById('wizard-next').style.display = '';
    document.getElementById('wizard-next').textContent = 'Retry';
  }
}

function renderDeepDiveStep(body) {
  const fields = wizardData.card_fields.filter(f => f.type === 'number' || f.type === 'text' || f.type === 'enum');
  // Migrate flat array to groups if needed
  if (wizardData.deep_dive_rules.length > 0 && wizardData.deep_dive_rules[0]?.field) {
    wizardData.deep_dive_rules = [{ mode: 'AND', rules: wizardData.deep_dive_rules }];
  }
  if (wizardData.deep_dive_rules.length === 0) {
    wizardData.deep_dive_rules = [];
  }
  body.innerHTML = `
    <p style="margin-bottom:14px;color:var(--text-secondary);font-size:0.85rem">
      Set conditions to decide which listings to deep-dive into. Leave empty to deep-dive all.<br>
      <strong>AND</strong> = all must match · <strong>OR</strong> = any must match · <strong>EXCLUDE</strong> = skip if any match
    </p>
    <div id="deep-dive-groups"></div>
    <button class="add-rule-btn" onclick="addRuleGroup('deep-dive-groups', 'deep_dive_rules')">+ Add Group</button>
  `;
  renderRuleGroups('deep-dive-groups', 'deep_dive_rules', fields);
}

async function scanDetailStep() {
  const body = document.getElementById('wizard-body');
  body.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Deep-diving into a sample listing...</p></div>';

  const sampleUrl = wizardData.samples.length > 0 ? wizardData.samples[0].url : null;
  if (!sampleUrl) {
    body.innerHTML = '<p style="color:var(--danger)">No sample listings found to scan.</p>';
    document.getElementById('wizard-next').style.display = '';
    return;
  }

  try {
    const result = await api('POST', '/scan/detail', { url: sampleUrl });
    wizardData.detail_fields = result.fields;
    wizardData.detailData = result.data;

    body.innerHTML = `
      <p style="margin-bottom:12px;color:var(--success)">✓ Found ${result.fields.length} fields on detail page</p>
      <table class="sample-table">
        <thead><tr><th>Field</th><th>Type</th><th>Sample Value</th></tr></thead>
        <tbody>
          ${result.fields.map(f => `<tr>
            <td><strong>${esc(f.label)}</strong></td>
            <td style="color:var(--text-muted)">${f.type}</td>
            <td>${esc(String(f.sample || ''))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
    document.getElementById('wizard-next').style.display = '';
  } catch (err) {
    body.innerHTML = `<p style="color:var(--danger)">Error: ${esc(err.message || 'Failed to scan detail')}</p>`;
    document.getElementById('wizard-next').style.display = '';
  }
}

function renderLogRulesStep(body) {
  const allFields = [...wizardData.card_fields, ...wizardData.detail_fields.filter(f => f.key.startsWith('detail.'))];
  // Migrate flat array to groups if needed
  if (wizardData.log_rules.length > 0 && wizardData.log_rules[0]?.field) {
    wizardData.log_rules = [{ mode: 'AND', rules: wizardData.log_rules }];
  }
  if (wizardData.log_rules.length === 0) {
    wizardData.log_rules = [];
  }
  body.innerHTML = `
    <p style="margin-bottom:14px;color:var(--text-secondary);font-size:0.85rem">
      Set filters for which listings to <strong>log as matched</strong>. Matched listings will be highlighted and re-checked daily. Leave empty to match all.<br>
      <strong>AND</strong> = all must match · <strong>OR</strong> = any must match · <strong>EXCLUDE</strong> = skip if any match
    </p>
    <div id="log-groups"></div>
    <button class="add-rule-btn" onclick="addRuleGroup('log-groups', 'log_rules')">+ Add Group</button>
  `;
  renderRuleGroups('log-groups', 'log_rules', allFields);
}

function renderSaveStep(body) {
  let cat = wizardData.category || '';
  if (!cat) {
    if (wizardData.url.includes('land-for-sale')) cat = 'land';
    else if (wizardData.url.includes('cars')) cat = 'cars';
    else if (wizardData.url.includes('house')) cat = 'houses';
  }
  const freq = wizardData.frequency || 24;
  const ddCount = wizardData.deep_dive_rules.reduce((s, g) => s + (g.rules?.length || 0), 0);
  const logCount = wizardData.log_rules.reduce((s, g) => s + (g.rules?.length || 0), 0);

  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">Job Name</label>
      <input class="form-input" id="wiz-name" placeholder="e.g. Gampaha Land Over 100 Perches" value="${esc(wizardData.name || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">Category</label>
      <input class="form-input" id="wiz-category" placeholder="e.g. land, cars" value="${esc(cat)}">
    </div>
    <div class="form-group">
      <label class="form-label">Run Frequency</label>
      <select class="form-select" id="wiz-frequency">
        ${[['6', 'Every 6 hours'], ['12', 'Every 12 hours'], ['24', 'Every 24 hours (daily)'], ['48', 'Every 2 days'], ['168', 'Weekly']]
      .map(([v, l]) => `<option value="${v}" ${parseInt(v) === freq ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    ${!wizardEditId ? `
    <div class="form-group">
      <label class="form-label">Max Pages to Scan</label>
      <input class="form-input" id="wiz-max-pages" type="number" min="1" max="10" value="${wizardData.max_pages || 2}" style="max-width:120px">
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">Scans deeper when new listings are found, stops when all are already known. Job auto-runs after creation.</div>
    </div>
    ` : ''}
    <div style="margin-top:16px;padding:14px;background:var(--bg-input);border-radius:var(--radius-sm);font-size:0.82rem;color:var(--text-secondary)">
      <strong>Summary:</strong><br>
      Deep-dive rules: ${ddCount || 'None (all)'} in ${wizardData.deep_dive_rules.length || 0} group(s)<br>
      Log filters: ${logCount || 'None (all)'} in ${wizardData.log_rules.length || 0} group(s)<br>
      Card fields: ${wizardData.card_fields.length}<br>
      Detail fields: ${wizardData.detail_fields.length}
    </div>
  `;
}

/* ─── Rule Group Builder ──────────────────────────────────── */
function renderRuleGroups(containerId, dataKey, fields) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  wizardData[dataKey].forEach((group, gi) => {
    const groupDiv = document.createElement('div');
    groupDiv.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-bottom:12px;background:var(--bg-input)';
    const modeColors = { AND: 'var(--primary)', OR: 'var(--success)', EXCLUDE: 'var(--danger)' };
    groupDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <select style="font-weight:600;color:${modeColors[group.mode] || 'var(--primary)'}"
          onchange="wizardData['${dataKey}'][${gi}].mode=this.value;renderRuleGroups('${containerId}','${dataKey}',${JSON.stringify(fields).replace(/"/g, '&quot;')})">
          ${['AND', 'OR', 'EXCLUDE'].map(m => `<option value="${m}" ${m === group.mode ? 'selected' : ''} style="color:${modeColors[m]}">${m === 'EXCLUDE' ? '🚫 EXCLUDE' : m === 'OR' ? '🔀 OR' : '✅ AND'}</option>`).join('')}
        </select>
        <span style="flex:1;font-size:0.75rem;color:var(--text-muted)">
          ${group.mode === 'AND' ? 'All conditions must match' : group.mode === 'OR' ? 'Any condition can match' : 'Reject if any matches'}
        </span>
        <button class="rule-remove" onclick="wizardData['${dataKey}'].splice(${gi},1);renderRuleGroups('${containerId}','${dataKey}',${JSON.stringify(fields).replace(/"/g, '&quot;')})">×</button>
      </div>
      <div class="rules-list" id="${containerId}-g${gi}"></div>
      <button class="add-rule-btn" style="font-size:0.75rem;padding:4px 10px" onclick="addRuleToGroup('${containerId}','${dataKey}',${gi},${JSON.stringify(fields).replace(/"/g, '&quot;')})">+ Add Rule</button>
    `;
    container.appendChild(groupDiv);
    const rulesDiv = groupDiv.querySelector(`#${containerId}-g${gi}`);
    (group.rules || []).forEach((rule, ri) => {
      addRuleRow(rulesDiv, dataKey, gi, ri, fields, rule, containerId);
    });
  });
}

function addRuleGroup(containerId, dataKey) {
  const fields = dataKey === 'deep_dive_rules'
    ? wizardData.card_fields.filter(f => f.type === 'number' || f.type === 'text' || f.type === 'enum')
    : [...wizardData.card_fields, ...wizardData.detail_fields.filter(f => f.key.startsWith('detail.'))];
  wizardData[dataKey].push({ mode: 'AND', rules: [] });
  renderRuleGroups(containerId, dataKey, fields);
}

function addRuleToGroup(containerId, dataKey, gi, fields) {
  wizardData[dataKey][gi].rules.push({ field: fields[0]?.key || '', op: '>=', value: '' });
  renderRuleGroups(containerId, dataKey, fields);
}

function addRuleRow(container, dataKey, gi, ri, fields, rule, containerId) {
  const div = document.createElement('div');
  div.className = 'rule-row';
  div.innerHTML = `
    <select onchange="wizardData['${dataKey}'][${gi}].rules[${ri}].field=this.value">
      ${fields.map(f => `<option value="${f.key}" ${f.key === rule.field ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
    </select>
    <select onchange="wizardData['${dataKey}'][${gi}].rules[${ri}].op=this.value">
      ${['>=', '<=', '>', '<', '==', '!=', 'contains'].map(op =>
    `<option value="${op}" ${op === rule.op ? 'selected' : ''}>${op}</option>`
  ).join('')}
    </select>
    <input value="${esc(String(rule.value || ''))}" placeholder="value"
      onchange="wizardData['${dataKey}'][${gi}].rules[${ri}].value=this.value">
    <button class="rule-remove" onclick="wizardData['${dataKey}'][${gi}].rules.splice(${ri},1);renderRuleGroups('${containerId}','${dataKey}',${JSON.stringify(fields).replace(/\x22/g, '&quot;')})">×</button>
  `;
  container.appendChild(div);
}

function removeRule(dataKey, idx, el) {
  // Legacy — kept for backward compat but groups handle their own removal now
  el.remove();
}

/* ─── Wizard Navigation ───────────────────────────────────── */
function wizardBack() {
  if (wizardStep > 0) {
    // Skip auto-scan steps when going back
    wizardStep--;
    if (wizardStep === 3) wizardStep--;
    if (wizardStep === 1) wizardStep--;
    renderWizard();
  }
}

async function wizardNext() {
  switch (wizardStep) {
    case 0:
      wizardData.url = document.getElementById('wiz-url').value.trim();
      if (!wizardData.url || !wizardData.url.includes('ikman.lk')) {
        alert('Please enter a valid ikman.lk URL');
        return;
      }
      break;
    case 1:
      // Scan done, just advance
      break;
    case 2:
      // Deep-dive rules saved in wizardData already
      break;
    case 3:
      // Detail scan done, just advance
      break;
    case 4:
      // Log rules saved in wizardData already
      break;
    case 5:
      // Save job
      const name = document.getElementById('wiz-name').value.trim();
      if (!name) { alert('Please enter a job name'); return; }
      const category = document.getElementById('wiz-category').value.trim();
      const frequency = parseInt(document.getElementById('wiz-frequency').value);

      if (wizardEditId) {
        // Update existing job
        await api('PUT', `/jobs/${wizardEditId}`, {
          name,
          url: wizardData.url,
          category: category || null,
          deep_dive_rules: wizardData.deep_dive_rules,
          log_rules: wizardData.log_rules,
          frequency_hours: frequency,
        });
      } else {
        // Create new job
        const maxPages = parseInt(document.getElementById('wiz-max-pages')?.value) || 2;
        await api('POST', '/jobs', {
          name,
          url: wizardData.url,
          category: category || null,
          card_fields: wizardData.card_fields,
          detail_fields: wizardData.detail_fields,
          deep_dive_rules: wizardData.deep_dive_rules,
          log_rules: wizardData.log_rules,
          frequency_hours: frequency,
          max_pages: maxPages,
        });
      }

      closeWizard();
      loadJobs();
      return;
  }

  wizardStep++;
  renderWizard();
}

/* ─── Helpers ──────────────────────────────────────────────── */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

/* ─── Price Chart ──────────────────────────────────────────── */
async function showPriceChart(listingId, title) {
  const prices = await api('GET', `/listings/${listingId}/prices`);
  if (!prices || prices.length === 0) {
    alert('No price history yet for this listing.');
    return;
  }

  // Create modal
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '600px';
  modal.innerHTML = `
    <div class="modal-header">
      <h2>📈 Price History</h2>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
    </div>
    <div class="modal-body">
      <p style="margin-bottom:12px;font-size:0.85rem;color:var(--text-secondary)">${esc(title)}</p>
      <canvas id="price-canvas" width="540" height="260"></canvas>
      <div id="price-table" style="margin-top:16px"></div>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Draw chart
  const canvas = document.getElementById('price-canvas');
  const ctx = canvas.getContext('2d');
  const values = prices.map(p => parseFloat(p.price_value));
  const dates = prices.map(p => new Date(p.recorded_at));
  const min = Math.min(...values) * 0.95;
  const max = Math.max(...values) * 1.05;
  const range = max - min || 1;

  const pad = { t: 20, r: 20, b: 40, l: 80 };
  const w = canvas.width - pad.l - pad.r;
  const h = canvas.height - pad.t - pad.b;

  // Background
  ctx.fillStyle = '#1a1d27';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines
  ctx.strokeStyle = '#2d3148';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (h / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
    const val = max - (range / 4) * i;
    ctx.fillStyle = '#5c6078';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Rs ' + Math.round(val).toLocaleString(), pad.l - 8, y + 4);
  }

  // Line
  if (values.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2.5;
    values.forEach((v, i) => {
      const x = pad.l + (w / (values.length - 1)) * i;
      const y = pad.t + h - ((v - min) / range) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Gradient fill
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    grad.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
    grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
    ctx.lineTo(pad.l + w, pad.t + h);
    ctx.lineTo(pad.l, pad.t + h);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Dots
  values.forEach((v, i) => {
    const x = pad.l + (values.length > 1 ? (w / (values.length - 1)) * i : w / 2);
    const y = pad.t + h - ((v - min) / range) * h;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#6366f1';
    ctx.fill();
    ctx.strokeStyle = '#1a1d27';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // Date labels
  ctx.fillStyle = '#5c6078';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(dates.length / 5));
  dates.forEach((d, i) => {
    if (i % step === 0 || i === dates.length - 1) {
      const x = pad.l + (values.length > 1 ? (w / (values.length - 1)) * i : w / 2);
      ctx.fillText(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), x, pad.t + h + 20);
    }
  });

  // Price change summary
  const first = values[0];
  const last = values[values.length - 1];
  const diff = last - first;
  const pct = first ? ((diff / first) * 100).toFixed(1) : 0;
  const arrow = diff < 0 ? '🔻' : diff > 0 ? '🔺' : '';
  const color = diff < 0 ? 'var(--success)' : diff > 0 ? 'var(--danger)' : 'var(--text-muted)';

  document.getElementById('price-table').innerHTML = `
    <div style="text-align:center;font-size:0.9rem">
      <span style="color:${color};font-weight:600">${arrow} Rs ${Math.round(first).toLocaleString()} → Rs ${Math.round(last).toLocaleString()} (${pct}%)</span>
      <span style="color:var(--text-muted);margin-left:8px">${prices.length} data points</span>
    </div>
  `;
}

/* ─── Job Detail Page ─────────────────────────────────────── */
let currentJobId = null;
let priceChart = null;

function openJobDetail(id, name) {
  currentJobId = id;
  document.getElementById('job-detail-title').textContent = name;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('job-detail-view').classList.add('active');
  currentView = 'job-detail';
  loadJobDetail(id);
}

async function loadJobDetail(id) {
  try {
    const [analytics, history] = await Promise.all([
      api('GET', `/jobs/${id}/analytics`),
      api('GET', `/jobs/${id}/price-history`),
    ]);

    renderJobStats(analytics);
    renderPriceChart(history);

    // Store group fields globally for custom rule builder
    window._jobGroupFields = analytics.availableGroupFields || [];

    // Populate group-by dropdown
    const select = document.getElementById('group-by-select');
    select.innerHTML = '<option value="">None</option>' +
      window._jobGroupFields.map(f => `<option value="${f}">${f}</option>`).join('');

    document.getElementById('job-groups-grid').innerHTML = '';

    // Load listings via filter bar
    jobListingPage = 0;
    loadJobListingsFiltered();
  } catch (err) {
    console.error('Failed to load job detail:', err);
  }
}

function formatPrice(val) {
  if (!val) return '—';
  if (val >= 1000000) return 'Rs ' + (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return 'Rs ' + (val / 1000).toFixed(0) + 'K';
  return 'Rs ' + val.toLocaleString();
}

function renderJobStats(a) {
  const trendArrow = a.price.trendPct !== null
    ? (a.price.trendPct < 0 ? `🔻 ${a.price.trendPct}%` : `🔺 +${a.price.trendPct}%`)
    : '—';
  const demandIcons = { hot: '🔥 Hot', warm: '🌡️ Warm', cool: '❄️ Cool', unknown: '❓' };

  document.getElementById('job-stats-bar').innerHTML = `
    <div class="stat-card">
      <div class="stat-card-value">${formatPrice(a.price.avg)}</div>
      <div class="stat-card-label">Avg Price</div>
      <div style="font-size:0.75rem;color:var(--text-muted)">${trendArrow} (7d)</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value">${formatPrice(a.price.min)} – ${formatPrice(a.price.max)}</div>
      <div class="stat-card-label">Price Range</div>
      <div style="font-size:0.75rem;color:var(--text-muted)">Median: ${formatPrice(a.price.median)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value">${demandIcons[a.timeToSell.demandLevel]}</div>
      <div class="stat-card-label">Demand</div>
      <div style="font-size:0.75rem;color:var(--text-muted)">Avg sell: ${a.timeToSell.avgDays || '?'} days</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value">${a.price.matchedCount}</div>
      <div class="stat-card-label">Matched</div>
      <div style="font-size:0.75rem;color:var(--text-muted)">${a.priceDrops.count} price drops</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value">+${a.ratio.new7d} / -${a.ratio.sold7d}</div>
      <div class="stat-card-label">New / Sold (7d)</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value">${a.age.avgDays || '?'}d</div>
      <div class="stat-card-label">Avg Listing Age</div>
      <div style="font-size:0.75rem;color:var(--text-muted)">${a.age.postedToday} new today</div>
    </div>
  `;
}

function renderPriceChart(history) {
  const ctx = document.getElementById('price-history-chart');
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  if (!history || history.length === 0) {
    ctx.parentElement.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px 0">No price history yet — run the job to collect data.</p>';
    return;
  }

  const labels = history.map(h => new Date(h.day).toLocaleDateString());
  const data = history.map(h => parseFloat(h.avg_price));

  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Avg Price',
        data,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => formatPrice(ctx.parsed.y)
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: val => formatPrice(val),
            color: '#94a3b8',
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        x: {
          ticks: { color: '#94a3b8', maxTicksLimit: 10 },
          grid: { display: false },
        },
      },
    },
  });
}

async function loadJobGroups() {
  const field = document.getElementById('group-by-select').value;
  if (!field || !currentJobId) {
    document.getElementById('job-groups-grid').innerHTML = '';
    return;
  }
  try {
    const groups = await api('GET', `/jobs/${currentJobId}/groups?field=${encodeURIComponent(field)}`);
    renderJobGroups(groups);
  } catch (err) {
    document.getElementById('job-groups-grid').innerHTML = `<p style="color:var(--danger)">Error loading groups: ${err.message}</p>`;
  }
}

let activeGroupKey = null;
let currentGroups = [];

function renderJobGroups(groups) {
  currentGroups = groups || [];
  const grid = document.getElementById('job-groups-grid');
  if (!groups || groups.length === 0) {
    grid.innerHTML = '';
    return;
  }

  // Show all button if a group is selected
  const showAllBtn = activeGroupKey
    ? `<div style="margin-bottom:12px">
        <button class="btn btn-sm btn-ghost" onclick="clearGroupSelection()" style="color:var(--accent)">← Show All Listings</button>
        <span style="font-size:0.85rem;color:var(--text-secondary);margin-left:8px">Filtered by: <strong>${esc(activeGroupKey)}</strong></span>
       </div>`
    : '';

  grid.innerHTML = showAllBtn + `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">` +
    groups.map(g => {
      const isActive = activeGroupKey === g.group_key;
      const borderStyle = isActive ? 'border-color:var(--accent);box-shadow:0 0 12px rgba(99,102,241,0.3)' : '';
      return `
      <div class="job-card" style="padding:14px;cursor:pointer;${borderStyle}" onclick="selectGroup('${esc(String(g.group_key || ''))}')">
        <div class="job-card-header" style="margin-bottom:8px">
          <span class="job-card-title" style="font-size:0.9rem">${esc(String(g.group_key || 'Unknown'))}</span>
          <span class="job-card-badge badge-active" style="font-size:0.7rem">${g.count}</span>
        </div>
        <div class="job-card-stats" style="gap:12px">
          <div class="stat">
            <div class="stat-value" style="font-size:1rem">${formatPrice(parseFloat(g.avg_price))}</div>
            <div class="stat-label">Avg</div>
          </div>
          <div class="stat">
            <div class="stat-value" style="font-size:1rem">${formatPrice(parseFloat(g.min_price))}</div>
            <div class="stat-label">Min</div>
          </div>
          <div class="stat">
            <div class="stat-value" style="font-size:1rem">${formatPrice(parseFloat(g.max_price))}</div>
            <div class="stat-label">Max</div>
          </div>
        </div>
      </div>`;
    }).join('') + '</div>';
}

function selectGroup(key) {
  activeGroupKey = activeGroupKey === key ? null : key;
  renderJobGroups(currentGroups);

  // Filter listings by group if custom groups have listing_ids
  const group = currentGroups.find(g => g.group_key === activeGroupKey);
  if (group && group.listing_ids && group.listing_ids.length > 0) {
    // Fetch those specific listings
    filterListingsByIds(group.listing_ids);
  } else if (activeGroupKey && !group?.listing_ids) {
    // Auto-group: filter by search
    loadJobListingsFiltered();
  } else {
    loadJobListingsFiltered();
  }
}

async function filterListingsByIds(ids) {
  if (!currentJobId || !ids?.length) return;
  const data = await api('GET', `/listings?job_id=${currentJobId}&matched_only=true&limit=200`);
  const all = data.listings || data;
  const filtered = all.filter(l => ids.includes(l.id));
  renderJobListings(filtered);
  document.getElementById('job-listings-pagination').innerHTML = `<span style="color:var(--text-muted);font-size:0.85rem">${filtered.length} listings in this group</span>`;
}

function clearGroupSelection() {
  activeGroupKey = null;
  renderJobGroups(currentGroups);
  loadJobListingsFiltered();
}

/* ─── Custom Group Rules ──────────────────────────────────── */
let customGroupRules = [];

function addCustomGroupRule() {
  const fields = (window._jobGroupFields || []).map(f => `<option value="${f}">${f}</option>`).join('');
  customGroupRules.push({ name: '', field: '', op: 'contains', value: '' });
  renderCustomGroupRules();
}

function renderCustomGroupRules() {
  const container = document.getElementById('custom-group-rules');
  const fields = window._jobGroupFields || [];
  const fieldOpts = '<option value="title">Title</option>' + fields.map(f => `<option value="${f}">${f}</option>`).join('');
  container.innerHTML = customGroupRules.map((r, i) => `
    <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;flex-wrap:wrap">
      <input class="form-input" style="width:100px" placeholder="Group name" value="${esc(r.name)}"
        onchange="customGroupRules[${i}].name=this.value">
      <select class="form-input" style="width:120px" onchange="customGroupRules[${i}].field=this.value">
        ${fieldOpts.replace(`value="${r.field}"`, `value="${r.field}" selected`)}
      </select>
      <select class="form-input" style="width:110px" onchange="customGroupRules[${i}].op=this.value">
        <option value="contains" ${r.op === 'contains' ? 'selected' : ''}>contains</option>
        <option value="equals" ${r.op === 'equals' ? 'selected' : ''}>equals</option>
        <option value="starts_with" ${r.op === 'starts_with' ? 'selected' : ''}>starts with</option>
        <option value="regex" ${r.op === 'regex' ? 'selected' : ''}>regex</option>
      </select>
      <input class="form-input" style="width:120px" placeholder="Value" value="${esc(r.value)}"
        onchange="customGroupRules[${i}].value=this.value">
      <button class="btn btn-sm btn-danger" onclick="customGroupRules.splice(${i},1);renderCustomGroupRules()">✕</button>
    </div>
  `).join('');
}

async function applyCustomGroups() {
  if (!currentJobId || customGroupRules.length === 0) return;
  const validRules = customGroupRules.filter(r => r.name && r.value);
  if (validRules.length === 0) { alert('Add at least one rule with name and value'); return; }
  try {
    const groups = await api('POST', `/jobs/${currentJobId}/custom-groups`, { rules: validRules });
    renderJobGroups(groups);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

/* ─── Job Detail Filtered Listings ────────────────────────── */
let jobListingPage = 0;

async function loadJobListingsFiltered() {
  if (!currentJobId) return;
  const search = document.getElementById('job-listing-search').value;
  const status = document.getElementById('job-listing-status').value;
  const sort = document.getElementById('job-listing-sort').value;
  const matchedOnly = document.getElementById('job-listing-matched').checked;

  const params = new URLSearchParams({
    job_id: currentJobId,
    limit: 50,
    offset: jobListingPage * 50,
  });
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (sort) params.set('sort', sort);
  if (matchedOnly) params.set('matched_only', 'true');

  const data = await api('GET', `/listings?${params}`);
  const listings = data.listings || data;
  renderJobListings(listings);

  // Pagination
  if (data.total) {
    const totalPages = Math.ceil(data.total / 50);
    document.getElementById('job-listings-pagination').innerHTML = `
      <button class="btn btn-sm btn-ghost" onclick="jobListingPage=Math.max(0,jobListingPage-1);loadJobListingsFiltered()" ${jobListingPage === 0 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${jobListingPage + 1} of ${totalPages}</span>
      <button class="btn btn-sm btn-ghost" onclick="jobListingPage++;loadJobListingsFiltered()" ${jobListingPage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
    `;
  }
}

function renderJobListings(listings) {
  const grid = document.getElementById('job-listings-grid');
  if (!listings || listings.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted)">No matched listings yet.</p>';
    return;
  }
  grid.innerHTML = listings.map(l => renderListingCard(l)).join('');
}

/* ─── Init ─────────────────────────────────────────────────── */
loadJobs();
api('GET', '/version').then(d => {
  document.getElementById('app-version').textContent = `v${d.version}`;
}).catch(() => { });
