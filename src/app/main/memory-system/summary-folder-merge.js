"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual } = require("util");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { hash } = require("./memory4-contract");
const { Memory4Store, INDEX_KEYS } = require("./memory4-store");
const { createProjectionLineage } = require("./memory4-forget");
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

function validateKnownIndex(known, ownerId, campaignToken) {
  if (!known) return;
  if (known.ownerId !== ownerId || known.campaignToken !== campaignToken || !Number.isSafeInteger(known.revision)
    || !known.entities || typeof known.entities !== "object" || Array.isArray(known.entities)) throw new Error("memory4_known_index_invalid");
  for (const [id, entity] of Object.entries(known.entities)) {
    if (!/^\d+$/.test(id) || !entity || typeof entity !== "object" || Array.isArray(entity)
      || Number(entity.entityId) !== Number(id) || !Number.isSafeInteger(entity.revision)
      || entity.evidenceByConversation != null && (!entity.evidenceByConversation || typeof entity.evidenceByConversation !== "object" || Array.isArray(entity.evidenceByConversation))
      || entity.disclosedFacts != null && (!entity.disclosedFacts || typeof entity.disclosedFacts !== "object" || Array.isArray(entity.disclosedFacts))) {
      throw new Error("memory4_known_index_invalid");
    }
    for (const evidence of Object.values(entity.evidenceByConversation || {})) {
      if (Array.isArray(evidence)) {
        if (evidence.some(type => typeof type !== "string")) throw new Error("memory4_known_index_invalid");
      } else if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)
        || !Array.isArray(evidence.types) || evidence.types.some(type => typeof type !== "string")) {
        throw new Error("memory4_known_index_invalid");
      }
    }
  }
  if (known.currentFactState != null) {
    if (!known.currentFactState || typeof known.currentFactState !== "object" || Array.isArray(known.currentFactState)) throw new Error("memory4_fact_state_invalid");
    for (const [entityId, facts] of Object.entries(known.currentFactState)) {
      if (!/^\d+$/.test(entityId) || !facts || typeof facts !== "object" || Array.isArray(facts)) throw new Error("memory4_fact_state_invalid");
      for (const [key, state] of Object.entries(facts)) {
        if (!/^(TITLE|TRAIT):.+/.test(key) || !state || typeof state.present !== "boolean"
          || !Number.isSafeInteger(state.epoch) || state.epoch < 0 || state.present && state.epoch < 1
          || !normalizeGameDate(state.lastObservedDate) || state.epoch > 0 && !normalizeGameDate(state.epochStartedDate)) {
          throw new Error("memory4_fact_state_invalid");
        }
      }
    }
  }
  if (known.currentFactObservedDates != null && (!known.currentFactObservedDates || typeof known.currentFactObservedDates !== "object"
    || Array.isArray(known.currentFactObservedDates) || Object.entries(known.currentFactObservedDates)
      .some(([id, date]) => !/^\d+$/.test(id) || !normalizeGameDate(date)))) throw new Error("memory4_fact_state_invalid");
}

function validateForgottenIndex(forgotten, ownerId, campaignToken) {
  if (!forgotten) return;
  if (forgotten.schemaVersion !== 1 || forgotten.ownerId !== ownerId || forgotten.campaignToken !== campaignToken
    || !forgotten.projections || typeof forgotten.projections !== "object" || Array.isArray(forgotten.projections)) {
    throw new Error("memory4_forgotten_projections_invalid");
  }
  for (const [projectionId, projection] of Object.entries(forgotten.projections)) {
    let lineage;
    try { lineage = createProjectionLineage({ ...projection, projectionId }); }
    catch { throw new Error("memory4_forgotten_projections_invalid"); }
    if (lineage.ownerId !== ownerId || lineage.campaignToken !== campaignToken
      || typeof projection.reason !== "string" || !projection.reason.trim() || !Number.isFinite(Date.parse(projection.forgottenAt || ""))) {
      throw new Error("memory4_forgotten_projections_invalid");
    }
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
      if (relative.startsWith("memory4/")) continue;
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
    const canonical = path.join(root, ".memory4", String(ownerId));
    assertNoLinks(canonical, "unsafe_summary_mutation_path");
    if (fs.existsSync(canonical)) copyTree(canonical, path.join(backupRoot, ".memory4", String(ownerId)));
  } catch (error) {
    removeTree(backupRoot);
    throw error;
  }
}

