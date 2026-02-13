// ****************************************************************************************
// QUOTE GENERATOR v4.2 — Doozie (Dual Viewer Support)
// - Proper <iframe> element for 3D viewer
// - No double-encoding of GH Raw URLs
// - Auto-mirror viewer/material/handle assets into /assets/leads/<LEAD_ID>/*
// - Real <img> tags for swatches (never raw URLs)
// - Safe Markdown fallback
// - Stable HTML output
// - NEW: Two independent viewer pipelines (doors ON / doors OFF)
// ****************************************************************************************

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

/* ------------------------------ Markdown (fallback) ------------------------------ */
let marked;
try {
  ({ marked } = await import('marked'));
} catch {
  marked = {
    parse(md = '') {
      md = String(md).replace(/\r\n?/g, '\n');
      const esc = (s) =>
        s.replace(/&/g, '&amp;')
         .replace(/</g, '&lt;')
         .replace(/>/g, '&gt;');

      const lines = md.split('\n');
      const out = [];
      let inList = false;

      const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

      for (const raw of lines) {
        const line = raw.trimEnd();

        // bullets
        const m = line.match(/^[-*]\s+(.*)$/);
        if (m) {
          if (!inList) { out.push('<ul>'); inList = true; }
          const li = esc(m[1])
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>');
          out.push(`<li>${li}</li>`);
          continue;
        }

        // blank → paragraph break
        if (!line.trim()) { closeList(); out.push(''); continue; }

        // paragraph
        closeList();
        const p = esc(line)
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>');
        out.push(`<p>${p}</p>`);
      }

      closeList();
      return out.join('\n');
    }
  };
}

/* ------------------------------------ Utils ------------------------------------ */
function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function hasFlag(flag) { return process.argv.includes(flag); }
function assertEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`❌ Missing environment variable: ${name}`); process.exit(1); }
  return v;
}
function money(n) { return Number(n || 0).toFixed(2); }
function toPosix(p) { return p.split(path.sep).join('/'); }

function toWebPath(rel) {
  // Root-absolute web path for files copied under /assets/...
  return '/' + toPosix(rel).replace(/^\/+/, '');
}
function toWebUrl(rel) {
  // Encode for your own site paths. (Do NOT use for GH Raw.)
  return encodeURI(toWebPath(rel));
}

