"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { verifyRuntimeBuild } = require("./verify-runtime-build");
const { rejectLinks, sha256 } = require("./build-runtime");

function deployRuntimeBuild({ rootDir = path.resolve(__dirname, ".."), outputDir = path.join(rootDir, ".build/runtime") } = {}) {
  if (process.platform === "win32") {
    const processes = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "@(Get-Process -Name VOTC -ErrorAction SilentlyContinue).Count"], { encoding: "utf8", windowsHide: true });
    if (processes.status !== 0 || !/^0\s*$/.test(processes.stdout)) throw new Error("build_close_votc_before_deploy");
  }
  const manifest = verifyRuntimeBuild({ rootDir, outputDir });
  const appDir = path.join(rootDir, "resources/app");
  rejectLinks(appDir);
  const changes = manifest.files.map(item => {
    const destination = path.join(appDir, item.path);
    rejectLinks(destination);
    const previous = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
    return { ...item, destination, previous };
  }).filter(item => !item.previous || sha256(item.previous) !== item.sha256);
  const backupDir = changes.length ? fs.mkdtempSync(path.join(os.tmpdir(), "votc-v91-code-backup-")) : null;
  if (backupDir) {
    for (const item of changes) {
      if (!item.previous) continue;
      const file = path.join(backupDir, item.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, item.previous);
      if (sha256(fs.readFileSync(file)) !== sha256(item.previous)) throw new Error("build_backup_hash_mismatch");
    }
    fs.writeFileSync(path.join(backupDir, "backup-manifest.json"), JSON.stringify(changes.map(item => ({ path: item.path, previousSha256: item.previous ? sha256(item.previous) : null })), null, 2));
  }
  const written = [];
  try {
    for (const item of changes) {
      const bytes = fs.readFileSync(path.join(outputDir, "app", item.path));
      if (sha256(bytes) !== item.sha256) throw new Error("build_changed_during_deploy");
      fs.mkdirSync(path.dirname(item.destination), { recursive: true });
      const temporary = item.destination + ".v91-build-tmp";
      if (fs.existsSync(temporary)) throw new Error("build_deploy_temp_exists");
      fs.writeFileSync(temporary, bytes, { flag: "wx" });
      try { fs.renameSync(temporary, item.destination); } catch (error) { fs.unlinkSync(temporary); throw error; }
      written.push(item);
    }
    verifyRuntimeBuild({ rootDir, outputDir, deployed: true });
  } catch (error) {
    for (const item of written.reverse()) {
      if (item.previous) fs.writeFileSync(item.destination, item.previous);
      else fs.unlinkSync(item.destination);
    }
    throw error;
  }
  return { changedFiles: changes.length, backupDir, payloadSha256: manifest.payloadSha256 };
}

if (require.main === module) {
  if (process.argv.length > 2) throw new Error("build_unknown_deploy_argument");
  console.log("VOTC generated runtime deployment: " + JSON.stringify(deployRuntimeBuild()));
}

module.exports = { deployRuntimeBuild };
