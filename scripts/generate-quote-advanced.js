import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

/* ------------------------------------------------------------
 * Markdown: prefer 'marked', otherwise tiny safe fallback.
 * ------------------------------------------------------------ */
let marked;
try {
  ({ marked } = await import('marked'));
} catch {
  marked = {
    parse(md = '') {
      md = String(md).replace(/\r\n?/g, '\n');
      const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const lines = md.split('\n');
      const out = [];
      let listOpen = false;
      const flushList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };

      for (const raw of lines) {
        const line = raw.trimEnd();
        const m = line.match(/^[-*]\s+(.*)$/);
        if (m) {
          if (!listOpen) { out.push('<ul>'); listOpen = true; }
          const li = esc(m[1]).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');
          out.push(`<li>${li}</li>`);
          continue;
        }
        if (line.trim() === '') { flushList(); out.push(''); continue; }
        flushList();
        const p = esc(line).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');
        out.push(`<p>${p}</p>`);
      }
      flushList();
      return out.join('\n');
    }
  };
}

/* ----------------------------- utils ----------------------------- */
function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : fallback;
}
function hasFlag(flag) { return process.argv.includes(flag); }
function assertEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`❌ Missing env: ${name}`); process.exit(1); }
  return v;
}
function money(n) { return Number(n || 0).toFixed(2); }
function toPosix(p) { return p.split(path.sep).join('/'); }

/* Root-absolute web paths for on-site files */
function toWebPath(rel) {
  if (!rel) return '';
  return '/' + toPosix(rel).replace(/^\/+/, '');
}
function toWebUrl(rel) {
  return rel ? encodeURI(toWebPath(rel)) : '';
}

/* Escape for HTML attributes */
function escAttr(s = '') {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/"/g,'&quot;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

/* dates */
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDateIntl(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getDate()).padStart(2,'0');
  const mon = MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${mon} ${year}`;
}
function addDays(iso, days) {
  const d = iso ? new Date(iso) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

/* list files (non-recursive) */
async function listFiles(folder, exts = []) {
  const out = [];
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!exts.length || exts.includes(ext)) {
        out.push(toPosix(path.join(folder, e.name)));
      }
    }
  } catch {}
  return out;
}

/* GH raw URL builder for 3D viewer */
function buildRawUrl(owner, repo, branch, relPath) {
  const clean = String(relPath).replace(/^\/+/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encoded}`;
}

/* Model URLs: GH Raw (default) or local PUBLIC_BASE_URL */
function buildViewerModelUrls(owner, repo, branch, relPaths, PUBLIC, mode = 'gh') {
  if (mode === 'local') {
    const base = PUBLIC.replace(/\/+$/,'');
    return relPaths.map(rel => `${base}${toWebPath(rel)}`);
  }
  return relPaths.map(rel => buildRawUrl(owner, repo, branch, rel));
}

/* ✅ Build a COMPLETE <iframe> element for the 3D viewer */
function build3DViewerIframe({ owner, repo, branch, relPaths, PUBLIC, viewerSource = 'gh' }) {
  if (!relPaths.length) return '';
  const urls = buildViewerModelUrls(owner, repo, branch, relPaths, PUBLIC, viewerSource);
  const modelList = urls.join(',');

  const camera =
    '$camera=4371.47575,1888.79862,-1873.12939,' +
    '1172.74561,1294.75024,1252.00024,' +
    '0.00000,1.00000,0.00000,38';

  const settings =
    '$projectionmode=perspective' +
    '$envsettings=fishermans_bastion,off' +
    '$backgroundcolor=255,255,255,255' +
    '$defaultcolor=200,200,200' +
    '$defaultlinecolor=100,100,100' +
    '$edgesettings=off,0,0,0,1';

  const src = `https://3dviewer.net/embed.html#model=${modelList}${camera}${settings}`;
  // RETURN A REAL IFRAME
  return `<iframe src="${src}" allowfullscreen></iframe>`;
}

