"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAdversarialFixtureData, createFixtureEngine, makeCandidateRequest, makePromptRuntime, seedAdversarialFixture } = require("./test-v9.3.6-independent-qa");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const { resolveMemoryBudget } = require("../src/app/main/memory-system/memory-budget-policy");
const { discardPendingSources } = require("../src/app/main/memory-system/dynamic-summary-freeze");
const { CharacterKnowledgeService } = require("../src/app/main/worldline/character-knowledge-service");
const { parseGameState } = require("../src/app/main/worldline/game-state-adapter");
const { getCachedKinshipGraph, getTargetedKinshipGraph } = require("../src/app/main/worldline/kinship-graph-cache");
const { buildCharacterDisclosureContext } = require("../src/app/main/conversation/character-disclosure-context");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");

const POLICY = "v9.3.9";
const CONVERSATION = "v939-independent-scene";
const PLAYER_ID = 1;
const RESPONDER_A = 2;
const RESPONDER_B = 4;
const TARGET_ID = 3;
const CURRENT_DATE = "1200.1.1";
const PROFILES = [
  { id: PLAYER_ID, name: "甲" },
  { id: RESPONDER_A, name: "乙" },
  { id: TARGET_ID, name: "玛蒂尔达" },
  { id: RESPONDER_B, name: "戊" }
];

function makeSummary(template, ownerId, counterpartId, date, marker) {
  const names = new Map([[1, "甲"], [2, "乙"], [3, "玛蒂尔达"], [4, "戊"]]);
  const ownerName = names.get(ownerId);
  const counterpartName = names.get(counterpartId);
  return {
    ...template,
    date,
    totalDays: normalizeGameDate(date).serial,
    playerId: ownerId,
    playerName: ownerName,
    perspectiveOwnerId: ownerId,
    characterId: counterpartId,
    characterName: counterpartName,
    finalizationId: marker,
    conversationId: marker,
    participants: [{ id: ownerId, name: ownerName }, { id: counterpartId, name: counterpartName }],
    content: `${marker}：${ownerName}与${counterpartName}在${date}商议税收的完整历史。${"税收细节和后续约定。".repeat(36)}\n【需要长期记住的事项】\n- ${marker}：约定复核税收。\n【其他事项】\n${marker}_END`
  };
}

function makeFixtureData({ ownerATimeCount = 5, ownerBTimeCount = 5, targetCount = 3 } = {}) {
  const fixture = createAdversarialFixtureData();
  const template = fixture.pairSummaries[0].summaries[0];
  const rows = [];
  const addPair = (ownerId, counterpartId, summaries) => rows.push({ ownerId, counterpartId, summaries });
  const addBaselineAndTime = (ownerId, timeCount, prefix) => {
    addPair(ownerId, PLAYER_ID, [
      makeSummary(template, ownerId, PLAYER_ID, "1199.1.1", `${prefix}_RECENT_NEW`),
      makeSummary(template, ownerId, PLAYER_ID, "1198.1.1", `${prefix}_RECENT_OLD`),
      ...Array.from({ length: timeCount }, (_, index) => makeSummary(template, ownerId, PLAYER_ID,
        `1190.${index + 1}.1`, `${prefix}_TIME_${index + 1}`))
    ]);
  };
  addBaselineAndTime(RESPONDER_A, ownerATimeCount, "RESPONDER_A");
  addBaselineAndTime(RESPONDER_B, ownerBTimeCount, "RESPONDER_B");
  addPair(RESPONDER_A, TARGET_ID, Array.from({ length: targetCount }, (_, index) => makeSummary(template,
    RESPONDER_A, TARGET_ID, `1190.${index + 1}.1`, `RESPONDER_A_THIRD_${index + 1}`)));
  fixture.pairSummaries = rows;
  fixture.currentGameDate = CURRENT_DATE;
  fixture.currentTotalDays = normalizeGameDate(CURRENT_DATE).serial;
  fixture.identities.playerId = PLAYER_ID;
  fixture.identities.responderB = RESPONDER_B;
  fixture.identities.targetC = TARGET_ID;
  fixture.identities.otherD = 5;
  return fixture;
}