function sourceFingerprint(store, folders, ownerId) {
  const canonical = path.join(store.summaryFoldersDir, ".memory4", String(ownerId));
  const directories = [...folders.map(folder => folder.path), ...(fs.existsSync(canonical) ? [canonical] : [])];
  return hash(directories.flatMap(directory => listTreeFiles(directory).map(file => [
    file.filePath, crypto.createHash("sha256").update(fs.readFileSync(file.filePath)).digest("hex")
  ])));
}

function parseSidecarJson(directory, relative) {
  const file = path.join(directory, ...relative.split("/"));
  if (!fs.existsSync(file)) return null;
  assertRegularFile(file);
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch { throw new Error("memory4_corrupt_json"); }
}

function sidecarLocations(store, folders, ownerId) {
  const root = path.resolve(store.summaryFoldersDir), groups = new Map(), generic = new Map();
  const add = (directory, campaignHash, canonical, genericPrefix = "") => {
    assertNoLinks(directory, "memory4_symlink_path");
    if (!fs.lstatSync(directory).isDirectory()) throw new Error("memory4_symlink_path");
    const files = listTreeFiles(directory).map(item => ({ ...item, relativePath: item.relativePath.split(path.sep).join("/") }));
    if (campaignHash) {
      if (!groups.has(campaignHash)) groups.set(campaignHash, []);
      groups.get(campaignHash).push({ directory, canonical, files });
    } else if (!canonical) {
      for (const file of files) {
        const relative = [genericPrefix, file.relativePath].filter(Boolean).join("/");
        const bytes = fs.readFileSync(file.filePath);
        if (generic.has(relative) && !generic.get(relative).bytes.equals(bytes)) throw new Error("memory4_sidecar_file_conflict");
        generic.set(relative, { bytes, filePath: file.filePath });
      }
    }
  };
  const canonicalRoot = path.join(root, ".memory4", String(ownerId));
  assertNoLinks(canonicalRoot, "memory4_symlink_path");
  if (fs.existsSync(canonicalRoot)) {
    assertNoLinks(canonicalRoot, "memory4_symlink_path");
    for (const entry of fs.readdirSync(canonicalRoot, { withFileTypes: true })) {
      const directory = path.join(canonicalRoot, entry.name), stat = fs.lstatSync(directory);
      if (stat.isSymbolicLink()) throw new Error("memory4_symlink_path");
      if (stat.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) add(directory, entry.name, true);
    }
  }
  for (const folder of folders) {
    const legacyRoot = path.join(folder.path, "memory4");
    assertNoLinks(legacyRoot, "memory4_symlink_path");
    if (!fs.existsSync(legacyRoot)) continue;
    assertNoLinks(legacyRoot, "memory4_symlink_path");
    for (const entry of fs.readdirSync(legacyRoot, { withFileTypes: true })) {
      const directory = path.join(legacyRoot, entry.name), stat = fs.lstatSync(directory);
      if (stat.isSymbolicLink()) throw new Error("memory4_symlink_path");
      if (!stat.isDirectory()) {
        const bytes = fs.readFileSync(directory);
        if (generic.has(entry.name) && !generic.get(entry.name).bytes.equals(bytes)) throw new Error("memory4_sidecar_file_conflict");
        generic.set(entry.name, { bytes, filePath: directory });
      } else if (/^[a-f0-9]{64}$/.test(entry.name)) add(directory, entry.name, false);
      else add(directory, null, false, entry.name);
    }
  }
  return { root, canonicalRoot, groups, generic };
}

