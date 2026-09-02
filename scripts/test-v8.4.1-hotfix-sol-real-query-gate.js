"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CK3LocalizationResolver } = require("../resources/app/out/main/worldline/localization-resolver");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v841-sol-query-"));
try {
  const userFolder = path.join(tempRoot, "Documents", "Paradox Interactive", "Crusader Kings III");
  const steamapps = path.join(tempRoot, "SteamLibrary", "steamapps");
  const baseGameRoot = path.join(steamapps, "common", "Crusader Kings III", "game");
  const modRoot = path.join(steamapps, "workshop", "content", "1158310", "42");
  const localizationPath = path.join(modRoot, "localization", "simp_chinese", "hanfan_titles_l_simp_chinese.yml");
  fs.mkdirSync(path.dirname(localizationPath), { recursive: true });
  fs.mkdirSync(path.join(baseGameRoot, "localization", "simp_chinese"), { recursive: true });
  fs.writeFileSync(localizationPath, '\uFEFFl_simp_chinese:\n hanfan_gaizhi_jun_c_zhuozhou:0 "涿郡"\n c_nf_zhuojun_zhao:0 "涿郡赵氏"\n c_nf_zhuojun_liu:0 "涿郡刘氏"\n h_china:0 "中华"\n', "utf8");
  const descriptorPath = path.join(userFolder, "mod", "ugc_42.mod");
  fs.mkdirSync(path.dirname(descriptorPath), { recursive: true });
  fs.writeFileSync(descriptorPath, `path="${modRoot.replaceAll("\\", "/")}"\nremote_file_id="42"\n`, "utf8");
  fs.writeFileSync(path.join(userFolder, "dlc_load.json"), JSON.stringify({ enabled_mods: ["mod/ugc_42.mod"] }), "utf8");

  const snapshot = {
    characters: { "96896": { id: "96896", firstName: "飞" }, "96895": { id: "96895", firstName: "Fei_name11" } },
    nameToCharacterIds: { fei_name11: ["96895"] },
    definitionToRuntime: { nansong_yue_085: "96896", tangyin_yue_014: "96895" },
    runtimeToDefinitions: { "96896": ["nansong_yue_085"], "96895": ["tangyin_yue_014"] },
    titles: { "156": { id: "156", key: "c_nf_zhuojun_zhao", holder: "96896" }, "1": { id: "1", key: "h_china", holder: "96896" } }
  };
  const resolver = new CK3LocalizationResolver({ fs, path, getCK3UserFolderPath: () => userFolder });
  const analyze = (query, currentSnapshot = snapshot) => analyzeSharedQuery({
    snapshot: currentSnapshot,
    query,
    localize: (type, rawKey) => resolver.resolve(type, rawKey),
    findLocalizedKeys: (type, value, options) => resolver.findRawKeysByLocalizedValue(type, value, options)
  });

  const yueFei = analyze("岳飞");
  assert.deepEqual(yueFei.characters.map((item) => item.id), ["96896", "96895"], "岳飞 must reach every directly bound runtime without silently choosing a Definition");
  assert.equal(yueFei.resolverTrace.historical.status, "AMBIGUOUS", "multi-Definition historical aliases must remain explicit");
  assert.deepEqual(analyze("岳飞现在在哪里").characters.map((item) => item.id), ["96896", "96895"], "a Chinese sentence must retain the same historical runtimes");
  assert.deepEqual(analyze("nansong_yue_085").characters.map((item) => item.id), ["96896"], "a Definition ID must resolve directly to its runtime");
  const runtime = analyze("#96896");
  assert.deepEqual(runtime.characters.map((item) => item.id), ["96896"], "a Runtime ID must resolve directly");
  assert.equal(runtime.resolverTrace.runtime.status, "MATCHED", "the Runtime resolver trace must report a direct hit");

  const zhuo = analyze("涿郡");
  assert.deepEqual(zhuo.titles.map((item) => item.rawKey), ["c_nf_zhuojun_zhao"], "a unique current-snapshot prefix candidate must resolve the real title alias");
  assert.ok(zhuo.titles[0].matchSources.includes("localized_title_prefix"), "prefix localization evidence must retain distinct provenance");
  assert.deepEqual(analyze("h_china").titles.map((item) => item.rawKey), ["h_china"], "a raw title key must resolve directly");

  const ambiguousSnapshot = { ...snapshot, titles: { ...snapshot.titles, "157": { id: "157", key: "c_nf_zhuojun_liu", holder: "96895" } } };
  const ambiguousTitle = analyze("涿郡", ambiguousSnapshot);
  assert.deepEqual(ambiguousTitle.titles, [], "multiple current-snapshot prefix candidates must fail closed");
  assert.equal(ambiguousTitle.resolverTrace.localization.status, "CONFLICT", "prefix ambiguity must remain visible in diagnostics");

  console.log("REAL LOCALIZATION QUERY GATE: PASS (six-query matrix, provenance and ambiguity)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
