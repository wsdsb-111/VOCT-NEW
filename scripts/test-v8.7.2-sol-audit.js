"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

class Settings {
  constructor(debugLogPath) {
    this.debugLogPath = debugLogPath;
    this.settings = { autosavePath: "C:\\saves\\autosave.ck3", autoWatchEnabled: false, promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION", lastValidationStatus: "VALID" };
  }
  getWorldlineSettings() { return this.settings; }
  saveWorldlineSettings(value) { this.settings = value; }
  getCK3DebugLogPath() { return this.debugLogPath; }
}

function legacyEntry(id, visibility = "PUBLIC_WORLD") {
  return { id, checkpointId: "checkpoint-sol", title: `旧记录 ${id}`, body: "需要安全迁移的旧版补充知识。", gameDate: "1175.1.1", dateRange: null, entities: ["2"], visibility, importance: "NORMAL", hidden: false, source: "PLAYER_SUPPLEMENTAL" };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v872-sol-"));
  const debugLogPath = path.join(root, "debug.log");
  fs.writeFileSync(debugLogPath, "VOTC:LOAD_SESSION/;/votc-load-1\n");
  const service = new WorldlineService({ settingsRepository: new Settings(debugLogPath), dataDir: root, stabilityDelayMs: 0 });
  try {
    const firstSession = service.getLiveState().loadSessionId;
    fs.appendFileSync(debugLogPath, "ordinary log line\n");
    assert.equal(service.getLiveState().loadSessionId, firstSession, "non-load log writes must not rotate the session identity");
    fs.appendFileSync(debugLogPath, "VOTC:LOAD_SESSION/;/votc-load-1\n");
    const secondSession = service.getLiveState().loadSessionId;
    assert.match(firstSession, /^session-[a-f0-9]{32}$/);
    assert.notEqual(secondSession, firstSession, "two identical save-local epochs in one log must still be distinct load events");

    service.currentCheckpoint = {
      id: "checkpoint-sol",
      source: { path: "C:\\saves\\autosave.ck3", fingerprint: "a".repeat(64) },
      snapshot: { playthroughId: "sol-audit", gameDate: "1175.1.1", totalDays: 430000, playerId: "1", characters: { "1": { id: "1", firstName: "玩家", alive: true, location: "临安", faith: "儒教", culture: "汉", liege: "0", courtEmployer: "1" }, "2": { id: "2", firstName: "韩世忠", alive: true, location: "临安", faith: "儒教", culture: "汉", liege: "1", courtEmployer: "1" } } }
    };
    const publicId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const secretId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const crashId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    service.supplemental = [legacyEntry(publicId), legacyEntry(secretId, "SECRET"), legacyEntry(crashId)];
    const token = (await service.listCanon()).branch.token;
    const concurrent = await Promise.all([
      service.migrateLegacySupplemental({ token, id: publicId }),
      service.migrateLegacySupplemental({ token, id: publicId })
    ]);
    assert.equal(concurrent[0].canonRecordId, concurrent[1].canonRecordId, "concurrent migration clicks must share one transaction");
    assert.equal((await service.listCanon()).records.filter((record) => record.legacyMigrationId === publicId).length, 1);

    const review = await service.migrateLegacySupplemental({ token: (await service.listCanon()).branch.token, id: secretId });
    assert.equal(review.status, "MIGRATION_REVIEW_REQUIRED");
    await assert.rejects(service.migrateLegacySupplemental({ token: (await service.listCanon()).branch.token, id: secretId, payload: { ...review.draft, reviewConfirmed: true, knownBy: ["999"] } }), /legacy_migration_acl_review_required/);
    const migratedSecret = await service.migrateLegacySupplemental({ token: (await service.listCanon()).branch.token, id: secretId, payload: { ...review.draft, reviewConfirmed: true, knownBy: ["2"] } });
    assert.equal(migratedSecret.status, "MIGRATED");

    const crashPlan = service.getLegacySupplementalMigration({ id: crashId });
    const crashRecord = await service.canon.mutate({ token: (await service.listCanon()).branch.token, operation: "create", payload: crashPlan.draft });
    await assert.rejects(service.canon.mutate({ token: (await service.listCanon()).branch.token, operation: "create", payload: { ...crashPlan.draft, legacyContentFingerprint: "f".repeat(64) } }), /supplemental_legacy_migration_conflict/);
    await service.prepareCanon();
    assert.equal(service._activeLegacySupplemental().some((item) => item.id === crashId), false, "a Canon commit must suppress legacy recall even before the legacy marker is persisted");
    assert.equal(crashRecord.legacyMigrationId, crashId);
  } finally {
    service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }

  const renderer = fs.readFileSync("resources/app/out/renderer/assets/index-Dn3qWlAB.js", "utf8");
  const editor = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
  const defaultRefresh = renderer.slice(renderer.indexOf("const refresh = async () =>"), renderer.indexOf("const loadHistoricalBindings = async () =>"));
  assert.doesNotMatch(renderer, /\["historical", text\("历史人物"/);
  assert.match(renderer, /developerMode \? \[\["diagnostics"/);
  assert.match(renderer, /false && \/\* @__PURE__ \*\/ jsxRuntimeExports\.jsxs\("section", \{ className: "worldline-card worldline-editor"/);
  assert.doesNotMatch(defaultRefresh, /invoke\("getHistoricalBindings"|invoke\("listSupplemental"/);
  assert.match(defaultRefresh, /developerMode \? invoke\("getDiagnostics"\) : Promise\.resolve\(null\)/);
  assert.match(editor, /if \(entries\.length === 0\) return null/);
  assert.match(editor, /developerMode && h\("details", \{ className: "world-memory-secondary-details" \}, h\("summary", null, "分支技术信息"\)/);
  console.log("V8.7.2 Sol PASS: load identity, migration atomicity/ACL and default UI boundary");
})().catch((error) => { console.error(error); process.exitCode = 1; });