function validateSidecar(location, campaignHash, ownerId, memory4) {
  const files = new Map(location.files.map(file => [file.relativePath, fs.readFileSync(file.filePath)]));
  const index = parseSidecarJson(location.directory, "index.json");
  const metadata = parseSidecarJson(location.directory, "metadata.json");
  const known = parseSidecarJson(location.directory, "known-entities.json");
  const forgotten = parseSidecarJson(location.directory, "forgotten-projections.json");
  if (!index && !metadata) {
    if ([...files.keys()].some(file => file.startsWith("entries/"))) throw new Error("memory4_index_missing_rebuild_required");
    return { ...location, files, index: null, metadata: null, known, forgotten };
  }
  if (!index || !metadata || index.ownerId !== ownerId || metadata.ownerId !== ownerId
    || typeof index.campaignToken !== "string" || !index.campaignToken.trim() || hash(index.campaignToken) !== campaignHash
    || metadata.memory4SchemaVersion !== 1 || metadata.campaignToken !== index.campaignToken
    || !Number.isSafeInteger(index.revision) || index.revision < 0
    || metadata.revision !== index.revision || metadata.indexHash !== hash(index)
    || !index.entries || typeof index.entries !== "object" || Array.isArray(index.entries)
    || !index.finalizations || typeof index.finalizations !== "object" || Array.isArray(index.finalizations)
    || !metadata.knownEvidenceRevisions || typeof metadata.knownEvidenceRevisions !== "object" || Array.isArray(metadata.knownEvidenceRevisions)
    || INDEX_KEYS.some(key => !index[key] || typeof index[key] !== "object" || Array.isArray(index[key]))) {
    throw new Error("memory4_metadata_index_mismatch");
  }
  const rebuilt = JSON.parse(JSON.stringify(index));
  memory4.reindex(rebuilt);
  if (INDEX_KEYS.some(key => !isDeepStrictEqual(index[key], rebuilt[key]))) throw new Error("memory4_index_invalid");
  const indexedFiles = new Set();
  for (const [id, row] of Object.entries(index.entries)) {
    const entry = parseSidecarJson(location.directory, "entries/" + id + ".json");
    if (!row || typeof row !== "object" || Array.isArray(row) || !/^m4_[a-f0-9]{64}$/.test(id) || !entry || entry.entryId !== id || entry.ownerId !== ownerId
      || entry.campaignToken !== index.campaignToken || hash(entry) !== row.bodyHash || !isDeepStrictEqual(memory4.indexRow(entry), row)) {
      throw new Error("memory4_index_body_mismatch");
    }
    indexedFiles.add("entries/" + id + ".json");
  }
  for (const file of files.keys()) {
    if (file.startsWith("entries/") && (!/^entries\/m4_[a-f0-9]{64}\.json$/.test(file) || !indexedFiles.has(file))) {
      throw new Error("memory4_entry_file_unindexed");
    }
  }
  for (const [key, revision] of Object.entries(metadata.knownEvidenceRevisions)) {
    if (!/^[a-f0-9]{64}$/.test(key) || typeof revision !== "string" || !revision.trim()) throw new Error("memory4_known_revision_invalid");
  }
  validateKnownIndex(known, ownerId, index.campaignToken);
  validateForgottenIndex(forgotten, ownerId, index.campaignToken);
  return { ...location, files, index, metadata, known, forgotten };
}

function unionMap(left, right, error) {
  const result = { ...(left || {}) };
  for (const [key, value] of Object.entries(right || {})) {
    if (Object.hasOwn(result, key) && !isDeepStrictEqual(result[key], value)) throw new Error(error);
    result[key] = value;
  }
  return result;
}

