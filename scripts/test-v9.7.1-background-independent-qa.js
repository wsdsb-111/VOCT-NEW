"use strict";

// Independent, synthetic campaign identity and conversation-freeze checks.
// No CK3 installation, user data, or model requests are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WorldlineService, readLiveProbe } = require("../src/app/main/worldline/worldline-service");
const { Conversation } = require("../src/app/main/conversation/conversation");

const A = "votc8c-123456789012";
const B = "votc8c-987654321098";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-background-independent-"));
let counter = 0;
let currentLog;
const init = "VOTC:IN/;/init/;/player/;/same-name/;/same-id/;/unused/;/1066.9.15/;/unused/;/unused/;/unused/;/1";
const marker = token => `VOTC:CAMPAIGN/${token}`;
const load = name => `VOTC:LOAD_SESSION/;/${name}`;
function log(...lines) {
  currentLog = path.join(dir, `log-${++counter}.txt`);
  fs.writeFileSync(currentLog, lines.join("\n") + "\n");
  return currentLog;
}
function probe(...lines) {
  return readLiveProbe({ fs, debugLogPath: log(...lines) });
}
function save(service, text) {
  const state = service.getBackgroundSetting();
  assert.equal(state.available, true);
  return service.saveBackgroundSetting({ bindingKey: state.bindingKey, revision: state.revision, text });
}

async function main() {
  const settingsRepository = {
    getWorldlineSettings: () => ({}),
    saveWorldlineSettings: () => {},
    getCK3DebugLogPath: () => currentLog
  };
  const service = new WorldlineService({ settingsRepository, dataDir: dir });
  Conversation.configure({ worldlineService: service });
  const conversation = token => {
    const value = Object.create(Conversation.prototype);
    value.gameData = { campaignToken: token, playerID: 1 };
    return value;
  };

  log(load("session_A_0001"), init, marker(A));
  assert.equal(service.getBackgroundSetting().available, true);
  save(service, "A 的架空背景");
  const oldScene = conversation(A);
  assert.equal(oldScene.captureWorldBackground().text, "A 的架空背景");
  save(service, "A 的更新背景");
  const earlyNpc = await oldScene.getMemoryContextFor({ id: 2 });
  const lateNpc = await oldScene.getMemoryContextFor({ id: 3 });
  assert.equal(earlyNpc.worldBackground.text, "A 的架空背景");
  assert.equal(lateNpc.worldBackground.text, "A 的架空背景");
  assert.equal(conversation(A).captureWorldBackground().text, "A 的更新背景");

  // A second campaign has exactly the same init, date and player identifiers.
  log(load("session_B_0001"), init, marker(B));
  assert.throws(() => oldScene.captureWorldBackground(), /campaign_changed/,
    "a frozen scene cannot send campaign A background after CK3 has loaded campaign B even with stale gameData");
  assert.equal(service.getBackgroundSetting().text, "");
  const emptyScene = conversation(B);
  assert.equal(emptyScene.captureWorldBackground().text, "");
  save(service, "B 的背景");
  assert.equal(await emptyScene.getMemoryContextFor({ id: 2 }), null);
  assert.equal(await emptyScene.getMemoryContextFor({ id: 3 }), null);
  assert.equal(conversation(B).captureWorldBackground().text, "B 的背景");
  log(load("session_A_0002"), init, marker(A));
  assert.equal(service.getBackgroundSetting().text, "A 的更新背景");
  assert.throws(() => oldScene.captureWorldBackground.call({ ...oldScene, gameData: { campaignToken: B } }), /campaign_changed/);

  for (const token of ["", "votc8c-123", `${A}x`, "../wrong"]) {
    log(load("session_bad_01"), init, marker(token));
    assert.equal(service.getBackgroundSetting().available, false);
    assert.equal(service.getConversationBackground(token), null);
  }
  // An old export followed by a load, without a new export, cannot bind.
  assert.equal(probe(init, marker(A), load("session_new_01"), "VOTC:DATE/;/1/;/1066.9.15").campaignToken, null);
  // A fresh marker alone is not a complete export after the load.
  assert.equal(probe(init, marker(A), load("session_new_02"), "VOTC:DATE/;/1/;/1066.9.15", marker(B)).campaignToken, null);
  // A newer partial INIT invalidates an earlier complete export immediately.
  assert.equal(probe(load("session_new_03"), init, marker(A), "VOTC:IN/;/init/;/partial").campaignToken, null);

  console.log("V9.7.1 independent background QA passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
