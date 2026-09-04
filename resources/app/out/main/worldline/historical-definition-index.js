"use strict";

const crypto = require("node:crypto");
const fs = require("fs");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { scanDirectEntries } = require("./game-state-adapter");

const POLICY_VERSION = "v8.5.1-historical-index-3";
const normalize = value => String(value || "").trim().normalize("NFKC").toLocaleLowerCase();
const literalName = value => /[\u3400-\u9fff\uf900-\ufaff]/u.test(String(value || "")) ? String(value).trim() : null;

function descriptor(text) {
  return { root: text.match(/^\s*path\s*=\s*"([^"]+)"/m)?.[1] || null, modId: text.match(/^\s*remote_file_id\s*=\s*"?(\d+)"?/m)?.[1] || null, unsupported: /^\s*archive\s*=/m.test(text) || [...text.matchAll(/^\s*replace_path\s*=\s*"([^"]+)"/gm)].some(match => /^(history(?:\/characters)?|common(?:\/(?:dynasties|dynasty_houses))?|localization)(?:\/|$)/.test(match[1])) };
}
function baseRoot(modRoot) {
  const parts = path.resolve(modRoot).split(path.sep); const index = parts.findIndex(part => part.toLowerCase() === "steamapps");
  return index < 0 ? null : path.join(parts.slice(0, index + 1).join(path.sep), "common", "Crusader Kings III", "game");
}
function listFiles(root, suffix) {
  if (!root || !fs.existsSync(root)) return [];
  const files = [], pending = [root];
  while (pending.length) { const current = pending.pop(); for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) pending.push(full); else if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix)) files.push(full);
  } }
  return files.sort((a, b) => a.localeCompare(b));
}
function discoverSources(userFolder) {
  const missing = [], sources = []; let complete = !!userFolder, base = null;
  try {
    const load = JSON.parse(fs.readFileSync(path.join(userFolder, "dlc_load.json"), "utf8"));
    for (const relative of Array.isArray(load.enabled_mods) ? load.enabled_mods : []) {
      const file = path.resolve(userFolder, relative); if (!fs.existsSync(file)) { missing.push(relative); complete = false; continue; }
      const descriptorText = fs.readFileSync(file, "utf8");
      const item = descriptor(descriptorText);
      if (item.unsupported) { missing.push(`UNSUPPORTED_SOURCE_SEMANTICS:${relative}`); complete = false; }
      const root = item.root ? path.resolve(userFolder, item.root) : null;
      if (!root || !fs.existsSync(root)) { missing.push(relative); complete = false; continue; }
      const inferred = baseRoot(root);
      if (!base && inferred && fs.existsSync(inferred)) base = inferred;
      sources.push({ root, modId: item.modId, sourceId: `mod:${item.modId || root}`, descriptorHash: crypto.createHash("sha256").update(descriptorText).digest("hex") });
    }
  } catch (_error) { complete = false; }
  if (base && fs.existsSync(base)) sources.unshift({ root: base, modId: null, sourceId: "base" }); else complete = false;
  return { sources, complete, missing };
}
function fields(block) {
  const values = Object.create(null);
  scanDirectEntries(block, 0, block.length, (key, value) => {
    if (value.kind === "scalar" && ["name", "dynasty", "dynasty_house", "culture", "female", "father", "mother"].includes(key)) values[key] = value.value;
    if (/^\d+\.\d+\.\d+$/.test(key) && value.kind === "block" && /\bbirth\s*=/.test(block.slice(value.start, value.end))) scanDirectEntries(block, value.start, value.end, (field, item) => {
      if (field === "birth" && item.kind === "scalar" && item.value === "yes") values.birth = key;
    });
  });
  return { name: values.name || null, dynasty: values.dynasty || null, house: values.dynasty_house || null, culture: values.culture || null, gender: values.female === "yes" ? "female" : values.female === "no" ? "male" : "unknown", birthDate: values.birth || null };
}
function blocks(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""), output = [];
  if (!text.includes("{")) return output;
  let previous = 0, line = 1;
  scanDirectEntries(text, 0, text.length, (id, value) => {
    if (value.kind !== "block") return;
    for (let i = previous; i < value.start; i += 1) if (text[i] === "\n") line += 1;
    previous = value.start;
    output.push({ id, line, text: text.slice(value.start, value.end) });
  });
  return output;
}
function localization(sources) {
  const values = new Map();
  for (const source of sources) for (const file of listFiles(path.join(source.root, "localization", "simp_chinese"), ".yml")) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^\s*([^\s:#]+):\s*(?:\d+\s*)?"((?:\\.|[^"\\])*)"/); if (!match || /[\[\]$]/.test(match[2])) continue; const value = match[2].replace(/\\"/g, '"'); if (!values.has(match[1])) values.set(match[1], new Set()); values.get(match[1]).add(value); }
  }
  return values;
}
function sourceRevision(sources) {
  const hash = crypto.createHash("sha256").update(POLICY_VERSION, "utf8");
  for (const source of sources) {
    hash.update(`${source.root}:${source.sourceId || source.root}:${source.descriptorHash || ""}\n`, "utf8");
    for (const [relativeRoot, suffix] of [["history/characters", ".txt"], ["common/dynasties", ".txt"], ["common/dynasty_houses", ".txt"], ["localization/simp_chinese", ".yml"]]) {
      const root = path.join(source.root, ...relativeRoot.split("/"));
      for (const file of listFiles(root, suffix)) {
        hash.update(`${source.sourceId || source.root}:${path.relative(source.root, file)}\n`, "utf8");
        hash.update(fs.readFileSync(file));
      }
    }
  }
  return hash.digest("hex").slice(0, 16);
}
function buildHistoricalDefinitionIndex({ sources, complete = true, missing = [], aliases = [], onProgress = () => {} }) {
  missing = missing.slice();
  const readBlocks = file => {
    try { return blocks(file); }
    catch (error) { complete = false; missing.push(`${error.message}:${file}`); return []; }
  };
  const readFields = (block, file) => {
    try { return fields(block.text); }
    catch (error) { complete = false; missing.push(`${error.message}:${file}:${block.line}`); return {}; }
  };
  onProgress("fingerprint");
  const beforeRevision = sourceRevision(sources);
  onProgress("localization");
  const translations = localization(sources); const rows = new Map();
  onProgress("characters");
  for (const source of sources) for (const file of listFiles(path.join(source.root, "history", "characters"), ".txt")) for (const block of readBlocks(file)) {
    const item = readFields(block, file); const row = { definitionId: block.id, ...item, source: { sourceId: source.sourceId, modId: source.modId, relativeFile: path.relative(source.root, file), line: block.line } };
    if (!rows.has(block.id)) rows.set(block.id, []); rows.get(block.id).push(row);
  }
  const dynastyNames = new Map();
  onProgress("dynasties");
  for (const source of sources) for (const file of listFiles(path.join(source.root, "common", "dynasties"), ".txt")) for (const block of readBlocks(file)) {
    const name = readFields(block, file).name;
    if (!name) continue;
    if (!dynastyNames.has(block.id)) dynastyNames.set(block.id, new Set());
    dynastyNames.get(block.id).add(name);
  }
  const houses = new Map();
  onProgress("houses");
  for (const source of sources) for (const file of listFiles(path.join(source.root, "common", "dynasty_houses"), ".txt")) for (const block of readBlocks(file)) {
    const item = readFields(block, file);
    if (!houses.has(block.id)) houses.set(block.id, []);
    houses.get(block.id).push(item);
  }
  const byId = Object.create(null), exactNames = Object.create(null), exactAliases = Object.create(null);
  onProgress("names");
  for (const [definitionId, sourceRows] of rows) {
    const names = new Map(), nameConflicts = new Set();
    for (const row of sourceRows) {
      const given = literalName(row.name) || (translations.get(row.name)?.size === 1 ? literalName([...translations.get(row.name)][0]) : null);
      const houseRows = houses.get(row.house) || [];
      const houseNames = new Set(houseRows.map(item => item.name).filter(Boolean));
      const houseDynasties = new Set(houseRows.map(item => item.dynasty).filter(Boolean));
      const dynastyKeys = dynastyNames.get(row.dynasty || (houseDynasties.size === 1 ? [...houseDynasties][0] : null));
      const dynastyKey = dynastyKeys?.size === 1 ? [...dynastyKeys][0] : null;
      const familyKey = houseNames.size === 1 ? [...houseNames][0] : dynastyKey;
      const family = literalName(familyKey) || (translations.get(familyKey)?.size === 1 ? literalName([...translations.get(familyKey)][0]) : null);
      if (translations.get(row.name)?.size > 1 || translations.get(familyKey)?.size > 1 || dynastyKeys?.size > 1 || houseNames.size > 1 || houseDynasties.size > 1) nameConflicts.add("NAME_SOURCE_CONFLICT");
      // A Chinese given name is not a full name when its surname source is missing.
      const full = given && family && family.length === 1 && /^(han|chinese)(?:_|$)/.test(row.culture || "") ? (given.startsWith(family) ? given : `${family}${given}`) : !row.dynasty && !row.house && given?.length > 1 ? given : null;
      if (full) names.set(normalize(full), full);
    }
    const conflict = new Set(sourceRows.map(row => JSON.stringify([row.name, row.dynasty, row.house, row.culture, row.birthDate, row.gender]))).size > 1;
    const record = { definitionId, displayName: names.size === 1 ? [...names.values()][0] : null, names: [...names.values()], sourceRows, metadata: { birthDate: sourceRows[0]?.birthDate || null, gender: sourceRows[0]?.gender || "unknown", culture: sourceRows[0]?.culture || null }, conflicts: [...(conflict ? ["DEFINITION_SOURCE_CONFLICT"] : []), ...nameConflicts], sourceComplete: complete };
    byId[definitionId] = record;
    for (const name of record.names) { const key = normalize(name); if (!exactNames[key]) exactNames[key] = []; exactNames[key].push(definitionId); }
  }
  for (const entry of aliases) for (const alias of entry?.aliases || []) {
    const ids = (entry?.candidateDefinitionIds || []).filter((definitionId) => byId[definitionId]);
    if (!alias || !ids.length) continue;
    const key = normalize(alias);
    exactAliases[key] = [...new Set([...(exactAliases[key] || []), ...ids])];
  }
  const afterRevision = sourceRevision(sources);
  if (beforeRevision !== afterRevision) { complete = false; missing = [...missing, "SOURCE_CHANGED_DURING_BUILD"]; }
  const digest = crypto.createHash("sha256").update(`${afterRevision}:${complete}:${JSON.stringify(missing)}:${JSON.stringify(aliases.map((entry) => [entry.figureKey || null, entry.aliases || [], entry.candidateDefinitionIds || []]))}`, "utf8").digest("hex").slice(0, 16);
  return { policyVersion: POLICY_VERSION, revision: digest, state: complete ? "READY" : "PARTIAL", sourceComplete: complete, missing, byId, exactNames, exactAliases, diagnostics: { definitionCount: Object.keys(byId).length, searchableCount: Object.keys(exactNames).length, aliasCount: Object.keys(exactAliases).length, conflictCount: Object.values(byId).filter(record => record.conflicts.length).length } };
}
function lookup(index, value) {
  const key = normalize(value);
  if (!index || index.state === "BUILDING") return { status: "SOURCE_INCOMPLETE", candidates: [], sourceComplete: false };
  const nameIds = Object.hasOwn(index.exactNames, key) ? index.exactNames[key] : [];
  const aliasIds = Object.hasOwn(index.exactAliases, key) ? index.exactAliases[key] : [];
  const ids = [...new Set([...nameIds, ...aliasIds])];
  return ids.length ? { status: "FOUND", matchType: nameIds.length ? "NAME_EXACT" : "NAME_ALIAS", candidates: ids.slice(0, 200).map(id => index.byId[id]), candidateTotal: ids.length, candidateSetComplete: ids.length <= 200, sourceComplete: index.sourceComplete, revision: index.revision } : { status: index.sourceComplete ? "NAME_INDEX_MISS" : "SOURCE_INCOMPLETE", candidates: [], sourceComplete: index.sourceComplete, revision: index.revision };
}

if (!isMainThread && workerData?.historicalDefinitionIndex) {
  let index = null, sourceConfig = null, refreshTimer = null;
  const build = () => {
    parentPort.postMessage({ type: "checking" });
    const sources = discoverSources(sourceConfig.userFolder);
    index = buildHistoricalDefinitionIndex({ ...sources, aliases: sourceConfig.aliases || [], onProgress: stage => parentPort.postMessage({ type: "progress", stage }) });
    parentPort.postMessage({ type: "built", meta: { policyVersion: index.policyVersion, revision: index.revision, state: index.state, sourceComplete: index.sourceComplete, missing: index.missing, diagnostics: index.diagnostics } });
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { try { build(); } catch (error) { parentPort.postMessage({ type: "failed", reason: error.message }); } }, 60000);
    refreshTimer.unref();
  };
  parentPort.on("message", (message) => {
    try {
      if (message?.type === "build") { sourceConfig = message; build(); }
      else if (message?.type === "lookup") parentPort.postMessage({ type: "lookup", requestId: message.requestId, result: lookup(index, message.value) });
    } catch (error) { parentPort.postMessage({ type: "failed", requestId: message?.requestId || null, reason: error.message }); }
  });
}