function mergeKnown(left, right, ownerId, campaignToken) {
  if (!left) return right;
  if (!right) return left;
  if (left.ownerId !== ownerId || right.ownerId !== ownerId || left.campaignToken !== campaignToken || right.campaignToken !== campaignToken) {
    throw new Error("memory4_known_index_invalid");
  }
  const entities = { ...left.entities };
  for (const [id, incoming] of Object.entries(right.entities)) {
    if (!entities[id]) { entities[id] = incoming; continue; }
    const current = entities[id], merged = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      if (["evidenceByConversation", "disclosedFacts"].includes(key)) continue;
      if (Object.hasOwn(merged, key) && !isDeepStrictEqual(merged[key], value)
        && !["revision", "directConversationCount", "sharedSceneCount", "mentionCount", "evidenceTypes",
          "sourceConversationIds", "sourceEpisodeIds", "firstSeenDate", "lastSeenDate", "completeness"].includes(key)) {
        throw new Error("memory4_known_entity_conflict");
      }
    }
    merged.evidenceByConversation = unionMap(current.evidenceByConversation, incoming.evidenceByConversation, "memory4_known_evidence_conflict");
    merged.disclosedFacts = unionMap(current.disclosedFacts, incoming.disclosedFacts, "memory4_known_fact_conflict");
    const evidence = Object.values(merged.evidenceByConversation).map(item => ({
      types: Array.isArray(item) ? item : item.types || [], date: Array.isArray(item) ? null : item.date,
      episodeId: Array.isArray(item) ? null : item.episodeId, completeness: Array.isArray(item) ? "legacy_partial" : item.completeness
    }));
    const dates = evidence.map(item => normalizeGameDate(item.date)).filter(Boolean).sort((a, b) => a.serial - b.serial);
    merged.directConversationCount = evidence.filter(item => item.types.includes("direct_conversation")).length;
    merged.sharedSceneCount = evidence.filter(item => item.types.includes("shared_scene")).length;
    merged.mentionCount = evidence.filter(item => item.types.includes("mention")).length;
    merged.evidenceTypes = [...new Set(evidence.flatMap(item => item.types))].sort();
    merged.sourceConversationIds = Object.keys(merged.evidenceByConversation).sort();
    merged.sourceEpisodeIds = [...new Set(evidence.map(item => item.episodeId).filter(Boolean))].sort();
    merged.firstSeenDate = dates[0]?.canonical || null;
    merged.lastSeenDate = dates.at(-1)?.canonical || null;
    merged.completeness = !evidence.length ? "legacy_partial" : evidence.every(item => item.completeness === "complete") ? "complete"
      : evidence.some(item => item.completeness === "legacy_partial") ? "legacy_partial" : "partial";
    merged.revision = Math.max(Number(current.revision) || 0, Number(incoming.revision) || 0) + 1;
    entities[id] = merged;
  }
  const currentFactState = { ...(left.currentFactState || {}) };
  for (const [entityId, incoming] of Object.entries(right.currentFactState || {})) {
    const facts = { ...(currentFactState[entityId] || {}) };
    for (const [key, state] of Object.entries(incoming)) {
      if (Object.hasOwn(facts, key) && !isDeepStrictEqual(facts[key], state)) throw new Error("memory4_fact_state_conflict");
      facts[key] = state;
    }
    currentFactState[entityId] = facts;
  }
  const currentFactObservedDates = { ...(left.currentFactObservedDates || {}) };
  for (const [entityId, incoming] of Object.entries(right.currentFactObservedDates || {})) {
    const current = normalizeGameDate(currentFactObservedDates[entityId]), next = normalizeGameDate(incoming);
    if (!current || next.serial > current.serial) currentFactObservedDates[entityId] = next.canonical;
  }
  const merged = { ...left, revision: Math.max(Number(left.revision) || 0, Number(right.revision) || 0) + 1, entities,
    ...(Object.keys(currentFactState).length ? { currentFactState } : {}),
    ...(Object.keys(currentFactObservedDates).length ? { currentFactObservedDates } : {}) };
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (["revision", "entities", "currentFactState", "currentFactObservedDates"].includes(key)) continue;
    if (Object.hasOwn(left, key) && Object.hasOwn(right, key) && !isDeepStrictEqual(left[key], right[key])) {
      throw new Error("memory4_known_index_conflict");
    }
    if (!Object.hasOwn(left, key) && Object.hasOwn(right, key)) merged[key] = right[key];
  }
  return merged;
}

