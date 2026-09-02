"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CK3LocalizationResolver } = require("../resources/app/out/main/worldline/localization-resolver");

function writeLocalization(filePath, lines) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `\uFEFFl_simp_chinese:\n${lines.join("\n")}\n`, "utf8");
}

function writeDescriptor(userFolder, name, modRoot, modId) {
  const descriptorPath = path.join(userFolder, "mod", name);
  fs.mkdirSync(path.dirname(descriptorPath), { recursive: true });
  fs.writeFileSync(descriptorPath, `path="${modRoot.replaceAll("\\", "/")}"\nremote_file_id="${modId}"\n`, "utf8");
  return `mod/${name}`;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v841-sol-source-"));
try {
  const userFolder = path.join(tempRoot, "Documents", "Paradox Interactive", "Crusader Kings III");
  const libraryWithoutGame = path.join(tempRoot, "LibraryA", "steamapps");
  const libraryWithGame = path.join(tempRoot, "LibraryB", "steamapps");
  const firstMod = path.join(libraryWithoutGame, "workshop", "content", "1158310", "1");
  const secondMod = path.join(libraryWithGame, "workshop", "content", "1158310", "2");
  const baseGameRoot = path.join(libraryWithGame, "common", "Crusader Kings III", "game");
  fs.mkdirSync(firstMod, { recursive: true });
  fs.mkdirSync(secondMod, { recursive: true });
  writeLocalization(path.join(baseGameRoot, "localization", "simp_chinese", "names_l_simp_chinese.yml"), ['base_name:0 "基础名"']);
  const firstDescriptor = writeDescriptor(userFolder, "ugc_1.mod", firstMod, "1");
  const secondDescriptor = writeDescriptor(userFolder, "ugc_2.mod", secondMod, "2");
  fs.writeFileSync(path.join(userFolder, "dlc_load.json"), JSON.stringify({ enabled_mods: [firstDescriptor, secondDescriptor] }), "utf8");

  const resolver = new CK3LocalizationResolver({ fs, path, getCK3UserFolderPath: () => userFolder });
  const multiLibrary = resolver.findRawKeysByLocalizedValue("character", "基础名");
  assert.equal(multiLibrary.status, "MATCHED", "source discovery must continue past an invalid first Steam library and select a later library containing CK3");
  assert.equal(multiLibrary.sourceComplete, true, "a proven later-library base game plus all descriptors must form a complete source set");
  assert.deepEqual(multiLibrary.matches.map((item) => item.rawKey), ["base_name"], "the selected base game must provide localization identity evidence");

  const noModFolder = path.join(tempRoot, "NoMods", "Crusader Kings III");
  fs.mkdirSync(noModFolder, { recursive: true });
  fs.writeFileSync(path.join(noModFolder, "dlc_load.json"), JSON.stringify({ enabled_mods: [] }), "utf8");
  const noModResolver = new CK3LocalizationResolver({ fs, path, getCK3UserFolderPath: () => noModFolder });
  const noModLookup = noModResolver.findRawKeysByLocalizedValue("character", "基础名");
  assert.equal(noModLookup.status, "INCOMPLETE_SOURCE_SCAN", "without a discoverable base game, a no-Mod playset must fail closed instead of reporting NO_MATCH");

  const localUserFolder = path.join(tempRoot, "LocalModUser", "Crusader Kings III");
  const localModRoot = path.join(tempRoot, "LocalMods", "outside-steam");
  writeLocalization(path.join(localModRoot, "localization", "simp_chinese", "history_l_simp_chinese.yml"), ['local_name:0 "本地人物"']);
  const localDescriptor = writeDescriptor(localUserFolder, "local.mod", localModRoot, "3");
  fs.writeFileSync(path.join(localUserFolder, "dlc_load.json"), JSON.stringify({ enabled_mods: [localDescriptor] }), "utf8");
  const localResolver = new CK3LocalizationResolver({ fs, path, getCK3UserFolderPath: () => localUserFolder });
  const localLookup = localResolver.findRawKeysByLocalizedValue("character", "本地人物");
  assert.equal(localLookup.status, "INCOMPLETE_SOURCE_SCAN", "a local Mod without a discoverable base game must remain incomplete");
  assert.deepEqual(localLookup.matchedRawKeys, ["local_name"], "known local-Mod evidence must remain visible in diagnostics even though identity matching fails closed");
  assert.deepEqual(localLookup.matches, [], "partial local-Mod evidence must not become a confirmed identity alias");

  writeLocalization(path.join(secondMod, "localization", "simp_chinese", "china_l_simp_chinese.yml"), ['raw_a:0 "同名"', 'raw_b:0 "同名"', 'dynamic_name:0 "$OTHER_NAME$"']);
  resolver.invalidate();
  const sameValue = resolver.findRawKeysByLocalizedValue("character", "同名");
  assert.equal(sameValue.status, "CONFLICT", "one localized value with multiple raw keys must never silently choose an identity");
  assert.deepEqual(sameValue.matches, [], "localization alias conflicts must fail closed");
  assert.equal(resolver.resolve("character", "dynamic_name").confidence, "UNRESOLVED_DYNAMIC_VALUE", "dynamic localization expressions must remain unresolved");

  console.log("V8.4.1 Hotfix Sol Source Discovery: PASS (multi-library fallback and fail-closed edge cases)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
