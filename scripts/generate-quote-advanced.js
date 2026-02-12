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
      const esc = s => s.replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');

      const lines = md.split('\n');
      const out = [];
      let listOpen = false;

      const flushList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };

      for (const raw of lines) {
        const line = raw.trimEnd();

        const m = line.match(/^[-*]\s+(.*)$/);
        if (m) {
          if (!listOpen) { out.push('<ul>'); listOpen = true; }
          const li = esc(m[1])
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>');
          out.push(`<li>${li}</li>`);
          continue;
        }

        if (line.trim() === '') {
          flushList();
          out.push('');
          continue;
        }

        flushList();
        const p = esc(line)
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>');
        out.push(`<p>${p}</p>`);
      }

      flushList();
      return out.join('\n');
    }
  };
}

/* ----------------------------- small utils ----------------------------- */
function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : fallback;
}
function hasFlag(flag) { return process.argv.includes(flag); }
function assertEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name}`);
    process.exit(1);
  }
  return v;
}
function money(n) { return Number(n || 0).toFixed(2); }
function toPosix(p) { return p.split(path.sep).join('/'); }

/* Root-absolute web paths */
function toWebPath(rel) {
  if (!rel) return '';
  return '/' + toPosix(rel).replace(/^\/+/, '');
}
function toWebUrl(rel) {
  return rel ? encodeURI(toWebPath(rel)) : '';
}

/* Escape attribute text */
function escAttr(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* dates */
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDateIntl(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = MONTHS_SHORT[d.getMonth()];
  const yy = d.getFullYear();
  return `${dd} ${mm} ${yy}`;
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

/* ------------------ MIRROR VIEWER FOLDER ------------------ */
async function mirrorFolder(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);

    if (e.isDirectory()) {
      await mirrorFolder(srcPath, destPath);
    } else if (e.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/* ---------------- GH Raw URL builder for 3D viewer ---------------- */
function ghRaw(owner, repo, branch, repoRelPath) {
  const clean = repoRelPath.replace(/^\/+/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encoded}`;
}

/* Build a COMPLETE <iframe> for the 3D viewer */
function build3DViewerIframe({ owner, repo, branch, leadId, repoRelPaths }) {
  if (!repoRelPaths.length) return '';

  const urls = repoRelPaths.map(rel =>
    ghRaw(owner, repo, branch, `assets/leads/${leadId}/viewer/${rel}`)
  );

  const modelList = urls.map(u => encodeURI(u)).join(',');

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
  return `${src}</iframe>`;
}

/* Kommo helpers */
async function kommoGetLead(sub, tok, id) {
  const url = `https://${sub}.kommo.com/api/v4/leads/${id}?with=contacts`;
  const r = await fetch(url, { headers: { 'Authorization':'Bearer ' + tok, 'Accept':'application/json' }});
  if (!r.ok) throw new Error('Kommo GET lead: ' + r.status);
  return r.json();
}

async function kommoGetContact(sub, tok, id) {
  const url = `https://${sub}.kommo.com/api/v4/contacts/${id}`;
  const r = await fetch(url, { headers: { 'Authorization':'Bearer ' + tok, 'Accept':'application/json' }});
  if (!r.ok) throw new Error('Kommo GET contact: ' + r.status);
  return r.json();
}

