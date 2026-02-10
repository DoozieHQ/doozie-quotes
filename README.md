# Doozie Quotes

Generate branded, interactive quote pages (HTML) with images, square swatches, and a 3D viewer.  
Automates:
- pulling client details from **Kommo** (lead + primary contact)
- auto-discovering 3D assets committed in the repo
- building **RAW GitHub** URLs for 3dviewer.net
- generating `/quotes/<LEAD_ID>_vN.html`
- PATCHing Kommo "Latest Quote URL" back to the lead
- deploying via GitHub → **Vercel** (auto)

## Prerequisites
- Node 20+
- Git
- (Optional) ImageMagick if you use `sync-assets.js` to download/thumbnail external images

## Setup
1. `cp .env.example .env` and fill values.
2. `npm i`
3. Add assets under `assets/leads/<LEAD_ID>/...`
4. Create/edit `data/quotes/<LEAD_ID>.json` (content only; client details come from Kommo).
5. Run build:
   ```bash
   node scripts/generate-quote-local.js --data data/quotes/12345678.json --tpl templates/quote.html.tpl --out quotes