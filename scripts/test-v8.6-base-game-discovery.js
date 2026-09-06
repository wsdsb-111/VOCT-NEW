"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { discoverSources } = require("../resources/app/out/main/worldline/historical-source-probe");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v86-discovery-"));
const user = path.join(root, "user");
const makeGame = (library) => {
  const game = path.join(library, "steamapps", "common", "Crusader Kings III", "game");
  fs.mkdirSync(path.join(game, "history", "characters"), { recursive: true });
  return game;
};
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, "utf8"); };

try {
  write(path.join(user, "dlc_load.json"), JSON.stringify({ enabled_mods: [] }));
  const configured = makeGame(path.join(root, "configured"));
  const configuredResult = discoverSources(user, { baseGamePath: configured });
  assert.equal(configuredResult.baseGame.provenance, "CONFIGURED_PATH");
  assert.equal(configuredResult.sources[0].root, configured);

  const steamLibrary = path.join(root, "steam-library");
  const steamGame = makeGame(steamLibrary);
  const vdf = path.join(root, "Steam", "steamapps", "libraryfolders.vdf");
  write(vdf, `"libraryfolders"\n{\n  "0" { "path" "${steamLibrary.replace(/\\/g, "\\\\")}" }\n}`);
  const steamResult = discoverSources(user, { steamLibraryVdfPaths: [vdf] });
  assert.equal(steamResult.baseGame.path, steamGame);
  assert.equal(steamResult.baseGame.provenance, "STEAM_LIBRARY_METADATA");

  const knownLibrary = path.join(root, "known-executable");
  const knownGame = makeGame(knownLibrary);
  const executable = path.join(knownGame, "ck3.exe");
  write(executable, "fixture");
  const executableResult = discoverSources(user, { knownExecutablePaths: [executable] });
  assert.equal(executableResult.baseGame.path, knownGame);
  assert.equal(executableResult.baseGame.provenance, "KNOWN_EXECUTABLE");

  const manualLibrary = path.join(root, "manual");
  const manualGame = makeGame(manualLibrary);
  const manualResult = discoverSources(user, { manualBaseGamePath: manualGame });
  assert.equal(manualResult.baseGame.path, manualGame);
  assert.equal(manualResult.baseGame.provenance, "MANUAL_FALLBACK");

  const secondLibrary = path.join(root, "steam-library-two");
  makeGame(secondLibrary);
  const ambiguousVdf = path.join(root, "Steam-ambiguous", "steamapps", "libraryfolders.vdf");
  write(ambiguousVdf, `"libraryfolders"\n{\n "0" { "path" "${steamLibrary.replace(/\\/g, "\\\\")}" }\n "1" { "path" "${secondLibrary.replace(/\\/g, "\\\\")}" }\n}`);
  const ambiguous = discoverSources(user, { steamLibraryVdfPaths: [ambiguousVdf] });
  assert.equal(ambiguous.baseGame.status, "SELECTION_REQUIRED");
  assert(ambiguous.missing.includes("BASE_GAME_SELECTION_REQUIRED"));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("V8.6 Base Game Discovery: PASS (configured, Steam metadata, executable, manual fallback and ambiguity)");
