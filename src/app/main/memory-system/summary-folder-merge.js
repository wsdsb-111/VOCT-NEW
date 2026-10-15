"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { hash } = require("./legacy-source-lineage");
const { sanitizeStorageName } = require("./character-identity");
const { assertNoLinks } = require("./scoped-path");

const CONVERSATION_FILE = /^与.+的对话\.json$/u;
const LEGACY_BINDING_ID = /^legacy-summary:[a-f0-9]{64}$/;

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
}

function stableJson(value) { return JSON.stringify(canonicalJson(value)); }

function mirrorIdentity(summary, counterpartId) {
  const token = summary.campaignToken;
  if (typeof token !== "string" || !token.trim() || summary.campaignBinding?.status === "unbound") return null;
  const copy = JSON.parse(JSON.stringify(summary));
  const nameKeys = ["playerName", "characterName", "counterpartName", "ownerName"];
  const fileKeys = ["conversationFile", "conversationFiles", "sourceFile", "sourcePath", "filePath", "relativePath", "folderName", "ownerFolder"];
  for (const key of [...nameKeys, ...fileKeys]) delete copy[key];
  for (const key of ["participants", "participantProfiles"]) {
    if (!Array.isArray(copy[key])) continue;
    copy[key] = copy[key].map(profile => {
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) return profile;
      const result = { ...profile };
      for (const name of ["name", "shortName", "firstName", "fullName", "displayName", ...nameKeys]) delete result[name];
      return result;
    });
  }
  if (copy.provenance && typeof copy.provenance === "object" && !Array.isArray(copy.provenance)) {
    copy.provenance = { ...copy.provenance };
    for (const key of [...nameKeys, ...fileKeys]) delete copy.provenance[key];
  }
  return String(counterpartId) + "|" + token + "|" + stableJson(copy);
}

function compareSummaryDate(left, right) {
  const leftDate = normalizeGameDate(left?.date), rightDate = normalizeGameDate(right?.date);
  if (leftDate && rightDate) return rightDate.serial - leftDate.serial;
  if (leftDate) return -1;
  if (rightDate) return 1;
  const leftDays = Number(left?.totalDays), rightDays = Number(right?.totalDays);
  if (Number.isFinite(leftDays) && leftDays > 0 && Number.isFinite(rightDays) && rightDays > 0) return rightDays - leftDays;
  if (Number.isFinite(leftDays) && leftDays > 0) return -1;
  if (Number.isFinite(rightDays) && rightDays > 0) return 1;
  return 0;
}

function counterpartId(summary, ownerId) {
  const playerId = Number(summary?.playerId), characterId = Number(summary?.characterId);
  if (!Number.isSafeInteger(playerId) || playerId <= 0 || !Number.isSafeInteger(characterId) || characterId <= 0
    || playerId === characterId || playerId !== ownerId && characterId !== ownerId) return null;
  return playerId === ownerId ? characterId : playerId;
}

function conversationFileWithId(fileName, id, suffix = "") {
  const match = fileName.match(/^与(.+)的对话\.json$/u);
  const name = match?.[1] || String(id);
  return `与${name}_${id}${suffix}的对话.json`;
}

function nameFor(summary, id, fileName) {
  if (Number(summary.playerId) === id && typeof summary.playerName === "string" && summary.playerName.trim()) return summary.playerName;
  if (Number(summary.characterId) === id && typeof summary.characterName === "string" && summary.characterName.trim()) return summary.characterName;
  const profiles = Array.isArray(summary.participants) ? summary.participants : [];
  const profile = profiles.find(item => Number(item?.id ?? item?.characterId) === id);
  return profile?.firstName || profile?.shortName || profile?.name || profile?.fullName || fileName?.match(/^与(.+)的对话\.json$/u)?.[1] || null;
}

