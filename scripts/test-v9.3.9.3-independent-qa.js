"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { ConversationTurnManager } = require("../src/app/main/conversation/conversation-turn-manager");
const { GenerationManager } = require("../src/app/main/conversation/generation-manager");
const { getAutomaticTraitAccess } = require("../src/app/main/prompts/trait-profile-selector");

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function conversationFixture({ rewriteMode = "success", blockRewrite = false, revokeSources = false } = {}) {
  const player = { id: 1, fullName: "玩家甲", shortName: "甲" };
  const firstNpc = { id: 2, fullName: "回应者乙", shortName: "乙" };
  const nextNpc = { id: 3, fullName: "后续丙", shortName: "丙" };
  const sceneRevision = JSON.stringify(["scene-a", "room-a", 1]);
  const c = Object.create(Conversation.prototype);
  Object.assign(c, {
    id: "v9393-independent-qa",
    conversationEpoch: 1,
    nextId: 11,
    isActive: true,
    isPaused: false,
    gameData: { playerID: 1, campaignToken: "qa-campaign", date: "1200.1.1", totalDays: 100,
      scene: "scene-a", location: "room-a", locationController: 1,
      characters: new Map([[1, player], [2, firstNpc], [3, nextNpc]]) },
    messages: [{ id: 10, role: "user", speakerCharacterId: 1, content: "继续谈话。" }],
    pendingActionApprovals: new Map(),
    generationAttemptsByMessageId: new Map(),
    memoryAttemptDiagnosticsByOwner: new Map(),
    dynamicRecallHistory: new Map(),
    cacheV2FrozenSnapshots: { prefixByResponder: new Map() },
    memoryState: { rollingState: { segments: [] }, responderRecallCache: new Map() },
    contextBudgetDiagnostics: {}
  });
  const turns = new ConversationTurnManager(c);
  const generation = new GenerationManager(c);
  c.runtime = { turnManager: turns, generationManager: generation };
  turns.startUserTurn({ playerMessageId: 10, activeParticipantIds: [1, 2, 3], playerCharacterId: 1,
    conversationId: c.id, sceneRevision, campaignToken: c.gameData.campaignToken });
  c.emitUpdate = () => {};
  c.getNpcList = () => [firstNpc, nextNpc];
  c.isCharacterAvailableForConversation = npc => c.gameData.characters.has(Number(npc?.id));
  c.getPromptHistoryForCharacter = () => c.getHistory();
  c.getPromptSummaryForCharacter = () => "";
  let summaryCalls = 0;
  const summaryGate = deferred();
  const summaryStarted = deferred();
  c.checkAndSummarizeIfNeeded = async npc => {
    summaryCalls += 1;
    if (blockRewrite && Number(npc?.id) === 2 && summaryCalls > 1) {
      summaryStarted.resolve();
      await summaryGate.promise;
    }
    return { playerCenteredRecallEnabled: true, sourceSceneRevision: sceneRevision, tokenBudget: 1000 };
  };
  c.estimateTokenCount = messages => Math.ceil(JSON.stringify(messages).length / 4);
  c.recordCharacterDisclosures = () => {};
  c.retainDynamicSummaryRecall = () => {};

  const counts = { sendAttempts: 0, requests: 0, rewrites: 0, actions: 0, confirmations: 0, prompts: [] };
  let sourceValid = true;
  let allowRevoke = revokeSources;
  let partialStreamStarted;
  c.scheduleActionConfirmation = () => { counts.confirmations += 1; };
  Conversation.configure({
    memoryEngine: {
      trace: { record() {} },
      validatePlayerMemoryContext: () => ({ valid: sourceValid, reason: "FORGOTTEN" })
    },
    PromptBuilder: {
      buildMessagesWithTokenCount: history => ({ messages: history.map(({ role, content }) => ({ role, content })), blocks: [] }),
      getMemoryBlockTokenCount: () => 0
    },
    TokenCounter: { estimateTokens: text => Math.ceil(String(text).length / 4) },
    createPromptFingerprint: text => String(text),
    createMessage: fields => ({ ...fields, type: "message" }),
    createError: fields => ({ ...fields, type: "error" }),
    createActionFeedback: fields => ({ ...fields, type: "action-feedback" }),
    settingsRepository: {
      getActiveProviderConfig: () => ({ providerType: "openai-compatible" }),
      getGlobalStreamSetting: () => ["partial-failure", "cancel-partial"].includes(rewriteMode),
      getChatPromptV813Layout: () => false,
      getGenerateFollowingMessagesSetting: () => true,
      getPauseOnRegenerationSetting: () => false,
      getActionApprovalSettings: () => ({ pauseOnApproval: false })
    },
    llmManager: { async sendChatRequest(messages, signal, _noStream, metadata) {
      counts.sendAttempts += 1;
      const responderId = Number(metadata.responderId);
      const isRewrite = responderId === 2 && counts.requests >= 1;
      if (allowRevoke && isRewrite) sourceValid = false;
      metadata.beforeSendGuard();
      counts.requests += 1;
      counts.prompts.push(messages);
      if (isRewrite) counts.rewrites += 1;

      if (isRewrite && rewriteMode === "partial-failure" && counts.rewrites === 1) {
        return (async function* () {
          yield { delta: { content: "半截台词" } };
          throw new Error("synthetic stream failure");
        })();
      }
      if (isRewrite && rewriteMode === "cancel-partial" && counts.rewrites === 1) {
        partialStreamStarted = deferred();
        return (async function* () {
          yield { delta: { content: "半截台词" } };
          partialStreamStarted.resolve();
          await new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("AbortError: Message cancelled")), { once: true });
          });
          return { content: "已取消", finish_reason: "stop" };
        })();
      }
      const content = responderId === 3 ? "后续丙的回复。" : isRewrite ? "改写后的台词。" : "原始台词。";
      return { content, finish_reason: "stop" };
    } },
    ActionEngine: { async evaluateForCharacter(_conversation, npc) {
      counts.actions += 1;
      if (Number(npc.id) !== 2) return { autoApproved: [], needsApproval: [] };
      return { autoApproved: [{ actionId: "opinion", success: true,
        feedback: { message: "既有动作结果", sentiment: "neutral" }, lifecycle: "ACKNOWLEDGED" }], needsApproval: [] };
    } },
    usageAnalytics: { record() {} },
    logVerboseLLM() {}
  });
  return { c, firstNpc, nextNpc, counts, summaryGate, summaryStarted,
    waitForPartialStream() { return partialStreamStarted?.promise; } };
}

