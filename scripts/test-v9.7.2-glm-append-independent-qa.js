"use strict";

const assert = require("node:assert/strict");
const { makeConversation } = require("./test-v9.4-conversation-plan-main-chain");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { createEffectiveRequestSnapshot, fingerprintMessages } = require("../src/app/main/providers/effective-request");
const { prepareGlmAppendLayout, REVISION } = require("../src/app/main/prompts/glm-append-layout");
const { planSeal } = require("../src/app/main/prompts/prompt-plan-contract");

const config = {
  providerType: "zhipu",
  defaultModel: "glm-5.3-flash",
  defaultParameters: { max_tokens: 128 },
  glmClearThinking: true
};

function makeState() {
  const state = makeConversation();
  const { conversation, fixture } = state;
  conversation.glmAppendReceipts = new Map();
  conversation.evaluateCompletedActions = async () => {};
  conversation.isCharacterAvailableForConversation = () => true;

  const requests = [];
  let responseMode = "complete";
  const llmManager = {
    async sendChatRequest(messages, _signal, _noStream, metadata) {
      assert.deepEqual(messages, metadata.promptPlanProof.serialized.messages,
        "the transport receives the exact current serialized plan");
      const snapshot = createEffectiveRequestSnapshot({
        requestType: metadata.requestType,
        providerType: config.providerType,
        protocol: "openai_chat_completions",
        endpoint: "https://fixture.invalid/v1/chat/completions",
        stream: false,
        payload: { model: config.defaultModel, messages, stream: false, max_tokens: 128 },
        adapterInputMessagesFingerprint: fingerprintMessages(messages),
        planStatus: "PROMPT_PLAN_V9",
        ownerEvidence: "PRESENT"
      });
      const checked = metadata.beforeTransportGuard(snapshot, metadata.promptPlanProof, { safe: true });
      assert.equal(checked.ok, true, `synthetic transport proof must pass: ${JSON.stringify(checked)}`);
      requests.push({ messages: structuredClone(messages), metadata, requestType: metadata.requestType });

      if (responseMode === "cancel") {
        conversation.cancelActiveResponse("fixture_cancel");
        return { content: "CANCELLED FIXTURE", finish_reason: "stop" };
      }
      if (responseMode === "error") throw new Error("synthetic transport failure");
      if (responseMode === "truncate" && metadata.requestType === "chat") {
        return { content: "PARTIAL FIXTURE", finish_reason: "length" };
      }
      return {
        content: metadata.requestType === "chat_continuation" ? "CONTINUED FIXTURE" : "COMPLETE FIXTURE",
        finish_reason: "stop"
      };
    }
  };

  Conversation.configure({
    settingsRepository: {
      getActiveProviderConfig: () => config,
      getGlobalStreamSetting: () => false,
      getChatPromptV813Layout: () => true,
      getActionApprovalSettings: () => ({ pauseOnApproval: false }),
      getCK3DebugLogPath: () => ""
    },
    llmManager,
    memoryEngine: {
      trace: { record() {} },
      ensureConversationState: () => conversation.memoryState,
      validatePlayerMemoryContext: () => ({ valid: true, reason: null }),
      invalidateConversationRecallState() {}
    }
  });

  const startUserTurn = (participantIds, content) => {
    const highestId = conversation.messages.reduce((max, message) =>
      Number.isSafeInteger(message?.id) ? Math.max(max, message.id) : max, conversation.nextId - 1);
    const playerMessageId = highestId + 1;
    conversation.nextId = playerMessageId + 1;
    conversation.messages.push({ id: playerMessageId, role: "user",
      speakerCharacterId: fixture.gameData.playerID, content: content ?? `PLAYER TURN ${playerMessageId}` });
    conversation.getTurnManager().startUserTurn({
      playerMessageId,
      activeParticipantIds: [fixture.gameData.playerID, ...participantIds],
      playerCharacterId: fixture.gameData.playerID,
      conversationId: conversation.id,
      sceneRevision: JSON.stringify([fixture.gameData.scene || null, fixture.gameData.location || null,
        fixture.gameData.locationController || null]),
      campaignToken: fixture.gameData.campaignToken
    });
  };

  return {
    conversation,
    fixture,
    runtime: state.runtime,
    requests,
    startUserTurn,
    setResponseMode(mode) { responseMode = mode; }
  };
}

