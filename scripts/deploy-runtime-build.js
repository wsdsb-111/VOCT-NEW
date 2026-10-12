"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { verifyRuntimeBuild } = require("./verify-runtime-build");
const { assertSafeOutputDir, listFiles, rejectLinks, sha256, verifyArtifacts } = require("./build-runtime");

const STATE_DIRECTORY = ".build/runtime-deploy-state";
const RECEIPT_NAME = "receipt.json";
const HEX_HASH = /^[a-f0-9]{64}$/;
const TRANSACTION_ID = /^[a-f0-9-]{36}$/;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function statePaths(rootDir) {
  const stateDir = path.join(rootDir, STATE_DIRECTORY);
  return { stateDir, receiptPath: path.join(stateDir, RECEIPT_NAME), backupRoot: path.join(stateDir, "backups") };
}

function pathExists(file) {
  rejectLinks(file);
  try {
    if (!fs.lstatSync(file).isFile()) throw new Error("build_deploy_path_not_file");
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function directoryExists(directory) {
  rejectLinks(directory);
  try {
    if (!fs.lstatSync(directory).isDirectory()) throw new Error("build_deploy_target_not_directory");
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function safeManagedPath(value) {
  if (typeof value !== "string" || !value || /[\\:\x00-\x1f]/.test(value)
    || value.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error("build_deploy_invalid_path");
  }
  if (!(value === "package.json" || /^(out\/(main|preload|renderer)|default_userdata)\//.test(value))) {
    throw new Error("build_deploy_invalid_path");
  }
  return value;
}

function rowsFromManifest(manifest) {
  return manifest.files.map(item => ({ path: safeManagedPath(item.path), sha256: item.sha256 }))
    .sort((a, b) => compareText(a.path, b.path));
}

function validateRows(rows, { nullable = false } = {}) {
  if (!Array.isArray(rows)) throw new Error("build_deploy_invalid_receipt");
  const seen = new Set();
  const result = rows.map(item => {
    const file = safeManagedPath(item?.path);
    if (seen.has(file) || !(nullable && item.sha256 === null) && !HEX_HASH.test(item.sha256 || "")) {
      throw new Error("build_deploy_invalid_receipt");
    }
    seen.add(file);
    return { path: file, sha256: item.sha256 };
  }).sort((a, b) => compareText(a.path, b.path));
  return result;
}

function validateReceipt(receipt) {
  if (!receipt || receipt.schemaVersion !== 1) throw new Error("build_deploy_invalid_receipt");
  if (["COMPLETED", "RECOVERED"].includes(receipt.status)) {
    if (!HEX_HASH.test(receipt.payloadSha256 || "")) throw new Error("build_deploy_invalid_receipt");
    return { ...receipt, files: validateRows(receipt.files) };
  }
  if (receipt.status !== "IN_PROGRESS" || !TRANSACTION_ID.test(receipt.transactionId || "")
    || !HEX_HASH.test(receipt.targetPayloadSha256 || "") || !HEX_HASH.test(receipt.previousPayloadSha256 || "")
    || !HEX_HASH.test(receipt.backupManifestSha256 || "")) {
    throw new Error("build_deploy_invalid_receipt");
  }
  const previousFiles = validateRows(receipt.previousFiles);
  const targetFiles = validateRows(receipt.targetFiles);
  if (!Array.isArray(receipt.actions) || !receipt.actions.length) throw new Error("build_deploy_invalid_receipt");
  const seen = new Set();
  const actions = receipt.actions.map(item => {
    const file = safeManagedPath(item?.path);
    if (seen.has(file) || !(item.previousSha256 === null || HEX_HASH.test(item.previousSha256 || ""))
      || !(item.targetSha256 === null || HEX_HASH.test(item.targetSha256 || ""))) {
      throw new Error("build_deploy_invalid_receipt");
    }
    seen.add(file);
    const needsBackup = item.previousSha256 !== null && item.previousSha256 !== item.targetSha256;
    const expectedBackupPath = needsBackup ? `files/${file}` : null;
    if (item.backupPath !== expectedBackupPath) throw new Error("build_deploy_invalid_receipt");
    return { path: file, previousSha256: item.previousSha256, targetSha256: item.targetSha256, backupPath: expectedBackupPath };
  }).sort((a, b) => compareText(a.path, b.path));
  const previousMap = new Map(previousFiles.map(item => [item.path, item.sha256]));
  const targetMap = new Map(targetFiles.map(item => [item.path, item.sha256]));
  const allPaths = [...new Set([...previousMap.keys(), ...targetMap.keys()])].sort();
  const expectedActions = allPaths.filter(file => previousMap.get(file) !== targetMap.get(file));
  if (JSON.stringify(actions.map(item => item.path)) !== JSON.stringify(expectedActions)
    || receipt.actions.some(item => item.previousSha256 !== (previousMap.get(item.path) ?? null)
      || item.targetSha256 !== (targetMap.get(item.path) ?? null))) {
    throw new Error("build_deploy_invalid_receipt");
  }
  return { ...receipt, previousFiles, targetFiles, actions };
}

function readReceipt(rootDir) {
  const { stateDir, receiptPath } = statePaths(rootDir);
  rejectLinks(stateDir);
  if (!pathExists(receiptPath)) return null;
  let value;
  try {
    value = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch (error) {
    throw new Error(`build_deploy_receipt_unreadable:${error.code || "invalid_json"}`);
  }
  return validateReceipt(value);
}

function writeDurableFile(file, bytes, { exclusive = false } = {}) {
  rejectLinks(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  rejectLinks(file);
  const fd = fs.openSync(file, exclusive ? "wx" : "w");
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function renameWithRetry(source, target) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(source, target);
      return;
    } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 5) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1));
    }
  }
}

function writeJsonAtomically(file, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  rejectLinks(file);
  rejectLinks(temporary);
  writeDurableFile(temporary, bytes, { exclusive: true });
  try {
    renameWithRetry(temporary, file);
  } catch (error) {
    if (pathExists(temporary) && sha256(fs.readFileSync(temporary)) === sha256(bytes)) fs.unlinkSync(temporary);
    throw error;
  }
  rejectLinks(file);
}

function appFile(appDir, relative, { allowTemporary = false } = {}) {
  if (allowTemporary) {
    const match = /^(.*)\.votc-deploy-([a-f0-9-]{36})\.tmp$/.exec(relative);
    if (match) {
      safeManagedPath(match[1]);
      return path.join(appDir, ...relative.split("/"));
    }
  }
  return path.join(appDir, ...safeManagedPath(relative).split("/"));
}

function readManagedFile(appDir, relative, { allowTemporary = false } = {}) {
  const file = appFile(appDir, relative, { allowTemporary });
  rejectLinks(file);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error("build_deploy_target_not_file");
    return fs.readFileSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function listRuntimeFiles(appDir) {
  const result = [];
  rejectLinks(appDir);
  if (fs.existsSync(appDir) && !fs.lstatSync(appDir).isDirectory()) throw new Error("build_deploy_target_not_directory");
  if (fs.existsSync(appDir)) {
    result.push(...fs.readdirSync(appDir).filter(name => /^package\.json\.votc-deploy-[a-f0-9-]{36}\.tmp$/.test(name)));
  }
  const packagePath = path.join(appDir, "package.json");
  if (pathExists(packagePath)) result.push("package.json");
  for (const directory of ["out", "default_userdata"]) {
    const root = path.join(appDir, directory);
    if (!directoryExists(root)) continue;
    result.push(...listFiles(root).map(file => `${directory}/${file}`));
  }
  return result.sort();
}

function assertRuntimeInventory(appDir, expectedPaths, errorCode = "build_deploy_target_inventory_mismatch") {
  const expected = [...new Set(expectedPaths.map(safeManagedPath))].sort();
  const actual = listRuntimeFiles(appDir);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(errorCode);
}

function verifyReceiptTargets(appDir, receipt) {
  assertRuntimeInventory(appDir, receipt.files.map(item => item.path), "build_deploy_target_mismatch");
  for (const item of receipt.files) {
    const bytes = readManagedFile(appDir, item.path);
    if (!bytes || sha256(bytes) !== item.sha256) throw new Error(`build_deploy_target_mismatch:${item.path}`);
  }
}

function normalizeLineEndings(bytes) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return null;
  return Buffer.from(text.replace(/\r\n/g, "\n"), "utf8");
}

function equivalentTextBytes(left, right) {
  if (left.equals(right)) return true;
  const normalizedLeft = normalizeLineEndings(left);
  const normalizedRight = normalizeLineEndings(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft.equals(normalizedRight));
}

function seedInitialReceipt(rootDir, outputDir, appDir, manifest) {
  const expected = rowsFromManifest(manifest);
  assertRuntimeInventory(appDir, expected.map(item => item.path), "build_deploy_initial_target_unknown");
  for (const item of expected) {
    const current = readManagedFile(appDir, item.path);
    const stage = fs.readFileSync(path.join(outputDir, "app", ...item.path.split("/")));
    if (!current || !equivalentTextBytes(current, stage)) {
      throw new Error(`build_deploy_initial_target_unknown:${item.path}`);
    }
  }
  const receipt = {
    schemaVersion: 1,
    status: "COMPLETED",
    payloadSha256: manifest.payloadSha256,
    files: expected.map(item => ({ path: item.path, sha256: sha256(readManagedFile(appDir, item.path)) }))
  };
  writeJsonAtomically(statePaths(rootDir).receiptPath, receipt);
  return validateReceipt(receipt);
}

function backupData(rootDir, receipt) {
  const { stateDir, backupRoot } = statePaths(rootDir);
  const transactionDir = path.join(backupRoot, receipt.transactionId);
  const manifestPath = path.join(transactionDir, "backup-manifest.json");
  rejectLinks(transactionDir);
  rejectLinks(manifestPath);
  let manifestBytes;
  try {
    manifestBytes = fs.readFileSync(manifestPath);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("build_deploy_backup_missing");
    throw error;
  }
  if (sha256(manifestBytes) !== receipt.backupManifestSha256) throw new Error("build_deploy_backup_manifest_mismatch");
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (_) {
    throw new Error("build_deploy_backup_manifest_mismatch");
  }
  if (manifest.schemaVersion !== 1 || manifest.transactionId !== receipt.transactionId || !Array.isArray(manifest.files)) {
    throw new Error("build_deploy_backup_manifest_mismatch");
  }
  const expected = receipt.actions.filter(item => item.backupPath).map(item => ({
    path: item.path, sha256: item.previousSha256, backupPath: item.backupPath
  })).sort((a, b) => compareText(a.path, b.path));
  const actual = manifest.files.map(item => ({
    path: safeManagedPath(item?.path), sha256: item?.sha256, backupPath: item?.backupPath
  })).sort((a, b) => compareText(a.path, b.path));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("build_deploy_backup_manifest_mismatch");

  const bytesByPath = new Map();
  for (const item of expected) {
    const backupFile = path.join(transactionDir, ...item.backupPath.split("/"));
    rejectLinks(backupFile);
    let bytes;
    try {
      bytes = fs.readFileSync(backupFile);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`build_deploy_backup_missing:${item.path}`);
      throw error;
    }
    if (sha256(bytes) !== item.sha256) throw new Error(`build_deploy_backup_mismatch:${item.path}`);
    bytesByPath.set(item.path, bytes);
  }
  return { transactionDir, bytesByPath };
}

