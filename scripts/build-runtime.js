"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function rejectLinks(file) {
  for (let current = path.resolve(file); current !== path.dirname(current); current = path.dirname(current)) {
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error("build_symlink_rejected");
  }
}

function listFiles(directory, prefix = "") {
  rejectLinks(directory);
  const result = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isSymbolicLink()) throw new Error("build_symlink_rejected");
    if (item.isDirectory()) result.push(...listFiles(path.join(directory, item.name), name + "/"));
    else if (item.isFile()) result.push(name);
    else throw new Error("build_non_file_rejected");
  }
  return result.sort();
}

function safeRelative(value) {
  if (typeof value !== "string" || !value || /[\\:\x00-\x1f]/.test(value)
    || value.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("build_invalid_path");
  return value;
}

function renameStage(source, target) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(source, target); return; } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 5) throw error;
      // Windows may briefly hold a newly written directory; never change the target or replay writes.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1));
    }
  }
}

function readInputs(rootDir) {
  const configPath = path.join(rootDir, "build/runtime-inputs.json");
  rejectLinks(configPath);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config.schemaVersion !== 1 || !Array.isArray(config.files) || !config.files.length) throw new Error("build_invalid_inputs");
  const sourceNames = new Set();
  const targetNames = new Set();
  const files = config.files.map(item => {
    const source = safeRelative(item.source);
    const target = safeRelative(item.target);
    const expected = /^(main|preload|renderer)\//.test(source) ? "out/" + source : source;
    if (!(source === "package.json" || /^(main|preload|renderer|default_userdata)\//.test(source))
      || target !== expected || sourceNames.has(source) || targetNames.has(target)) throw new Error("build_invalid_mapping");
    sourceNames.add(source);
    targetNames.add(target);
    return { source, target };
  }).sort((a, b) => a.target < b.target ? -1 : a.target > b.target ? 1 : 0);
  for (const required of ["package.json", "out/main/main.js", "out/preload/preload.js", "out/renderer/index.html"]) {
    if (!targetNames.has(required)) throw new Error("build_missing_entrypoint");
  }
  const actual = listFiles(path.join(rootDir, "src/app"));
  if (JSON.stringify(actual) !== JSON.stringify([...sourceNames].sort())) throw new Error("build_source_inventory_mismatch");
  return files;
}

function readPayload(rootDir) {
  return readInputs(rootDir).map(item => {
    const sourceFile = path.join(rootDir, "src/app", item.source);
    const bytes = fs.readFileSync(sourceFile);
    if (bytes.toString("utf8", 0, 80).startsWith("version https://git-lfs.github.com/spec/v1")) throw new Error("build_lfs_pointer_rejected");
    return { ...item, bytes, sha256: sha256(bytes) };
  });
}

