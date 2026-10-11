"use strict";

const crypto = require("node:crypto");
const fs = require("fs");
const path = require("path");

const SOURCE_DIRECTORIES = [["history/characters", ".txt"], ["common/dynasties", ".txt"], ["common/dynasty_houses", ".txt"], ["localization/simp_chinese", ".yml"]];

function descriptor(text) {
  return { root: text.match(/^\s*path\s*=\s*"([^"]+)"/m)?.[1] || null, modId: text.match(/^\s*remote_file_id\s*=\s*"?(\d+)"?/m)?.[1] || null, unsupported: /^\s*archive\s*=/m.test(text) || [...text.matchAll(/^\s*replace_path\s*=\s*"([^"]+)"/gm)].some(match => /^(history(?:\/characters)?|common(?:\/(?:dynasties|dynasty_houses))?|localization)(?:\/|$)/.test(match[1])) };
}

function gameRoot(candidate) {
  if (!candidate) return null;
  const resolved = path.resolve(candidate);
  const root = path.basename(resolved).toLowerCase() === "ck3.exe" ? path.dirname(resolved) : path.basename(resolved).toLowerCase() === "game" ? resolved : path.join(resolved, "game");
  return fs.existsSync(path.join(root, "history", "characters")) ? root : null;
}

function inferredBaseRoot(modRoot) {
  const parts = path.resolve(modRoot).split(path.sep);
  const index = parts.findIndex(part => part.toLowerCase() === "steamapps");
  return index < 0 ? null : gameRoot(path.join(parts.slice(0, index + 1).join(path.sep), "common", "Crusader Kings III"));
}

function listFiles(root, suffix) {
  if (!root || !fs.existsSync(root)) return [];
  const files = [], pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix)) files.push(full);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function steamLibraryRoots(vdfPaths) {
  const roots = [];
  for (const file of vdfPaths || []) {
    try {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) roots.push(match[1].replace(/\\\\/g, "\\"));
    } catch (_error) {
      // Missing metadata is a normal discovery fallback, never a drive scan.
    }
  }
  return roots;
}

function defaultSteamVdfPaths() {
  const roots = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.STEAM_PATH].filter(Boolean);
  return [...new Set(roots.map(root => path.join(root, "Steam", "steamapps", "libraryfolders.vdf")))];
}

function watchSignature(files) {
  return (files || []).map((file) => {
    try {
      const stat = fs.statSync(file);
      return `${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    } catch (_error) {
      return `${file}:MISSING`;
    }
  }).sort().join("|");
}

function chooseBase(candidates, provenance) {
  const roots = [...new Set((candidates || []).map(gameRoot).filter(Boolean).map(root => path.resolve(root)))];
  if (roots.length === 1) return { path: roots[0], provenance, status: "READY" };
  if (roots.length > 1) return { path: null, provenance: "AMBIGUOUS", status: "SELECTION_REQUIRED", candidates: roots };
  return null;
}

function discoverSources(userFolder, options = {}) {
  const missing = [], sources = [], watchFiles = [path.join(userFolder || "", "dlc_load.json")];
  let complete = !!userFolder;
  let configHash = null;
  let inferredBase = null;
  try {
    const config = fs.readFileSync(path.join(userFolder, "dlc_load.json"), "utf8");
    configHash = crypto.createHash("sha256").update(config).digest("hex");
    const load = JSON.parse(config);
    if (!Array.isArray(load.enabled_mods)) { missing.push("ENABLED_MODS_UNAVAILABLE"); complete = false; }
    for (const relative of Array.isArray(load.enabled_mods) ? load.enabled_mods : []) {
      const file = path.resolve(userFolder, relative);
      if (!fs.existsSync(file)) { missing.push(relative); complete = false; continue; }
      watchFiles.push(file);
      const descriptorText = fs.readFileSync(file, "utf8");
      const item = descriptor(descriptorText);
      if (item.unsupported) { missing.push(`UNSUPPORTED_SOURCE_SEMANTICS:${relative}`); complete = false; }
      const root = item.root ? path.resolve(userFolder, item.root) : null;
      if (!root || !fs.existsSync(root)) { missing.push(relative); complete = false; continue; }
      const internalDescriptor = path.join(root, "descriptor.mod");
      watchFiles.push(internalDescriptor);
      const internalText = fs.existsSync(internalDescriptor) ? fs.readFileSync(internalDescriptor, "utf8") : "";
      if (descriptor(internalText).unsupported) { missing.push(`UNSUPPORTED_SOURCE_SEMANTICS:${internalDescriptor}`); complete = false; }
      inferredBase ||= inferredBaseRoot(root);
      sources.push({ root, modId: item.modId, sourceId: `mod:${item.modId || root}`, descriptorHash: crypto.createHash("sha256").update(`${descriptorText}\0${internalText}`).digest("hex") });
    }
  } catch (_error) { complete = false; missing.push("SOURCE_CONFIG_UNAVAILABLE"); }

  const configured = chooseBase([options.baseGamePath], "CONFIGURED_PATH");
  const steam = chooseBase(steamLibraryRoots(options.steamLibraryVdfPaths || defaultSteamVdfPaths()).map(root => path.join(root, "steamapps", "common", "Crusader Kings III")), "STEAM_LIBRARY_METADATA");
  const executable = chooseBase(options.knownExecutablePaths || [], "KNOWN_EXECUTABLE");
  const inferred = chooseBase([inferredBase], "MOD_INFERENCE");
  const manual = chooseBase([options.manualBaseGamePath], "MANUAL_FALLBACK");
  const baseGame = configured || steam || executable || inferred || manual || { path: null, provenance: null, status: "UNAVAILABLE" };
  if (baseGame.status === "READY") sources.unshift({ root: baseGame.path, modId: null, sourceId: "base", provenance: baseGame.provenance });
  else {
    complete = false;
    missing.push(baseGame.status === "SELECTION_REQUIRED" ? "BASE_GAME_SELECTION_REQUIRED" : "BASE_GAME_UNAVAILABLE");
  }
  return { sources, complete, missing: [...new Set(missing)], configHash, baseGame, watchFiles, watchSignature: watchSignature(watchFiles) };
}

// Periodic checks receive a resolved discovery object and only stat its sources.
function probeHistoricalSources({ userFolder, policyVersion, aliases = [], discovery = null, ...options }) {
  const discovered = discovery || discoverSources(userFolder, options);
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

module.exports = { SOURCE_DIRECTORIES, discoverSources, gameRoot, listFiles, probeHistoricalSources, watchSignature };