function request(fixture, ownerId, turnEpoch, playerContent, cache, participantCount = 2) {
  return makeCandidateRequest(fixture, "nameOnly", {
    characterId: ownerId,
    playerContent,
    conversationId: CONVERSATION,
    sceneRevision: "v939-scene-1",
    turnEpoch,
    activeParticipantIds: [PLAYER_ID, ownerId, ...(participantCount > 2 ? [TARGET_ID] : [])],
    memoryBudgetPlan: { participantCount },
    budgetPolicyRevision: POLICY,
    tokenBudget: 80000,
    entityProfiles: PROFILES,
    sessionRecallCache: cache,
    estimateTokens: value => Math.ceil(String(value || "").length / 2)
  });
}

function commit(fixture, engine, cache, ownerId, turnEpoch, result, ids = result.extra.map(entry => entry.memory.memoryId)) {
  return engine.commitDynamicSummaryRecall(ownerId, cache, turnEpoch, {
    providerSucceeded: true,
    injectedBlockIds: ["memory-dynamic-frozen"],
    injectedMemoryIds: ids,
    injectedTokens: Math.max(1, result.pairMemoryMetrics.dynamicBudgetUsed || result.pairMemoryMetrics.finalInjectedTokens)
  });
}

function assertPromptBuilderLifecycle(result) {
  const runtime = makePromptRuntime();
  runtime.gameData.characters.set(RESPONDER_B, {
    id: RESPONDER_B, shortName: "戊", fullName: "戊", age: 35, traits: [], parents: [], children: []
  });
  const prefixByResponder = new Map();
  const snapshotCache = { conversation: null, responders: new Map(), prefixByResponder };
  const context = {
    ...result,
    playerCenteredRecallEnabled: true,
    activeParticipantIds: [PLAYER_ID, RESPONDER_A],
    playerAnchorId: PLAYER_ID,
    sourceCampaignToken: result.sourceCampaignToken,
    conversationId: CONVERSATION,
    budgetPolicyRevision: POLICY,
    cacheV2FrozenSnapshots: snapshotCache,
    freezePromptPrefix: true
  };
  const blockFor = prompt => prompt.blocks.find(entry => entry.block?.id === "memory-dynamic-frozen");
  for (const layout of ["standard", "glm", "v813"]) {
    const first = runtime.build(layout, context, RESPONDER_A);
    const frozen = blockFor(first);
    assert(frozen?.content?.includes("RESPONDER_A_TIME_1_END"), `${layout} Prompt must include the dynamic frozen memory block`);
    const second = runtime.build(layout, context, RESPONDER_A);
    assert.equal(blockFor(second)?.content, frozen.content, `${layout} repeated construction must retain byte-identical frozen text`);
    const userIndex = first.messages.findIndex(message => message.role === "user" && String(message.content).includes("甲询问当前宫廷安排"));
    const frozenIndex = first.messages.findIndex(message => message.role === "system" && message.content === frozen.content);
    assert(frozenIndex >= 0 && userIndex >= 0 && frozenIndex < userIndex, `${layout} frozen memory must precede mutable history`);

    const expandedContext = { ...context, frozenDynamicText: `${context.frozenDynamicText}\n\nV939_ADDED_SOURCE` };
    const expanded = runtime.build(layout, expandedContext, RESPONDER_A);
    assert(blockFor(expanded)?.content.includes("V939_ADDED_SOURCE"), `${layout} newly frozen source must expand the cached prefix`);

    const otherResponder = runtime.build(layout, { ...context, frozenDynamicText: null,
      respondingCharacterId: RESPONDER_B, activeParticipantIds: [PLAYER_ID, RESPONDER_B] }, RESPONDER_B);
    assert(!otherResponder.messages.some(message => String(message.content).includes("RESPONDER_A_TIME_1_END")),
      `${layout} another responder must not inherit the first responder's frozen text`);

    const nextConversation = runtime.build(layout, { ...context, frozenDynamicText: null,
      conversationId: `${CONVERSATION}-next`, baselineSnapshotId: `${result.baselineSnapshotId}-next` }, RESPONDER_A);
    assert(!nextConversation.messages.some(message => String(message.content).includes("RESPONDER_A_TIME_1_END")),
      `${layout} refreshed conversation scope must clear the old frozen prefix`);
  }

  const excluded = runtime.builder.buildMessagesWithTokenCount(
    [{ role: "user", content: "甲询问当前宫廷安排。" }],
    runtime.gameData.characters.get(RESPONDER_A), runtime.gameData, "", context,
    { providerType: "openai-compatible", defaultModel: "qa-model" }, { memoryMode: "exclude" });
  assert(!excluded.blocks.some(entry => entry.block?.id === "memory-dynamic-frozen"), "exclude mode must omit the frozen block");
  assert(!excluded.messages.some(message => String(message.content).includes("RESPONDER_A_TIME_1_END")),
    "exclude mode must not leak frozen summary text through PromptBuilder prefix caching");
}

