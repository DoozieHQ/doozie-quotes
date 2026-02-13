#!/usr/bin/env node
/**
 * Doozie — generate-quote-advanced.js (Full)
 * ------------------------------------------
 * - Builds 3DViewer <iframe> using public repo assets:
 *      assets/leads/<LEAD_ID>/viewer_doors_on|viewer_doors_off
 * - URL-encodes filenames, orders textures first, .3ds last
 * - Replaces all dynamic tokens (overview, materials, handles, pricing)
 * - Outputs versioned file: quotes/<LEAD_ID>_vN.html
 *
 * Usage (PowerShell one line):
 *   node scripts/generate-quote-advanced.js --data "data/quotes/<LEAD_ID>/info.json" --tpl "templates/quote.html.tpl" --out "quotes"
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ------------------------- tiny arg parser -------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

// --------------------------- paths & utils --------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}
async function readText(p) { return fs.readFile(p, "utf8"); }
async function writeText(p, s) { return fs.writeFile(p, s, "utf8"); }
async function loadJson(p) { return JSON.parse(await fs.readFile(p, "utf8")); }
async function listFiles(dir) { try { return await fs.readdir(dir); } catch { return []; } }
function nz(v, fb = "") { return (v ?? fb ?? "").toString(); }
function bulkReplace(text, dict) {
  let out = text;
  for (const [k, v] of Object.entries(dict)) out = out.replaceAll(k, v);
  return out;
}
function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ------------------------ 3D Viewer helpers -------------------------
const GH_OWNER  = "DoozieHQ";
const GH_REPO   = "doozie-quotes";
const GH_BRANCH = "main";

// raw.githubusercontent.com/<owner>/<repo>/<branch>/...
const RAW_BASE     = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}`;
// This mirrors your deployed public tree (served as /assets/leads in prod)
const PUBLIC_LEADS = "assets/leads";

function encodedRawUrl(leadId, subdir, filename) {
  return `${RAW_BASE}/${PUBLIC_LEADS}/${encodeURIComponent(String(leadId))}/${subdir}/${encodeURIComponent(filename)}`;
}

// Build the 3DViewer #model list from a local repo folder
async function buildModelList({ leadId, viewerAbsPath, publicSubdir }) {
  const files = await listFiles(viewerAbsPath);
  const models   = files.filter(f => f.toLowerCase().endsWith(".3ds"));
  const textures = files.filter(f => !f.toLowerCase().endsWith(".3ds"));

  if (models.length !== 1) {
    throw new Error(`Expected exactly 1 .3ds in ${viewerAbsPath}, found ${models.length}`);
  }

  // Optional: warn if model filename still has spaces (viewer usually dislikes spaces)
  if (/\s/.test(models[0])) {
    console.warn(`[WARN] Model filename contains spaces: ${models[0]} — consider renaming to underscores (_)`);
  }

  const texUrls  = textures.map(f => encodedRawUrl(leadId, publicSubdir, f));
  const modelUrl = encodedRawUrl(leadId, publicSubdir, models[0]);

  // 3DViewer: textures first, .3ds last (matches your working example)
  return [...texUrls, modelUrl].join(",");
}

async function build3DViewerIframe({ leadId, state, viewerAbsPath }) {
  const publicSubdir = state === "on" ? "viewer_doors_on" : "viewer_doors_off";
  const modelList    = await buildModelList({ leadId, viewerAbsPath, publicSubdir });

  const params = [
    `model=${modelList}`,
    // Feel free to tune these defaults:
    `camera=4371.47575,1888.79862,-1873.12939,1172.74561,1294.75024,1252.00024,0.00000,1.00000,0.00000,38`,
    `projectionmode=perspective`,
    `envsettings=fishermans_bastion,off`,
    `backgroundcolor=255,255,255,255`,
    `defaultcolor=200,200,200`,
    `defaultlinecolor=100,100,100`,
    `edgesettings=off,0,0,0,1`
  ].join("$");

  const src = `https://3dviewer.net/embed.html#${params}`;
  // Full, safe iframe element
  return `<iframe src="https://3dviewer.net/embed.html#${params}" allowfullscreen loading="lazy" style="width:100%;height:100%;border:0"></iframe>`;
  // If you want explicit allowfullscreen: add ` allowfullscreen`
}

// ------------------- dynamic content builders -----------------------
function buildOverviewTokens(info) {
  // Fallbacks so the page doesn't show raw tokens
  const today = todayISO();
  return {
    "{{PROJECT_TITLE}}": nz(info.projectTitle, ""),
    "{{CLIENT_NAME}}":   nz(info.clientName,  ""),
    "{{ISSUE_DATE}}":    nz(info.issueDate,   today),
    "{{EXPIRY_DATE}}":   nz(info.expiryDate,  ""),
    "{{OVERVIEW_TEXT}}": nz(info.overview,    "")
  };
}
function publicImg(leadId, sub, file) {
  return `/assets/leads/${encodeURIComponent(String(leadId))}/${sub}/${encodeURIComponent(file)}`;
}
function baseNameNoExt(f) {
  const dot = f.lastIndexOf(".");
  return dot >= 0 ? f.slice(0, dot) : f;
}
async function buildMaterials(leadId, repoRoot, info) {
  const dir = path.join(repoRoot, "assets", "leads", String(leadId), "materials");
  let files = [];
  try { files = await fs.readdir(dir); } catch {}
  const imgs = files.filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));

  const mats = Array.isArray(info.materials) ? info.materials : [];
  const firstMat = mats[0] || null;

  let firstThumb = "";
  if (imgs.length) {
    if (firstMat) {
      const match = imgs.find(f => baseNameNoExt(f).toLowerCase().startsWith(firstMat.name?.toLowerCase() || ""));
      firstThumb = match || imgs[0];
    } else {
      firstThumb = imgs[0];
    }
  }

  const tokens = {
    "{{MATERIAL_1_THUMB}}": firstThumb ? publicImg(leadId, "materials", firstThumb) : "",
    "{{MATERIAL_1_NAME}}":  firstMat ? nz(firstMat.name)  : (firstThumb ? baseNameNoExt(firstThumb) : ""),
    "{{MATERIAL_1_NOTES}}": firstMat ? nz(firstMat.notes) : ""
  };

  // Build remaining block
  if (mats.length > 1 && imgs.length) {
    const rest = mats.slice(1);
    const block = rest.map((m) => {
      const match = imgs.find(f => baseNameNoExt(f).toLowerCase().startsWith(nz(m.name).toLowerCase())) || imgs[0];
      const src   = publicImg(leadId, "materials", match);
      const alt   = nz(m.name) || baseNameNoExt(match);
      return (
        `<figure class="swatch-card">
           <img class="swatch-thumb" src="${src}" data-full="${src}" alt="${alt}"/>
           <figcaption class="swatch-caption"><strong>${nz(m.name)}</strong><br/><span>${nz(m.notes)}</span></figcaption>
         </figure>`
      );
    }).join("\n");
    tokens["{{MATERIAL_2_BLOCK}}"] = block;
  } else {
    tokens["{{MATERIAL_2_BLOCK}}"] = "";
  }

  return tokens;
}
async function buildHandles(leadId, repoRoot, info) {
  const dir = path.join(repoRoot, "assets", "leads", String(leadId), "handles");
  let files = [];
  try { files = await fs.readdir(dir); } catch {}
  const imgs = files.filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));

  const handles = Array.isArray(info.handles) ? info.handles : [];
  function card(h) {
    if (!imgs.length) return "";
    const match = imgs.find(f => baseNameNoExt(f).toLowerCase().startsWith(nz(h.name).toLowerCase())) || imgs[0];
    const src   = publicImg(leadId, "handles", match);
    const alt   = nz(h.name) || baseNameNoExt(match);
    return (
      `<figure class="swatch-card">
         <img class="swatch-thumb" src="${src}" data-full="${src}" alt="${alt}"/>
         <figcaption class="swatch-caption"><strong>${nz(h.name)}</strong><br/><span>${nz(h.finish)}</span></figcaption>
       </figure>`
    );
  }
  const h1 = handles[0] ? card(handles[0]) : "";
  const h2 = handles[1] ? card(handles[1]) : "";
  return { "{{HANDLE_1_BLOCK}}": h1, "{{HANDLE_2_BLOCK}}": h2 };
}
function buildPricing(info) {
  const pr = info.pricing || {};
  const currency = pr.currency || "£";
  const vatRate  = typeof pr.vatRate === "number" ? pr.vatRate : 0.2;
  const items    = Array.isArray(pr.items) ? pr.items : [];

  let subtotal = 0;
  const rows = items.map((it) => {
    const qty  = Number(it.qty || 0);
    const unit = Number(it.unit || 0);
    const line = Number(it.total != null ? it.total : qty * unit);
    subtotal += line;
    return (
      `<tr>
         <td>${nz(it.description)}</td>
         <td class="num">${qty.toFixed(2)}</td>
         <td class="num">${currency}${unit.toFixed(2)}</td>
         <td class="num">${currency}${line.toFixed(2)}</td>
       </tr>`
    );
  }).join("\n");

  const vat   = subtotal * vatRate;
  const total = subtotal + vat;

  return {
    "{{LINE_ITEMS_HTML}}": rows,
    "{{CURRENCY}}":        currency,
    "{{SUBTOTAL}}":        subtotal.toFixed(2),
    "{{VAT_AMOUNT}}":      vat.toFixed(2),
    "{{TOTAL}}":           total.toFixed(2)
  };
}

// ------------------------ versioned output --------------------------
async function nextVersionPath(outDir, leadId) {
  await ensureDir(outDir);
  const files = await listFiles(outDir);
  const re = new RegExp(`^${leadId}_v(\\d+)\\.html$`, "i");
  let max = 0;
  for (const f of files) {
    const m = f.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  return { version: next, filePath: path.join(outDir, `${leadId}_v${next}.html`) };
}

// ------------------------------ main --------------------------------
async function main() {
  const args = parseArgs(process.argv);
  const dataPath = args.data || args["data"];
  const tplPath  = args.tpl  || args["tpl"];
  const outDir   = args.out  || "quotes";

  if (!dataPath || !tplPath) {
    console.error("Usage: node scripts/generate-quote-advanced.js --data <info.json> --tpl <template.html> [--out quotes]");
    process.exit(1);
  }

  // Load data
  const info   = await loadJson(dataPath);
  const leadId = String(info.leadId || "").trim();
  if (!leadId) throw new Error("Missing leadId in info.json");

  // Compute repo root & public viewer folders
  const repoRoot     = path.resolve(__dirname, "..");
  const publicLead   = path.join(repoRoot, "assets", "leads", leadId);
  const doorsOnPath  = path.join(publicLead, "viewer_doors_on");
  const doorsOffPath = path.join(publicLead, "viewer_doors_off");

  // Build iframes
  const iframeOn  = await build3DViewerIframe({ leadId, state: "on",  viewerAbsPath: doorsOnPath  });
  const iframeOff = await build3DViewerIframe({ leadId, state: "off", viewerAbsPath: doorsOffPath });

  // Load template
  let tpl = await readText(tplPath);

  // ---------- static replacements ----------
  tpl = tpl
    .replaceAll("{{LEAD_ID}}", leadId)
    .replaceAll("{{THREED_IFRAME_URL_DOORS_ON}}",  iframeOn)
    .replaceAll("{{THREED_IFRAME_URL_DOORS_OFF}}", iframeOff);

  // ---------- dynamic sections ----------
  const overviewTokens = buildOverviewTokens(info);
  const materialTokens = await buildMaterials(leadId, repoRoot, info);
  const handleTokens   = await buildHandles(leadId, repoRoot, info);
  const pricingTokens  = buildPricing(info);

  tpl = bulkReplace(tpl, overviewTokens);
  tpl = bulkReplace(tpl, materialTokens);
  tpl = bulkReplace(tpl, handleTokens);
  tpl = bulkReplace(tpl, pricingTokens);

  // (Optional) set REVISION = version number
  const { version, filePath } = await nextVersionPath(outDir, leadId);
  tpl = tpl.replaceAll("{{REVISION}}", String(version));

  // Write out
  await ensureDir(path.dirname(filePath));
  await writeText(filePath, tpl);

  const publicHtmlUrl = `https://quotes.doozie.co/quotes/${leadId}_v${version}.html`;
  console.log(`\n✔ Quote generated: ${filePath}`);
  console.log(`✔ Public URL: ${publicHtmlUrl}\n`);
}

// Execute
main().catch(err => {
  console.error("Generator failed:", err?.message || err);
  process.exit(1);
});