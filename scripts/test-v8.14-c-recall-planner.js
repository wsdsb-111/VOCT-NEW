"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { Memory4RecallPlanner, parseRecallQuery, fitRecallPacket } = require("../resources/app/out/main/memory-system/memory4-recall-planner");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");
const { hash, legacySourceHash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { createMemoryRecord } = require("../resources/app/out/main/memory-system/memory-types");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { MentionTracker } = require("../resources/app/out/main/memory-system/mention-tracker");
const { MemoryTrace } = require("../resources/app/out/main/memory-system/memory-trace");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-memory4-c-"));
let checks = 0;
function check(name, test) { test(); checks++; console.log(`PASS ${name}`); }
async function main() {
try {
  const folders = path.join(root, "summaries");
  for (const id of [1, 2, 3, 4]) fs.mkdirSync(path.join(folders, `${id}_fixture`), { recursive: true });
  const base = new MemoryStore({ baseDir: path.join(root, "memory"), summaryFoldersDir: folders });
  const coordinator = new Memory4Coordinator(base);
  const planner = new Memory4RecallPlanner(coordinator);
  const scope = { campaignToken: "campaign-C", ownerId: 2 };
  const currentGameDate = "1184.8.11";
  const options = { ...scope, currentGameDate, currentTotalDays: normalizeGameDate(currentGameDate).serial,
    conversationId: "query-conversation", sceneRevision: "scene", turnEpoch: 1, querySpeakerId: 1,
    entityIds: [1], legacyMemories: [], memoryEngineRemainingBudget: 1200, providerRemainingSafeBudget: 1200,
    estimateTokens: text => Math.ceil(text.length / 2) };
  const snapshots = new Map();
  const add = (date, text, { ownerId = 2, campaignToken = scope.campaignToken, entityIds = [1], topics = ["议和"], finalizationId = `final-${date}-${text}`, eventTime = null } = {}) => {
    const context = { campaignToken, conversationId: finalizationId, finalizationId, episodeId: `episode-${finalizationId}`,
      date, totalDays: normalizeGameDate(date).serial, participants: [{ id: 1 }, { id: ownerId }],
      participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: ownerId, joinedAtMessageId: 0 }],
      messages: [{ id: 1, role: "user", speakerCharacterId: 1, content: text,
        memory4Fragments: [{ start: 0, end: text.length, visibility: "participants", sourceType: "spoken", recipientIds: [ownerId], entityIds }] }] };
    const projection = projectVisibleTranscript(context, ownerId);
    const snapshot = { ...context, ...projection, ownerId, counterpartIds: [1] };
    snapshots.set(finalizationId, snapshot);
    return coordinator.store.commitOwner(snapshot, { status: "STORE", entries: [{ memoryType: "COMMITMENT", text,
      fragmentIds: [projection.fragments[0].fragmentId], entityIds, participantIds: [1, ownerId], topics,
      eventTime: eventTime || { status: "unknown" } }] }).entryIds[0];
  };
  const oldId = add("1164.8.11", "我答应议和，但须先释放俘虏。");
  add("1180.1.1", "我也答应议和。", { campaignToken: "other-campaign" });
  add("1164.8.11", "旁人的秘密承诺。", { ownerId: 3 });
  check("relative year locks the game calendar", () => {
    const query = parseRecallQuery("你还记得二十年前我们聊过什么吗？", options);
    assert.equal(query.axis, "CONVERSATION");
    assert.equal(query.granularity, "YEAR");
    assert.equal(query.window.from, "1164.1.1");
    assert.equal(query.window.to, "1164.12.31");
  });
  check("bare year ranges and partial current year preserve their granularity", () => {
    const period = parseRecallQuery("1150–1160的经历", options);
    assert.equal(period.granularity, "PERIOD");
    assert.deepEqual(period.window, { from: "1150.1.1", to: "1160.12.31" });
    assert.equal(parseRecallQuery("1184年我们聊过什么？", options).granularity, "YEAR");
    assert.equal(parseRecallQuery("1180年至1184年的经历", options).window.to, currentGameDate);
    assert.equal(parseRecallQuery("1164 年 8 月 11 日我们聊过什么？", options).granularity, "EXACT_DATE");
  });
  check("owner/campaign hard gate and no wrong-year fill", () => {
    const packet = planner.plan({ ...options, query: "你还记得1164年我们聊过什么吗？" });
    assert.deepEqual(packet.details.map(item => item.memory.memoryId), [oldId]);
    assert(packet.text.includes("须先释放俘虏"));
    assert.equal(planner.plan({ ...options, query: "1170年我们聊过什么？" }).details.length, 0);
    assert.equal(packet.text.includes("旁人的秘密"), false);
  });
  check("event time never defaults to conversation time", () => {
    assert.equal(planner.plan({ ...options, query: "1164年发生的议和事件呢？" }).details.length, 0);
    assert.equal(planner.plan({ ...options, query: "1164年8月12日我们聊过什么？" }).details.length, 0);
    assert.equal(planner.plan({ ...options, query: "1164年8月11日我们聊过什么？" }).overview, null);
  });
  check("actual budget includes metadata and never clips conditions", () => {
    const packet = planner.plan({ ...options, query: "你答应过我的议和呢？" });
    assert(packet.tokens <= 1200);
    const fitted = fitRecallPacket(packet, 5, options.estimateTokens);
    assert(fitted.tokens <= 5);
    assert.equal(fitted.details.length, 0);
  });
  check("tombstones cannot be recalled", () => {
    coordinator.store.deleteEntry(scope, oldId);
    assert.equal(planner.plan({ ...options, query: "1164年我们聊过什么？" }).details.length, 0);
  });
  const eventId = add("1180.1.1", "1164年8月11日议和使者抵达，俘虏尚未释放。", {
    eventTime: { from: "1164.8.11", to: "1164.8.11", precision: "day", status: "reported" }
  });
  check("dual axis distinguishes a reported event from the later conversation", () => {
    const event = planner.plan({ ...options, query: "1164年8月11日发生的议和事件呢？" });
    assert.equal(event.details[0].memory.memoryId, eventId);
    assert.equal(event.details[0].reason.axis, "event");
    assert(event.text.includes("reported"));
    assert.equal(planner.plan({ ...options, query: "1164年8月11日我们聊过什么？" }).details.length, 0);
    assert.equal(planner.plan({ ...options, query: "1180年我们聊过什么？" }).details[0].memory.memoryId, eventId);
  });
  check("unsupported dates and absent game dates fail closed", () => {
    for (const query of ["1180年2月30日聊过什么？", "1199年发生了什么？", "1190年至1180年经历如何？"]) {
      assert.equal(planner.plan({ ...options, query }).items.length, 0);
    }
    assert.equal(planner.plan({ ...options, currentGameDate: null, currentTotalDays: null, query: "二十年前的议和呢？" }).items.length, 0);
    assert.equal(planner.plan({ ...options, query: "1160年至1165年的议和事件呢？" }).details[0].memory.memoryId, eventId);
  });
  const thirdId = add("1175.1.1", "我听玩家说三号人物希望议和。", { entityIds: [3] });
  check("third-party uses responder-owned evidence, not the subject folder", () => {
    const packet = planner.plan({ ...options, entityIds: [3], query: "你还记得三号人物吗？" });
    assert.equal(packet.details[0].memory.memoryId, thirdId);
    assert.equal(packet.text.includes("旁人的秘密"), false);
    assert(packet.profileText.includes("MENTION_ONLY"));
    assert.equal(packet.text.includes('"memoryPointers"'), false);
  });
  const groupSummary = (ownerId, memoryId, content) => createMemoryRecord({ memoryId, type: "folder_summary",
    subtype: "conversation_summary", content, eventDate: "1175.1.1", participants: [1, 2, 3],
    subjects: [1, 2, 3].filter(id => id !== ownerId), knownBy: [ownerId],
    provenance: { campaignToken: scope.campaignToken, folderOwnerId: ownerId, counterpartId: 1, counterpartIds: [1],
      campaignBinding: { status: "bound" }, participantProfiles: [1, 2, 3].map(id => ({ id, name: `人物${id}` })) } });
  const groupProfiles = new Map([
    [1, { id: 1, firstName: "赵太初", shortName: "赵太初", fullName: "赵太初" }],
    [2, { id: 2, firstName: "张道素", shortName: "张道素", fullName: "张道素" }],
    [3, { id: 3, firstName: "王道一", shortName: "王道一", fullName: "王道一" }],
    [4, { id: 4, firstName: "李道远", shortName: "李道远", fullName: "李道远" }]
  ]);
  const ambiguousGroupProfiles = new Map([...groupProfiles, [5, { id: 5, firstName: "李道远", shortName: "李道远", fullName: "李道远" }]]);
  const ownerBGroupMemory = groupSummary(2, "group-B-D", "李道远曾与赵太初谈论北境防务，并约定来年共同巡边。");
  const ownerCGroupMemory = groupSummary(3, "group-C-D", "李道远曾与王道一谈论北境防务，并约定来年共同巡边。");
  const groupRecall = (ownerId, memories, extra = {}) => planner.plan({ ...options, ownerId, querySpeakerId: 1,
    entityIds: [4], entityNamesById: { 4: ["李道远"] }, gameData: { characters: groupProfiles },
    entityProfiles: [...groupProfiles.values()],
    legacyMemories: memories, query: "你还记得李道远谈过的北境防务吗？", ...extra });
  check("text-only third-party mentions recall each present Owner's own group summary", () => {
    const fromB = groupRecall(2, [ownerBGroupMemory, ownerCGroupMemory]);
    const fromC = groupRecall(3, [ownerCGroupMemory, ownerBGroupMemory]);
    assert(fromB.text.includes("group-B-D"));
    assert.equal(fromB.text.includes("group-C-D"), false);
    assert(fromC.text.includes("group-C-D"));
    assert.equal(fromC.text.includes("group-B-D"), false);
    const historicalProfile = groupRecall(2, [ownerBGroupMemory], {
      gameData: { characters: new Map([...groupProfiles].filter(([id]) => id !== 4)) }
    });
    assert(historicalProfile.text.includes("group-B-D"));
    const gameDataOnly = groupRecall(2, [ownerBGroupMemory], { entityProfiles: null });
    assert(gameDataOnly.text.includes("group-B-D"));
  });
  check("ambiguous third-party names do not broaden Legacy recall", () => {
    const packet = groupRecall(2, [ownerBGroupMemory], { gameData: { characters: ambiguousGroupProfiles },
      entityProfiles: [...ambiguousGroupProfiles.values()] });
    assert.equal(packet.items.length, 0);
  });
  check("NPC speech mentions are current-turn entities, while prior-turn mentions expire", () => {
    const tracker = new MentionTracker();
    const state = tracker.createState();
    const candidates = [...groupProfiles.values()];
    tracker.update(state, { history: [
      { id: 1, role: "user", content: "谈谈边境防务。" },
      { id: 2, role: "assistant", content: "李道远曾与我商议巡边。" }
    ], candidates, excludedIds: [1, 2, 3] });
    assert.deepEqual(state.currentTurnMentionedCharacterIds, [4]);
    tracker.update(state, { history: [
      { id: 1, role: "user", content: "谈谈边境防务。" },
      { id: 2, role: "assistant", content: "李道远曾与我商议巡边。" },
      { id: 3, role: "user", content: "继续谈谈边境防务。" },
      { id: 4, role: "assistant", content: "他也赞成。" }
    ], candidates, excludedIds: [1, 2, 3] });
    assert.deepEqual(state.currentTurnMentionedCharacterIds, []);
  });
  check("text-only Legacy recall keeps campaign, Owner knowledge and future-date gates", () => {
    const rejected = [
      { ...ownerBGroupMemory, memoryId: "group-wrong-campaign", provenance: { ...ownerBGroupMemory.provenance, campaignToken: "other-campaign" } },
      { ...ownerBGroupMemory, memoryId: "group-wrong-knownby", knownBy: [3] },
      { ...ownerBGroupMemory, memoryId: "group-unresolved-binding", provenance: { ...ownerBGroupMemory.provenance,
        campaignBinding: { status: "unresolved" } } },
      { ...ownerBGroupMemory, memoryId: "group-future", eventDate: "1185.1.1" }
    ];
    for (const memory of rejected) assert.equal(groupRecall(2, [memory]).items.length, 0, memory.memoryId);
  });
  check("MemoryEngine routes resolved third-party aliases by entity ID", () => {
    const routedEngine = new MemoryEngine({ store: base, trace: { record() {} } });
    const otherProfile = { id: 5, firstName: "王五", shortName: "王五", fullName: "王五" };
    const resolvedThirdProfile = { ...groupProfiles.get(4), mentionAliases: ["李道远旧称"] };
    const routeProfiles = [...groupProfiles.values()].map(profile => profile.id === 4 ? resolvedThirdProfile : profile).concat(otherProfile);
    let recallOptions;
    routedEngine.memory4Recall = { plan: value => {
      recallOptions = value;
      return { items: [], details: [], overview: null, text: null, tokens: 0, focus: null, sourceRefs: [] };
    } };
    const routedState = routedEngine.createConversationState("third-party-alias-route");
    routedEngine.retrieveForResponder({ characterId: 2, query: "你还记得王五吗？", querySpeakerId: 1,
      directCounterpartIds: [1, 3], mentionedEntityIds: [4], mentionedEntityNames: { 4: ["李道远", "李道远旧称"], 5: ["王五"] },
      queryEntityIds: [5], currentGameDate, currentTotalDays: options.currentTotalDays, campaignToken: scope.campaignToken,
      conversationId: "third-party-alias-route", sceneRevision: "scene", turnEpoch: 1,
      memoryEngine3Enabled: true, memory4RecallEnabled: true, gameData: { characters: new Map([...groupProfiles, [5, otherProfile]]) },
      entityProfiles: routeProfiles,
      sessionRecallCache: routedState.responderRecallCache, tokenBudget: 800, estimateTokens: options.estimateTokens });
    assert.deepEqual(recallOptions.entityIds, [5, 4]);
    assert.deepEqual(recallOptions.entityNamesById, { 4: ["李道远", "李道远旧称"], 5: ["王五"] });
    const historicalAliasMemory = groupSummary(2, "group-resolved-alias", "李道远旧称曾与赵太初谈论北境防务。");
    const resolvedAliasRecall = planner.plan({ ...options, query: "你还记得李道远旧称谈过的北境防务吗？", entityIds: [4],
      entityNamesById: recallOptions.entityNamesById, entityNames: Object.values(recallOptions.entityNamesById).flat(),
      gameData: { characters: new Map([...groupProfiles, [5, otherProfile]]) }, entityProfiles: routeProfiles,
      legacyMemories: [historicalAliasMemory] });
    assert(resolvedAliasRecall.items.some(item => item.memory.memoryId === "group-resolved-alias"));

    const folderPath = path.join(folders, "2_fixture", "与旁人甲的对话.json");
    base.writeJson(folderPath, [{ playerId: 99, characterId: 2, playerName: "旁人甲", characterName: "乙",
      date: "1175.1.1", totalDays: normalizeGameDate("1175.1.1").serial, campaignToken: scope.campaignToken,
      campaignBinding: { status: "bound" }, participants: [2, 99].map(id => ({ id, name: `人物${id}` })),
      content: ownerBGroupMemory.content }]);
    base.invalidateFolderSummaryCache([2]);
    const pipelineEngine = new MemoryEngine({ store: base, trace: { record() {} } });
    const pipelineState = pipelineEngine.createConversationState("third-party-text-recall");
    const pipelineContext = pipelineEngine.retrieveForResponder({ characterId: 2,
      query: "你还记得谈过的北境防务吗？", querySpeakerId: 1, directCounterpartIds: [1, 3],
      mentionedEntityIds: [4], mentionedEntityNames: { 4: ["李道远"] }, queryEntityIds: [],
      currentGameDate, currentTotalDays: options.currentTotalDays, campaignToken: scope.campaignToken,
      conversationId: "third-party-text-recall", sceneRevision: "scene", turnEpoch: 1,
      memoryEngine3Enabled: true, memory4RecallEnabled: true,
      gameData: { characters: new Map([...groupProfiles].filter(([id]) => id !== 4)) },
      entityProfiles: [...groupProfiles.values()], ownerFolderMemories: pipelineEngine.loadOwnerFolderMemories(2),
      sessionRecallCache: pipelineState.responderRecallCache, tokenBudget: 2400, estimateTokens: options.estimateTokens });
    assert(pipelineContext.temporalExtraText.includes(ownerBGroupMemory.content), JSON.stringify({
      snapshotCount: pipelineContext.temporalDiagnostics.folderMemoryCount,
      memory4Diagnostics: pipelineContext.memory4Diagnostics,
      packet: pipelineContext.memory4Packet
    }));
  });
  check("short entity aliases do not match inside a longer character name", () => {
    const shortName = { id: 4, firstName: "张三", shortName: "张三", fullName: "张三" };
    const longName = { id: 5, firstName: "张三丰", shortName: "张三丰", fullName: "张三丰" };
    const query = "你还记得张三谈过的北境防务吗？";
    const recall = memory => planner.plan({ ...options, query, entityIds: [4], entityNamesById: { 4: ["张三"] },
      gameData: { characters: new Map([[4, shortName], [5, longName]]) }, entityProfiles: [shortName, longName],
      legacyMemories: [memory] });
    const falseMatch = recall(groupSummary(2, "group-overlapping-name", "张三丰曾与赵太初谈论北境防务。"));
    assert.equal(falseMatch.items.some(item => item.memory.memoryId === "group-overlapping-name"), false);
    const exactMatch = recall(groupSummary(2, "group-exact-short-name", "张三曾与赵太初谈论北境防务。"));
    assert(exactMatch.items.some(item => item.memory.memoryId === "group-exact-short-name"));
  });
  check("multiple entities share one 2+1 budget and LIFE allows one Detail", () => {
    add("1176.1.1", "一号与三号共同议和。", { entityIds: [1, 3] });
    const packet = planner.plan({ ...options, entityIds: [1, 3], query: "一号与三号的议和约定呢？" });
    assert(packet.details.length <= 2); assert(packet.tokens <= 1200);
    assert.equal(packet.details[0].memory.tags.includes("议和"), true);
    assert.equal(planner.plan({ ...options, entityIds: [1, 3], query: "他们一生的经历如何？" }).details.length, 1);
  });
  check("ambiguous identity suppresses unrelated direct-pair fallback", () => {
    assert.equal(planner.plan({ ...options, query: "你还记得李甲吗？", identityUnresolved: true }).items.length, 0);
    const tracker = new MentionTracker();
    assert.deepEqual(tracker.findMentionedCharacterIds([{ content: "你还记得李甲吗？" }], {
      candidates: [{ id: 3, name: "李甲" }, { id: 4, name: "李甲" }]
    }), []);
    assert.equal(tracker.lastScanUnresolved, true);
    tracker.findMentionedCharacterIds([{ content: "你好" }]);
    assert.equal(tracker.lastScanUnresolved, false);
  });
  const mutateEntry = (entryId, change, targetScope = scope) => {
    const index = coordinator.store.loadIndex(targetScope);
    const entry = coordinator.store.readEntry(targetScope, entryId, index);
    change(entry); entry.revision++;
    const directory = coordinator.store.directory(targetScope);
    base.writeJson(coordinator.store.entryPath(directory, entryId), entry);
    index.entries[entryId] = coordinator.store.indexRow(entry); index.revision++; coordinator.store.reindex(index);
    const metadata = coordinator.store.read(path.join(directory, "metadata.json"));
    base.writeJson(path.join(directory, "index.json"), index);
    base.writeJson(path.join(directory, "metadata.json"), { ...metadata, revision: index.revision, indexHash: hash(index) });
  };
  check("ACL and stale visibility revisions are hard gates", () => {
    const id = add("1177.1.1", "不得泄漏的密约。", { topics: ["密约"], finalizationId: "acl" });
    mutateEntry(id, entry => { entry.evidence.knownBy = [3]; entry.evidence.visibility = "private"; });
    assert.equal(planner.plan({ ...options, query: "1177年我们聊过什么？" }).items.length, 0);
    const source = snapshots.get("acl");
    coordinator.store.recordKnownEvidence({ ...source, sourceRevision: "revised-source", fragments: [], interactionEvidence: [] });
    assert.equal(planner.plan({ ...options, query: "1177年我们聊过什么？" }).items.length, 0);
  });
  check("historical expired facts remain labeled but cannot satisfy active commitments", () => {
    const id = add("1178.1.1", "过去答应归还玉印。", { topics: ["玉印"] });
    mutateEntry(id, entry => { entry.state.status = "expired"; });
    const historical = planner.plan({ ...options, query: "1178年我们聊过什么？" });
    assert(historical.text.includes("expired"));
    assert.equal(planner.plan({ ...options, query: "1178年尚未完成的约定呢？" }).items.length, 0);
  });
  const legacy = (id, content, extra = {}) => createMemoryRecord({ memoryId: id, type: "folder_summary", content,
    eventDate: "1164.8.11", knownBy: [2], subjects: [1],
    provenance: { campaignToken: scope.campaignToken, folderOwnerId: 2, counterpartId: 1, counterpartIds: [1],
      campaignBinding: { status: "bound" }, ...extra } });
  check("Legacy enables both temporal axes without changing original bytes", () => {
    const memory = legacy("dual-old", "1170年玩家讲述了1164年的议和经过。", { perspectiveMemoryIds: ["legacy-event"], temporalRefs: [{
      kind: "event_time", fromGameDate: "1164.1.1", toGameDate: "1164.12.31", precision: "year", source: "deterministic_message_parse",
      targetGameYear: 1164, expression: "1164年",
      timeRole: "event", sourceMemoryIds: ["legacy-event"], segmentIds: [], messageIds: [1]
    }] });
    memory.eventDate = "1170.1.1";
    const before = JSON.stringify(memory);
    const packet = planner.plan({ ...options, legacyMemories: [memory], query: "1164年发生的议和呢？" });
    assert.equal(packet.overview.memory.memoryId, memory.memoryId);
    assert.equal(packet.overview.reason.axis, "event");
    assert.equal(planner.plan({ ...options, legacyMemories: [memory], query: "1164年我们聊过什么？" }).overview, null);
    assert.equal(planner.plan({ ...options, legacyMemories: [memory], query: "1164年8月11日发生什么？" }).details.some(item => item.memory.memoryId === memory.memoryId), false);
    assert.equal(JSON.stringify(memory), before);
  });
  let convertedId;
  let five;
  let parts;
  check("one converted fact suppresses only its proven Legacy fragment", () => {
    parts = ["甲", "乙", "丙", "丁", "戊"].map((name, index) => base.saveMemory({ memoryId: `part-${index}`, content: `${name}的独立旧约定。`,
      knownBy: [2], subjects: [1], updatedBy: "user", provenance: { ...scope, folderOwnerId: 2,
        finalizationId: "legacy-five", extractionMode: "user_edited_summary" } }));
    five = legacy("five", `【乙能够知道并记住的本场内容】\n${parts.map(part => `- ${part.content}`).join("\n")}`,
      { perspectiveMemoryIds: parts.map(part => part.memoryId), finalizationId: "legacy-five" });
    const context = { ...scope, conversationId: "legacy-five", finalizationId: "legacy-five", date: "1164.8.11", totalDays: 1,
      messages: [], participants: [], legacyMemories: [parts[2]] };
    const projection = projectVisibleTranscript(context, 2);
    const snapshot = { ...context, ...projection, counterpartIds: [] };
    convertedId = coordinator.store.commitOwner(snapshot, { status: "STORE", entries: [{ memoryType: "COMMITMENT",
      text: parts[2].content, fragmentIds: [projection.fragments[0].fragmentId], entityIds: [1], topics: ["独立旧约定"] }] }).entryIds[0];
    assert.equal(coordinator.store.readEntry(scope, convertedId).source.legacyRefs[0].sourceHash, legacySourceHash(parts[2]));
    const candidates = planner.legacyCandidates([five], scope, coordinator.store.loadIndex(scope));
    assert.equal(candidates.length, 4);
    assert.equal(candidates.some(memory => memory.content === parts[2].content), false);
    assert.deepEqual(candidates.map(memory => memory.content), parts.filter((_, index) => index !== 2).map(part => part.content));
    const unsplit = { ...five, content: `${five.content}\n这段叙事还有另外四项消息。` };
    assert.equal(planner.legacyCandidates([unsplit], scope, coordinator.store.loadIndex(scope))[0].content, unsplit.content);
  });
  check("Detail tombstone preserves Legacy suppression without resurrecting an event", () => {
    coordinator.store.deleteEntry(scope, convertedId);
    assert.equal(planner.legacyCandidates([five], scope, coordinator.store.loadIndex(scope)).length, 4);
  });
  check("Legacy source changes invalidate coverage, not the unsplittable parent narrative", () => {
    base.updateMemory(parts[2].memoryId, { content: "修订后是另一项约定。" });
    assert.deepEqual(planner.legacyCandidates([five], scope, coordinator.store.loadIndex(scope)).map(memory => memory.content), [five.content],
      "V8.15 incomplete coverage retains the independently owned visible parent until explicit forget");
    const updated = { ...five, content: `【乙能够知道并记住的本场内容】\n${parts.map(part => `- ${base.getMemory(part.memoryId).content}`).join("\n")}` };
    assert.equal(planner.legacyCandidates([updated], scope, coordinator.store.loadIndex(scope)).length, 5);
    base.deleteMemory(parts[1].memoryId);
    assert.deepEqual(planner.legacyCandidates([five], scope, coordinator.store.loadIndex(scope)).map(memory => memory.content), [five.content]);
  });
  check("first meeting chooses earliest explicit evidence across both lanes, not arbitrary earliest chat", () => {
    add("1100.1.1", "这并非第一次见到你。");
    add("1150.1.1", "这是第一次见到你，议和使者。", { topics: ["相识"] });
    const earlier = legacy("earliest-legacy", "初次相识，你曾带来一枚玉印。"); earlier.eventDate = "1140.1.1";
    const packet = planner.plan({ ...options, legacyMemories: [earlier], query: "第一次见到你时是什么情形？" });
    assert.equal(packet.details.length, 1);
    assert.equal(packet.details[0].memory.memoryId, earlier.memoryId);
    assert.equal(planner.plan({ ...options, legacyMemories: [earlier], excludedKeys: [earlier.memoryId], query: "第一次见到你时是什么情形？" }).details.length, 0);
  });
  const engine = new MemoryEngine({ store: base, trace: { record() {} } });
  const state = engine.createConversationState(options.conversationId);
  const retrieve = (extra = {}) => engine.retrieveForResponder({ characterId: 2, query: "1164年发生的议和事件呢？",
    directCounterpartIds: [1], querySpeakerId: 1, currentGameDate, currentTotalDays: options.currentTotalDays,
    campaignToken: scope.campaignToken, conversationId: options.conversationId, sceneRevision: "scene", turnEpoch: 1,
    memory4RecallEnabled: true, sessionRecallCache: state.responderRecallCache, tokenBudget: 2400,
    estimateTokens: options.estimateTokens, ...extra });
  check("selection and failed generation never commit seen or Focus", () => {
    const context = retrieve();
    assert(context.memory4Packet.items.length > 0);
    assert.equal(engine.commitDynamicSummaryRecall(2, state.responderRecallCache, 1, {
      providerSucceeded: false, injectedBlockIds: ["memory-temporal-extra"], injectedMemoryIds: [eventId], injectedTokens: context.memory4Packet.tokens
    }).committedCount, 0);
    assert.equal(state.responderRecallCache.get(2).seenDynamicSummaries.size, 0);
    assert.equal(state.responderRecallCache.get(2).memory4Focus, undefined);
  });
  const convo = Object.create(Conversation.prototype);
  convo.id = options.conversationId; convo.gameData = { campaignToken: scope.campaignToken }; convo.memoryState = state;
  convo.getPresenceWindows = id => id === 2 ? [{ joinedAtMessageId: 0 }] : [];
  convo.presenceInitialized = true;
  let history = [{ id: 1, role: "user", content: "旧事" }, { id: 2, role: "assistant", content: "回答" }];
  convo.getHistory = () => history; convo.getHistoryForCharacter = () => history; convo.canUseSharedRollingSummary = () => true;
  Conversation.configure({ memoryEngine: engine, TokenCounter: { estimateTokens: options.estimateTokens } });
  check("successful production retention commits responder-private history and dedup", () => {
    const context = retrieve();
    convo.retainDynamicSummaryRecall(2, 2, { blocks: [{ block: { id: "memory-temporal-extra" }, content: context.temporalExtraText }] }, 1);
    assert.equal(state.responderRecallCache.get(2).seenDynamicSummaries.size, context.extra.length);
    assert(state.responderRecallCache.get(2).memory4Focus);
    assert(convo.getPromptHistoryForCharacter(2).some(message => message.role === "system" && message.content.includes(eventId)));
    assert.equal(convo.getPromptHistoryForCharacter(3).some(message => message.role === "system"), false);
    assert.equal(retrieve({ turnEpoch: 2 }).extra.some(entry => entry.memory.memoryId === eventId), false);
  });
  check("FOLLOW_UP requires the confirmed entity/topic/event chain", () => {
    const focus = state.responderRecallCache.get(2).memory4Focus;
    const followId = add("1181.1.1", "议和后续：俘虏终于释放。", { topics: ["议和"] });
    mutateEntry(followId, entry => { entry.state.supportedByEntryIds = [eventId]; });
    add("1182.1.1", "同样谈到议和，却是另一个完全无关的事件。", { topics: ["议和"] });
    const packet = planner.plan({ ...options, query: "后来呢？", focus, excludedKeys: [...state.responderRecallCache.get(2).seenDynamicSummaries], turnEpoch: 2 });
    assert.deepEqual(packet.details.map(item => item.memory.memoryId), [followId]);
    for (const override of [{ ownerId: 3 }, { conversationId: "other" }, { sceneRevision: "other" }, { turnEpoch: 9 }, { entityIds: [3] }, { focus: null }]) {
      assert.equal(planner.plan({ ...options, query: "后来呢？", focus, turnEpoch: 2, ...override }).items.length, 0);
    }
  });
  check("history compaction releases only the removed responder keys", () => {
    history = [{ id: 3, role: "user", content: "新问题" }];
    convo.getPromptHistoryForCharacter(2);
    assert.equal(state.responderRecallCache.get(2).seenDynamicSummaries.size, 0);
    assert(retrieve({ turnEpoch: 3 }).extra.some(entry => entry.memory.memoryId === eventId));
  });
  check("history rejects source edits/deletes before prompt reuse", () => {
    history = [{ id: 1, role: "user", content: "旧事" }, { id: 2, role: "assistant", content: "回答" }];
    const context = retrieve({ turnEpoch: 4 });
    convo.retainDynamicSummaryRecall(2, 2, { blocks: [{ block: { id: "memory-temporal-extra" }, content: context.temporalExtraText }] }, 4);
    coordinator.store.deleteEntry(scope, eventId);
    assert.equal(convo.getPromptHistoryForCharacter(2).some(message => message.role === "system" && message.content.includes(eventId)), false);
  });
  check("provider-fit shares the same budget and never commits omitted entries", () => {
    const context = retrieve({ query: "你答应的议和呢？", turnEpoch: 5 });
    const fitted = engine.fitMemory4Context(context, 2, state.responderRecallCache, 5, options.estimateTokens);
    assert.equal(fitted.memory4Packet.tokens, 0); assert.equal(fitted.extra.length, 0);
    assert.equal(state.responderRecallCache.get(2).dynamicExtra.length, 0);
    assert.equal(engine.commitDynamicSummaryRecall(2, state.responderRecallCache, 5, { providerSucceeded: true,
      injectedBlockIds: ["memory-temporal-extra"], injectedMemoryIds: context.extra.map(item => item.memory.memoryId), injectedTokens: 5 }).committedCount, 0);
  });
  check("private history cannot survive a Campaign switch or time rewind", () => {
    const packet = planner.plan({ ...options, query: "1175年我们聊过什么？", entityIds: [3] });
    const changed = Object.create(convo);
    changed.memoryState = engine.createConversationState("changed");
    changed.memoryState.responderRecallCache.set(2, { seenDynamicSummaries: new Set(packet.items.map(item => item.memory.memory4Key)) });
    const retain = () => { changed.dynamicRecallHistory = new Map([[2, new Map([[2, {
      text: packet.text, keys: packet.items.map(item => item.memory.memory4Key), memory4Scope: scope, sourceRefs: packet.sourceRefs
    }]])]]); };
    retain(); changed.gameData = { campaignToken: "different", date: currentGameDate };
    assert.equal(changed.getPromptHistoryForCharacter(2).some(message => message.role === "system"), false);
    retain(); changed.gameData = { campaignToken: scope.campaignToken, date: "1100.1.1" };
    assert.equal(changed.getPromptHistoryForCharacter(2).some(message => message.role === "system"), false);
  });
  check("an unresolved name with no lexical evidence does not fill with player memories", () => {
    const packet = planner.plan({ ...options, query: "你还记得完全陌生的阿布鲁吗？" });
    assert.equal(packet.items.length, 0);
  });
  check("1000+ Details use metadata prefilter and at most 32 body reads", () => {
    const largeScope = { ...scope, ownerId: 4 };
    const id = add("1164.1.1", "特定旧年的议和记录。", largeScope);
    const index = coordinator.store.loadIndex(largeScope);
    const template = coordinator.store.readEntry(largeScope, id, index);
    for (let n = 0; n < 1100; n++) {
      const entry = { ...template, entryId: `m4_${hash(n)}`, conversationDate: "1183.1.1", topics: ["无关主题"] };
      index.entries[entry.entryId] = coordinator.store.indexRow(entry);
    }
    coordinator.store.reindex(index); index.revision++;
    const directory = coordinator.store.directory(largeScope);
    const metadata = coordinator.store.read(path.join(directory, "metadata.json"));
    base.writeJson(path.join(directory, "index.json"), index);
    base.writeJson(path.join(directory, "metadata.json"), { ...metadata, revision: index.revision, indexHash: hash(index) });
    const packet = planner.plan({ ...options, ...largeScope, query: "1164年我们聊过什么？" });
    assert.equal(packet.details[0].memory.memoryId, id);
    assert.equal(packet.diagnostics.bodyReads, 1);
    assert.equal(packet.diagnostics.candidateCount, 1);
    assert.equal(JSON.stringify(packet.diagnostics).includes("聊过什么"), false);
    base.writeJson(path.join(directory, "metadata.json"), { ...metadata, indexHash: "corrupt" });
    assert.throws(() => planner.plan({ ...options, ...largeScope, query: "1164年我们聊过什么？" }), /metadata_index_mismatch/);
  });
  check("first-time NPC without a summary folder is normal absence, not corruption", () => {
    assert.equal(planner.plan({ ...options, ownerId: 99, query: "你还记得我吗？" }).diagnostics.reason, "OWNER_FOLDER_MISSING");
  });
  check("Axis x Granularity matrix never exceeds the shared slots or escapes a year", () => {
    for (const axis of ["EVENT", "CONVERSATION", "MIXED", "MEMORY_RECALL"]) {
      for (const granularity of ["LIFE", "PERIOD", "YEAR", "EVENT", "EXACT_DATE", "FOLLOW_UP"]) {
        const window = granularity === "EXACT_DATE" ? { from: "1175.1.1", to: "1175.1.1" }
          : granularity === "LIFE" || granularity === "FOLLOW_UP" ? null : { from: "1175.1.1", to: "1175.12.31" };
        const packet = planner.plan({ ...options, entityIds: [3], query: "三号人物的历史", queryModel: {
          axis, granularity, entityIds: [3], topics: [], querySpeakerId: 1, window, temporalRequested: !!window
        } });
        assert(packet.details.length <= (granularity === "LIFE" ? 1 : 2)); assert(packet.items.length <= 3);
        assert(packet.tokens <= 1200);
        if (granularity === "EXACT_DATE") assert.equal(packet.overview, null);
        if (granularity === "FOLLOW_UP" || axis === "EVENT" && window) assert.equal(packet.items.length, 0);
        for (const item of packet.details) if (window) {
          assert(serialDate(item.reason.from) <= serialDate(window.to) && serialDate(item.reason.to) >= serialDate(window.from));
        }
      }
    }
  });
  function serialDate(date) { return normalizeGameDate(date).serial; }
  check("active conversion fails closed after source mutation and deletion", () => {
    const source = base.saveMemory({ memoryId: "active-legacy", content: "关于七十七号人物的确切约定。", knownBy: [2], subjects: [77], updatedBy: "user",
      provenance: { campaignToken: scope.campaignToken, folderOwnerId: 2, finalizationId: "active-legacy", extractionMode: "user_edited_summary" } });
    const context = { ...scope, conversationId: "active-legacy", finalizationId: "active-legacy", date: "1170.1.1", messages: [], legacyMemories: [source] };
    const projection = projectVisibleTranscript(context, 2);
    const id = coordinator.store.commitOwner({ ...context, ...projection, counterpartIds: [] }, { status: "STORE", entries: [{
      memoryType: "COMMITMENT", text: source.content, fragmentIds: [projection.fragments[0].fragmentId], entityIds: [77], topics: ["约定"]
    }] }).entryIds[0];
    const plan = () => planner.plan({ ...options, entityIds: [77], query: "你还记得七十七号人物吗？" });
    assert.equal(plan().details[0].memory.memoryId, id);
    base.updateMemory(source.memoryId, { content: "用户修订后的另一项内容。" });
    assert.equal(plan().details.some(item => item.memory.memoryId === id), false, "stale canonical conversion is excluded");
    assert.equal(plan().text.includes(source.content), false, "old source text is not resurrected");
    assert.equal(plan().details.length, 0, "no unrelated history replaces the invalidated conversion");
    base.deleteMemory(source.memoryId);
    assert.equal(plan().details.length, 0);
  });
  check("production C keeps frozen Recent2 stable across non-temporal recall queries", () => {
    base.writeJson(path.join(folders, "2_fixture", "pair.json"), [1, 2, 3].map(n => ({
      playerId: 1, characterId: 2, perspectiveOwnerId: 2, playerName: "玩家", characterName: "乙",
      date: `118${n}.1.1`, content: `第${n}次的独立旧往事。`, campaignToken: scope.campaignToken,
      campaignBinding: { status: "bound" }, finalizationId: `freeze-${n}`
    })));
    base.invalidateFolderSummaryCache([2]);
    const first = retrieve({ query: "你好", turnEpoch: 10 });
    const second = retrieve({ query: "你还记得第1次的旧往事吗？", turnEpoch: 11 });
    assert.equal(first.directStableText, second.directStableText);
    assert.equal(first.stableText, second.stableText);
    assert(first.direct.every(item => second.direct.some(other => other.memory.memoryId === item.memory.memoryId)));
  });
  check("current relationship Profile is live and unrelated future knowledge is excluded", () => {
    const gameData = { campaignToken: scope.campaignToken, date: currentGameDate,
      characters: new Map([[2, { id: 2, relationsToCharacters: [{ id: 3, relations: ["friend"] }] }], [3, { id: 3 }]]) };
    const packet = planner.plan({ ...options, gameData, entityIds: [3], query: "三号人物现在还是朋友吗？" });
    assert(packet.profileText.includes("friend"));
    gameData.characters.get(2).relationsToCharacters = [];
    assert(planner.plan({ ...options, gameData, entityIds: [3], query: "三号人物现在还是朋友吗？" }).profileText.includes("当前关系 未知"));
    add("1190.1.1", "未来才能获知的三号人物秘密。", { entityIds: [3] });
    assert.equal(planner.plan({ ...options, entityIds: [3], query: "你还记得三号人物吗？" }).text.includes("未来才能"), false);
  });
  check("C diagnostics retain counts/revisions but no query or body text", () => {
    const trace = new MemoryTrace({ logger: { log() {} } });
    const packet = planner.plan({ ...options, query: "1175年我们聊过什么？" });
    const safe = trace.record("memory4_recall", { ...packet.diagnostics, query: "PRIVATE_QUERY", content: "PRIVATE_BODY" });
    assert.equal(safe.memory4Recall.indexRevision, packet.diagnostics.indexRevision);
    assert.equal(safe.memory4Recall.bodyReads, packet.diagnostics.bodyReads);
    assert.equal(JSON.stringify(safe).includes("PRIVATE_"), false);
    const disabled = planner.plan({ ...options, temporalRecallEnabled: false, query: "1175年我们聊过什么？" });
    assert.equal(disabled.items.length, 0);
  });
  const lateContext = retrieve({ query: "1175年我们聊过什么？", queryEntityIds: [3], turnEpoch: 12 });
  assert(lateContext.memory4Packet.items.length > 0);
  const fakeBuild = (history, npc, gameData, summary, context) => [{ role: "system", content: "base" },
    ...(context.temporalExtraText ? [{ role: "system", content: context.temporalExtraText }] : [])];
  Conversation.configure({ llmManager: { getProviderCapabilities: async () => ({ contextWindow: 8192, maxOutputTokens: 1000 }) },
    settingsRepository: { getActiveProviderConfig: () => ({ defaultParameters: { max_tokens: 1000 } }) },
    PromptBuilder: { buildMessages: fakeBuild, buildMessagesWithTokenCount: (...args) => ({ messages: fakeBuild(...args) }) } });
  convo.getMemoryContextFor = async () => lateContext;
  convo.getPromptHistoryForCharacter = () => [];
  convo.getPromptSummaryForCharacter = () => "";
  convo.isV813PrefixEnabled = () => false;
  convo.estimateTokenCount = messages => 5500 + messages.filter(message => message.content !== "base")
    .reduce((total, message) => total + options.estimateTokens(message.content), 0);
  convo.createRollingSummary = async () => ({ committed: false });
  const fitted = await convo.checkAndSummarizeIfNeeded({ id: 2 });
  assert.equal(fitted.memory4Packet.items.length, 0);
  assert(fitted.memory4Packet.tokens < lateContext.memory4Packet.tokens);
  assert.equal(convo.contextBudgetDiagnostics.safe, true);
  checks++; console.log("PASS production late Provider headroom fits the final complete Prompt");
  console.log(`V8.14-C Recall Planner: PASS (${checks} groups)`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
