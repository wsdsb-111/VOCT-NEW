"use strict";

const assert = require("node:assert/strict");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { ConversationTurnManager } = require("../src/app/main/conversation/conversation-turn-manager");
const { GenerationManager } = require("../src/app/main/conversation/generation-manager");
const { classifyThirdPersonHistoryRequest, resolveActiveMemoryPairs, resolveTrustedPlayerTurn }
  = require("../src/app/main/memory-system/pair-memory-routing");

const PLAYER_ID = 1;
const CAMPAIGN = "regen-fixture-campaign";
const SCENE = "regen-fixture-scene";
const LOCATION = "regen-fixture-location";

function sceneRevision(gameData) {
  return JSON.stringify([gameData.scene || null, gameData.location || null, gameData.locationController || null]);
}

function createConversation({ messages, conversationId = "regen-fixture-conversation", playerSpeakerId = PLAYER_ID } = {}) {
  const conversation = Object.create(Conversation.prototype);
  conversation.id = conversationId;
  conversation.gameData = {
    playerID: PLAYER_ID,
    scene: SCENE,
    location: LOCATION,
    locationController: null,
    campaignToken: CAMPAIGN
  };
  conversation.messages = messages.map(message => ({ ...message }));
  conversation.npcQueue = [];
  conversation.isPaused = false;
  conversation.generationAttemptsByMessageId = new Map();
  conversation.memoryAttemptDiagnosticsByOwner = new Map();
  conversation.emitUpdate = () => {};
  conversation.getNpcList = () => [
    { id: 3, fullName: "同名角色", shortName: "丙" },
    { id: 2, fullName: "同名角色", shortName: "乙" },
    { id: 4, fullName: "甲的旧回应者", shortName: "甲" }
  ];
  conversation.processQueue = epoch => { conversation.processedQueueEpoch = epoch; };
  conversation.pauseConversation = () => { conversation.isPaused = true; };
  conversation.resumeConversation = () => { conversation.resumed = true; };

  const turnManager = new ConversationTurnManager(conversation);
  const generationManager = new GenerationManager(conversation);
  conversation.runtime = { turnManager, generationManager };
  conversation.turnManager = turnManager;
  conversation.generationManager = generationManager;
  const playerMessage = conversation.messages.find(message => message.role === "user");
  const turn = turnManager.startUserTurn({
    playerMessageId: playerMessage.id,
    activeParticipantIds: [PLAYER_ID, 2, 3, 4],
    playerCharacterId: PLAYER_ID,
    conversationId,
    sceneRevision: sceneRevision(conversation.gameData),
    campaignToken: CAMPAIGN
  });
  for (const message of conversation.messages) {
    if (message.role !== "assistant") continue;
    conversation.generationAttemptsByMessageId.set(message.id, {
      logicalPlayerMessageId: playerMessage.id,
      turnEpoch: turn.epoch,
      responderId: Number(message.speakerCharacterId),
      hasActionOutcome: false
    });
  }
  return conversation;
}

function makePlayerMessage(id = 10, speakerCharacterId = PLAYER_ID) {
  return { id, role: "user", speakerCharacterId, content: "你以前和玛蒂尔达具体谈过什么？" };
}

function trustedRoute(conversation, history = conversation.messages) {
  const turn = conversation.getTurnManager().currentTurn;
  return resolveActiveMemoryPairs({
    ownerId: 2,
    history,
    activeParticipantIds: turn.activeParticipantIds,
    playerId: PLAYER_ID,
    trustedPlayerId: PLAYER_ID,
    currentPlayerMessageId: turn.playerMessageId,
    turnEpoch: turn.epoch,
    conversationId: conversation.id,
    sceneRevision: sceneRevision(conversation.gameData)
  });
}

async function withoutExpectedRejectionLogs(operation) {
  const oldError = console.error;
  const oldLog = console.log;
  console.error = () => {};
  console.log = () => {};
  try {
    await operation();
  } finally {
    console.error = oldError;
    console.log = oldLog;
  }
}

