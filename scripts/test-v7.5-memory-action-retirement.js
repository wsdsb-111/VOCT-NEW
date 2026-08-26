"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const memorySystem = require(path.join(root, "resources", "app", "out", "main", "memory-system"));
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const preloadPath = path.join(root, "resources", "app", "out", "preload", "preload.js");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const actionPromptPath = path.join(root, "resources", "app", "out", "main", "action-system", "action-prompt-builder.js");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v75-"));
try {
  const store = new memorySystem.MemoryStore({ baseDir: path.join(tempDir, "memory") });
  const engine = new memorySystem.MemoryEngine({ store, trace: new memorySystem.MemoryTrace({ logger: { log() {} } }) });
  const folderMemory = (memoryId, entityId, entityName, content, totalDays) => memorySystem.createMemoryRecord({
    memoryId,
    type: "folder_summary",
    subtype: "conversation_summary",
    participants: [2, entityId],
    subjects: [entityId],
    content,
    canonicalText: content,
    importance: 0.65,
    confidence: 0.9,
    totalDays,
    knownBy: [2],
    tags: [entityName],
    provenance: { folderOwnerId: 2, counterpartId: entityId, counterpartIds: [entityId], counterpartName: entityName, counterpartNames: [entityName] }
  });
  const ownerFolderMemories = [
    folderMemory("x-alpha", 9, "场外甲", "场外甲曾与二号商议苹果税。", 10),
    folderMemory("x-beta", 9, "场外甲", "场外甲曾与二号商议军马。", 20),
    folderMemory("y-only", 10, "场外乙", "场外乙曾托付二号保管印章。", 30)
  ];
  const mentionedRecallCache = new Map();
  const retrieve = (query, ids, names) => engine.retrieveForResponder({
    characterId: 2,
    query,
    mentionedEntityIds: ids,
    mentionedEntityNames: names,
    mentionedRecallCache,
    ownerFolderMemories,
    tokenBudget: 800,
    estimateTokens: () => 20
  });

  const first = retrieve("苹果税", [9], { 9: ["场外甲"] });
  const second = retrieve("军马", [9], { 9: ["场外甲"] });
  assert.strictEqual(first.routing.mentionedSnapshot, "captured");
  assert.strictEqual(second.routing.mentionedSnapshot, "reused");
  assert.strictEqual(second.mentionedText, first.mentionedText, "an out-of-scene memory snapshot must not rerank every turn");
  assert(first.mentionedText.includes("苹果税"), "the first-mention topic must select the initial snapshot");

  const expanded = retrieve("印章", [9, 10], { 9: ["场外甲"], 10: ["场外乙"] });
  assert.strictEqual(expanded.routing.mentionedSnapshot, "captured", "a newly mentioned person must expand the snapshot once");
  assert(expanded.mentionedText.includes("苹果税"), "expansion must preserve the existing person's snapshot");
  assert(expanded.mentionedText.includes("印章"), "expansion must add the newly mentioned person's memory");
  const reusedExpanded = retrieve("无关新话题", [9, 10], { 9: ["场外甲"], 10: ["场外乙"] });
  assert.strictEqual(reusedExpanded.mentionedText, expanded.mentionedText);

  const mainSource = fs.readFileSync(mainPath, "utf8");
  const preloadSource = fs.readFileSync(preloadPath, "utf8");
  const rendererSource = fs.readFileSync(rendererPath, "utf8");
  const rendererRuntime = rendererSource.slice(0, rendererSource.indexOf("const summaries$8"));
  const memorySources = ["memory-engine.js", "memory-store.js", "memory-types.js"]
    .map((file) => fs.readFileSync(path.join(root, "resources", "app", "out", "main", "memory-system", file), "utf8"))
    .join("\n");
  for (const retired of ["llm:importLegacySummaries", "conversation:acceptSummaryImport", "conversation:migrateSummariesToNewFormat"]) {
    assert(!mainSource.includes(retired), `main process must retire ${retired}`);
    assert(!preloadSource.includes(retired), `preload must retire ${retired}`);
  }
  for (const retired of ["SummaryImportNotification", "legacy-data-import", "handleImportLegacySummaries", "summary-import"]) {
    assert(!rendererRuntime.includes(retired), `renderer runtime must retire ${retired}`);
  }
  for (const retired of ["legacySummariesDir", "persistLegacySummary", "includeLegacy", "loadLegacyForCharacter", "legacy_summary"]) {
    assert(!memorySources.includes(retired), `Memory Engine 2.2 must retire ${retired}`);
  }

  const actionPromptSource = fs.readFileSync(actionPromptPath, "utf8");
  assert(actionPromptSource.includes("VOTC_ACTION_CACHE_ANCHOR_v11"));
  assert(actionPromptSource.includes("CURRENT_COMPLETED_ACTION or NON_ACTION"));
  assert(actionPromptSource.includes('If NON_ACTION, return {"actions":[]} immediately'));
  assert(actionPromptSource.includes("Never infer an unstated result or relationship transition"));
  assert(rendererRuntime.includes("Memory Engine 2.4 · V7.8.1"));
  assert(rendererRuntime.includes("V7.8.1 适配状态"));

  console.log("VOTC v7.5 memory/action retirement: PASS (session snapshots, unified summaries, two-stage semantics)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
