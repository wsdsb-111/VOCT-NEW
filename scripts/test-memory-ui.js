"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const memoryDir = path.join(root, "resources", "app", "out", "main", "memory-system");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const preloadPath = path.join(root, "resources", "app", "out", "preload", "preload.js");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const enginePath = path.join(memoryDir, "memory-engine.js");
const conversationPath = path.join(root, "resources", "app", "out", "main", "action-system", "conversation.js");
const { buildSummaryCatalogEntry, classifySummaryMatch } = require(path.join(memoryDir, "summary-catalog"));
const { MemoryEngine } = require(path.join(memoryDir, "memory-engine"));
const { Conversation } = require(path.join(root, "resources", "app", "out", "main", "action-system", "conversation"));

const ownFolder = buildSummaryCatalogEntry({
  folderName: "3_丙",
  conversationFile: "与玩家的对话.json",
  filePath: "C:/summaries/3_丙/与玩家的对话.json",
  summaries: [{ playerId: 3, playerName: "丙", characterId: 1, characterName: "玩家", content: "丙记得玩家问过旧事。" }]
});
const otherFolder = buildSummaryCatalogEntry({
  folderName: "2_乙",
  conversationFile: "与丙的对话.json",
  filePath: "C:/summaries/2_乙/与丙的对话.json",
  summaries: [{
    playerId: 2,
    playerName: "乙",
    characterId: 3,
    characterName: "丙",
    participants: [{ id: 1, name: "玩家" }, { id: 2, name: "乙" }, { id: 3, name: "丙" }],
    content: "玩家与乙谈到丙。"
  }]
});
const mentionedElsewhere = buildSummaryCatalogEntry({
  folderName: "4_丁",
  conversationFile: "与乙的对话.json",
  filePath: "C:/summaries/4_丁/与乙的对话.json",
  summaries: [{ playerId: 4, playerName: "丁", characterId: 2, characterName: "乙", participants: [{ id: 3, name: "丙" }], content: "丁也提到了丙。" }]
});