async function testRegenerationPreservesAnchorAndQueue() {
  const conversation = createConversation({ messages: [
    makePlayerMessage(),
    { id: 11, role: "assistant", speakerCharacterId: 4, name: "甲", content: "旧回应 A" },
    { id: 12, role: "assistant", speakerCharacterId: 2, name: "同名角色", content: "旧回应 B" },
    { id: 13, role: "assistant", speakerCharacterId: 3, name: "同名角色", content: "旧回应 C" }
  ] });
  const oldTurn = conversation.getTurnManager().currentTurn;
  const beforeRoute = trustedRoute(conversation, conversation.messages.slice(0, 2));
  assert.equal(beforeRoute.trustedPlayerTurn?.messageId, 10);
  assert.equal(beforeRoute.trustedPlayerTurn?.content, conversation.messages[0].content);

  Conversation.configure({ settingsRepository: {
    getGenerateFollowingMessagesSetting: () => true,
    getPauseOnRegenerationSetting: () => false
  } });
  await conversation.regenerateMessage(12);

  let currentTurn = conversation.getTurnManager().currentTurn;
  assert.equal(currentTurn.playerMessageId, oldTurn.playerMessageId, "regeneration must keep the original logical player message");
  assert.equal(currentTurn.epoch, oldTurn.epoch + 1, "regeneration must create a new physical attempt epoch");
  assert.equal(currentTurn.logicalTurnEpoch, oldTurn.logicalTurnEpoch, "regeneration must preserve the logical turn epoch");
  assert.equal(conversation.messages.filter(message => message.role === "user").length, 1,
    "regeneration must not synthesize another user message");
  assert.deepEqual(conversation.messages.map(message => message.id), [10, 11],
    "regenerating B must retain the earlier responder and remove B plus later responses");
  assert.deepEqual(conversation.npcQueue.map(character => Number(character.id)), [2, 3],
    "responder identity must use numeric speaker IDs and preserve the later response queue");
  assert.equal(currentTurn.regenerateOfByResponder[2], 12);
  assert.equal(currentTurn.regenerateOfByResponder[3], 13);

  for (let index = 0; index < 4; index += 1) {
    currentTurn = conversation.getTurnManager().startRegenerationTurn({
      playerMessageId: currentTurn.playerMessageId,
      playerCharacterId: PLAYER_ID,
      conversationId: conversation.id,
      sceneRevision: sceneRevision(conversation.gameData),
      campaignToken: CAMPAIGN
    });
  }
  assert.equal(currentTurn.epoch, oldTurn.epoch + 5, "five physical attempts must each advance the attempt epoch");
  assert.equal(currentTurn.logicalTurnEpoch, oldTurn.logicalTurnEpoch,
    "five physical attempts must still reference one logical player turn");

  const afterRoute = trustedRoute(conversation);
  assert.equal(afterRoute.trustedPlayerTurn?.messageId, beforeRoute.trustedPlayerTurn.messageId);
  assert.equal(afterRoute.trustedPlayerTurn?.turnEpoch, currentTurn.epoch,
    "the original user message must be revalidated for the new attempt epoch");
  assert.equal(afterRoute.query, beforeRoute.query);

  conversation.messages.push(makePlayerMessage(20));
  const nextTurn = conversation.getTurnManager().startUserTurn({
    playerMessageId: 20,
    activeParticipantIds: [PLAYER_ID, 2, 3, 4],
    playerCharacterId: PLAYER_ID,
    conversationId: conversation.id,
    sceneRevision: sceneRevision(conversation.gameData),
    campaignToken: CAMPAIGN
  });
  assert.equal(nextTurn.epoch, currentTurn.epoch + 1);
  assert.equal(nextTurn.logicalTurnEpoch, currentTurn.logicalTurnEpoch + 1,
    "a new user message, rather than regeneration, advances the logical turn epoch");
}