async function makeActionBearingReply(options = {}) {
  const fixture = conversationFixture(options);
  await fixture.c.respondAs(fixture.firstNpc);
  const original = fixture.c.messages.find(message => message.role === "assistant" && Number(message.speakerCharacterId) === 2);
  const feedback = fixture.c.messages.find(message => message.type === "action-feedback");
  assert(original && feedback, "fixture must contain a completed reply and action feedback");
  assert.equal(fixture.c.generationAttemptsByMessageId.get(original.id)?.hasActionOutcome, true,
    "the original reply must have a recorded action outcome");
  return { ...fixture, original, feedback };
}

async function testConcurrentRewriteAndLaterNpcReply() {
  const fixture = await makeActionBearingReply({ blockRewrite: true });
  const feedbackSnapshot = JSON.stringify(fixture.feedback);
  await fixture.c.respondAs(fixture.nextNpc);
  const laterReply = fixture.c.messages.find(message => message.role === "assistant" && Number(message.speakerCharacterId) === 3);
  assert(laterReply, "the later NPC must already have replied");
  const messagesBeforeRewrite = [...fixture.c.messages];

  const first = fixture.c.regenerateMessage(fixture.original.id);
  await fixture.summaryStarted.promise;
  const second = await fixture.c.regenerateMessage(fixture.original.id);
  assert.equal(second.success, false, "a concurrent click while narration rewrite is active must be rejected");
  fixture.summaryGate.resolve();
  const result = await first;

  assert.equal(result.success, true);
  assert.equal(fixture.original.content, "改写后的台词。");
  assert(fixture.c.messages.includes(fixture.original), "the original assistant message ID and object survive the rewrite");
  assert(fixture.c.messages.includes(laterReply), "a later NPC reply must remain in place");
  assert.equal(laterReply.content, "后续丙的回复。");
  assert.deepEqual(fixture.c.messages.filter(message => message.type === "action-feedback"),
    messagesBeforeRewrite.filter(message => message.type === "action-feedback"), "action feedback stays attached and unchanged");
  assert.equal(JSON.stringify(fixture.feedback), feedbackSnapshot);
  assert.equal(fixture.counts.requests, 3, "only the first rewrite request should be sent after the two original NPC requests");
  assert.equal(fixture.counts.actions, 2, "the rewrite must not evaluate an action; only the two original replies are evaluated");
  assert.equal(fixture.counts.confirmations, 1, "the existing ACK confirmation must not be scheduled again");
}

