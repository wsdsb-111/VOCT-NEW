"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v815-legacy-recall-"));
const campaignToken = "campaign-v815-legacy-recall";
const ownerId = 2;
const currentGameDate = "1200.1.1";
const currentTotalDays = 438000;
const names = new Map([[1, "玩家"], [2, "张道素"], [3, "赵光义"], [4, "张三"], [5, "张三丰"], [44, "李道远"], [45, "赵太初"], [77, "陌生人"]]);
let checks = 0;

function check(name, operation) {
  operation();
  checks++;
  console.log(`PASS ${name}`);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function snapshotTree(directory) {
  const result = {};
  const visit = current => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("unexpected_test_symlink");
      if (entry.isDirectory()) visit(file);
      else result[path.relative(directory, file)] = fs.readFileSync(file).toString("base64");
    }
  };
  visit(directory);
  return result;
}

function summaryRow(id, content, { counterpartId = 1, owner = ownerId, subjects = [counterpartId], campaign = campaignToken,
  date = "1190.1.1", totalDays = 434350, perspectiveMemoryIds = [], conversationId = `conversation-${id}`,
  finalizationId = `finalization-${id}`, segmentId = `segment-${id}`, includeLineage = true,
  perspectiveOwnerId = owner } = {}) {
  const participantIds = [...new Set([owner, counterpartId, ...subjects])];
  const row = {
    playerId: owner,
    characterId: counterpartId,
    perspectiveOwnerId,
    playerName: names.get(owner) || `人物${owner}`,
    characterName: names.get(counterpartId) || `人物${counterpartId}`,
    content,
    date,
    totalDays,
    campaignToken: campaign,
    campaignBinding: { status: "bound" },
    participants: participantIds.map(id => ({ id, name: names.get(id) || `人物${id}`,
      shortName: names.get(id) || `人物${id}`, fullName: names.get(id) || `人物${id}` }))
  };
  if (includeLineage) Object.assign(row, { conversationId, finalizationId,
    perspectiveSummarySegmentIds: [segmentId], perspectiveMemoryIds });
  return row;
}

function createHarness(rows) {
  const directory = path.join(root, `fixture-${checks}-${Math.random().toString(16).slice(2)}`);
  const summariesDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summariesDir, `${ownerId}_fixture`);
  const byCounterpart = new Map();
  for (const row of rows) {
    const counterpartId = Number(row.characterId) === Number(row.perspectiveOwnerId)
      ? Number(row.playerId) : Number(row.characterId);
    const key = `${counterpartId}|${names.get(counterpartId) || `人物${counterpartId}`}`;
    if (!byCounterpart.has(key)) byCounterpart.set(key, []);
    byCounterpart.get(key).push(row);
  }
  for (const [key, records] of byCounterpart) {
    const [, counterpartName] = key.split("|");
    writeJson(path.join(ownerFolder, `与${counterpartName}的对话.json`), records);
  }
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const profile = (id, name = names.get(id) || `人物${id}`) => ({ id, firstName: name, shortName: name, fullName: name });
  const profiles = [...names.keys()].map(id => profile(id));
  const gameData = { characters: new Map(profiles.map(item => [item.id, item])), getMentionableCharacterProfiles: () => profiles };
  const recall = ({ query, explicitTargetEntityIds = [], entityProfiles = profiles, directCounterpartIds = [1],
    activeParticipantIds = [ownerId, 1], querySpeakerId = 1, identityUnresolved = false,
    memoryEngine3Enabled = false, tokenBudget = 1200, currentDate = currentGameDate, totalDays = currentTotalDays } = {}) => engine.retrieveForResponder({
    characterId: ownerId,
    query,
    directCounterpartIds,
    activeParticipantIds,
    querySpeakerId,
    mentionedEntityIds: [],
    mentionedEntityNames: {},
    entityProfiles,
    mentionedRecallCache: new Map(),
    sessionRecallCache: new Map(),
    ownerFolderMemories: engine.store.loadFolderSummariesForCharacter(ownerId),
    currentGameDate: currentDate,
    currentTotalDays: totalDays,
    campaignToken,
    conversationId: "legacy-recall-test",
    sceneRevision: "scene",
    memoryEngine3Enabled,
    gameData,
    identityUnresolved,
    explicitTargetEntityIds,
    tokenBudget,
    estimateTokens: text => Math.ceil(String(text || "").length / 2)
  });
  return { directory, summariesDir, ownerFolder, engine, recall };
}

