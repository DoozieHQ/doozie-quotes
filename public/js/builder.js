// ── State ─────────────────────────────────────────────────────────────────────
let quoteFilename  = null;
let currentQuote   = null;
let settings       = null;
let unsaved        = false;
let viewers        = { closed: null, open: null };
let autoSaveTimer  = null;

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const params = new URLSearchParams(window.location.search);
  quoteFilename = params.get('id');
  if (!quoteFilename) { window.location.href = '/'; return; }

  settings = await fetch('/api/settings').then(r => r.json());

  // Show company logo in builder header
  if (settings?.companyLogo) {
    const img  = document.getElementById('header-logo-img');
    const text = document.getElementById('header-logo-text');
    if (img) { img.src = `/uploads/settings/${settings.companyLogo}`; img.style.display = ''; }
    if (text) text.style.display = 'none';
  }

  await loadQuote();
  populateMaterialsLibrary();
  populateTemplateDropdown();
  setupChangeListeners();
}

// ── Load & Save ───────────────────────────────────────────────────────────────
async function loadQuote() {
  const res = await fetch(`/api/quotes/${quoteFilename}`);
  if (!res.ok) { showToast('Quote not found', 'error'); return; }
  currentQuote = await res.json();
  populateForm();
  updateHeader();
}

async function saveQuote() {
  const data = collectFormData();
  const res  = await fetch(`/api/quotes/${quoteFilename}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (res.ok) {
    currentQuote = await res.json();
    markSaved();
  } else {
    const err = await res.json();
    showToast(err.error || 'Save failed', 'error');
  }
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveQuote, 3000);
  markUnsaved();
}

// ── Form population ───────────────────────────────────────────────────────────
function populateForm() {
  const q = currentQuote;
  setVal('f-customer-name',    q.customer?.name    || '');
  setVal('f-project-title',    q.projectTitle      || '');
  setVal('f-valid-until',      q.validUntil        || '');

  setHTML('f-overview',      q.overview      || '');
  setHTML('f-terms',         q.termsAndConditions || '');
  setHTML('f-payment-terms', q.paymentTerms  || '');
  setHTML('f-scope',         q.scope         || '');
  setHTML('f-next-steps',    q.nextSteps     || '');

  // VAT
  document.getElementById('f-vat-enabled').checked = q.vatEnabled !== false;
  setVal('f-vat-rate', q.vatRate || 20);

  // Line items (supports mixed section headers and regular rows)
  document.getElementById('line-items-body').innerHTML = '';
  (q.lineItems || []).forEach(item => {
    if (item.sectionName !== undefined) addSectionHeaderRow(item.sectionName);
    else addLineItemRow(item);
  });
  updateTotals();

  // Models
  if (q.models?.closed) showExistingModel('closed', q.models.closed);
  if (q.models?.open)   showExistingModel('open',   q.models.open);

  // Show texture areas if models already have textures
  ['closed','open'].forEach(type => {
    const m = q.models?.[type];
    if (m) {
      const sec = document.getElementById(`textures-${type}`);
      if (sec) sec.style.display = '';
      renderTextureList(type, typeof m === 'object' ? (m.textures || []) : []);
    }
  });

  // Materials
  renderSelectedMaterials(q.materials || []);
  syncLibrarySelection(q.materials || []);
}

function collectFormData() {
  const lineItems = collectLineItems();
  const vatEnabled = document.getElementById('f-vat-enabled').checked;
  const vatRate    = parseFloat(document.getElementById('f-vat-rate').value) || 20;
  const net   = lineItems.reduce((s, i) => s + i.price, 0);
  const vat   = vatEnabled ? net * (vatRate / 100) : 0;
  return {
    customer: {
      name: getVal('f-customer-name')
    },
    projectTitle: getVal('f-project-title'),
    validUntil:   getVal('f-valid-until'),
    overview:      getHTML('f-overview'),
    termsAndConditions: getHTML('f-terms'),
    paymentTerms:  getHTML('f-payment-terms'),
    scope:         getHTML('f-scope'),
    nextSteps:     getHTML('f-next-steps'),
    lineItems, vatEnabled, vatRate,
    netTotal: net, vatAmount: vat, total: net + vat,
    materials: collectSelectedMaterials(),
    models: currentQuote?.models || { closed: null, open: null }
  };
}

// ── Rich text helper ──────────────────────────────────────────────────────────
function fmt(cmd) { document.execCommand(cmd, false, null); }
function getVal(id) { return document.getElementById(id)?.value || ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function getHTML(id) { return document.getElementById(id)?.innerHTML || ''; }
function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

// ── Kommo Lead Link ───────────────────────────────────────────────────────────
function toggleKommoPanel() {
  const panel = document.getElementById('kommo-panel');
  const open  = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  if (!open) {
    document.getElementById('kommo-lead-input').focus();
    document.getElementById('kommo-status').textContent = '';
  }
}

async function linkKommoLead() {
  const raw    = document.getElementById('kommo-lead-input').value.trim();
  const status = document.getElementById('kommo-status');
  if (!raw) { status.textContent = 'Please enter a lead URL or ID.'; return; }

  // Extract numeric ID from URL or raw input
  const match = raw.match(/(\d+)\/?$/);
  if (!match) { status.textContent = 'Could not find a lead ID — paste the full Kommo lead URL or just the numeric ID.'; return; }
  const leadId = match[1];

  status.textContent = 'Fetching lead…';
  try {
    const res  = await fetch(`/api/kommo/leads/${leadId}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      status.textContent = data.error || 'Failed to fetch lead.';
      status.style.color = 'var(--danger)';
      return;
    }
    // Populate fields
    if (data.contactName) setVal('f-customer-name', data.contactName);
    if (data.leadName)    setVal('f-project-title',  data.leadName);
    // Store kommoLeadId on the quote so tracking/notes still work
    currentQuote.kommoLeadId = parseInt(leadId);
    scheduleAutoSave();
    status.textContent = '✓ Fields updated';
    status.style.color = 'var(--green)';
    setTimeout(toggleKommoPanel, 1500);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--danger)';
  }
}