async function testPendingActionStatesRejectRewrite() {
  for (const state of ["approval", "evaluation"]) {
    const fixture = await makeActionBearingReply();
    if (state === "approval") {
      const approval = { id: fixture.c.nextId++, type: "action-approval", role: "system",
        associatedMessageId: fixture.original.id, action: { actionId: "gold_transfer" } };
      fixture.c.messages.push(approval);
      fixture.c.pendingActionApprovals.set(approval.id, { approvalEntryId: approval.id, npc: fixture.firstNpc });
    } else {
      fixture.c.generationAttemptsByMessageId.get(fixture.original.id).actionEvaluationPending = true;
    }
    const messageSnapshot = JSON.stringify(fixture.c.messages);
    const requestCount = fixture.counts.requests;
    const result = await fixture.c.regenerateMessage(fixture.original.id);
    assert.equal(result.success, false, `${state} state must block narration rewrite`);
    assert.equal(fixture.counts.requests, requestCount, `${state} state must block before Provider transport`);
    assert.equal(fixture.counts.actions, 1, `${state} state must not evaluate or dispatch another action`);
    assert.equal(JSON.stringify(fixture.c.messages), messageSnapshot, `${state} state must leave action/narration history intact`);
  }
}

async function testPartialStreamFailureKeepsNarrationAndRetryIsTextOnly() {
  const fixture = await makeActionBearingReply({ rewriteMode: "partial-failure" });
  const feedbackSnapshot = JSON.stringify(fixture.feedback);
  const result = await fixture.c.regenerateMessage(fixture.original.id);
  assert.equal(result.success, false);
  assert.equal(fixture.original.content, "原始台词。", "partial stream failure must not replace the original narration");
  const error = fixture.c.messages.find(message => message.type === "error");
  assert(error, "partial rewrite failure should leave a retryable error entry");
  assert.equal(fixture.c.generationAttemptsByMessageId.get(error.id)?.narrationRewriteOf, fixture.original.id,
    "the retry entry must point to the original narration target");
  assert.equal(JSON.stringify(fixture.feedback), feedbackSnapshot, "failed rewrite must preserve prior action feedback bytes");

  const retry = await fixture.c.regenerateError(error.id);
  assert.equal(retry.success, true, "retrying a failed narration rewrite must remain supported");
  assert.equal(fixture.original.content, "改写后的台词。");
  assert.equal(fixture.counts.actions, 1, "neither failed rewrite nor retry may re-evaluate actions");
  assert.equal(fixture.counts.confirmations, 1, "neither failed rewrite nor retry may schedule ACK confirmation again");
  assert.equal(fixture.c.messages.filter(message => message.type === "action-feedback").length, 1);
}

async function testCancellationAfterPartialStreamKeepsNarration() {
  const fixture = await makeActionBearingReply({ rewriteMode: "cancel-partial" });
  const feedbackSnapshot = JSON.stringify(fixture.feedback);
  const rewrite = fixture.c.regenerateMessage(fixture.original.id);
  await fixture.waitForPartialStream();
  fixture.c.cancelActiveResponse("explicit_abort");
  const result = await rewrite;
  assert.equal(result.success, false);
  assert.equal(fixture.original.content, "原始台词。", "cancellation after visible partial text must retain the original narration");
  assert.equal(fixture.c.messages.some(message => message.type === "error"), false,
    "an explicit cancellation must not create a failed-request error");
  assert.equal(JSON.stringify(fixture.feedback), feedbackSnapshot);
  assert.equal(fixture.counts.actions, 1);
  assert.equal(fixture.counts.confirmations, 1);
}