async function testStaleAndUntrustedAnchorsAreRejected() {
  Conversation.configure({ settingsRepository: {
    getGenerateFollowingMessagesSetting: () => false,
    getPauseOnRegenerationSetting: () => false
  } });

  const oldTurn = createConversation({ messages: [
    makePlayerMessage(10),
    { id: 11, role: "assistant", speakerCharacterId: 2, content: "旧轮回应" },
    makePlayerMessage(20),
    { id: 21, role: "assistant", speakerCharacterId: 2, content: "新轮回应" }
  ] });
  const oldPlayerTurn = oldTurn.getTurnManager().currentTurn;
  oldTurn.getTurnManager().startUserTurn({
    playerMessageId: 20,
    activeParticipantIds: [PLAYER_ID, 2],
    playerCharacterId: PLAYER_ID,
    conversationId: oldTurn.id,
    sceneRevision: sceneRevision(oldTurn.gameData),
    campaignToken: CAMPAIGN
  });
  oldTurn.generationAttemptsByMessageId.set(11, {
    logicalPlayerMessageId: 10,
    turnEpoch: oldPlayerTurn.epoch,
    responderId: 2,
    hasActionOutcome: false
  });
  const oldIds = oldTurn.messages.map(message => message.id);
  const oldEpoch = oldTurn.turnEpoch;
  await withoutExpectedRejectionLogs(() => oldTurn.regenerateMessage(11));
  assert.deepEqual(oldTurn.messages.map(message => message.id), oldIds, "a prior user turn must not be regenerated under a newer turn");
  assert.equal(oldTurn.turnEpoch, oldEpoch);

  const wrongSpeaker = createConversation({ messages: [
    makePlayerMessage(10, 99),
    { id: 11, role: "assistant", speakerCharacterId: 2, content: "回应" }
  ] });
  const wrongSpeakerIds = wrongSpeaker.messages.map(message => message.id);
  await withoutExpectedRejectionLogs(() => wrongSpeaker.regenerateMessage(11));
  assert.deepEqual(wrongSpeaker.messages.map(message => message.id), wrongSpeakerIds,
    "a user message with a mismatched speaker ID must not authorize regeneration");

  const changedScene = createConversation({ messages: [
    makePlayerMessage(),
    { id: 11, role: "assistant", speakerCharacterId: 2, content: "回应" }
  ] });
  const changedSceneIds = changedScene.messages.map(message => message.id);
  const changedSceneEpoch = changedScene.turnEpoch;
  changedScene.gameData.scene = "different-scene";
  await withoutExpectedRejectionLogs(() => changedScene.regenerateMessage(11));
  assert.deepEqual(changedScene.messages.map(message => message.id), changedSceneIds,
    "a changed scene must not reuse the old attempt authorization");
  assert.equal(changedScene.turnEpoch, changedSceneEpoch);

  const changedCampaign = createConversation({ messages: [
    makePlayerMessage(),
    { id: 11, role: "assistant", speakerCharacterId: 2, content: "回应" }
  ] });
  const changedCampaignIds = changedCampaign.messages.map(message => message.id);
  changedCampaign.gameData.campaignToken = "different-campaign";
  await withoutExpectedRejectionLogs(() => changedCampaign.regenerateMessage(11));
  assert.deepEqual(changedCampaign.messages.map(message => message.id), changedCampaignIds,
    "a changed campaign must not reuse the old attempt authorization");

  const changedConversation = createConversation({ messages: [
    makePlayerMessage(),
    { id: 11, role: "assistant", speakerCharacterId: 2, content: "回应" }
  ] });
  const changedConversationIds = changedConversation.messages.map(message => message.id);
  changedConversation.id = "different-conversation";
  await withoutExpectedRejectionLogs(() => changedConversation.regenerateMessage(11));
  assert.deepEqual(changedConversation.messages.map(message => message.id), changedConversationIds,
    "a changed conversation ID must not reuse the old attempt authorization");
}

async function testLiveAttemptIsAbortedAndSideEffectTailIsPreserved() {
  Conversation.configure({ settingsRepository: {
    getGenerateFollowingMessagesSetting: () => false,
    getPauseOnRegenerationSetting: () => false
  } });
  const live = createConversation({ messages: [
    makePlayerMessage(),
    { id: 11, role: "assistant", speakerCharacterId: 2, content: "", isStreaming: true }
  ] });
  const responseState = live.getGenerationManager().start({
    turnEpoch: live.turnEpoch,
    messageId: 11,
    npcId: 2
  });
  live.generationAttemptsByMessageId.set(11, {
    logicalPlayerMessageId: 10,
    turnEpoch: live.turnEpoch,
    responderId: 2,
    hasActionOutcome: false
  });
  await live.regenerateMessage(11);
  assert.equal(responseState.controller.signal.aborted, true, "the old physical response must be aborted before replacement");
  assert.equal(live.getTurnManager().currentTurn.playerMessageId, 10);
  assert.equal(live.turnEpoch, responseState.turnEpoch + 1);

  const withEvent = createConversation({ messages: [
    makePlayerMessage(),
    { id: 11, role: "assistant", speakerCharacterId: 2, content: "回应" },
    { id: 12, type: "action-feedback", associatedMessageId: 11, feedbacks: [] }
  ] });
  const eventIds = withEvent.messages.map(message => message.id);
  const eventEpoch = withEvent.turnEpoch;
  await withoutExpectedRejectionLogs(() => withEvent.regenerateMessage(11));
  assert.deepEqual(withEvent.messages.map(message => message.id), eventIds,
    "a regeneration tail containing a side-effect event must be preserved intact");
  assert.equal(withEvent.turnEpoch, eventEpoch);
}

async function testProviderErrorRetryRetainsLogicalTurn() {
  const conversation = createConversation({ messages: [
    makePlayerMessage(),
    { id: 11, type: "error", content: "Failed to get response from 乙", responderCharacterId: 2 }
  ] });
  conversation.generationAttemptsByMessageId.set(11, {
    logicalPlayerMessageId: 10,
    turnEpoch: conversation.turnEpoch,
    responderId: 2,
    hasActionOutcome: false
  });
  const logicalEpoch = conversation.getTurnManager().currentTurn.logicalTurnEpoch;
  await conversation.regenerateError(11);
  assert.deepEqual(conversation.messages.map(message => message.id), [10], "retry removes only the safe provider error entry");
  assert.equal(conversation.npcQueue[0].id, 2);
  assert.equal(conversation.getTurnManager().currentTurn.playerMessageId, 10);
  assert.equal(conversation.getTurnManager().currentTurn.logicalTurnEpoch, logicalEpoch);
  assert.equal(conversation.getTurnManager().currentTurn.regenerateOfByResponder[2], 11);
  assert.equal(conversation.resumed, true);
}