function testCharacterKnowledgePromptBoundary() {
  const snapshot = {
    playthroughId: "v939-knowledge-campaign",
    gameDate: "1200.1.1",
    characters: {
      "1": { id: "1", firstName: "甲", liege: null, traits: [] },
      "2": { id: "2", firstName: "回应者甲", liege: "1", traits: [], secrets: [], knownSecrets: [] },
      "3": { id: "3", firstName: "目标", liege: "1", traits: ["witch", "adulterer", "beauty_good_1"],
        secrets: [{ name: "V939_PRIVATE_SECRET_SENTINEL" }], knownSecrets: [] }
    },
    titles: {}
  };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "v939-independent-knowledge-"));
  const autosavePath = path.join(dataDir, "autosave.ck3");
  fs.writeFileSync(autosavePath, "v939-autosave");
  const autosaveStat = fs.statSync(autosavePath);
  const worldlineService = {
    currentCheckpoint: { id: "v939-checkpoint", state: "ACTIVE", snapshot,
      source: { path: autosavePath, fileSize: autosaveStat.size, modifiedAt: autosaveStat.mtime.toISOString() } },
    settings: { autosavePath, lastValidationStatus: "VALID" },
    freshnessStatus: "FRESH",
    getSettings() { return this.settings; },
    getCheckpointStatus() { return { checkpoint: { status: "ACTIVE", checkpointId: this.currentCheckpoint.id,
      freshnessStatus: this.freshnessStatus } }; },
    getLiveState: () => ({ connected: true, gameDate: snapshot.gameDate }),
    localizationResolver: { resolveForDisplay: (_type, key) => ({ localizedValue: `显示:${key}` }) }
  };
  const currentGameData = {
    campaignToken: snapshot.playthroughId,
    date: snapshot.gameDate,
    totalDays: normalizeGameDate(snapshot.gameDate).serial,
    playerID: 1,
    characters: new Map([
      [1, { id: 1, knownSecrets: [] }],
      [2, { id: 2, traits: [], knownSecrets: [{ ownerId: 3, type: "secret_witch" }], secrets: [] }],
      [3, { id: 3, traits: ["witch", "adulterer", "beauty_good_1"], secrets: [{ name: "V939_PRIVATE_SECRET_SENTINEL" }], knownSecrets: [] }]
    ])
  };
  try {
    const service = new CharacterKnowledgeService({ dataDir, worldlineService, getCurrentGameData: () => currentGameData });
    const ownerAContext = buildCharacterDisclosureContext({ service, gameData: currentGameData, responderId: 2, targetIds: [3] });
    const ownerA = createTraitProfileView(currentGameData, currentGameData.characters.get(2), ownerAContext).gameData.characters.get(3);
    assert.deepEqual(ownerA.traits, ["witch"], "a current explicit secret disclosure reaches only its owning responder's Prompt projection");
    assert.deepEqual(ownerA.secrets, [], "raw secret records are removed from the Prompt projection");
    assert.deepEqual(ownerA.knownSecrets, [], "raw known-secret records are removed from the Prompt projection");
    assert.doesNotMatch(JSON.stringify(ownerA), /V939_PRIVATE_SECRET_SENTINEL|adulterer|beauty_good_1/,
      "private secret payload and undisclosed traits do not reach the Prompt");

    const ownerBContext = buildCharacterDisclosureContext({ service, gameData: currentGameData, responderId: 1, targetIds: [3] });
    const ownerB = createTraitProfileView(currentGameData, currentGameData.characters.get(1), ownerBContext).gameData.characters.get(3);
    assert.deepEqual(ownerB.traits, [], "a second responder cannot inherit another owner's known secret");
    assert.deepEqual(service.getDisclosureProfile({ campaignToken: snapshot.playthroughId, ownerRuntimeId: "1",
      targetRuntimeId: "3", sourceSnapshotId: "v939-checkpoint" }).facts, [],
    "another owner has no automatic or copied disclosure facts");

    const futureGameData = { ...currentGameData, date: "1200.1.2", totalDays: currentGameData.totalDays + 1 };
    const futureOwnerContext = buildCharacterDisclosureContext({ service, gameData: futureGameData, responderId: 2, targetIds: [3] });
    const futureOwner = createTraitProfileView(futureGameData, futureGameData.characters.get(2), futureOwnerContext).gameData.characters.get(3);
    assert.equal(futureOwnerContext.disclosureProfiles.size, 0, "checkpoint-date mismatch still blocks checkpoint-derived facts");
    assert.deepEqual(futureOwner.traits, ["witch"], "V9.3.9.1 restores the pre-V9.3.9 current-log Owner -> Target proof independently of Worldline");

    worldlineService.freshnessStatus = "STALE";
    const staleCheckpointContext = buildCharacterDisclosureContext({ service, gameData: currentGameData, responderId: 2, targetIds: [3] });
    const staleCheckpoint = createTraitProfileView(currentGameData, currentGameData.characters.get(2), staleCheckpointContext)
      .gameData.characters.get(3);
    assert.equal(staleCheckpointContext.disclosureProfiles.size, 0, "a stale checkpoint supplies no disclosure facts");
    assert.deepEqual(staleCheckpoint.traits, ["witch"], "a stale Worldline checkpoint does not revoke an independent current-log known-secret proof");
    worldlineService.freshnessStatus = "FRESH";

    fs.writeFileSync(autosavePath, "v939-autosave-file-changed");
    const staleAutosaveContext = buildCharacterDisclosureContext({ service, gameData: currentGameData, responderId: 2, targetIds: [3] });
    const staleAutosave = createTraitProfileView(currentGameData, currentGameData.characters.get(2), staleAutosaveContext)
      .gameData.characters.get(3);
    assert.equal(staleAutosaveContext.disclosureProfiles.size, 0, "a changed autosave supplies no checkpoint-derived facts");
    assert.deepEqual(staleAutosave.traits, ["witch"], "a changed Worldline autosave does not revoke an independent current-log known-secret proof");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function testSaveKinshipProofBoundary() {
  const saveText = 'date=1175.1.1 playthrough_id=v939-save-kinship played_character=1 living={ '
    + '1={ first_name="父亲" family_data={ child=2 } } '
    + '2={ first_name="合法亲子" traits={ witch adulterer beauty_good_1 } family_data={ father=1 mother=5 real_father=9 } } '
    + '3={ first_name="仅真实父亲" family_data={ real_father=9 } } '
    + '4={ first_name="仅真实母亲" family_data={ real_mother=8 } } '
    + '5={ first_name="母亲" family_data={ child=2 } } '
    + '8={ first_name="秘密母亲" } 9={ first_name="秘密父亲" } }';
  const parsed = parseGameState(saveText);
  const saveHash = crypto.createHash("sha256").update(Buffer.from(saveText, "utf8")).digest("hex");
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.contentFingerprint, saveHash, "the production parser hashes the exact complete save text");
  assert.equal(parsed.characters["2"].parents.father, "1");
  assert.equal(parsed.characters["2"].parents.mother, "5");
  assert.equal(parsed.characters["3"].parents.father, null, "real_father alone must not become a public parent");
  assert.equal(parsed.characters["4"].parents.mother, null, "real_mother alone must not become a public parent");

  const evidenceFor = (snapshot, childId, sourceRelation) => snapshot.characters[childId].evidence?.relations
    ?.find(item => item.directParentEvidence?.sourceRelation === sourceRelation)?.directParentEvidence;
  const fatherProof = evidenceFor(parsed, "2", "family_data.father");
  const motherProof = evidenceFor(parsed, "2", "family_data.mother");
  assert(fatherProof && motherProof, "the parser must attach source-bound proofs only for legal family_data parents");
  assert.equal(fatherProof.source, "CK3_SAVE_LEGAL_PARENT");
  assert.equal(fatherProof.sourceOwnerId, "2");
  assert.equal(fatherProof.childId, "2");
  assert.equal(fatherProof.parentId, "1");
  assert.equal(fatherProof.playthroughId, parsed.playthroughId);
  assert.equal(fatherProof.gameDate, parsed.gameDate);
  assert.equal(fatherProof.contentFingerprint, parsed.contentFingerprint);
  assert.equal(fatherProof.sourceSnapshotId, `${parsed.playthroughId}/${parsed.gameDate}/${parsed.contentFingerprint}`);
  assert.equal(parsed.characters["3"].evidence?.relations?.length || 0, 0,
    "real_father-only records must not receive a public-parent proof");
  assert.equal(parsed.characters["4"].evidence?.relations?.length || 0, 0,
    "real_mother-only records must not receive a public-parent proof");

  const hasEdge = (snapshot, parentId, childId) => getCachedKinshipGraph(snapshot)
    .relationBetweenOfTypes(String(parentId), String(childId), ["PARENT_OF"]).relation;
  assert.equal(hasEdge(parsed, 1, 2)?.type, "PARENT_OF", "real parseGameState output must reach the current kinship graph");
  assert.equal(hasEdge(parsed, 5, 2)?.type, "PARENT_OF", "maternal legal family_data proof must also be accepted");
  assert.equal(hasEdge(parsed, 9, 2), null, "a conflicting real_father field must not override legal father evidence");
  assert.equal(hasEdge(parsed, 9, 3), null, "real_father-only evidence must not create a graph edge");
  assert.equal(hasEdge(parsed, 8, 4), null, "real_mother-only evidence must not create a graph edge");
  const targeted = getTargetedKinshipGraph(parsed, ["2"]);
  assert.equal(targeted.relationBetweenOfTypes("1", "2", ["PARENT_OF"]).relation?.type, "PARENT_OF",
    "the targeted current graph must retain a parser-proven direct parent edge");

  const clone = () => JSON.parse(JSON.stringify(parsed));
  const rejected = (snapshot, reason) => {
    assert.equal(hasEdge(snapshot, 1, 2), null, `${reason} must reject the parsed parent edge`);
    const focused = getTargetedKinshipGraph(snapshot, ["2"]);
    assert.equal(focused.relationBetweenOfTypes("1", "2", ["PARENT_OF"]).relation, null,
      `${reason} must also reject the targeted parent edge`);
  };
  const forgedHash = clone();
  const forgedProof = evidenceFor(forgedHash, "2", "family_data.father");
  forgedProof.contentFingerprint = "f".repeat(64);
  forgedProof.sourceSnapshotId = `${forgedProof.playthroughId}/${forgedProof.gameDate}/${forgedProof.contentFingerprint}`;
  rejected(forgedHash, "a forged proof hash that disagrees with the parsed checkpoint");

  const wrongSaveSchema = clone();
  wrongSaveSchema.schemaVersion = 2;
  rejected(wrongSaveSchema, "an unsupported checkpoint schema");
  const wrongProofSchema = clone();
  evidenceFor(wrongProofSchema, "2", "family_data.father").sourceSchemaVersion = 2;
  rejected(wrongProofSchema, "an unsupported parent proof schema");

  const wrongSaveDate = clone();
  wrongSaveDate.gameDate = "1175.1.2";
  rejected(wrongSaveDate, "a checkpoint date changed after proof creation");
  const wrongProofDate = clone();
  evidenceFor(wrongProofDate, "2", "family_data.father").gameDate = "1175.1.2";
  rejected(wrongProofDate, "a parent proof from a different save date");

  const wrongPlaythrough = clone();
  wrongPlaythrough.playthroughId = "other-campaign";
  rejected(wrongPlaythrough, "a proof from a different playthrough");
  const wrongChild = clone();
  evidenceFor(wrongChild, "2", "family_data.father").childId = "3";
  rejected(wrongChild, "a proof bound to a different child ID");
  const wrongParent = clone();
  evidenceFor(wrongParent, "2", "family_data.father").parentId = "9";
  rejected(wrongParent, "a proof bound to a different parent ID");

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "v939-save-kinship-knowledge-"));
  const autosavePath = path.join(dataDir, "autosave.ck3");
  fs.writeFileSync(autosavePath, saveText, "utf8");
  const autosaveStat = fs.statSync(autosavePath);
  const currentGameData = {
    campaignToken: parsed.playthroughId,
    date: parsed.gameDate,
    totalDays: normalizeGameDate(parsed.gameDate).serial,
    characters: new Map([
      [1, { id: 1, fullName: "父亲", knownSecrets: [] }],
      [2, { id: 2, fullName: "合法亲子", traits: parsed.characters["2"].traits,
        secrets: [{ name: "V939_KINSHIP_MUST_NOT_DISCLOSE_SECRET" }], knownSecrets: [] }]
    ])
  };
  const worldlineService = {
    currentCheckpoint: { id: "v939-save-kinship-checkpoint", state: "ACTIVE", snapshot: parsed,
      source: { path: autosavePath, fileSize: autosaveStat.size, modifiedAt: autosaveStat.mtime.toISOString() } },
    settings: { autosavePath, lastValidationStatus: "VALID" },
    getSettings() { return this.settings; },
    getCheckpointStatus() { return { checkpoint: { status: "ACTIVE", checkpointId: this.currentCheckpoint.id,
      freshnessStatus: "FRESH" } }; },
    getLiveState: () => ({ connected: true, gameDate: parsed.gameDate }),
    localizationResolver: { resolveForDisplay: (_type, key) => ({ localizedValue: String(key) }) }
  };
  try {
    const service = new CharacterKnowledgeService({ dataDir, worldlineService, getCurrentGameData: () => currentGameData });
    const disclosureContext = buildCharacterDisclosureContext({ service, gameData: currentGameData, responderId: 1, targetIds: [2] });
    const parentView = createTraitProfileView(currentGameData, currentGameData.characters.get(1), disclosureContext)
      .gameData.characters.get(2);
    assert.deepEqual(service.getDisclosureProfile({ campaignToken: parsed.playthroughId, ownerRuntimeId: "1",
      targetRuntimeId: "2", sourceSnapshotId: "v939-save-kinship-checkpoint" }).facts, [],
    "a parser-proven parent edge must not create Character Knowledge disclosure facts");
    assert.deepEqual(parentView.traits, [], "kinship alone must not disclose the child's secret traits to its parent");
    assert.doesNotMatch(JSON.stringify(parentView), /V939_KINSHIP_MUST_NOT_DISCLOSE_SECRET/,
      "kinship-only Prompt projection must remove the child's private secret payload");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function run() {
  const expectedBudgets = [[2, 80000], [3, 84000], [4, 96000], [6, 96000]];
  for (const [participantCount, cap] of expectedBudgets) {
    assert.equal(resolveMemoryBudget({ participantCount, contextWindowTokens: 192000, providerHeadroomTokens: 192000 }).memoryBudgetTokens, cap);
    assert.equal(resolveMemoryBudget({ participantCount, contextWindowTokens: 192000, providerHeadroomTokens: 1234 }).memoryBudgetTokens, 1234);
  }
  assert.equal(resolveMemoryBudget({ participantCount: 4, contextWindowTokens: 192000,
    providerHeadroomTokens: 192000, policyRevision: "v9.3.8" }).memoryBudgetTokens, 88000,
  "the explicit v9.3.8 history policy remains at its historical 88K cap");

  const fixture = makeFixtureData();
  const test = createFixtureEngine("v939-independent");
  try {
    seedAdversarialFixture(test.engine, fixture);
    const cache = new Map();
    const mixedQuery = "1190年我们当时关于税收具体谈过什么？再说1190年你和玛蒂尔达的谈话中关于税收具体说了什么？";
    const first = test.engine.retrieveForResponder(request(fixture, RESPONDER_A, 1, mixedQuery, cache));
    const timeSources = first.extra.filter(entry => entry.routeKind !== "third_person_source");
    const thirdSources = first.extra.filter(entry => entry.routeKind === "third_person_source");
    assert.equal(timeSources.length, 5, "2-person scene can stage five time summaries across the full explicit query");
    assert.equal(thirdSources.length, 3, "third-person quota is three and shares the same scene state");
    assert(first.frozenDynamicText.includes("RESPONDER_A_TIME_1_END"));
    assert(first.frozenDynamicText.includes("RESPONDER_A_THIRD_3_END"));

    const beforeCommit = cache.get(RESPONDER_A);
    assert.equal(beforeCommit.frozenDynamicSources?.length || 0, 0, "selected sources must remain pending before Provider success");
    assert.equal(beforeCommit.pendingDynamicSources.length, 8, "all selected complete sources are pending until success evidence");

    const failedResponderQuery = request(fixture, RESPONDER_B, 1, "1190年我们当时具体谈过什么？", cache);
    const blockedBeforeFailureKnown = test.engine.retrieveForResponder(failedResponderQuery);
    assert.equal(blockedBeforeFailureKnown.extra.filter(entry => entry.routeKind !== "third_person_source").length, 0,
      "another responder sees the in-flight pending reservation until the first response settles");
    discardPendingSources(cache, RESPONDER_A, 1);
    const retryResponder = test.engine.retrieveForResponder(failedResponderQuery);
    assert.equal(retryResponder.extra.filter(entry => entry.routeKind !== "third_person_source").length, 5,
      "failed pending sources must release their global quota for another responder's retry");
    assert(retryResponder.frozenDynamicText.includes("RESPONDER_B_TIME_1_END"));
    assert(!retryResponder.frozenDynamicText.includes("RESPONDER_A_TIME_1_END"),
      "a responder retry must never inherit another responder's private source text");
    discardPendingSources(cache, RESPONDER_B, 1);

    const success = test.engine.retrieveForResponder(request(fixture, RESPONDER_A, 2, mixedQuery, cache));
    assert.equal(commit(fixture, test.engine, cache, RESPONDER_A, 2, success).committedCount, 8);
    const committedState = cache.get(RESPONDER_A);
    const frozenText = success.frozenDynamicText;
    assert.equal(committedState.pendingDynamicSources.length, 0);
    assert.equal(committedState.frozenDynamicSources.length, 8);
    const reused = test.engine.retrieveForResponder(request(fixture, RESPONDER_A, 3, mixedQuery, cache));
    assert.equal(reused.frozenDynamicText, frozenText, "a successful source set must be reused byte-for-byte next turn");

    const fourPersonCache = new Map();
    const fourPerson = test.engine.retrieveForResponder(request(fixture, RESPONDER_A, 1,
      "1190年我们当时具体谈过什么？", fourPersonCache, 4));
    assert.equal(fourPerson.extra.filter(entry => entry.routeKind !== "third_person_source").length, 3,
      "4+ person scenes use a three-source temporal cap");

    assertPromptBuilderLifecycle(success);
    testCharacterKnowledgePromptBoundary();
    testSaveKinshipProofBoundary();

    const gameData = { campaignToken: fixture.campaignToken, playerID: PLAYER_ID, date: fixture.currentGameDate,
      getOfficialRecollectionSummary: () => null };
    assert.equal(test.engine.validatePlayerMemoryContext(success, gameData, CONVERSATION).valid, true);
    const forgottenSource = test.engine.store.loadFolderSummariesForCharacter(RESPONDER_A)
      .find(memory => memory.content.includes("RESPONDER_A_TIME_1_END"));
    assert(forgottenSource, "Forget fixture must locate the actual recalled source");
    test.engine.store.recordForgottenSummaryProjection(forgottenSource, { ownerId: RESPONDER_A, counterpartId: PLAYER_ID });
    assert.equal(test.engine.validatePlayerMemoryContext(success, gameData, CONVERSATION).reason, "FORGET_CHANGED",
      "a forgotten source must invalidate the already-built send context");
    const afterForget = test.engine.retrieveForResponder(request(fixture, RESPONDER_A, 4,
      "1190年我们当时具体谈过什么？", cache));
    assert(!afterForget.frozenDynamicText?.includes("RESPONDER_A_TIME_1_END"),
      "forgotten source text must not re-enter the next Prompt");

    const additionFixture = makeFixtureData({ ownerATimeCount: 1, ownerBTimeCount: 0, targetCount: 0 });
    const additionTest = createFixtureEngine("v939-source-addition");
    try {
      seedAdversarialFixture(additionTest.engine, additionFixture);
      const additionCache = new Map();
      const firstSource = additionTest.engine.retrieveForResponder(request(additionFixture, RESPONDER_A, 1,
        "1190年我们当时具体谈过什么？", additionCache));
      assert(firstSource.frozenDynamicText?.includes("RESPONDER_A_TIME_1_END"));
      assert.equal(commit(additionFixture, additionTest.engine, additionCache, RESPONDER_A, 1, firstSource).committedCount, 1);
      const ownerPath = path.join(additionTest.engine.store.summaryFoldersDir, "2_乙", "与甲的对话.json");
      const rawRows = additionTest.engine.store.readJson(ownerPath, []);
      rawRows.push(makeSummary(additionFixture.pairSummaries[0].summaries[0], RESPONDER_A, PLAYER_ID,
        "1191.1.1", "RESPONDER_A_TIME_NEW"));
      additionTest.engine.store.writeJson(ownerPath, rawRows);
      additionTest.engine.store.invalidateFolderSummaryCache([RESPONDER_A]);
      const plusOneSource = additionTest.engine.retrieveForResponder(request(additionFixture, RESPONDER_A, 2,
        "1191年我们当时具体谈过什么？", additionCache));
      assert(plusOneSource.frozenDynamicText?.includes("RESPONDER_A_TIME_1_END"),
        "adding a new source must retain previously validated frozen sources");
      assert(plusOneSource.frozenDynamicText?.includes("RESPONDER_A_TIME_NEW_END"),
        "a new source may join the same responder's still-open global quota");
    } finally {
      additionTest.cleanup();
    }
    console.log("PASS V9.3.9 independent memory, parser-bound kinship, disclosure isolation and Prompt prefix QA");
  } finally {
    test.cleanup();
  }
}

if (require.main === module) run();
module.exports = { run };
