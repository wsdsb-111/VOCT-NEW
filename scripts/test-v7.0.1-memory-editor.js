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
  console.log("VOTC v7.0.1 memory editor: PASS (fields, index cleanup, knowledge boundary)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
