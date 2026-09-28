"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Memory4ProfileService, detectRelationshipChange } = require("../resources/app/out/main/memory-system/memory4-profile");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { Memory4RelationshipReadback } = require("../resources/app/out/main/memory-system/memory4-relationship-readback");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { createLogParser } = require("../resources/app/out/main/game-data/log-parser");
const { MemoryExtractor } = require("../resources/app/out/main/memory-system/memory-extractor");

let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
const asyncChecks = [];
function checkAsync(name, run) { asyncChecks.push({ name, run }); }

const scope = { campaignToken: "campaign-A", ownerId: 1 };
const index = { revision: 1, byEntity: { "2": ["m4_known"] }, entries: { m4_known: { deleted: false } } };
const known = { status: "UNKNOWN", reason: "INSUFFICIENT_EVIDENCE", completeness: "partial" };
const store = {
  loadIndex: () => index,
  getKnownEntityEvidence: () => known
};
const profileService = new Memory4ProfileService(store);
const snapshot = { campaignToken: "campaign-A", gameDate: "1164.1.1", characters: {
  "1": { id: 1, courtEmployer: "10", liege: "10" },
  "2": { id: 2, courtEmployer: "10", liege: "10", alive: true, location: "123" },
  "3": { id: 3, courtEmployer: "20", liege: "20", alive: true, location: "456" }
} };
const gameData = { campaignToken: "campaign-A", date: "1164.1.1", playerID: 9, characters: new Map([
  [1, { id: 1, relationsToCharacters: [{ id: 2, relations: ["friend"] }] }],
  [2, { id: 2, alive: true, location: "123", courtEmployer: "10", liege: "10" }],
  [3, { id: 3, alive: true, location: "456", courtEmployer: "20", liege: "20" }]
]) };

