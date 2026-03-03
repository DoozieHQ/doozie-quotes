let settings = null;

async function init() {
  settings = await fetch('/api/settings').then(r => r.json());
  populateForm();
}

// ── Populate ──────────────────────────────────────────────────────────────────
function populateForm() {
  setVal('s-company-name',   settings.companyName   || '');
  setVal('s-vat-rate',       settings.vatRate       || 20);
  setVal('s-netlify-token',  settings.netlifyToken  || '');
  setHTML('s-default-overview',  settings.defaultOverview  || '');
  setHTML('s-default-terms',    settings.defaultTerms    || '');
  setHTML('s-default-payment',  settings.defaultPaymentTerms || '');
  setHTML('s-default-scope',    settings.defaultScope    || '');
  setHTML('s-default-nextsteps',settings.defaultNextSteps || '');

  if (settings.companyLogo) showLogoPreview(`/uploads/settings/${settings.companyLogo}`);
  renderMaterials(settings.materialsLibrary || []);
  renderTemplates(settings.lineItemTemplates || []);
}

// ── Save All ──────────────────────────────────────────────────────────────────
async function saveSettings() {
  const body = {
    companyName:         getVal('s-company-name'),
    vatRate:             parseFloat(getVal('s-vat-rate')) || 20,
    netlifyToken:        getVal('s-netlify-token'),
    defaultOverview:     getHTML('s-default-overview'),
    defaultTerms:        getHTML('s-default-terms'),
    defaultPaymentTerms: getHTML('s-default-payment'),
    defaultScope:        getHTML('s-default-scope'),
    defaultNextSteps:    getHTML('s-default-nextsteps'),
    materialsLibrary:    collectMaterials(),
    lineItemTemplates:   collectTemplates()
  };
  const res = await fetch('/api/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (res.ok) { settings = await res.json(); showToast('Settings saved', 'success'); }
  else showToast('Save failed', 'error');
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function showLogoPreview(url) {
  document.getElementById('logo-placeholder').style.display = 'none';
  const img = document.getElementById('logo-preview');
  img.src = url; img.classList.add('visible');
}

async function uploadLogo(input) {
  const file = input.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('file', file);
  const res  = await fetch('/api/settings/upload/logo', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.url) { showLogoPreview(data.url); showToast('Logo uploaded', 'success'); }
  else showToast('Upload failed', 'error');
}

// ── Materials ─────────────────────────────────────────────────────────────────
function renderMaterials(mats) {
  const grid = document.getElementById('mat-grid');
  if (!mats.length) { grid.innerHTML = '<span class="text-muted" style="font-size:0.85rem">No materials yet.</span>'; return; }
  grid.innerHTML = mats.map(m => `
    <div class="mat-card" data-id="${m.id}">
      <div class="mat-img-wrap" onclick="triggerMatUpload('${m.id}')">
        ${m.imageFile
          ? `<img src="/uploads/settings/materials/${m.imageFile}" alt="${m.name}">`
          : '<div class="mat-img-placeholder">Click to add image</div>'}
        <div class="mat-img-upload">&#128247; Change image</div>
        <input type="file" class="mat-file-input" id="mat-file-${m.id}" accept="image/*" onchange="uploadMatImage(this,'${m.id}')">
      </div>
      <div class="mat-body">
        <input class="mat-name-input" type="text" value="${escAttr(m.name)}" placeholder="Material name">
        <textarea class="mat-desc-input" rows="2" placeholder="Short description (e.g. Painted MDF in matt white)">${escAttr(m.description || '')}</textarea>
      </div>
      <div class="mat-footer">
        <button class="btn btn-sm btn-danger" onclick="deleteMaterial('${m.id}')">Delete</button>
      </div>
    </div>`).join('');
}

function triggerMatUpload(id) {
  document.getElementById(`mat-file-${id}`)?.click();
}

function collectMaterials() {
  return Array.from(document.querySelectorAll('#mat-grid .mat-card')).map(card => {
    const existing = (settings.materialsLibrary || []).find(m => m.id === card.dataset.id);
    return {
      id:          card.dataset.id,
      name:        card.querySelector('.mat-name-input')?.value  || '',
      description: card.querySelector('.mat-desc-input')?.value  || '',
      imageFile:   existing?.imageFile || null
    };
  });
}

async function addMaterial() {
  const res  = await fetch('/api/settings/materials', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New Material', description: '' })
  });
  const mat = await res.json();
  settings.materialsLibrary = [...(settings.materialsLibrary || []), mat];
  renderMaterials(settings.materialsLibrary);
}

async function deleteMaterial(id) {
  if (!confirm('Delete this material from the library?')) return;
  await fetch(`/api/settings/materials/${id}`, { method: 'DELETE' });
  settings.materialsLibrary = (settings.materialsLibrary || []).filter(m => m.id !== id);
  renderMaterials(settings.materialsLibrary);
}

async function uploadMatImage(input, matId) {
  const file = input.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('file', file);
  const res  = await fetch(`/api/settings/materials/${matId}/upload`, { method: 'POST', body: fd });
  const data = await res.json();
  if (data.url) {
    const existing = (settings.materialsLibrary || []).find(m => m.id === matId);
    if (existing) existing.imageFile = data.filename;
    renderMaterials(settings.materialsLibrary);
    showToast('Image uploaded', 'success');
  } else showToast('Upload failed', 'error');
}

// ── Line Item Templates ────────────────────────────────────────────────────────
function renderTemplates(templates) {
  const list = document.getElementById('tpl-list');
  if (!templates.length) { list.innerHTML = '<p class="text-muted" style="font-size:0.85rem">No templates yet.</p>'; return; }
  list.innerHTML = templates.map(t => `
    <div class="tpl-item" data-id="${t.id}">
      <div class="tpl-header">
        <input class="tpl-name-input" type="text" value="${escAttr(t.name)}" placeholder="Template name">
        <button class="btn btn-sm btn-danger" onclick="deleteTemplate('${t.id}')">Delete</button>
      </div>
      <div class="tpl-body">
        <div class="tpl-items" id="tpl-items-${t.id}">
          ${(t.items || []).map(item => tplItemRow(item)).join('')}
        </div>
        <button class="btn btn-secondary btn-sm" onclick="addTplItem('${t.id}')">+ Add line</button>
      </div>
    </div>`).join('');
}

function tplItemRow(item = {}) {
  return `<div class="tpl-item-row">
    <input class="form-control tpl-item-desc" type="text" placeholder="Description" value="${escAttr(item.description || '')}">
    <input class="form-control tpl-item-price" type="number" step="0.01" min="0" placeholder="Price (£)" value="${item.price != null ? item.price : ''}">
    <button class="btn btn-sm btn-danger btn-icon" onclick="this.closest('.tpl-item-row').remove()">&#x2715;</button>
  </div>`;
}

function addTplItem(tplId) {
  document.getElementById(`tpl-items-${tplId}`)?.insertAdjacentHTML('beforeend', tplItemRow());
}

function collectTemplates() {
  return Array.from(document.querySelectorAll('#tpl-list .tpl-item')).map(tpl => ({
    id:    tpl.dataset.id,
    name:  tpl.querySelector('.tpl-name-input')?.value || '',
    items: Array.from(tpl.querySelectorAll('.tpl-item-row')).map(row => ({
      description: row.querySelector('.tpl-item-desc')?.value  || '',
      price:       parseFloat(row.querySelector('.tpl-item-price')?.value) || 0
    })).filter(i => i.description || i.price)
  }));
}

async function addTemplate() {
  const res  = await fetch('/api/settings/templates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New Template', items: [] })
  });
  const tpl = await res.json();
  settings.lineItemTemplates = [...(settings.lineItemTemplates || []), tpl];
  renderTemplates(settings.lineItemTemplates);
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  await fetch(`/api/settings/templates/${id}`, { method: 'DELETE' });
  settings.lineItemTemplates = (settings.lineItemTemplates || []).filter(t => t.id !== id);
  renderTemplates(settings.lineItemTemplates);
}

// ── Rich text link insertion ───────────────────────────────────────────────────
function insertLink() {
  const sel = window.getSelection();
  const savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  const url = prompt('Enter URL:', 'https://');
  if (!url || url === 'https://') return;
  if (savedRange && sel) { sel.removeAllRanges(); sel.addRange(savedRange); }
  document.execCommand('createLink', false, url);
  document.querySelectorAll('.rich-editor a').forEach(a => {
    a.target = '_blank'; a.rel = 'noopener noreferrer';
  });
}

// Add link button to every rich toolbar
document.querySelectorAll('.rich-toolbar').forEach(tb => {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.title = 'Insert link'; btn.textContent = '🔗';
  btn.addEventListener('click', insertLink);
  tb.appendChild(btn);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function getVal(id)      { return document.getElementById(id)?.value || ''; }
function setVal(id, v)   { const el = document.getElementById(id); if (el) el.value = v; }
function getHTML(id)     { return document.getElementById(id)?.innerHTML || ''; }
function setHTML(id, h)  { const el = document.getElementById(id); if (el) el.innerHTML = h; }
function escAttr(s)      { return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast show ${type}`;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}

init();