/* Kommo helpers */
async function kommoGetLead(sub, tok, id) {
  const url = `https://${sub}.kommo.com/api/v4/leads/${id}?with=contacts`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tok}`, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Kommo GET lead error: ${res.status} ${await res.text()}`);
  return res.json();
}
async function kommoGetContact(sub, tok, id) {
  const url = `https://${sub}.kommo.com/api/v4/contacts/${id}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tok}`, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Kommo GET contact error: ${res.status} ${await res.text()}`);
  return res.json();
}
async function kommoPatchLatestUrl(sub, tok, leadId, url, fieldId) {
  const apiUrl = `https://${sub}.kommo.com/api/v4/leads/${leadId}`;
  const body = { custom_fields_values: [{ field_id: Number(fieldId), values: [{ value: url }] }] };
  const res = await fetch(apiUrl, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Kommo PATCH error: ${res.status} ${await res.text()}`);
}

/* token replacer */
function replaceTokens(tpl, map) {
  let out = tpl;
  for (const [k, v] of Object.entries(map)) {
    out = out.replaceAll(`{{${k}}}`, v == null ? '' : String(v));
  }
  return out;
}

/* revision helper */
async function getNextRevision(outDir, leadId) {
  try {
    const files = await fs.readdir(outDir);
    const re = new RegExp(`^${leadId}_v(\\d+)\\.html$`, 'i');
    let max = 0;
    for (const f of files) {
      const m = f.match(re);
      if (m) max = Math.max(max, Number(m[1] || 0));
    }
    return max + 1;
  } catch {
    await fs.mkdir(outDir, { recursive: true });
    return 1;
  }
}

/* --------------------------------------------- MAIN --------------------------------------------- */
(async function main(){
  const GH_OWNER  = assertEnv('GH_OWNER');
  const GH_REPO   = assertEnv('GH_REPO');
  const GH_BRANCH = process.env.GH_BRANCH || 'main';

  const KOMMO_SUB = assertEnv('KOMMO_SUBDOMAIN');
  const KOMMO_TOK = assertEnv('KOMMO_TOKEN');
  const LATEST_ID = assertEnv('KOMMO_LATEST_URL_FIELD_ID');
  const PUBLIC    = assertEnv('PUBLIC_BASE_URL'); // e.g. https://quotes.doozie.co
  const DEFAULT_CCY = process.env.DEFAULT_CURRENCY || '£';
  const VIEWER_SOURCE = (process.env.VIEWER_SOURCE || 'gh').toLowerCase(); // 'gh' or 'local'

  const dataFile = arg('--data');
  const tplFile  = arg('--tpl', 'templates/quote.html.tpl');
  const outDir   = arg('--out', 'quotes');
  const SKIP_KOMMO = hasFlag('--skip-kommo');
  const STRICT     = hasFlag('--strict');

  if (!dataFile){
    console.error('Usage: node scripts/generate-quote-advanced.js --data data/quotes/<LEAD_ID>/info.json [--tpl templates/quote.html.tpl] [--out quotes]');
    process.exit(1);
  }

  const data   = JSON.parse(await fs.readFile(path.resolve(dataFile), 'utf8'));
  const leadId = String(data.leadId);

  /* Kommo meta */
  const lead = await kommoGetLead(KOMMO_SUB, KOMMO_TOK, leadId);
  const contacts = lead?._embedded?.contacts || [];
  let clientName = '', clientEmail = '';
  if (contacts.length){
    const c = await kommoGetContact(KOMMO_SUB, KOMMO_TOK, contacts[0].id);
    clientName = c.name || '';
    const emailField =
        (c.custom_fields_values || []).find(f=>f.field_code==='EMAIL') ||
        (c.custom_fields_values || []).find(f=>String(f.field_name||'').toLowerCase().includes('email'));
    clientEmail = emailField?.values?.[0]?.value || '';
  }

  /* Drop-folder discovery */
  const quoteDir  = path.dirname(path.resolve(dataFile));
  const assetsDir = path.join(quoteDir, 'assets');
  const viewerDir    = path.join(assetsDir, 'viewer');
  const materialsDir = path.join(assetsDir, 'materials');
  const handlesDir   = path.join(assetsDir, 'handles');

  const viewerFiles   = await listFiles(viewerDir,    ['.3ds','.png','.jpg','.jpeg']);
  const materialFiles = await listFiles(materialsDir, ['.png','.jpg','.jpeg']);
  const handleFiles   = await listFiles(handlesDir,   ['.png','.jpg','.jpeg']);

  /* 3D viewer iframe token */
  const relViewerPaths = viewerFiles.map(x => path.relative(process.cwd(), x));
  const THREED_IFRAME_URL = relViewerPaths.length
    ? build3DViewerIframe({
        owner: GH_OWNER,
        repo: GH_REPO,
        branch: GH_BRANCH,
        relPaths: relViewerPaths,
        PUBLIC,
        viewerSource: VIEWER_SOURCE
      })
    : '';

  /* Markdown overview -> HTML */
  const OVERVIEW_TEXT = data.overview ? marked.parse(data.overview) : '';

  /* Pricing */
  const ccy = data.pricing?.currency || DEFAULT_CCY;
  const items = Array.isArray(data.pricing?.items) ? data.pricing.items : [];
  const vatRate = (typeof data.pricing?.vatRate === 'number') ? data.pricing.vatRate : 0.20;
  const subtotal = items.reduce((s,it)=> s + (Number(it.qty||1) * Number(it.unit||0)), 0);
  const vat      = subtotal * vatRate;
  const total    = subtotal + vat;

  const LINE_ITEMS_HTML =
    items.length ?
    items.map(it => {
      const qty = Number(it.qty||1);
      const unit = Number(it.unit||0);
      const line = qty * unit;
      return `<tr>
  <td>${it.name||''}</td>
  <td class="num">${qty}</td>
  <td class="num">${ccy}${money(unit)}</td>
  <td class="num">${ccy}${money(line)}</td>
</tr>`;
    }).join('\n')
    : `<tr><td colspan="4">No items.</td></tr>`;

  /* Materials (unlimited; order = JSON) */
  const materialMeta = Array.isArray(data.materials) ? data.materials : [];
  let MATERIAL_1_THUMB = '';   // FULL <img> element
  let MATERIAL_1_NAME  = '';
  let MATERIAL_1_NOTES = '';
  let MATERIAL_2_BLOCK = '';   // remaining materials as blocks

  if (materialMeta.length > 0) {
    // Material 1 — full <img>
    const m0 = materialMeta[0];
    const f0 = materialFiles[0] ? toWebUrl(path.relative(process.cwd(), materialFiles[0])) : '';
    MATERIAL_1_THUMB = `<img class="swatch-thumb" src="${f0}" data-full="${f0}" alt="${escAttr(m0?.name||'')}" />`;
    MATERIAL_1_NAME  = m0?.name  || '';
    MATERIAL_1_NOTES = m0?.notes || '';

    // Material 2+ — blocks with full <img>
    for (let i = 1; i < materialMeta.length; i++) {
      const mi = materialMeta[i];
      const fi = materialFiles[i] ? toWebUrl(path.relative(process.cwd(), materialFiles[i])) : '';
      MATERIAL_2_BLOCK += `
<figure class="swatch-card">
  <img class="swatch-thumb" src="${fi}" data-full="${fi}" alt="${escAttr(mi?.name||'')}" />
  <figcaption class="swatch-caption">
    <strong>${escAttr(mi?.name || '')}</strong><br/>
    <span>${escAttr(mi?.notes || '')}</span>
  </figcaption>
</figure>`;
    }
  }

  /* Handles (unlimited; order = JSON) */
  const handleMeta = Array.isArray(data.handles) ? data.handles : [];
  let HANDLE_1_BLOCK = '';
  let HANDLE_2_BLOCK = '';

  if (handleMeta.length > 0) {
    for (let i = 0; i < handleMeta.length; i++) {
      const hi = handleMeta[i];
      const fi = handleFiles[i] ? toWebUrl(path.relative(process.cwd(), handleFiles[i])) : '';
      const block = `
<figure class="swatch-card">
  <img class="swatch-thumb" src="${fi}" data-full="${fi}" alt="${escAttr(hi?.name||'')}" />
  <figcaption class="swatch-caption">
    <strong>${escAttr(hi?.name || '')}</strong><br/>
    <span>${escAttr(hi?.finish || hi?.notes || '')}</span>
  </figcaption>
</figure>`;
      if (i === 0) HANDLE_1_BLOCK = block;
      else HANDLE_2_BLOCK += block;
    }
  }

  /* Preflight (informational) */
  console.log('🔍 Preflight (Drop-Folder)…');
  if (!viewerFiles.length)   console.warn('⚠️ No 3D viewer files found in assets/viewer/');
  if (!materialFiles.length) console.warn('⚠️ No material swatches found in assets/materials/');
  if (!handleFiles.length)   console.warn('⚠️ No handle swatches found in assets/handles/');
  console.log(`ℹ️  3D model URL source: ${VIEWER_SOURCE === 'local' ? 'LOCAL (PUBLIC_BASE_URL)' : 'GitHub Raw'}`);

  /* Revision & dates */
  await fs.mkdir(outDir, { recursive: true });
  const revision  = await getNextRevision(outDir, leadId);

  const issueISO  = data.issueDate || new Date().toISOString().slice(0,10);
  const expiryISO = addDays(issueISO, 30);
  const ISSUE_DATE  = formatDateIntl(issueISO);
  const EXPIRY_DATE = formatDateIntl(expiryISO);

  /* --- Diagnostics (so we can sanity-check output) --- */
  console.log('DBG iframe starts with:', THREED_IFRAME_URL.slice(0, 40));
  console.log('DBG mat1 img starts:', MATERIAL_1_THUMB.slice(0, 40));
  console.log('DBG mats block len:', MATERIAL_2_BLOCK.length, 'handles block len:', (HANDLE_1_BLOCK + HANDLE_2_BLOCK).length);

  /* Build HTML */
  const tpl  = await fs.readFile(path.resolve(tplFile), 'utf8');
  const html = replaceTokens(tpl, {
    LEAD_ID: leadId,
    REVISION: revision,

    PROJECT_TITLE: data.projectTitle || lead.name || `Lead ${leadId}`,
    CLIENT_NAME: clientName,
    CLIENT_EMAIL: clientEmail,

    ISSUE_DATE,
    EXPIRY_DATE,

    OVERVIEW_TEXT,

    THREED_IFRAME_URL,

    MATERIAL_1_THUMB,
    MATERIAL_1_NAME,
    MATERIAL_1_NOTES,
    MATERIAL_2_BLOCK,

    HANDLE_1_BLOCK,
    HANDLE_2_BLOCK,

    LINE_ITEMS_HTML,
    SUBTOTAL: money(subtotal),
    VAT_AMOUNT: money(vat),
    TOTAL: money(total),
    CURRENCY: ccy
  });

  const outPath  = path.join(outDir, `${leadId}_v${revision}.html`);
  await fs.writeFile(outPath, html, 'utf8');
  const publicUrl = `${PUBLIC.replace(/\/+$/, '')}/quotes/${leadId}_v${revision}.html`;

  console.log(`✔ Generated: ${outPath}`);
  console.log(`✔ Public URL: ${publicUrl}`);

  if (!SKIP_KOMMO) {
    await kommoPatchLatestUrl(KOMMO_SUB, KOMMO_TOK, leadId, publicUrl, LATEST_ID);
    console.log('✔ Kommo Latest Quote URL updated.');
  } else {
    console.log('ℹ Kommo PATCH skipped (--skip-kommo).');
  }

  if (STRICT) console.log('✔ STRICT mode on (warnings allowed)');

})().catch(e => { console.error(e); process.exit(1); });