function tempRelativePath(file, transactionId) {
  return `${file}.votc-deploy-${transactionId}.tmp`;
}

function preflightRecovery(appDir, receipt, rootDir) {
  const backups = backupData(rootDir, receipt);
  const knownPaths = new Set([...receipt.previousFiles, ...receipt.targetFiles].map(item => item.path));
  const actualPaths = listRuntimeFiles(appDir);
  const temporaryPaths = new Map();
  for (const action of receipt.actions) {
    const temporary = tempRelativePath(action.path, receipt.transactionId);
    if (actualPaths.includes(temporary)) {
      const bytes = readManagedFile(appDir, temporary, { allowTemporary: true });
      const hash = bytes && sha256(bytes);
      if (![action.previousSha256, action.targetSha256].includes(hash) || hash === null) {
        throw new Error(`build_deploy_recovery_unknown_target:${temporary}`);
      }
      temporaryPaths.set(temporary, action);
    }
  }
  for (const file of actualPaths) {
    if (temporaryPaths.has(file)) continue;
    if (!knownPaths.has(file)) throw new Error(`build_deploy_recovery_unknown_target:${file}`);
  }
  for (const file of knownPaths) {
    const bytes = readManagedFile(appDir, file);
    const currentHash = bytes ? sha256(bytes) : null;
    const previous = receipt.previousFiles.find(item => item.path === file)?.sha256 ?? null;
    const target = receipt.targetFiles.find(item => item.path === file)?.sha256 ?? null;
    if (currentHash !== previous && currentHash !== target) {
      throw new Error(`build_deploy_recovery_unknown_target:${file}`);
    }
  }
  return { backups, temporaryPaths };
}