// ── Header ────────────────────────────────────────────────────────────────────
function updateHeader() {
  const q = currentQuote;
  document.getElementById('header-ref').textContent = `${q.id} v${q.version}`;
  const badge = document.getElementById('header-status');
  badge.textContent  = q.status;
  badge.className    = `badge badge-${q.status}`;
  if (q.status === 'published') {
    document.querySelector('.btn-gold').disabled = true;
    document.querySelector('.btn-gold').textContent = 'Published';
  }
}

function markUnsaved() {
  unsaved = true;
  const el = document.getElementById('save-status');
  el.textContent = 'Unsaved changes'; el.className = 'save-status unsaved';
}
function markSaved() {
  unsaved = false;
  const el = document.getElementById('save-status');
  el.textContent = 'Saved ✓'; el.className = 'save-status saved';
  setTimeout(() => { if (!unsaved) el.textContent = ''; }, 3000);
}

// ── Change listeners ──────────────────────────────────────────────────────────
function setupChangeListeners() {
  const inputs = document.querySelectorAll('.builder-body input, .builder-body textarea, .builder-body select');
  inputs.forEach(el => el.addEventListener('input', scheduleAutoSave));
  document.querySelectorAll('.rich-editor').forEach(el =>
    el.addEventListener('input', scheduleAutoSave));
}

// ── 3D Models ─────────────────────────────────────────────────────────────────
async function uploadModel(input, type) {
  try {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    showToast('Uploading…');
    const res  = await fetch(`/api/quotes/${quoteFilename}/upload/model/${type}`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.success) { showToast('Upload failed', 'error'); return; }
    showToast('Uploaded');
    if (!currentQuote.models) currentQuote.models = {};
    // Preserve existing textures when replacing the model file
    const existingTextures = (typeof currentQuote.models[type] === 'object')
      ? (currentQuote.models[type]?.textures || []) : [];
    currentQuote.models[type] = { file: data.filename, textures: existingTextures };
    const uploadDir   = quoteFilename.replace('.json','');
    const textureUrls = existingTextures.map(t => `/uploads/${uploadDir}/models/${t}`);
    showViewerPreview(type, data.url, textureUrls, file.name);
    // Show texture upload area
    const sec = document.getElementById(`textures-${type}`);
    if (sec) sec.style.display = '';
    scheduleAutoSave();
  } catch(e) {
    showToast('Upload error: ' + e.message, 'error');
    console.error('uploadModel error:', e);
  }
}

