"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CK3LocalizationResolver } = require("../resources/app/out/main/worldline/localization-resolver");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v841-hotfix-layout-"));
try {
  const userFolder = path.join(tempRoot, "Documents", "Paradox Interactive", "Crusader Kings III");
  const steamapps = path.join(tempRoot, "SteamLibrary", "steamapps");
  const baseGameRoot = path.join(steamapps, "common", "Crusader Kings III", "game");
  const modRoot = path.join(steamapps, "workshop", "content", "1158310", "42");
  const localizationPath = path.join(modRoot, "localization", "simp_chinese", "nansong_l_simp_chinese.yml");
  fs.mkdirSync(path.dirname(localizationPath), { recursive: true });
  fs.mkdirSync(path.join(baseGameRoot, "localization", "simp_chinese"), { recursive: true });
  fs.writeFileSync(localizationPath, "\uFEFFl_simp_chinese:\n Yuefei_name:0 \"岳飞\"\n", "utf8");
  const descriptorPath = path.join(userFolder, "mod", "ugc_42.mod");
  fs.mkdirSync(path.dirname(descriptorPath), { recursive: true });
  fs.writeFileSync(descriptorPath, `path="${modRoot.replaceAll("\\", "/")}"\nremote_file_id="42"\n`, "utf8");
  fs.writeFileSync(path.join(userFolder, "dlc_load.json"), JSON.stringify({ enabled_mods: ["mod/ugc_42.mod"] }), "utf8");

  const resolver = new CK3LocalizationResolver({ fs, path, getCK3UserFolderPath: () => userFolder });
  const lookup = resolver.findRawKeysByLocalizedValue("character", "岳飞");
  assert.equal(lookup.status, "MATCHED", "a non-name localization filename must be found by the full-language fallback");
  assert.deepEqual(lookup.matches.map((item) => item.rawKey), ["Yuefei_name"], "fallback localization must preserve the raw character key");
  assert.ok(lookup.scannedFiles >= 1, "fallback lookup must report examined localization files");
  console.log("V8.4.1 Hotfix Localization Layout: PASS (nonstandard character file fallback)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
