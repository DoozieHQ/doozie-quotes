#!/usr/bin/env node
/**
 * DOOZIE CLI UPLOADER — INLINE-EDIT + KEEP/REPLACE (Bulletproof Menu)
 * -------------------------------------------------------------------
 * ✔ Multi-select Windows file picker (WinForms + PowerShell -STA)
 * ✔ Stores everything under:   /data/quotes/<LEAD_ID>/assets
 * ✔ Validates exactly 1 .3ds model in each viewer
 * ✔ Extracts ZIPs automatically
 * ✔ "Keep or Replace" for Doors ON/OFF, Materials, Handles (clears folder on replace)
 * ✔ Post-import guard: if multiple .3ds exist, pick one to keep & delete others
 * ✔ Builds & saves info.json (review/keep/edit)
 * ✔ Inline multiline editor (no Notepad) — finish with a line containing only: END
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
import { exec } from "child_process";
import { fileURLToPath } from "url";
import readline from "readline";

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
    exec(cmd, (err, stdout) => {
      try { fs.unlinkSync(psPath); } catch {}
      if (err) return resolve({ ok:false, out:"" });
      resolve({ ok:true, out:String(stdout || "").trim() });
    });
  });
}

/** Multi file picker (Windows Forms OpenFileDialog) */
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

function analyzeViewerFolder(folder) {
  const files = fs.readdirSync(folder);
  return {
    models: files.filter(f => f.toLowerCase().endsWith(".3ds")),
    textures: files.filter(f => /\.(jpg|jpeg|png)$/i.test(f)),
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

// ── Remove spaces from 3ds file ─────────────────────────────────────────────
async function normalizeModelFilename(viewerDir) {
  const files = await fs.readdir(viewerDir);
  const models = files.filter(f => f.toLowerCase().endsWith(".3ds"));
  if (models.length !== 1) return;

  const current = models[0];

  if (!/\s/.test(current)) return;

  const normalized = current.replace(/\s+/g, "_");
  if (normalized === current) return;

  await fs.move(
    path.join(viewerDir, current),
    path.join(viewerDir, normalized),
    { overwrite: true }
  );
  console.log(chalk.green(`✓ Normalized model name: ${current} → ${normalized}`));
}
// ─────────────────────────────────────────────────────────────────────────────

/* -------------------------------------------------------------------------- */
/*   Bulletproof Manual Menus (re‑prompt until valid)                          */
/* -------------------------------------------------------------------------- */

function printMenu(title, options) {
  console.log(chalk.cyan(`\n${title}`));
  options.forEach((opt, i) => {
    console.log(`${i + 1}) ${opt.label}`);
  });
}

async function askMenu(title, options, { prompt = "Enter choice:", allowBlank = false } = {}) {
  while (true) {
    printMenu(title, options);

    const answer = await new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(chalk.green(`${prompt} `), (line) => {
        rl.close();
        resolve(line.trim());
      });
    });

    if (allowBlank && !answer) return null;

    const idx = parseInt(answer, 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= options.length) {
      return options[idx - 1].value;
    }

    console.log(chalk.red("Invalid option. Please enter a valid number from the list."));
  }
}

/* -------------------------------------------------------------------------- */
/*   Inline Editing Helpers (no external editor)                               */
/* -------------------------------------------------------------------------- */

/** Inline multiline prompt — finish input by typing a line containing only: END */
async function promptMultiline({ message, initial = "" }) {
  console.log(chalk.green(message));
  console.log(chalk.gray("Type your text. Finish by entering a single line with END and press Enter."));
  if (initial) {
    console.log(chalk.gray("\nCurrent text:\n----------------"));
    console.log(initial);
    console.log(chalk.gray("----------------"));
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];

  await new Promise((resolve) => {
    rl.on("line", (line) => {
      if (line.trim() === "END") {
        rl.close();
      } else {
        lines.push(line);
      }
    });
    rl.on("close", resolve);
  });

  return lines.join("\n");
}