function validateDerivedView(view, kind, year, ownerId, campaignToken) {
  const listKey = kind === "year" ? "items" : "segments", idKey = kind === "year" ? "itemId" : "segmentId";
  if (!view || typeof view !== "object" || Array.isArray(view) || view.memory4SchemaVersion !== 1
    || view.ownerId !== ownerId || view.campaignToken !== campaignToken || !Number.isSafeInteger(view.revision) || view.revision < 0
    || !Array.isArray(view.sourceRevisionSet) || view.sourceRevisionSet.some(item => typeof item !== "string")
    || !Array.isArray(view[listKey]) || kind === "year" && view.eventYear !== year) throw new Error("memory4_derived_invalid");
  const ids = new Set();
  for (const item of view[listKey]) {
    const id = item?.[idKey];
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof id !== "string" || !id || ids.has(id)) {
      throw new Error("memory4_derived_invalid");
    }
    ids.add(id);
  }
  return view;
}

function mergeView(left, right, kind, year, index) {
  const listKey = kind === "year" ? "items" : "segments", idKey = kind === "year" ? "itemId" : "segmentId";
  for (const view of [left, right]) validateDerivedView(view, kind, year, left.ownerId, left.campaignToken);
  const ignored = new Set([listKey, "sourceRevisionSet", "sourceHash", "dirty", "revision", "tokens", "updatedAt"]);
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!ignored.has(key) && Object.hasOwn(left, key) && Object.hasOwn(right, key) && !isDeepStrictEqual(left[key], right[key])) {
      throw new Error("memory4_derived_conflict");
    }
  }
  const rows = new Map(left[listKey].map(item => [item[idKey], item]));
  for (const item of right[listKey]) {
    if (!item?.[idKey] || rows.has(item[idKey]) && !isDeepStrictEqual(rows.get(item[idKey]), item)) throw new Error("memory4_derived_conflict");
    rows.set(item[idKey], item);
  }
  const items = [...rows.values()];
  const sourceDate = item => (item.sourceEntryIds || []).map(id => {
    const row = index.entries[id], date = normalizeGameDate(row?.eventTime?.from || row?.acquiredDate);
    return date?.serial;
  }).filter(Number.isFinite).sort((a, b) => a - b)[0] || Infinity;
  if (kind === "year") items.sort((a, b) => sourceDate(a) - sourceDate(b) || String(a.itemId).localeCompare(String(b.itemId)));
  else items.sort((a, b) => (Number(a.period?.fromYear) || Infinity) - (Number(b.period?.fromYear) || Infinity)
    || String(a.segmentId).localeCompare(String(b.segmentId)));
  return { ...left, ...right, [listKey]: items, sourceRevisionSet: [...new Set([...left.sourceRevisionSet, ...right.sourceRevisionSet])].sort(),
    sourceHash: null, dirty: true, revision: Math.max(left.revision, right.revision) + 1,
    ...(kind === "year" ? { tokens: (Number(left.tokens) || 0) + (Number(right.tokens) || 0) } : {}) };
}