function removeTemporary(appDir, relative) {
  const file = appFile(appDir, relative, { allowTemporary: true });
  rejectLinks(file);
  if (pathExists(file)) fs.unlinkSync(file);
}

function writeTargetAtomically(appDir, relative, bytes, transactionId) {
  const destination = appFile(appDir, relative);
  rejectLinks(destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = appFile(appDir, tempRelativePath(relative, transactionId), { allowTemporary: true });
  rejectLinks(temporary);
  if (pathExists(temporary)) throw new Error("build_deploy_temp_exists");
  writeDurableFile(temporary, bytes, { exclusive: true });
  if (sha256(fs.readFileSync(temporary)) !== sha256(bytes)) throw new Error("build_deploy_temp_hash_mismatch");
  try {
    renameWithRetry(temporary, destination);
  } catch (error) {
    if (pathExists(temporary) && sha256(fs.readFileSync(temporary)) === sha256(bytes)) fs.unlinkSync(temporary);
    throw error;
  }
}

function restorePreviousState(rootDir, appDir, receipt, { backups, temporaryPaths }) {
  for (const temporary of temporaryPaths.keys()) removeTemporary(appDir, temporary);
  for (const action of receipt.actions) {
    const current = readManagedFile(appDir, action.path);
    const currentHash = current ? sha256(current) : null;
    if (currentHash === action.previousSha256) continue;
    if (currentHash !== action.targetSha256) throw new Error(`build_deploy_recovery_unknown_target:${action.path}`);
    if (action.previousSha256 === null) {
      if (current) fs.unlinkSync(appFile(appDir, action.path));
    } else {
      const bytes = backups.bytesByPath.get(action.path);
      if (!bytes) throw new Error(`build_deploy_backup_missing:${action.path}`);
      writeTargetAtomically(appDir, action.path, bytes, receipt.transactionId);
    }
  }
  assertRuntimeInventory(appDir, receipt.previousFiles.map(item => item.path), "build_deploy_recovery_restore_mismatch");
  for (const item of receipt.previousFiles) {
    const bytes = readManagedFile(appDir, item.path);
    if (!bytes || sha256(bytes) !== item.sha256) throw new Error(`build_deploy_recovery_restore_mismatch:${item.path}`);
  }
  const recovered = {
    schemaVersion: 1,
    status: "RECOVERED",
    payloadSha256: receipt.previousPayloadSha256,
    files: receipt.previousFiles,
    recoveredTransaction: {
      transactionId: receipt.transactionId,
      targetPayloadSha256: receipt.targetPayloadSha256,
      backupManifestSha256: receipt.backupManifestSha256
    }
  };
  writeJsonAtomically(statePaths(rootDir).receiptPath, recovered);
  return validateReceipt(recovered);
}

function recoverPendingDeployment({ rootDir = path.resolve(__dirname, "..") } = {}) {
  rootDir = path.resolve(rootDir);
  const appDir = path.join(rootDir, "resources/app");
  rejectLinks(appDir);
  const receipt = readReceipt(rootDir);
  if (!receipt) return { recovered: false, status: "NONE" };
  if (receipt.status !== "IN_PROGRESS") {
    verifyReceiptTargets(appDir, receipt);
    return { recovered: false, status: receipt.status };
  }
  const preflight = preflightRecovery(appDir, receipt, rootDir);
  const recovered = restorePreviousState(rootDir, appDir, receipt, preflight);
  return { recovered: true, status: recovered.status, transactionId: receipt.transactionId };
}

function createBackupAndReceipt(rootDir, appDir, receipt, targetFiles, targetPayloadSha256) {
  const state = statePaths(rootDir);
  const transactionId = crypto.randomUUID();
  const previousMap = new Map(receipt.files.map(item => [item.path, item.sha256]));
  const targetMap = new Map(targetFiles.map(item => [item.path, item.sha256]));
  const allPaths = [...new Set([...previousMap.keys(), ...targetMap.keys()])].sort();
  const actions = allPaths.filter(file => previousMap.get(file) !== targetMap.get(file)).map(file => {
    const previousSha256 = previousMap.get(file) ?? null;
    const targetSha256 = targetMap.get(file) ?? null;
    return {
      path: file,
      previousSha256,
      targetSha256,
      backupPath: previousSha256 !== null ? `files/${file}` : null
    };
  });
  if (!actions.length) return { receipt, backupDir: null, actions };

  const transactionDir = path.join(state.backupRoot, transactionId);
  const backupRows = [];
  rejectLinks(transactionDir);
  fs.mkdirSync(transactionDir, { recursive: true });
  rejectLinks(transactionDir);
  for (const action of actions) {
    if (!action.backupPath) continue;
    const bytes = readManagedFile(appDir, action.path);
    if (!bytes || sha256(bytes) !== action.previousSha256) throw new Error(`build_deploy_target_changed:${action.path}`);
    const backupFile = path.join(transactionDir, ...action.backupPath.split("/"));
    writeDurableFile(backupFile, bytes, { exclusive: true });
    if (sha256(fs.readFileSync(backupFile)) !== action.previousSha256) throw new Error(`build_backup_hash_mismatch:${action.path}`);
    backupRows.push({ path: action.path, sha256: action.previousSha256, backupPath: action.backupPath });
  }
  backupRows.sort((a, b) => compareText(a.path, b.path));
  const backupManifest = { schemaVersion: 1, transactionId, files: backupRows };
  const backupManifestBytes = Buffer.from(JSON.stringify(backupManifest, null, 2) + "\n", "utf8");
  const backupManifestPath = path.join(transactionDir, "backup-manifest.json");
  writeDurableFile(backupManifestPath, backupManifestBytes, { exclusive: true });
  if (sha256(fs.readFileSync(backupManifestPath)) !== sha256(backupManifestBytes)) throw new Error("build_backup_manifest_hash_mismatch");

  const inProgress = {
    schemaVersion: 1,
    status: "IN_PROGRESS",
    transactionId,
    previousPayloadSha256: receipt.payloadSha256,
    targetPayloadSha256,
    previousFiles: receipt.files,
    targetFiles,
    actions,
    backupManifestSha256: sha256(backupManifestBytes)
  };
  writeJsonAtomically(state.receiptPath, inProgress);
  return { receipt: validateReceipt(inProgress), backupDir: transactionDir, actions };
}

function applyTargetActions(rootDir, outputDir, appDir, receipt) {
  for (const action of receipt.actions) {
    const current = readManagedFile(appDir, action.path);
    const currentHash = current ? sha256(current) : null;
    if (currentHash === action.targetSha256) continue;
    if (currentHash !== action.previousSha256) throw new Error(`build_deploy_target_changed:${action.path}`);
    if (action.targetSha256 === null) {
      if (current) fs.unlinkSync(appFile(appDir, action.path));
      continue;
    }
    const bytes = fs.readFileSync(path.join(outputDir, "app", ...action.path.split("/")));
    if (sha256(bytes) !== action.targetSha256) throw new Error(`build_changed_during_deploy:${action.path}`);
    writeTargetAtomically(appDir, action.path, bytes, receipt.transactionId);
  }
}

function verifyVotcClosed() {
  if (process.platform !== "win32") return;
  const processes = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "@(Get-Process -Name VOTC -ErrorAction SilentlyContinue).Count"],
    { encoding: "utf8", windowsHide: true });
  if (processes.status !== 0 || !/^0\s*$/.test(processes.stdout)) throw new Error("build_close_votc_before_deploy");
}