class HistoricalDefinitionIndexClient {
  constructor({ getCK3UserFolderPath, onUpdated = () => {}, WorkerClass = Worker, aliases = [] } = {}) {
    this.getFolder = getCK3UserFolderPath || (() => null);
    this.onUpdated = onUpdated;
    this.WorkerClass = WorkerClass;
    this.aliases = aliases;
    this.meta = null;
    this.cache = new Map();
    this.building = null;
    this.failed = false;
    this.worker = null;
    this.requests = new Map();
    this.pendingValues = new Map();
    this.nextRequestId = 1;
    this.generation = 0;
    this.folder = null;
    this.buildTimer = null;
    this.finishBuild = null;
    this.checking = false;
  }
  _incomplete(pending = false) {
    return { status: "SOURCE_INCOMPLETE", candidates: [], sourceComplete: false, pending, revision: this.meta?.revision || null };
  }
  _fail(worker) {
    if (this.worker !== worker) return;
    this.dispose();
    this.failed = true;
    this.onUpdated();
  }
  _request(value) {
    const key = normalize(value);
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (!this.worker || !["READY", "PARTIAL"].includes(this.status)) return Promise.resolve(this._incomplete(true));
    if (this.pendingValues.has(key)) return this.pendingValues.get(key);
    if (this.requests.size >= 64) return Promise.resolve(this._incomplete(true));
    const worker = this.worker, requestId = this.nextRequestId++;
    let resolve;
    const pending = new Promise(finish => { resolve = finish; });
    const timer = setTimeout(() => this._fail(worker), 30000);
    timer.unref?.();
    this.requests.set(requestId, { key, resolve, timer });
    this.pendingValues.set(key, pending);
    try { worker.postMessage({ type: "lookup", requestId, value: key }); }
    catch (_error) { this._fail(worker); }
    return pending;
  }
  start() {
    const folder = this.getFolder();
    if (this.folder !== folder) { this.invalidate(); this.folder = folder; }
    if (this.building || this.meta || this.failed || !folder) return this.building;
    try {
      const worker = new this.WorkerClass(__filename, { workerData: { historicalDefinitionIndex: true } });
      this.worker = worker;
      worker.unref?.();
      this.building = new Promise(resolve => { this.finishBuild = resolve; });
      this.buildTimer = setTimeout(() => this._fail(worker), 120000);
      this.buildTimer.unref?.();
      worker.on("message", (message) => {
        if (this.worker !== worker) return;
        if (message?.type === "checking") {
          this.checking = true;
          clearTimeout(this.buildTimer);
          this.buildTimer = setTimeout(() => this._fail(worker), 120000);
          this.buildTimer.unref?.();
          this.cache.clear();
          this.onUpdated();
        } else if (message?.type === "built") {
          clearTimeout(this.buildTimer);
          this.meta = message.meta;
          this.checking = false;
          this.failed = false;
          this.cache.clear();
          this.finishBuild?.(this.meta);
          this.finishBuild = null;
          this.building = null;
          this.onUpdated();
        } else if (message?.type === "lookup" || message?.type === "failed" && message.requestId) {
          const request = this.requests.get(message.requestId);
          if (!request) return;
          clearTimeout(request.timer);
          this.requests.delete(message.requestId);
          this.pendingValues.delete(request.key);
          const result = message.result || this._incomplete();
          // Only the owning worker may populate this generation's cache.
          if (!this.checking && result.revision === this.meta?.revision) {
            this.cache.set(request.key, result);
            if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value);
          }
          request.resolve(result);
          if (!this.requests.size) this.onUpdated();
        } else if (message?.type === "failed") this._fail(worker);
      });
      worker.once("error", () => this._fail(worker));
      worker.once("exit", () => this._fail(worker));
      worker.postMessage({ type: "build", userFolder: folder, aliases: this.aliases });
    } catch (_error) { this.dispose(); this.failed = true; }
    return this.building;
  }
  get status() { return this.checking ? "BUILDING" : this.meta?.state || (this.building ? "BUILDING" : this.failed ? "FAILED" : "UNCONFIGURED"); }
  find(value) {
    this.start();
    const key = normalize(value);
    if (this.cache.has(key)) return this.cache.get(key);
    if (["READY", "PARTIAL"].includes(this.status)) this._request(key);
    return this._incomplete(!!this.worker);
  }
  async _bounded(pending, timeoutMs) {
    if (!pending) return null;
    if (!timeoutMs) return pending;
    let timer;
    try { return await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  async ready(timeoutMs = 0) { await this._bounded(this.start(), timeoutMs); return this.meta; }
  async prepare(values, timeoutMs = 0) {
    const deadline = timeoutMs ? Date.now() + timeoutMs : null;
    await this.ready(timeoutMs);
    if (!["READY", "PARTIAL"].includes(this.status) || deadline && Date.now() >= deadline) return [];
    const missing = [...new Set((values || []).map(normalize).filter(value => value && !this.cache.has(value)))].slice(0, 64);
    return await this._bounded(Promise.all(missing.map(value => this._request(value))), deadline ? Math.max(1, deadline - Date.now()) : 0) || [];
  }
  invalidate() { this.dispose(); this.failed = false; }
  dispose() {
    this.generation += 1;
    clearTimeout(this.buildTimer);
    const worker = this.worker;
    this.worker = null;
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.resolve(this._incomplete()); }
    this.requests.clear();
    this.pendingValues.clear();
    this.finishBuild?.(null);
    this.finishBuild = null;
    this.building = null;
    this.checking = false;
    this.meta = null;
    this.cache.clear();
    worker?.terminate?.();
  }
}
module.exports = { HistoricalDefinitionIndexClient, POLICY_VERSION, buildHistoricalDefinitionIndex, discoverSources, lookup };
