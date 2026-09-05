"use strict";

const crypto = require("node:crypto");
const fs = require("fs");
const path = require("path");

const SOURCE_DIRECTORIES = [["history/characters", ".txt"], ["common/dynasties", ".txt"], ["common/dynasty_houses", ".txt"], ["localization/simp_chinese", ".yml"]];

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
  const missing = [], sources = []; let complete = !!userFolder, base = null, configHash = null;
  try {
    const config = fs.readFileSync(path.join(userFolder, "dlc_load.json"), "utf8");
    configHash = crypto.createHash("sha256").update(config).digest("hex");
    const load = JSON.parse(config);
    if (!Array.isArray(load.enabled_mods)) { missing.push("ENABLED_MODS_UNAVAILABLE"); complete = false; }
    for (const relative of Array.isArray(load.enabled_mods) ? load.enabled_mods : []) {
      const file = path.resolve(userFolder, relative); if (!fs.existsSync(file)) { missing.push(relative); complete = false; continue; }
      const descriptorText = fs.readFileSync(file, "utf8");
      const item = descriptor(descriptorText);
      if (item.unsupported) { missing.push(`UNSUPPORTED_SOURCE_SEMANTICS:${relative}`); complete = false; }
      const root = item.root ? path.resolve(userFolder, item.root) : null;
      if (!root || !fs.existsSync(root)) { missing.push(relative); complete = false; continue; }
      const internalDescriptor = path.join(root, "descriptor.mod");
      const internalText = fs.existsSync(internalDescriptor) ? fs.readFileSync(internalDescriptor, "utf8") : "";
      if (descriptor(internalText).unsupported) { missing.push(`UNSUPPORTED_SOURCE_SEMANTICS:${internalDescriptor}`); complete = false; }
      const inferred = baseRoot(root);
      if (!base && inferred && fs.existsSync(inferred)) base = inferred;
      sources.push({ root, modId: item.modId, sourceId: `mod:${item.modId || root}`, descriptorHash: crypto.createHash("sha256").update(`${descriptorText}\0${internalText}`).digest("hex") });
    }
  } catch (_error) { complete = false; missing.push("SOURCE_CONFIG_UNAVAILABLE"); }
  if (base && fs.existsSync(base)) sources.unshift({ root: base, modId: null, sourceId: "base" }); else { complete = false; missing.push("BASE_GAME_UNAVAILABLE"); }
  return { sources, complete, missing, configHash };
}

// Runs only in the historical Worker. Read small configuration files, then stat
// the source inventory; never read/parse history or localization bodies here.
function probeHistoricalSources({ userFolder, policyVersion, aliases = [] }) {
  const discovered = discoverSources(userFolder);
  const hash = crypto.createHash("sha256").update(JSON.stringify([userFolder, policyVersion, aliases, discovered]));
  let fileCount = 0;
  for (const source of discovered.sources) for (const [relative, suffix] of SOURCE_DIRECTORIES) {
    const directory = path.join(source.root, ...relative.split("/"));
    hash.update(JSON.stringify([directory, fs.existsSync(directory)]));
    for (const file of listFiles(directory, suffix)) {
      const stat = fs.statSync(file);
      hash.update(JSON.stringify([file, stat.size, stat.mtimeMs, stat.ctimeMs]));
      fileCount += 1;
    }
  }
  return { ...discovered, fingerprint: hash.digest("hex"), fileCount };
}

module.exports = { SOURCE_DIRECTORIES, discoverSources, listFiles, probeHistoricalSources };