function testHistoryFollowupSurvivesPhysicalRegeneration() {
  const conversationId = "followup-regen-fixture";
  const revision = "followup-scene-revision";
  const initialHistory = [{ ...makePlayerMessage(10), content: "你以前和玛蒂尔达关系如何？" }];
  const initialTurn = resolveTrustedPlayerTurn({
    history: initialHistory,
    playerAnchorId: PLAYER_ID,
    currentPlayerMessageId: 10,
    turnEpoch: 2,
    logicalTurnEpoch: 2,
    conversationId,
    sceneRevision: revision
  });
  const initialDecision = classifyThirdPersonHistoryRequest({
    trustedPlayerTurn: initialTurn,
    ownerId: 2,
    playerAnchorId: PLAYER_ID,
    resolvedTargets: [{ characterId: 3, evidence: "UNIQUE_ALIAS" }]
  });
  assert.equal(initialDecision.level, "L1", "the explicit historical relation query should establish a bounded binding");

  const binding = {
    responderId: 2,
    playerAnchorId: PLAYER_ID,
    targetCharacterIds: [3],
    authorizedTurnEpoch: 2,
    expiresAfterTurnEpoch: 3,
    authorizedLogicalTurnEpoch: 2,
    conversationId,
    sceneRevision: revision
  };
  const followupHistory = [
    initialHistory[0],
    { id: 20, role: "user", speakerCharacterId: PLAYER_ID, content: "那后来呢？" }
  ];
  const followupTurn = resolveTrustedPlayerTurn({
    history: followupHistory,
    playerAnchorId: PLAYER_ID,
    currentPlayerMessageId: 20,
    turnEpoch: 3,
    logicalTurnEpoch: 3,
    conversationId,
    sceneRevision: revision
  });
  const firstFollowup = classifyThirdPersonHistoryRequest({ trustedPlayerTurn: followupTurn,
    ownerId: 2, playerAnchorId: PLAYER_ID, conversationBinding: binding });
  assert.equal(firstFollowup.level, "L1");
  assert.equal(firstFollowup.targetEvidence, "BOUND_FOLLOWUP");

  const regeneratedTurn = resolveTrustedPlayerTurn({
    history: followupHistory,
    playerAnchorId: PLAYER_ID,
    currentPlayerMessageId: 20,
    turnEpoch: 8,
    logicalTurnEpoch: 3,
    conversationId,
    sceneRevision: revision
  });
  const regeneratedFollowup = classifyThirdPersonHistoryRequest({ trustedPlayerTurn: regeneratedTurn,
    ownerId: 2, playerAnchorId: PLAYER_ID, conversationBinding: binding });
  assert.equal(regeneratedFollowup.level, "L1",
    "a physical regeneration must preserve the binding for the same logical follow-up turn");
  assert.equal(regeneratedFollowup.targetEvidence, "BOUND_FOLLOWUP");
  assert.equal(regeneratedFollowup.targetCharacterIds[0], 3);

  const nextLogicalTurn = { ...regeneratedTurn, logicalTurnEpoch: 4 };
  const expired = classifyThirdPersonHistoryRequest({ trustedPlayerTurn: nextLogicalTurn,
    ownerId: 2, playerAnchorId: PLAYER_ID, conversationBinding: binding });
  assert.equal(expired.level, "L0", "a real next logical turn must not inherit the expiring follow-up binding");
}

async function runRegenerateConsistencyChecks() {
  await testRegenerationPreservesAnchorAndQueue();
  await testStaleAndUntrustedAnchorsAreRejected();
  await testLiveAttemptIsAbortedAndSideEffectTailIsPreserved();
  await testProviderErrorRetryRetainsLogicalTurn();
  testHistoryFollowupSurvivesPhysicalRegeneration();
  return [
    { id: "REGEN-ANCHOR-QUEUE", status: "PASS" },
    { id: "R05-R07-R12-FAIL-CLOSED", status: "PASS" },
    { id: "R03-STALE-ABORT", status: "PASS" },
    { id: "REGEN-PROVIDER-ERROR-RETRY", status: "PASS" },
    { id: "REGEN-FOLLOWUP-LOGICAL-BOUNDARY", status: "PASS" },
    { id: "REGEN-SIDE-EFFECT-TAIL", status: "PASS" }
  ];
}

if (require.main === module) {
  runRegenerateConsistencyChecks().then(checks => {
    console.log(JSON.stringify({ status: "PASS", checks }, null, 2));
  }).catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { runRegenerateConsistencyChecks };