async function kommoPatchLatestUrl(sub, tok, leadId, url, fieldId) {
  const apiUrl = `https://${sub}.kommo.com/api/v4/leads/${leadId}`;
  const body = {
    custom_fields_values: [
      { field_id: Number(fieldId), values: [{ value: url }] }
    ]
  };

  const r = await fetch(apiUrl, {
    method: 'PATCH',
    headers: { 'Authorization':'Bearer ' + tok, 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });

  if (!r.ok) throw new Error('Kommo PATCH fail: ' + r.status);
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

/* ------------------------------------------------------------
 * MAIN
 * ------------------------------------------------------------ */
(async function main(){

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
  const STRICT   = hasFlag('--strict');
  const SKIP     = hasFlag('--skip-kommo');

  if (!dataFile){
    console.error('Usage: node generate-quote-advanced.js --data data/quotes/<LEAD_ID>/info.json');
    process.exit(1);
  }

  const data   = JSON.parse(await fs.readFile(path.resolve(dataFile), 'utf8'));
  const leadId = String(data.leadId);

  /* Kommo: lead + contact */
  const lead = await kommoGetLead(KOMMO_SUB, KOMMO_TOK, leadId);
  const contacts = lead?._embedded?.contacts || [];
  let clientName='', clientEmail='';

  if (contacts.length){
    const c = await kommoGetContact(KOMMO_SUB, KOMMO_TOK, contacts[0].id);
    clientName = c.name || '';
    const emailField =
      (c.custom_fields_values || []).find(f => f.field_code === 'EMAIL') ||
      (c.custom_fields_values || []).find(f => String(f.field_name||'').toLowerCase().includes('email'));

    clientEmail = emailField?.values?.[0]?.value || '';
  }

  /* Drop-folder paths */
  const quoteDir  = path.dirname(path.resolve(dataFile));
  const assetsDir = path.join(quoteDir, 'assets');
  const viewerDir = path.join(assetsDir, 'viewer');
  const materialsDir = path.join(assetsDir, 'materials');
  const handlesDir   = path.join(assetsDir, 'handles');

  /* Mirror local viewerFiles → repo public viewer path */
  const repoViewerDir = path.resolve('assets','leads',leadId,'viewer');
  await mirrorFolder(viewerDir, repoViewerDir);

  /* Discover files */
  const viewerFilesAbs   = (await listFiles(viewerDir,    ['.3ds','.png','.jpg','.jpeg'])).map(p => path.resolve(p));
  const materialFilesAbs = (await listFiles(materialsDir, ['.png','.jpg','.jpeg'])).map(p => path.resolve(p));
  const handleFilesAbs   = (await listFiles(handlesDir,   ['.png','.jpg','.jpeg'])).map(p => path.resolve(p));

  /* Relative viewer paths */
  const viewerRelPaths = viewerFilesAbs.map(abs =>
    toPosix(path.relative(viewerDir, abs))
  );

  /* Build 3D iframe */
  const THREED_IFRAME_URL = viewerRelPaths.length
    ? build3DViewerIframe({
        owner: GH_OWNER,
        repo: GH_REPO,
        branch: GH_BRANCH,
        leadId,
        repoRelPaths: viewerRelPaths
      })
    : '';

  /* Overview */
  const OVERVIEW_TEXT = data.overview ? marked.parse(data.overview) : '';

  /* Pricing */
  const ccy = data.pricing?.currency || DEFAULT_CCY;
  const items = Array.isArray(data.pricing?.items) ? data.pricing.items : [];
  const vatRate = typeof data.pricing?.vatRate === 'number' ? data.pricing.vatRate : 0.20;

  const subtotal = items.reduce((s,it)=> s + (Number(it.qty||1) * Number(it.unit||0)), 0);
  const vat      = subtotal * vatRate;
  const total    = subtotal + vat;

  const LINE_ITEMS_HTML = items.length
    ? items.map(it => {
        const qty  = Number(it.qty||1);
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

  /* Materials */
  const materialMeta = Array.isArray(data.materials) ? data.materials : [];
  let MATERIAL_1_THUMB='', MATERIAL_1_NAME='', MATERIAL_1_NOTES='', MATERIAL_2_BLOCK='';

  if (materialMeta.length > 0) {
    const pubMatDir = path.resolve('assets','leads',leadId,'materials');

    // Material 1
    const m0 = materialMeta[0];
    const f0 = materialFilesAbs[0]
      ? toWebUrl(path.relative(process.cwd(), await fs.copyFile(materialFilesAbs[0], path.join(pubMatDir, path.basename(materialFilesAbs[0]))).then(()=> path.join('assets','leads',leadId,'materials',path.basename(materialFilesAbs[0])))))
      : '';

    MATERIAL_1_THUMB = f0;
    MATERIAL_1_NAME  = m0?.name  || '';
    MATERIAL_1_NOTES = m0?.notes || '';

    // Material 2+
    await fs.mkdir(pubMatDir, { recursive:true });
    for (let i = 1; i < materialMeta.length; i++) {
      const mi = materialMeta[i];
      const src = materialFilesAbs[i];
      const fileName = path.basename(src);

      if (src) {
        const dest = path.join(pubMatDir, fileName);
        await fs.copyFile(src, dest);
        const web = toWebUrl(path.relative(process.cwd(), dest));
        MATERIAL_2_BLOCK += `
<figure class="swatch-card">
  ${web}
  <figcaption class="swatch-caption">
    <strong>${escAttr(mi?.name || '')}</strong><br/>
    <span>${escAttr(mi?.notes || '')}</span>
  </figcaption>
</figure>`;
      }
    }
  }

  /* Handles */
  const handleMeta = Array.isArray(data.handles) ? data.handles : [];
  let HANDLE_1_BLOCK='', HANDLE_2_BLOCK='';

  if (handleMeta.length > 0) {
    const pubHdlDir = path.resolve('assets','leads',leadId,'handles');
    await fs.mkdir(pubHdlDir, { recursive:true });

    for (let i = 0; i < handleMeta.length; i++) {
      const hi = handleMeta[i];
      const src = handleFilesAbs[i];
      const fileName = src ? path.basename(src) : '';

      let web = '';
      if (src) {
        const dest = path.join(pubHdlDir, fileName);
        await fs.copyFile(src, dest);
        web = toWebUrl(path.relative(process.cwd(), dest));
      }

      const block = `
<figure class="swatch-card">
  ${web}
  <figcaption class="swatch-caption">
    <strong>${escAttr(hi?.name || '')}</strong><br/>
    <span>${escAttr(hi?.finish || hi?.notes || '')}</span>
  </figcaption>
</figure>`;

      if (i === 0) HANDLE_1_BLOCK = block;
      else HANDLE_2_BLOCK += block;
    }
  }

  /* Revision & dates */
  await fs.mkdir(outDir, { recursive:true });
  const revision = await getNextRevision(outDir, leadId);

  const issueISO  = data.issueDate || new Date().toISOString().slice(0,10);
  const expiryISO = addDays(issueISO, 30);
  const ISSUE_DATE  = formatDateIntl(issueISO);
  const EXPIRY_DATE = formatDateIntl(expiryISO);

  /* Build HTML */
  const tpl  = await fs.readFile(path.resolve(tplFile),'utf8');
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

  /* Write file */
  const outPath  = path.join(outDir, `${leadId}_v${revision}.html`);
  await fs.writeFile(outPath, html, 'utf8');

  const publicUrl = `${PUBLIC.replace(/\/+$/,'')}/quotes/${leadId}_v${revision}.html`;
  console.log('Generated: ' + outPath);
  console.log('Public URL: ' + publicUrl);

  if (!SKIP) {
    await kommoPatchLatestUrl(KOMMO_SUB, KOMMO_TOK, leadId, publicUrl, LATEST_ID);
    console.log('Kommo updated.');
  } else {
    console.log('Kommo PATCH skipped.');
  }

  if (STRICT) console.log('STRICT mode on.');

})().catch(e => {
  console.error(e);
  process.exit(1);
});