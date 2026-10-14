"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { hash } = require("./memory4-contract");
const { Memory4Store } = require("./memory4-store");
const { assertNoLinks } = require("./scoped-path");

const OWNER_FOLDER = /^([1-9]\d*)_.+$/;
const CAMPAIGN_HASH = /^[a-f0-9]{64}$/;
const YEAR_FILE = /^years\/([1-9]\d{0,3})\.json$/;
const RETIRED_METADATA_KEYS = ["derivedDirty", "derivedRevision"];
const RETIREMENT_LOCK_FILE = "memory4-retirement-v933.lock";
const RETIREMENT_AUDIT_FILE = "memory4-retirement-v933.json";
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function fail(code) { throw new Error(code); }

function canonicalHash(value) {
  if (Array.isArray(value)) return value.map(canonicalHash);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalHash(value[key])]));
}

function assertWithin(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("memory4_retirement_path_invalid");
  }
  assertNoLinks(target, "memory4_retirement_symlink_path");
  return relative;
}

function assertDirectory(target, optional = false) {
  assertNoLinks(target, "memory4_retirement_symlink_path");
  if (!fs.existsSync(target)) {
    if (optional) return false;
    fail("memory4_retirement_directory_invalid");
  }
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("memory4_retirement_directory_invalid");
  return true;
}

function listTree(directory, relative = "", result = { files: [], directories: [] }) {
  assertDirectory(directory);
  if (relative) result.directories.push(relative.split(path.sep).join("/"));
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(directory, entry.name), childRelative = path.join(relative, entry.name);
    assertNoLinks(target, "memory4_retirement_symlink_path");
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) fail("memory4_retirement_symlink_path");
    if (stat.isDirectory()) listTree(target, childRelative, result);
    else if (stat.isFile()) result.files.push({ filePath: target, relativePath: childRelative.split(path.sep).join("/") });
    else fail("memory4_retirement_file_invalid");
  }
  return result;
}