function validateSummary(summary, ownerId) {
  const official = summary?.sourceType === "CK3_OFFICIAL_RECOLLECTION"
    || summary?.type === "official_recollection" || summary?.subtype === "official_recollection";
  if (!summary || typeof summary !== "object" || Array.isArray(summary) || !official && typeof summary.content !== "string") {
    throw new Error("summary_merge_record_invalid");
  }
  if (summary.perspectiveOwnerId != null && Number(summary.perspectiveOwnerId) !== ownerId) throw new Error("summary_merge_owner_mismatch");
  const explicit = [summary.playerId, summary.characterId].filter(value => value != null).map(Number);
  if (explicit.some(id => !Number.isSafeInteger(id) || id <= 0) || explicit.length > 0 && !explicit.includes(ownerId)) {
    throw new Error("summary_merge_owner_mismatch");
  }
  if (summary.legacyBindingId != null && (typeof summary.legacyBindingId !== "string" || !LEGACY_BINDING_ID.test(summary.legacyBindingId))) {
    throw new Error("legacy_summary_binding_target_invalid");
  }
}

function assertRegularFile(filePath) {
  assertNoLinks(filePath, "unsafe_summary_mutation_path");
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("summary_merge_unsupported_file");
}

function listTreeFiles(directory, relative = "", result = []) {
  assertNoLinks(directory, "unsafe_summary_mutation_path");
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("summary_merge_unsupported_folder");
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "memory4") continue;
    const filePath = path.join(directory, entry.name), childRelative = path.join(relative, entry.name);
    assertNoLinks(filePath, "unsafe_summary_mutation_path");
    const childStat = fs.lstatSync(filePath);
    if (childStat.isSymbolicLink()) throw new Error("unsafe_summary_mutation_path");
    if (childStat.isDirectory()) listTreeFiles(filePath, childRelative, result);
    else if (childStat.isFile()) result.push({ filePath, relativePath: childRelative });
    else throw new Error("summary_merge_unsupported_file");
  }
  return result;
}

function listOwnerFolders(root, ownerId) {
  assertNoLinks(root, "unsafe_summary_mutation_path");
  if (!fs.existsSync(root)) return [];
  assertNoLinks(root, "unsafe_summary_mutation_path");
  if (!fs.lstatSync(root).isDirectory()) throw new Error("summary_merge_root_invalid");
  const prefix = String(ownerId) + "_";
  return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.name.startsWith(prefix)).map(entry => {
    const folderPath = path.join(root, entry.name), stat = fs.lstatSync(folderPath);
    if (stat.isSymbolicLink()) throw new Error("unsafe_summary_mutation_path");
    return stat.isDirectory() ? { name: entry.name, path: folderPath } : null;
  }).filter(Boolean).sort((left, right) => left.name.localeCompare(right.name));
}

function readSummaryFiles(folder, ownerId) {
  const files = listTreeFiles(folder.path), records = [];
  for (const file of files) {
    const relative = file.relativePath.split(path.sep).join("/");
    if (relative.includes("/") || !CONVERSATION_FILE.test(relative)) continue;
    assertRegularFile(file.filePath);
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file.filePath, "utf8").replace(/^\uFEFF/, "")); }
    catch { throw new Error("summary_merge_invalid_json"); }
    if (!Array.isArray(parsed)) throw new Error("summary_merge_file_not_array");
    parsed.forEach((summary, index) => {
      validateSummary(summary, ownerId);
      records.push({ summary, index, fileName: relative, filePath: file.filePath, relativePath: relative });
    });
  }
  return { files, records };
}

function chooseOwnerName(folders, ownerId, scans) {
  const candidates = [];
  for (const folder of folders) {
    const records = scans.get(folder.name).records;
    for (const item of records) {
      const name = nameFor(item.summary, ownerId, null);
      const safeName = sanitizeStorageName(name || "");
      if (safeName) candidates.push({ name: safeName, summary: item.summary, folder: folder.name, index: item.index });
    }
  }
  candidates.sort((left, right) => compareSummaryDate(left.summary, right.summary)
    || left.folder.localeCompare(right.folder) || left.index - right.index || left.name.localeCompare(right.name));
  return candidates[0]?.name || folders[0]?.name.slice(String(ownerId).length + 1).trim() || "unknown";
}