function assertInstructionTail(request, receipt) {
  const { plan, serialized } = request.metadata.promptPlanProof;
  const blocks = new Map(plan.blocks.map(block => [block.id, block]));
  const historyPositions = [];
  const instructionPositions = [];
  for (const [position, group] of plan.messageGroups.entries()) {
    const legacyTypes = group.parts.map(part => blocks.get(part.blockId)?.legacyType);
    if (legacyTypes.some(type => ["history", "current_user"].includes(type))) historyPositions.push(position);
    if (legacyTypes.includes("instruction")) instructionPositions.push(position);
  }
  assert(historyPositions.length > 0 && instructionPositions.length > 0,
    "the fixture contains history and a response instruction");
  assert(Math.max(...historyPositions) < Math.min(...instructionPositions),
    "every history message, including another NPC's latest reply, remains before the instruction tail");
  const tail = request.messages.slice(-receipt.tailCount);
  assert(tail.some(message => String(message.content).includes("FINAL INSTRUCTION|")),
    "the configured response instruction remains in the sticky tail");
  assert(tail.some(message => String(message.content).includes("SUFFIX END")),
    "the configured suffix remains in the sticky tail");
  assert.deepEqual(serialized.messages.slice(-receipt.tailCount), tail,
    "the exact current plan suffix is sent at the end");
}

