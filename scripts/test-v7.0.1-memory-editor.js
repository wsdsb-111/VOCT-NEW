"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { MemoryEngine } = require(path.join(root, "resources", "app", "out", "main", "memory-system"));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v701-editor-"));
try {
  const engine = new MemoryEngine({ baseDir: path.join(tempDir, "memory"), trace: { record() {} } });
  engine.store.saveMemory({ memoryId: "editable", type: "promise", participants: [1, 2], subjects: [2], knownBy: [1, 2], content: "甲承诺帮助乙", visibility: "known_group" });
  engine.store.markKnownBy(1, "editable");
  engine.store.markKnownBy(2, "editable");
  const edited = engine.updateMemory("editable", { content: "甲取消了承诺", type: "information", importance: 0.2, confidence: 0.95, status: "resolved", tags: ["修正"], participants: [1, 3], subjects: [3], knownBy: [1, 3], visibility: "known_group" }, { advanced: true });
  assert.strictEqual(edited.success, true);
  assert.strictEqual(engine.store.getPairMemories(1, 2).length, 0, "old pair index must be cleaned");
  assert.strictEqual(engine.store.getPairMemories(1, 3).length, 1, "new pair index must be created");
  assert.strictEqual(engine.store.queryMemories({ characterId: 2 }).length, 0, "removed knowledge must not leak");
  assert.strictEqual(engine.store.queryMemories({ characterId: 3 }).length, 1, "edited knowledge boundary must persist");
  assert.strictEqual(engine.store.getMemory("editable").canonicalText, "甲取消了承诺");
  assert.strictEqual(engine.store.getMemory("editable").updatedBy, "player_advanced");
  assert.strictEqual(engine.store.getMemory("editable").editHistory.length, 1, "an editable prior version must be retained");

  const beforeFailure = engine.store.getMemory("editable");
  const originalMarkKnownBy = engine.store.markKnownBy.bind(engine.store);
  engine.store.markKnownBy = () => { throw new Error("simulated_knowledge_write_failure"); };
  const failed = engine.updateMemory("editable", {
    content: "不应提交的内容",
    participants: [1, 4],
    subjects: [4],
    knownBy: [1, 4]
  }, { advanced: true });
  engine.store.markKnownBy = originalMarkKnownBy;
  assert.strictEqual(failed.success, false);
  assert.deepStrictEqual(engine.store.getMemory("editable"), beforeFailure, "a knowledge/index failure must roll the Memory record back completely");
  assert.strictEqual(engine.store.getPairMemories(1, 4).length, 0, "a rolled-back edit must not leave a stale pair index");
  assert.strictEqual(engine.store.queryMemories({ characterId: 4 }).length, 0, "a rolled-back edit must not leak knowledge to the failed target");
  console.log("VOTC v7.1 memory editor: PASS (history, version, index/knowledge transaction rollback)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
