// scripts/list-fields.js
//
// Usage:
//   node scripts/list-fields.js --entity leads
//   node scripts/list-fields.js --entity contacts
//   node scripts/list-fields.js --entity companies
//
// Optional flags:
//   --json               Print full JSON
//   --save json|csv      Save to .json or .csv
//   --file output.ext    File path when using --save
//
// Required environment variables:
//   KOMMO_SUBDOMAIN
//   KOMMO_TOKEN
//
// This uses Kommo’s official API endpoint:
// GET /api/v4/<entity>/custom_fields
//
// Reference: Kommo API — Custom Fields
// https://developers.kommo.com/reference/custom-fields
// (This endpoint returns id, name, code, type, etc.)  ([1](https://nova-kommo.com/widgets_list))

import 'dotenv/config';
import fetch from "node-fetch";
import fs from "node:fs/promises";
import path from "node:path";

function arg(flag, fallback=null) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i+1]) return process.argv[i+1];
  return fallback;
}

function assertEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

function validEntity(e) {
  const allowed = ["leads", "contacts", "companies"];
  if (!allowed.includes(e)) {
    console.error(`❌ Invalid entity "${e}". Must be one of: leads, contacts, companies`);
    process.exit(1);
  }
  return e;
}

async function fetchFields(sub, token, entity) {
  const url = `https://${sub}.kommo.com/api/v4/${entity}/custom_fields`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`❌ Failed to fetch custom fields: ${res.status} ${text}`);
  }

  const json = await res.json();
  return json?._embedded?.custom_fields || [];
}

function toRows(fields) {
  return fields.map(f => ({
    field_id: f.id,
    name: f.name,
    code: f.code || "",
    type: f.type || ""
  }));
}

function printTable(rows) {
  if (!rows.length) {
    console.log("No custom fields found.");
    return;
  }

  const headers = ["field_id", "name", "code", "type"];
  const widths = headers.map(h => h.length);

  const data = rows.map(r => [
    String(r.field_id),
    String(r.name || ""),
    String(r.code || ""),
    String(r.type || "")
  ]);

  for (const row of data) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], cell.length);
    });
  }

  const headerLine = headers.map((h,i) => h.padEnd(widths[i])).join(" | ");
  const divider = widths.map(w => "-".repeat(w)).join("-|-");

  console.log(headerLine);
  console.log(divider);
  data.forEach(row => {
    console.log(row.map((c,i) => c.padEnd(widths[i])).join(" | "));
  });
}

function toCSV(rows) {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  const header = ["field_id","name","code","type"].map(esc).join(',');
  const body = rows
    .map(r => [r.field_id, r.name||'', r.code||'', r.type||''].map(esc).join(','))
    .join('\n');

  return header + "\n" + body + "\n";
}

(async () => {
  const entity = validEntity(arg("--entity", "leads"));
  const saveType = arg("--save");
  const savePath = arg("--file");

  const sub = assertEnv("KOMMO_SUBDOMAIN");
  const tok = assertEnv("KOMMO_TOKEN");

  console.error(`🔍 Fetching ${entity} custom fields from ${sub}...`);

  const fields = await fetchFields(sub, tok, entity);
  const rows = toRows(fields);

  printTable(rows);

  if (process.argv.includes("--json")) {
    console.log("\n// Full JSON output\n");
    console.log(JSON.stringify(fields, null, 2));
  }

  if (saveType && savePath) {
    const abs = path.resolve(savePath);
    if (saveType === "json") {
      await fs.writeFile(abs, JSON.stringify(rows, null, 2), "utf8");
      console.log(`💾 Saved JSON → ${abs}`);
    } else if (saveType === "csv") {
      await fs.writeFile(abs, toCSV(rows), "utf8");
      console.log(`💾 Saved CSV → ${abs}`);
    } else {
      console.error("❌ Use --save json or --save csv");
    }
  }
})();
