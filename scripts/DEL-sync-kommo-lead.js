import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

function arg(name, fallback=null){ const i = process.argv.indexOf(name); return (i!==-1 && process.argv[i+1]) ? process.argv[i+1] : fallback; }
function assertEnv(name){ const v = process.env[name]; if (!v) { console.error(`Missing env: ${name}`); process.exit(1); } return v; }
async function ensureDir(p){ await fs.mkdir(p, { recursive:true }); }

async function kommoGetLead(subdomain, token, leadId){
  const url = `https://${subdomain}.kommo.com/api/v4/leads/${leadId}?with=contacts`;
  const res = await fetch(url, { headers: { 'Authorization':`Bearer ${token}`, 'Accept':'application/json' } });
  if (!res.ok) throw new Error(`GET lead failed: ${res.status} ${await res.text()}`);
  return res.json();
}
async function kommoGetContact(subdomain, token, contactId){
  const url = `https://${subdomain}.kommo.com/api/v4/contacts/${contactId}`;
  const res = await fetch(url, { headers: { 'Authorization':`Bearer ${token}`, 'Accept':'application/json' } });
  if (!res.ok) throw new Error(`GET contact failed: ${res.status} ${await res.text()}`);
  return res.json();
}

(async function main(){
  const sub = assertEnv('KOMMO_SUBDOMAIN'); const tok = assertEnv('KOMMO_TOKEN');
  const leadId = arg('--lead');
  if (!leadId){ console.error('Usage: node scripts/sync-kommo-lead.js --lead <LEAD_ID>'); process.exit(1); }

  const lead = await kommoGetLead(sub, tok, leadId);
  const contacts = lead?._embedded?.contacts || [];
  let clientName='', clientEmail='';
  if (contacts.length){
    const c = await kommoGetContact(sub, tok, contacts[0].id);
    clientName = c.name || '';
    const emailField = (c.custom_fields_values||[]).find(f => f.field_code==='EMAIL')
      || (c.custom_fields_values||[]).find(f => String(f.field_name||'').toLowerCase().includes('email'));
    clientEmail = emailField?.values?.[0]?.value || '';
  }

  const rawDir = path.join('data','kommo','leads'); await ensureDir(rawDir);
  await fs.writeFile(path.join(rawDir, `${leadId}.raw.json`), JSON.stringify(lead, null, 2), 'utf8');

  const curatedPath = path.join('data','quotes', `${leadId}.json`);
  await ensureDir(path.dirname(curatedPath));
  let curated = {};
  try { curated = JSON.parse(await fs.readFile(curatedPath,'utf8')); } catch {}
  curated.leadId = String(leadId);
  curated.projectTitle = curated.projectTitle || lead.name || `Lead ${leadId}`;
  curated.issueDate = curated.issueDate || new Date().toISOString().slice(0,10);
  curated.validUntil = curated.validUntil || '';
  curated.client = { name: clientName || (curated.client?.name||''), email: clientEmail || (curated.client?.email||'') };

  curated.images    = curated.images    || {};
  curated.materials = Array.isArray(curated.materials) ? curated.materials : [];
  curated.handles   = Array.isArray(curated.handles)   ? curated.handles   : [];
  curated.overview  = curated.overview  || '';
  curated.pricing   = curated.pricing   || { currency:'£', items:[], vatRate:0.20 };

  await fs.writeFile(curatedPath, JSON.stringify(curated, null, 2), 'utf8');
  console.log(`✔ Updated curated → ${curatedPath}`);
})();