function mergeSidecars(store, groups, ownerId, canonicalRoot) {
  const memory4 = new Memory4Store(store), writes = [];
  for (const [campaignHash, locations] of groups) {
    if (locations.length === 1 && locations[0].canonical) continue;
    const sidecars = locations.map(item => validateSidecar(item, campaignHash, ownerId, memory4));
    const target = path.join(canonicalRoot, campaignHash);
    let files;
    if (sidecars.length === 1) files = new Map(sidecars[0].files);
    else {
      if (sidecars.some(item => !item.index || !item.metadata)) throw new Error("memory4_sidecar_merge_invalid");
      const campaignToken = sidecars[0].index.campaignToken;
      let index = JSON.parse(JSON.stringify(sidecars[0].index));
      let known = sidecars[0].known || null;
      let forgotten = { ...(sidecars[0].forgotten?.projections || {}) };
      const views = new Map(), entries = new Map(), extras = new Map();
      for (const sidecar of sidecars) {
        if (sidecar.index.ownerId !== ownerId || sidecar.index.campaignToken !== campaignToken) throw new Error("memory4_scope_mismatch");
        for (const [id, row] of Object.entries(sidecar.index.entries)) {
          if (Object.hasOwn(index.entries, id) && !isDeepStrictEqual(index.entries[id], row)) throw new Error("memory4_entry_conflict");
          index.entries[id] = row;
        }
        for (const [id, row] of Object.entries(sidecar.index.finalizations)) {
          if (Object.hasOwn(index.finalizations, id) && !isDeepStrictEqual(index.finalizations[id], row)) throw new Error("memory4_finalization_conflict");
          index.finalizations[id] = row;
        }
        known = mergeKnown(known, sidecar.known, ownerId, campaignToken);
        for (const [id, row] of Object.entries(sidecar.forgotten?.projections || {})) {
          if (Object.hasOwn(forgotten, id) && !isDeepStrictEqual(forgotten[id], row)) throw new Error("memory4_projection_id_conflict");
          forgotten[id] = row;
        }
        for (const [key, bytes] of sidecar.files) {
          if (["index.json", "metadata.json", "known-entities.json", "forgotten-projections.json"].includes(key)) continue;
          if (/^entries\/.+\.json$/.test(key)) {
            if (entries.has(key) && !entries.get(key).equals(bytes)) throw new Error("memory4_entry_conflict");
            entries.set(key, bytes);
            continue;
          }
          if (/^years\/[1-9]\d{0,3}\.json$/.test(key) || key === "life.json") {
            const prior = views.get(key), yearMatch = key.match(/^years\/([1-9]\d{0,3})\.json$/);
            let view;
            try { view = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")); }
            catch { throw new Error("memory4_derived_invalid"); }
            const kind = yearMatch ? "year" : "life", year = yearMatch ? Number(yearMatch[1]) : null;
            validateDerivedView(view, kind, year, ownerId, campaignToken);
            if (!prior) views.set(key, view);
            else views.set(key, mergeView(prior, view, kind, year, index));
            continue;
          }
          if (extras.has(key) && !extras.get(key).equals(bytes)) throw new Error("memory4_sidecar_file_conflict");
          extras.set(key, bytes);
        }
      }
      index.revision = Math.max(...sidecars.map(item => item.index.revision)) + 1;
      memory4.reindex(index);
      const knownRevisions = {};
      for (const item of sidecars) for (const [key, revision] of Object.entries(item.metadata.knownEvidenceRevisions || {})) {
        if (Object.hasOwn(knownRevisions, key) && knownRevisions[key] !== revision) throw new Error("memory4_known_revision_conflict");
        knownRevisions[key] = revision;
      }
      const metadata = { ...sidecars[0].metadata };
      const metadataIgnored = new Set(["revision", "indexHash", "knownEvidenceRevisions", "derivedRevision", "derivedDirty", "updatedAt", "lastFinalizationId"]);
      const metadataKeys = new Set(sidecars.flatMap(item => Object.keys(item.metadata)));
      for (const key of metadataKeys) {
        if (metadataIgnored.has(key)) continue;
        const values = sidecars.map(item => item.metadata[key]).filter(value => value !== undefined);
        if (values.some(value => !isDeepStrictEqual(value, values[0]))) throw new Error("memory4_metadata_conflict");
        metadata[key] = values[0];
      }
      const latest = sidecars.map(item => item.metadata.lastFinalizationId).filter(id => typeof id === "string" && id)
        .map(id => {
          const record = index.finalizations[hash(id)];
          if (!record) throw new Error("memory4_metadata_index_mismatch");
          return { id, time: Date.parse(record.committedAt || "") || 0 };
        }).sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))[0];
      const changedViews = views.size > 0;
      for (const [key, view] of views) {
        const yearMatch = key.match(/^years\/([1-9]\d{0,3})\.json$/);
        const kind = yearMatch ? "year" : "life";
        const listKey = kind === "year" ? "items" : "segments";
        const idKey = kind === "year" ? "itemId" : "segmentId";
        const rows = view[listKey].slice();
        if (kind === "year") {
          const sourceDate = item => (item.sourceEntryIds || []).map(id => {
            const row = index.entries[id], date = normalizeGameDate(row?.eventTime?.from || row?.acquiredDate);
            return date?.serial;
          }).filter(Number.isFinite).sort((a, b) => a - b)[0] || Infinity;
          rows.sort((left, right) => sourceDate(left) - sourceDate(right) || String(left[idKey]).localeCompare(String(right[idKey])));
        } else {
          rows.sort((left, right) => (Number(left.period?.fromYear) || Infinity) - (Number(right.period?.fromYear) || Infinity)
            || String(left[idKey]).localeCompare(String(right[idKey])));
        }
        views.set(key, { ...view, [listKey]: rows, sourceHash: null, dirty: true,
          revision: view.dirty === true || view.sourceHash === null ? view.revision : view.revision + 1 });
      }
      const mergedMetadata = { ...metadata, memory4SchemaVersion: 1, campaignToken, ownerId,
        revision: index.revision, indexHash: hash(index), knownEvidenceRevisions: knownRevisions,
        derivedRevision: Math.max(...sidecars.map(item => Number(item.metadata.derivedRevision) || 0)) + (changedViews ? 1 : 0),
        derivedDirty: changedViews || sidecars.some(item => item.metadata.derivedDirty === true),
        ...(latest ? { lastFinalizationId: latest.id } : {}),
        updatedAt: sidecars.map(item => item.metadata.updatedAt).filter(value => typeof value === "string").sort().at(-1) || null };
      files = new Map([...entries, ...extras]);
      for (const [key, view] of views) files.set(key, Buffer.from(JSON.stringify(view, null, 2), "utf8"));
      if (known) files.set("known-entities.json", Buffer.from(JSON.stringify(known, null, 2), "utf8"));
      if (sidecars.some(item => item.forgotten)) files.set("forgotten-projections.json", Buffer.from(JSON.stringify({
        schemaVersion: 1, campaignToken, ownerId, projections: forgotten
      }, null, 2), "utf8"));
      files.set("metadata.json", Buffer.from(JSON.stringify(mergedMetadata, null, 2), "utf8"));
      files.set("index.json", Buffer.from(JSON.stringify(index, null, 2), "utf8"));
    }
    for (const [relative, bytes] of files) writes.push({ filePath: path.join(target, ...relative.split("/")), bytes });
  }
  return writes;
}

