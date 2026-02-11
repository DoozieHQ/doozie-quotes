import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';
import { exec as _exec } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(_exec);

function arg(name, fallback=null){ const i = process.argv.indexOf(name); return (i!==-1 && process.argv[i+1]) ? process.argv[i+1] : fallback; }
async function ensureDir(p){ await fs.mkdir(p, { recursive:true }); }
function baseName(url){ return decodeURIComponent(String(url).split('/').pop() || 'img.jpg'); }

async function download(url, dest){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await ensureDir(path.dirname(dest));
  await fs.writeFile(dest, buf);
}

async function makeThumb(input, output, { width=null, square=false }={}){
  try{
    await ensureDir(path.dirname(output));
    if (square) {
      // center crop square then resize ~512
      await exec(`magick convert "${input}" -auto-orient -gravity center -extent %[fx:min(w,h)]x%[fx:min(w,h)] -resize 512x512 "${output}"`);
    } else if (width) {
      await exec(`magick convert "${input}" -auto-orient -resize ${width} "${output}"`);
    } else {
      await fs.copyFile(input, output);
    }
  }catch(e){
    // if ImageMagick absent, just copy
    await fs.copyFile(input, output);
  }
}

(async function main(){
  const dataPath = arg('--data'); const root = arg('--root');
  if (!dataPath || !root){ console.error('Usage: node scripts/sync-assets.js --data data/quotes/<LEAD_ID>.json --root assets/leads/<LEAD_ID>/'); process.exit(1); }

  const data = JSON.parse(await fs.readFile(path.resolve(dataPath), 'utf8'));

  async function syncOne(obj, folder, square=false){
    if (!obj?.source) return obj;
    const name = baseName(obj.source);
    const fullPath = path.join(root, folder, name);
    await download(obj.source, fullPath);
    const thumbPath = path.join(root, folder, square ? `thumb-${name}` : `thumb-${name}`);
    await makeThumb(fullPath, thumbPath, { width: square ? null : 1024, square });
    return {
      thumb: `/${path.posix.join(...thumbPath.split(path.sep))}`,
      full:  `/${path.posix.join(...fullPath.split(path.sep))}`,
      alt: obj.alt || ''
    };
  }

  // Doors on/off
  if (data.images?.doorsOn?.source)  data.images.doorsOn  = await syncOne(data.images.doorsOn,  'images', false);
  if (data.images?.doorsOff?.source) data.images.doorsOff = await syncOne(data.images.doorsOff, 'images', false);

  // Materials
  if (Array.isArray(data.materials)) {
    for (let i=0;i<data.materials.length;i++){
      if (data.materials[i]?.source) {
        const synced = await syncOne(data.materials[i], 'swatches', true);
        data.materials[i] = { ...data.materials[i], ...synced, source: undefined };
      }
    }
  }

  // Handles
  if (Array.isArray(data.handles)) {
    for (let i=0;i<data.handles.length;i++){
      if (data.handles[i]?.source) {
        const synced = await syncOne(data.handles[i], 'swatches', true);
        data.handles[i] = { ...data.handles[i], ...synced, source: undefined };
      }
    }
  }

  await fs.writeFile(path.resolve(dataPath), JSON.stringify(data, null, 2), 'utf8');
  console.log('✔ Assets synced and JSON updated');
})();