async function run() {
  const state = makeState();
  const { conversation, fixture, runtime, requests, startUserTurn } = state;
  const a = fixture.responder;

  await conversation.respondAs(a, conversation.turnEpoch);
  const receiptA = conversation.glmAppendReceipts.get(a.id);
  assert(receiptA, "a complete response commits A's receipt");
  const firstA = requests.at(-1).messages;

  startUserTurn([a.id]);
  await conversation.respondAs(a, conversation.turnEpoch);
  const receiptA2 = conversation.glmAppendReceipts.get(a.id);
  assert(receiptA2, "A's next complete response commits an updated receipt");
  const secondA = requests.at(-1).messages;
  const reusablePrefixLength = firstA.length - receiptA.tailCount;
  assert.deepEqual(secondA.slice(0, reusablePrefixLength), firstA.slice(0, reusablePrefixLength),
    "A's strictly appended history preserves the exact earlier wire prefix");

  const b = { ...a, id: 31002 };
  fixture.gameData.characters.set(b.id, b);
  const aCurrentCanonical = runtime.PromptBuilder.buildMessagesWithTokenCount(
    conversation.getPromptHistoryForCharacter(a.id), a, fixture.gameData,
    conversation.getPromptSummaryForCharacter(a.id), fixture.memoryContext, config,
    { promptPlanScope: { campaignToken: fixture.gameData.campaignToken, conversationId: conversation.id,
      ownerId: a.id, responderId: a.id, playerId: Number(fixture.gameData.playerID),
      conversationEpoch: conversation.conversationEpoch, logicalTurnEpoch: conversation.turnEpoch } }
  );
  const bScopedEquivalentPlan = { ...aCurrentCanonical.promptPlan,
    scope: { ...aCurrentCanonical.promptPlan.scope, ownerId: b.id, responderId: b.id },
    blocks: aCurrentCanonical.promptPlan.blocks.map(block => ({ ...block,
      permission: { ...block.permission, ownerId: b.id } })),
    diagnostics: { ...aCurrentCanonical.promptPlan.diagnostics } };
  bScopedEquivalentPlan.diagnostics.planFingerprint = planSeal(bScopedEquivalentPlan);
  const bScopedEquivalentBuild = { ...aCurrentCanonical, promptPlan: bScopedEquivalentPlan };
  const crossResponderCandidate = prepareGlmAppendLayout(bScopedEquivalentBuild, config, receiptA2);
  assert.equal(crossResponderCandidate.build.glmAppendLayoutApplied, false,
    "identical current messages cannot make A's receipt valid for B");
  assert.equal(crossResponderCandidate.receipt.nonHistoryKey, receiptA2.nonHistoryKey,
    "the responder scope check is exercised with identical non-history messages");
  assert.notEqual(crossResponderCandidate.receipt.scopeKey, receiptA2.scopeKey,
    "the responder identity changes the receipt scope");

  const bCanonical = runtime.PromptBuilder.buildMessagesWithTokenCount(
    conversation.getPromptHistoryForCharacter(b.id), b, fixture.gameData,
    conversation.getPromptSummaryForCharacter(b.id), fixture.memoryContext, config,
    { promptPlanScope: { campaignToken: fixture.gameData.campaignToken, conversationId: conversation.id,
      ownerId: b.id, responderId: b.id, playerId: Number(fixture.gameData.playerID),
      conversationEpoch: conversation.conversationEpoch, logicalTurnEpoch: conversation.turnEpoch } }
  );
  conversation.glmAppendReceipts.set(b.id, receiptA2); // Deliberately simulate a responder-keying mistake.
  await conversation.respondAs(b, conversation.turnEpoch);
  const bRequest = requests.at(-1);
  const receiptB = conversation.glmAppendReceipts.get(b.id);
  assert.equal(bRequest.metadata.responderId, b.id);
  assert.equal(bRequest.metadata.promptPlanProof.plan.scope.ownerId, b.id);
  assert.equal(bRequest.metadata.promptPlanProof.plan.scope.responderId, b.id);
  assert(bRequest.metadata.promptPlanProof.plan.blocks.every(block => block.permission.ownerId === b.id),
    "B's prompt retains only current B-scoped permission records");
  assert.notEqual(receiptB.scopeKey, receiptA2.scopeKey, "B receives a responder-scoped receipt");
  assert.deepEqual(bRequest.messages, bCanonical.messages, "B's wrong-slot receipt falls back to B's canonical plan");
  assertInstructionTail(bRequest, receiptB);
  const historyMessages = bRequest.metadata.promptPlanProof.serialized.messageSpans
    .filter(span => ["history", "current_user"].includes(
      bRequest.metadata.promptPlanProof.plan.blocks.find(block => block.id === span.blockId)?.legacyType))
    .flatMap(span => span.contributions.map(contribution => bRequest.messages[contribution.messagePosition]));
  assert.equal(historyMessages.at(-1)?.role, "assistant", "the tail case ends on A's latest reply before B's instruction");
  assert(String(historyMessages.at(-1)?.content).includes("COMPLETE FIXTURE"));

  startUserTurn([a.id, b.id]);
  state.setResponseMode("cancel");
  await conversation.respondAs(b, conversation.turnEpoch);
  assert.equal(conversation.glmAppendReceipts.has(b.id), false, "cancelled generation consumes but does not commit a receipt");

  startUserTurn([a.id, b.id]);
  state.setResponseMode("complete");
  await conversation.respondAs(b, conversation.turnEpoch);
  assert(conversation.glmAppendReceipts.has(b.id), "a later complete turn can establish a fresh receipt");

  startUserTurn([a.id, b.id]);
  state.setResponseMode("error");
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await conversation.respondAs(b, conversation.turnEpoch);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(conversation.glmAppendReceipts.has(b.id), false, "provider failure does not commit a receipt");

  startUserTurn([a.id, b.id]);
  state.setResponseMode("complete");
  await conversation.respondAs(b, conversation.turnEpoch);
  assert(conversation.glmAppendReceipts.has(b.id), "a successful response establishes a receipt before continuation case");
  startUserTurn([a.id, b.id]);
  state.setResponseMode("truncate");
  const beforeContinuation = requests.length;
  await conversation.respondAs(b, conversation.turnEpoch);
  assert.deepEqual(requests.slice(beforeContinuation).map(request => request.requestType), ["chat", "chat_continuation"],
    "truncated generation uses the continuation request path");
  assert.equal(conversation.glmAppendReceipts.has(b.id), false, "continuation does not commit a receipt");

  const receipt = receiptA2;
  conversation.glmAppendReceipts.set(a.id, receipt);
  conversation.clearHistory();
  assert.equal(conversation.glmAppendReceipts.size, 0, "clearHistory discards all responder receipts");
  conversation.glmAppendReceipts.set(a.id, receipt);
  conversation.end();
  assert.equal(conversation.glmAppendReceipts.size, 0, "end discards all responder receipts");

  console.log("PASS V9.7.2 GLM append independent QA: A prefix, A-to-B receipt isolation, sticky instruction/suffix, cancel/error/continuation commit guards and clear/end");
}

