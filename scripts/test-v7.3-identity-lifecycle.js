"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const conversationPath = path.join(root, "resources", "app", "out", "main", "action-system", "conversation.js");
const memorySystem = require(path.join(root, "resources", "app", "out", "main", "memory-system"));
const {
  MemoryEngine,
  MemoryExtractor,
  MentionTracker,
  getCharacterPersonalName,
  getCharacterStorageDirectoryName
} = memorySystem;

const emperor = {
  id: 9,
  firstName: "赵佶",
  shortName: "宣和皇帝，赵佶",
  fullName: "宣和皇帝，赵佶",
  primaryTitle: "大宋皇帝",
  heldCourtAndCouncilPositions: "",
  titleRankConcept: "concept_emperor"
};
assert.strictEqual(getCharacterPersonalName(emperor), "赵佶", "summary storage must use the personal name, not the current title");
assert.strictEqual(getCharacterStorageDirectoryName(emperor), "9_赵佶", "title changes must not create a second identity folder");
assert.strictEqual(getCharacterStorageDirectoryName({ ...emperor, shortName: "太上皇，赵佶", fullName: "太上皇，赵佶", primaryTitle: "太上皇" }), "9_赵佶");

const tracker = new MentionTracker();
assert.deepStrictEqual(
  tracker.findMentionedCharacterIds([{ id: 1, content: "陛下曾经答应赈济灾民。" }], { candidates: [emperor] }),
  [emperor.id],
  "a unique current imperial honorific must resolve to its character ID"
);
assert.deepStrictEqual(
  tracker.findMentionedCharacterIds([{ id: 2, content: "陛下对此有何看法？" }], { candidates: [emperor, { ...emperor, id: 19, firstName: "赵桓" }] }),
  [],
  "the same honorific on multiple candidates must fail closed"
);
assert.deepStrictEqual(
  tracker.findMentionedCharacterIds([{ id: 3, content: "太上皇还记得旧事。" }], { candidates: [{ ...emperor, shortName: "太上皇，赵佶", fullName: "太上皇，赵佶", primaryTitle: "太上皇" }] }),
  [emperor.id],
  "a changed title must still resolve to the same numeric identity"
);

const prompt = new MemoryExtractor().buildPrompt({
  participants: [{ id: emperor.id, name: "赵佶", fullName: emperor.fullName, primaryTitle: emperor.primaryTitle }],
  messages: []
});
assert(prompt.some((message) => message.content.includes("姓名=赵佶") && message.content.includes("头衔=大宋皇帝")), "summary content prompt may retain titles while storage identity remains name-only");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v73-identity-"));
try {
  const summariesDir = path.join(tempDir, "conversation_summaries");
  const ownedOld = path.join(summariesDir, "9_宣和皇帝，赵佶");
  const ownedCanonical = path.join(summariesDir, "9_赵佶");
  const survivorFolder = path.join(summariesDir, "10_官员乙");
  for (const folder of [ownedOld, ownedCanonical, survivorFolder]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(ownedOld, "与官员乙的对话.json"), "[]", "utf8");
  fs.writeFileSync(path.join(ownedCanonical, "与官员乙的对话.json"), "[]", "utf8");
  const survivorMemory = path.join(survivorFolder, "与赵佶的对话.json");
  fs.writeFileSync(survivorMemory, JSON.stringify([{
    date: "1121年1月2日",
    totalDays: 20,
    playerId: 10,
    playerName: "官员乙",
    characterId: emperor.id,
    characterName: "赵佶",
    participants: [
      { id: 10, name: "官员乙", fullName: "户部尚书，官员乙", primaryTitle: "户部尚书" },
      { id: emperor.id, name: "赵佶", firstName: "赵佶", fullName: emperor.fullName, primaryTitle: emperor.primaryTitle, titleRankConcept: emperor.titleRankConcept }
    ],
    finalizationId: "fin-current-emperor",
    content: "赵佶以皇帝身份答应官员乙赈济灾民。"
  }]), "utf8");
  fs.writeFileSync(path.join(survivorFolder, "与旧帝的对话.json"), JSON.stringify([{
    date: "1119年1月1日",
    totalDays: 10,
    playerId: 10,
    playerName: "官员乙",
    characterId: 8,
    characterName: "旧帝",
    participants: [{ id: 8, name: "旧帝", fullName: "先帝，旧帝", primaryTitle: "皇帝", titleRankConcept: "concept_emperor" }],
    finalizationId: "fin-old-emperor",
    content: "旧帝曾经召见官员乙。"
  }]), "utf8");
  const engine = new MemoryEngine({ baseDir: path.join(tempDir, "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
  const ownerMemories = engine.loadOwnerFolderMemories(10);
  const historicalProfiles = engine.getMentionableProfilesFromFolderMemories(ownerMemories);
  assert.deepStrictEqual(
    tracker.findMentionedCharacterIds([{ id: 4, content: "陛下答应过赈灾。" }], { candidates: [...historicalProfiles.values()], excludedIds: [10] }),
    [emperor.id],
    "the most recently observed unique title holder in the responder's folder must resolve even when absent from the live scene"
  );
  const titleRecall = engine.retrieveForResponder({
    characterId: 10,
    mentionedEntityIds: [emperor.id],
    mentionedEntityNames: { [emperor.id]: engine.getCharacterMentionAliases(historicalProfiles.get(emperor.id)) },
    ownerFolderMemories: ownerMemories,
    query: "陛下答应过赈灾",
    tokenBudget: 800,
    estimateTokens: (text) => String(text).length
  });
  assert(titleRecall.mentioned.some((entry) => entry.memory.content.includes("赈济灾民")), "title resolution must route into the same ID-owned memory records without putting the title in the filename");
  const deletion = engine.deleteOwnedSummaryFolders(emperor.id);
  assert.strictEqual(deletion.removedFolderCount, 2, "all folders owned by the dead character ID must be removed regardless of old title suffixes");
  assert(!fs.existsSync(ownedOld) && !fs.existsSync(ownedCanonical));
  assert(fs.existsSync(survivorMemory), "other characters' memories about the dead character must remain intact");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const mainSource = fs.readFileSync(mainPath, "utf8");
const conversationSource = fs.readFileSync(conversationPath, "utf8");
assert(mainSource.includes("getCharacterPersonalName"), "summary paths must use the shared personal-name identity helper");
assert(conversationSource.includes("memoryEngine?.deleteOwnedSummaryFolders"), "NPC death lifecycle must remove only the dead owner's summary folders");
assert(conversationSource.includes("excludedSummaryOwnerIds"), "finalization recovery must remember not to recreate a dead owner's folder");
assert(mainSource.includes("excludedOwnerIds"), "directed summary persistence must skip dead owners while preserving survivor-owned memories");

console.log("VOTC v7.3 identity lifecycle: PASS (name-only storage, unique-title recall, title-change stability, owner-only death cleanup)");
