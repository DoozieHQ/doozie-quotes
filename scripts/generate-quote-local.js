import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

// ---------- helpers ----------
function replaceTokens(tpl, map){
  return Object.entries(map).reduce((acc,[k,v]) => acc.replaceAll(`{{${k}}}`, String(v ?? '')), tpl);
}
function money(n){ return Number(n||0).toFixed(2); }
function assertEnv(name){
  const v = process.env[name];
  if (!v) { console.error(`Missing env: ${name}`); process.exit(1); }
  return v;
}
function buildRawUrl(owner, repo, branch, relPath) {
  const clean = String(relPath).replace(/^\/+/, '');
  const parts = clean.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${parts}`;
}
function build3DViewerIframeFromFiles(owner, repo, branch, filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return '';
  const urls = filePaths.map((p) => buildRawUrl(owner, repo, branch, p));
  const hash = '#model=' + urls.map(encodeURIComponent).join(',');
  const src  = `https://3dviewer.net/${hash}`;
  return `${src}</iframe>`;
}
function toPosix(p){ return p.split(path.sep).join('/'); }
async function autoDiscoverViewerFiles(leadId) {
  const baseDir = path.resolve(process.cwd(), 'assets', 'leads', String(leadId), 'viewer');
  const found = [];
  async function walk(dir){
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes:true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else {
        const ext = path.extname(e.name).toLowerCase();
        if (ext === '.3ds' || ext === '.jpg' || ext === '.jpeg') {
          found.push(toPosix(path.relative(process.cwd(), abs)));
        }
      }
    }
  }
  await walk(baseDir);
  return found;
}
function arg(name, fallback=null) {
  const i = process.argv.indexOf(name);
  return (i !== -1 && process.argv[i+1]) ? process.argv[i+1] : fallback;
}
async function getNextRevision(outDir, leadId){
  try{
    const files = await fs.readdir(outDir);
    const re = new RegExp(`^${leadId}_v(\\d+)\\.html$`, 'i');
    let max = 0;
    for (const f of files) { const m = f.match(re); if (m) max = Math.max(max, Number(m[1]||0)); }
    return max + 1;
  }catch{ await fs.mkdir(outDir, { recursive:true }); return 1; }
}
function renderLineItems(items=[], ccy='£'){
  if (!Array.isArray(items) || items.length===0) return `<tr><td colspan="4">No line items.</td></tr>`;
  return items.map(it=>{
    const qty=Number(it.qty||1), unit=Number(it.unit||0), line=qty*unit;
    return `<tr><td>${it.name||''}</td><td class="num">${qty}</td><td class="num">${(it.currency||ccy)}${money(unit)}</td><td class="num">${(it.currency||ccy)}${money(line)}</td></tr>`;
  }).join('\n');
}