async function testStaleSceneAndDifferentPlayerTurnRejectRewrite() {
  const sceneFixture = await makeActionBearingReply();
  sceneFixture.c.gameData.scene = "scene-b";
  const sceneResult = await sceneFixture.c.regenerateMessage(sceneFixture.original.id);
  assert.equal(sceneResult.success, false, "a reply from another scene must not be rewritten");
  assert.equal(sceneFixture.c.messages.find(message => message.id === sceneFixture.original.id).content, "原始台词。");
  assert.equal(sceneFixture.counts.requests, 1, "a stale-scene rewrite must not reach transport");

  const playerFixture = await makeActionBearingReply();
  playerFixture.c.gameData.playerID = 4;
  playerFixture.c.gameData.characters.set(4, { id: 4, fullName: "新玩家丁", shortName: "丁" });
  playerFixture.c.messages.push({ id: 12, role: "user", speakerCharacterId: 4, content: "另一位玩家的新轮次。" });
  playerFixture.c.getTurnManager().startUserTurn({ playerMessageId: 12, activeParticipantIds: [2, 3, 4],
    playerCharacterId: 4, conversationId: playerFixture.c.id,
    sceneRevision: JSON.stringify(["scene-a", "room-a", 1]), campaignToken: playerFixture.c.gameData.campaignToken });
  const playerResult = await playerFixture.c.regenerateMessage(playerFixture.original.id);
  assert.equal(playerResult.success, false, "a reply from another player's turn must not be rewritten");
  assert.equal(playerFixture.c.messages.find(message => message.id === playerFixture.original.id).content, "原始台词。");
  assert.equal(playerFixture.counts.requests, 1, "a stale-player rewrite must not reach transport");
}

async function testWithdrawnSourceBlocksBeforeTransport() {
  const fixture = await makeActionBearingReply({ revokeSources: true });
  const feedbackSnapshot = JSON.stringify(fixture.feedback);
  const result = await fixture.c.regenerateMessage(fixture.original.id);
  assert.equal(result.success, false, "a source withdrawn after prompt assembly must block the rewrite");
  assert.equal(fixture.counts.sendAttempts, 2, "the request reaches the before-send gate");
  assert.equal(fixture.counts.requests, 1, "source withdrawal must block before Provider transport");
  assert.equal(fixture.original.content, "原始台词。");
  assert.equal(JSON.stringify(fixture.feedback), feedbackSnapshot);
  assert.equal(fixture.counts.actions, 1);
  assert.equal(fixture.counts.confirmations, 1);
}

// Pair facts require current source-bound marriage evidence; V9.6.1 includes
// legal spouses in the user's expanded family visibility policy.
const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { id: versionPath, filename: versionPath, loaded: true, exports: { MEMORY_ENGINE_VERSION: "3.0" } };
const { Character } = require("../src/app/main/game-data/character");
const { createGameData } = require("../src/app/main/game-data/game-data");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");

const tokenCounter = {
  estimateTokens: value => Math.ceil(String(value ?? "").length / 4),
  estimateMessageTokens: message => Math.ceil(String(message?.content ?? "").length / 4),
  calculateTotalTokens: messages => (messages || []).reduce((total, message) => total + Math.ceil(String(message?.content ?? "").length / 4), 0)
};
const GameData = createGameData({ fs, path, memorySystem: {}, summariesDir: "", getHistoricalReferenceByYear: () => null });
const promptBuilder = createPromptBuilder({
  TemplateEngine: class { renderTemplateString(template) { return String(template ?? ""); } },
  PromptScriptLoader: class {},
  promptConfigManager: { getDefaultMainTemplateContent: () => "", resolvePath: value => value },
  settingsRepository: {
    getPromptSettings: () => ({ mainTemplate: "independent kinship QA", blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true }
    ], suffix: { enabled: false } }),
    getChatPromptV89Settings: () => ({ chatPromptV89Layout: false }),
    getChatPromptV813Layout: () => true
  },
  path,
  TokenCounter: tokenCounter,
  createPromptFingerprint: value => String(value ?? ""),
  defaultChatInstruction: ""
});

function makeCharacter(id, name, age, gender = "male") {
  const row = Array(28).fill("");
  row[0] = String(id);
  row[1] = name;
  row[2] = name;
  row[4] = gender === "female" ? "she" : "he";
  row[5] = age == null ? "" : String(age);
  const character = new Character(row);
  character.ageSource = age == null ? null : "CK3_CURRENT_AGE";
  character.alive = true;
  return character;
}