/** Review or edit a single text field (menu + inline editor for multiline) */
async function reviewOrEditTextField({ label, current, multiline = false }) {
  console.log(chalk.cyan(`\n${label}:`));
  console.log(current ? chalk.white(current) : chalk.gray("(empty)"));

  const action = await askMenu(
    `${label} — choose an action:`,
    [
      { label: "Keep existing", value: "keep" },
      { label: "Edit",          value: "edit" }
    ]
  );

  if (action === "keep") return current ?? "";

  if (multiline) {
    const value = await promptMultiline({
      message: `Edit ${label} (finish with a line containing only: END)`,
      initial: current || ""
    });
    return value ?? "";
  }

  const { value } = await inquirer.prompt([
    {
      type: "input",
      name: "value",
      message: chalk.green(`Edit ${label}:`),
      default: current || ""
    }
  ]);
  return value ?? "";
}

/** Materials review/edit based on images present in /materials (prefix match) */
async function reviewMaterials({ current, imageFiles }) {
  let materials = Array.isArray(current) ? [...current] : [];

  // Review existing
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    console.log(chalk.cyan(`\nMaterial #${i + 1}:`));
    console.log(`Name : ${chalk.white(m.name || "")}`);
    console.log(`Notes: ${chalk.white(m.notes || "")}`);

    const action = await askMenu(
      "Choose an action:",
      [
        { label: "Keep",        value: "keep" },
        { label: "Edit name",   value: "editName" },
        { label: "Edit notes",  value: "editNotes" },
        { label: "Delete",      value: "delete" }
      ]
    );

    if (action === "delete") {
      materials.splice(i, 1);
      i--;
      continue;
    }
    if (action === "editName") {
      const { name } = await inquirer.prompt([
        { type: "input", name: "name", message: "New name:", default: m.name || "" }
      ]);
      m.name = String(name || "").trim();
    }
    if (action === "editNotes") {
      const { notes } = await inquirer.prompt([
        { type: "input", name: "notes", message: "New notes:", default: m.notes || "" }
      ]);
      m.notes = String(notes || "").trim();
    }
  }

  // Detect new images with no matching entry (prefix, case-insensitive)
  const names = materials.map(x => (x.name || "").toLowerCase()).filter(Boolean);
  const pending = imageFiles.filter(f => {
    const base = path.basename(f, path.extname(f)).toLowerCase();
    return !names.some(n => n && base.startsWith(n));
  });

  for (const f of pending) {
    const base = path.basename(f, path.extname(f));
    console.log(chalk.yellow(`\nNew material image found: ${f}`));

    const add = await askMenu(
      `Add material entry for "${base}"?`,
      [
        { label: "Yes", value: true  },
        { label: "No",  value: false }
      ]
    );
    if (!add) continue;

    const { name, notes } = await inquirer.prompt([
      { type: "input", name: "name",  message: "Material name:",   default: base },
      { type: "input", name: "notes", message: "Notes (optional):", default: "" }
    ]);
    materials.push({ name: String(name || "").trim(), notes: String(notes || "").trim() });
  }

  return materials;
}

/** Handles review/edit based on images present in /handles (prefix match) */
async function reviewHandles({ current, imageFiles }) {
  let handles = Array.isArray(current) ? [...current] : [];

  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    console.log(chalk.cyan(`\nHandle #${i + 1}:`));
    console.log(`Name  : ${chalk.white(h.name || "")}`);
    console.log(`Finish: ${chalk.white(h.finish || "")}`);

    const action = await askMenu(
      "Choose an action:",
      [
        { label: "Keep",         value: "keep" },
        { label: "Edit name",    value: "editName" },
        { label: "Edit finish",  value: "editFinish" },
        { label: "Delete",       value: "delete" }
      ]
    );

    if (action === "delete") {
      handles.splice(i, 1);
      i--;
      continue;
    }
    if (action === "editName") {
      const { name } = await inquirer.prompt([
        { type: "input", name: "name", message: "New name:", default: h.name || "" }
      ]);
      h.name = String(name || "").trim();
    }
    if (action === "editFinish") {
      const { finish } = await inquirer.prompt([
        { type: "input", name: "finish", message: "New finish:", default: h.finish || "" }
      ]);
      h.finish = String(finish || "").trim();
    }
  }

  const names = handles.map(x => (x.name || "").toLowerCase()).filter(Boolean);
  const pending = imageFiles.filter(f => {
    const base = path.basename(f, path.extname(f)).toLowerCase();
    return !names.some(n => n && base.startsWith(n));
  });

  for (const f of pending) {
    const base = path.basename(f, path.extname(f));
    console.log(chalk.yellow(`\nNew handle image found: ${f}`));

    const add = await askMenu(
      `Add handle entry for "${base}"?`,
      [
        { label: "Yes", value: true  },
        { label: "No",  value: false }
      ]
    );
    if (!add) continue;

    const { name, finish } = await inquirer.prompt([
      { type: "input", name: "name",   message: "Handle name:",  default: base },
      { type: "input", name: "finish", message: "Finish:",        default: "" }
    ]);
    handles.push({ name: String(name || "").trim(), finish: String(finish || "").trim() });
  }

  return handles;
}

