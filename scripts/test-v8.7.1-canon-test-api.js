"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v871-test-api-"));
  try {
    let settings = { promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION" };
    const service = new WorldlineService({ dataDir: root, settingsRepository: { getWorldlineSettings: () => settings, saveWorldlineSettings(value) { settings = value; } } });
    service.currentCheckpoint = { id: "test", source: { path: "C:\\saves\\autosave.ck3", fingerprint: "a".repeat(64) }, snapshot: { playthroughId: "test-api", gameDate: "1175.1.1", totalDays: 430000, playerId: "1", characters: {
      "1": { firstName: "赵思昭", alive: true, location: "临安" },
      "2": { firstName: "韩世忠", alive: true, location: "临安" },
      "3": { firstName: "第三人", alive: true, location: "临安" }
    } } };
    service.getLiveState = () => ({ gameDate: "1175.1.1", totalDays: 430000, characters: [] });
    const page = await service.listCanon();
    const record = await service.mutateCanon({ token: page.branch.token, operation: "create", payload: { title: "秘密赴约", content: "韩世忠答应秘密赴约", entities: ["2"], visibility: "SECRET", knownBy: ["1", "2"] } });
    const allowed = await service.testCanonRecall({ token: service.canon.branch().token, recordId: record.recordId, responderId: "1", query: "韩世忠赴约" });
    assert.equal(allowed.matched, true);
    assert.equal(allowed.visibility, "ALLOW");
    assert.match(allowed.promptText, /秘密赴约/);
    const blocked = await service.testCanonRecall({ token: service.canon.branch().token, recordId: record.recordId, responderId: "3", query: "韩世忠赴约" });
    assert.equal(blocked.visibility, "DENY");
    assert.equal(blocked.promptText, null);
    const unrelated = await service.testCanonRecall({ token: service.canon.branch().token, recordId: record.recordId, responderId: "1", query: "今日天气如何" });
    assert.equal(unrelated.matched, false);
    assert.equal(unrelated.reason, "QUERY_NOT_RELEVANT");
    service.setRecallSettings({ promptIntegrationEnabled: false });
    const disabled = await service.testCanonRecall({ token: service.canon.branch().token, recordId: record.recordId, responderId: "1", query: "韩世忠赴约" });
    assert.equal(disabled.matched, false);
    assert.equal(disabled.reason, "RECALL_DISABLED");
    assert.equal(disabled.promptText, null);
    console.log("V8.7.1 Canon test API PASS");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
