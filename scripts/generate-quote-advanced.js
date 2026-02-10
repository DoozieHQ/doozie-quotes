/**
 * scripts/generate-quote-advanced.js
 * ----------------------------------
 * - Builds a versioned quote HTML page from /data/quotes/<LEAD_ID>.json
 * - Inserts client data from Kommo (lead + primary contact)
 * - Auto-discovers 3D (.3ds + .jpg/.jpeg) under assets/leads/<LEAD_ID>/viewer/
 * - Uses 3dviewer.net *embed* endpoint so iframe loads
 * - Emits <img> elements for main images & swatches (with data-full for lightbox)
 * - Advanced preflight:
 *     • verifies existence of referenced files
 *     • warns on spaces/disallowed chars in viewer files
 *     • sniff file types (png/jpeg) by magic bytes
 *     • optional strict mode (--strict) fails on warnings
 *     • validates at least one .3ds model present
 * - Writes /quotes/<LEAD_ID>_vN.html
 * - PATCHes Kommo Latest Quote URL (unless --skip-kommo)
 *
 * Usage:
 *   node scripts/generate-quote-advanced.js \
 *     --data data/quotes/21018810.json \
 *     --tpl templates/quote.html.tpl \
 *     --out quotes
 *
 * Optional flags:
 *   --strict       → treat warnings as errors (fail build)
 *   --skip-kommo   → skip Kommo PATCH for testing
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

// ------------------------- small utils -------------------------
function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : fallback;
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}
function assertEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing env: ${name}`);
    process.exit(1);
  }
  return v;
}
function money(n) { return Number(n || 0).toFixed(2); }
function toPosix(p) { return p.split(path.sep).join('/'); }
function isRelative(p) { return typeof p === 'string' && !p.startsWith('http') && !p.startsWith('/'); }

// ------------------------- GH RAW builder -------------------------
function buildRawUrl(owner, repo, branch, relPath) {
  const clean = String(relPath).replace(/^\/+/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encoded}`;
}

// ------------------------- 3D iframe (embed endpoint) -------------------------
function build3DViewerIframe(owner, repo, branch, filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return '';

  // 1. Build RAW GitHub URLs without encoding
  const urls = filePaths.map(p => buildRawUrl(owner, repo, branch, p));

  // 2. Join into comma-separated list (NOT encoded)
  const modelList = urls.join(',');

  // 3. Fixed camera settings (Option A: stable defaults)
  const camera =
    '$camera=8742.95150,3777.59723,-3746.25877,' +
    '1172.74561,1294.75024,1252.00024,' +
    '0.00000,1.00000,0.00000,45.00000';

  // 4. Additional recommended viewer settings
  const settings =
    '$projectionmode=perspective' +
    '$envsettings=fishermans_bastion,off' +
    '$backgroundcolor=255,255,255,255' +
    '$defaultcolor=200,200,200' +
    '$defaultlinecolor=100,100,100' +
    '$edgesettings=off,0,0,0,1';

  return `<iframe src="https://3dviewer.net/embed.html#model=${modelList}${camera}${settings}" allowfullscreen></iframe>`;
}

// ------------------------- auto-discover viewer files -------------------------
async function autoDiscoverViewerFiles(leadId) {
  const base = path.resolve(process.cwd(), 'assets', 'leads', String(leadId), 'viewer');
  const found = [];

  async function walk(dir) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (ext === '.3ds' || ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
          found.push(toPosix(path.relative(process.cwd(), abs)));
        }
      }
    }
  }
  await walk(base);
  return found;
}

// ------------------------- Kommo helpers -------------------------
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
  const body = {
    custom_fields_values: [{ field_id: Number(fieldId), values: [{ value: url }] }]
  };
  const res = await fetch(apiUrl, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Kommo PATCH error: ${res.status} ${await res.text()}`);
}

// ------------------------- HTML tokens -------------------------
function replaceTokens(tpl, map) {
  let out = tpl;
  for (const [k, v] of Object.entries(map)) {
    out = out.replaceAll(`{{${k}}}`, v ?? '');
  }
  return out;
}

// ------------------------- revision numbering -------------------------
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

// =====================================================================
//                         ADVANCED PREFLIGHT
// =====================================================================
const warnings = [];
const errors = [];

function warn(msg) { console.warn(`⚠️  ${msg}`); warnings.push(msg); }
function err(msg)  { console.error(`❌ ${msg}`); errors.push(msg); }

async function fileExists(relPath) {
  if (!relPath) return false;
  try {
    await fs.access(relPath);
    return true;
  } catch { return false; }
}

async function sniffImageType(relPath) {
  // Minimal magic number sniff for JPEG/PNG
  try {
    const fh = await fs.open(relPath, 'r');
    const buf = Buffer.alloc(8);
    await fh.read(buf, 0, 8, 0);
    await fh.close();
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
    // JPEG: FF D8
    if (buf[0] === 0xFF && buf[1] === 0xD8) return 'jpeg';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function requireRelative(p, label) {
  if (!isRelative(p)) warn(`${label}: path "${p}" is not relative. Prefer relative (e.g., assets/... not /assets/).`);
}

function suggestNoSpaces(p, label) {
  if (/\s/.test(p)) warn(`${label}: "${p}" contains spaces. Prefer renaming to use underscores to avoid URL encoding issues.`);
}

function suggestSafeBasename(p, label) {
  if (/%25|%20/i.test(p)) warn(`${label}: "${p}" looks URL-encoded (e.g., %20 or %2520). Prefer renaming the file in the repo to avoid double-encoding.`);
}

async function preflight({
  logoRel,
  doorsOnThumb,
  doorsOffThumb,
  materials = [],
  handles = [],
  viewerFiles = []
}) {
  console.log('🔍 Preflight: verifying assets and structure…');

  // Logo
  if (logoRel) {
    requireRelative(logoRel, 'Logo');
    if (!(await fileExists(logoRel))) err(`Missing logo file: ${logoRel}`);
    else {
      const t = await sniffImageType(logoRel);
      if (t === 'unknown') warn(`Logo is not PNG/JPEG (or cannot detect): ${logoRel}`);
    }
  }

  // Main thumbnails
  if (doorsOnThumb) {
    requireRelative(doorsOnThumb, 'Doors On thumb');
    if (!(await fileExists(doorsOnThumb))) err(`Missing Doors On thumb: ${doorsOnThumb}`);
    else {
      const t = await sniffImageType(doorsOnThumb);
      if (t === 'unknown') warn(`Doors On thumb type unknown: ${doorsOnThumb}`);
    }
  }
  if (doorsOffThumb) {
    requireRelative(doorsOffThumb, 'Doors Off thumb');
    if (!(await fileExists(doorsOffThumb))) err(`Missing Doors Off thumb: ${doorsOffThumb}`);
    else {
      const t = await sniffImageType(doorsOffThumb);
      if (t === 'unknown') warn(`Doors Off thumb type unknown: ${doorsOffThumb}`);
    }
  }

  // Materials & Handles
  for (const [i, m] of materials.entries()) {
    if (!m?.thumb) continue;
    requireRelative(m.thumb, `Material[${i}] thumb`);
    if (!(await fileExists(m.thumb))) err(`Missing Material[${i}] thumb: ${m.thumb}`);
  }
  for (const [i, h] of handles.entries()) {
    if (!h?.thumb) continue;
    requireRelative(h.thumb, `Handle[${i}] thumb`);
    if (!(await fileExists(h.thumb))) err(`Missing Handle[${i}] thumb: ${h.thumb}`);
  }

  // Viewer files
  const modelFiles = viewerFiles.filter(f => /\.3ds$/i.test(f));
  const textureFiles = viewerFiles.filter(f => /\.(jpg|jpeg|png)$/i.test(f));

  if (viewerFiles.length === 0) {
    warn('3D viewer: no files discovered under assets/leads/<LEAD_ID>/viewer/');
  } else {
    if (modelFiles.length === 0) err('3D viewer: no .3ds model found.');
    viewerFiles.forEach(f => {
      suggestNoSpaces(f, '3D file');
      suggestSafeBasename(f, '3D file');
    });
  }

  // Summary
  if (errors.length) {
    console.error(`\n❌ Preflight failed with ${errors.length} error(s) and ${warnings.length} warning(s).`);
    errors.forEach(e => console.error(`   • ${e}`));
    warnings.forEach(w => console.warn(`   • ${w}`));
    process.exit(1);
  }
  console.log(`✔ Preflight passed with ${warnings.length} warning(s).`);

  if (warnings.length && hasFlag('--strict')) {
    console.error('❌ --strict mode: warnings considered fatal.');
    process.exit(1);
  }
}

// =====================================================================
//                                MAIN
// =====================================================================
(async function main() {
  // Env
  const GH_OWNER  = assertEnv('GH_OWNER');
  const GH_REPO   = assertEnv('GH_REPO');
  const GH_BRANCH = process.env.GH_BRANCH || 'main';

  const KOMMO_SUB = assertEnv('KOMMO_SUBDOMAIN');
  const KOMMO_TOK = assertEnv('KOMMO_TOKEN');
  const LATEST_ID = assertEnv('KOMMO_LATEST_URL_FIELD_ID');
  const PUBLIC    = assertEnv('PUBLIC_BASE_URL');
  const DEFAULT_CCY = process.env.DEFAULT_CURRENCY || '£';

  // Args
  const dataFile = arg('--data');
  const tplFile  = arg('--tpl', 'templates/quote.html.tpl');
  const outDir   = arg('--out', 'quotes');
  const SKIP_KOMMO = hasFlag('--skip-kommo');

  if (!dataFile) {
    console.error('Usage: node scripts/generate-quote-advanced.js --data data/quotes/<LEAD_ID>.json [--tpl templates/quote.html.tpl] [--out quotes] [--strict] [--skip-kommo]');
    process.exit(1);
  }

  // Data
  const data = JSON.parse(await fs.readFile(path.resolve(dataFile), 'utf8'));
  const leadId = String(data.leadId);

  // Kommo: lead + contact
  const lead = await kommoGetLead(KOMMO_SUB, KOMMO_TOK, leadId);
  const contacts = lead?._embedded?.contacts || [];
  let clientName = '', clientEmail = '';
  if (contacts.length) {
    const c = await kommoGetContact(KOMMO_SUB, KOMMO_TOK, contacts[0].id);
    clientName = c.name || '';
    const emailField =
      (c.custom_fields_values || []).find(f => f.field_code === 'EMAIL') ||
      (c.custom_fields_values || []).find(f => String(f.field_name || '').toLowerCase().includes('email'));
    clientEmail = emailField?.values?.[0]?.value || '';
  }

  // Auto-discover 3D
  const viewerFiles = await autoDiscoverViewerFiles(leadId);
  const THREED_IFRAME_URL = viewerFiles.length
    ? build3DViewerIframe(GH_OWNER, GH_REPO, GH_BRANCH, viewerFiles)
    : ''; // leave empty if none

  // Pricing
  const ccy = data.pricing?.currency || DEFAULT_CCY;
  const items = Array.isArray(data.pricing?.items) ? data.pricing.items : [];
  const vatRate = (typeof data.pricing?.vatRate === 'number') ? data.pricing.vatRate : 0.20;
  const subtotal = items.reduce((s, it) => s + (Number(it.qty||1) * Number(it.unit||0)), 0);
  const vat      = subtotal * vatRate;
  const total    = subtotal + vat;

  // Main images (RELATIVE paths recommended)
  const doorsOn  = data.images?.doorsOn  || {};
  const doorsOff = data.images?.doorsOff || {};

  // Advanced preflight (before building tokens)
  await preflight({
    logoRel: 'assets/logo.png',              // change if you rename logo
    doorsOnThumb:  (doorsOn.thumb  || '').replace(/^\//,''),
    doorsOffThumb: (doorsOff.thumb || '').replace(/^\//,''),
    materials: (data.materials || []).map(m => ({ thumb: (m.thumb || '').replace(/^\//,'') })),
    handles:   (data.handles   || []).map(h => ({ thumb: (h.thumb || '').replace(/^\//,'') })),
    viewerFiles
  });

  // Build tokens (emit <img> with class + data-full if we have full)
  const IMAGE_DOORSON_THUMB =
    doorsOn.thumb
      ? `<img class="thumb" src="${doorsOn.thumb.replace(/^\//,'')}" ${doorsOn.full ? `data-full="${doorsOn.full.replace(/^\//,'')}"` : ''} alt="${doorsOn.alt || 'Doors on'}"/>`
      : '';

  const IMAGE_DOORSOFF_THUMB =
    doorsOff.thumb
      ? `<img class="thumb" src="${doorsOff.thumb.replace(/^\//,'')}" ${doorsOff.full ? `data-full="${doorsOff.full.replace(/^\//,'')}"` : ''} alt="${doorsOff.alt || 'Doors off'}"/>`
      : '';

  // Materials
  let MATERIAL_1_THUMB = '';
  let MATERIAL_1_NAME  = '';
  let MATERIAL_1_NOTES = '';
  let MATERIAL_2_BLOCK = '';

  if (Array.isArray(data.materials) && data.materials.length > 0) {
    const m0 = data.materials[0];
    MATERIAL_1_THUMB =
      m0?.thumb ? `<img class="swatch-thumb" src="${m0.thumb.replace(/^\//,'')}" ${m0.full ? `data-full="${m0.full.replace(/^\//,'')}"` : ''} alt="${m0.name || 'Material'}"/>` : '';
    MATERIAL_1_NAME  = m0?.name  || '';
    MATERIAL_1_NOTES = m0?.notes || '';

    if (data.materials[1]) {
      const m1 = data.materials[1];
      MATERIAL_2_BLOCK = `
<figure class="swatch-card">
  ${m1?.thumb ? `<img class="swatch-thumb" src="${m1.thumb.replace(/^\//,'')}" ${m1.full ? `data-full="${m1.full.replace(/^\//,'')}"` : ''} alt="${m1.name || 'Material'}"/>` : ''}
  <figcaption class="swatch-caption">
    <strong>${m1?.name || ''}</strong><br/>
    <span>${m1?.notes || ''}</span>
  </figcaption>
</figure>`;
    }
  }

  // Handles
  let HANDLE_1_BLOCK = '';
  let HANDLE_2_BLOCK = '';

  if (Array.isArray(data.handles) && data.handles.length > 0) {
    const h0 = data.handles[0];
    HANDLE_1_BLOCK = `
<figure class="swatch-card">
  ${h0?.thumb ? `<img class="swatch-thumb" src="${h0.thumb.replace(/^\//,'')}" ${h0.full ? `data-full="${h0.full.replace(/^\//,'')}"` : ''} alt="${h0.name || 'Handle'}"/>` : ''}
  <figcaption class="swatch-caption">
    <strong>${h0?.name || ''}</strong><br/>
    <span>${h0?.finish || ''}</span>
  </figcaption>
</figure>`;

    if (data.handles[1]) {
      const h1 = data.handles[1];
      HANDLE_2_BLOCK = `
<figure class="swatch-card">
  ${h1?.thumb ? `<img class="swatch-thumb" src="${h1.thumb.replace(/^\//,'')}" ${h1.full ? `data-full="${h1.full.replace(/^\//,'')}"` : ''} alt="${h1.name || 'Handle'}"/>` : ''}
  <figcaption class="swatch-caption">
    <strong>${h1?.name || ''}</strong><br/>
    <span>${h1?.finish || ''}</span>
  </figcaption>
</figure>`;
    }
  }

  // Load template and replace tokens
  const tpl = await fs.readFile(path.resolve(tplFile), 'utf8');

  const html = replaceTokens(tpl, {
    LEAD_ID: leadId,
    REVISION: await getNextRevision(outDir, leadId), // compute early to display
    PROJECT_TITLE: data.projectTitle || lead.name || `Lead ${leadId}`,
    CLIENT_NAME: clientName,
    CLIENT_EMAIL: clientEmail,
    ISSUE_DATE: data.issueDate || new Date().toISOString().slice(0,10),
    VALID_UNTIL: data.validUntil || '',
    OVERVIEW_TEXT: data.overview || '',

    IMAGE_DOORSON_THUMB,
    IMAGE_DOORSOFF_THUMB,

    THREED_IFRAME_URL,

    MATERIAL_1_THUMB,
    MATERIAL_1_NAME,
    MATERIAL_1_NOTES,
    MATERIAL_2_BLOCK,
    HANDLE_1_BLOCK,
    HANDLE_2_BLOCK,

    LINE_ITEMS_HTML: (items.length
      ? items.map(it => {
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
      : `<tr><td colspan="4">No items.</td></tr>`
    ),
    SUBTOTAL: money(subtotal),
    VAT_AMOUNT: money(vat),
    TOTAL: money(total),
    CURRENCY: ccy
  });

  // Write with final revision (recompute just before write)
  const revision = await getNextRevision(outDir, leadId);
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
})().catch(e => {
  console.error(e);
  process.exit(1);
});
