const express   = require('express');
const multer    = require('multer');
const fs        = require('fs');
const path      = require('path');
const basicAuth = require('express-basic-auth');

const app      = express();
const PORT     = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;

// ─── Basic Auth (admin only — /published/ stays public) ───────────────────────
if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/published/')) return next();
    return basicAuth({
      users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
      challenge: true,
      realm: 'Doozie Quote Tool'
    })(req, res, next);
  });
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use('/uploads',   express.static(path.join(DATA_DIR, 'uploads')));
app.use('/published', express.static(path.join(DATA_DIR, 'published')));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8'));
  } catch {
    return defaultSettings();
  }
}

function saveSettings(s) {
  fs.writeFileSync(path.join(DATA_DIR, 'settings.json'), JSON.stringify(s, null, 2));
}

function defaultSettings() {
  return {
    companyName: '', companyLogo: null,
    defaultOverview: '', defaultTerms: '',
    defaultPaymentTerms: '', defaultScope: '', defaultNextSteps: '',
    vatRate: 20, materialsLibrary: [], lineItemTemplates: [], quoteCounter: 0
  };
}


function listQuotes() {
  const quotesDir = path.join(DATA_DIR, 'quotes');
  ensureDir(quotesDir);
  return fs.readdirSync(quotesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const q = JSON.parse(fs.readFileSync(path.join(quotesDir, f), 'utf8'));
        return {
          filename: f,
          id: q.id, version: q.version, status: q.status,
          customerName: q.customer?.name || '',
          projectTitle: q.projectTitle || '',
          createdAt: q.createdAt,
          total: q.total || 0,
          quoteUrl: q.quoteUrl || null
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function nextQuoteId() {
  const s = loadSettings();
  s.quoteCounter = (s.quoteCounter || 0) + 1;
  saveSettings(s);
  const year = new Date().getFullYear();
  return `QT-${year}-${String(s.quoteCounter).padStart(4, '0')}`;
}

function quoteFilename(baseId, version) {
  return `${baseId}-v${version}.json`;
}

function calcTotals(items, vatRate, vatEnabled) {
  const net = (items || []).reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
  const vat = vatEnabled ? net * ((parseFloat(vatRate) || 20) / 100) : 0;
  return { net, vat, total: net + vat };
}

// ─── Quotes API ───────────────────────────────────────────────────────────────
app.get('/api/quotes', (req, res) => {
  try { res.json(listQuotes()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/quotes', (req, res) => {
  try {
    const s        = loadSettings();
    const baseId   = nextQuoteId();
    const version  = 1;
    const filename = quoteFilename(baseId, version);
    const quote = {
      id: baseId, version, status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      validUntil: '',
      customer: { name: '', address: '', email: '', phone: '' },
      projectTitle: '',
      overview:     s.defaultOverview      || '',
      models:       { closed: null, open: null },
      materials:    [],
      lineItems:    [],
      vatRate:      s.vatRate || 20,
      vatEnabled:   true,
      netTotal:     0, vatAmount: 0, total: 0,
      termsAndConditions: s.defaultTerms         || '',
      paymentTerms:       s.defaultPaymentTerms  || '',
      scope:              s.defaultScope         || '',
      nextSteps:          s.defaultNextSteps     || ''
    };
    const quotesDir = path.join(DATA_DIR, 'quotes');
    ensureDir(quotesDir);
    fs.writeFileSync(path.join(quotesDir, filename), JSON.stringify(quote, null, 2));
    const uploadBase = path.join(DATA_DIR, 'uploads', `${baseId}-v${version}`);
    ensureDir(path.join(uploadBase, 'models'));
    ensureDir(path.join(uploadBase, 'images'));
    res.json({ quote, filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quotes/:id', (req, res) => {
  const fp = path.join(DATA_DIR, 'quotes', req.params.id);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try { res.json(JSON.parse(fs.readFileSync(fp, 'utf8'))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/quotes/:id', (req, res) => {
  const fp = path.join(DATA_DIR, 'quotes', req.params.id);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try {
    const existing = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (existing.status === 'published')
      return res.status(400).json({ error: 'Quote is published. Create a new version to edit.' });
    const updated = { ...existing, ...req.body, updatedAt: new Date().toISOString() };
    const totals = calcTotals(updated.lineItems, updated.vatRate, updated.vatEnabled);
    updated.netTotal = totals.net; updated.vatAmount = totals.vat; updated.total = totals.total;
    fs.writeFileSync(fp, JSON.stringify(updated, null, 2));
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/quotes/:id/version', (req, res) => {
  const fp = path.join(DATA_DIR, 'quotes', req.params.id);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try {
    const existing   = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const newVersion = existing.version + 1;
    const newFile    = quoteFilename(existing.id, newVersion);
    const newQuote   = {
      ...existing, version: newVersion, status: 'draft',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(DATA_DIR, 'quotes', newFile), JSON.stringify(newQuote, null, 2));
    const oldDir = path.join(DATA_DIR, 'uploads', `${existing.id}-v${existing.version}`);
    const newDir = path.join(DATA_DIR, 'uploads', `${existing.id}-v${newVersion}`);
    ensureDir(newDir);
    if (fs.existsSync(oldDir)) fs.cpSync(oldDir, newDir, { recursive: true });
    res.json({ quote: newQuote, filename: newFile });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/quotes/:id/publish', (req, res) => {
  const fp = path.join(DATA_DIR, 'quotes', req.params.id);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try {
    const quote    = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const settings = loadSettings();
    quote.status      = 'published';
    quote.publishedAt = new Date().toISOString();

    const pubId   = `${quote.id}-v${quote.version}`;
    const pubDir  = path.join(DATA_DIR, 'published', pubId);
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const quoteUrl = `${baseUrl}/published/${pubId}/`;

    ensureDir(path.join(pubDir, 'models'));
    ensureDir(path.join(pubDir, 'images'));

    // Copy model files
    const modSrc = path.join(DATA_DIR, 'uploads', pubId, 'models');
    if (fs.existsSync(modSrc))
      fs.readdirSync(modSrc).forEach(f =>
        fs.copyFileSync(path.join(modSrc, f), path.join(pubDir, 'models', f)));

    // Copy quote images
    const imgSrc = path.join(DATA_DIR, 'uploads', pubId, 'images');
    if (fs.existsSync(imgSrc))
      fs.readdirSync(imgSrc).forEach(f =>
        fs.copyFileSync(path.join(imgSrc, f), path.join(pubDir, 'images', f)));

    // Copy material library images used in this quote
    (quote.materials || []).forEach(m => {
      if (m.imageFile) {
        const src = path.join(DATA_DIR, 'uploads', 'settings', 'materials', m.imageFile);
        if (fs.existsSync(src))
          fs.copyFileSync(src, path.join(pubDir, 'images', m.imageFile));
      }
    });

    // Copy company logo
    if (settings.companyLogo) {
      const logoSrc = path.join(DATA_DIR, 'uploads', 'settings', settings.companyLogo);
      if (fs.existsSync(logoSrc))
        fs.copyFileSync(logoSrc, path.join(pubDir, settings.companyLogo));
    }

    // Generate and write HTML
    const html = buildPublishedHTML(quote, settings);
    fs.writeFileSync(path.join(pubDir, 'index.html'), html, 'utf8');

    // Persist quote URL back to quote JSON
    quote.quoteUrl = quoteUrl;
    fs.writeFileSync(fp, JSON.stringify(quote, null, 2));

    res.json({ success: true, pubId, quoteUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── File Uploads ─────────────────────────────────────────────────────────────
function modelStorage() {
  return multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(DATA_DIR, 'uploads', req.params.id.replace('.json',''), 'models');
      ensureDir(dir); cb(null, dir);
    },
    filename(req, file, cb) {
      const ext  = path.extname(file.originalname).toLowerCase();
      const type = req.params.modelType; // 'closed' | 'open'
      // Remove old file of same type if extension changes
      const dir = path.join(DATA_DIR, 'uploads', req.params.id.replace('.json',''), 'models');
      if (fs.existsSync(dir))
        fs.readdirSync(dir)
          .filter(f => f.startsWith(type + '.'))
          .forEach(f => fs.unlinkSync(path.join(dir, f)));
      cb(null, `${type}${ext}`);
    }
  });
}

app.post('/api/quotes/:id/upload/model/:modelType', (req, res) => {
  multer({ storage: modelStorage() }).single('file')(req, res, err => {
    if (err) return res.status(500).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const filename = req.file.filename;
    const fp = path.join(DATA_DIR, 'quotes', req.params.id);
    if (fs.existsSync(fp)) {
      const q = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (!q.models) q.models = {};
      // Preserve existing textures if re-uploading the model file
      const existing = q.models[req.params.modelType];
      const existingTextures = (typeof existing === 'object' && existing?.textures) ? existing.textures : [];
      q.models[req.params.modelType] = { file: filename, textures: existingTextures };
      q.updatedAt = new Date().toISOString();
      fs.writeFileSync(fp, JSON.stringify(q, null, 2));
    }
    const url = `/uploads/${req.params.id.replace('.json','')}/models/${filename}`;
    res.json({ success: true, filename, url });
  });
});

// Upload texture / supporting files for a model
app.post('/api/quotes/:id/upload/textures/:modelType', (req, res) => {
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(DATA_DIR, 'uploads', req.params.id.replace('.json',''), 'models');
      ensureDir(dir); cb(null, dir);
    },
    filename(req, file, cb) { cb(null, file.originalname); }
  });
  multer({ storage }).array('files', 30)(req, res, err => {
    if (err) return res.status(500).json({ error: err.message });
    const filenames = (req.files || []).map(f => f.originalname);
    const fp = path.join(DATA_DIR, 'quotes', req.params.id);
    if (fs.existsSync(fp)) {
      const q    = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (!q.models) q.models = {};
      const cur  = q.models[req.params.modelType];
      const file = cur ? (typeof cur === 'string' ? cur : cur.file) : null;
      const prev = (typeof cur === 'object' && cur?.textures) ? cur.textures : [];
      q.models[req.params.modelType] = { file, textures: [...new Set([...prev, ...filenames])] };
      q.updatedAt = new Date().toISOString();
      fs.writeFileSync(fp, JSON.stringify(q, null, 2));
    }
    const dir = req.params.id.replace('.json','');
    res.json({ success: true, filenames, urls: filenames.map(f => `/uploads/${dir}/models/${f}`) });
  });
});

// Remove a texture file from a model
app.delete('/api/quotes/:id/texture/:modelType/:filename', (req, res) => {
  try {
    const fp = path.join(DATA_DIR, 'quotes', req.params.id);
    if (fs.existsSync(fp)) {
      const q   = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const cur = q.models?.[req.params.modelType];
      if (typeof cur === 'object') {
        cur.textures = (cur.textures || []).filter(t => t !== req.params.filename);
        q.updatedAt  = new Date().toISOString();
        fs.writeFileSync(fp, JSON.stringify(q, null, 2));
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Settings logo upload
const logoStorage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(DATA_DIR, 'uploads', 'settings');
    ensureDir(dir); cb(null, dir);
  },
  filename(req, file, cb) { cb(null, 'logo' + path.extname(file.originalname).toLowerCase()); }
});
app.post('/api/settings/upload/logo', (req, res) => {
  multer({ storage: logoStorage }).single('file')(req, res, err => {
    if (err) return res.status(500).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const s = loadSettings(); s.companyLogo = req.file.filename; saveSettings(s);
    res.json({ success: true, filename: req.file.filename, url: `/uploads/settings/${req.file.filename}` });
  });
});

// Material image upload
app.post('/api/settings/materials/:matId/upload', (req, res) => {
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(DATA_DIR, 'uploads', 'settings', 'materials');
      ensureDir(dir); cb(null, dir);
    },
    filename(req, file, cb) { cb(null, req.params.matId + path.extname(file.originalname).toLowerCase()); }
  });
  multer({ storage }).single('file')(req, res, err => {
    if (err) return res.status(500).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const s = loadSettings();
    const idx = s.materialsLibrary.findIndex(m => m.id === req.params.matId);
    if (idx !== -1) { s.materialsLibrary[idx].imageFile = req.file.filename; saveSettings(s); }
    res.json({ success: true, filename: req.file.filename, url: `/uploads/settings/materials/${req.file.filename}` });
  });
});

// ─── Settings API ─────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  try { res.json(loadSettings()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/settings', (req, res) => {
  try {
    const s = { ...loadSettings(), ...req.body };
    saveSettings(s); res.json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings/materials', (req, res) => {
  try {
    const s = loadSettings();
    const m = { id: `mat-${Date.now()}`, name: req.body.name || 'New Material', description: req.body.description || '', imageFile: null };
    s.materialsLibrary.push(m); saveSettings(s); res.json(m);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/settings/materials/:matId', (req, res) => {
  try {
    const s = loadSettings();
    const i = s.materialsLibrary.findIndex(m => m.id === req.params.matId);
    if (i === -1) return res.status(404).json({ error: 'Not found' });
    s.materialsLibrary[i] = { ...s.materialsLibrary[i], ...req.body };
    saveSettings(s); res.json(s.materialsLibrary[i]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/settings/materials/:matId', (req, res) => {
  try {
    const s = loadSettings();
    s.materialsLibrary = s.materialsLibrary.filter(m => m.id !== req.params.matId);
    saveSettings(s); res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings/templates', (req, res) => {
  try {
    const s = loadSettings();
    const t = { id: `tpl-${Date.now()}`, name: req.body.name || 'New Template', items: req.body.items || [] };
    s.lineItemTemplates.push(t); saveSettings(s); res.json(t);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/settings/templates/:tplId', (req, res) => {
  try {
    const s = loadSettings();
    const i = s.lineItemTemplates.findIndex(t => t.id === req.params.tplId);
    if (i === -1) return res.status(404).json({ error: 'Not found' });
    s.lineItemTemplates[i] = { ...s.lineItemTemplates[i], ...req.body };
    saveSettings(s); res.json(s.lineItemTemplates[i]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/settings/templates/:tplId', (req, res) => {
  try {
    const s = loadSettings();
    s.lineItemTemplates = s.lineItemTemplates.filter(t => t.id !== req.params.tplId);
    saveSettings(s); res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Published HTML Generator ─────────────────────────────────────────────────
function fmt(n) {
  return '£' + parseFloat(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
function sanitiseHTML(html) {
  return (html || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on\w+="[^"]*"/gi, '');
}

function buildPublishedHTML(quote, settings) {
  const logoHTML = settings.companyLogo
    ? `<img src="./${settings.companyLogo}" alt="${settings.companyName}" class="company-logo">`
    : `<div class="company-name-text">${settings.companyName || ''}</div>`;

  // Helper: extract all URLs for a model (main file + textures)
  function modelUrls(modelData, prefix) {
    if (!modelData) return null;
    const file     = typeof modelData === 'string' ? modelData : modelData.file;
    const textures = typeof modelData === 'object'  ? (modelData.textures || []) : [];
    if (!file) return null;
    return [file, ...textures].map(f => `${prefix}${f}`);
  }

  const closedUrls = modelUrls(quote.models?.closed, './models/');
  const openUrls   = modelUrls(quote.models?.open,   './models/');

  const closedHTML = closedUrls
    ? `<div class="viewer-wrap">
        <div class="viewer-header">
          <span class="viewer-label">Closed View</span>
          <button class="fs-btn" onclick="goFullscreen('viewer-closed')">&#x26F6; Fullscreen</button>
        </div>
        <div id="viewer-closed" class="viewer-box"></div>
      </div>` : '';

  const openHTML = openUrls
    ? `<div class="viewer-wrap">
        <div class="viewer-header">
          <span class="viewer-label">Open View</span>
          <button class="fs-btn" onclick="goFullscreen('viewer-open')">&#x26F6; Fullscreen</button>
        </div>
        <div id="viewer-open" class="viewer-box"></div>
      </div>` : '';

  const materialsHTML = (quote.materials || []).map(m => `
    <div class="swatch-card ${m.imageFile ? 'has-image' : ''}"${m.imageFile ? ` onclick="openLightbox('./images/${m.imageFile}','${m.name.replace(/'/g,"\\'")}','${(m.description||'').replace(/'/g,"\\'")}')"`  : ''}>
      ${m.imageFile
        ? `<div class="swatch-img-wrap"><img src="./images/${m.imageFile}" alt="${m.name}" loading="lazy"></div>`
        : `<div class="swatch-placeholder"></div>`}
      <div class="swatch-text">
        <strong>${m.name}</strong>
        ${m.description ? `<span>${m.description}</span>` : ''}
      </div>
    </div>`).join('');

  const lineItemsHTML = (quote.lineItems || []).map(item => {
    if (item.sectionName !== undefined) {
      return `<tr class="pricing-section-hdr">
        <td colspan="2" class="pricing-section-name">${item.sectionName || ''}</td>
      </tr>`;
    }
    return `<tr>
      <td class="item-desc">${item.description || ''}</td>
      <td class="item-price">${fmt(item.price)}</td>
    </tr>`;
  }).join('');

  const vatRow = quote.vatEnabled
    ? `<tr class="totals-row vat-row"><td>VAT (${quote.vatRate}%)</td><td>${fmt(quote.vatAmount)}</td></tr>` : '';

  const overviewSection = quote.overview
    ? `<section class="q-section" id="sec-overview">
        <h2 class="section-title">Project Overview</h2>
        <div class="section-underline"></div>
        <div class="section-body">${sanitiseHTML(quote.overview)}</div>
       </section>` : '';

  const modelsSection = (closedHTML || openHTML)
    ? `<section class="q-section" id="sec-models">
        <h2 class="section-title">3D Visualisations</h2>
        <div class="section-underline"></div>
        <div class="viewers-col">
          ${closedHTML}${openHTML}
        </div>
       </section>` : '';

  const materialsSection = (quote.materials || []).length
    ? `<section class="q-section" id="sec-materials">
        <h2 class="section-title">Materials &amp; Finishes</h2>
        <div class="section-underline"></div>
        <div class="swatches-grid">${materialsHTML}</div>
       </section>` : '';

  const pricingSection = (quote.lineItems || []).length
    ? `<section class="q-section" id="sec-pricing">
        <h2 class="section-title">Pricing</h2>
        <div class="section-underline"></div>
        <table class="pricing-table">
          <thead><tr><th>Description</th><th class="item-price">Amount</th></tr></thead>
          <tbody>${lineItemsHTML}</tbody>
          <tfoot>
            <tr class="totals-row net-row"><td>Net Total</td><td>${fmt(quote.netTotal)}</td></tr>
            ${vatRow}
            <tr class="totals-row grand-total"><td>Total</td><td>${fmt(quote.total)}</td></tr>
          </tfoot>
        </table>
       </section>` : '';

  const hasTerms = quote.termsAndConditions || quote.paymentTerms || quote.scope || quote.nextSteps;
  const termsSection = hasTerms
    ? `<section class="q-section" id="sec-terms">
        <h2 class="section-title">Further Information</h2>
        <div class="section-underline"></div>
        <div class="terms-body">
          ${quote.nextSteps          ? `<h3>Time Frame &amp; Next Steps</h3><div class="terms-block">${sanitiseHTML(quote.nextSteps)}</div>` : ''}
          ${quote.scope              ? `<h3>Manufacturing &amp; Delivery</h3><div class="terms-block">${sanitiseHTML(quote.scope)}</div>` : ''}
          ${quote.paymentTerms       ? `<h3>Payment Terms</h3><div class="terms-block">${sanitiseHTML(quote.paymentTerms)}</div>` : ''}
          ${quote.termsAndConditions ? `<h3>Terms &amp; Conditions</h3><div class="terms-block">${sanitiseHTML(quote.termsAndConditions)}</div>` : ''}
        </div>
       </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${quote.projectTitle || 'Quote'} — ${quote.id} v${quote.version}</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/online-3d-viewer@0.18.0/build/engine/o3dv.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Poppins', ui-sans-serif, system-ui, sans-serif; background: #f4f4f3; color: #383838; font-size: 16px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }

    /* ── Header strip ── */
    .q-header { background: #f4f4f3; border-bottom: 1px solid #e5e5e5; }
    .q-header-inner { max-width: 980px; margin: 0 auto; padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
    .company-logo { height: 44px; width: auto; object-fit: contain; }
    .company-name-text { font-weight: 700; font-size: 1.1rem; color: #000; }
    .quote-badge { margin-left: auto; background: #fff; border: 1px solid #e5e5e5; padding: 5px 16px; border-radius: 999px; font-weight: 600; font-size: 0.85rem; white-space: nowrap; color: #383838; }

    /* ── Content wrap ── */
    .q-content { max-width: 980px; margin: 0 auto; padding: 28px 24px; }
    .q-intro { margin-bottom: 24px; }
    .q-title { font-size: 2rem; font-weight: 400; color: #000; margin-bottom: 10px; line-height: 1.2; }
    .q-pill { display: inline-block; padding: 5px 16px; border-radius: 999px; border: 1px solid #e5e5e5; background: #fff; font-size: 0.88rem; color: #383838; }

    /* ── Section cards ── */
    .q-section { background: #fff; border-radius: 14px; border: 1px solid #e5e5e5; box-shadow: 0 4px 20px rgba(0,0,0,0.06); padding: 24px; margin-bottom: 22px; }
    .section-title { font-size: 1.2rem; font-weight: 400; color: #000; margin-bottom: 6px; }
    .section-underline { height: 2px; width: 48px; background: #ffc700; border-radius: 2px; margin-bottom: 20px; }
    .section-body { line-height: 1.7; }
    .section-body a, .terms-block a { color: #000; text-decoration: underline; }
    .section-body a:hover, .terms-block a:hover { opacity: 0.7; }
    .intro-text { font-size: 1.02rem; line-height: 1.75; }

    /* ── 3D Viewers ── */
    .viewers-col { display: flex; flex-direction: column; gap: 1.25rem; }
    .viewer-wrap { border: 1px solid #e5e5e5; border-radius: 10px; overflow: hidden; }
    .viewer-header { display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 1rem; background: #f4f4f3; border-bottom: 1px solid #e5e5e5; }
    .viewer-label { font-size: 0.85rem; font-weight: 600; color: #383838; }
    .fs-btn { font-size: 0.8rem; cursor: pointer; background: #000; color: #fff; border: none; padding: 0.3rem 0.75rem; border-radius: 6px; font-family: inherit; transition: background 0.15s; }
    .fs-btn:hover { background: #383838; }
    .viewer-box { width: 100%; height: 450px; display: block; background: #f4f4f3; }
    .viewer-box:-webkit-full-screen { width: 100vw; height: 100vh; }
    .viewer-box:-moz-full-screen    { width: 100vw; height: 100vh; }
    .viewer-box:fullscreen          { width: 100vw; height: 100vh; }

    /* ── Swatch grid ── */
    .swatches-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    @media(min-width:640px)  { .swatches-grid { grid-template-columns: repeat(3, 1fr); } }
    @media(min-width:860px)  { .swatches-grid { grid-template-columns: repeat(4, 1fr); } }
    .swatch-card { background: #fff; border: 1px solid #e5e5e5; border-radius: 14px; padding: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
    .swatch-card.has-image { cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; }
    .swatch-card.has-image:hover { border-color: #ffc700; box-shadow: 0 4px 18px rgba(0,0,0,0.12); }
    .swatch-img-wrap { width: 100%; aspect-ratio: 1/1; border-radius: 10px; overflow: hidden; border: 1px solid #e5e5e5; margin-bottom: 10px; background: #f4f4f3; }
    .swatch-img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s ease; }
    .swatch-card.has-image:hover .swatch-img-wrap img { transform: scale(1.03); }
    .swatch-placeholder { width: 100%; aspect-ratio: 1/1; border-radius: 10px; background: #e5e5e5; margin-bottom: 10px; }
    .swatch-text strong { display: block; font-size: 0.88rem; font-weight: 600; color: #000; }
    .swatch-text span { font-size: 0.8rem; color: #888; line-height: 1.4; display: block; margin-top: 2px; }

    /* ── Pricing ── */
    .pricing-table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
    /* Column header: dark/inverted so it reads as a header, not a section */
    .pricing-table thead th { text-align: left; padding: 0.7rem 0.85rem; background: #2d2d2d; font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em; color: #fff; }
    .pricing-table thead th:last-child { text-align: right; }
    .pricing-table tbody tr:not(.pricing-section-hdr):nth-child(even) { background: #fafafa; }
    .pricing-table td { padding: 0.65rem 0.85rem; border-bottom: 1px solid #f0f0ee; vertical-align: top; }
    /* Section headers: white bg + yellow left accent — clearly sub-headings, not column headers */
    .pricing-section-hdr td { background: #fff !important; border-top: 1px solid #ececec; border-bottom: 1px solid #ececec; padding: 0.65rem 0.85rem; border-left: 3px solid #ffc700; }
    .pricing-section-name { font-weight: 700; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.07em; color: #000; }
    /* Price column: always right-aligned */
    .item-price { text-align: right; font-variant-numeric: tabular-nums; }
    /* Totals */
    .pricing-table tfoot { border-top: 2px solid #ececec; }
    .totals-row td { padding: 0.5rem 0.85rem; }
    .totals-row td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
    .net-row td { color: #aaa; font-size: 0.85rem; border-bottom: 1px solid #f0f0ee; }
    .vat-row td { color: #888; font-size: 0.9rem; border-bottom: 1px solid #ececec; }
    .grand-total td { font-weight: 700; font-size: 1.15rem; color: #000; border-top: 2px solid #000; padding-top: 0.75rem; }

    /* ── Terms ── */
    .terms-body h3 { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; color: #000; margin: 1.25rem 0 0.4rem; font-weight: 700; }
    .terms-body h3:first-child { margin-top: 0; }
    .terms-block { font-size: 0.9rem; color: #383838; line-height: 1.75; }

    /* ── Lightbox ── */
    .lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.82); backdrop-filter: blur(4px); z-index: 9999; align-items: center; justify-content: center; flex-direction: column; padding: 2rem; }
    .lightbox.open { display: flex; }
    .lightbox img { max-width: 90vw; max-height: 75vh; object-fit: contain; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); animation: lbIn .25s ease-out; }
    @keyframes lbIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
    .lightbox-caption { color: #fff; margin-top: 1rem; text-align: center; }
    .lightbox-caption strong { display: block; font-size: 1.05rem; font-weight: 600; }
    .lightbox-caption span { font-size: 0.88rem; opacity: 0.72; }
    .lightbox-close { position: absolute; top: 1.5rem; right: 1.5rem; color: #fff; font-size: 2.5rem; font-weight: 300; cursor: pointer; line-height: 1; background: none; border: none; }

    /* ── Print ── */
    @media print {
      body { background: #fff; }
      .q-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .section-underline { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .fs-btn { display: none; }
      .viewer-box { height: 300px; }
      .q-section { box-shadow: none; page-break-inside: avoid; }
    }
    @media (max-width: 600px) {
      .q-title { font-size: 1.5rem; }
      .swatches-grid { grid-template-columns: repeat(2, 1fr); }
      .q-content { padding: 20px 16px; }
    }
  </style>
</head>
<body>

<!-- Header -->
<header class="q-header">
  <div class="q-header-inner">
    ${logoHTML}
    <span class="quote-badge">Quote &middot; ${quote.id} &middot; v${quote.version}</span>
  </div>
</header>

<!-- Lightbox -->
<div class="lightbox" id="lightbox" onclick="closeLightbox()">
  <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
  <img id="lightbox-img" src="" alt="">
  <div class="lightbox-caption">
    <strong id="lightbox-name"></strong>
    <span id="lightbox-desc"></span>
  </div>
</div>

<div class="q-content">
  <div class="q-intro">
    <h1 class="q-title">${quote.projectTitle || ''}</h1>
    <div class="q-pill">Prepared for ${quote.customer?.name || ''}${quote.createdAt ? ' &middot; ' + fmtDate(quote.createdAt) : ''}${quote.validUntil ? ' &middot; Valid until: ' + fmtDate(quote.validUntil) : ''}</div>
  </div>
  ${overviewSection}
  ${modelsSection}
  ${materialsSection}
  ${pricingSection}
  ${termsSection}
</div>

<script>
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
  function initViewer(el, urls, camKey) {
    if (typeof OV === 'undefined') return;
    const ev = new OV.EmbeddedViewer(el, {
      backgroundColor: new OV.RGBAColor(248, 249, 250, 255),
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
          // Auto-save camera after user stops interacting
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
      }
    });
    ev.LoadModelFromUrlList(urls);
  }
  window.addEventListener('load', () => {
    ${closedUrls ? `
    const closedEl = document.getElementById('viewer-closed');
    if (closedEl) initViewer(closedEl, ${JSON.stringify(closedUrls)}, 'ov_${quote.id}_v${quote.version}_closed');` : ''}
    ${openUrls ? `
    const openEl = document.getElementById('viewer-open');
    if (openEl) initViewer(openEl, ${JSON.stringify(openUrls)}, 'ov_${quote.id}_v${quote.version}_open');` : ''}
  });

  // Fullscreen
  function goFullscreen(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if (req) req.call(el);
  }

  // Lightbox
  function openLightbox(src, name, desc) {
    document.getElementById('lightbox-img').src  = src;
    document.getElementById('lightbox-name').textContent = name;
    document.getElementById('lightbox-desc').textContent = desc;
    document.getElementById('lightbox').classList.add('open');
  }
  function closeLightbox() {
    document.getElementById('lightbox').classList.remove('open');
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
</script>
</body>
</html>`;
}

// ─── Start ────────────────────────────────────────────────────────────────────
ensureDir(path.join(DATA_DIR, 'quotes'));
ensureDir(path.join(DATA_DIR, 'uploads'));
ensureDir(path.join(DATA_DIR, 'published'));
app.listen(PORT, () => console.log(`\n  Quote Tool → http://localhost:${PORT}\n`));