function makePrompt(characters, { playerId, responderId = playerId } = {}) {
  const player = characters.find(character => Number(character.id) === Number(playerId));
  const responder = characters.find(character => Number(character.id) === Number(responderId));
  const gameData = new GameData([playerId, player.fullName, responderId, responder.fullName,
    "1190年5月2日", "___________talk_scene", "", "", 106575]);
  gameData.date = "1190年5月2日";
  gameData.totalDays = 106575;
  gameData.campaignToken = "qa-public-kinship-campaign";
  gameData.relationFingerprint = "qa-public-kinship-revision";
  gameData.characters = new Map(characters.map(character => [Number(character.id), character]));
  const result = promptBuilder.buildMessagesWithTokenCount([{ role: "user", content: "谈谈你们的关系。" }], responder,
    gameData, "", { activeParticipantIds: characters.map(character => Number(character.id)), subjectiveWorldPolicyActive: true,
      // Relationship-label fixtures explicitly know names; NAME grants no age or kinship permission.
      disclosureProfiles: new Map(characters.map(character => [Number(character.id), [{ factType: "NAME", value: character.firstName || character.shortName,
        ownerId: Number(responderId), entityId: Number(character.id), campaignToken: gameData.campaignToken,
        current: true, effectiveKnown: true, status: "AUTO_DISCLOSED", firstAcquiredDate: gameData.date }]])),
      cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() } });
  const relationshipBlock = result.blocks.find(entry => entry.block?.id === "live-relationships")?.content
    || result.blocks.find(entry => entry.block?.id === "active-participant-relationship")?.content || "";
  return { relationshipBlock, promptText: result.messages.map(message => message.content).join("\n") };
}

function addPublicParent(child, parent, campaignToken = "qa-public-kinship-campaign") {
  child.parents.push({ id: parent.id, name: parent.fullName, gender: parent.gender,
    source: "CK3_DIRECT_PARENT", sourceOwnerId: child.id, childId: child.id, relationType: "parent", sourceRelation: "parents",
    publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN", campaignToken,
    sourceSnapshotId: `1190年5月2日/106575`, evidenceConflict: false });
}

function testPublicCurrentSpousePath() {
  const husband = makeCharacter(1, "丈夫甲", 35, "male");
  const wife = makeCharacter(2, "妻子乙", 33, "female");
  wife.traits = [{ name: "brave" }, { name: "beauty_good_1" }];
  addPublicSpouse(husband, wife);
  addPublicSpouse(wife, husband);
  const prompt = makePrompt([husband, wife], { playerId: husband.id, responderId: wife.id });
  assert.match(prompt.relationshipBlock, /丈夫甲是妻子乙的丈夫/u, JSON.stringify(prompt.relationshipBlock));
  assert.match(prompt.relationshipBlock, /妻子乙是丈夫甲的妻子/u,
    "a current public spouse edge must keep its legal pair title through the kinship path ACL");

  const traitAccess = getAutomaticTraitAccess(husband, wife, {
    date: "1190年5月2日", totalDays: 106575, campaignToken: "qa-public-kinship-campaign",
    characters: new Map([[husband.id, husband], [wife.id, wife]])
  }, { activeParticipantIds: [husband.id, wife.id] });
  assert.equal(traitAccess.source, "PUBLIC_CLOSE_FAMILY",
    "a current verified legal spouse belongs to the expanded family policy");
  assert.deepEqual(traitAccess.traitKeys, ["trait_brave", "trait_beauty_good_1"],
    "verified legal spouses know personality and appearance under the V9.6.1 policy");
}

function addPublicSpouse(owner, spouse, overrides = {}) {
  owner.spouses.push({
    id: spouse.id, name: spouse.fullName, gender: spouse.gender,
    relationType: "CURRENT_SPOUSE", source: "CK3_GAME_CURRENT_SPOUSE",
    sourceOwnerId: owner.id, relatedCharacterId: owner.id, observerRuntimeId: owner.id,
    sourceRelation: "spouses", evidenceScope: "SOURCE_OWNER_RECORD_ONLY",
    publicStatus: "PUBLIC_LEGAL_MARRIAGE", knowledgeStatus: "UNKNOWN",
    campaignToken: "qa-public-kinship-campaign", sourceSnapshotId: "1190年5月2日/106575",
    evidenceConflict: false, targetBound: true, ...overrides
  });
}