assert.strictEqual(ownFolder.ownerId, 3, "folder ID must define the summary owner");
assert.strictEqual(ownFolder.ownerName, "丙", "folder name must define the summary owner name");
assert.strictEqual(otherFolder.counterpartName, "丙", "conversation filename/metadata must define the counterpart");
assert(otherFolder.participantNames.includes("丙"), "participant names must be indexed");
assert.strictEqual(classifySummaryMatch(ownFolder, "丙").kind, "owner", "exact owner folder must be the highest-priority hit");
assert.strictEqual(classifySummaryMatch(otherFolder, "丙").kind, "counterpart", "another person's direct conversation with the target must be found");
assert.strictEqual(classifySummaryMatch(mentionedElsewhere, "丙").kind, "related", "third-party mentions in another folder must be found");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-memory-ui-"));
try {
  const legacyDir = path.join(tempDir, "conversation_summaries");
  const ownerDir = path.join(legacyDir, "2_乙");
  fs.mkdirSync(ownerDir, { recursive: true });
  fs.writeFileSync(path.join(ownerDir, "与丙的对话.json"), JSON.stringify(otherFolder.summaries), "utf8");
  const engine = new MemoryEngine({
    baseDir: path.join(tempDir, "memory"),
    legacySummariesDir: legacyDir,
    trace: { record() {} }
  });
  const privateKnown = engine.store.saveMemory({
    memoryId: "memory_known", type: "event", participants: [2, 3], subjects: [3], content: "乙亲历了丙的到访。",
    visibility: "known_group", knownBy: [2], importance: 0.8, confidence: 1
  });
  engine.store.markKnownBy(2, privateKnown.memoryId);
  engine.store.saveMemory({
    memoryId: "memory_public", type: "fact", participants: [3], subjects: [3], content: "丙的公开身份。",
    visibility: "public", knownBy: [], importance: 0.7, confidence: 1
  });
  engine.store.saveMemory({
    memoryId: "memory_restricted", type: "secret", participants: [3, 4], subjects: [4], content: "乙不知道的秘密。",
    visibility: "known_group", knownBy: [3, 4], importance: 0.9, confidence: 1
  });
  const overview = engine.getUiOverview({ summaryCatalog: [ownFolder, otherFolder, mentionedElsewhere] });
  assert.strictEqual(overview.engineVersion, "2.2");
  assert.strictEqual(overview.totals.summaryFolders, 3, "overview must count canonical character folders");
  assert.strictEqual(overview.totals.summaryFiles, 3, "overview must count visible conversation files");
  assert.strictEqual(overview.totals.summaryRecords, 3, "overview must count player-editable summaries");
  assert.deepStrictEqual(overview.characters, [], "the UI overview must not duplicate the folder tree with a structured-memory tree");
  const updated = engine.updateMemoryContent("memory_known", "乙亲历了丙的再次到访。");
  assert.strictEqual(updated.success, true, "players must be able to edit a readable structured memory");
  const updatedMemory = engine.store.getMemory("memory_known");
  assert.strictEqual(updatedMemory.content, "乙亲历了丙的再次到访。");
  assert.strictEqual(updatedMemory.canonicalText, "乙亲历了丙的再次到访。");
  assert.deepStrictEqual(updatedMemory.knownBy, [2], "editing memory text must not change its knowledge boundary");
  const recalled = engine.retrieveForCharacter({ characterId: 2, query: "丙", entityIds: [3], tokenBudget: 500, estimateTokens: (text) => String(text).length });
  assert([...recalled.stable, ...recalled.relevant].some((entry) => entry.memory.content.includes("玩家与乙谈到丙")), "NPC B must recall the prior B-C summary from B's own folder when C is mentioned");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

Conversation.configure({
  memoryEngine: {
    ensureConversationState: (conversation) => conversation.memoryState
  }
});
const participantTestConversation = Object.create(Conversation.prototype);
participantTestConversation.memoryState = {
  participantPresence: [
    { characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null },
    { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: null }
  ]
};
participantTestConversation.gameData = {
  playerID: 1,
  characters: new Map([[1, { id: 1 }], [2, { id: 2, fullName: "未匹配的全名" }]])
};
participantTestConversation.getHistory = () => [{ role: "assistant", name: "流式响应中未保留的别名" }];
assert.deepStrictEqual(
  participantTestConversation.getSummaryParticipantIds(),
  [1, 2],
  "observed NPC participants must still receive a dedicated summary file when message-name matching fails"
);

const rendererSource = fs.readFileSync(rendererPath, "utf8");
const preloadSource = fs.readFileSync(preloadPath, "utf8");
const mainSource = fs.readFileSync(mainPath, "utf8");
const engineSource = fs.readFileSync(enginePath, "utf8");
const conversationSource = fs.readFileSync(conversationPath, "utf8");
assert(rendererSource.includes("memory-engine-overview"), "summary UI must render the Memory Engine overview");
assert(rendererSource.includes("metadata.ownerName"), "summary search must index folder owners");
assert(rendererSource.includes("metadata.participantNames"), "summary search must index third-party participants");
assert(rendererSource.includes("summary-match-badge"), "summary UI must explain why a search result matched");
assert(!rendererSource.includes("handleEditStructuredMemory"), "summary UI must expose only the canonical folder editing surface");
assert(!rendererSource.includes("可访问的结构化记忆（可编辑）"), "summary UI must not duplicate structured and folder records");
assert(preloadSource.includes("updateStructuredMemory"), "preload must expose structured-memory editing");
assert(mainSource.includes('"conversation:updateStructuredMemory"'), "main process must provide structured-memory editing IPC");
assert(conversationSource.includes("participantPresence"), "final summary participants must include observed session participants");
assert(conversationSource.includes("mentionedEntityIds: mentionedCharacterIds"), "conversation retrieval must bind mentioned third-party IDs");
assert(preloadSource.includes("getSummariesDashboardData"), "preload must expose the single-read summaries dashboard endpoint");
assert(mainSource.includes('"conversation:getSummariesDashboardData"'), "main process must provide combined catalog and overview data");
assert(rendererSource.includes("reactExports.useDeferredValue(searchQuery)"), "summary search must defer expensive filtering while typing");
assert(rendererSource.includes("const topMatch = filteredSummaries[0]"), "search must limit automatic content expansion to the top result");
assert(rendererSource.includes("const summaryGroups = reactExports.useMemo"), "summary groups must preserve ranked insertion order");
assert(rendererSource.includes("const groups = new Map()"), "numeric character IDs must not reorder matched folder groups");
assert(!rendererSource.includes("Object.entries(summariesByPlayer)"), "search result groups must not use numeric object-key enumeration");
assert(!rendererSource.includes('className: "memory-character-coverage"'), "the duplicate per-character structured-memory tree must be removed");
assert(!rendererSource.includes("Promise.all([listAllSummaries(), getMemoryOverview()])"), "summary dashboard must not parse every JSON file twice");
assert(rendererSource.includes("Memory Engine 2.2 · V7.3"), "summary UI must expose the V7.3 identity lifecycle version");
assert(rendererSource.includes("memory-routing-grid"), "summary UI must explain direct, group and mentioned-person recall policies");
assert(rendererSource.includes("summary-route-label"), "conversation files must display owner-to-counterpart routing");
assert(rendererSource.includes("editingEntry.ownerName"), "summary editor must identify the folder owner");
const overviewSource = engineSource.slice(engineSource.indexOf("getUiOverview("), engineSource.indexOf("formatMemoryBlock("));
assert(!overviewSource.includes("loadLegacyForCharacter"), "UI coverage counts must reuse the catalog instead of rereading every legacy file");

console.log("VOTC Memory UI: PASS (canonical owner folders, search, editing and unified coverage)");
