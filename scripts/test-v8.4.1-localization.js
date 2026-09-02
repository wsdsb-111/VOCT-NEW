"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CK3LocalizationResolver } = require("../resources/app/out/main/worldline/localization-resolver");
const { resolvePlayerPoliticalContext } = require("../resources/app/out/main/worldline/political-context");

function write(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `\uFEFFl_simp_chinese:\n${text}`, "utf8");
}

function makeSnapshot() {
  return {
    playerId: "100",
    characters: {
      "100": { id: "100", firstName: "player_name_key", domainTitles: ["10"] }
    },
    titles: {
      "10": { id: "10", key: "h_single", holder: "100", deFactoLiege: null }
    }
  };
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v841-localization-"));
  try {
    const userFolder = path.join(tempRoot, "Documents", "Paradox Interactive", "Crusader Kings III");
    const steamapps = path.join(tempRoot, "SteamLibrary", "steamapps");
    const baseGameRoot = path.join(steamapps, "common", "Crusader Kings III", "game");
    const modRoot = path.join(steamapps, "workshop", "content", "1158310", "42");
    write(path.join(baseGameRoot, "localization", "simp_chinese", "titles_l_simp_chinese.yml"), [
      'h_single:0 "单一来源"',
      'h_conflict: "基础标题"',
      'h_dynamic: "$TITLE_NAME$"'
    ].join("\n"));
    write(path.join(baseGameRoot, "localization", "simp_chinese", "names", "character_names_l_simp_chinese.yml"), 'player_name_key: "玩家姓名"');
    write(path.join(baseGameRoot, "localization", "simp_chinese", "dynasties", "dynasty_names_l_simp_chinese.yml"), 'dynasty_key: "王氏"');
    write(path.join(baseGameRoot, "localization", "simp_chinese", "culture", "cultures_l_simp_chinese.yml"), 'culture_key: "汉文化"');
    write(path.join(baseGameRoot, "localization", "simp_chinese", "faiths_l_simp_chinese.yml"), 'faith_key: "儒教"');
    write(path.join(baseGameRoot, "localization", "simp_chinese", "wars_l_simp_chinese.yml"), 'war_key: "王位战争"');
    write(path.join(modRoot, "localization", "simp_chinese", "custom_titles_l_simp_chinese.yml"), 'h_conflict: "Mod 标题"');
    const descriptorPath = path.join(userFolder, "mod", "ugc_42.mod");
    fs.mkdirSync(path.dirname(descriptorPath), { recursive: true });
    fs.writeFileSync(descriptorPath, `path="${modRoot.replaceAll("\\", "/")}"\nremote_file_id="42"\n`, "utf8");
    fs.writeFileSync(path.join(userFolder, "dlc_load.json"), JSON.stringify({ enabled_mods: ["mod/ugc_42.mod"], disabled_dlcs: [] }), "utf8");

    const resolver = new CK3LocalizationResolver({ fs, path, getCK3UserFolderPath: () => userFolder });
    const displayLiteral = resolver.resolveForDisplay("character", "思昭");
    assert.equal(displayLiteral.localizedValue, "思昭", "an already-localized character name must remain directly displayable");
    assert.equal(displayLiteral.confidence, "DISPLAY_LITERAL", "an already-localized character name must bypass filesystem localization scans");
    const displayTitle = resolver.resolveForDisplay("title", "h_single");
    assert.equal(displayTitle.localizedValue, "单一来源", "the bounded display resolver may retain typed-file localization");
    assert.ok(displayTitle.scannedFiles <= 250, "worldline display localization must have a hard file-scan bound");
    const title = resolver.resolve("title", "h_single");
    assert.deepEqual({ localizedValue: title.localizedValue, rawKey: title.rawKey, language: title.language, sourceMod: title.sourceMod, confidence: title.confidence }, { localizedValue: "单一来源", rawKey: "h_single", language: "simp_chinese", sourceMod: null, confidence: "CONFIRMED" }, "a unique base localization must preserve identity and expose its display source");
    assert.ok(title.sourceFile.endsWith("titles_l_simp_chinese.yml"), "a confirmed localization must expose its source file");

    const conflict = resolver.resolve("title", "h_conflict");
    assert.equal(conflict.localizedValue, "h_conflict", "conflicting override values must not pick a display winner");
    assert.equal(conflict.confidence, "CONFLICT", "unproven Mod override order must remain explicit");
    assert.equal(conflict.sources.length, 2, "conflicting base and Mod sources must both be retained as evidence");

    const dynamic = resolver.resolve("title", "h_dynamic");
    assert.equal(dynamic.localizedValue, "h_dynamic", "dynamic localization expressions must not be rendered as static text");
    assert.equal(dynamic.confidence, "UNRESOLVED_DYNAMIC_VALUE", "dynamic localization must remain fail-closed");

    for (const [type, key, expected] of [["character", "player_name_key", "玩家姓名"], ["dynasty", "dynasty_key", "王氏"], ["culture", "culture_key", "汉文化"], ["faith", "faith_key", "儒教"], ["war", "war_key", "王位战争"]]) {
      const localized = resolver.resolve(type, key);
      assert.equal(localized.localizedValue, expected, `${type} localization must resolve from its evidence file`);
      assert.equal(localized.rawKey, key, `${type} localization must retain raw identity`);
      assert.equal(localized.confidence, "CONFIRMED", `${type} localization must retain confirmed provenance`);
    }
    const playerNameLookup = resolver.findRawKeysByLocalizedValue("character", "玩家姓名");
    assert.equal(playerNameLookup.status, "MATCHED", "localized-name reverse lookup must report a confirmed match");
    assert.deepEqual(playerNameLookup.matches.map((item) => item.rawKey), ["player_name_key"], "localized-name reverse lookup must return only confirmed raw identities");
    const conflictLookup = resolver.findRawKeysByLocalizedValue("title", "Mod 标题");
    assert.equal(conflictLookup.status, "CONFLICT", "a localized value from an unproven override conflict must not create a reverse identity alias");
    assert.deepEqual(conflictLookup.matches, [], "a localization conflict must fail closed without reverse aliases");

    const missing = resolver.resolve("title", "unknown_title_key");
    assert.equal(missing.localizedValue, "unknown_title_key", "unknown keys must remain raw rather than guessed");
    assert.equal(missing.confidence, "NOT_FOUND", "unknown keys must expose not-found confidence");

    const political = resolvePlayerPoliticalContext(makeSnapshot(), { localize: (type, rawKey) => resolver.resolve(type, rawKey) });
    assert.equal(political.primaryTitle.rawKey, "h_single", "political identity must remain the raw title key");
    assert.equal(political.primaryTitle.displayName, "单一来源", "political context may expose localized display text alongside identity");
    assert.equal(political.topRealmRuler.rawKey, "player_name_key", "character identity must remain the first-name key");
    assert.equal(political.topRealmRuler.displayName, "玩家姓名", "character display text must come from the localization resolver");

    console.log("V8.4.1 Localization: PASS (provenance, conflict preservation, raw fallback and political display separation)");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