/** If >1 model exists, let user choose one to keep and delete the rest (menu) */
async function ensureSingleModel(viewerDir, label) {
  const files = fs.readdirSync(viewerDir);
  const models = files.filter(f => f.toLowerCase().endsWith(".3ds"));
  if (models.length <= 1) return;

  const choice = await askMenu(
    `Multiple .3ds models detected in ${label} — select the one to keep:`,
    models.map(m => ({ label: m, value: m }))
  );

  const toDelete = models.filter(m => m !== choice);
  for (const del of toDelete) {
    await fs.remove(path.join(viewerDir, del));
  }
  console.log(chalk.green(`✓ Kept: ${choice}`));
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
  console.log(chalk.magentaBright("Uploader build: inline-edit + keep/replace (manual menus)"));

  /* --------------------------- LEAD ID --------------------------- */
  const { leadId } = await inquirer.prompt([
    {
      name: "leadId",
      type: "input",
      message: chalk.green("Enter the Kommo Lead ID:"),
      validate: x => (x.trim() ? true : "Lead ID required")
    }
  ]);

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
  console.log(chalk.yellow("\nSTEP — Doors ON Viewer"));

  const existingOn = fs.existsSync(viewerOnDir) ? fs.readdirSync(viewerOnDir) : [];
  if (existingOn.length > 0) {
    const choiceOn = await askMenu(
      `Use existing Doors ON viewer or import new? (Found ${existingOn.length} existing file(s))`,
      [
        { label: "Keep existing",                 value: "keep" },
        { label: "Load new (clear old files)",   value: "new"  }
      ]
    );

    if (choiceOn === "new") {
      await fs.emptyDir(viewerOnDir);
      console.log(chalk.yellow("Select Doors ON viewer files (multi-select)"));
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
      await normalizeModelFilename(viewerOnDir);
    } else {
      console.log(chalk.green("✓ Keeping existing Doors ON assets"));
    }
  } else {
    console.log(chalk.yellow("No existing Doors ON assets — please select viewer files"));
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
    await normalizeModelFilename(viewerOnDir);
  }

  await ensureSingleModel(viewerOnDir, "Doors ON");
  const onCheck = analyzeViewerFolder(viewerOnDir);
  if (onCheck.models.length !== 1) {
    console.log(chalk.red(`ERROR: Doors ON must contain exactly 1 .3ds file after import. Found: ${onCheck.models.length}`));
    process.exit(1);
  }

  /* ------------------------ Doors OFF Viewer ---------------------- */
  console.log(chalk.yellow("\nSTEP — Doors OFF Viewer"));

  const existingOff = fs.existsSync(viewerOffDir) ? fs.readdirSync(viewerOffDir) : [];
  if (existingOff.length > 0) {
    const choiceOff = await askMenu(
      `Use existing Doors OFF viewer or import new? (Found ${existingOff.length} existing file(s))`,
      [
        { label: "Keep existing",                 value: "keep" },
        { label: "Load new (clear old files)",   value: "new"  }
      ]
    );

    if (choiceOff === "new") {
      await fs.emptyDir(viewerOffDir);
      console.log(chalk.yellow("Select Doors OFF viewer files (multi-select)"));
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
      // BUGFIX: normalize the OFF directory
      await normalizeModelFilename(viewerOffDir);
    } else {
      console.log(chalk.green("✓ Keeping existing Doors OFF assets"));
    }
  } else {
    console.log(chalk.yellow("No existing Doors OFF assets — please select viewer files"));
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
    await normalizeModelFilename(viewerOffDir);
  }

  await ensureSingleModel(viewerOffDir, "Doors OFF");
  const offCheck = analyzeViewerFolder(viewerOffDir);
  if (offCheck.models.length !== 1) {
    console.log(chalk.red(`ERROR: Doors OFF must contain exactly 1 .3ds file after import. Found: ${offCheck.models.length}`));
    process.exit(1);
  }

  /* ---------------------------- Materials -------------------------- */
  console.log(chalk.yellow("\nSTEP — Materials"));

  const existingMatImgs = fs.readdirSync(matsDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  if (existingMatImgs.length > 0) {
    const materialChoice = await askMenu(
      `Use existing materials (${existingMatImgs.length} imgs) or load new?`,
      [
        { label: "Keep existing",               value: "keep" },
        { label: "Load new (clear folder)",     value: "new"  }
      ]
    );

    if (materialChoice === "new") {
      await fs.emptyDir(matsDir);
      console.log(chalk.yellow("Select material files (multi-select)"));
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
    } else {
      console.log(chalk.green("✓ Keeping existing material images"));
    }
  } else {
    console.log(chalk.yellow("No existing materials — select images (optional, press Cancel to skip)"));
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
  }

  /* ----------------------------- Handles --------------------------- */
  console.log(chalk.yellow("\nSTEP — Handles"));

  const existingHandleImgs = fs.readdirSync(hndlDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  if (existingHandleImgs.length > 0) {
    const handleChoice = await askMenu(
      `Use existing handles (${existingHandleImgs.length} imgs) or load new?`,
      [
        { label: "Keep existing",               value: "keep" },
        { label: "Load new (clear folder)",     value: "new"  }
      ]
    );

    if (handleChoice === "new") {
      await fs.emptyDir(hndlDir);
      console.log(chalk.yellow("Select handle files (multi-select)"));
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
    } else {
      console.log(chalk.green("✓ Keeping existing handle images"));
    }
  } else {
    console.log(chalk.yellow("No existing handles — select images (optional, press Cancel to skip)"));
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
  }

  /* ---------------------------- info.json -------------------------- */
  console.log(chalk.yellow("\nSTEP — Build info.json"));

  const infoPath = path.join(repoRoot, "data", "quotes", leadId, "info.json");
  const info = loadInfo(infoPath);

  info.leadId = leadId;

  // ---- PROJECT TITLE (review/edit) ----
  info.projectTitle = await reviewOrEditTextField({
    label: "Project Title",
    current: info.projectTitle,
    multiline: false
  });

  // ---- OVERVIEW (review/edit, multiline — inline) ----
  info.overview = await reviewOrEditTextField({
    label: "Overview (Markdown allowed)",
    current: info.overview,
    multiline: true
  });

  // ---- MATERIALS (review/edit/keep/add/delete based on folder) ----
  const matImgsNow = fs.readdirSync(matsDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  info.materials = await reviewMaterials({
    current: info.materials || [],
    imageFiles: matImgsNow
  });

  // ---- HANDLES (review/edit/keep/add/delete based on folder) ----
  const hImgsNow = fs.readdirSync(hndlDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  info.handles = await reviewHandles({
    current: info.handles || [],
    imageFiles: hImgsNow
  });

  saveInfo(infoPath, info);
  console.log(chalk.green("\n✔ info.json saved"));

  /* ---------------------------- Post-viewer Guard -------------------------- */
  // Ensure each viewer has exactly one model (final safeguard)
  await ensureSingleModel(viewerOnDir, "Doors ON");
  await ensureSingleModel(viewerOffDir, "Doors OFF");

  /* ---------------------------- Generate --------------------------- */
  const runGen = await askMenu(
    "Run generator now?",
    [
      { label: "Yes", value: true  },
      { label: "No",  value: false }
    ]
  );

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
  ➤ Commit assets and the new HTML to publish:
        git add .
        git commit -m "Publish lead ${leadId}"
        git push

Remember: the public URL goes live after push, e.g.:
  https://quotes.doozie.co/quotes/<LEAD_ID>_v<REV>.html

All done! 🚀
`);
    });
  }

})();