function showExistingModel(type, modelData) {
  const uploadDir = quoteFilename.replace('.json','');
  let file, textures = [];
  if (typeof modelData === 'string') {
    file = modelData;
  } else if (modelData?.file) {
    file = modelData.file;
    textures = modelData.textures || [];
  } else return;
  const modelUrl    = `/uploads/${uploadDir}/models/${file}`;
  const textureUrls = textures.map(t => `/uploads/${uploadDir}/models/${t}`);
  showViewerPreview(type, modelUrl, textureUrls, file);
}

let viewerInstances = {};

function camToObj(c) {
  const p = v => ({ x: v.x || 0, y: v.y || 0, z: v.z || 0 });
  return { eye: p(c.eye), center: p(c.center), up: p(c.up), fov: c.fieldOfView || c.fov || 45 };
}
function objToCam(d) {
  return new OV.Camera(
    new OV.Coord3D(d.eye.x, d.eye.y, d.eye.z),
    new OV.Coord3D(d.center.x, d.center.y, d.center.z),
    new OV.Coord3D(d.up.x, d.up.y, d.up.z),
    d.fov
  );
}

function showViewerPreview(type, modelUrl, textureUrls = [], label = '') {
  const wrap   = document.getElementById(`wrap-${type}`);
  const info   = document.getElementById(`info-${type}`);
  const el     = document.getElementById(`viewer-${type}`);
  const camKey = `ov_${quoteFilename.replace('.json','')}_${type}`;
  wrap.classList.add('visible');
  info.textContent = label || modelUrl.split('/').pop();

  // Show a loading placeholder while the viewer initialises
  el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:0.85rem;">Loading 3D model…</div>';

  if (typeof OV === 'undefined') {
    el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:1rem;color:#c00;font-size:0.85rem;text-align:center;">⚠️ 3D viewer library failed to load — check your internet connection and reload.</div>';
    return;
  }

  // Small delay so the browser has a full render cycle to lay out the container
  // before WebGL reads its dimensions (fixes blank viewer after display:none → block).
  setTimeout(() => {
    el.innerHTML = '';
    try {
      const allUrls = [modelUrl, ...textureUrls];
      const ev = new OV.EmbeddedViewer(el, {
        backgroundColor: new OV.RGBAColor(248, 249, 250, 255),
        defaultColor:    new OV.RGBColor(200, 200, 200),
        onModelLoaded: function() {
          try {
            const v   = ev.GetViewer();
            const nav = v && v.navigation;
            const saved = localStorage.getItem(camKey);
            if (saved && nav && nav.MoveCamera) {
              nav.MoveCamera(objToCam(JSON.parse(saved)), 0);
            } else if (v && v.FitToWindow) {
              v.FitToWindow(true);
            }
            let t;
            const save = () => {
              try {
                const c = nav && nav.GetCamera && nav.GetCamera();
                if (c) localStorage.setItem(camKey, JSON.stringify(camToObj(c)));
              } catch(e) {}
            };
            const debounce = () => { clearTimeout(t); t = setTimeout(save, 600); };
            el.addEventListener('mouseup',  debounce);
            el.addEventListener('touchend', debounce);
            el.addEventListener('wheel',    debounce, { passive: true });
          } catch(e) {}
        },
        onModelError: function() {
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:1rem;color:#c00;font-size:0.85rem;text-align:center;">⚠️ Failed to load 3D model. If this is a .3ds or .obj file, upload any required texture / MTL files in the section below.</div>';
          console.error('3D viewer: model failed to load —', modelUrl);
        }
      });
      ev.LoadModelFromUrlList(allUrls);
      viewerInstances[type] = ev;
    } catch (e) {
      console.error('3D viewer init error:', e);
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:1rem;color:#c00;font-size:0.85rem;text-align:center;">⚠️ 3D viewer error: ' + e.message + '</div>';
    }
  }, 50);
}