function planSidecarWrites(store, folders, target, ownerId) {
  const { canonicalRoot, groups, generic } = sidecarLocations(store, folders, ownerId);
  const writes = mergeSidecars(store, groups, ownerId, canonicalRoot);
  const targetMemory4 = path.join(target.path, "memory4");
  for (const [relative, item] of generic) {
    const destination = path.join(targetMemory4, ...relative.split("/"));
    if (fs.existsSync(destination)) {
      assertRegularFile(destination);
      if (!fs.readFileSync(destination).equals(item.bytes)) throw new Error("memory4_sidecar_file_conflict");
    } else writes.push({ filePath: destination, bytes: item.bytes });
  }
  return writes;
}

function removeEmptyDirectories(store, directory, preserveSelf = false) {
  if (!fs.existsSync(directory)) return;
  assertNoLinks(directory, "unsafe_summary_mutation_path");
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
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
  const originalFingerprint = sourceFingerprint(store, folders, numericOwnerId);
  const scans = new Map(folders.map(folder => [folder.name, readSummaryFiles(folder, numericOwnerId)]));
  const ownerName = preferred || chooseOwnerName(folders, numericOwnerId, scans);
  const targetName = String(numericOwnerId) + "_" + (sanitizeStorageName(ownerName).trim() || "unknown");
  const target = folders.find(folder => folder.name === targetName) || { name: targetName, path: path.join(root, targetName) };
  const summaryFiles = summaryOutput(store, folders, target, numericOwnerId, scans);
  const sidecarWrites = planSidecarWrites(store, folders, target, numericOwnerId);
  backupSources(store, folders, numericOwnerId);
  if (sourceFingerprint(store, folders, numericOwnerId) !== originalFingerprint) throw new Error("summary_merge_source_changed_during_backup");
  const keepPaths = new Set([...summaryFiles.keys(), ...sidecarWrites.filter(item => item.filePath.startsWith(target.path + path.sep))
    .map(item => path.relative(target.path, item.filePath).split(path.sep).join("/"))]);
  store.withSummaryMutation(null, () => {
    store.ensureSummaryMutationDirectory(target.path);
    for (const [relative, bytes] of summaryFiles) store.writeRawFile(path.join(target.path, ...relative.split("/")), bytes);
    for (const item of sidecarWrites) store.writeRawFile(item.filePath, item.bytes);
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
    mergeRenamedSummaryFolders(store, numericOwnerId);
    return getSummaryConversationFile(store, numericOwnerId, numericCounterpartId, fallbackName);
  }
  const folderPath = folders[0]?.path;
  if (!folderPath) return null;
  const files = fs.readdirSync(folderPath).filter(file => CONVERSATION_FILE.test(file)).sort();
  const signature = files.map(file => {
    const filePath = path.join(folderPath, file);
    assertRegularFile(filePath);
    const stat = fs.statSync(filePath);
    return file + ":" + stat.size + ":" + stat.mtimeMs + ":" + stat.ctimeMs;
  }).join("|");
  const folderStat = fs.statSync(folderPath);
  const fullSignature = folderStat.mtimeMs + ":" + folderStat.ctimeMs + "|" + signature;
  const fileNames = new Set(files);
  const fallbackPath = () => {
    if (!fallbackName) return null;
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
  for (const file of files) {
    let summaries;
    try { summaries = JSON.parse(fs.readFileSync(path.join(folderPath, file), "utf8").replace(/^\uFEFF/, "")); }
    catch { throw new Error("summary_merge_invalid_json"); }
    if (!Array.isArray(summaries)) throw new Error("summary_merge_file_not_array");
    for (const summary of summaries) {
      validateSummary(summary, numericOwnerId);
      if (counterpartId(summary, numericOwnerId) == null) continue;
      const ids = [Number(summary.playerId), Number(summary.characterId)];
      const otherId = ids.find(id => id !== numericOwnerId);
      const previous = byCounterpart.get(otherId);
      if (!previous || compareSummaryDate(summary, previous.summary) < 0
        || compareSummaryDate(summary, previous.summary) === 0 && file.localeCompare(previous.file) < 0) {
        byCounterpart.set(otherId, { file, summary });
      }
    }
  }
  store.summaryConversationFileCache?.set(numericOwnerId, { folderPath, signature: fullSignature,
    byCounterpart: new Map([...byCounterpart].map(([id, item]) => [id, path.join(folderPath, item.file)])) });
  return byCounterpart.has(numericCounterpartId) ? path.join(folderPath, byCounterpart.get(numericCounterpartId).file)
    : fallbackPath();
}

module.exports = { mergeRenamedSummaryFolders, getSummaryConversationFile };