function readJson(filePath, code) {
  assertNoLinks(filePath, "memory4_retirement_symlink_path");
  let value;
  try { value = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
  catch { fail(code); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function hasManualOverride(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasManualOverride);
  if (value.generationMode === "manual_override" || value.manual?.mode === "manual_override") return true;
  return Object.values(value).some(hasManualOverride);
}

function validateView(view, kind, year, ownerId, campaignToken) {
  const rows = kind === "year" ? view.items : view.segments;
  const idKey = kind === "year" ? "itemId" : "segmentId";
  if (view.memory4SchemaVersion !== 1 || view.ownerId !== ownerId || view.campaignToken !== campaignToken
    || !Number.isSafeInteger(view.revision) || view.revision < 0 || !Array.isArray(view.sourceRevisionSet)
    || view.sourceRevisionSet.some(item => typeof item !== "string") || !Array.isArray(rows)
    || kind === "year" && view.eventYear !== year) fail("memory4_retirement_view_invalid");
  const ids = new Set();
  for (const row of rows) {
    const id = row?.[idKey];
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof id !== "string" || !id || ids.has(id)) {
      fail("memory4_retirement_view_invalid");
    }
    ids.add(id);
  }
  return hasManualOverride(view);
}

function validateCanonicalSidecar(store, ownerId, campaignHash, directory) {
  const indexPath = path.join(directory, "index.json"), metadataPath = path.join(directory, "metadata.json");
  if (!fs.existsSync(indexPath) || !fs.existsSync(metadataPath)) fail("memory4_retirement_scope_invalid");
  const index = readJson(indexPath, "memory4_retirement_scope_invalid");
  const metadata = readJson(metadataPath, "memory4_retirement_scope_invalid");
  const campaignToken = index.campaignToken;
  if (index.ownerId !== ownerId || metadata.ownerId !== ownerId || typeof campaignToken !== "string" || !campaignToken.trim()
    || hash(campaignToken) !== campaignHash || metadata.memory4SchemaVersion !== 1 || metadata.campaignToken !== campaignToken) {
    fail("memory4_retirement_scope_invalid");
  }
  const memory4 = new Memory4Store(store);
  const scope = { campaignToken, ownerId };
  let verifiedIndex;
  try {
    verifiedIndex = memory4.loadIndex(scope);
    memory4.readKnownEntities(scope);
    for (const id of Object.keys(verifiedIndex.entries)) memory4.readEntry(scope, id, verifiedIndex);
  } catch { fail("memory4_retirement_scope_invalid"); }
  return { scope, metadata };
}

function inspectSidecar(store, ownerId, campaignHash, directory, summaryRoot) {
  assertWithin(summaryRoot, directory);
  const { scope, metadata } = validateCanonicalSidecar(store, ownerId, campaignHash, directory);
  const tree = listTree(directory), targets = [], metadataUpdates = [];
  let yearDirectory = null;
  for (const relative of tree.directories) {
    const lower = relative.toLowerCase();
    if (lower === "years" && relative !== "years") fail("memory4_retirement_unknown_derived_path");
    if (relative === "years") yearDirectory = path.join(directory, "years");
    else if (relative.toLowerCase() === "years" || relative.startsWith("years/")) fail("memory4_retirement_unknown_derived_path");
    if (lower === "life" || lower === "life.json") fail("memory4_retirement_unknown_derived_path");
  }
  for (const file of tree.files) {
    const relative = file.relativePath;
    const yearMatch = relative.match(YEAR_FILE);
    if (relative.toLowerCase() === "life.json" && relative !== "life.json") fail("memory4_retirement_unknown_derived_path");
    if (/^(?:years|life)(?:\/|$)/i.test(relative) && !yearMatch && relative !== "life.json") {
      fail("memory4_retirement_unknown_derived_path");
    }
    if (/^year(?:s)?\.json$/i.test(relative) && relative !== "years") fail("memory4_retirement_unknown_derived_path");
    if (!yearMatch && relative !== "life.json") continue;
    const bytes = fs.readFileSync(file.filePath);
    let view;
    try { view = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")); }
    catch { fail("memory4_retirement_view_invalid"); }
    if (!view || typeof view !== "object" || Array.isArray(view)) fail("memory4_retirement_view_invalid");
    const kind = yearMatch ? "year" : "life";
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const manual = validateView(view, kind, year, ownerId, scope.campaignToken);
    targets.push({ filePath: file.filePath, relativePath: relative, ownerId, campaignHash,
      kind, manual, size: bytes.length, sha256: sha256(bytes) });
  }
  const hasDerivedMetadata = RETIRED_METADATA_KEYS.some(key => Object.hasOwn(metadata, key));
  if (hasDerivedMetadata) {
    const next = { ...metadata };
    for (const key of RETIRED_METADATA_KEYS) delete next[key];
    const bytes = Buffer.from(JSON.stringify(next, null, 2), "utf8");
    metadataUpdates.push({ filePath: path.join(directory, "metadata.json"), ownerId, campaignHash,
      oldSha256: sha256(fs.readFileSync(path.join(directory, "metadata.json"))), newSha256: sha256(bytes), bytes });
  }
  return { ownerId, campaignHash, directory, scope, targets, metadataUpdates, yearDirectory };
}

function folderPaths(summaryRoot, ownerId) {
  const found = [];
  if (!fs.existsSync(summaryRoot)) fail("memory4_retirement_summary_root_invalid");
  assertDirectory(summaryRoot);
  for (const entry of fs.readdirSync(summaryRoot, { withFileTypes: true })) {
    const match = entry.name.match(OWNER_FOLDER);
    if (!match || Number(match[1]) !== ownerId) continue;
    const directory = path.join(summaryRoot, entry.name);
    assertNoLinks(directory, "memory4_retirement_symlink_path");
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink()) fail("memory4_retirement_symlink_path");
    if (!stat.isDirectory()) fail("memory4_retirement_scope_invalid");
    found.push({ name: entry.name, directory });
  }
  return found.sort((left, right) => left.name.localeCompare(right.name));
}

function inspectOwner(store, summaryRoot, ownerId) {
  const sidecars = [], folders = folderPaths(summaryRoot, ownerId);
  const canonicalRoot = path.join(summaryRoot, ".memory4");
  assertNoLinks(canonicalRoot, "memory4_retirement_symlink_path");
  if (fs.existsSync(canonicalRoot)) {
    assertDirectory(canonicalRoot);
    const ownerRoot = path.join(canonicalRoot, String(ownerId));
    if (assertDirectory(ownerRoot, true)) {
      for (const entry of fs.readdirSync(ownerRoot, { withFileTypes: true })) {
        const directory = path.join(ownerRoot, entry.name);
        assertNoLinks(directory, "memory4_retirement_symlink_path");
        const stat = fs.lstatSync(directory);
        if (stat.isSymbolicLink()) fail("memory4_retirement_symlink_path");
        if (!stat.isDirectory() || !CAMPAIGN_HASH.test(entry.name)) fail("memory4_retirement_scope_invalid");
        sidecars.push(inspectSidecar(store, ownerId, entry.name, directory, summaryRoot));
      }
    }
  }
  for (const folder of folders) {
    const memoryRoot = path.join(folder.directory, "memory4");
    if (!assertDirectory(memoryRoot, true)) continue;
    for (const entry of fs.readdirSync(memoryRoot, { withFileTypes: true })) {
      const directory = path.join(memoryRoot, entry.name);
      assertNoLinks(directory, "memory4_retirement_symlink_path");
      const stat = fs.lstatSync(directory);
      if (stat.isSymbolicLink()) fail("memory4_retirement_symlink_path");
      if (!stat.isDirectory()) {
        if (/^(years|life)(?:\.|$)/i.test(entry.name)) fail("memory4_retirement_unknown_derived_path");
        continue;
      }
      if (CAMPAIGN_HASH.test(entry.name)) sidecars.push(inspectSidecar(store, ownerId, entry.name, directory, summaryRoot));
      else if (/^(years|life)$/i.test(entry.name)) fail("memory4_retirement_unknown_derived_path");
    }
  }
  const campaignPaths = new Set();
  for (const sidecar of sidecars) {
    if (campaignPaths.has(sidecar.campaignHash)) fail("memory4_retirement_scope_ambiguous");
    campaignPaths.add(sidecar.campaignHash);
  }
  return { ownerId, folders, sidecars };
}

function treeFingerprint(root, excludedFiles, excludedDirectories) {
  const excludedFileSet = new Set(excludedFiles.map(file => path.resolve(file)));
  const excludedDirectorySet = new Set(excludedDirectories.map(directory => path.resolve(directory)));
  const records = [];
  if (!assertDirectory(root, true)) return records;
  const tree = listTree(root);
  for (const relative of tree.directories) {
    const full = path.resolve(root, ...relative.split("/"));
    if (!excludedDirectorySet.has(full)) records.push(["d", relative]);
  }
  for (const file of tree.files) {
    if (excludedFileSet.has(path.resolve(file.filePath))) continue;
    const bytes = fs.readFileSync(file.filePath);
    records.push(["f", file.relativePath, bytes.length, sha256(bytes)]);
  }
  return records;
}

function protectedFingerprint(summaryRoot, owners, excludedFiles, excludedDirectories) {
  const roots = owners.flatMap(owner => [
    path.join(summaryRoot, ".memory4", String(owner.ownerId)),
    ...owner.folders.map(folder => folder.directory)
  ]).filter((root, index, all) => all.indexOf(root) === index);
  const records = roots.map(root => [path.relative(summaryRoot, root).split(path.sep).join("/"),
    treeFingerprint(root, excludedFiles, excludedDirectories)]);
  return hash(canonicalHash(records));
}

function buildPlan({ summaryFoldersDir, ownerIds }) {
  if (typeof summaryFoldersDir !== "string" || !summaryFoldersDir.trim()) fail("memory4_retirement_summary_root_required");
  const summaryRoot = path.resolve(String(summaryFoldersDir || ""));
  assertDirectory(summaryRoot);
  const ids = [...new Set((Array.isArray(ownerIds) ? ownerIds : []).map(Number))].sort((left, right) => left - right);
  if (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) fail("memory4_retirement_owner_required");
  const store = { summaryFoldersDir: summaryRoot };
  const owners = ids.map(ownerId => inspectOwner(store, summaryRoot, ownerId));
  const targets = owners.flatMap(owner => owner.sidecars.flatMap(sidecar => sidecar.targets));
  const metadataUpdates = owners.flatMap(owner => owner.sidecars.flatMap(sidecar => sidecar.metadataUpdates));
  const emptyYears = owners.flatMap(owner => owner.sidecars.filter(sidecar => sidecar.yearDirectory
    && fs.readdirSync(sidecar.yearDirectory).length === 0).map(sidecar => ({ ownerId: owner.ownerId,
    campaignHash: sidecar.campaignHash, directory: sidecar.yearDirectory })));
  const excludedFiles = [...targets.map(target => target.filePath), ...metadataUpdates.map(item => item.filePath)];
  const excludedDirectories = [...emptyYears.map(item => item.directory), ...owners.flatMap(owner => owner.sidecars
    .filter(sidecar => sidecar.yearDirectory && targets.some(target => path.dirname(target.filePath) === sidecar.yearDirectory))
    .map(sidecar => sidecar.yearDirectory))];
  const protectedHash = protectedFingerprint(summaryRoot, owners, excludedFiles, excludedDirectories);
  const targetManifest = targets.map(({ ownerId, campaignHash, relativePath, kind, manual, size, sha256: digest }) =>
    ({ ownerId, campaignHash, relativePath, kind, manual, size, sha256: digest }))
    .sort((left, right) => left.ownerId - right.ownerId || left.campaignHash.localeCompare(right.campaignHash) || left.relativePath.localeCompare(right.relativePath));
  const metadataManifest = metadataUpdates.map(({ ownerId, campaignHash, oldSha256, newSha256 }) =>
    ({ ownerId, campaignHash, oldSha256, newSha256 }))
    .sort((left, right) => left.ownerId - right.ownerId || left.campaignHash.localeCompare(right.campaignHash));
  const planHash = hash(canonicalHash({ version: 1, root: process.platform === "win32" ? summaryRoot.toLowerCase() : summaryRoot,
    ownerIds: ids, targets: targetManifest, metadataUpdates: metadataManifest, protectedFingerprint: protectedHash,
    emptyYears: emptyYears.map(item => [item.ownerId, item.campaignHash]).sort() }));
  return { version: 1, planHash, summaryRoot, ownerIds: ids, owners, targets, metadataUpdates, emptyYears,
    protectedFingerprint: protectedHash, excludedFiles, excludedDirectories, counts: {
      owners: ids.length, campaigns: owners.reduce((sum, owner) => sum + owner.sidecars.length, 0),
      ownersWithFiles: new Set(targets.map(target => target.ownerId)).size,
      yearFiles: targets.filter(target => target.kind === "year").length,
      lifeFiles: targets.filter(target => target.kind === "life").length,
      manualFiles: targets.filter(target => target.manual).length,
      bytes: targets.reduce((sum, target) => sum + target.size, 0),
      metadataFilesUpdated: metadataUpdates.length,
      emptyYearDirectories: emptyYears.length
    } };
}

function planYearLifeRetirement(options) {
  const plan = buildPlan(options || {});
  return { version: plan.version, planHash: plan.planHash, ownerIds: plan.ownerIds, counts: plan.counts };
}

function encodeJournaledBytes(store, filePath, expectedHash) {
  store.trackSummaryMutation(filePath);
  const encoded = store.summaryMutation?.files?.[path.resolve(filePath)];
  if (typeof encoded !== "string") fail("memory4_retirement_transaction_invalid");
  const bytes = Buffer.from(encoded, "base64");
  if (sha256(bytes) !== expectedHash) fail("memory4_retirement_plan_changed");
  return bytes;
}

function expectedRemovedDirectories(plan) {
  return [...new Set(plan.emptyYears.map(item => item.directory).concat(plan.targets.map(target => path.dirname(target.filePath))
    .filter(directory => path.basename(directory) === "years")))].sort();
}

function makeLockRecord(store, plan) {
  const summaryRoot = path.resolve(store.summaryFoldersDir), memoryRoot = path.resolve(store.baseDir);
  const auditPath = path.join(memoryRoot, RETIREMENT_AUDIT_FILE);
  assertNoLinks(auditPath, "memory4_retirement_symlink_path");
  const expectedFiles = [
    ...plan.targets.map(target => ({ filePath: target.filePath, sha256: target.sha256 })),
    ...plan.metadataUpdates.map(item => ({ filePath: item.filePath, sha256: item.oldSha256 })),
    { filePath: auditPath, sha256: fs.existsSync(auditPath) ? sha256(fs.readFileSync(auditPath)) : null }
  ].map(item => ({ path: path.resolve(item.filePath), sha256: item.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const directories = expectedRemovedDirectories(plan);
  return {
    version: 1,
    host: os.hostname(),
    pid: process.pid,
    nonce: crypto.randomBytes(16).toString("hex"),
    planHash: plan.planHash,
    summaryRoot,
    ownerIds: plan.ownerIds,
    expectedFiles,
    expectedRemovedDirectories: directories
  };
}

function acquireLock(store, plan) {
  const baseDir = path.resolve(store.baseDir);
  assertDirectory(baseDir);
  const lockPath = path.join(baseDir, RETIREMENT_LOCK_FILE);
  assertNoLinks(lockPath, "memory4_retirement_lock_invalid");
  const record = makeLockRecord(store, plan);
  const bytes = Buffer.from(JSON.stringify(record), "utf8");
  let descriptor;
  try { descriptor = fs.openSync(lockPath, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST") fail("memory4_retirement_lock_exists");
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } catch (error) {
    try { fs.closeSync(descriptor); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
    throw error;
  }
  fs.closeSync(descriptor);
  return { lockPath, bytes, record };
}

function verifyLock(lock) {
  assertNoLinks(lock.lockPath, "memory4_retirement_lock_invalid");
  if (!fs.existsSync(lock.lockPath) || !fs.lstatSync(lock.lockPath).isFile()
    || !fs.readFileSync(lock.lockPath).equals(lock.bytes)) fail("memory4_retirement_lock_changed");
}

function releaseLock(lock) {
  if (!fs.existsSync(lock.lockPath)) return;
  verifyLock(lock);
  fs.unlinkSync(lock.lockPath);
}

function validateAuditRecord(record) {
  const keys = ["planHash", "completedAt", "ownerScopeHashes", "counts", "files", "metadataFilesUpdated"];
  if (!record || typeof record !== "object" || Array.isArray(record)
    || Object.keys(record).sort().join("|") !== keys.sort().join("|")
    || !/^[a-f0-9]{64}$/.test(record.planHash) || !Number.isFinite(Date.parse(record.completedAt))
    || !Array.isArray(record.ownerScopeHashes) || record.ownerScopeHashes.some(value => !/^[a-f0-9]{64}$/.test(value))
    || !Number.isSafeInteger(record.metadataFilesUpdated) || record.metadataFilesUpdated < 0 || !Array.isArray(record.files)) {
    fail("memory4_retirement_audit_invalid");
  }
  const countKeys = ["owners", "campaigns", "ownersWithFiles", "yearFiles", "lifeFiles", "manualFiles", "bytes", "metadataFilesUpdated", "emptyYearDirectories"];
  if (!record.counts || typeof record.counts !== "object" || Array.isArray(record.counts)
    || Object.keys(record.counts).sort().join("|") !== countKeys.sort().join("|")
    || countKeys.some(key => !Number.isSafeInteger(record.counts[key]) || record.counts[key] < 0)) fail("memory4_retirement_audit_invalid");
  for (const file of record.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)
      || Object.keys(file).sort().join("|") !== ["sha256", "size", "kind", "manual"].sort().join("|")
      || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0
      || !["year", "life"].includes(file.kind) || typeof file.manual !== "boolean") fail("memory4_retirement_audit_invalid");
  }
}

function saveAudit(store, plan, completedAt) {
  const filePath = path.join(store.baseDir, RETIREMENT_AUDIT_FILE);
  assertNoLinks(filePath, "memory4_retirement_symlink_path");
  let records = [];
  if (fs.existsSync(filePath)) {
    const prior = readJson(filePath, "memory4_retirement_audit_invalid");
    if (prior.version !== 1 || !Array.isArray(prior.records)) fail("memory4_retirement_audit_invalid");
    prior.records.forEach(validateAuditRecord);
    records = prior.records;
  }
  const record = { planHash: plan.planHash, completedAt, ownerScopeHashes: plan.ownerIds.map(ownerId => hash(ownerId)),
    counts: plan.counts, files: plan.targets.map(target => ({ sha256: target.sha256, size: target.size, kind: target.kind,
      manual: target.manual })).sort((left, right) => left.sha256.localeCompare(right.sha256)),
    metadataFilesUpdated: plan.metadataUpdates.length };
  const next = { version: 1, records: [...records.filter(item => item?.planHash !== plan.planHash), record].slice(-100) };
  store.writeRawFile(filePath, Buffer.from(JSON.stringify(next, null, 2), "utf8"));
}

function executeYearLifeRetirement({ store, ownerIds, confirmPlanHash, hooks = {} } = {}) {
  if (!store || typeof store.withSummaryMutation !== "function" || !store.baseDir || !store.summaryFoldersDir) {
    fail("memory4_retirement_store_required");
  }
  const plan = buildPlan({ summaryFoldersDir: store.summaryFoldersDir, ownerIds });
  if (typeof confirmPlanHash !== "string" || confirmPlanHash !== plan.planHash) fail("memory4_retirement_confirm_required");
  const summaryRoot = path.resolve(store.summaryFoldersDir);
  const memoryRoot = path.resolve(store.baseDir);
  const relative = path.relative(summaryRoot, memoryRoot);
  if (!relative || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    fail("memory4_retirement_journal_root_invalid");
  }
  if (plan.targets.length === 0 && plan.metadataUpdates.length === 0 && plan.emptyYears.length === 0) {
    return { status: "NO_CHANGES", planHash: plan.planHash, counts: plan.counts };
  }
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)
    || [hooks.afterLock, hooks.afterStage, hooks.beforeCommit].some(hook => hook != null && typeof hook !== "function")) fail("memory4_retirement_hook_invalid");
  const internalPlan = buildPlan({ summaryFoldersDir: summaryRoot, ownerIds: plan.ownerIds });
  if (internalPlan.planHash !== plan.planHash) fail("memory4_retirement_plan_changed");
  const targetHashes = new Map(plan.targets.map(target => [path.resolve(target.filePath), target.sha256]));
  const metadataByPath = new Map(plan.metadataUpdates.map(item => [path.resolve(item.filePath), item]));
  const lock = acquireLock(store, plan);
  try {
    hooks.afterLock?.({ planHash: plan.planHash, lockPath: lock.lockPath });
    verifyLock(lock);
    const lockedPlan = buildPlan({ summaryFoldersDir: summaryRoot, ownerIds: plan.ownerIds });
    if (lockedPlan.planHash !== plan.planHash) fail("memory4_retirement_plan_changed");
    store.withSummaryMutation(null, () => {
      for (const target of plan.targets) {
        const filePath = path.resolve(target.filePath);
        assertWithin(summaryRoot, filePath);
        const bytes = fs.readFileSync(filePath);
        if (sha256(bytes) !== target.sha256) fail("memory4_retirement_plan_changed");
        encodeJournaledBytes(store, filePath, target.sha256);
      }
      for (const update of plan.metadataUpdates) {
        const filePath = path.resolve(update.filePath);
        assertWithin(summaryRoot, filePath);
        encodeJournaledBytes(store, filePath, update.oldSha256);
      }
      hooks.afterStage?.({ planHash: plan.planHash, fileCount: plan.targets.length + plan.metadataUpdates.length });
      for (const target of plan.targets) {
        const filePath = path.resolve(target.filePath);
        assertWithin(summaryRoot, filePath);
        if (!fs.existsSync(filePath) || sha256(fs.readFileSync(filePath)) !== targetHashes.get(filePath)) fail("memory4_retirement_plan_changed");
        store.removeSummaryMutationFile(filePath);
      }
      for (const [filePath, update] of metadataByPath) {
        const bytes = fs.readFileSync(filePath);
        if (sha256(bytes) !== update.oldSha256) fail("memory4_retirement_plan_changed");
        store.writeRawFile(filePath, update.bytes);
      }
      for (const directory of plan.emptyYears.map(item => item.directory)
        .concat([...new Set(plan.targets.map(target => path.dirname(target.filePath)))]
          .filter(directory => path.basename(directory) === "years"))) {
        assertWithin(summaryRoot, directory);
        store.removeSummaryMutationDirectory(directory);
      }
      const current = buildPlan({ summaryFoldersDir: summaryRoot, ownerIds: plan.ownerIds });
      if (current.targets.length || current.emptyYears.length) fail("memory4_retirement_verification_failed");
      const actualProtected = protectedFingerprint(summaryRoot, plan.owners, plan.excludedFiles, plan.excludedDirectories);
      if (actualProtected !== plan.protectedFingerprint) fail("memory4_retirement_protected_data_changed");
      for (const update of plan.metadataUpdates) {
        if (sha256(fs.readFileSync(update.filePath)) !== update.newSha256) fail("memory4_retirement_verification_failed");
      }
      verifyLock(lock);
      hooks.beforeCommit?.({ planHash: plan.planHash, counts: plan.counts });
      verifyLock(lock);
      saveAudit(store, plan, new Date().toISOString());
    });
    releaseLock(lock);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const journalPath = path.join(path.resolve(store.baseDir), "summary-mutation.json");
    if (fs.existsSync(journalPath)) {
      failure.lockCleanupError = "summary mutation journal remains; recovery lock retained";
    } else {
      try { releaseLock(lock); }
      catch (lockError) {
        failure.lockCleanupError = lockError.message;
      }
    }
    throw failure;
  }
  return { status: "COMPLETED", planHash: plan.planHash, counts: plan.counts };
}

function readRetirementLock(lockPath) {
  assertNoLinks(lockPath, "memory4_retirement_lock_invalid");
  const stat = fs.lstatSync(lockPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) fail("memory4_retirement_lock_invalid");
  const bytes = fs.readFileSync(lockPath);
  let lock;
  try { lock = JSON.parse(bytes.toString("utf8")); } catch { fail("memory4_retirement_lock_invalid"); }
  const keys = ["version", "host", "pid", "nonce", "planHash", "summaryRoot", "ownerIds", "expectedFiles", "expectedRemovedDirectories"];
  if (!lock || typeof lock !== "object" || Array.isArray(lock) || Object.keys(lock).sort().join("|") !== keys.sort().join("|")
    || lock.version !== 1 || typeof lock.host !== "string" || !Number.isSafeInteger(lock.pid) || lock.pid <= 0
    || !/^[a-f0-9]{32}$/.test(lock.nonce) || !/^[a-f0-9]{64}$/.test(lock.planHash)
    || typeof lock.summaryRoot !== "string" || !path.isAbsolute(lock.summaryRoot)
    || !Array.isArray(lock.ownerIds) || !lock.ownerIds.length || lock.ownerIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    || !Array.isArray(lock.expectedFiles) || !Array.isArray(lock.expectedRemovedDirectories)) fail("memory4_retirement_lock_invalid");
  for (const file of lock.expectedFiles) {
    if (!file || typeof file !== "object" || Array.isArray(file) || Object.keys(file).sort().join("|") !== ["path", "sha256"].sort().join("|")
      || typeof file.path !== "string" || !path.isAbsolute(file.path)
      || file.sha256 !== null && !/^[a-f0-9]{64}$/.test(file.sha256)) fail("memory4_retirement_lock_invalid");
  }
  if (lock.expectedRemovedDirectories.some(directory => typeof directory !== "string" || !path.isAbsolute(directory))) fail("memory4_retirement_lock_invalid");
  return { lock, bytes };
}

function validateInterruptedJournal(journalPath, lock, summaryRoot, memoryRoot) {
  assertNoLinks(journalPath, "memory4_retirement_journal_invalid");
  const journal = readJson(journalPath, "memory4_retirement_journal_invalid");
  if (journal.version !== 1 || !journal.files || typeof journal.files !== "object" || Array.isArray(journal.files)
    || !Array.isArray(journal.createdDirectories || []) || (journal.createdDirectories || []).length
    || !Array.isArray(journal.removedDirectories || [])) fail("memory4_retirement_journal_invalid");
  const expected = new Map(lock.expectedFiles.map(file => [path.resolve(file.path), file.sha256]));
  for (const [file, content] of Object.entries(journal.files)) {
    const target = path.resolve(file), expectedHash = expected.get(target);
    const withinSummary = (() => {
      const relative = path.relative(summaryRoot, target);
      return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    })();
    if (expectedHash === undefined || !withinSummary && target !== path.join(memoryRoot, RETIREMENT_AUDIT_FILE)
      || content !== null && typeof content !== "string") fail("memory4_retirement_journal_invalid");
    if (content !== null) {
      const bytes = Buffer.from(content, "base64");
      if (bytes.toString("base64") !== content || sha256(bytes) !== expectedHash) fail("memory4_retirement_journal_invalid");
    } else if (expectedHash !== null) fail("memory4_retirement_journal_invalid");
  }
  const allowedDirectories = new Set(lock.expectedRemovedDirectories.map(directory => path.resolve(directory)));
  for (const directory of journal.removedDirectories || []) {
    if (!allowedDirectories.has(path.resolve(directory))) fail("memory4_retirement_journal_invalid");
  }
  return journal;
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

function recoverYearLifeRetirement({ store, ownerIds, restoreJournal } = {}) {
  if (!store?.baseDir || !store?.summaryFoldersDir || typeof restoreJournal !== "function") fail("memory4_retirement_recovery_required");
  const memoryRoot = path.resolve(store.baseDir), summaryRoot = path.resolve(store.summaryFoldersDir);
  const lockPath = path.join(memoryRoot, RETIREMENT_LOCK_FILE);
  const { lock, bytes } = readRetirementLock(lockPath);
  if (lock.host !== os.hostname() || processIsAlive(lock.pid)) fail("memory4_retirement_lock_owner_active");
  const ids = [...new Set((Array.isArray(ownerIds) ? ownerIds : []).map(Number))].sort((left, right) => left - right);
  const normalize = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalize(lock.summaryRoot) !== normalize(summaryRoot) || JSON.stringify(lock.ownerIds) !== JSON.stringify(ids)) {
    fail("memory4_retirement_lock_scope_mismatch");
  }
  assertDirectory(summaryRoot);
  assertDirectory(memoryRoot);
  const journalPath = path.join(memoryRoot, "summary-mutation.json");
  let hadJournal = fs.existsSync(journalPath);
  if (hadJournal) {
    const journal = validateInterruptedJournal(journalPath, lock, summaryRoot, memoryRoot);
    const currentPlan = buildPlan({ summaryFoldersDir: summaryRoot, ownerIds: ids });
    const auditPath = path.resolve(path.join(memoryRoot, RETIREMENT_AUDIT_FILE));
    const missingOriginals = lock.expectedFiles.filter(file => path.resolve(file.path) !== auditPath)
      .some(file => !Object.hasOwn(journal.files, path.resolve(file.path)));
    if (currentPlan.planHash !== lock.planHash && missingOriginals) fail("memory4_retirement_journal_invalid");
    restoreJournal();
    if (fs.existsSync(journalPath)) fail("memory4_retirement_journal_recovery_failed");
    const rolledBack = buildPlan({ summaryFoldersDir: summaryRoot, ownerIds: ids });
    if (rolledBack.planHash !== lock.planHash) fail("memory4_retirement_recovery_unverified");
  } else {
    const auditPath = path.join(memoryRoot, RETIREMENT_AUDIT_FILE);
    let committed = false;
    if (fs.existsSync(auditPath)) {
      const audit = readJson(auditPath, "memory4_retirement_audit_invalid");
      if (audit.version !== 1 || !Array.isArray(audit.records)) fail("memory4_retirement_audit_invalid");
      audit.records.forEach(validateAuditRecord);
      committed = audit.records.some(record => record.planHash === lock.planHash);
    }
    if (!committed) {
      const unchanged = buildPlan({ summaryFoldersDir: summaryRoot, ownerIds: ids });
      if (unchanged.planHash !== lock.planHash) fail("memory4_retirement_recovery_unverified");
    } else {
      const current = buildPlan({ summaryFoldersDir: summaryRoot, ownerIds: ids });
      if (current.targets.length || current.metadataUpdates.length || current.emptyYears.length) fail("memory4_retirement_recovery_unverified");
    }
  }
  const currentBytes = fs.readFileSync(lockPath);
  if (!currentBytes.equals(bytes)) fail("memory4_retirement_lock_changed");
  fs.unlinkSync(lockPath);
  return { status: hadJournal ? "ROLLED_BACK" : "LOCK_CLEARED", planHash: lock.planHash };
}

module.exports = { planYearLifeRetirement, executeYearLifeRetirement, recoverYearLifeRetirement };
