"use strict";

const assert = require("assert");
const judge = require("../resources/app/out/main/action-system/social/social-consequence-judge");

const estimateTokens = (value) => Math.ceil(String(value || "").length / 4);
const fingerprint = (value) => {
  let hash = 0;
  for (const character of String(value || "")) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash.toString(16);
};
judge.configure({
  TokenCounter: {
    estimateTokens,
    estimateMessageTokens: (message) => estimateTokens(message.content)
  },
  createPromptFingerprint: fingerprint
});

function context(messageText, relation = "朋友") {
  const directParticipants = [
    { id: 1, name: "李思昭", isPlayer: true },
    { id: 2, name: "李思念", isPlayer: false }
  ];
  const observerParticipants = [3, 4, 5, 6].map((id) => ({ id, name: `旁观者${id}`, isPlayer: false }));
  const dialogueEvidence = [{
    evidenceId: "dialogue:100",
    type: "dialogue",
    sourceMessageId: 100,
    actorId: 2,
    targetId: 1,
    content: messageText,
    confidence: 1,
    worldStateConfirmed: false
  }];
  return {
    conversationId: "precision-test",
    turnEpoch: 3,
    gateReason: "social_signal",
    message: { id: 100, role: "assistant", name: "李思念", content: messageText, actorId: 2, targetId: 1 },
    directParticipants,
    observerParticipants,
    relationshipStates: [{ sourceCharacterId: 2, targetCharacterId: 1, relations: [relation] }],
    opinionStates: [{ sourceCharacterId: 2, targetCharacterId: 1, value: 12 }],
    dialogueEvidence,
    confirmedWorldEvents: [],
    memoryEvidence: [{
      evidenceId: "memory:long",
      type: "memory",
      sourceMessageId: 100,
      actorId: 2,
      content: "往事".repeat(900),
      confidence: 0.9,
      worldStateConfirmed: false
    }],
    gameFacts: [],
    knowledgeMap: Object.fromEntries([...directParticipants, ...observerParticipants].map((item) => [item.id, {
      "dialogue:100": { known: true, basis: "current_dialogue" },
      "memory:long": { known: item.id === 2, basis: "memory" }
    }])),
    recentDialogue: [
      { id: 97, role: "user", name: "李思昭", content: "近来可好？" },
      { id: 98, role: "assistant", name: "李思念", content: "一切安好。" },
      { id: 99, role: "user", name: "李思昭", content: "我很欣慰。" }
    ],
    recentConsequences: []
  };
}

const contextA = context("多谢你相助，此恩难忘。", "朋友");
const contextB = context("你这个卑鄙小人！", "仇敌");
const a = judge.buildMessages(contextA);
const b = judge.buildMessages(contextB);
assert.strictEqual(a.length, 6);
assert.strictEqual(a[0].content.startsWith("VOTC_SOCIAL_CONSEQUENCE_V1"), true);
assert.strictEqual(a[0].content, b[0].content);
assert.strictEqual(a[1].content, b[1].content);
assert.strictEqual(a.at(-1).content.includes("当前消息"), true);
assert.strictEqual(a.some((message) => message.content.includes("完整 Conversation History")), false);

const schema = judge.buildSchema(contextA);
assert.strictEqual(schema.properties.opinionChanges.maxItems, 2);
assert.strictEqual(schema.properties.observerEffects.maxItems, 2);
assert.deepStrictEqual(schema.properties.opinionChanges.items.properties.sourceCharacterId.enum, [1, 2, 3, 4, 5, 6]);
assert(schema.properties.relationshipTransition.anyOf.some((item) => item.type === "null"));

const emptyOutput = { content: '{"socialImpact":false,"opinionChanges":[],"relationshipTransition":null,"observerEffects":[]}' };
assert.strictEqual(judge.parseResult(emptyOutput, contextA).socialImpact, false);