function removeModel(type) {
  document.getElementById(`wrap-${type}`).classList.remove('visible');
  document.getElementById(`viewer-${type}`).innerHTML = '';
  const sec = document.getElementById(`textures-${type}`);
  if (sec) sec.style.display = 'none';
  renderTextureList(type, []);
  if (currentQuote.models) currentQuote.models[type] = null;
  document.getElementById(`upload-${type}`).value = '';
  scheduleAutoSave();
}

// ── Texture files ─────────────────────────────────────────────────────────────
async function uploadTextures(input, type) {
  if (!input.files.length) return;
  const fd = new FormData();
  for (const f of input.files) fd.append('files', f);
  showToast('Uploading textures…');
  const res  = await fetch(`/api/quotes/${quoteFilename}/upload/textures/${type}`, { method: 'POST', body: fd });
  const data = await res.json();
  if (!data.success) { showToast('Upload failed', 'error'); return; }
  // Update currentQuote
  if (!currentQuote.models) currentQuote.models = {};
  const cur  = currentQuote.models[type];
  const file = cur ? (typeof cur === 'string' ? cur : cur.file) : null;
  const prev = (typeof cur === 'object') ? (cur.textures || []) : [];
  currentQuote.models[type] = { file, textures: [...new Set([...prev, ...data.filenames])] };
  renderTextureList(type, currentQuote.models[type].textures);
  // Reinit viewer with new textures
  if (file) {
    const uploadDir   = quoteFilename.replace('.json','');
    const modelUrl    = `/uploads/${uploadDir}/models/${file}`;
    const textureUrls = currentQuote.models[type].textures.map(t => `/uploads/${uploadDir}/models/${t}`);
    showViewerPreview(type, modelUrl, textureUrls, file);
  }
  input.value = '';
  showToast('Textures uploaded');
  scheduleAutoSave();
}

async function removeTexture(type, filename) {
  await fetch(`/api/quotes/${quoteFilename}/texture/${type}/${filename}`, { method: 'DELETE' });
  const cur = currentQuote.models?.[type];
  if (typeof cur === 'object') {
    cur.textures = (cur.textures || []).filter(t => t !== filename);
    renderTextureList(type, cur.textures);
    if (cur.file) {
      const uploadDir   = quoteFilename.replace('.json','');
      const modelUrl    = `/uploads/${uploadDir}/models/${cur.file}`;
      const textureUrls = cur.textures.map(t => `/uploads/${uploadDir}/models/${t}`);
      showViewerPreview(type, modelUrl, textureUrls, cur.file);
    }
  }
  scheduleAutoSave();
}

function renderTextureList(type, textures) {
  const container = document.getElementById(`texture-list-${type}`);
  if (!container) return;
  if (!textures.length) { container.innerHTML = ''; return; }
  container.innerHTML = textures.map(t => `
    <div class="texture-file">
      <span class="texture-name">${t}</span>
      <button class="btn btn-sm btn-danger btn-icon" onclick="removeTexture('${type}','${t}')" title="Remove">&#x2715;</button>
    </div>`).join('');
}

// ── Materials ─────────────────────────────────────────────────────────────────
function populateMaterialsLibrary() {
  const lib = settings.materialsLibrary || [];
  const container = document.getElementById('materials-library');
  if (!lib.length) return; // leave the "no materials" message

  container.innerHTML = lib.map(m => `
    <div class="lib-item" id="lib-${m.id}" onclick="toggleMaterial('${m.id}')">
      ${m.imageFile
        ? `<img src="/uploads/settings/materials/${m.imageFile}" alt="${m.name}">`
        : '<div class="lib-item-swatch"></div>'}
      ${m.name}
    </div>`).join('');
}

function populateTemplateDropdown() {
  const sel = document.getElementById('template-select');
  (settings.lineItemTemplates || []).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id; opt.textContent = t.name;
    sel.appendChild(opt);
  });
}

function toggleMaterial(matId) {
  const lib  = settings.materialsLibrary || [];
  const libM = lib.find(m => m.id === matId);
  if (!libM) return;
  const selected = collectSelectedMaterials();
  const idx = selected.findIndex(m => m.id === matId);
  if (idx === -1) {
    selected.push({ id: matId, name: libM.name, description: libM.description || '', imageFile: libM.imageFile || null });
  } else {
    selected.splice(idx, 1);
  }
  renderSelectedMaterials(selected);
  syncLibrarySelection(selected);
  scheduleAutoSave();
}

