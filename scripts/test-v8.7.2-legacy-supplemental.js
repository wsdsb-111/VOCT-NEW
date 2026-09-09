"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

class Settings {
  constructor() { this.settings = { autosavePath: "C:\\saves\\autosave.ck3", autoWatchEnabled: false, promptIntegrationEnabled: false, subjectiveWorldMode: "DIAGNOSTIC", lastValidationStatus: "VALID" }; }
  getWorldlineSettings() { return this.settings; }
  saveWorldlineSettings(value) { this.settings = value; }
  getCK3DebugLogPath() { return null; }
}

function entry(id, visibility = "PUBLIC_WORLD") {
  return { id, checkpointId: "checkpoint-1", title: `旧记录 ${id}`, body: "这是旧 Supplemental 的保留内容。", gameDate: "1175年1月1日", dateRange: null, entities: ["2"], visibility, importance: "NORMAL", hidden: false, source: "PLAYER_SUPPLEMENTAL" };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v872-legacy-"));
  const service = new WorldlineService({ settingsRepository: new Settings(), dataDir: root, stabilityDelayMs: 0 });
  try {
    service.currentCheckpoint = {
      id: "checkpoint-1",
      source: { path: "C:\\saves\\autosave.ck3", fingerprint: "a".repeat(64) },
      snapshot: { playthroughId: "legacy-campaign", gameDate: "1175.1.1", totalDays: 430000, playerId: "1", characters: { "1": { id: "1", firstName: "玩家", fullName: "玩家", alive: true, location: "临安", faith: "儒教", culture: "汉", liege: "0", courtEmployer: "1" }, "2": { id: "2", firstName: "韩世忠", fullName: "韩世忠", alive: true, location: "临安", faith: "儒教", culture: "汉", liege: "1", courtEmployer: "1" } } }
    };
    const publicId = "11111111-1111-4111-8111-111111111111";
    const secretId = "22222222-2222-4222-8222-222222222222";
    service.supplemental = [entry(publicId), entry(secretId, "SECRET")];
    assert.equal(service.listSupplemental().readOnly, true);
    assert.equal(service.getLegacySupplementalMigration({ id: publicId }).status, "MIGRATION_READY");
    assert.equal(service.getLegacySupplementalMigration({ id: secretId }).status, "MIGRATION_REVIEW_REQUIRED");
    const page = await service.listCanon();
    const migrated = await service.migrateLegacySupplemental({ token: page.branch.token, id: publicId });
    assert.equal(migrated.status, "MIGRATED");
    assert.equal(service._activeLegacySupplemental().some((item) => item.id === publicId), false, "migrated legacy text must leave old recall immediately");
    const records = (await service.listCanon()).records;
    const migratedRecord = records.find((record) => record.legacyMigrationId === publicId);
    assert.ok(migratedRecord);
    assert.equal(migratedRecord.gameDate, "1175.1.1", "localized legacy dates must be canonicalized during migration");
    const second = await service.migrateLegacySupplemental({ token: (await service.listCanon()).branch.token, id: publicId });
    assert.equal(second.canonRecordId, migrated.canonRecordId, "migration retry must be idempotent");
    const review = await service.migrateLegacySupplemental({ token: (await service.listCanon()).branch.token, id: secretId });
    assert.equal(review.status, "MIGRATION_REVIEW_REQUIRED", "secret legacy content requires a player review payload");
    await assert.rejects(service.migrateLegacySupplemental({ token: (await service.listCanon()).branch.token, id: secretId, payload: { knownBy: ["2"], visibility: "SECRET", type: "SECRET_AGREEMENT" } }), /legacy_migration_review_required/);
    const reviewed = await service.migrateLegacySupplemental({ token: (await service.listCanon()).branch.token, id: secretId, payload: { knownBy: ["2"], visibility: "SECRET", type: "SECRET_AGREEMENT", reviewConfirmed: true } });
    assert.equal(reviewed.status, "MIGRATED");
  } finally {
    service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("V8.7.2 legacy Supplemental PASS: read-only compatibility, review, migration and dedup");
})().catch((error) => { console.error(error); process.exitCode = 1; });
