"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const memorySystem = require("../resources/app/out/main/memory-system");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v934-archive-edit-"));
  try {
    const summariesDir = path.join(root, "summaries");
    const folder = path.join(summariesDir, "2_乙");
    fs.mkdirSync(folder, { recursive: true });
    const engine = new memorySystem.MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir });
    const file = path.join(folder, "与甲的对话.json");
    const officialFile = path.join(folder, "官方追忆摘要.json");
    const record = index => ({ playerId: 2, characterId: 1, perspectiveOwnerId: 2, date: "1164.1.1",
      campaignToken: "legacy-archive-campaign", campaignBinding: { status: "bound" },
      content: `LEGACY_ARCHIVE_${index}`, conversationId: `conversation-${index}`, finalizationId: `final-${index}`,
      perspectiveMemoryIds: [], perspectiveSummarySegmentIds: [] });
    engine.store.writeJson(file, [record(1), record(2)]);
    engine.store.writeJson(officialFile, [{ playerId: 2, characterId: 2, date: "1164.1.1", content: "CK3_OFFICIAL",
      sourceType: "CK3_OFFICIAL_RECOLLECTION" }]);
    const officialBefore = fs.readFileSync(officialFile);
    let currentConversation = { isActive: false, gameData: { campaignToken: "legacy-archive-campaign" } };
    const manager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem,
      getCurrentConversation: () => currentConversation });
    assert.equal(engine.memory4, undefined);
    assert.equal((await manager.updateSummary(2, 1, 0, "LEGACY_EDITED_AFTER_END")).success, true);
    currentConversation = null;
    assert.equal((await manager.deleteSummary(2, 1, 1)).success, true);
    assert.equal(engine.store.readJson(file, []).length, 1);
    assert.equal(engine.store.readJson(file, [])[0].content, "LEGACY_EDITED_AFTER_END");
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.equal((await manager.updateSummary(2, 2, 0, "INVALID_CHANGE")).error, "official_recollection_read_only");
      assert.equal((await manager.deleteSummary(2, 2, 0)).error, "official_recollection_read_only");
    } finally { console.error = originalError; }
    assert.deepEqual(fs.readFileSync(officialFile), officialBefore);
    assert.equal(typeof manager.getMemory4OwnerData, "undefined");
    assert.equal(typeof manager.mutateMemory4, "undefined");
    console.log("V8.14.2 summary edit incident: PASS (Legacy ended/no-session edit and delete; CK3 official read-only; retired Memory4 API absent)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