async function runConfirmedActionTail() {
  const { conversation, fixture, requests, startUserTurn } = makeState();
  const npc = fixture.responder;
  fixture.promptSettings.blocks.find(block => block.type === "examples").enabled = false;
  const getMemory = conversation.checkAndSummarizeIfNeeded;
  conversation.checkAndSummarizeIfNeeded = async (...args) => ({
    ...await getMemory(...args), confirmedActionText: conversation.getConfirmedActionContextFor(npc.id)
  });

  await conversation.respondAs(npc, conversation.turnEpoch);
  const first = requests.at(-1);
  const receipt = conversation.glmAppendReceipts.get(npc.id);
  assert(receipt);
  conversation.messages.push({ id: conversation.nextId++, type: "action-feedback", feedbacks: [
    { lifecycle: { status: "CONFIRMED" }, diagnostic: {
      confirmedStateChange: { type: "GOLD_TRANSFER", sourceRuntimeId: npc.id, targetRuntimeId: fixture.gameData.playerID, amount: 42 },
      stateAfter: { sourceGold: 112, targetGold: 159 }
    } },
    { lifecycle: { status: "ACKNOWLEDGED" }, diagnostic: {
      confirmedStateChange: { type: "GOLD_TRANSFER", amount: 9000 }
    } }
  ] });
  startUserTurn([npc.id], "你伯父是谁？");
  await conversation.respondAs(npc, conversation.turnEpoch);
  const second = requests.at(-1);
  const reusableLength = first.messages.length - receipt.tailCount;
  assert.deepEqual(second.messages.slice(0, reusableLength), first.messages.slice(0, reusableLength));
  assert.equal(second.metadata.promptPlanProof.plan.layoutRevision, REVISION);
  const action = second.metadata.promptPlanProof.serialized.messageSpans.find(span => span.blockId === "action-confirmed-context");
  assert.match(second.messages[action.start].content, /支付 42 金；核验后余额 112 \/ 159/);
  const family = second.metadata.promptPlanProof.serialized.messageSpans.find(span => span.blockId === "responder-family-facts");
  assert(family && family.start >= reusableLength, "the real family query emits its current facts in the refreshed tail");
  assert(!second.messages.some(message => message.content.includes("支付 9000 金")));
  const secondReceipt = conversation.glmAppendReceipts.get(npc.id);
  assertInstructionTail(second, secondReceipt);

  startUserTurn([npc.id], "换个话题。");
  await conversation.respondAs(npc, conversation.turnEpoch);
  const third = requests.at(-1);
  const nextReusableLength = second.messages.length - secondReceipt.tailCount;
  assert.deepEqual(third.messages.slice(0, nextReusableLength), second.messages.slice(0, nextReusableLength));
  assert(!third.metadata.promptPlanProof.plan.blocks.some(block => block.id === "responder-family-facts"),
    "a new topic removes the previous family facts from the wire");
  console.log(`PASS V9.8.4 action and family tails through Conversation and transport guards (${reusableLength} then ${nextReusableLength} reused messages)`);
}

if (require.main === module) run().then(runConfirmedActionTail).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