function renderSelectedMaterials(materials) {
  const container = document.getElementById('selected-materials');
  if (!materials.length) { container.innerHTML = ''; return; }
  container.innerHTML = materials.map(m => {
    // Always use the current library description (live snapshot)
    const libM = (settings.materialsLibrary || []).find(l => l.id === m.id);
    const desc = libM?.description || m.description || '';
    return `
    <div class="selected-material-row" data-id="${m.id}">
      ${m.imageFile
        ? `<img src="/uploads/settings/materials/${m.imageFile}" alt="${m.name}">`
        : '<div class="mat-swatch-placeholder"></div>'}
      <div class="mat-info">
        <div class="mat-name">${m.name}</div>
        ${desc ? `<div class="mat-desc-text">${desc}</div>` : ''}
      </div>
      <button class="btn btn-sm btn-danger btn-icon" onclick="removeMaterial('${m.id}')" title="Remove">&#x2715;</button>
    </div>`;
  }).join('');
}

function removeMaterial(matId) {
  const selected = collectSelectedMaterials().filter(m => m.id !== matId);
  renderSelectedMaterials(selected);
  syncLibrarySelection(selected);
  scheduleAutoSave();
}

function collectSelectedMaterials() {
  return Array.from(document.querySelectorAll('#selected-materials .selected-material-row')).map(row => {
    const lib = (settings.materialsLibrary || []).find(m => m.id === row.dataset.id);
    return {
      id:          row.dataset.id,
      name:        lib?.name        || '',
      description: lib?.description || '',
      imageFile:   lib?.imageFile   || null
    };
  });
}

function syncLibrarySelection(selected) {
  const ids = selected.map(m => m.id);
  document.querySelectorAll('.lib-item').forEach(el => {
    const id = el.id.replace('lib-','');
    el.classList.toggle('selected', ids.includes(id));
  });
}

// ── Pricing ───────────────────────────────────────────────────────────────────
function addLineItem(item = {}) {
  addLineItemRow(item);
  updateTotals();
  scheduleAutoSave();
}

function addSectionHeader(name = '') {
  addSectionHeaderRow(name);
  scheduleAutoSave();
}

function addSectionHeaderRow(name = '') {
  const tbody = document.getElementById('line-items-body');
  const tr = document.createElement('tr');
  tr.className = 'li-section-row';
  tr.innerHTML = `
    <td class="li-section-cell" colspan="2">
      <input class="li-section-input" type="text" placeholder="Section name…"
        value="${escAttr(name)}" oninput="scheduleAutoSave()">
    </td>
    <td class="li-remove">
      <button class="remove-row-btn" onclick="removeSectionRow(this)" title="Remove section">&#x2715;</button>
    </td>`;
  tbody.appendChild(tr);
}

