"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { MemoryTrace } = require("../resources/app/out/main/memory-system/memory-trace");
const { createMemoryRecord } = require("../resources/app/out/main/memory-system/memory-types");
const { extractTemporalAnchors } = require("../resources/app/out/main/memory-system/temporal-anchor-extractor");
const { buildDualTemporalIndex } = require("../resources/app/out/main/memory-system/summary-date-index");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v81212-"));
  try {
    const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: path.join(root, "summaries"),
      trace: new MemoryTrace({ logger: { log() {} } }) });
    const profileMemory = (memoryId, campaignToken, characterId, name) => createMemoryRecord({
      memoryId, type: "folder_summary", content: `${name}曾被提及`, participants: [1, 2, characterId], knownBy: [2],
      provenance: { campaignToken, folderOwnerId: 2, counterpartId: 1,
        participantProfiles: [{ id: characterId, name, shortName: name }] }
    });
    const memories = [profileMemory("a", "campaign-A", 555, "赵甲"), profileMemory("b", "campaign-B", 666, "赵乙"),
      profileMemory("legacy", null, 777, "旧角色")];
    engine.loadOwnerFolderMemories = ownerId => Number(ownerId) === 2 ? memories : [];
    Conversation.configure({ memoryEngine: engine, llmManager: { getCurrentContextLength: async () => 8000 },
      TokenCounter: { estimateTokens: text => String(text || "").length }, usageAnalytics: { record() {} },
      worldlineService: { getSettings: () => ({ v812MemoryEngine3Enabled: true }), isSubjectivePromptIntegrationEnabled: () => true } });
    const chat = Object.create(Conversation.prototype);
    const player = { id: 1, shortName: "玩家" }, npc = { id: 2, shortName: "NPC" };
    chat.id = "campaign-switch";
    chat.turnEpoch = 1;
    chat.messages = [];
    chat.gameData = { playerID: 1, date: "1152.6.12", totalDays: 6700, campaignToken: "campaign-A",
      characters: new Map([[1, player], [2, npc]]), mentionedCharactersInContext: new Set(),
      getMentionExclusionIds: () => [1, 2], getMentionableCharacterProfiles: () => new Map([[1, player], [2, npc]]) };
    chat.getHistoryForCharacter = () => chat.messages;
    chat.getPromptHistoryForCharacter = () => [];
    chat.getActiveConversationCharacters = () => [player, npc];
    chat.getMemoryTokenBudget = () => 1000;
    chat.buildPresenceContext = () => "";
    const ask = async query => {
      chat.messages.push({ id: chat.messages.length + 1, role: "user", content: query });
      chat.turnEpoch++;
      return chat.getMemoryContextFor(npc, 8000);
    };
    const first = await ask("赵甲现在在哪？");
    assert.deepEqual(first.worldlineRequest.mentionedEntityIds, [555]);
    const cacheA = chat.memoryState.mentionProfileCache;
    assert.equal(cacheA.campaignKey, "campaign-A");
    assert.deepEqual([...cacheA.ownerFolderMemoriesById.get(2)].map(memory => memory.memoryId), ["a"]);
    chat.gameData.campaignToken = "campaign-B";
    const switched = await ask("赵甲现在在哪？");
    assert.deepEqual(switched.worldlineRequest.mentionedEntityIds, []);
    assert.equal(chat.gameData.mentionedCharactersInContext.has(555), false);
    const cacheB = chat.memoryState.mentionProfileCache;
    assert.notEqual(cacheA, cacheB);
    assert.equal(cacheB.participantKey, cacheA.participantKey);
    assert.equal(cacheB.campaignKey, "campaign-B");
    assert.equal(cacheB.profiles.has(555), false);
    assert.equal(cacheB.profiles.has(777), false);
    assert.deepEqual([...cacheB.ownerFolderMemoriesById.get(2)].map(memory => memory.memoryId), ["b"]);
    const sameCampaign = await ask("赵乙现在如何？");
    assert.deepEqual(sameCampaign.worldlineRequest.mentionedEntityIds, [666]);
    const legacyBlocked = await ask("旧角色呢？");
    assert.equal(legacyBlocked.worldlineRequest.mentionedEntityIds.includes(777), false);
    assert.equal(chat.gameData.mentionedCharactersInContext.has(777), false);
    chat.gameData.campaignToken = null;
    const legacyAllowed = await ask("旧角色呢？");
    assert.equal(legacyAllowed.worldlineRequest.mentionedEntityIds.includes(777), true);

    const baseRef = extractTemporalAnchors("1145年发生战争", { anchorGameDate: "1150.6.12", messageId: 1 })[0];
    const summary = (memoryId, refs) => createMemoryRecord({ memoryId, type: "folder_summary", content: "1145年战争", eventDate: "1150.6.12",
      knownBy: [2], participants: [1, 2], provenance: { campaignToken: "campaign-A", folderOwnerId: 2, counterpartId: 1,
        perspectiveMemoryIds: ["memory-valid"], temporalRefs: refs } });
    const index = memory => buildDualTemporalIndex([memory], { ownerId: 2, counterpartId: 1, campaignToken: "campaign-A",
      currentGameDate: "1152.6.12", currentTotalDays: 6700 }).filter(entry => entry.axis === "event");
    assert.deepEqual(index(summary("valid", [{ ...baseRef, sourceMemoryIds: ["memory-valid"] }]))[0].ref.sourceMemoryIds, ["memory-valid"]);
    assert.deepEqual(index(summary("ghost", [{ ...baseRef, sourceMemoryIds: ["memory-ghost"] }])), []);
    assert.deepEqual(index(summary("mixed", [{ ...baseRef, sourceMemoryIds: ["memory-ghost", "memory-valid"] }]))[0].ref.sourceMemoryIds, ["memory-valid"]);
    assert.deepEqual(index(summary("segment", [{ ...baseRef, segmentIds: ["segment-valid"], sourceMemoryIds: ["memory-ghost"] }]))[0].ref.sourceMemoryIds, []);

    const folder = path.join(root, "summaries", "2_NPC");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "与玩家的对话.json"), JSON.stringify([{ playerId: 2, playerName: "NPC", characterId: 1,
      characterName: "玩家", content: "1145年战争", date: "1150.6.12", campaignToken: "campaign-A",
      perspectiveMemoryIds: ["memory-valid"], temporalRefs: [{ ...baseRef, sourceMemoryIds: ["memory-ghost", "memory-valid"] }] }]));
    const loaded = engine.store.loadFolderSummariesForCharacter(2);
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0].provenance.temporalRefs[0].sourceMemoryIds, ["memory-valid"]);
    console.log("V8.12.1.2 Review Closure: PASS");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
