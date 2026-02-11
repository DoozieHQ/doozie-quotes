import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

// ------------------------------------------
// Utility helpers
// ------------------------------------------
function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : fallback;
}

function assertEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

function money(n) {
  return Number(n || 0).toFixed(2);
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// ------------------------------------------
// Build RAW GitHub URLs
// ------------------------------------------
function buildRawUrl(owner, repo, branch, relPath) {
  const clean = String(relPath).replace(/^\/+/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encoded}`;
}

// ------------------------------------------
// Build <iframe> for 3D viewer
// ------------------------------------------
function build3DViewerIframe(owner, repo, branch, filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return '';

  const urls = filePaths.map(p => buildRawUrl(owner, repo, branch, p));
  const modelParam = encodeURIComponent(urls.join(','));

  return `<iframe src="https://3dviewer.net/#model=${modelParam}" allowfullscreen></iframe>`;
}

// ------------------------------------------
// Auto-discover 3D files
// ------------------------------------------
async function autoDiscoverViewerFiles(leadId) {
  const base = path.resolve(process.cwd(), 'assets', 'leads', String(leadId), 'viewer');
  const found = [];

  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (ext === '.3ds' || ext === '.jpg' || ext === '.jpeg') {
          found.push(toPosix(path.relative(process.cwd(), abs)));
        }
      }
    }
  }

  await walk(base);
  return found;
}

// ------------------------------------------
// Build revision number
// ------------------------------------------
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

// ------------------------------------------
// Render line items
// ------------------------------------------
function renderLineItems(items = [], ccy = '£') {
  if (!Array.isArray(items) || items.length === 0)
    return `<tr><td colspan="4">No items.</td></tr>`;

  return items
    .map(it => {
      const qty = Number(it.qty || 1);
      const unit = Number(it.unit || 0);
      const line = qty * unit;
      return `
<tr>
  <td>${it.name || ''}</td>
  <td class="num">${qty}</td>
  <td class="num">${ccy}${money(unit)}</td>
  <td class="num">${ccy}${money(line)}</td>
</tr>`;
    })
    .join('\n');
}

// ------------------------------------------
// Kommo API helpers
// ------------------------------------------
async function kommoGetLead(sub, tok, id) {
  const url = `https://${sub}.kommo.com/api/v4/leads/${id}?with=contacts`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${tok}`,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Kommo GET lead error: ${res.status}`);
  return res.json();
}

async function kommoGetContact(sub, tok, id) {
  const url = `https://${sub}.kommo.com/api/v4/contacts/${id}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${tok}`,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Kommo GET contact error: ${res.status}`);
  return res.json();
}

async function kommoUpdateUrl(sub, tok, leadId, url, fieldId) {
  const apiUrl = `https://${sub}.kommo.com/api/v4/leads/${leadId}`;
  const body = {
    custom_fields_values: [
      {
        field_id: Number(fieldId),
        values: [{ value: url }]
      }
    ]
  };

  const res = await fetch(apiUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tok}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`Kommo PATCH error: ${res.status} ${await res.text()}`);
  }
}

// ------------------------------------------
// HTML token replacement
// ------------------------------------------
function replaceTokens(tpl, map) {
  let out = tpl;
  for (const [key, val] of Object.entries(map)) {
    const token = `{{${key}}}`;
    out = out.replaceAll(token, val ?? '');
  }
  return out;
}

