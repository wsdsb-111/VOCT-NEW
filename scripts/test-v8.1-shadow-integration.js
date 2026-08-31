"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { createLogParser } = require(path.join(root, "resources", "app", "out", "main", "game-data", "log-parser"));
const { DynamicHistoryService } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "dynamic-history-service"));

class TestGameData {
  constructor(data) {
    this.playerID = Number(data[0]);
    this.characters = new Map();
  }
}
class TestCharacter {}

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v81-integration-"));
  try {
    const fixturePath = path.join(tempRoot, "debug.log");
    fs.writeFileSync(fixturePath, [
      "VOTC:IN/;/init/;/1/;/玩家/;/2/;/李师师/;/1010年5月3日/;/scene_type_court/;/开封/;/玩家/;/100",
      "VOTC:CAMPAIGN/votc8c-123456789012"
    ].join("\n"), "utf8");
    const parsedCalls = [];
    const parseLog = createLogParser({ GameData: TestGameData, Character: TestCharacter, onGameDataParsed: (gameData) => parsedCalls.push(gameData) });
    const parsed = await parseLog(fixturePath);
    assert.strictEqual(parsed.campaignToken, "votc8c-123456789012");
    assert.deepStrictEqual(parsedCalls, [parsed]);

    const stableIdentity = Object.freeze({ campaignId: `ck3-${"c".repeat(32)}`, source: "ck3_mod_token", persistenceAllowed: true, tokenFingerprint: "c".repeat(64) });
    const sessionIdentity = Object.freeze({ campaignId: "session-fixture", source: "session", persistenceAllowed: false, tokenFingerprint: null });
    const persistedState = Object.freeze({ schemaVersion: 1, campaignId: stableIdentity.campaignId, mode: "shadow" });
    const storeCalls = [];
    const service = new DynamicHistoryService({
      identityResolver: { resolve: (token) => token ? stableIdentity : sessionIdentity },
      worldlineStore: { loadOrCreate: (identity) => { storeCalls.push(identity); return { status: "created", state: persistedState, path: "fixture" }; } }
    });
    const stableGameData = { campaignToken: "votc8c-123456789012" };
    const stableResult = service.updateFromGameData(stableGameData);
    assert.strictEqual(stableResult.status, "created");
    assert.strictEqual(stableGameData.historicalCampaignIdentity, stableIdentity);
    assert.strictEqual(Object.getOwnPropertyDescriptor(stableGameData, "historicalCampaignIdentity").writable, false);
    assert.throws(() => {
      stableGameData.historicalCampaignIdentity = sessionIdentity;
    }, TypeError);
    assert.deepStrictEqual(service.getWorldlineState(), persistedState);
    assert.deepStrictEqual(storeCalls, [stableIdentity]);

    const sessionGameData = {};
    const sessionResult = service.updateFromGameData(sessionGameData);
    assert.strictEqual(sessionResult.status, "persistence_skipped");
    assert.strictEqual(sessionGameData.historicalCampaignIdentity, sessionIdentity);
    assert.strictEqual(storeCalls.length, 1, "session identity must never reach persistent store");

    const errorService = new DynamicHistoryService({
      identityResolver: { resolve: () => stableIdentity },
      worldlineStore: { loadOrCreate: () => { throw new Error("worldline_schema_unsupported:99"); } }
    });
    assert.doesNotThrow(() => errorService.updateFromGameData({ campaignToken: "votc8c-123456789012" }), "shadow persistence errors must not block existing runtime");
    assert.strictEqual(errorService.getDiagnostics()[0].code, "WORLDLINE_PERSISTENCE_FAILED");
    assert.strictEqual(errorService.getWorldlineState(), null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log("VOTC v8.1 Shadow Integration: PASS (log protocol, persistent gate, diagnostics isolation)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
