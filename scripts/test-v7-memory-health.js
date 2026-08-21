"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const conversationPath = path.join(root, "resources", "app", "out", "main", "action-system", "conversation.js");
const memoryDir = path.join(root, "resources", "app", "out", "main", "memory-system");
const mainSource = fs.readFileSync(mainPath, "utf8");
const conversationSource = fs.readFileSync(conversationPath, "utf8");

for (const file of [
  "index.js",
  "memory-types.js",
  "memory-store.js",
  "memory-extractor.js",
  "memory-ranker.js",
  "knowledge-service.js",
  "rolling-summary-manager.js",
  "memory-consolidator.js",
  "memory-trace.js",
  "memory-engine.js"
]) {
  assert(fs.existsSync(path.join(memoryDir, file)), `Memory Engine module is missing: ${file}`);
}
assert(conversationSource.includes("memoryEngine.maybeCreateRollingCheckpoint"), "Conversation must delegate rolling checkpoints to MemoryEngine");
assert(!conversationSource.includes("for (let i = this.lastSummarizedMessageIndex; i < history.length; i++)"), "Conversation must not own the rolling selection algorithm");
assert(!conversationSource.includes("this.currentSummary = `${this.currentSummary}"), "rolling summaries must use replacement semantics");
assert(mainSource.includes("new memorySystem.MemoryEngine"), "composition root must create MemoryEngine");
assert(/Conversation\.configure\(\{[\s\S]{0,900}memoryEngine[\s\S]{0,40}\}\);/.test(mainSource), "composition root must inject MemoryEngine");
assert(!mainSource.includes("summaries = this.loadConversationWithMentionedCharacter(player, mentionedName)"), "player-summary fallback must not leak memories to responders");
assert(/buildMemoriesBlock\(gameData, character,/.test(mainSource), "CK3 memories must be scoped to the responder");

console.log("VOTC v7.0 Memory Health: PASS (ownership, knowledge boundary, CK3 scope)");