function testSpousePathRejectsUntrustedEvidence() {
  const staleSnapshot = "1190年5月2日/106574";
  const cases = [
    ["wrong campaign", { campaignToken: "qa-other-campaign" }],
    ["stale snapshot", { sourceSnapshotId: staleSnapshot }],
    ["secret source", { publicStatus: "SECRET", knowledgeStatus: "SECRET" }]
  ];
  for (const [label, evidence] of cases) {
    const husband = makeCharacter(1, "丈夫甲", 35, "male");
    const wife = makeCharacter(2, "妻子乙", 33, "female");
    addPublicSpouse(husband, wife, evidence);
    addPublicSpouse(wife, husband, evidence);
    const prompt = makePrompt([husband, wife], { playerId: husband.id, responderId: wife.id });
    assert.doesNotMatch(prompt.relationshipBlock, /丈夫甲是妻子乙的丈夫|妻子乙是丈夫甲的妻子/u,
      `${label} spouse evidence must not pass the public relationship path ACL: ${JSON.stringify(prompt.relationshipBlock)}`);
  }
}

function testAuntUncleSeniorityUsesThePublicParentPath() {
  const child = makeCharacter(1, "孩子甲", 12, "male");
  const uncle = makeCharacter(2, "伯父乙", 55, "male");
  const father = makeCharacter(3, "父亲丙", 50, "male");
  const grandparent = makeCharacter(4, "祖父丁", 75, "male");
  addPublicParent(child, father);
  addPublicParent(father, grandparent);
  addPublicParent(uncle, grandparent);
  uncle.siblings.push({ id: father.id, name: father.fullName, gender: "male" });
  father.siblings.push({ id: uncle.id, name: uncle.fullName, gender: "male" });
  const prompt = makePrompt([child, uncle, father, grandparent], { playerId: child.id, responderId: child.id });
  assert.match(prompt.relationshipBlock, /伯父乙是孩子甲的伯父/u,
    `a child can use the public aunt/uncle path and its source parent to distinguish 伯父 from 叔父: ${JSON.stringify(prompt.relationshipBlock)}`);
}

function testUnrelatedResponderDoesNotReceiveRelativeAge() {
  const child = makeCharacter(1, "孩子甲", 12, "male");
  const outsider = makeCharacter(2, "旁观者乙", 40, "male");
  const uncle = makeCharacter(3, "伯父丙", 55, "male");
  const father = makeCharacter(4, "父亲丁", 50, "male");
  const grandparent = makeCharacter(5, "祖父戊", 75, "male");
  addPublicParent(child, father);
  addPublicParent(father, grandparent);
  addPublicParent(uncle, grandparent);
  uncle.siblings.push({ id: father.id, name: father.fullName, gender: "male" });
  father.siblings.push({ id: uncle.id, name: uncle.fullName, gender: "male" });
  const prompt = makePrompt([child, outsider, uncle, father, grandparent], { playerId: child.id, responderId: outsider.id });
  assert.doesNotMatch(prompt.relationshipBlock, /长幼：|年长于|(?:12|40|50|55|75)岁/u,
    "a current public relationship graph does not give an unrelated responder derived age facts");
}

async function capture(name, test) {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    failures.push({ name, error });
  }
}

const failures = [];
(async () => {
  await capture("concurrent rewrite and later NPC reply", testConcurrentRewriteAndLaterNpcReply);
  await capture("pending action approval/evaluation", testPendingActionStatesRejectRewrite);
  await capture("partial stream failure and narration-only retry", testPartialStreamFailureKeepsNarrationAndRetryIsTextOnly);
  await capture("cancellation after partial stream", testCancellationAfterPartialStreamKeepsNarration);
  await capture("stale scene and different player turn", testStaleSceneAndDifferentPlayerTurnRejectRewrite);
  await capture("withdrawn source before transport", testWithdrawnSourceBlocksBeforeTransport);
  await capture("public spouse path ACL and expanded family traits", testPublicCurrentSpousePath);
  await capture("spouse path rejects wrong campaign, stale snapshot, and secret evidence", testSpousePathRejectsUntrustedEvidence);
  await capture("aunt/uncle seniority knowledge", testAuntUncleSeniorityUsesThePublicParentPath);
  await capture("unrelated responder age privacy", testUnrelatedResponderDoesNotReceiveRelativeAge);
  if (failures.length) {
    process.exitCode = 1;
    console.error(`${failures.length} independent QA case(s) failed.`);
    for (const { name, error } of failures) console.error(`${name}: ${error.stack || error}`);
    return;
  }
  console.log("V9.3.9.3 independent QA: PASS");
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
