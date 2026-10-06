"use strict";

const fs = require("fs");
const path = require("path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");

async function createMemoryUiFixture(profile) {
  const summariesDir = path.join(profile, "votc_data", "conversation_summaries");
  for (const [id, name] of [[1, "甲"], [2, "乙"], [3, "丙"], [4, "丁"]]) fs.mkdirSync(path.join(summariesDir, `${id}_${name}`), { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(profile, "votc_data", "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
  const scope = { campaignToken: "memory4-ui-fixture", ownerId: 2 };
  const context = { campaignToken: scope.campaignToken, conversationId: "fixture-conversation", finalizationId: "fixture-finalization",
    episodeId: "fixture-episode", date: "1164.1.1", totalDays: 425000,
    participants: [1, 2, 3].map(id => ({ id })), participantPresence: [1, 2].map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })),
    messages: ["1158年3月12日，我答应在秋收后分两次运送粮食，余下的一半要等河水退后。", "1161年8月7日，我告知乙，粮食已交到守仓人手中。"].map((content, index) => ({
      id: index + 1, role: "assistant", speakerCharacterId: 1, content,
      memory4Fragments: [{ start: 0, end: content.length, visibility: "participants", sourceType: "spoken", recipientIds: [2], entityIds: [1, 2] }]
    })) };
  const projection = projectVisibleTranscript(context, 2);
  const snapshot = { ...context, ...projection, ownerId: 2, counterpartIds: [1], summaryIds: ["fixture-summary"] };
  engine.memory4.store.commitOwner(snapshot, { status: "STORE", entries: projection.fragments.map((fragment, index) => ({
    memoryType: index ? "MAJOR_EXPERIENCE" : "COMMITMENT", text: fragment.text, fragmentIds: [fragment.fragmentId],
    entityIds: [1, 2], participantIds: [1, 2], topics: ["粮食"], eventTime: { status: "reported", precision: "day", from: index ? "1161.8.7" : "1158.3.12", to: index ? "1161.8.7" : "1158.3.12" }
  })) });
  engine.memory4.store.recordKnownEvidence({ ...context, ...projectVisibleTranscript(context, 3), ownerId: 3, conversationId: "third-owner", sourceRevision: "third-owner-evidence" });
  const archiveOwnerId = 4;
  const archiveText = "1160年6月1日，甲告知丁，粮食已经送到城门仓库。";
  const archiveContext = { ...context, conversationId: "archive-fixture-conversation", finalizationId: "archive-fixture-finalization",
    episodeId: "archive-fixture-episode", participants: [1, archiveOwnerId].map(id => ({ id })),
    participantPresence: [1, archiveOwnerId].map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })),
    messages: [{ id: 1, role: "assistant", speakerCharacterId: 1, content: archiveText,
      memory4Fragments: [{ start: 0, end: archiveText.length, visibility: "participants", sourceType: "spoken", recipientIds: [archiveOwnerId], entityIds: [1, archiveOwnerId] }] }] };
  const archiveProjection = projectVisibleTranscript(archiveContext, archiveOwnerId);
  const archiveSnapshot = { ...archiveContext, ...archiveProjection, ownerId: archiveOwnerId, counterpartIds: [1], summaryIds: ["archive-fixture-summary"] };
  engine.memory4.store.commitOwner(archiveSnapshot, { status: "STORE", entries: archiveProjection.fragments.map(fragment => ({
    memoryType: "MAJOR_EXPERIENCE", text: fragment.text, fragmentIds: [fragment.fragmentId], entityIds: [1, archiveOwnerId],
    participantIds: [1, archiveOwnerId], topics: ["粮食"], eventTime: { status: "reported", precision: "day", from: "1160.6.1", to: "1160.6.1" }
  })) });
  let requests = 0;
  engine.memory4.configureDerived({ isCampaignCurrent: token => token === scope.campaignToken,
    requestCompression: async () => { requests++; throw new Error("fixture_must_not_call_provider"); }, estimateTokens: text => Math.ceil(text.length / 2) });
  await engine.memory4.derived.rebuild(scope, { kind: "all", overwriteManual: false });
  const views = engine.memory4.derived.list(scope);
  const year = views.years[0];
  engine.memory4.derived.updateYear(scope, { eventYear: year.eventYear, itemId: year.items[0].itemId,
    text: "乙记得甲承诺分两次送粮，河水退后再送第二批。", expectedRevision: year.revision });
  const entries = engine.memory4.store.query(scope);
  engine.memory4.store.updateEntry(scope, entries[0].entryId, `${entries[0].text}乙保留这项约定。`, { expectedRevision: entries[0].revision });
  const official = { playerId: 2, playerName: "乙", characterId: 2, characterName: "官方追忆摘要", sourceType: "CK3_OFFICIAL_RECOLLECTION",
    campaignToken: scope.campaignToken, officialCaptureSessionId: "fixture-capture", captureGameDate: "1164.1.1", memoryCount: 1, content: "1160.2.1：乙记得自己在宫廷中受封。" };
  fs.writeFileSync(path.join(summariesDir, "2_乙", "官方追忆摘要.json"), JSON.stringify([official]), "utf8");
  fs.writeFileSync(path.join(summariesDir, "2_乙", "与甲的对话.json"), JSON.stringify([{ playerId: 2, playerName: "乙", characterId: 1, characterName: "甲",
    date: "1158.3.12", campaignToken: scope.campaignToken, campaignBinding: { status: "bound", source: "native" }, content: "乙曾与甲交谈，旧叙事没有可确认的独立片段。" },
    { playerId: 2, playerName: "乙", characterId: 1, characterName: "甲", date: "1157.1.1", content: "待绑定的旧摘要。" }]), "utf8");
  fs.writeFileSync(path.join(summariesDir, "4_丁", "与甲的对话.json"), JSON.stringify([{ playerId: archiveOwnerId, playerName: "丁", characterId: 1,
    characterName: "甲", date: "1160.6.1", campaignToken: scope.campaignToken, campaignBinding: { status: "bound", source: "native" }, content: archiveText,
    conversationId: archiveContext.conversationId, finalizationId: archiveContext.finalizationId, perspectiveOwnerId: archiveOwnerId,
    perspectiveMemoryIds: [], perspectiveSummarySegmentIds: archiveProjection.fragments.map(fragment => fragment.fragmentId),
    sourceSegmentIds: archiveProjection.fragments.map(fragment => fragment.fragmentId), sourceMessageIds: [1] }]), "utf8");
  const characters = [[1, "甲"], [2, "乙"], [3, "丙"]].map(([id, shortName]) => ({ id, shortName, fullName: shortName,
    relationsToCharacters: id === 2 ? [{ id: 1, relations: ["friend"] }] : [], relationsToPlayer: [] }));
  const conversation = { id: "isolated-ui-conversation", isActive: true, gameData: { campaignToken: scope.campaignToken, date: "1164.1.1", playerID: 1,
    characters: new Map(characters.map(character => [character.id, character])) }, memoryState: engine.createConversationState("isolated-ui-conversation"), dynamicRecallHistory: new Map() };
  return { engine, scope, summariesDir, conversation, characters, requests, profile,
    archive: { ownerId: archiveOwnerId, campaignToken: scope.campaignToken, directory: engine.memory4.store.directory({ campaignToken: scope.campaignToken, ownerId: archiveOwnerId }) } };
}

module.exports = { createMemoryUiFixture };