const validChange = {
  sourceCharacterId: 2,
  targetCharacterId: 1,
  delta: 2,
  confidence: 0.9,
  reason: "明确感谢",
  reasonCluster: "gratitude",
  evidenceId: "dialogue:100"
};
const validOutput = { content: JSON.stringify({ socialImpact: true, opinionChanges: [validChange], relationshipTransition: null, observerEffects: [] }) };
assert.strictEqual(judge.parseResult(validOutput, contextA).socialImpact, true);

const malformedId = { content: JSON.stringify({ socialImpact: true, opinionChanges: [{ ...validChange, sourceCharacterId: 999 }], relationshipTransition: null, observerEffects: [] }) };
assert.strictEqual(judge.parseResult(malformedId, contextA).socialImpact, false);

const fifthOpinion = { content: JSON.stringify({
  socialImpact: true,
  opinionChanges: [validChange, validChange],
  relationshipTransition: null,
  observerEffects: [validChange, validChange, validChange]
}) };
assert.strictEqual(judge.parseResult(fifthOpinion, contextA).socialImpact, false);

const unknownAction = { content: JSON.stringify({
  socialImpact: true,
  opinionChanges: [],
  relationshipTransition: {
    actionId: "becomeEmperorWith",
    sourceCharacterId: 2,
    targetCharacterId: 1,
    confidence: 0.99,
    reason: "错误动作",
    reasonCluster: "unknown",
    evidenceId: "dialogue:100"
  },
  observerEffects: []
}) };
assert.strictEqual(judge.parseResult(unknownAction, contextA).socialImpact, false);
assert.strictEqual(judge.parseResult({ content: "not json" }, contextA).socialImpact, false);
assert.strictEqual(judge.parseResult({ content: JSON.stringify({ socialImpact: true, opinionChanges: [{ ...validChange, confidence: 0.79 }], relationshipTransition: null, observerEffects: [] }) }, contextA).socialImpact, false);

const blocksA = judge.getPromptBlocks(a, schema);
const blocksB = judge.getPromptBlocks(b, judge.buildSchema(contextB));
assert.strictEqual(blocksA[0].fingerprint, blocksB[0].fingerprint);
assert.strictEqual(blocksA[1].fingerprint, blocksB[1].fingerprint);
const evidenceBlockTokens = estimateTokens(a[3].content);
assert.strictEqual(evidenceBlockTokens <= 256 + 80, true, `memory evidence block must stay near the 256-token payload boundary (actual ${evidenceBlockTokens})`);
assert.strictEqual(blocksA.reduce((sum, block) => sum + block.tokens, 0) <= 1800, true, "six-person Social Judge input must stay within 1800 estimated tokens");

let providerCalls = 0;
let capturedMetadata = null;
const llmManager = {
  async sendActionsRequest(messages, requestId, sentSchema, signal, metadata) {
    providerCalls++;
    assert.strictEqual(requestId, "votc_social_consequence_v1");
    assert.strictEqual(messages[0].content, a[0].content);
    assert.strictEqual(sentSchema.properties.opinionChanges.maxItems, 2);
    assert.strictEqual(signal, "signal");
    capturedMetadata = metadata;
    return validOutput;
  }
};

(async () => {
  const performance = await judge.judge({ context: contextA, llmManager, signal: "signal", mode: "performance" });
  assert.strictEqual(performance.socialImpact, false);
  assert.strictEqual(providerCalls, 0);

  const precision = await judge.judge({ context: contextA, llmManager, signal: "signal", mode: "precision" });
  assert.strictEqual(precision.socialImpact, true);
  assert.strictEqual(providerCalls, 1);
  assert.strictEqual(capturedMetadata.actionStage, "social_consequence_judge");
  assert.strictEqual(capturedMetadata.actionSystemMode, "precision");
  assert.strictEqual(capturedMetadata.participantCount, 6);
  assert(Array.isArray(capturedMetadata.blocks));

  const failed = await judge.judge({ context: contextA, llmManager: { sendActionsRequest: async () => { throw new Error("timeout"); } }, mode: "precision" });
  assert.strictEqual(failed.socialImpact, false, "provider failures must fail closed");
  console.log("VOTC v7.9.2 Social Consequence Precision Judge: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
