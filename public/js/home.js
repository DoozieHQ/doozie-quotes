function fmt(n) {
  return '£' + parseFloat(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Action rows ───────────────────────────────────────────────────────────────
function actionBtns(q, isLatest) {
  const view = q.status === 'draft'
    ? `<a href="/builder.html?id=${q.filename}" class="btn btn-sm btn-primary">Edit</a>`
    : `<a href="${q.quoteUrl || `/published/${q.id}-v${q.version}/`}" class="btn btn-sm btn-gold" target="_blank">&#127758; View Quote</a>`;

  const mgmt = isLatest
    ? `<button class="btn btn-sm btn-secondary" onclick="newVersion('${q.filename}')">New Version</button>
       <button class="btn btn-sm btn-secondary" onclick="duplicateQuote('${q.filename}')">Duplicate</button>`
    : '';

  const del = `<button class="btn btn-sm btn-danger" onclick="deleteQuote('${q.filename}','${q.id} v${q.version}')">Delete</button>`;

  return `<div class="actions">${view}${mgmt}${del}</div>`;
}

// ── Row renderers ─────────────────────────────────────────────────────────────
function renderLatestRow(q, olderCount, gid) {
  const expandBtn = olderCount > 0
    ? `<button class="expand-btn" id="expand-${gid}" onclick="toggleVersions('${gid}')">
         <span class="expand-icon">&#9654;</span>
       </button>`
    : `<span class="expand-spacer"></span>`;

  return `
    <tr class="row-latest">
      <td class="quote-ref">
        <div class="ref-cell">
          ${expandBtn}
          <span>${q.id}</span>
          <span class="v-chip v-chip-${q.status}">v${q.version}</span>
        </div>
      </td>
      <td>${q.customerName || '<span class="text-muted">—</span>'}</td>
      <td class="quote-proj">${q.projectTitle || '<span class="text-muted">—</span>'}</td>
      <td><span class="badge badge-${q.status}">${q.status}</span></td>
      <td class="quote-date">${fmtDate(q.createdAt)}</td>
      <td class="quote-total">${q.total ? fmt(q.total) : '—'}</td>
      <td>${actionBtns(q, true)}</td>
    </tr>`;
}

function renderOlderRow(q, gid) {
  return `
    <tr class="row-older" data-group="${gid}" style="display:none">
      <td class="quote-ref">
        <div class="ref-cell">
          <span class="expand-spacer"></span>
          <span>${q.id}</span>
          <span class="v-chip v-chip-${q.status}">v${q.version}</span>
        </div>
      </td>
      <td><span class="text-muted">${q.customerName || ''}</span></td>
      <td class="quote-proj"><span class="text-muted">${q.projectTitle || ''}</span></td>
      <td><span class="badge badge-${q.status}">${q.status}</span></td>
      <td class="quote-date">${fmtDate(q.createdAt)}</td>
      <td class="quote-total">${q.total ? fmt(q.total) : '—'}</td>
      <td>${actionBtns(q, false)}</td>
    </tr>`;
}

// ── Toggle older versions ─────────────────────────────────────────────────────
function toggleVersions(gid) {
  const rows = document.querySelectorAll(`tr[data-group="${gid}"]`);
  const btn  = document.getElementById(`expand-${gid}`);
  const icon = btn.querySelector('.expand-icon');
  const open = rows[0] && rows[0].style.display !== 'none';
  rows.forEach(r => { r.style.display = open ? 'none' : ''; });
  icon.innerHTML = open ? '&#9654;' : '&#9660;';
  btn.classList.toggle('expanded', !open);
}

// ── Load & render ─────────────────────────────────────────────────────────────
async function loadQuotes() {
  const res    = await fetch('/api/quotes');
  const all    = await res.json();
  const container = document.getElementById('quotes-container');

  if (!all.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>No quotes yet</strong>
        <p>Click <em>New Quote</em> to get started.</p>
      </div>`;
    return;
  }

  // Group by base id
  const groupMap = {};
  all.forEach(q => {
    if (!groupMap[q.id]) groupMap[q.id] = [];
    groupMap[q.id].push(q);
  });

  // Sort each group: highest version first
  const groups = Object.values(groupMap).map(g => {
    g.sort((a, b) => b.version - a.version);
    return g;
  });

  // Sort groups: most recent latest-version first
  groups.sort((a, b) => new Date(b[0].createdAt) - new Date(a[0].createdAt));

  // Build rows
  const rows = groups.map(group => {
    const latest = group[0];
    const older  = group.slice(1);
    const gid    = latest.id.replace(/-/g, ''); // safe DOM id
    return renderLatestRow(latest, older.length, gid)
         + older.map(q => renderOlderRow(q, gid)).join('');
  }).join('');

  container.innerHTML = `
    <table class="quotes-table">
      <thead>
        <tr>
          <th>Ref</th>
          <th>Customer</th>
          <th>Project</th>
          <th>Status</th>
          <th>Date</th>
          <th class="text-right">Total</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Quote actions ─────────────────────────────────────────────────────────────
async function newQuote() {
  const res = await fetch('/api/quotes', { method: 'POST' });
  const data = await res.json();
  if (data.filename) window.location.href = `/builder.html?id=${data.filename}`;
  else showToast('Failed to create quote', 'error');
}

async function newVersion(filename) {
  showConfirm(
    'Create new version?',
    'This will copy the quote as a new editable draft. The published version will remain unchanged.',
    async () => {
      const res  = await fetch(`/api/quotes/${filename}/version`, { method: 'POST' });
      const data = await res.json();
      if (data.filename) window.location.href = `/builder.html?id=${data.filename}`;
      else showToast('Failed to create version', 'error');
    }
  );
}

async function deleteQuote(filename, label) {
  showConfirm(
    'Delete quote?',
    `This will permanently delete ${label} and all its uploaded files (3D models, images). This cannot be undone.`,
    async () => {
      const res  = await fetch(`/api/quotes/${filename}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { showToast('Quote deleted'); loadQuotes(); }
      else showToast(data.error || 'Delete failed', 'error');
    },
    true // danger mode — red confirm button
  );
}

async function duplicateQuote(filename) {
  showConfirm(
    'Duplicate this quote?',
    'A copy will be created as a new draft with a new quote reference.',
    async () => {
      const orig   = await fetch(`/api/quotes/${filename}`).then(r => r.json());
      const newRes = await fetch('/api/quotes', { method: 'POST' });
      const newData = await newRes.json();
      if (!newData.filename) return showToast('Failed to duplicate', 'error');
      const copy = {
        ...orig,
        id: newData.quote.id, version: 1, status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedAt: undefined
      };
      await fetch(`/api/quotes/${newData.filename}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(copy)
      });
      window.location.href = `/builder.html?id=${newData.filename}`;
    }
  );
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
function showConfirm(title, msg, onOk, danger = false) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent   = msg;
  const okBtn = document.getElementById('confirm-ok');
  okBtn.className   = `btn ${danger ? 'btn-danger' : 'btn-gold'}`;
  okBtn.textContent = danger ? 'Delete' : 'Confirm';
  okBtn.onclick = () => { closeConfirm(); onOk(); };
  document.getElementById('confirm-overlay').classList.add('open');
}
function closeConfirm() {
  document.getElementById('confirm-overlay').classList.remove('open');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'toast show ' + type;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ── Header logo ───────────────────────────────────────────────────────────────
async function loadHeader() {
  try {
    const s    = await fetch('/api/settings').then(r => r.json());
    const img  = document.getElementById('header-logo-img');
    const text = document.getElementById('header-logo-text');
    if (s?.companyLogo && img) {
      img.src = `/uploads/settings/${s.companyLogo}`;
      img.style.display = '';
      if (text) text.style.display = 'none';
    }
  } catch(e) { /* leave text fallback */ }
}

loadHeader();
loadQuotes();