function mergeSummaryRows(store, items, ownerId) {
  const ordered = items.slice().sort((left, right) => left.folderPriority - right.folderPriority
    || compareSummaryDate(left.summary, right.summary) || left.relativePath.localeCompare(right.relativePath) || left.index - right.index);
  const seen = new Set(), output = [];
  for (const item of ordered) {
    const summary = { ...item.summary };
    if (!String(summary.campaignToken || "").trim() && summary.campaignBinding?.status !== "bound" && !summary.legacyBindingId) {
      summary.legacyBindingId = store.getLegacySummaryBindingId(item.filePath, item.index, summary);
    }
    const id = counterpartId(summary, ownerId);
    const identity = id == null ? null : mirrorIdentity(summary, id);
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    output.push({ ...item, summary });
  }
  return output.sort((left, right) => compareSummaryDate(left.summary, right.summary) || left.stableOrder - right.stableOrder)
    .map(item => item.summary);
}

function summaryOutput(store, folders, target, ownerId, scans) {
  const pairs = new Map(), unresolved = new Map(), unknown = new Map();
  let order = 0;
  for (const folder of folders) {
    const { records, files } = scans.get(folder.name);
    const folderPriority = folder.name === target.name ? 0 : 1;
    for (const file of files) {
      const relative = file.relativePath.split(path.sep).join("/");
      if (relative === path.basename(relative) && CONVERSATION_FILE.test(relative)) continue;
      const bytes = fs.readFileSync(file.filePath);
      if (unknown.has(relative) && !unknown.get(relative).equals(bytes)) throw new Error("summary_merge_unknown_file_conflict");
      unknown.set(relative, bytes);
    }
    for (const item of records) {
      const id = counterpartId(item.summary, ownerId);
      const value = { ...item, folderPriority, stableOrder: order++, store };
      const map = id == null ? unresolved : pairs;
      const key = id == null ? item.fileName : id;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    }
  }
  const byFile = new Map();
  const append = (fileName, summaries) => {
    if (!byFile.has(fileName)) byFile.set(fileName, []);
    byFile.get(fileName).push(...summaries);
  };
  const usedFiles = new Set(unresolved.keys());
  for (const [id, items] of pairs) {
    const existing = items.filter(item => item.folderPriority === 0).map(item => item.fileName).sort();
    const newest = items.slice().sort((left, right) => compareSummaryDate(left.summary, right.summary) || left.stableOrder - right.stableOrder)[0];
    const displayName = sanitizeStorageName(nameFor(newest.summary, id, newest.fileName) || "");
    let fileName = existing[0] || "与" + (displayName || String(id)) + "的对话.json";
    if (usedFiles.has(fileName)) {
      fileName = conversationFileWithId(fileName, id);
      let suffix = 2;
      while (usedFiles.has(fileName)) fileName = conversationFileWithId(existing[0] || "与" + (displayName || String(id)) + "的对话.json", id, "_" + suffix++);
    }
    usedFiles.add(fileName);
    append(fileName, mergeSummaryRows(store, items, ownerId));
  }
  for (const [fileName, items] of unresolved) append(fileName, mergeSummaryRows(store, items, ownerId));
  for (const [fileName, records] of byFile) {
    const sorted = records.map((summary, stableOrder) => ({ summary, stableOrder }))
      .sort((left, right) => compareSummaryDate(left.summary, right.summary) || left.stableOrder - right.stableOrder)
      .map(item => item.summary);
    unknown.set(fileName, Buffer.from(JSON.stringify(sorted, null, 2), "utf8"));
  }
  return unknown;
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const file of listTreeFiles(source)) {
    const sourceStat = fs.lstatSync(file.filePath), bytes = fs.readFileSync(file.filePath);
    const target = path.join(destination, file.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: "wx" });
    const after = fs.lstatSync(file.filePath);
    if (!after.isFile() || after.size !== sourceStat.size || after.mtimeMs !== sourceStat.mtimeMs
      || !fs.readFileSync(file.filePath).equals(bytes) || !fs.readFileSync(target).equals(bytes)) {
      throw new Error("summary_merge_source_changed_during_backup");
    }
  }
}

function removeTree(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) removeTree(child);
    else fs.unlinkSync(child);
  }
  fs.rmdirSync(directory);
}

