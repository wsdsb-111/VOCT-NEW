"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");
const { scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8151-disclosure-"));
const campaignToken = "v8.15.1-disclosure-fixture";
const date = "1164.5.20";
const characters = [
  { id: 1, names: ["赵太初", "甲"], firstName: "赵太初", shortName: "甲", fullName: "赵太初", primaryTitle: "明王",
    titleRankConcept: "concept_kingdom", titles: ["皇帝"], heldCourtAndCouncilPositions: ["枢密使"],
    traits: [{ id: "brave", name: "勇敢" }] },
  { id: 2, firstName: "乙", shortName: "乙", fullName: "乙", primaryTitle: "皇帝", titleRankConcept: "concept_empire",
    age: 23, traits: [{ id: "diligent", name: "勤勉" }] },
  { id: 3, firstName: "丙", shortName: "丙", fullName: "丙", traits: [] },
  { id: 4, firstName: "丁", shortName: "丁", fullName: "丁", traits: [] }
];
const gameData = (token = campaignToken) => ({ campaignToken: token, date,
  characters: new Map(characters.map(character => [character.id, character])) });

function appSnapshot({ role, text, speakerId, ownerId, knownBy = [1, 2, 3], entityIds = [1] }) {
  const context = { campaignToken, conversationId: "app-fragment-conversation", ownerId, date, totalDays: 1,
    participants: characters,
    participantPresence: [1, 2, 3].map(characterId => ({ characterId, joinedAtMessageId: 0 }))
      .concat([{ characterId: 4, joinedAtMessageId: 20 }]),
    messages: [{ id: 0, role, speakerCharacterId: speakerId, content: text,
      memory4Fragments: [{ start: 0, end: text.length, visibility: "participants", sourceType: "spoken",
        recipientIds: knownBy.filter(id => id !== speakerId), knownBy, entityIds }] }]
  };
  const projection = projectVisibleTranscript(context, ownerId);
  return { ...context, ...projection, sourceRevision: projection.sourceRevision, finalizationId: "app-fragment-finalization",
    disclosureCharacters: characters };
}

function fact(rows, factType, value) {
  return rows.find(row => row.factType === factType && row.value === value);
}

function segment(segmentId, messageId, speakerId, content) {
  return { segmentId, content, participants: [1, 2, 3], knownBy: [1, 2, 3], visibility: "public", source: "spoken",
    provenance: { messageIds: [messageId], speakerIds: [speakerId] } };
}

function finalizationContext({ token = campaignToken, conversationId = "public-disclosure-conversation",
  finalizationId = "public-disclosure-finalization" } = {}) {
  const messages = [
    { id: 0, role: "user", speakerCharacterId: 1, content: "我乃明王，亦任枢密使，生性勇敢。" },
    { id: 1, role: "assistant", speakerCharacterId: 2, content: "我确为皇帝，也很勤勉。" },
    { id: 2, role: "assistant", speakerCharacterId: 2, content: "乙说道：“甲是明王，甲很勇敢。”" }
  ];
  const verifiedSummarySegments = [segment("seg-player-self", 0, 1, messages[0].content),
    segment("seg-npc-self", 1, 2, messages[1].content), segment("seg-npc-announces-player", 2, 2, messages[2].content)];
  const directedSummaries = {
    "1->2": { ownerId: 1, counterpartId: 2, summarySegmentIds: ["seg-npc-self", "seg-npc-announces-player"] },
    "2->1": { ownerId: 2, counterpartId: 1, summarySegmentIds: ["seg-player-self", "seg-npc-announces-player"] },
    "3->1": { ownerId: 3, counterpartId: 1, summarySegmentIds: ["seg-player-self", "seg-npc-announces-player"] },
    "3->2": { ownerId: 3, counterpartId: 2, summarySegmentIds: ["seg-npc-self", "seg-npc-announces-player"] }
  };
  return { campaignToken: token, conversationId, finalizationId, episodeId: `${finalizationId}-episode`, date, totalDays: 1,
    finalizationVisibilityV1: true, participants: characters,
    participantPresence: [1, 2, 3].map(characterId => ({ characterId, joinedAtMessageId: 0 }))
      .concat([{ characterId: 4, joinedAtMessageId: 20 }]),
    messages, verifiedSummarySegments, directedSummaries, disclosureCharacters: characters };
}

async function run() {
  const summariesDir = path.join(temporary, "summaries");
  for (const character of characters) fs.mkdirSync(path.join(summariesDir, `${character.id}_${character.fullName}`), { recursive: true });
  const baseDir = path.join(temporary, "memory");
  const coordinator = new Memory4Coordinator(new MemoryStore({ baseDir, summaryFoldersDir: summariesDir }));
  try {
    const playerSelf = appSnapshot({ role: "user", text: "我乃明王，生性勇敢。", speakerId: 1, ownerId: 2 });
    assert.equal(playerSelf.fragments[0].sourceRole, "user", "application annotations preserve the source message role");
    let scanned = scanVisibleDisclosures(playerSelf, gameData());
    assert(fact(scanned.disclosures, "TITLE", "明王"));
    assert(fact(scanned.disclosures, "TRAIT", "勇敢"));

    const assistantSelf = appSnapshot({ role: "assistant", text: "我确为皇帝，也很勤勉。", speakerId: 2, ownerId: 1 });
    assert.equal(assistantSelf.fragments[0].sourceRole, "assistant");
    scanned = scanVisibleDisclosures(assistantSelf, gameData());
    assert(fact(scanned.disclosures, "TITLE", "皇帝"), "a speaking NPC can announce its current title in first person");
    assert(fact(scanned.disclosures, "TRAIT", "勤勉"), "a speaking NPC can announce its current trait in first person");

    const labeledSelf = appSnapshot({ role: "assistant", text: "我的头衔是皇帝，我的特质是勤勉。", speakerId: 2, ownerId: 1 });
    scanned = scanVisibleDisclosures(labeledSelf, gameData());
    assert(fact(scanned.disclosures, "TITLE", "皇帝"), "explicit title labels are recognized in first-person speech");
    assert(fact(scanned.disclosures, "TRAIT", "勤勉"), "explicit trait labels are recognized in first-person speech");
    const ageSelf = appSnapshot({ role: "assistant", text: "我今年二十三岁。", speakerId: 2, ownerId: 1 });
    assert.equal(fact(scanVisibleDisclosures(ageSelf, gameData()).disclosures, "AGE", "23")?.value, "23",
      "Chinese spoken numerals in a current first-person age statement match CK3 age");
    const relationTraitData = gameData();
    relationTraitData.characters.set(2, { ...characters[1], traits: [{ id: "brave", name: "勇敢" }] });
    const kingRelationData = gameData();
    kingRelationData.characters.set(2, { ...characters[1], titleRankConcept: "concept_kingdom" });
    for (const [text, factType, value, currentData] of [["我是皇帝的朋友。", "TITLE", "皇帝", relationTraitData],
      ["我乃皇帝的臣子。", "TITLE", "皇帝", relationTraitData], ["我乃皇帝之臣。", "TITLE", "皇帝", relationTraitData],
      ["我很勇敢的弟弟。", "TRAIT", "勇敢", relationTraitData], ["I am an emperor's friend.", "TITLE", "皇帝", relationTraitData],
      ["I am a king’s servant.", "TITLE", "国王", kingRelationData]]) {
      const relation = appSnapshot({ role: "assistant", text, speakerId: 2, ownerId: 1, entityIds: [1, 2] });
      assert.equal(fact(scanVisibleDisclosures(relation, currentData).disclosures, factType, value), undefined,
        `a relationship noun modifier must not disclose the embedded fact: ${text}`);
    }
    for (const text of ["我是勇敢的。", "我的特质是勇敢的。"]) {
      const sentenceFinalParticle = appSnapshot({ role: "assistant", text, speakerId: 2, ownerId: 1, entityIds: [1, 2] });
      assert(fact(scanVisibleDisclosures(sentenceFinalParticle, relationTraitData).disclosures, "TRAIT", "勇敢"),
        `a sentence-final 的 particle remains a valid positive self-claim: ${text}`);
    }

    const otherAnnouncement = appSnapshot({ role: "assistant", text: "乙说道：“甲是明王，甲很勇敢。”", speakerId: 2, ownerId: 3 });
    scanned = scanVisibleDisclosures(otherAnnouncement, gameData());
    assert(fact(scanned.disclosures, "TITLE", "明王"), "a reliable direct quote can announce another character's title");
    assert(fact(scanned.disclosures, "TRAIT", "勇敢"), "a reliable direct quote can announce another character's trait");
    const namedAnnouncement = appSnapshot({ role: "user", text: "我告诉你：赵太初是皇帝，也很勇敢。", speakerId: 2, ownerId: 3 });
    scanned = scanVisibleDisclosures(namedAnnouncement, gameData());
    assert(fact(scanned.disclosures, "TITLE", "皇帝"), "a direct announcement by another speaker matches a unique public identity");
    assert(fact(scanned.disclosures, "TRAIT", "勇敢"), "a direct announcement by another speaker matches a canonical trait alias");
    assert(scanned.disclosures.every(row => row.factType !== "NAME"), "names remain entity identifiers, not disclosure facts");
    const rankAnnouncement = appSnapshot({ role: "user", text: "我就是国王。", speakerId: 1, ownerId: 2 });
    assert(fact(scanVisibleDisclosures(rankAnnouncement, gameData()).disclosures, "TITLE", "国王"),
      "title-rank candidates recognize their spoken rank value");

    for (const text of ["赵太初现在是皇帝。", "乙说道：“有人说赵太初是皇帝。”", "乙说道：“丙是皇帝。”",
      "我心想我乃皇帝。", "我听说自己是皇帝。", "我不是皇帝。", "我可能是皇帝。", "如果我是皇帝。", "我曾是皇帝。",
      "我明年二十三岁。", "我去年二十三岁。"] ) {
      const snapshot = appSnapshot({ role: "assistant", text, speakerId: 2, ownerId: 3,
        entityIds: [1, 2, 3] });
      assert.deepEqual(scanVisibleDisclosures(snapshot, gameData()).disclosures, [], `unsafe or non-current source must not disclose: ${text}`);
    }
    const unknownRole = { ...assistantSelf, fragments: assistantSelf.fragments.map(fragment => ({ ...fragment, sourceRole: "unknown" })) };
    const mixedRole = { ...assistantSelf, fragments: assistantSelf.fragments.map(fragment => ({ ...fragment, sourceRole: "mixed" })) };
    assert.deepEqual(scanVisibleDisclosures(unknownRole, gameData()).disclosures, [], "unknown source role fails closed");
    assert.deepEqual(scanVisibleDisclosures(mixedRole, gameData()).disclosures, [], "mixed source role fails closed");
    const notKnownByOwner = appSnapshot({ role: "user", text: "我乃明王。", speakerId: 1, ownerId: 3, knownBy: [1, 2] });
    assert.deepEqual(notKnownByOwner.fragments, [], "participant ACLs do not grant a late or excluded Owner access");

    const context = finalizationContext();
    const failed = await coordinator.finalizeCommitted(context, async () => { throw new Error("fixture_provider_failure"); },
      { isNarrativeCommitted: true });
    assert.equal(failed.status, "PARTIAL_FAILURE");
    assert.equal(failed.owners.find(owner => owner.ownerId === 2)?.status, "EXTRACTION_FAILED");
    const playerScope = { campaignToken, ownerId: 2 };
    const npcScope = { campaignToken, ownerId: 1 };
    const thirdPartyScope = { campaignToken, ownerId: 3 };
    const playerRows = coordinator.getCurrentDisclosures(playerScope, 1, gameData());
    assert.equal(fact(playerRows, "TITLE", "明王")?.effectiveKnown, true,
      "verified source disclosures persist before a durable Provider failure");
    assert.equal(fact(playerRows, "TITLE", "枢密使")?.effectiveKnown, true,
      "current office titles are recognized from their canonical candidates");
    assert.equal(fact(playerRows, "TRAIT", "勇敢")?.effectiveKnown, true);
    assert.equal(fact(coordinator.getCurrentDisclosures(npcScope, 2, gameData()), "TITLE", "皇帝")?.effectiveKnown, true,
      "assistant-role NPC self-disclosures persist for the listener");
    assert.equal(fact(coordinator.getCurrentDisclosures(thirdPartyScope, 1, gameData()), "TRAIT", "勇敢")?.effectiveKnown, true,
      "a listener records facts another speaker directly announces");
    const lateJoinerRows = coordinator.getCurrentDisclosures({ campaignToken, ownerId: 4 }, 1, gameData());
    assert(lateJoinerRows.length > 0, "the current fact catalog remains available to a late participant");
    assert(lateJoinerRows.every(row => row.effectiveKnown === false && row.status == null
      && Object.keys(row.evidenceBySource || {}).length === 0),
    "a participant who joined after the source receives no disclosure evidence");

    const restarted = new Memory4Coordinator(new MemoryStore({ baseDir, summaryFoldersDir: summariesDir }));
    assert.equal(fact(restarted.getCurrentDisclosures(playerScope, 1, gameData()), "TRAIT", "勇敢")?.effectiveKnown, true,
      "disclosures survive a Memory4Coordinator restart in the same campaign and Owner scope");

    const forgotten = coordinator.forgetSummaryProjection({ campaignToken, perspectiveOwnerId: 2, characterId: 1,
      conversationId: context.conversationId, finalizationId: context.finalizationId,
      segmentIds: ["seg-player-self", "seg-npc-announces-player"], sourceMessageIds: [0, 2] },
    { ownerId: 2, counterpartId: 1 });
    assert(forgotten.disclosureEvidenceRevoked > 0, "forgetting the source projection revokes its disclosure proof");
    assert.equal(fact(coordinator.getCurrentDisclosures(playerScope, 1, gameData()), "TITLE", "明王")?.effectiveKnown, false);

    const noDurableContext = finalizationContext({ token: "v8.15.1-no-durable", conversationId: "no-durable-conversation",
      finalizationId: "no-durable-finalization" });
    const noDurable = await coordinator.finalizeCommitted(noDurableContext,
      async () => JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }), { isNarrativeCommitted: true });
    assert.equal(noDurable.status, "COMPLETE");
    assert.equal(noDurable.owners.find(owner => owner.ownerId === 2)?.status, "NO_DURABLE_CONTENT");
    assert.equal(fact(coordinator.getCurrentDisclosures({ campaignToken: noDurableContext.campaignToken, ownerId: 2 }, 1,
      gameData(noDurableContext.campaignToken)), "TITLE", "明王")?.effectiveKnown, true,
    "valid disclosures persist when durable extraction succeeds with no long-term entry");
    console.log("V8.15.1 disclosure: PASS (production projection roles, self/third-party title and trait claims, Provider failure, restart, ACL, late join, forget, and NO_DURABLE_CONTENT)");
  } finally {
    const targetPath = path.resolve(temporary);
    assert(targetPath.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