function safeSourcePath(value) {
  if (typeof value !== "string" || !value || /[\\:\x00-\x1f]/.test(value)
    || value.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error("build_deploy_invalid_mapping");
  }
  if (!(value === "package.json" || /^(main|preload|renderer|default_userdata)\//.test(value))) {
    throw new Error("build_deploy_invalid_mapping");
  }
  return value;
}

function readBootstrapMappings(rootDir, manifest) {
  const configPath = path.join(rootDir, "build/runtime-inputs.json");
  rejectLinks(configPath);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (_) {
    throw new Error("build_deploy_bootstrap_inputs_invalid");
  }
  if (config.schemaVersion !== 1 || !Array.isArray(config.files) || !config.files.length) {
    throw new Error("build_deploy_bootstrap_inputs_invalid");
  }
  const sources = new Set();
  const targets = new Set();
  const mappings = config.files.map(item => {
    const source = safeSourcePath(item?.source);
    const target = safeManagedPath(item?.target);
    const expectedTarget = /^(main|preload|renderer)\//.test(source) ? `out/${source}` : source;
    if (target !== expectedTarget || sources.has(source) || targets.has(target)) {
      throw new Error("build_deploy_bootstrap_inputs_invalid");
    }
    sources.add(source);
    targets.add(target);
    return { source, target };
  }).sort((a, b) => compareText(a.target, b.target));
  const manifestTargets = manifest.files.map(item => item.path).sort();
  if (JSON.stringify(mappings.map(item => item.target)) !== JSON.stringify(manifestTargets)) {
    throw new Error("build_deploy_bootstrap_manifest_mismatch");
  }
  for (const required of ["package.json", "out/main/main.js", "out/preload/preload.js", "out/renderer/index.html"]) {
    if (!targets.has(required)) throw new Error("build_deploy_bootstrap_manifest_mismatch");
  }
  return mappings;
}

function bootstrapDeploymentReceipt({ rootDir = path.resolve(__dirname, ".."), outputDir = path.join(rootDir, ".build/runtime") } = {}) {
  rootDir = path.resolve(rootDir);
  assertSafeOutputDir(rootDir, outputDir);
  outputDir = path.resolve(outputDir);
  rejectLinks(outputDir);
  const appDir = path.join(rootDir, "resources/app");
  rejectLinks(appDir);
  const existing = readReceipt(rootDir);
  if (existing) {
    if (existing.status === "IN_PROGRESS") throw new Error("build_deploy_incomplete");
    verifyReceiptTargets(appDir, existing);
    return { bootstrapped: false, receiptPath: statePaths(rootDir).receiptPath,
      payloadSha256: existing.payloadSha256, files: existing.files.length };
  }

  const manifest = verifyArtifacts(outputDir);
  const mappings = readBootstrapMappings(rootDir, manifest);
  const manifestByPath = new Map(manifest.files.map(item => [item.path, item]));
  for (const mapping of mappings) {
    const sourcePath = path.join(rootDir, "src/app", ...mapping.source.split("/"));
    const stagePath = path.join(outputDir, "app", ...mapping.target.split("/"));
    const deployedPath = appFile(appDir, mapping.target);
    rejectLinks(sourcePath);
    rejectLinks(stagePath);
    rejectLinks(deployedPath);
    const sourceBytes = fs.readFileSync(sourcePath);
    const stageBytes = fs.readFileSync(stagePath);
    const deployedBytes = readManagedFile(appDir, mapping.target);
    const expected = manifestByPath.get(mapping.target);
    if (sourceBytes.toString("utf8", 0, 80).startsWith("version https://git-lfs.github.com/spec/v1")
      || !expected || sourceBytes.length !== expected.bytes || sha256(sourceBytes) !== expected.sha256
      || !sourceBytes.equals(stageBytes) || !stageBytes.equals(deployedBytes)) {
      throw new Error(`build_deploy_bootstrap_parity_mismatch:${mapping.target}`);
    }
  }
  const rows = rowsFromManifest(manifest);
  assertRuntimeInventory(appDir, rows.map(item => item.path), "build_deploy_bootstrap_parity_mismatch");
  const receipt = { schemaVersion: 1, status: "COMPLETED", payloadSha256: manifest.payloadSha256, files: rows };
  writeJsonAtomically(statePaths(rootDir).receiptPath, receipt);
  return { bootstrapped: true, receiptPath: statePaths(rootDir).receiptPath,
    payloadSha256: manifest.payloadSha256, files: rows.length };
}

function deployRuntimeBuild({ rootDir = path.resolve(__dirname, ".."), outputDir = path.join(rootDir, ".build/runtime") } = {}) {
  rootDir = path.resolve(rootDir);
  assertSafeOutputDir(rootDir, outputDir);
  outputDir = path.resolve(outputDir);
  rejectLinks(outputDir);
  verifyVotcClosed();

  const recovery = recoverPendingDeployment({ rootDir });
  const manifest = verifyRuntimeBuild({ rootDir, outputDir });
  const appDir = path.join(rootDir, "resources/app");
  rejectLinks(appDir);
  let receipt = readReceipt(rootDir);
  if (!receipt) receipt = seedInitialReceipt(rootDir, outputDir, appDir, manifest);
  else verifyReceiptTargets(appDir, receipt);

  const targetFiles = rowsFromManifest(manifest);
  const transaction = createBackupAndReceipt(rootDir, appDir, receipt, targetFiles, manifest.payloadSha256);
  if (!transaction.actions.length) {
    verifyRuntimeBuild({ rootDir, outputDir, deployed: true });
    const complete = { schemaVersion: 1, status: "COMPLETED", payloadSha256: manifest.payloadSha256, files: targetFiles };
    writeJsonAtomically(statePaths(rootDir).receiptPath, complete);
    return { changedFiles: 0, backupDir: null, payloadSha256: manifest.payloadSha256,
      receiptPath: statePaths(rootDir).receiptPath, recoveredInterruptedDeploy: recovery.recovered };
  }

  try {
    applyTargetActions(rootDir, outputDir, appDir, transaction.receipt);
    verifyRuntimeBuild({ rootDir, outputDir, deployed: true, allowIncompleteDeployment: true });
    const complete = { schemaVersion: 1, status: "COMPLETED", payloadSha256: manifest.payloadSha256, files: targetFiles };
    writeJsonAtomically(statePaths(rootDir).receiptPath, complete);
  } catch (error) {
    try {
      recoverPendingDeployment({ rootDir });
    } catch (recoveryError) {
      throw new Error(`build_deploy_recovery_blocked:${recoveryError.message}`, { cause: error });
    }
    throw error;
  }

  return { changedFiles: transaction.actions.length, backupDir: transaction.backupDir,
    payloadSha256: manifest.payloadSha256, receiptPath: statePaths(rootDir).receiptPath,
    recoveredInterruptedDeploy: recovery.recovered };
}

if (require.main === module) {
  if (process.argv.length > 2) throw new Error("build_unknown_deploy_argument");
  console.log("VOTC generated runtime deployment: " + JSON.stringify(deployRuntimeBuild()));
}

module.exports = { deployRuntimeBuild, recoverPendingDeployment, bootstrapDeploymentReceipt,
  statePaths, validateReceipt, verifyReceiptTargets };