function backupSources(store, folders, ownerId) {
  const root = path.resolve(store.summaryFoldersDir), base = path.resolve(store.baseDir), relative = path.relative(root, base);
  if (!relative || relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)) {
    throw new Error("summary_merge_backup_root_inside_summary_tree");
  }
  const backupRoot = path.join(base, "renamed-summary-folders",
    String(ownerId) + "-" + Date.now() + "-" + process.pid + "-" + crypto.randomBytes(4).toString("hex"));
  assertNoLinks(backupRoot, "unsafe_summary_mutation_path");
  fs.mkdirSync(backupRoot, { recursive: true });
  try {
    for (const folder of folders) copyTree(folder.path, path.join(backupRoot, folder.name));
  } catch (error) {
    removeTree(backupRoot);
    throw error;
  }
}

function sourceFingerprint(folders) {
  const directories = folders.map(folder => folder.path);
  return hash(directories.flatMap(directory => listTreeFiles(directory).map(file => [
    file.filePath, crypto.createHash("sha256").update(fs.readFileSync(file.filePath)).digest("hex")
  ])));
}

function hasRetiredSidecars(root, folders, ownerId) {
  const locations = [...folders.map(folder => path.join(folder.path, "memory4")), path.join(root, ".memory4", String(ownerId))];
  for (const location of locations) {
    assertNoLinks(location, "unsafe_summary_mutation_path");
    if (fs.existsSync(location)) return true;
  }
  return false;
}

function removeEmptyDirectories(store, directory, preserveSelf = false) {
  if (!fs.existsSync(directory)) return;
  assertNoLinks(directory, "unsafe_summary_mutation_path");
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "memory4") continue;
    const child = path.join(directory, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    removeEmptyDirectories(store, child, false);
  }
  if (!preserveSelf && fs.readdirSync(directory).length === 0) store.removeSummaryMutationDirectory(directory);
}

function mergeRenamedSummaryFolders(store, ownerId, preferredName = null) {
  const numericOwnerId = Number(ownerId);
  if (!Number.isSafeInteger(numericOwnerId) || numericOwnerId <= 0) throw new Error("summary_merge_owner_invalid");
  if (!store.summaryFoldersDir) return { folderPath: null, mergedFolders: [], changed: false };
  const root = path.resolve(store.summaryFoldersDir), folders = listOwnerFolders(root, numericOwnerId);
  const preferred = preferredName == null ? null : sanitizeStorageName(preferredName).trim() || "unknown";
  if (!folders.length) return { folderPath: preferred ? path.join(root, String(numericOwnerId) + "_" + preferred) : null, mergedFolders: [], changed: false };
  if (folders.length === 1) return { folderPath: folders[0].path, mergedFolders: [], changed: false };
  if (hasRetiredSidecars(root, folders, numericOwnerId)) {
    return { folderPath: null, mergedFolders: [], changed: false, blocked: "RETIRED_SIDECAR_PRESENT" };
  }
  const originalFingerprint = sourceFingerprint(folders);
  const scans = new Map(folders.map(folder => [folder.name, readSummaryFiles(folder, numericOwnerId)]));
  const ownerName = preferred || chooseOwnerName(folders, numericOwnerId, scans);
  const targetName = String(numericOwnerId) + "_" + (sanitizeStorageName(ownerName).trim() || "unknown");
  const target = folders.find(folder => folder.name === targetName) || { name: targetName, path: path.join(root, targetName) };
  const summaryFiles = summaryOutput(store, folders, target, numericOwnerId, scans);
  backupSources(store, folders, numericOwnerId);
  if (sourceFingerprint(folders) !== originalFingerprint) throw new Error("summary_merge_source_changed_during_backup");
  const keepPaths = new Set(summaryFiles.keys());
  store.withSummaryMutation(null, () => {
    store.ensureSummaryMutationDirectory(target.path);
    for (const [relative, bytes] of summaryFiles) store.writeRawFile(path.join(target.path, ...relative.split("/")), bytes);
    for (const folder of folders) {
      for (const file of listTreeFiles(folder.path)) {
        const relative = file.relativePath.split(path.sep).join("/");
        if (folder.name === targetName && keepPaths.has(relative)) continue;
        store.removeSummaryMutationFile(file.filePath);
      }
    }
    for (const folder of folders) removeEmptyDirectories(store, folder.path, folder.name === targetName);
  });
  return { folderPath: target.path, mergedFolders: folders.filter(folder => folder.name !== targetName).map(folder => folder.name), changed: true };
}

