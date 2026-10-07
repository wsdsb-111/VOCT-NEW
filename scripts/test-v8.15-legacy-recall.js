"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Memory4RecallPlanner, fitRecallPacket } = require("../resources/app/out/main/memory-system/memory4-recall-planner");
const { createMemoryRecord } = require("../resources/app/out/main/memory-system/memory-types");
const { hash, legacySourceHash } = require("../resources/app/out/main/memory-system/memory4-contract");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v815-legacy-"));
let checks = 0;
function check(name, test) {
  test();
  checks++;
  console.log(`PASS ${name}`);
}

try {
  const folders = path.join(root, "summaries");
  fs.mkdirSync(path.join(folders, "2_fixture"), { recursive: true });
  const sourceRecords = new Map();
  const entryRecords = new Map();
  const forgottenLegacyIds = new Set();
  let activeIndex = { entries: {}, byTopic: {}, finalizations: {} };
  const base = { summaryFoldersDir: folders, index: { memories: {} }, getMemory: id => sourceRecords.get(id) || null,
    loadFolderSummariesForCharacter: () => [] };
  const coordinator = { baseStore: base, store: { loadIndex: () => activeIndex,
    directory: () => root, read: (_file, fallback = null) => fallback,
    readEntry: (_scope, id) => entryRecords.get(id),
    isProjectionLineageForgotten: (_scope, lineage) => lineage.legacyMemoryIds.some(id => forgottenLegacyIds.has(id)) },
    derived: { selectSlice: () => null }, getKnownEntityProfile: () => ({ recognition: { level: "KNOWN" },
      relationship: { status: "UNKNOWN", types: [] } }) };
  const planner = new Memory4RecallPlanner(coordinator);
  const scope = { campaignToken: "campaign-v815", ownerId: 2 };
  const currentGameDate = "1200.1.1";
  const options = { ...scope, currentGameDate, currentTotalDays: 0, conversationId: "legacy-recall-test",
    sceneRevision: "scene", turnEpoch: 1, querySpeakerId: 1, entityIds: [], legacyMemories: [],
    memoryEngineRemainingBudget: 1200, providerRemainingSafeBudget: 1200,
    estimateTokens: text => Math.ceil(String(text || "").length / 2) };
  const source = (id, content) => {
    const memory = { memoryId: id, content, deleted: false, knownBy: [2], subjects: [1],
      provenance: { ...scope, folderOwnerId: 2, finalizationId: "legacy-source", extractionMode: "user_edited_summary" } };
    sourceRecords.set(id, memory);
    return memory;
  };
  const legacy = (id, content, extra = {}) => {
    const { subjects = [1], topics = [], ...provenanceExtra } = extra;
    return createMemoryRecord({ memoryId: id, type: "folder_summary", subtype: "conversation_summary", content,
      eventDate: "1190.1.1", knownBy: [2], subjects, tags: topics,
      provenance: { ...scope, folderOwnerId: 2, counterpartId: 1, counterpartIds: [1],
        campaignBinding: { status: "bound" }, ...provenanceExtra } });
  };
  const setCanonicalRows = rows => {
    entryRecords.clear();
    const entries = {}, finalizations = {}, byTopic = {};
    for (const row of rows) {
      const finalizationId = `selection-${row.entryId}`;
      const sourceRevision = `revision-${row.entryId}`;
      const entry = { entryId: row.entryId, campaignToken: scope.campaignToken, ownerId: scope.ownerId,
        conversationDate: "1190.1.1", acquiredDate: "1190.1.1", text: row.text, topics: row.topics,
        entityIds: row.entityIds, counterpartIds: [1], importance: 0.5, eventTime: { status: "unknown" },
        evidence: { knownBy: [2], visibility: "participants", sourceType: "spoken", epistemicStatus: "reported" },
        state: { status: "active" }, source: { finalizationId, conversationId: finalizationId, sourceRevision, legacyRefs: [] } };
      entryRecords.set(row.entryId, entry);
      entries[row.entryId] = { entityIds: row.entityIds, topics: row.topics, counterpartIds: [1], knownBy: [2],
        visibility: "participants", deleted: false, memoryType: "DURABLE_KNOWLEDGE", status: "active",
        finalizationId, conversationId: finalizationId, conversationDate: "1190.1.1", acquiredDate: "1190.1.1",
        stateChangedGameDate: null, legacyRefs: [], bodyHash: `body-${row.entryId}`, importance: 0.5 };
      finalizations[hash(finalizationId)] = { sourceRevision };
      for (const topic of row.topics) (byTopic[topic] ||= []).push(row.entryId);
    }
    activeIndex = { revision: 1, entries, byTopic, finalizations };
  };

  const alpha = source("source-alpha", "甲曾参与边境议和。");
  const beta = source("source-beta", "乙曾答应归还玉印。");
  const partialSummary = legacy("partial-summary", `【乙能够知道并记住的本场内容】\n- ${alpha.content}\n- ${beta.content}\n这段叙事还补充了使者往返的经过。`,
    { perspectiveMemoryIds: [alpha.memoryId, beta.memoryId] });
  const partialIndex = { entries: { partial: { legacyRefs: [{ memoryId: alpha.memoryId,
    sourceHash: legacySourceHash(alpha), complete: false }] } } };
  check("partial tracked coverage keeps all Legacy narrative", () => {
    const candidates = planner.legacyCandidates([partialSummary], scope, partialIndex);
    assert.deepEqual(candidates.map(memory => memory.content), [partialSummary.content]);
  });

  check("stale complete hashes and unknown mappings do not erase a Legacy parent", () => {
    sourceRecords.set(alpha.memoryId, { ...alpha, content: "用户修订后的边境记录。" });
    const staleIndex = { entries: { stale: { legacyRefs: [{ memoryId: alpha.memoryId,
      sourceHash: legacySourceHash(alpha), complete: true }] } } };
    assert.deepEqual(planner.legacyCandidates([partialSummary], scope, staleIndex).map(memory => memory.content), [partialSummary.content]);
    const unknownHeader = legacy("stale-unknown-header", "【乙的宫廷旧闻】\n旧时曾议和并约定归还玉印。",
      { perspectiveMemoryIds: [alpha.memoryId] });
    assert.deepEqual(planner.legacyCandidates([unknownHeader], scope, staleIndex).map(memory => memory.content), [unknownHeader.content]);
    sourceRecords.set(alpha.memoryId, alpha);
  });

  check("durable projection tombstone suppresses the forgotten Legacy parent", () => {
    const forgottenParent = legacy("forgotten-parent", "旧事正文。", { perspectiveMemoryIds: [alpha.memoryId] });
    forgottenLegacyIds.add(alpha.memoryId);
    assert.deepEqual(planner.legacyCandidates([forgottenParent], scope, { entries: {} }), []);
    forgottenLegacyIds.clear();
  });

  check("known and unknown Legacy headers remain recallable", () => {
    const journey = legacy("journey-summary", "【乙能够知道并记住的本场经过】\n我们曾在北境议和，并约定归还玉印。",
      { perspectiveMemoryIds: ["unknown-source"] });
    const unknownHeader = legacy("unknown-header", "【乙的宫廷旧闻】\n曾在北境议和，并约定归还玉印。",
      { perspectiveMemoryIds: ["unknown-source"] });
    const emptyIndex = { entries: {} };
    assert.equal(planner.legacyCandidates([journey], scope, emptyIndex)[0].content, journey.content);
    assert.equal(planner.legacyCandidates([unknownHeader], scope, emptyIndex)[0].content, unknownHeader.content);
    for (const memory of [journey, unknownHeader]) {
      const packet = planner.plan({ ...options, legacyMemories: [memory], query: "你还记得北境议和吗？" });
      assert(packet.items.some(item => item.memory.memoryId === memory.memoryId));
    }
  });

  check("complete coverage suppresses only the matching source", () => {
    const exactSummary = legacy("exact-summary", `【乙能够知道并记住的本场经过】\n- ${alpha.content}\n- ${beta.content}`,
      { perspectiveMemoryIds: [alpha.memoryId, beta.memoryId] });
    const completeIndex = { entries: { complete: { legacyRefs: [{ memoryId: alpha.memoryId,
      sourceHash: legacySourceHash(alpha), complete: true }] } } };
    assert.deepEqual(planner.legacyCandidates([exactSummary], scope, completeIndex).map(memory => memory.content), [beta.content]);
  });

  check("entity or topic qualification survives low lexical overlap", () => {
    const targetProfile = { id: 44, firstName: "李道远", shortName: "李道远", fullName: "李道远" };
    const byEntity = legacy("entity-legacy", "李道远曾答应归还一枚玉印。", { subjects: [44] });
    const entityPacket = planner.plan({ ...options, entityIds: [44], explicitTargetEntityIds: [44],
      entityNamesById: { 44: ["李道远"] }, entityNames: ["李道远"], entityProfiles: [targetProfile],
      gameData: { characters: new Map([[44, targetProfile]]) }, legacyMemories: [byEntity],
      query: "李道远曾谈过的葡萄产地是什么？" });
    assert(entityPacket.items.some(item => item.memory.memoryId === byEntity.memoryId));
    assert.deepEqual(entityPacket.diagnostics.explicitTargetEntityIds, [44]);
    assert.deepEqual(entityPacket.diagnostics.entityTargetSelectedIds, [byEntity.memoryId]);
    assert.equal(entityPacket.diagnostics.entityTargetCandidateCount, 1);
    assert.equal(entityPacket.items.find(item => item.memory.memoryId === byEntity.memoryId).routeKind, "entity_target");
    assert.match(entityPacket.text, /明确询问人物的历史记忆/);

    const aliasOnly = legacy("alias-only", "李道远曾在北境议和时交出玉印。");
    const aliasPacket = planner.plan({ ...options, entityIds: [44], explicitTargetEntityIds: [44],
      entityNamesById: { 44: ["李道远"] }, entityNames: ["李道远"], entityProfiles: [targetProfile],
      gameData: { characters: new Map([[44, targetProfile]]) }, legacyMemories: [aliasOnly],
      query: "李道远曾谈过的葡萄产地是什么？" });
    assert(aliasPacket.items.some(item => item.memory.memoryId === aliasOnly.memoryId));
    assert.equal(aliasPacket.diagnostics.entityTargetCandidateCount, 1);
    assert.deepEqual(aliasPacket.diagnostics.entityTargetSelectedIds, [aliasOnly.memoryId]);

    const byTopic = legacy("topic-legacy", "边境议和时，双方交换了使者。", { topics: ["边境"] });
    const topicPacket = planner.plan({ ...options, entityIds: [44], explicitTargetEntityIds: [44], topics: ["边境"], legacyMemories: [byTopic],
      query: "你还记得葡萄酒的来历吗？" });
    assert(topicPacket.items.some(item => item.memory.memoryId === byTopic.memoryId));

    const duplicateProfile = { ...targetProfile, id: 45 };
    const ambiguousPacket = planner.plan({ ...options, entityIds: [44], explicitTargetEntityIds: [44], topics: ["边境"],
      entityNamesById: { 44: ["李道远"] }, entityNames: ["李道远"], entityProfiles: [targetProfile, duplicateProfile],
      gameData: { characters: new Map([[44, targetProfile], [45, duplicateProfile]]) }, legacyMemories: [byTopic],
      query: "李道远曾谈过的葡萄产地是什么？" });
    assert.equal(ambiguousPacket.items.length, 0);

    const canonicalEntry = { entryId: "canonical-topic", campaignToken: scope.campaignToken, ownerId: scope.ownerId,
      conversationDate: "1190.1.1", acquiredDate: "1190.1.1", text: "边境议和时交换了使者。", topics: ["边境"],
      entityIds: [99], counterpartIds: [1], importance: 0.5, eventTime: { status: "unknown" },
      evidence: { knownBy: [2], visibility: "participants", sourceType: "spoken", epistemicStatus: "reported" },
      state: { status: "active" }, source: { finalizationId: "canonical-topic-final", conversationId: "canonical-topic-conversation",
        sourceRevision: "revision-1", legacyRefs: [] } };
    entryRecords.set(canonicalEntry.entryId, canonicalEntry);
    activeIndex = { revision: 1, byTopic: {}, entries: { [canonicalEntry.entryId]: {
      entityIds: [99], topics: ["边境"], counterpartIds: [1], knownBy: [2], visibility: "participants", deleted: false,
      memoryType: "DURABLE_KNOWLEDGE", status: "active", finalizationId: "canonical-topic-final",
      conversationId: "canonical-topic-conversation", conversationDate: "1190.1.1", acquiredDate: "1190.1.1",
      stateChangedGameDate: null, legacyRefs: [], bodyHash: "body-hash", importance: 0.5
    } }, finalizations: { [hash("canonical-topic-final")]: { sourceRevision: "revision-1" } } };
    const canonicalTopicPacket = planner.plan({ ...options, entityIds: [44], explicitTargetEntityIds: [44], topics: ["边境"],
      query: "你还记得葡萄酒的来历吗？" });
    assert(canonicalTopicPacket.items.some(item => item.memory.memoryId === canonicalEntry.entryId));
    activeIndex = { entries: {}, byTopic: {}, finalizations: {} };
    entryRecords.clear();
  });

  check("explicit Legacy target replaces only unrelated Canonical details", () => {
    const query = "赵光义北境那件事后来怎么样？";
    const queryModel = { axis: "EVENT", granularity: "EVENT", entityIds: [44], querySpeakerId: 1,
      window: null, blockedReason: null, firstMeeting: false, temporalRequested: false, expression: null,
      topics: ["北境"], text: query };
    const canonical = [
      { entryId: "selection-unrelated-D", entityIds: [45], topics: ["北境"], text: "北境曾出现另一场争议。" },
      { entryId: "selection-unrelated-E", entityIds: [46], topics: ["北境"], text: "北境议和中有使者往返。" }
    ];
    const targetProfile = { id: 44, firstName: "李道远", shortName: "李道远", fullName: "李道远" };
    const selectionSource = source("selection-explicit-C-source", "李道远在北境争议中留下 EXPLICIT_C_SPLIT_LEGACY_SENTINEL。");
    const explicitLegacyParent = legacy("selection-explicit-C-parent",
      `【李道远能够知道并记住的本场内容】\n- ${selectionSource.content}`,
      { subjects: [44], perspectiveMemoryIds: [selectionSource.memoryId] });
    const explicitLegacy = planner.legacyCandidates([explicitLegacyParent], scope, { entries: {} })[0];
    const plan = (rows, explicitTargetEntityIds) => {
      setCanonicalRows(rows);
      return planner.plan({ ...options, query, queryModel, entityIds: [44], explicitTargetEntityIds,
        topics: ["北境"], entityNames: ["李道远"], entityNamesById: { 44: ["李道远"] },
        entityProfiles: [targetProfile], gameData: { characters: new Map([[44, targetProfile]]) },
        legacyMemories: [explicitLegacy] });
    };

    const packet = plan(canonical, [44]);
    assert(packet.details.some(item => item.memory.memoryId === explicitLegacy.memoryId),
      `an explicit target split Legacy detail must enter the final packet: ${JSON.stringify({
        expectedId: explicitLegacy?.memoryId, legacyCandidates: packet.diagnostics.legacyCandidateCount,
        selectedIds: packet.items.map(item => item.memory.memoryId), explicitTargets: packet.diagnostics.explicitTargetEntityIds,
        candidateCount: packet.diagnostics.entityTargetCandidateCount, rejected: packet.diagnostics.legacyRejected })}`);
    assert(packet.details.length <= 2);
    assert(packet.details.filter(item => item.sourceRef.kind === "detail" && !item.routeCharacterIds?.includes(44)).length <= 1,
      "the explicit target can replace at most one of the two unrelated Canonical details");
    assert(packet.tokens <= 1200);

    const targetCanonical = [
      { entryId: "selection-target-C1", entityIds: [44], topics: ["北境"], text: "李道远记得北境旧约一。" },
      { entryId: "selection-target-C2", entityIds: [44], topics: ["北境"], text: "李道远记得北境旧约二。" }
    ];
    const protectedPacket = plan(targetCanonical, [44]);
    assert.deepEqual(protectedPacket.details.map(item => item.memory.memoryId), ["selection-target-C1", "selection-target-C2"],
      "an explicit Legacy candidate must not evict either of two explicit Canonical details");

    const highSource = source("selection-high-explicit-source", "李道远在北境守门约定中交出玉印，守将依约开启城门。HIGH_EXPLICIT_RANK_SENTINEL");
    const lowSource = source("selection-low-explicit-source", "李道远早年曾在北境宴饮，席间有乐舞。LOW_EXPLICIT_RANK_SENTINEL");
    const splitParent = (id, memory) => legacy(id, `【李道远能够知道并记住的本场内容】\n- ${memory.content}`,
      { subjects: [44], perspectiveMemoryIds: [memory.memoryId] });
    const rankedLegacy = planner.legacyCandidates([
      splitParent("selection-high-explicit-parent", highSource), splitParent("selection-low-explicit-parent", lowSource)
    ], scope, { entries: {} });
    const rankingQuery = "李道远北境守门约定玉印后来如何？";
    const rankedTargets = planner.ranker.rank(rankedLegacy, { query: rankingQuery, entityIds: [44] });
    assert.match(rankedTargets[0].memory.content, /HIGH_EXPLICIT_RANK_SENTINEL/);
    setCanonicalRows([]);
    const multiTargetPacket = planner.plan({ ...options, query: rankingQuery,
      queryModel: { ...queryModel, granularity: "LIFE", text: rankingQuery }, entityIds: [44], explicitTargetEntityIds: [44],
      topics: ["北境"], entityNames: ["李道远"], entityNamesById: { 44: ["李道远"] },
      entityProfiles: [targetProfile], gameData: { characters: new Map([[44, targetProfile]]) }, legacyMemories: rankedLegacy });
    assert.equal(multiTargetPacket.details.length, 1);
    assert.match(multiTargetPacket.details[0].memory.content, /HIGH_EXPLICIT_RANK_SENTINEL/,
      "when one detail slot remains, the better-ranked Explicit Target Legacy item must survive");

    const unforcedPacket = plan(canonical, []);
    assert.deepEqual(unforcedPacket.details.map(item => item.memory.memoryId), ["selection-unrelated-D", "selection-unrelated-E"],
      "an empty Explicit Target set must preserve the existing Canonical-first selection");

    coordinator.derived.selectSlice = () => ({ memory: { memoryId: "selection-target-derived", content: "李道远北境旧约概览。", tags: ["北境"] },
      reason: { axis: "event", from: "1190.1.1", to: "1190.1.1", precision: "day" }, annotation: "derived fixture",
      sourceRef: { kind: "year", id: "selection-target-derived", sourceEntryIds: ["selection-target-C1"] } });
    const derivedPacket = plan(targetCanonical, [44]);
    assert.equal(derivedPacket.overview.routeKind, "entity_target",
      "a Derived overview backed by an Explicit Target Canonical source keeps target priority metadata");

    const budgetedPacket = fitRecallPacket({ query: { granularity: "PERIOD", text: query },
      overview: { memory: { memoryId: "unrelated-derived", content: "北境旧闻无关材料。".repeat(300), tags: ["北境"] },
        reason: { axis: "year", from: "1190.1.1", to: "1190.12.31", precision: "year" }, annotation: "derived",
        sourceRef: { kind: "year", id: "unrelated-derived", sourceEntryIds: [] } },
      details: [
        { memory: { memoryId: "unrelated-canonical", content: "北境使者的无关记录。".repeat(80), tags: ["北境"] },
          reason: { axis: "event", from: "1190.1.1", to: "1190.1.1", precision: "day" }, annotation: "canonical", score: 1,
          sourceRef: { kind: "detail", id: "unrelated-canonical" } },
        { memory: { memoryId: "budget-explicit-legacy", content: "EXPLICIT_TARGET_BUDGET_SENTINEL", tags: ["北境"] },
          reason: { axis: "event", from: "1190.1.1", to: "1190.1.1", precision: "day" }, annotation: "legacy", score: 1,
          routeKind: "entity_target", explicitTargetEntityIds: [44], sourceRef: { kind: "legacy", id: "budget-explicit-legacy" } }
      ], profileText: null, notice: null, focus: null }, 500, text => Math.ceil(String(text || "").length / 2));
    assert(budgetedPacket.items.some(item => item.memory.memoryId === "budget-explicit-legacy"),
      "budget fitting must retain the Explicit Target Legacy item ahead of unrelated Canonical/Derived items");
    assert.equal(budgetedPacket.items.some(item => item.memory.memoryId === "unrelated-derived"), false);
    assert.equal(budgetedPacket.items.some(item => item.memory.memoryId === "unrelated-canonical"), false);
    assert(budgetedPacket.tokens <= 500);

    const oversizedFiller = "南方宫宴按旧礼延续，账册详记宴席席次与乐舞编排。".repeat(700);
    const oversizedTargetContent = `${oversizedFiller}\n赵光义在北境守门约定中留下 EXPLICIT_OVERSIZE_MIDDLE_SENTINEL，应由门吏开启城门。\n${oversizedFiller}`;
    const oversizedTargetPacket = fitRecallPacket({ query: { granularity: "PERIOD", text: "赵光义北境守门约定如何？" },
      overview: { memory: { memoryId: "oversized-unrelated-derived", content: "无关的宫宴礼乐安排。".repeat(220), tags: [] },
        reason: { axis: "year", from: "1190.1.1", to: "1190.12.31", precision: "year" }, annotation: "derived",
        sourceRef: { kind: "year", id: "oversized-unrelated-derived", sourceEntryIds: [] } },
      details: [
        { memory: { memoryId: "oversized-unrelated-canonical", content: "无关的宫廷事务记录。".repeat(360), tags: [] },
          reason: { axis: "event", from: "1190.1.1", to: "1190.1.1", precision: "day" }, annotation: "canonical", score: 1,
          sourceRef: { kind: "detail", id: "oversized-unrelated-canonical" } },
        { memory: { memoryId: "oversized-explicit-legacy", content: oversizedTargetContent, tags: [] },
          reason: { axis: "event", from: "1190.1.1", to: "1190.1.1", precision: "day" }, annotation: "legacy", score: 1,
          routeKind: "entity_target", explicitTargetEntityIds: [44], sourceRef: { kind: "legacy", id: "oversized-explicit-legacy" } }
      ], profileText: null, notice: null, focus: null }, 1200, text => Math.ceil(String(text || "").length / 2));
    const fittedOversizedTarget = oversizedTargetPacket.details.find(item => item.memory.memoryId === "oversized-explicit-legacy");
    assert(fittedOversizedTarget, "the explicit oversized Legacy detail must survive after unrelated items are removed");
    assert(fittedOversizedTarget.memory.content.includes("EXPLICIT_OVERSIZE_MIDDLE_SENTINEL"),
      "retrying the excerpt after freeing non-target budget must preserve the relevant middle sentence");
    assert(fittedOversizedTarget.memory.content.length < oversizedTargetContent.length);
    assert(oversizedTargetPacket.tokens <= 1200);

    const smallBudgetTargetContent = `${"甲".repeat(400)}\n赵光义在北境守门约定中留下 EXPLICIT_SMALL_BUDGET_MIDDLE_SENTINEL，现由门吏看守。\n${"乙".repeat(400)}`;
    const smallBudgetPacket = fitRecallPacket({ query: { granularity: "PERIOD", text: "赵光义北境守门约定如何？" }, overview: null,
      details: [
        { memory: { memoryId: "small-budget-unrelated-canonical", content: "无关记录。".repeat(160), tags: [] },
          reason: { axis: "event", from: "1190.1.1", to: "1190.1.1", precision: "day" }, annotation: "canonical", score: 1,
          sourceRef: { kind: "detail", id: "small-budget-unrelated-canonical" } },
        { memory: { memoryId: "small-budget-explicit-legacy", content: smallBudgetTargetContent, tags: [] },
          reason: { axis: "event", from: "1190.1.1", to: "1190.1.1", precision: "day" }, annotation: "legacy", score: 1,
          routeKind: "entity_target", explicitTargetEntityIds: [44], sourceRef: { kind: "legacy", id: "small-budget-explicit-legacy" } }
      ], profileText: "人物认知补充。".repeat(40), notice: "其他非目标说明。".repeat(20), focus: null }, 200,
    text => Math.ceil(String(text || "").length / 2));
    assert(smallBudgetPacket.details.some(item => item.memory.content.includes("EXPLICIT_SMALL_BUDGET_MIDDLE_SENTINEL")),
      "the explicit Legacy excerpt must survive a smaller provider budget after unrelated text is removed");
    assert.equal(smallBudgetPacket.profileText, null);
    assert.equal(smallBudgetPacket.notice, null);
    assert(smallBudgetPacket.tokens <= 200);

    coordinator.derived.selectSlice = () => null;
    activeIndex = { entries: {}, byTopic: {}, finalizations: {} };
    entryRecords.clear();
  });

  check("unsplit explicit Legacy replaces only non-target overviews within the packet cap", () => {
    const query = "李道远这些年在北境的事情怎么样？";
    const queryModel = { axis: "EVENT", granularity: "LIFE", entityIds: [44], querySpeakerId: 1,
      window: null, blockedReason: null, firstMeeting: false, temporalRequested: false, expression: null,
      topics: ["北境"], text: query };
    const target = legacy("unsplit-c-legacy",
      "【乙能够知道并记住的本场经过】\n李道远在北境守门，留下 UNSPLIT_C_TARGET_SENTINEL。其后还有连续叙事，无法可靠拆分。",
      { subjects: [44], topics: ["北境"] });
    assert.equal(planner.legacyCandidates([target], scope, { entries: {} })[0].provenance.legacyParentId, undefined);
    const profile = { id: 44, firstName: "李道远", shortName: "李道远", fullName: "李道远" };
    const plan = (derivedEntityId, explicitIds, memories = [target]) => {
      setCanonicalRows([{ entryId: "unsplit-derived-source", entityIds: [derivedEntityId], topics: ["北境"],
        text: "北境旧事的年度记录。" }]);
      coordinator.derived.selectSlice = () => ({ memory: { memoryId: "unsplit-derived-overview", content: "北境旧事概览。", tags: ["北境"] },
        reason: { axis: "event", from: "1190.1.1", to: "1190.12.31", precision: "year" }, annotation: "derived fixture",
        sourceRef: { kind: "year", id: "unsplit-derived-overview", sourceEntryIds: ["unsplit-derived-source"] } });
      return planner.plan({ ...options, query, queryModel, entityIds: [44], explicitTargetEntityIds: explicitIds,
        topics: ["北境"], entityNames: ["李道远"], entityNamesById: { 44: ["李道远"] },
        entityProfiles: [profile], gameData: { characters: new Map([[44, profile]]) }, legacyMemories: memories });
    };
    const packet = plan(45, [44]);
    assert.equal(packet.overview?.memory.memoryId, target.memoryId);
    assert(packet.items.some(item => item.memory.content.includes("UNSPLIT_C_TARGET_SENTINEL")));
    assert.equal(packet.overview.routeKind, "entity_target");
    assert.equal(packet.details.some(item => item.sourceRef.kind === "legacy"), false);
    assert(packet.tokens <= 1200);
    assert.equal(plan(44, [44]).overview.memory.memoryId, "unsplit-derived-overview",
      "an explicit Derived overview must not be replaced by an explicit Legacy candidate");
    assert.equal(plan(45, []).overview.memory.memoryId, "unsplit-derived-overview",
      "without explicit targets, the existing Derived overview must remain");
    const ordinary = legacy("unsplit-non-target", "北境旧事属于另一个人物。", { subjects: [45], topics: ["北境"] });
    assert.equal(plan(45, [44], [ordinary]).overview.memory.memoryId, "unsplit-derived-overview",
      "a non-target Legacy cannot force an overview replacement");
    const filler = "宫廷礼节和宴席席次记录。".repeat(700);
    const oversized = { ...target, content: `${filler}\n李道远在北境守门，留下 UNSPLIT_C_TARGET_SENTINEL。\n${filler}` };
    const budgeted = plan(45, [44], [oversized]);
    assert.equal(budgeted.overview?.memory.memoryId, oversized.memoryId);
    assert(budgeted.overview.memory.content.includes("UNSPLIT_C_TARGET_SENTINEL"));
    assert(budgeted.overview.memory.content.length < oversized.content.length);
    assert(budgeted.tokens <= 1200);
    coordinator.derived.selectSlice = () => null;
    setCanonicalRows([]);
  });

  check("short explicit aliases do not accept topic hits from longer identities", () => {
    const shortProfile = { id: 4, firstName: "张三", shortName: "张三", fullName: "张三" };
    const longProfile = { id: 5, firstName: "张三丰", shortName: "张三丰", fullName: "张三丰" };
    const ambiguousByContent = legacy("long-alias-topic", "张三丰曾与赵太初谈论北境防务。", { topics: ["北境防务"] });
    const recalled = planner.plan({ ...options, entityIds: [4], explicitTargetEntityIds: [4], topics: ["北境防务"],
      entityNamesById: { 4: ["张三"] }, entityNames: ["张三"], entityProfiles: [shortProfile, longProfile],
      gameData: { characters: new Map([[4, shortProfile], [5, longProfile]]) }, legacyMemories: [ambiguousByContent],
      query: "你还记得张三谈过的北境防务吗？" });
    assert.equal(recalled.items.some(item => item.memory.memoryId === ambiguousByContent.memoryId), false);

    const exactByContent = legacy("exact-short-alias-topic", "张三曾与赵太初谈论北境防务。", { topics: ["北境防务"] });
    const exact = planner.plan({ ...options, entityIds: [4], explicitTargetEntityIds: [4], topics: ["北境防务"],
      entityNamesById: { 4: ["张三"] }, entityNames: ["张三"], entityProfiles: [shortProfile, longProfile],
      gameData: { characters: new Map([[4, shortProfile], [5, longProfile]]) }, legacyMemories: [exactByContent],
      query: "你还记得张三谈过的北境防务吗？" });
    assert(exact.items.some(item => item.memory.memoryId === exactByContent.memoryId));

    const bothPeople = legacy("both-short-and-long-aliases", "张三曾与张三丰谈论北境防务。", { subjects: [4], topics: ["北境防务"] });
    const both = planner.plan({ ...options, entityIds: [4], explicitTargetEntityIds: [4], topics: ["北境防务"],
      entityNamesById: { 4: ["张三"] }, entityNames: ["张三"], entityProfiles: [shortProfile, longProfile],
      gameData: { characters: new Map([[4, shortProfile], [5, longProfile]]) }, legacyMemories: [bothPeople],
      query: "你还记得张三谈过的北境防务吗？" });
    assert(both.items.some(item => item.memory.memoryId === bothPeople.memoryId));
  });

  check("an unfamiliar marked person name cannot fall back to unrelated player history", () => {
    const unrelated = legacy("unrelated-player-history", "同样谈到议和，却是另一个完全无关的事件。");
    const packet = planner.plan({ ...options, entityIds: [1], legacyMemories: [unrelated],
      query: "你还记得完全陌生的阿布鲁吗？" });
    assert.equal(packet.diagnostics.blockedReason, "IDENTITY_UNRESOLVED");
    assert.equal(packet.items.length, 0);
  });

  check("a single shared Chinese character is not lexical relevance", () => {
    const unrelated = legacy("single-character-overlap", "一号与三号共同议和。", { subjects: [1] });
    const packet = planner.plan({ ...options, entityIds: [77], explicitTargetEntityIds: [77], legacyMemories: [unrelated],
      query: "七十七号人物" });
    assert.equal(packet.items.some(item => item.memory.memoryId === unrelated.memoryId), false);
  });

  check("active commitment query retains Legacy as historical evidence only", () => {
    const promise = legacy("old-promise", "我曾答应归还玉印，但那只是当时的约定。", { topics: ["玉印"] });
    const packet = planner.plan({ ...options, legacyMemories: [promise],
      query: "过去你答应归还玉印的承诺现在仍然有效吗？" });
    const item = packet.items.find(candidate => candidate.memory.memoryId === promise.memoryId);
    assert(item);
    assert.match(item.annotation, /不证明当前仍然有效/);
  });

  check("oversized Legacy preserves a relevant middle excerpt within packet budget", () => {
    const filler = "无关的往年宴饮与宫廷礼节记载，未涉及边境事务。".repeat(160);
    const keyFact = "此后李道远在北境防务中交出玉印，议和使者据此开启城门。";
    const long = legacy("oversized-legacy", `${filler}\n${keyFact}\n${filler}`);
    const packet = planner.plan({ ...options, legacyMemories: [long], query: "你还记得北境防务和玉印吗？" });
    assert(packet.items.length > 0);
    assert(packet.items.some(item => item.memory.content.includes(keyFact)));
    assert(packet.tokens <= 1200);
  });

  check("Legacy diagnostics are present and active participants are not recall targets", () => {
    const activeOnly = legacy("active-only", "李道远参与了边境议和。", { subjects: [44] });
    const packet = planner.plan({ ...options, activeParticipantIds: [44], legacyMemories: [activeOnly],
      query: "你还记得天文仪器吗？" });
    assert.deepEqual(packet.diagnostics.activeParticipantIds, [44]);
    assert.deepEqual(Object.keys(packet.diagnostics.legacyRejected).sort(),
      ["identity", "lexical", "topic", "budget", "stale", "forgotten"].sort());
    assert.equal(packet.diagnostics.legacyCandidateCount, 1);
    assert.equal(packet.items.some(item => item.memory.memoryId === activeOnly.memoryId), false);
  });

  check("Legacy keeps campaign, owner, knowledge, and future-date gates", () => {
    const valid = legacy("valid", "1170年我们讨论了边境议和。", { topics: ["边境"] });
    const wrongCampaign = legacy("wrong-campaign", valid.content, { campaignToken: "other" });
    const wrongOwner = legacy("wrong-owner", valid.content, { folderOwnerId: 3 });
    const unknownToOwner = { ...valid, memoryId: "unknown-to-owner", knownBy: [3] };
    const future = { ...valid, memoryId: "future", eventDate: "1201.1.1" };
    const packet = planner.plan({ ...options, legacyMemories: [valid, wrongCampaign, wrongOwner, unknownToOwner, future],
      query: "1190年我们聊过边境议和吗？" });
    assert(packet.items.some(item => item.memory.memoryId === valid.memoryId));
    for (const id of [wrongCampaign.memoryId, wrongOwner.memoryId, unknownToOwner.memoryId, future.memoryId]) {
      assert.equal(packet.items.some(item => item.memory.memoryId === id), false, id);
    }
  });

  console.log(`PASS ${checks} V8.15 Legacy recall checks`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
