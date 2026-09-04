"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { HistoricalDefinitionIndexClient } = require("../resources/app/out/main/worldline/historical-definition-index");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v851-worker-"));
  const base = path.join(root, "steamapps", "common", "Crusader Kings III", "game");
  const mod = path.join(root, "steamapps", "workshop", "content", "1158310", "fixture");
  const user = path.join(root, "user");
  const write = (filePath, text) => { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, text, "utf8"); };
  fs.mkdirSync(mod, { recursive: true });
  write(path.join(base, "history", "characters", "han.txt"), "han_022 = {\n name = \"世忠\"\n dynasty = han_dyn\n culture = han\n female = no\n 1090.1.26 = { birth = yes }\n}\n");
  write(path.join(base, "common", "dynasties", "han.txt"), "han_dyn = {\n name = han_surname\n}\n");
  write(path.join(base, "localization", "simp_chinese", "han_l_simp_chinese.yml"), "l_simp_chinese:\nhan_surname:0 \"韩\"\n");
  write(path.join(user, "mod", "fixture.mod"), `path = "${path.relative(user, mod).replace(/\\/g, "/")}"\nremote_file_id = "fixture"\n`);
  write(path.join(user, "dlc_load.json"), JSON.stringify({ enabled_mods: ["mod/fixture.mod"] }));
  const client = new HistoricalDefinitionIndexClient({ getCK3UserFolderPath: () => user });
  try {
    assert.equal(client.find("韩世忠").status, "SOURCE_INCOMPLETE", "cold lookup must not synchronously scan CK3 sources");
    await client.prepare(["韩世忠", "赵思昭"], 5000);
    assert.equal(client.status, "READY");
    assert.equal(client.find("韩世忠").status, "FOUND");
    assert.equal(client.find("赵思昭").status, "NAME_INDEX_MISS");
    assert.equal(client.meta.byId, undefined, "the worker returns metadata and per-query records, never the whole source index to the main process");
  } finally {
    client.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("V8.5.1 Historical Index Worker: PASS (background build, cached lookup, no full-index transfer)");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