function getSummaryConversationFile(store, ownerId, counterpartCharacterId, fallbackName = null) {
  const numericOwnerId = Number(ownerId), numericCounterpartId = Number(counterpartCharacterId);
  if (!Number.isSafeInteger(numericOwnerId) || numericOwnerId <= 0 || !Number.isSafeInteger(numericCounterpartId) || numericCounterpartId <= 0) return null;
  const root = path.resolve(store.summaryFoldersDir || "");
  const folders = listOwnerFolders(root, numericOwnerId);
  if (folders.length > 1) {
    const merge = mergeRenamedSummaryFolders(store, numericOwnerId);
    if (!merge.blocked) return getSummaryConversationFile(store, numericOwnerId, numericCounterpartId, fallbackName);
  }
  if (!folders.length) return null;
  const folderPath = folders.map(folder => folder.path).join("\0");
  const files = folders.flatMap(folder => fs.readdirSync(folder.path).filter(file => CONVERSATION_FILE.test(file)).sort()
    .map(file => ({ file, folderPath: folder.path })));
  const signature = files.map(({ file, folderPath: sourceFolder }) => {
    const filePath = path.join(sourceFolder, file);
    assertRegularFile(filePath);
    const stat = fs.statSync(filePath);
    return filePath + ":" + stat.size + ":" + stat.mtimeMs + ":" + stat.ctimeMs;
  }).join("|");
  const folderSignature = folders.map(folder => {
    const stat = fs.statSync(folder.path);
    return folder.path + ":" + stat.mtimeMs + ":" + stat.ctimeMs;
  }).join("|");
  const fullSignature = folderSignature + "|" + signature;
  const fileNames = new Set(files.map(item => item.file));
  const fallbackPath = () => {
    if (!fallbackName || folders.length !== 1) return null;
    const fileName = "与" + sanitizeStorageName(fallbackName) + "的对话.json";
    if (!fileNames.has(fileName)) return path.join(folderPath, fileName);
    let candidate = conversationFileWithId(fileName, numericCounterpartId);
    let suffix = 2;
    while (fileNames.has(candidate)) candidate = conversationFileWithId(fileName, numericCounterpartId, "_" + suffix++);
    return path.join(folderPath, candidate);
  };
  const cached = store.summaryConversationFileCache?.get(numericOwnerId);
  if (cached?.folderPath === folderPath && cached.signature === fullSignature) {
    return cached.byCounterpart.get(numericCounterpartId)
      || fallbackPath();
  }
  const byCounterpart = new Map();
  for (const { file, folderPath: sourceFolder } of files) {
    const filePath = path.join(sourceFolder, file);
    let summaries;
    try { summaries = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
    catch { throw new Error("summary_merge_invalid_json"); }
    if (!Array.isArray(summaries)) throw new Error("summary_merge_file_not_array");
    for (const summary of summaries) {
      validateSummary(summary, numericOwnerId);
      if (counterpartId(summary, numericOwnerId) == null) continue;
      const ids = [Number(summary.playerId), Number(summary.characterId)];
      const otherId = ids.find(id => id !== numericOwnerId);
      const previous = byCounterpart.get(otherId);
      if (!previous) {
        byCounterpart.set(otherId, { filePaths: new Set([filePath]), filePath, summary });
      } else {
        previous.filePaths.add(filePath);
        if (compareSummaryDate(summary, previous.summary) < 0
          || compareSummaryDate(summary, previous.summary) === 0 && filePath.localeCompare(previous.filePath) < 0) {
          previous.filePath = filePath;
          previous.summary = summary;
        }
      }
    }
  }
  if (byCounterpart.get(numericCounterpartId)?.filePaths.size > 1) throw new Error("summary_merge_counterpart_file_conflict");
  store.summaryConversationFileCache?.set(numericOwnerId, { folderPath, signature: fullSignature,
    byCounterpart: new Map([...byCounterpart].filter(([, item]) => item.filePaths.size === 1).map(([id, item]) => [id, item.filePath])) });
  return byCounterpart.has(numericCounterpartId) ? byCounterpart.get(numericCounterpartId).filePath
    : fallbackPath();
}

module.exports = { mergeRenamedSummaryFolders, getSummaryConversationFile };
