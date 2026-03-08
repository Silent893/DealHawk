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
  btn.addEventListener('click', () => {
    currentView = btn.dataset.view;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${currentView}-view`).classList.add('active');
    if (currentView === 'jobs') loadJobs();
    if (currentView === 'listings') loadListings();
    if (currentView === 'runs') loadRuns();
  });
});

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

  grid.innerHTML = jobs.map(j => `
    <div class="job-card">
      <div class="job-card-header">
        <span class="job-card-title">${esc(j.name)}</span>
        <span class="job-card-badge ${j.active ? 'badge-active' : 'badge-paused'}">
          ${j.active ? 'Active' : 'Paused'}
        </span>
      </div>
      <div class="job-card-url">${esc(j.url)}</div>
      <div class="job-card-stats">
        <div class="stat">
          <div class="stat-value">${j.active_count || 0}</div>
          <div class="stat-label">Active</div>
        </div>
        <div class="stat">
          <div class="stat-value">${j.sold_count || 0}</div>
          <div class="stat-label">Sold</div>
        </div>
        <div class="stat">
          <div class="stat-value">${j.matched_count || 0}</div>
          <div class="stat-label">Matched</div>
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
      <div class="job-card-actions">
        <button class="btn btn-sm btn-primary" onclick="triggerRun(${j.id})">▶ Run Now</button>
        <button class="btn btn-sm btn-ghost" onclick="editJob(${j.id})">✏️ Edit</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleJob(${j.id}, ${!j.active})">
          ${j.active ? '⏸ Pause' : '▶ Resume'}
        </button>
        <button class="btn btn-sm btn-danger" onclick="deleteJob(${j.id}, '${esc(j.name)}')">🗑</button>
      </div>
    </div>
  `).join('');
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

  grid.innerHTML = data.listings.map(l => {
    const imgSrc = l.image_path ? `/api/images/${l.image_path}` :
      (l.image_urls && l.image_urls.length > 0 ? l.image_urls[0] : '');
    const detailFields = l.detail_fields || {};
    const detailHtml = Object.entries(detailFields).slice(0, 5).map(([k, v]) =>
      `<div class="listing-card-detail-row"><span class="listing-card-detail-key">${esc(k)}</span><span>${esc(v)}</span></div>`
    ).join('');

    const statusClass = l.status === 'sold' ? 'listing-badge-sold'
      : l.status === 'excluded' ? 'listing-badge-sold'
        : 'listing-badge-active';
    const statusLabel = l.status === 'sold' ? '🔴 Sold'
      : l.status === 'excluded' ? '⛔ Excluded'
        : '🟢 Active';

    return `
      <div class="listing-card ${l.status === 'sold' || l.status === 'excluded' ? 'listing-sold' : ''}">
        ${imgSrc ? `<img class="listing-card-img" src="${imgSrc}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="listing-card-body">
          <div class="listing-card-title">
            <a href="${l.url}" target="_blank" style="color:inherit;text-decoration:none">${esc(l.title || l.slug)}</a>
          </div>
          <div class="listing-card-price">
            ${esc(l.price || '')}
            ${l.prev_price && parseFloat(l.prev_price) !== parseFloat(l.price_value) ? (() => {
        const prev = parseFloat(l.prev_price);
        const curr = parseFloat(l.price_value);
        const diff = curr - prev;
        const pct = prev ? ((diff / prev) * 100).toFixed(1) : 0;
        return diff < 0
          ? `<span class="price-drop-badge drop">🔻 ${pct}%</span>`
          : `<span class="price-drop-badge rise">🔺 +${pct}%</span>`;
      })() : ''}
            ${l.job_avg_price && l.price_value ? (() => {
        const avg = parseFloat(l.job_avg_price);
        const price = parseFloat(l.price_value);
        const diff = ((price - avg) / avg * 100).toFixed(0);
        if (Math.abs(diff) < 3) return '<span class="price-drop-badge" style="background:rgba(100,100,100,0.15);color:var(--text-muted)">≈ avg</span>';
        return diff < 0
          ? `<span class="price-drop-badge drop">${diff}% avg</span>`
          : `<span class="price-drop-badge rise">+${diff}% avg</span>`;
      })() : ''}
          </div>
          <div class="listing-card-details">
            ${l.size_text ? `<div class="listing-card-detail-row"><span class="listing-card-detail-key">Size</span><span>${esc(l.size_text)}</span></div>` : ''}
            ${l.location ? `<div class="listing-card-detail-row"><span class="listing-card-detail-key">Location</span><span>${esc(l.location)}</span></div>` : ''}
            ${l.phone ? `<div class="listing-card-detail-row"><span class="listing-card-detail-key">Phone</span><span>${esc(l.phone)}</span></div>` : ''}
            ${detailHtml}
          </div>
        </div>
        <div class="listing-card-footer">
          <span class="${statusClass}">${statusLabel}</span>
          <span>${l.job_name || ''} · ${new Date(l.first_seen_at).toLocaleDateString()}</span>
          <button class="btn btn-sm btn-ghost" onclick="showPriceChart(${l.id}, '${esc(l.title || l.slug)}')" title="Price history">📈</button>
          ${l.status !== 'excluded' ? `<button class="btn btn-sm btn-ghost" onclick="excludeListing(${l.id})" title="Exclude listing">⛔</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

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
      <label class="form-label">ikman.lk Listing Page URL</label>
      <input class="form-input" id="wiz-url" placeholder="https://ikman.lk/en/ads/gampaha/land-for-sale" value="${esc(wizardData.url)}">
    </div>
    <p style="color:var(--text-muted);font-size:0.82rem">Paste the URL of any ikman.lk listing page. The scraper will scan it to discover available fields.</p>
  `;
}

async function scanListStep() {
  const body = document.getElementById('wizard-body');
  body.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Scanning list page for cards...</p></div>';

  try {
    const result = await api('POST', '/scan/list', { url: wizardData.url });
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
  body.innerHTML = `
    <p style="margin-bottom:14px;color:var(--text-secondary);font-size:0.85rem">
      Set conditions to decide which listings to deep-dive into. Leave empty to deep-dive all.
    </p>
    <div class="rules-list" id="deep-dive-rules"></div>
    <button class="add-rule-btn" onclick="addRule('deep-dive-rules', 'deep_dive_rules')">+ Add Condition</button>
  `;
  const container = document.getElementById('deep-dive-rules');
  wizardData.deep_dive_rules.forEach((rule, i) => addRuleRow(container, 'deep_dive_rules', i, fields, rule));
}

async function scanDetailStep() {
  const body = document.getElementById('wizard-body');
  body.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Deep-diving into a sample listing...</p></div>';

  // Pick first sample listing URL
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
  body.innerHTML = `
    <p style="margin-bottom:14px;color:var(--text-secondary);font-size:0.85rem">
      Set filters for which listings to <strong>log as matched</strong>. Matched listings will be highlighted. Leave empty to match all.
    </p>
    <div class="rules-list" id="log-rules"></div>
    <button class="add-rule-btn" onclick="addRule('log-rules', 'log_rules')">+ Add Filter</button>
  `;
  const container = document.getElementById('log-rules');
  wizardData.log_rules.forEach((rule, i) => addRuleRow(container, 'log_rules', i, allFields, rule));
}

function renderSaveStep(body) {
  let cat = wizardData.category || '';
  if (!cat) {
    if (wizardData.url.includes('land-for-sale')) cat = 'land';
    else if (wizardData.url.includes('cars')) cat = 'cars';
    else if (wizardData.url.includes('house')) cat = 'houses';
  }
  const freq = wizardData.frequency || 24;

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
      Deep-dive rules: ${wizardData.deep_dive_rules.length || 'None (all)'}<br>
      Log filters: ${wizardData.log_rules.length || 'None (all)'}<br>
      Card fields: ${wizardData.card_fields.length}<br>
      Detail fields: ${wizardData.detail_fields.length}
    </div>
  `;
}

/* ─── Rule Builder ─────────────────────────────────────────── */
function addRule(containerId, dataKey) {
  const fields = dataKey === 'deep_dive_rules'
    ? wizardData.card_fields
    : [...wizardData.card_fields, ...wizardData.detail_fields.filter(f => f.key.startsWith('detail.'))];

  const idx = wizardData[dataKey].length;
  wizardData[dataKey].push({ field: fields[0]?.key || '', op: '>=', value: '' });
  const container = document.getElementById(containerId);
  addRuleRow(container, dataKey, idx, fields, wizardData[dataKey][idx]);
}

function addRuleRow(container, dataKey, idx, fields, rule) {
  const div = document.createElement('div');
  div.className = 'rule-row';
  div.innerHTML = `
    <select onchange="wizardData['${dataKey}'][${idx}].field=this.value">
      ${fields.map(f => `<option value="${f.key}" ${f.key === rule.field ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
    </select>
    <select onchange="wizardData['${dataKey}'][${idx}].op=this.value">
      ${['>=', '<=', '>', '<', '==', '!=', 'contains'].map(op =>
    `<option value="${op}" ${op === rule.op ? 'selected' : ''}>${op}</option>`
  ).join('')}
    </select>
    <input value="${esc(String(rule.value || ''))}" placeholder="value"
      onchange="wizardData['${dataKey}'][${idx}].value=this.value">
    <button class="rule-remove" onclick="removeRule('${dataKey}',${idx},this.parentElement)">×</button>
  `;
  container.appendChild(div);
}

function removeRule(dataKey, idx, el) {
  wizardData[dataKey].splice(idx, 1);
  el.remove();
  // Re-render to fix indices
  const step = dataKey === 'deep_dive_rules' ? 2 : 4;
  if (wizardStep === step) renderWizard();
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

/* ─── Init ─────────────────────────────────────────────────── */
loadJobs();