function escAttr(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDateIntl(iso) {
  const d = new Date(iso || Date.now());
  const dd = String(d.getDate()).padStart(2,'0');
  return `${dd} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function addDays(iso, days) {
  const d = new Date(iso || Date.now());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

/* List files (non-recursive) — returns absolute paths */
async function listFilesAbs(folder, exts = []) {
  const out = [];
  try {
    const items = await fs.readdir(folder, { withFileTypes: true });
    for (const it of items) {
      if (!it.isFile()) continue;
      const ext = path.extname(it.name).toLowerCase();
      if (!exts.length || exts.includes(ext)) {
        out.push(path.resolve(folder, it.name));
      }
    }
  } catch {}
  return out;
}

/* Recursively mirror an entire folder into dest (preserving subfolders) */
async function mirrorFolder(src, dest) {
  try { await fs.mkdir(dest, { recursive: true }); } catch {}
  let entries = [];
  try { entries = await fs.readdir(src, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await mirrorFolder(s, d);
    } else if (e.isFile()) {
      await fs.mkdir(path.dirname(d), { recursive: true });
      await fs.copyFile(s, d);
    }
  }
}

/* Copy one file to repo public path and return its /assets/... URL */
async function copyToRepoAndGetWebUrl(absSrc, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  const fileName = path.basename(absSrc);
  const destAbs  = path.join(destDir, fileName);
  await fs.copyFile(absSrc, destAbs);
  const relFromCwd = toPosix(path.relative(process.cwd(), destAbs));
  return toWebUrl(relFromCwd);
}

/* ---------------------------- GH Raw URL builder ---------------------------- */
function ghRaw(owner, repo, branch, repoRelPath) {
  const safe = repoRelPath.replace(/^\/+/, '').split(path.sep).join('/');
  // DO NOT double-encode. Keep any % already present.
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${safe}`;
}

/* ---------------------- Build a valid <iframe> element ---------------------- */
// UPDATED: accepts viewerDirName to support two folders.
function build3DIframe({ owner, repo, branch, leadId, viewerDirName, viewerRelPaths }) {
  if (!viewerRelPaths.length) return '';
  const urls = viewerRelPaths.map(rel =>
    ghRaw(owner, repo, branch, `assets/leads/${leadId}/${viewerDirName}/${rel}`)
  );
  const modelList = urls.join(',');

  const camera =
    '$camera=4371.47575,1888.79862,-1873.12939,' +
    '1172.74561,1294.75024,1252.00024,0.00000,1.00000,0.00000,38';

  const settings =
    '$projectionmode=perspective' +
    '$envsettings=fishermans_bastion,off' +
    '$backgroundcolor=255,255,255,255' +
    '$defaultcolor=200,200,200' +
    '$defaultlinecolor=100,100,100' +
    '$edgesettings=off,0,0,0,1';

  const src = `https://3dviewer.net/embed.html#model=${modelList}${camera}${settings}`;
  // Return a complete iframe element (CRITICAL FIX)
  return `${src}</iframe>`;
}

/* ------------------------------ Kommo helpers ------------------------------ */
async function kommoGetLead(sub, tok, id) {
  const r = await fetch(`https://${sub}.kommo.com/api/v4/leads/${id}?with=contacts`, {
    headers: { Authorization:`Bearer ${tok}`, Accept:'application/json' }
  });
  if (!r.ok) throw new Error('Kommo GET lead ' + r.status);
  return r.json();
}
async function kommoGetContact(sub, tok, id) {
  const r = await fetch(`https://${sub}.kommo.com/api/v4/contacts/${id}`, {
    headers: { Authorization:`Bearer ${tok}`, Accept:'application/json' }
  });
  if (!r.ok) throw new Error('Kommo GET contact ' + r.status);
  return r.json();
}
async function kommoPatchLatestUrl(sub, tok, leadId, url, fieldId) {
  const r = await fetch(`https://${sub}.kommo.com/api/v4/leads/${leadId}`, {
    method:'PATCH',
    headers:{ Authorization:`Bearer ${tok}`, 'Content-Type':'application/json' },
    body: JSON.stringify({
      custom_fields_values: [
        { field_id: Number(fieldId), values: [{ value: url }] }
      ]
    })
  });
  if (!r.ok) throw new Error('Kommo PATCH ' + r.status);
}

/* ------------------------------- Token replacer ------------------------------- */
function replaceTokens(tpl, map) {
  let out = tpl;
  for (const [k,v] of Object.entries(map)) {
    out = out.replaceAll(`{{${k}}}`, v == null ? '' : String(v));
  }
  return out;
}

/* --------------------------------- Revision --------------------------------- */
async function nextRevision(outDir, leadId) {
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
    await fs.mkdir(outDir, { recursive:true });
    return 1;
  }
}