function addLineItemRow(item = {}) {
  const tbody = document.getElementById('line-items-body');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="li-desc">
      <input type="text" placeholder="Description" value="${escAttr(item.description || '')}"
        oninput="scheduleAutoSave()">
    </td>
    <td class="li-price">
      <input type="number" step="0.01" min="0" placeholder="0.00"
        value="${item.price != null ? item.price : ''}"
        oninput="updateTotals(); scheduleAutoSave()">
    </td>
    <td class="li-remove">
      <button class="remove-row-btn" onclick="removeLineItemRow(this)" title="Remove">&#x2715;</button>
    </td>`;
  tbody.appendChild(tr);
}

function removeLineItemRow(btn) {
  btn.closest('tr').remove();
  updateTotals();
  scheduleAutoSave();
}

function removeSectionRow(btn) {
  btn.closest('tr').remove();
  scheduleAutoSave();
}

function collectLineItems() {
  return Array.from(document.querySelectorAll('#line-items-body tr')).map(tr => {
    if (tr.classList.contains('li-section-row')) {
      const input = tr.querySelector('.li-section-input');
      return { sectionName: input?.value || '' };
    }
    const inputs = tr.querySelectorAll('input');
    return {
      description: inputs[0]?.value || '',
      price:       parseFloat(inputs[1]?.value) || 0
    };
  }).filter(i => i.sectionName !== undefined || i.description || i.price);
}

function updateTotals() {
  const items      = collectLineItems();
  const vatEnabled = document.getElementById('f-vat-enabled').checked;
  const vatRate    = parseFloat(document.getElementById('f-vat-rate').value) || 20;
  const net        = items.reduce((s, i) => s + i.price, 0);
  const vat        = vatEnabled ? net * (vatRate / 100) : 0;
  const grand      = net + vat;

  document.getElementById('total-net').textContent   = fmt(net);
  document.getElementById('total-vat').textContent   = fmt(vat);
  document.getElementById('total-grand').textContent = fmt(grand);
  document.getElementById('vat-label').textContent   = `VAT (${vatRate}%)`;
  document.getElementById('vat-row').style.display   = vatEnabled ? '' : 'none';
}

function loadTemplate() {
  const id  = document.getElementById('template-select').value;
  if (!id) return;
  const tpl = (settings.lineItemTemplates || []).find(t => t.id === id);
  if (!tpl) return;

  // Add a named section header then append the template's items
  addSectionHeaderRow(tpl.name);
  (tpl.items || []).forEach(item => addLineItemRow(item));

  // Reset the select so the same template can be added again
  document.getElementById('template-select').value = '';

  updateTotals();
  scheduleAutoSave();
}

// ── Publish ───────────────────────────────────────────────────────────────────
function confirmPublish() { document.getElementById('publish-modal').classList.add('open'); }
function closeModal()      { document.getElementById('publish-modal').classList.remove('open'); }

async function publishQuote() {
  closeModal();
  await saveQuote();
  showToast('Publishing — please wait…');
  const res  = await fetch(`/api/quotes/${quoteFilename}/publish`, { method: 'POST' });
  const data = await res.json();
  if (data.success) {
    currentQuote.status = 'published';
    updateHeader();

    // Populate the success modal
    const urlLink = document.getElementById('quote-url-link');
    urlLink.textContent = data.quoteUrl;
    urlLink.href        = data.quoteUrl;

    document.getElementById('success-modal').classList.add('open');
    showToast('Published!', 'success');
  } else {
    showToast(data.error || 'Publish failed', 'error');
  }
}

function copyQuoteUrl() {
  const url = document.getElementById('quote-url-link').textContent;
  navigator.clipboard.writeText(url).then(() => showToast('Link copied!', 'success'));
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmt(n) {
  if (typeof n === 'string' && !['bold','italic','underline','insertUnorderedList','insertOrderedList'].includes(n)) {
    return '£' + parseFloat(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // rich text command
  document.execCommand(n, false, null);
}

// Separate currency formatter
function fmtCurrency(n) {
  return '£' + parseFloat(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Fix: updateTotals uses fmtCurrency
(function fixTotals() {
  const orig = updateTotals;
  updateTotals = function() {
    const items      = collectLineItems();
    const vatEnabled = document.getElementById('f-vat-enabled').checked;
    const vatRate    = parseFloat(document.getElementById('f-vat-rate').value) || 20;
    const net        = items.reduce((s, i) => s + i.price, 0);
    const vat        = vatEnabled ? net * (vatRate / 100) : 0;
    const grand      = net + vat;
    document.getElementById('total-net').textContent   = fmtCurrency(net);
    document.getElementById('total-vat').textContent   = fmtCurrency(vat);
    document.getElementById('total-grand').textContent = fmtCurrency(grand);
    document.getElementById('vat-label').textContent   = `VAT (${vatRate}%)`;
    document.getElementById('vat-row').style.display   = vatEnabled ? '' : 'none';
  };
})();

function escAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast show ${type}`;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}

// Warn on unsaved changes
window.addEventListener('beforeunload', e => {
  if (unsaved) { e.preventDefault(); e.returnValue = ''; }
});

// ── fmt override: make it work for both rich text and display ─────────────────
// (redeclare so inline onclick="fmt('bold')" still works)
function fmt(cmd) { document.execCommand(cmd, false, null); }

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

init();