check("relationship alone confirms recognition without a Detail", () => {
  const profile = profileService.getProfile(scope, 2, { snapshot, gameData });
  assert.equal(profile.recognition.level, "DIRECT_RELATIONSHIP");
  assert.deepEqual(profile.relationship.types, ["friend"]);
  assert.equal(profile.memoryPointers.detailIds.length, 1);
});
check("Memory4 coordinator exposes the read-only profile without changing legacy paths", () => {
  const coordinator = Object.create(Memory4Coordinator.prototype);
  coordinator.profiles = profileService;
  assert.equal(coordinator.getKnownEntityProfile(scope, 2, { snapshot, gameData }).recognition.level, "DIRECT_RELATIONSHIP");
});
check("unknown means insufficient evidence, not never met", () => {
  gameData.characters.get(1).relationsToCharacters = [];
  index.byEntity["2"] = [];
  const profile = profileService.getProfile(scope, 2, { snapshot, gameData });
  assert.equal(profile.recognition.level, "UNKNOWN");
  assert.equal(profile.recognition.reason, "INSUFFICIENT_EVIDENCE");
  assert.equal(profile.relationship.status, "UNKNOWN");
});
check("mention-only does not become direct conversation", () => {
  Object.assign(known, { status: "MENTION_ONLY", mentionCount: 1, directConversationCount: 0 });
  assert.equal(profileService.getProfile(scope, 2, { snapshot, gameData }).recognition.level, "MENTION_ONLY");
});
check("profile does not cache live relationship or life state", () => {
  gameData.characters.get(1).relationsToCharacters = [{ id: 2, relations: ["friend"] }];
  const first = profileService.getProfile(scope, 2, { snapshot, gameData });
  gameData.characters.get(2).alive = false;
  const second = profileService.getProfile(scope, 2, { snapshot, gameData });
  gameData.characters.get(1).relationsToCharacters = [{ id: 2, relations: ["rival"] }];
  const third = profileService.getProfile(scope, 2, { snapshot, gameData });
  assert.deepEqual(first.relationship.types, ["friend"]);
  assert.deepEqual(third.relationship.types, ["rival"]);
  assert.equal(second.currentTruth.alive, false);
  assert.equal(snapshot.characters["2"].alive, true);
});
check("stale checkpoint and unauthorized third-person whereabouts are withheld", () => {
  gameData.characters.get(1).relationsToCharacters = [{ id: 2, relations: ["friend"] }];
  const stale = profileService.getProfile(scope, 2, { snapshot: { ...snapshot, gameDate: "1163.1.1" }, gameData });
  assert.deepEqual(stale.relationship.types, ["friend"]);
  assert.equal(stale.currentTruth.alive, false);
  const third = profileService.getProfile(scope, 3, { snapshot, gameData });
  assert.equal(Object.hasOwn(third.currentTruth, "location"), false);
  const otherCampaign = profileService.getProfile(scope, 2, { snapshot: { ...snapshot, campaignToken: "campaign-B" }, gameData });
  assert.equal(otherCampaign.relationship.status, "UNKNOWN");
  assert.deepEqual(otherCampaign.currentTruth, {});
});
check("Legacy pointers require explicit owner and entity evidence", () => {
  const legacy = [{ type: "folder_summary", memoryId: "legacy-2", content: "旧资料", knownBy: [1],
    provenance: { campaignToken: "campaign-A", folderOwnerId: 1, counterpartIds: [2] } },
  { type: "folder_summary", memoryId: "legacy-3", content: "另一人的资料", knownBy: [1],
    provenance: { campaignToken: "campaign-A", folderOwnerId: 1, counterpartIds: [3] } }];
  assert.deepEqual(profileService.getProfile(scope, 2, { snapshot, gameData, legacyMemories: legacy }).memoryPointers.legacyCoverageRefs, ["legacy-2"]);
});
check("index revision and explicit invalidation refresh pointer cache", () => {
  index.byEntity["2"] = ["m4_known"];
  assert.deepEqual(profileService.getProfile(scope, 2, { snapshot, gameData }).memoryPointers.detailIds, ["m4_known"]);
  index.revision++;
  index.byEntity["2"] = [];
  assert.deepEqual(profileService.getProfile(scope, 2, { snapshot, gameData }).memoryPointers.detailIds, []);
  profileService.invalidate(scope);
});
check("relationship transition requires two confirmed states and effect evidence", () => {
  const before = { campaignToken: "campaign-A", ownerId: 1, entityId: 2, status: "CONFIRMED", types: ["friend"], asOf: "1164.1.1", revision: 1 };
  const after = { ...before, types: ["rival"], asOf: "1164.1.2", revision: 2 };
  assert.equal(detectRelationshipChange({ before, after, effectEvidence: { status: "ACKNOWLEDGED" } }).detected, false);
  assert.equal(detectRelationshipChange({ before: { ...before, status: "UNKNOWN" }, after, effectEvidence: { status: "CONFIRMED" } }).detected, false);
  assert.equal(detectRelationshipChange({ before, after: { ...after, campaignToken: "campaign-B" }, effectEvidence: { status: "CONFIRMED" } }).detected, false);
  const change = detectRelationshipChange({ before, after, effectEvidence: { status: "CONFIRMED", source: "CK3_READBACK", campaignToken: "campaign-A", ownerId: 1, entityId: 2, observedAt: "1164.1.2", beforeRevision: 1, afterRevision: 2 } });
  assert.equal(change.detected, true);
  assert.equal(change.reason, "unknown");
  assert.equal(detectRelationshipChange({ before, after, effectEvidence: { status: "CONFIRMED", source: "CK3_READBACK", campaignToken: "campaign-A", ownerId: 1, entityId: 2, observedAt: "1164.1.2", beforeRevision: 2, afterRevision: 2 } }).detected, false);
});
check("distinct complete CK3 debug readbacks detect relationship changes, not ACK or a repeated log", () => {
  const observer = new Memory4RelationshipReadback();
  const fixture = relation => ({ campaignToken: "campaign-A", date: "1164.1.1", playerID: 9,
    characters: new Map([[1, { id: 1, relationsToCharacters: [{ id: 2, relations: [relation] }] }], [2, { id: 2 }]]) });
  assert.deepEqual(observer.observe(fixture("friend"), { size: 100, mtimeMs: 1, complete: true }), []);
  assert.deepEqual(observer.observe(fixture("rival"), { size: 100, mtimeMs: 1 }), []);
  assert.deepEqual(observer.observe(fixture("rival"), { size: 200, mtimeMs: 2, complete: false }), []);
  const changes = observer.observe(fixture("rival"), { size: 200, mtimeMs: 2, complete: true });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].ownerId, 1);
  assert.equal(changes[0].entityId, 2);
  assert.deepEqual(changes[0].before, ["friend"]);
  assert.deepEqual(changes[0].after, ["rival"]);
  assert.deepEqual(observer.observe(fixture("friend"), { size: 100, mtimeMs: 1, complete: true }), []);
  assert.deepEqual(observer.observe(fixture("friend"), { size: 300, mtimeMs: 3, complete: true }).map(item => item.before), [["rival"]]);
  assert.deepEqual(observer.observe({ ...fixture("rival"), campaignToken: "campaign-B" }, { size: 400, mtimeMs: 4, complete: true }), []);
});
check("missing or neutral CK3 relation never invents a transition", () => {
  const observer = new Memory4RelationshipReadback();
  const fixture = relations => ({ campaignToken: "campaign-A", date: "1164.1.1", playerID: 9,
    characters: new Map([[1, { id: 1, relationsToCharacters: relations == null ? [] : [{ id: 2, relations }] }], [2, { id: 2 }]]) });
  observer.observe(fixture(["friend"]), { size: 100, mtimeMs: 1, complete: true });
  assert.deepEqual(observer.observe(fixture(null), { size: 200, mtimeMs: 2, complete: true }), []);
  assert.deepEqual(observer.observe(fixture(["rival"]), { size: 300, mtimeMs: 3, complete: true }), []);
  assert.deepEqual(observer.observe(fixture(["无明确正式关系"]), { size: 400, mtimeMs: 4, complete: true }), []);
});
check("confirmed transition prioritizes only existing visible Durable fragments", () => {
  const fragments = [{ fragmentId: "other", entityIds: [3], text: "谈天气。" },
    { fragmentId: "related", entityIds: [2], text: "与乙交谈。" }];
  const prompt = Memory4Coordinator.prototype.buildPrompt({ ownerId: 1, campaignToken: "campaign-A", date: "1164.1.1",
    completeness: "complete", relationshipChangeEntityIds: [2] }, fragments);
  const payload = JSON.parse(prompt[1].content);
  assert.deepEqual(payload.fragments.map(item => item.fragmentId), ["related", "other"]);
  assert.equal(prompt[1].content.includes("rival"), false);
  assert.equal(prompt[1].content.includes("friend"), false);
  const many = Array.from({ length: 64 }, (_, index) => ({ fragmentId: `unrelated-${index}`, entityIds: [], text: "其他事实" }));
  assert.equal(Memory4Coordinator.prototype.orderFragments({ relationshipChangeEntityIds: [2] },
    [...many, fragments[1]])[0].fragmentId, "related");
});
check("Owner priority requires that Owner actually sees a related source fragment", () => {
  const message = { id: 1, role: "assistant", speakerCharacterId: 1, content: "我与乙谈过。",
    memory4Fragments: [{ start: 0, end: 6, visibility: "known_group", sourceType: "spoken", recipientIds: [2], entityIds: [2] }] };
  const context = { campaignToken: "campaign-A", conversationId: "conv", finalizationId: "fin", date: "1164.1.1",
    participants: [1, 2, 3].map(id => ({ id })), participantPresence: [1, 2, 3].map(characterId =>
      ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })), messages: [message],
    relationshipChanges: [{ campaignToken: "campaign-A", ownerId: 2, entityId: 1, detected: true },
      { campaignToken: "campaign-A", ownerId: 3, entityId: 2, detected: true }] };
  const coordinator = Object.create(Memory4Coordinator.prototype);
  assert.deepEqual(coordinator.buildOwnerSnapshot(context, 2).relationshipChangeEntityIds, []);
  assert.deepEqual(coordinator.buildOwnerSnapshot(context, 3).relationshipChangeEntityIds, []);
  context.relationshipChanges[0].entityId = 2;
  assert.deepEqual(coordinator.buildOwnerSnapshot(context, 2).relationshipChangeEntityIds, [2]);
});
check("relationship readback metadata never changes the Legacy final-summary Prompt", () => {
  const extractor = new MemoryExtractor();
  const context = { messages: [{ id: 1, role: "user", content: "你好" }], participants: [{ id: 1, name: "甲" }], date: "1164.1.1" };
  assert.deepEqual(extractor.buildPrompt(context), extractor.buildPrompt({ ...context,
    relationshipChanges: [{ ownerId: 1, entityId: 2, before: ["friend"], after: ["rival"] }] }));
});
checkAsync("Conversation CK3 refresh feeds readback after a stable log parse without changing summary data", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-b-readback-"));
  const file = path.join(root, "debug.log");
  try {
    const lines = relation => [
      "VOTC:IN/;/init/;/1/;/Player/;/1/;/Player/;/1164.1.1/;/conversation/;/court/;/Player/;/425000",
      "VOTC:IN/;/character/;/1/;/Player",
      "VOTC:IN/;/character/;/2/;/NPC",
      `VOTC:IN/;/new_relations/;/1/;/2/;/#${relation}#ENDMULTILINE`,
      "VOTC:CAMPAIGN/votc8c-123456789012"
    ].join("\n") + "\n";
    fs.writeFileSync(file, lines("friend"));
    const observer = new Memory4RelationshipReadback();
    const changes = [];
    class GameData { constructor(data) { this.date = data[4]; this.playerID = Number(data[0]); this.characters = new Map(); }
      loadCharactersSummaries() {} syncOfficialRecollectionSummaries() {} }
    class Character { constructor(data) { this.id = Number(data[0]); this.relationsToCharacters = []; this.relationsToPlayer = []; } }
    Conversation.configure({ settingsRepository: { getCK3DebugLogPath: () => file }, parseLog: createLogParser({ GameData, Character }),
      memoryEngine: { memory4: { observeCK3Readback: (data, stamp) => {
        const result = observer.observe(data, stamp);
        changes.push(...result);
        return result;
      } } } });
    const conversation = { id: "conversation-A", gameDataRevision: 0,
      parseCK3GameData: Conversation.prototype.parseCK3GameData };
    await Conversation.prototype.refreshGameDataForActionConfirmation.call(conversation);
    fs.appendFileSync(file, lines("rival"));
    await Conversation.prototype.refreshGameDataForActionConfirmation.call(conversation);
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].after, ["rival"]);
    assert.equal(conversation.memory4RelationshipChanges.length, 1);
    assert.equal(conversation.gameDataRevision, 2);
    fs.appendFileSync(file, lines("friend").replace("#ENDMULTILINE", ""));
    await Conversation.prototype.refreshGameDataForActionConfirmation.call(conversation);
    assert.equal(conversation.gameData.ck3RelationshipReadbackComplete, false);
    assert.equal(changes.length, 1);
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(root);
  }
});
Promise.resolve().then(async () => {
  for (const item of asyncChecks) { await item.run(); checks++; console.log(`PASS ${item.name}`); }
  console.log(`V8.14-B profile: ${checks} PASS`);
}).catch(error => { console.error(error); process.exitCode = 1; });