function verifyArtifacts(outputDir, expectedFiles = null) {
  rejectLinks(outputDir);
  if (fs.readdirSync(outputDir).some(name => !["app", "runtime-build-manifest.json"].includes(name))) throw new Error("build_foreign_output");
  const manifestPath = path.join(outputDir, "runtime-build-manifest.json");
  rejectLinks(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.generator !== "votc-source-build-v1" || !Array.isArray(manifest.files)) throw new Error("build_invalid_manifest");
  const names = new Set();
  for (const item of manifest.files) {
    const target = safeRelative(item.path);
    if (!(target === "package.json" || /^(out\/(main|preload|renderer)|default_userdata)\//.test(target))
      || names.has(target)) throw new Error("build_invalid_manifest_path");
    names.add(target);
    const file = path.join(outputDir, "app", target);
    rejectLinks(file);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw new Error("build_artifact_hash_mismatch");
  }
  const actual = listFiles(path.join(outputDir, "app"));
  if (JSON.stringify(actual) !== JSON.stringify([...names].sort())) throw new Error("build_artifact_inventory_mismatch");
  if (sha256(Buffer.from(JSON.stringify(manifest.files))) !== manifest.payloadSha256) throw new Error("build_manifest_hash_mismatch");
  if (expectedFiles && JSON.stringify(manifest.files) !== JSON.stringify(expectedFiles)) throw new Error("build_source_artifact_mismatch");
  if (JSON.parse(fs.readFileSync(path.join(outputDir, "app/package.json"), "utf8")).version !== manifest.appVersion) throw new Error("build_manifest_version_mismatch");
  return manifest;
}

function buildRuntime({ rootDir = root, outputDir = path.join(rootDir, ".build/runtime") } = {}) {
  rootDir = path.resolve(rootDir);
  outputDir = path.resolve(outputDir);
  // Staging cannot overwrite source, vendored dependencies, or the installed application.
  const outputKey = process.platform === "win32" ? outputDir.toLowerCase() : outputDir;
  for (const protectedPath of [rootDir, path.join(rootDir, "src"), path.join(rootDir, "resources"), path.join(rootDir, "build")]) {
    const protectedKey = process.platform === "win32" ? protectedPath.toLowerCase() : protectedPath;
    if (outputKey === protectedKey || outputKey.startsWith(protectedKey + path.sep) && protectedPath !== rootDir) throw new Error("build_protected_output");
  }
  rejectLinks(outputDir);
  const payload = readPayload(rootDir);
  const files = payload.map(item => ({ path: item.target, bytes: item.bytes.length, sha256: item.sha256 }));
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) {
    const old = verifyArtifacts(outputDir);
    if (JSON.stringify(old.files.map(item => item.path)) !== JSON.stringify(files.map(item => item.path))) throw new Error("build_use_fresh_output");
    if (fs.readdirSync(outputDir).some(name => !["app", "runtime-build-manifest.json"].includes(name))) throw new Error("build_foreign_output");
  }
  const appPackage = JSON.parse(payload.find(item => item.target === "package.json").bytes.toString("utf8"));
  if (appPackage.main !== "out/main/main.js") throw new Error("build_invalid_main");
  for (const item of payload) {
    // Default userdata includes editor TypeScript declarations with .js names; preserve these opaque assets.
    if (/^(main|preload|renderer)\//.test(item.source) && item.source.endsWith(".js")) {
      const inputType = item.source.startsWith("renderer/") ? "module" : "commonjs";
      const result = spawnSync(process.execPath, ["--check", "--input-type=" + inputType], { input: item.bytes, encoding: "utf8", windowsHide: true });
      if (result.status !== 0) throw new Error(`build_syntax_failed:${item.source}\n${result.stderr || result.error || ""}`);
    }
  }
  const manifest = { schemaVersion: 1, generator: "votc-source-build-v1", appVersion: appPackage.version,
    files, payloadSha256: sha256(Buffer.from(JSON.stringify(files))) };
  const parent = path.dirname(outputDir);
  fs.mkdirSync(parent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(parent, ".votc-source-stage-"));
  const previous = stage + "-previous";
  const removeGeneratedDirectory = directory => {
    if (path.dirname(directory) !== parent || !path.basename(directory).startsWith(".votc-source-stage-")) throw new Error("build_cleanup_path_rejected");
    rejectLinks(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  };
  try {
    for (const item of payload) {
      const destination = path.join(stage, "app", item.target);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, item.bytes);
    }
    fs.writeFileSync(path.join(stage, "runtime-build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    verifyArtifacts(stage, files);
    rejectLinks(outputDir);
    if (fs.existsSync(outputDir)) renameStage(outputDir, previous);
    try { renameStage(stage, outputDir); } catch (error) {
      if (fs.existsSync(previous)) renameStage(previous, outputDir);
      throw error;
    }
    removeGeneratedDirectory(previous);
    return verifyArtifacts(outputDir, files);
  } finally {
    removeGeneratedDirectory(stage);
  }
}

if (require.main === module) {
  if (process.argv.length > 2) throw new Error("build_cli_has_no_extra_arguments");
  const manifest = buildRuntime();
  console.log(`VOTC source build: PASS (${manifest.files.length} files, App ${manifest.appVersion}, ${manifest.payloadSha256})`);
}

module.exports = { buildRuntime, readPayload, verifyArtifacts, listFiles, rejectLinks, sha256 };
