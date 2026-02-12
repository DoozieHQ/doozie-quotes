#!/usr/bin/env node
/**
 * DOOZIE CLI UPLOADER — FINAL VERSION (A/A/A)
 * -------------------------------------------
 * ✔ Multi-select Windows file picker (WinForms + PowerShell -STA)
 * ✔ Stores everything under:   /data/quotes/<LEAD_ID>/assets
 * ✔ Validates exactly 1 .3ds model in each viewer
 * ✔ Extracts ZIPs automatically
 * ✔ Builds & saves info.json
 * ✔ Runs generate-quote-advanced.js
 *
 * Works on Windows 10/11, PowerShell 5.1, Node 18+
 */

import fs from "fs-extra";
import path from "path";
import os from "os";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import AdmZip from "adm-zip";
import { exec, execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* -------------------------------------------------------------------------- */
/*   PowerShell Picker Helpers (Multi-file & topmost owner window)            */
/* -------------------------------------------------------------------------- */

function writeTempPs(content) {
  const p = path.join(
    os.tmpdir(),
    `doozie_ps_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`
  );
  fs.writeFileSync(p, content, "utf8");
  return p;
}

function runPsFile(psPath) {
  return new Promise(resolve => {
    const cmd = `powershell.exe -NoProfile -STA -File "${psPath}"`;
    exec(cmd, (err, stdout, stderr) => {
      try { fs.unlinkSync(psPath); } catch {}
      if (err) return resolve({ ok:false, out:"" });
      resolve({ ok:true, out:String(stdout || "").trim() });
    });
  });
}

/** Multi file picker */
async function pickFilesMulti({ filter }) {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$top = New-Object System.Windows.Forms.Form
$top.TopMost = $true
$top.ShowInTaskbar = $false
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Filter = "${filter}"
$dlg.Multiselect = $true
# Show and return selection
if ($dlg.ShowDialog($top) -eq "OK") {
  $dlg.FileNames -join [Environment]::NewLine
}
$top.Dispose()
`.replace(/\r?\n/g, "\r\n");

  const psPath = writeTempPs(ps);
  const { ok, out } = await runPsFile(psPath);
  if (!ok || !out) return [];
  return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/*   Utility Functions                                                        */
/* -------------------------------------------------------------------------- */

async function ensureDir(p) {
  await fs.ensureDir(p);
  return p;
}

async function copyWithSpinner(src, dest, label) {
  const spinner = ora(`Copying ${label}...`).start();
  try {
    await fs.copy(src, dest, { overwrite: true });
    spinner.succeed(`${label} copied`);
  } catch (e) {
    spinner.fail(`Failed to copy ${label}`);
    throw e;
  }
}

function analyzeViewerFolder(folder) {
  const files = fs.readdirSync(folder);
  return {
    models: files.filter(f => f.toLowerCase().endsWith(".3ds")),
    textures: files.filter(f => /\.(jpg|jpeg|png)$/i.test(f)),
    shortNames: files.filter(f => /~\d+\./.test(f))
  };
}

async function processMultiSelection({ files, targetDir, label }) {
  await ensureDir(targetDir);

  const zips = files.filter(f => f.toLowerCase().endsWith(".zip"));
  const normals = files.filter(f => !f.toLowerCase().endsWith(".zip"));

  // Extract ZIPs
  for (const z of zips) {
    const spinner = ora(`Extracting ZIP for ${label}: ${path.basename(z)}...`).start();
    try {
      const zip = new AdmZip(z);
      zip.extractAllTo(targetDir, true);
      spinner.succeed(`Extracted ${path.basename(z)}`);
    } catch (e) {
      spinner.fail(`Failed ZIP: ${path.basename(z)}`);
      throw e;
    }
  }

  // Copy non-ZIP
  if (normals.length) {
    const spinner = ora(`Copying ${label} files...`).start();
    try {
      for (const f of normals) {
        await fs.copy(f, path.join(targetDir, path.basename(f)), { overwrite:true });
      }
      spinner.succeed(`${normals.length} files copied`);
    } catch (e) {
      spinner.fail(`Copy failed`);
      throw e;
    }
  }
}

function loadInfo(infoPath) {
  if (!fs.existsSync(infoPath)) {
    return {
      leadId: "",
      projectTitle: "",
      overview: "",
      materials: [],
      handles: [],
      pricing: { currency:"£", items:[], vatRate:0.2 }
    };
  }
  return JSON.parse(fs.readFileSync(infoPath, "utf8"));
}

function saveInfo(infoPath, data) {
  fs.ensureDirSync(path.dirname(infoPath));
  fs.writeFileSync(infoPath, JSON.stringify(data, null, 2));
}

/* -------------------------------------------------------------------------- */
/*   MAIN Uploader Flow                                                       */
/* -------------------------------------------------------------------------- */

(async function main() {
  console.log(
    chalk.cyanBright(`
===========================================
     DOOZIE QUOTE ASSET IMPORT TOOL
===========================================
`)
  );

  /* --------------------------- LEAD ID --------------------------- */
  const { leadId } = await inquirer.prompt([
    {
      name: "leadId",
      type: "input",
      message: chalk.green("Enter the Kommo Lead ID:"),
      validate: x => (x.trim() ? true : "Lead ID required")
    }
  ]);

  // Correct repo‑root paths:
  const repoRoot = path.resolve(__dirname, "..");
  const baseAssets = path.join(repoRoot, "data", "quotes", leadId, "assets");

  const viewerOnDir  = path.join(baseAssets, "viewer_doors_on");
  const viewerOffDir = path.join(baseAssets, "viewer_doors_off");
  const matsDir      = path.join(baseAssets, "materials");
  const hndlDir      = path.join(baseAssets, "handles");

  await ensureDir(viewerOnDir);
  await ensureDir(viewerOffDir);
  await ensureDir(matsDir);
  await ensureDir(hndlDir);

  console.log(chalk.gray("\nAssets will be saved to:"));
  console.log(chalk.white(baseAssets));

  /* ------------------------ Doors ON Viewer ----------------------- */
  console.log(chalk.yellow("\nSTEP — Select Doors ON viewer files (multi-select)"));

  const viewerOnFiles = await pickFilesMulti({
    filter: "3D/ZIP (*.3ds;*.jpg;*.jpeg;*.png;*.zip)|*.3ds;*.jpg;*.jpeg;*.png;*.zip|All files (*.*)|*.*"
  });

  if (!viewerOnFiles.length) {
    console.log(chalk.red("No files selected for Doors ON"));
    process.exit(1);
  }

  await processMultiSelection({
    files: viewerOnFiles,
    targetDir: viewerOnDir,
    label: "Viewer (Doors ON)"
  });

  const onCheck = analyzeViewerFolder(viewerOnDir);
  if (onCheck.models.length !== 1) {
    console.log(chalk.red(`ERROR: Doors ON must contain exactly 1 .3ds file after import. Found: ${onCheck.models.length}`));
    process.exit(1);
  }

  /* ------------------------ Doors OFF Viewer ---------------------- */
  console.log(chalk.yellow("\nSTEP — Select Doors OFF viewer files (multi-select)"));

  const viewerOffFiles = await pickFilesMulti({
    filter: "3D/ZIP (*.3ds;*.jpg;*.jpeg;*.png;*.zip)|*.3ds;*.jpg;*.jpeg;*.png;*.zip|All files (*.*)|*.*"
  });

  if (!viewerOffFiles.length) {
    console.log(chalk.red("No files selected for Doors OFF"));
    process.exit(1);
  }

  await processMultiSelection({
    files: viewerOffFiles,
    targetDir: viewerOffDir,
    label: "Viewer (Doors OFF)"
  });

  const offCheck = analyzeViewerFolder(viewerOffDir);
  if (offCheck.models.length !== 1) {
    console.log(chalk.red(`ERROR: Doors OFF must contain exactly 1 .3ds file after import. Found: ${offCheck.models.length}`));
    process.exit(1);
  }

  /* ---------------------------- Materials -------------------------- */
  console.log(chalk.yellow("\nSTEP — Select Material files (multi-select)"));

  const matFiles = await pickFilesMulti({
    filter: "Images/ZIP (*.jpg;*.jpeg;*.png;*.zip)|*.jpg;*.jpeg;*.png;*.zip|All files (*.*)|*.*"
  });

  if (matFiles.length) {
    await processMultiSelection({
      files: matFiles,
      targetDir: matsDir,
      label: "Materials"
    });
  }

  /* ----------------------------- Handles --------------------------- */
  console.log(chalk.yellow("\nSTEP — Select Handle files (multi-select)"));

  const hndlFiles = await pickFilesMulti({
    filter: "Images/ZIP (*.jpg;*.jpeg;*.png;*.zip)|*.jpg;*.jpeg;*.png;*.zip|All files (*.*)|*.*"
  });

  if (hndlFiles.length) {
    await processMultiSelection({
      files: hndlFiles,
      targetDir: hndlDir,
      label: "Handles"
    });
  }

  /* ---------------------------- info.json -------------------------- */
  console.log(chalk.yellow("\nSTEP — Build info.json"));

  const infoPath = path.join(repoRoot, "data", "quotes", leadId, "info.json");
  const info = loadInfo(infoPath);

  info.leadId = leadId;

  const { projectTitle } = await inquirer.prompt([
    {
      name: "projectTitle",
      type: "input",
      message: chalk.green("Project Title (Enter to keep existing):"),
      default: info.projectTitle || ""
    }
  ]);

  const { overview } = await inquirer.prompt([
    {
      name: "overview",
      type: "editor",
      message: chalk.green("Overview (Markdown allowed):"),
      default: info.overview || ""
    }
  ]);

  info.projectTitle = projectTitle;
  info.overview     = overview;

  // Auto-material entries
  const matImgs = fs.readdirSync(matsDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  if (matImgs.length) {
    const { autoM } = await inquirer.prompt([
      {
        type:"confirm",
        name:"autoM",
        message:`Auto-create material entries for ${matImgs.length} files?`,
        default:true
      }
    ]);
    if (autoM) {
      info.materials = matImgs.map(f => ({
        name: path.basename(f, path.extname(f)),
        notes: ""
      }));
    }
  }

  // Auto-handle entries
  const hImgs = fs.readdirSync(hndlDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  if (hImgs.length) {
    const { autoH } = await inquirer.prompt([
      {
        type:"confirm",
        name:"autoH",
        message:`Auto-create handle entries for ${hImgs.length} files?`,
        default:true
      }
    ]);
    if (autoH) {
      info.handles = hImgs.map(f => ({
        name: path.basename(f, path.extname(f)),
        finish: ""
      }));
    }
  }

  saveInfo(infoPath, info);
  console.log(chalk.green("\n✔ info.json saved"));

  /* ---------------------------- Generate --------------------------- */
  const { runGen } = await inquirer.prompt([
    {
      type:"confirm",
      name:"runGen",
      message:"Run generator now?",
      default:true
    }
  ]);

  if (runGen) {
    const cmd = `node scripts/generate-quote-advanced.js --data ${infoPath} --tpl templates/quote.html.tpl --out quotes`;
    console.log(chalk.blue(`\nRunning: ${cmd}\n`));

    const spinner = ora("Generating quote...").start();

    exec(cmd, (err, stdout, stderr) => {
      spinner.stop();
      if (err) {
        console.log(chalk.red("✖ Generator failed"));
        console.log(err.message);
        return;
      }

      console.log(chalk.green("✔ Quote generated successfully!\n"));

      if (stdout) console.log(chalk.gray(stdout));
      if (stderr) console.log(chalk.yellow(stderr));

      console.log(`
Next steps:
  ➤ Commit assets:
        git add .
        git commit -m "Added assets for lead ${leadId}"
        git push

All done! 🚀
`);
    });
  }

})();