function selectedIds(result) {
  return [...new Set((result.relevant || []).map(entry => entry.memory?.memoryId).filter(Boolean))];
}

function routedLegacyText(result) {
  return [result.directStableText, result.entityTargetText, result.temporalExtraText,
    ...(result.extra || []).map(entry => entry.memory?.content)]
    .filter(Boolean).join("\n");
}

try {
  check("Legacy summary Forget writes the scoped MemoryStore ledger and hides the source", () => {
    const sourceId = "legacy-forget-source";
    const row = summaryRow("forget-target", "旧事正文：曾约定归还玉印。", { perspectiveMemoryIds: [sourceId] });
    const fixture = createHarness([row]);
    const source = fixture.engine.store.saveMemory({ memoryId: sourceId, type: "information", subtype: "user_edited_summary",
      content: row.content, eventDate: row.date, totalDays: row.totalDays, participants: [ownerId, 1], subjects: [1],
      knownBy: [ownerId], visibility: "known_group", provenance: { campaignToken, folderOwnerId: ownerId,
        counterpartId: 1, finalizationId: row.finalizationId, extractionMode: "user_edited_summary" } });
    fixture.engine.store.markKnownBy(ownerId, source.memoryId, { awareness: "imported", acquiredAt: source.totalDays });
    const before = fixture.engine.store.loadFolderSummariesForCharacter(ownerId);
    assert.equal(before.length, 1);
    const forgotten = fixture.engine.store.withSummaryMutation(null, () => fixture.engine.forgetSummaryProjection(row,
      { ownerId, counterpartId: 1 }));
    assert.equal(forgotten.status, "FORGOTTEN");
    assert.equal(fixture.engine.store.isSummaryProjectionForgotten(row, { ownerId, counterpartId: 1 }), true);
    const [lineage] = fixture.engine.store.listForgottenSummaryProjections();
    assert.equal(lineage.campaignToken, campaignToken);
    assert.equal(lineage.ownerId, ownerId);
    assert.equal(lineage.counterpartId, 1);
    assert.deepEqual(lineage.legacyMemoryIds.slice().sort(), [sourceId, ...before.map(memory => memory.memoryId)].sort());
    assert.equal(fixture.engine.store.getMemory(sourceId), null);
    assert.equal(fixture.engine.store.loadFolderSummariesForCharacter(ownerId).length, 0,
      "the old visible summary must stay hidden even if its folder copy remains");
  });

  check("failed Legacy mapping validation rolls back the Forget ledger", () => {
    const row = summaryRow("forget-mismatch", "错误配对来源不能被遗忘。", { perspectiveMemoryIds: ["wrong-pair-source"] });
    const fixture = createHarness([row]);
    const source = fixture.engine.store.saveMemory({ memoryId: "wrong-pair-source", type: "information",
      content: row.content, eventDate: row.date, participants: [ownerId, 3], subjects: [3], knownBy: [ownerId],
      visibility: "known_group", provenance: { campaignToken, folderOwnerId: ownerId, counterpartId: 3,
        finalizationId: row.finalizationId, extractionMode: "user_edited_summary" } });
    fixture.engine.store.markKnownBy(ownerId, source.memoryId, { awareness: "imported" });
    const before = snapshotTree(fixture.directory);
    assert.throws(() => fixture.engine.store.withSummaryMutation(null, () => fixture.engine.forgetSummaryProjection(row,
      { ownerId, counterpartId: 1 })), /LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE/);
    assert.deepEqual(snapshotTree(fixture.directory), before, "an invalid owner/counterpart mapping cannot partially persist Forget");
    assert.equal(fixture.engine.store.listForgottenSummaryProjections().length, 0);
  });

  check("direct and unknown-header Legacy summaries remain recallable", () => {
    const journey = summaryRow("journey", "【张道素能够知道并记住的本场经过】\n我们曾在北境议和，并约定归还玉印。");
    const unknownHeader = summaryRow("unknown-header", "【张道素的宫廷旧闻】\n曾在北境议和，并约定归还玉印。", {
      counterpartId: 3, subjects: [3] });
    const fixture = createHarness([journey, unknownHeader]);
    const direct = fixture.recall({ query: "你还记得北境议和吗？" });
    const target = fixture.recall({ query: "赵光义北境议和那件事呢？", explicitTargetEntityIds: [3] });
    assert(direct.direct.some(entry => entry.memory.content === journey.content));
    assert(routedLegacyText(target).includes(unknownHeader.content));
    assert(target.entityTargetRecall.selectedIds.length > 0);
  });

  check("explicit Legacy target routing requires the matching subject or name", () => {
    const byId = summaryRow("target-id", "李道远曾答应归还一枚玉印。", { subjects: [44] });
    const byAlias = summaryRow("target-alias", "李道远曾在北境议和时交出玉印。", { counterpartId: 3, subjects: [3] });
    const unrelated = summaryRow("target-unrelated", "边境议和时，双方交换了使者。", { counterpartId: 45, subjects: [45] });
    for (const summary of [byId, byAlias]) {
      const fixture = createHarness([summary, unrelated]);
      const result = fixture.recall({ query: "李道远曾谈过的葡萄产地是什么？", explicitTargetEntityIds: [44] });
      assert.equal(result.entityTargetRecall.candidateCount, 1,
        "only the row matched by the explicit subject ID or its unique name is a target candidate");
      assert(routedLegacyText(result).includes(summary.content),
        "the selected target reaches a final frozen, target, or Extra prompt lane");
      assert.equal(result.entityTargetRecall.selectedIds.length, 1);
      const routedEntries = result.relevant || [];
      const entry = routedEntries.find(candidate => candidate.memory.content === summary.content);
      assert(entry, "the selected target summary appears in a final retrieval lane");
      assert((entry.explicitTargetEntityIds || []).includes(44)
        || (entry.routeCharacterIds || []).includes(44)
        || (entry.routeKinds || []).includes("entity_target"),
      "the summary retains its explicit target route after lane deduplication");
      assert.equal(routedEntries.some(candidate => candidate.memory.content === unrelated.content), false,
        "an unrelated out-of-scene row is not selected by the explicit target route");
    }
  });

  check("ambiguous short names do not select a longer identity", () => {
    const shortProfile = { id: 4, firstName: "张三", shortName: "张三", fullName: "张三" };
    const longProfile = { id: 5, firstName: "张三丰", shortName: "张三丰", fullName: "张三丰" };
    const longerIdentity = summaryRow("long-alias", "张三丰曾与赵太初谈论北境防务。",
      { counterpartId: 5, subjects: [5] });
    const exactShort = summaryRow("exact-short", "张三曾与赵太初谈论北境防务。", { subjects: [4] });
    const fixture = createHarness([longerIdentity, exactShort]);
    const ambiguous = fixture.recall({ query: "张三谈过的北境防务吗？", explicitTargetEntityIds: [4],
      entityProfiles: [shortProfile, longProfile] });
    const bothPeople = summaryRow("both-identities", "张三曾与张三丰谈论北境防务。", { subjects: [4, 5] });
    const secondFixture = createHarness([bothPeople]);
    const exact = secondFixture.recall({ query: "张三谈过的北境防务吗？", explicitTargetEntityIds: [4],
      entityProfiles: [shortProfile, longProfile] });
    assert.equal(routedLegacyText(ambiguous).includes(longerIdentity.content), false);
    assert(routedLegacyText(ambiguous).includes(exactShort.content));
    assert(routedLegacyText(exact).includes(bothPeople.content));
  });

  check("unresolved named-person requests do not add target or dynamic history", () => {
    const recentDirect = summaryRow("unresolved-recent-direct", "最近一次宴会上只互致了问候。",
      { date: "1199.1.1", totalDays: 437634 });
    const queryMatchingOlderDirect = summaryRow("unresolved-old-direct", "较早时曾谈到完全陌生的阿布鲁。",
      { date: "1190.1.1", totalDays: 434350 });
    const fixture = createHarness([queryMatchingOlderDirect, recentDirect]);
    const result = fixture.recall({ query: "你还记得完全陌生的阿布鲁吗？", identityUnresolved: true,
      explicitTargetEntityIds: [], memoryEngine3Enabled: true });
    assert.deepEqual(result.direct.map(entry => entry.memory.provenance.finalizationId),
      [recentDirect.finalizationId, queryMatchingOlderDirect.finalizationId],
    "unresolved identity preserves the ordinary recent direct order rather than query-ranking older history");
    assert(result.direct.every(entry => entry.routeKind === "direct"
      && !(entry.routeKinds || []).includes("entity_target")
      && !(entry.explicitTargetEntityIds || []).length),
    "ordinary frozen direct context may remain, but cannot be attributed to the unresolved name");
    assert.equal(result.extra.length, 0, "an unresolved name cannot select dynamic Extra history");
    assert.equal(result.topicPatch.length, 0, "an unresolved name cannot add a topic patch from unrelated history");
    assert.equal(result.entityTargetRecall.selectedIds.length, 0);
    assert.match(result.temporalExtraText, /未能唯一识别所问人物/);
  });

  check("active participants are not implicit out-of-scene targets", () => {
    const activeOnly = summaryRow("active-only", "李道远参与了边境议和。", { counterpartId: 44, subjects: [44] });
    const fixture = createHarness([activeOnly]);
    const result = fixture.recall({ query: "你还记得天文仪器吗？", directCounterpartIds: [1],
      activeParticipantIds: [ownerId, 1, 44], explicitTargetEntityIds: [] });
    assert.deepEqual(result.routing.explicitTargetEntityIds, []);
    assert.equal(selectedIds(result).length, 0);
    assert.equal(result.entityTargetRecall.selectedIds.length, 0);
  });

  check("oversized Legacy recall keeps the relevant excerpt within its token budget", () => {
    const filler = "无关的往年宴饮与宫廷礼节记载，未涉及边境事务。".repeat(160);
    const keyFact = "此后李道远在北境防务中交出玉印，议和使者据此开启城门。";
    const summary = summaryRow("oversized", `${filler}\n${keyFact}\n${filler}`);
    const fixture = createHarness([summary]);
    const result = fixture.recall({ query: "你还记得玉印吗？", tokenBudget: 1200 });
    const selected = result.direct.find(entry => entry.memory.content.includes(keyFact));
    assert(selected, "direct Legacy recall keeps a relevant sentence from the source");
    assert(selected.memory.content.length < summary.content.length);
    assert(result.selectedTokens <= 1200);
  });

  check("Legacy retrieval keeps campaign, numeric owner, and future-date gates", () => {
    const valid = summaryRow("valid", "1170年我们讨论了边境议和吗？");
    const wrongCampaign = summaryRow("wrong-campaign", valid.content, { campaign: "another-campaign" });
    const wrongOwner = summaryRow("wrong-owner", valid.content, { perspectiveOwnerId: 3 });
    const future = summaryRow("future", valid.content, { date: "1201.1.1", totalDays: 438365 });
    const fixture = createHarness([valid, wrongCampaign, wrongOwner, future]);
    const result = fixture.recall({ query: "你还记得边境议和吗？" });
    const selected = result.direct.map(entry => entry.memory);
    const validMemory = selected.find(memory => memory.provenance.finalizationId === valid.finalizationId);
    assert(validMemory, "the valid summary is selected by its unique Legacy lineage");
    assert.equal(validMemory.provenance.campaignToken, campaignToken);
    assert.equal(validMemory.provenance.folderOwnerId, ownerId);
    assert.equal(validMemory.eventDate, valid.date);
    for (const rejected of [wrongCampaign, wrongOwner, future]) {
      assert.equal(selected.some(memory => memory.provenance.finalizationId === rejected.finalizationId), false,
        "rejected Legacy summary is absent by unique finalization ID: " + rejected.finalizationId);
    }
  });

  console.log(`PASS ${checks} V8.15 Legacy recall checks`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