// ------------------------------------------
// MAIN
// ------------------------------------------
(async function main() {
  const GH_OWNER  = assertEnv('GH_OWNER');
  const GH_REPO   = assertEnv('GH_REPO');
  const GH_BRANCH = process.env.GH_BRANCH || 'main';

  const KOMMO_SUB = assertEnv('KOMMO_SUBDOMAIN');
  const KOMMO_TOK = assertEnv('KOMMO_TOKEN');
  const LATEST_ID = assertEnv('KOMMO_LATEST_URL_FIELD_ID');
  const PUBLIC    = assertEnv('PUBLIC_BASE_URL');
  const DEFAULT_CCY = process.env.DEFAULT_CURRENCY || '£';

  const dataFile = arg('--data');
  const tplFile  = arg('--tpl', 'templates/quote.html.tpl');
  const outDir   = arg('--out', 'quotes');

  if (!dataFile) {
    console.error("Missing --data argument.");
    process.exit(1);
  }

  const data = JSON.parse(await fs.readFile(path.resolve(dataFile), 'utf8'));
  const leadId = String(data.leadId);

  // ----- Fetch Kommo lead + contact -----
  const lead = await kommoGetLead(KOMMO_SUB, KOMMO_TOK, leadId);
  const contacts = lead?._embedded?.contacts || [];

  let clientName = '';
  let clientEmail = '';

  if (contacts.length) {
    const c = await kommoGetContact(KOMMO_SUB, KOMMO_TOK, contacts[0].id);
    clientName = c.name || '';

    const emailField =
      (c.custom_fields_values || []).find(f => f.field_code === 'EMAIL') ||
      (c.custom_fields_values || []).find(f =>
        String(f.field_name || '').toLowerCase().includes('email')
      );

    clientEmail = emailField?.values?.[0]?.value || '';
  }

  // ----- 3D auto-discovery -----
  const viewerFiles = await autoDiscoverViewerFiles(leadId);
  const THREED_IFRAME_URL = viewerFiles.length
    ? build3DViewerIframe(GH_OWNER, GH_REPO, GH_BRANCH, viewerFiles)
    : '';

  // ----- Pricing -----
  const ccy = data.pricing?.currency || DEFAULT_CCY;
  const items = Array.isArray(data.pricing?.items) ? data.pricing.items : [];
  const vatRate = data.pricing?.vatRate ?? 0.20;

  const subtotal = items.reduce((s, it) => s + (Number(it.qty||1) * Number(it.unit||0)), 0);
  const vat      = subtotal * vatRate;
  const total    = subtotal + vat;

  const LINE_ITEMS_HTML = renderLineItems(items, ccy);

  // ----- Build images -----
  const doorsOn = data.images?.doorsOn || {};
  const doorsOff = data.images?.doorsOff || {};

  const IMAGE_DOORSON_THUMB  =
    doorsOn.thumb
      ? `${doorsOn.thumb}`
      : '';

  const IMAGE_DOORSOFF_THUMB =
    doorsOff.thumb
      ? `${doorsOff.thumb}`
      : '';

  // ----- Materials -----
  let MATERIAL_1_THUMB = '';
  let MATERIAL_1_NAME  = '';
  let MATERIAL_1_NOTES = '';
  let MATERIAL_2_BLOCK = '';

  if (Array.isArray(data.materials) && data.materials.length > 0) {
    MATERIAL_1_THUMB = data.materials[0].thumb || '';
    MATERIAL_1_NAME  = data.materials[0].name  || '';
    MATERIAL_1_NOTES = data.materials[0].notes || '';

    if (data.materials[1]) {
      MATERIAL_2_BLOCK = `
<figure class="swatch-card">
  ${data.materials[1].thumb || ''}
  <figcaption class="swatch-caption">
    <strong>${data.materials[1].name || ''}</strong><br/>
    <span>${data.materials[1].notes || ''}</span>
  </figcaption>
</figure>`;
    }
  }

  // ----- Handles -----
  let HANDLE_1_BLOCK = '';
  let HANDLE_2_BLOCK = '';

  if (Array.isArray(data.handles) && data.handles.length > 0) {
    HANDLE_1_BLOCK = `
<figure class="swatch-card">
  ${data.handles[0].thumb || ''}
  <figcaption class="swatch-caption">
    <strong>${data.handles[0].name || ''}</strong><br/>
    <span>${data.handles[0].finish || ''}</span>
  </figcaption>
</figure>`;

    if (data.handles[1]) {
      HANDLE_2_BLOCK = `
<figure class="swatch-card">
  ${data.handles[1].thumb || ''}
  <figcaption class="swatch-caption">
    <strong>${data.handles[1].name || ''}</strong><br/>
    <span>${data.handles[1].finish || ''}</span>
  </figcaption>
</figure>`;
    }
  }

  // ----- Build output -----
  await fs.mkdir(outDir, { recursive: true });
  const revision = await getNextRevision(outDir, leadId);
  const outPath  = path.join(outDir, `${leadId}_v${revision}.html`);
  const publicUrl = `${PUBLIC.replace(/\/+$/, '')}/quotes/${leadId}_v${revision}.html`;

  const tpl = await fs.readFile(path.resolve(tplFile), 'utf8');

  const html = replaceTokens(tpl, {
    LEAD_ID: leadId,
    REVISION: revision,
    PROJECT_TITLE: data.projectTitle || lead.name || `Lead ${leadId}`,
    CLIENT_NAME: clientName,
    CLIENT_EMAIL: clientEmail,
    ISSUE_DATE: data.issueDate || new Date().toISOString().slice(0,10),
    VALID_UNTIL: data.validUntil || '',
    OVERVIEW_TEXT: data.overview || '',

    // images
    IMAGE_DOORSON_THUMB,
    IMAGE_DOORSOFF_THUMB,

    // 3D
    THREED_IFRAME_URL,

    // materials + handles
    MATERIAL_1_THUMB,
    MATERIAL_1_NAME,
    MATERIAL_1_NOTES,
    MATERIAL_2_BLOCK,
    HANDLE_1_BLOCK,
    HANDLE_2_BLOCK,

    // pricing
    LINE_ITEMS_HTML,
    SUBTOTAL: money(subtotal),
    VAT_AMOUNT: money(vat),
    TOTAL: money(total),
    CURRENCY: ccy
  });

  await fs.writeFile(outPath, html, 'utf8');
  console.log(`✔ Generated: ${outPath}`);
  console.log(`✔ Public URL: ${publicUrl}`);

  await kommoUpdateUrl(KOMMO_SUB, KOMMO_TOK, leadId, publicUrl, LATEST_ID);
  console.log(`✔ Kommo updated.`);
})();