/* ================================== MAIN ================================== */
(async function main() {

  /* ENV */
  const GH_OWNER  = assertEnv('GH_OWNER');
  const GH_REPO   = assertEnv('GH_REPO');
  const GH_BRANCH = process.env.GH_BRANCH || 'main';

  const KOMMO_SUB = assertEnv('KOMMO_SUBDOMAIN');
  const KOMMO_TOK = assertEnv('KOMMO_TOKEN');
  const LATEST_ID = assertEnv('KOMMO_LATEST_URL_FIELD_ID');

  const PUBLIC    = assertEnv('PUBLIC_BASE_URL');
  const DEFAULT_CCY = process.env.DEFAULT_CURRENCY || '£';

  /* ARGS */
  const dataFile = arg('--data');
  const tplFile  = arg('--tpl', 'templates/quote.html.tpl');
  const outDir   = arg('--out', 'quotes');
  const SKIP_KOMMO = hasFlag('--skip-kommo');

  if (!dataFile) {
    console.error('Usage: node scripts/generate-quote-advanced.js --data data/quotes/<LEAD_ID>/info.json [--tpl templates/quote.html.tpl] [--out quotes]');
    process.exit(1);
  }

  /* LOAD DATA */
  const data   = JSON.parse(await fs.readFile(path.resolve(dataFile), 'utf8'));
  const leadId = String(data.leadId);

  /* KOMMO */
  const lead = await kommoGetLead(KOMMO_SUB, KOMMO_TOK, leadId);
  const contacts = lead?._embedded?.contacts || [];
  let clientName = '', clientEmail = '';
  if (contacts.length) {
    const c = await kommoGetContact(KOMMO_SUB, KOMMO_TOK, contacts[0].id);
    clientName = c.name || '';
    const emailField =
      (c.custom_fields_values || []).find(f=>f.field_code==='EMAIL') ||
      (c.custom_fields_values || []).find(f=>String(f.field_name||'').toLowerCase().includes('email'));
    clientEmail = emailField?.values?.[0]?.value || '';
  }

  /* PATHS */
  const quoteDir    = path.dirname(path.resolve(dataFile));
  const localAssets = path.join(quoteDir, 'assets');
  const viewerDirOn  = path.join(localAssets, 'viewer_doors_on');
  const viewerDirOff = path.join(localAssets, 'viewer_doors_off');
  const matsDir     = path.join(localAssets, 'materials');
  const hndlDir     = path.join(localAssets, 'handles');

  // Mirror local assets into repo-served public paths
  const repoViewerOnDir  = path.resolve('assets','leads',leadId,'viewer_doors_on');
  const repoViewerOffDir = path.resolve('assets','leads',leadId,'viewer_doors_off');
  const repoMatsDir      = path.resolve('assets','leads',leadId,'materials');
  const repoHndlDir      = path.resolve('assets','leads',leadId,'handles');

  await mirrorFolder(viewerDirOn,  repoViewerOnDir);
  await mirrorFolder(viewerDirOff, repoViewerOffDir);
  await mirrorFolder(matsDir,      repoMatsDir);
  await mirrorFolder(hndlDir,      repoHndlDir);

  // Discover files
  const viewerOnFilesAbs  = await listFilesAbs(viewerDirOn,  ['.3ds','.png','.jpg','.jpeg']);
  const viewerOffFilesAbs = await listFilesAbs(viewerDirOff, ['.3ds','.png','.jpg','.jpeg']);
  const matsFilesAbs      = await listFilesAbs(matsDir,      ['.png','.jpg','.jpeg']);
  const hndlFilesAbs      = await listFilesAbs(hndlDir,      ['.png','.jpg','.jpeg']);

  const viewerOnRelPaths  = viewerOnFilesAbs.map(abs  => toPosix(path.relative(viewerDirOn,  abs)));
  const viewerOffRelPaths = viewerOffFilesAbs.map(abs => toPosix(path.relative(viewerDirOff, abs)));

  // 3D iframe HTMLs (complete, valid)
  const THREED_IFRAME_URL_DOORS_ON =
    viewerOnRelPaths.length
      ? build3DIframe({ owner: GH_OWNER, repo: GH_REPO, branch: GH_BRANCH, leadId, viewerDirName: 'viewer_doors_on', viewerRelPaths: viewerOnRelPaths })
      : '';

  const THREED_IFRAME_URL_DOORS_OFF =
    viewerOffRelPaths.length
      ? build3DIframe({ owner: GH_OWNER, repo: GH_REPO, branch: GH_BRANCH, leadId, viewerDirName: 'viewer_doors_off', viewerRelPaths: viewerOffRelPaths })
      : '';

  // Overview (Markdown -> HTML)
  const OVERVIEW_TEXT = data.overview ? marked.parse(data.overview) : '';

  /* PRICING */
  const ccy = data.pricing?.currency || DEFAULT_CCY;
  const items = Array.isArray(data.pricing?.items) ? data.pricing.items : [];
  const vatRate = (typeof data.pricing?.vatRate === 'number') ? data.pricing.vatRate : 0.20;

  const subtotal = items.reduce((s, it) => s + (Number(it.qty || 1) * Number(it.unit || 0)), 0);
  const vat      = subtotal * vatRate;
  const total    = subtotal + vat;

  const LINE_ITEMS_HTML = items.length
    ? items.map(it => {
        const qty  = Number(it.qty || 1);
        const unit = Number(it.unit || 0);
        const line = qty * unit;
        return `<tr>
  <td>${it.name || ''}</td>
  <td class="num">${qty}</td>
  <td class="num">${ccy}${money(unit)}</td>
  <td class="num">${ccy}${money(line)}</td>
</tr>`;
      }).join('\n')
    : `<tr><td colspan="4">No items.</td></tr>`;

  /* MATERIALS */
  const materialMeta = Array.isArray(data.materials) ? data.materials : [];
  let MATERIAL_1_THUMB = '';
  let MATERIAL_1_NAME  = '';
  let MATERIAL_1_NOTES = '';
  let MATERIAL_2_BLOCK = '';

  if (materialMeta.length > 0) {
    // Material 1 — keep as URL (template wraps in <img>)
    const m0 = materialMeta[0];
    if (matsFilesAbs[0]) {
      MATERIAL_1_THUMB = await copyToRepoAndGetWebUrl(matsFilesAbs[0], repoMatsDir);
    } else {
      MATERIAL_1_THUMB = '';
    }
    MATERIAL_1_NAME  = m0?.name  || '';
    MATERIAL_1_NOTES = m0?.notes || '';

    // Material 2+ — emit full <figure> blocks with <img>
    for (let i = 1; i < materialMeta.length; i++) {
      const mi = materialMeta[i];
      let web = '';
      if (matsFilesAbs[i]) {
        web = await copyToRepoAndGetWebUrl(matsFilesAbs[i], repoMatsDir);
      }
      const alt = escAttr(mi?.name || `Material ${i+1}`);
      MATERIAL_2_BLOCK += `
<figure class="swatch-card">
  <img class="swatch-thumb" src="${web}" data-full="${web}" alt="${alt}"/>
  <figcaption class="swatch-caption">
    <strong>${escAttr(mi?.name || '')}</strong><br/>
    <span>${escAttr(mi?.notes || '')}</span>
  </figcaption>
</figure>`;
    }
  }

  /* HANDLES */
  const handleMeta = Array.isArray(data.handles) ? data.handles : [];
  let HANDLE_1_BLOCK = '';
  let HANDLE_2_BLOCK = '';

  if (handleMeta.length > 0) {
    for (let i = 0; i < handleMeta.length; i++) {
      const hi = handleMeta[i];
      let web = '';
      if (hndlFilesAbs[i]) {
        web = await copyToRepoAndGetWebUrl(hndlFilesAbs[i], repoHndlDir);
      }
      const alt = escAttr(hi?.name || `Handle ${i+1}`);
      const block = `
<figure class="swatch-card">
  <img class="swatch-thumb" src="${web}" data-full="${web}" alt="${alt}"/>
  <figcaption class="swatch-caption">
    <strong>${escAttr(hi?.name || '')}</strong><br/>
    <span>${escAttr(hi?.finish || hi?.notes || '')}</span>
  </figcaption>
</figure>`;
      if (i === 0) HANDLE_1_BLOCK = block;
      else HANDLE_2_BLOCK += block;
    }
  }

  /* DATES */
  const issueISO  = data.issueDate || new Date().toISOString().slice(0,10);
  const expiryISO = addDays(issueISO, 30);
  const ISSUE_DATE  = formatDateIntl(issueISO);
  const EXPIRY_DATE = formatDateIntl(expiryISO);

  /* REVISION / OUTPUT */
  await fs.mkdir(outDir, { recursive: true });
  const revision = await nextRevision(outDir, leadId);

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

    // NEW dual-viewer tokens
    THREED_IFRAME_URL_DOORS_ON,
    THREED_IFRAME_URL_DOORS_OFF,
    // Back-compat: if template still uses the old token, fill with DOORS_ON
    THREED_IFRAME_URL: THREED_IFRAME_URL_DOORS_ON,

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

  const publicUrl = `${PUBLIC.replace(/\/+$/,'')}/quotes/${leadId}_v${revision}.html`;
  console.log(`✔ Generated: ${outPath}`);
  console.log(`✔ Public URL: ${publicUrl}`);

  if (!SKIP_KOMMO) {
    await kommoPatchLatestUrl(KOMMO_SUB, KOMMO_TOK, leadId, publicUrl, LATEST_ID);
    console.log('✔ Kommo Latest Quote URL updated.');
  } else {
    console.log('ℹ Kommo PATCH skipped (--skip-kommo).');
  }

})().catch(e => { console.error(e); process.exit(1); });