// ---------- Kommo ----------
async function kommoGetLead(subdomain, token, leadId){
  const url = `https://${subdomain}.kommo.com/api/v4/leads/${leadId}?with=contacts`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Kommo GET lead failed: ${res.status} ${await res.text()}`);
  return res.json();
}
async function kommoGetContact(subdomain, token, contactId){
  const url = `https://${subdomain}.kommo.com/api/v4/contacts/${contactId}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Kommo GET contact failed: ${res.status} ${await res.text()}`);
  return res.json();
}
async function kommoUpdateLatestUrl(subdomain, token, leadId, latestUrl, fieldId){
  const url = `https://${subdomain}.kommo.com/api/v4/leads/${leadId}`;
  const body = { custom_fields_values: [ { field_id: Number(fieldId), values: [ { value: latestUrl } ] } ] };
  const res = await fetch(url, { method:'PATCH', headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Kommo PATCH failed: ${res.status} ${await res.text()}`);
}

// ---------- main ----------
(async function main(){
  const GH_OWNER  = assertEnv('GH_OWNER');
  const GH_REPO   = assertEnv('GH_REPO');
  const GH_BRANCH = process.env.GH_BRANCH || 'main';

  const KOMMO_SUBDOMAIN = assertEnv('KOMMO_SUBDOMAIN');
  const KOMMO_TOKEN     = assertEnv('KOMMO_TOKEN');
  const LATEST_URL_ID   = assertEnv('KOMMO_LATEST_URL_FIELD_ID');
  const PUBLIC_BASE_URL = assertEnv('PUBLIC_BASE_URL');
  const DEFAULT_CCY     = process.env.DEFAULT_CURRENCY || '£';

  const dataFile = arg('--data'); const tplPath = arg('--tpl','templates/quote.html.tpl'); const outDir = arg('--out','quotes');
  if (!dataFile) { console.error('Usage: node scripts/generate-quote-local.js --data data/quotes/<LEAD_ID>.json --tpl templates/quote.html.tpl --out quotes'); process.exit(1); }

  const data = JSON.parse(await fs.readFile(path.resolve(dataFile),'utf8'));
  const leadId = String(data.leadId);

  // Kommo: lead + contact
  const lead = await kommoGetLead(KOMMO_SUBDOMAIN, KOMMO_TOKEN, leadId);
  const contacts = lead?._embedded?.contacts || [];
  let clientName='', clientEmail='';
  if (contacts.length){
    const contact = await kommoGetContact(KOMMO_SUBDOMAIN, KOMMO_TOKEN, contacts[0].id);
    clientName = contact.name || '';
    const emailField = (contact.custom_fields_values||[]).find(f => f.field_code==='EMAIL')
      || (contact.custom_fields_values||[]).find(f => String(f.field_name||'').toLowerCase().includes('email'));
    clientEmail = emailField?.values?.[0]?.value || '';
  }

  // 3D: auto-discover .3ds + .jpg/.jpeg in assets/leads/<LEAD_ID>/viewer/
  let viewerFiles = await autoDiscoverViewerFiles(leadId);
  let THREED_IFRAME_URL = '';
  if (viewerFiles.length>0) THREED_IFRAME_URL = build3DViewerIframeFromFiles(GH_OWNER, GH_REPO, GH_BRANCH, viewerFiles);
  else if (data.threed?.iframe) THREED_IFRAME_URL = data.threed.iframe;

  // Pricing
  const ccy = data.pricing?.currency || DEFAULT_CCY;
  const items = Array.isArray(data.pricing?.items) ? data.pricing.items : [];
  const vatRate = (typeof data.pricing?.vatRate === 'number') ? data.pricing.vatRate : 0.20;
  const subtotal = items.reduce((s,it)=> s + Number(it.qty||1)*Number(it.unit||0), 0);
  const vat      = subtotal * vatRate;
  const total    = subtotal + vat;
  const LINE_ITEMS_HTML = renderLineItems(items, ccy);

  // Revision + out path
  const revision = await getNextRevision(outDir, leadId);
  const outFile  = path.join(outDir, `${leadId}_v${revision}.html`);
  const publicUrl = `${PUBLIC_BASE_URL.replace(/\/+$/,'')}/quotes/${leadId}_v${revision}.html`;

  // Build images (doors on/off) as clickable thumbs (expecting data.images.thumbs/full already)
  const doorsOn  = data.images?.doorsOn  || {};
  const doorsOff = data.images?.doorsOff || {};
  const IMAGE_DOORSON_THUMB  = doorsOn?.thumb  ? `<img class="thumb" src="${doorsOn.thumb}" data-full="${doorsOn.full||doorsOn.thumb}" alt="${doorsOn.alt||'Doors on'}">` : '';
  const IMAGE_DOORSOFF_THUMB = doorsOff?.thumb ? `<img class="thumb" src="${doorsOff.thumb}" data-full="${doorsOff.full||doorsOff.thumb}" alt="${doorsOff.alt||'Doors removed'}">` : '';

  // Materials & Handles blocks
  const mat1 = (data.materials?.[0]) ? `<img class="swatch-thumb" src="${data.materials[0].thumb}" data-full="${data.materials[0].full||data.materials[0].thumb}" alt="${data.materials[0].name||'Material 1'}">` : '';
  const MATERIAL_2_BLOCK = (data.materials?.[1]) ? `
    <figure class="swatch-card">
      <img class="swatch-thumb" src="${data.materials[1].thumb}" data-full="${data.materials[1].full||data.materials[1].thumb}" alt="${data.materials[1].name||'Material 2'}">
      <figcaption class="swatch-caption"><strong>${data.materials[1].name||''}</strong><br/><span class="muted">${data.materials[1].notes||''}</span></figcaption>
    </figure>` : '';

  const HANDLE_1_BLOCK = (data.handles?.[0]) ? `
    <figure class="swatch-card">
      <img class="swatch-thumb" src="${data.handles[0].thumb}" data-full="${data.handles[0].full||data.handles[0].thumb}" alt="${data.handles[0].name||'Handle 1'}">
      <figcaption class="swatch-caption"><strong>${data.handles[0].name||''}</strong><br/><span class="muted">${data.handles[0].finish||''}</span></figcaption>
    </figure>` : '';

  const HANDLE_2_BLOCK = (data.handles?.[1]) ? `
    <figure class="swatch-card">
      <img class="swatch-thumb" src="${data.handles[1].thumb}" data-full="${data.handles[1].full||data.handles[1].thumb}" alt="${data.handles[1].name||'Handle 2'}">
      <figcaption class="swatch-caption"><strong>${data.handles[1].name||''}</strong><br/><span class="muted">${data.handles[1].finish||''}</span></figcaption>
    </figure>` : '';

  // Load template
  const tpl = await fs.readFile(path.resolve(tplPath),'utf8');
  const html = replaceTokens(tpl, {
    LEAD_ID: leadId,
    REVISION: revision,
    CLIENT_NAME: clientName,
    CLIENT_EMAIL: clientEmail,
    PROJECT_TITLE: data.projectTitle || lead.name || `Lead ${leadId}`,
    ISSUE_DATE: data.issueDate || new Date().toISOString().slice(0,10),
    VALID_UNTIL: data.validUntil || '',
    OVERVIEW_TEXT: data.overview || '',
    IMAGE_DOORSON_THUMB,
    IMAGE_DOORSOFF_THUMB,
    THREED_IFRAME_URL,
    MATERIAL_1_THUMB: mat1,
    MATERIAL_1_NAME: (data.materials?.[0]?.name)||'',
    MATERIAL_1_NOTES:(data.materials?.[0]?.notes)||'',
    MATERIAL_2_BLOCK,
    HANDLE_1_BLOCK,
    HANDLE_2_BLOCK,
    LINE_ITEMS_HTML,
    SUBTOTAL: money(subtotal),
    VAT_AMOUNT: money(vat),
    TOTAL: money(total),
    CURRENCY: ccy
  });

  await fs.mkdir(outDir, { recursive:true });
  await fs.writeFile(outFile, html, 'utf8');
  console.log(`✔ Built: ${outFile}`);
  console.log(`   URL : ${publicUrl}`);

  await kommoUpdateLatestUrl(KOMMO_SUBDOMAIN, KOMMO_TOKEN, leadId, publicUrl, LATEST_URL_ID);
  console.log(`✔ Updated Kommo Latest Quote URL`);
})().catch(err=>{ console.error(err); process.exit(1); });