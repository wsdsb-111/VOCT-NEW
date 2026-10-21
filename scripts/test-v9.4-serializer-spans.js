"use strict";

const assert = require("node:assert/strict");
const { serializePromptPlan } = require("../src/app/main/prompts/prompt-plan-serializer.js");
const { fingerprint } = require("../src/app/main/prompts/prompt-plan-contract.js");

function makePlan() {
  const sharedFields = { cache_control: { type: "ephemeral" } };
  const blocks = [
    makeBlock("cache-anchor", "GLOBAL_STATIC", "STATIC", [
      { role: "system", content: "STATIC ANCHOR|fictional", ...sharedFields }
    ]),
    makeBlock("history-window", "APPEND_ONLY_HISTORY", "APPEND_ONLY", [
      { role: "user", content: "DUPLICATE|same bytes" },
      { role: "assistant", content: "DUPLICATE|same bytes" },
      { role: "assistant", name: "Synthetic Narrator", content: "line 1\n\nline 2 | preserve separators" }
    ]),
    makeBlock("shared-prefix-left", "GLOBAL_STATIC", "STATIC", [
      { role: "system", content: "左侧🙂", ...sharedFields }
    ]),
    makeBlock("shared-prefix-right", "CONVERSATION_FROZEN", "FROZEN", [
      { role: "system", content: "右侧", ...sharedFields }
    ]),
    makeBlock("empty-message", "DYNAMIC_WORLDLINE", "DYNAMIC", [
      { role: "system", content: "" }
    ]),
    makeBlock("current-turn", "CURRENT_TURN", "DYNAMIC", [
      { role: "user", content: "CURRENT QUESTION|fixture only" }
    ])
  ];
  blocks.forEach((block, order) => {
    block.order = order;
    refreshBlockFingerprint(block);
  });

  return {
    schemaVersion: "prompt_plan_v9_1",
    planId: "synthetic-serializer-spans-v1",
    requestType: "chat",
    layoutId: "v813",
    promptProfileId: "synthetic-profile",
    layoutRevision: "v9_4_compat_1",
    scope: {
      campaignToken: "synthetic-campaign",
      conversationId: "synthetic-conversation",
      ownerId: 41002,
      responderId: 31001,
      playerId: 41002,
      conversationEpoch: 1,
      logicalTurnEpoch: 2,
      sourceSnapshotId: "synthetic-snapshot"
    },
    providerRoute: { providerType: "synthetic", modelId: "synthetic-model", routeKind: "chat" },
    inputRevisions: {
      promptSettings: "synthetic-prompt-r1",
      conversation: "synthetic-conversation-r1",
      memory: "synthetic-memory-r1",
      knowledge: "synthetic-knowledge-r1",
      worldline: "synthetic-worldline-r1",
      source: "synthetic-source-r1"
    },
    blocks,
    messageGroups: [
      { parts: [{ blockId: "cache-anchor", index: 0 }], separator: "" },
      { parts: [{ blockId: "history-window", index: 0 }], separator: "" },
      { parts: [{ blockId: "history-window", index: 1 }], separator: "" },
      { parts: [{ blockId: "history-window", index: 2 }], separator: "" },
      {
        parts: [
          { blockId: "shared-prefix-left", index: 0 },
          { blockId: "shared-prefix-right", index: 0 }
        ],
        separator: "\n\n"
      },
      { parts: [{ blockId: "empty-message", index: 0 }], separator: "" },
      { parts: [{ blockId: "current-turn", index: 0 }], separator: "" }
    ],
    budget: {
      configuredContextTokens: 8192,
      effectiveInputBudgetTokens: 6000,
      reservedOutputTokens: 1024,
      safetyMarginTokens: 64,
      estimatedInputTokens: 90,
      memoryBudgetTokens: 1200
    },
    diagnostics: { onlyOpaqueFingerprints: true, planFingerprint: "synthetic-plan-fingerprint", lifecycleCounts: {} }
  };
}

function makeBlock(id, kind, lifecycleState, messages) {
  const block = {
    id,
    kind,
    legacyBlockId: id,
    role: messages[0]?.role || "system",
    content: messages.map(({ content }) => content).join("\n\n"),
    order: 10,
    permission: {
      status: "AUTHORIZED",
      ownerId: 41002,
      campaignToken: "synthetic-campaign",
      sourceRefs: [`synthetic:${id}`],
      authorizedAtRevision: "synthetic-auth-r1",
      visibility: "RESPONDER_ONLY"
    },
    lifecycle: { state: lifecycleState, freezeScope: "SYNTHETIC_FIXTURE", invalidationRevision: "synthetic-r1" },
    cache: { stableCandidate: lifecycleState === "STATIC", contentFingerprint: "", prefixEligible: lifecycleState === "STATIC" },
    tokens: { estimated: 5, source: "LOCAL_ESTIMATE" },
    messages
  };
  refreshBlockFingerprint(block);
  return block;
}

function refreshBlockFingerprint(block) {
  block.cache.contentFingerprint = fingerprint([block.content, block.messages]);
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
  return value;
}

function serialize(plan, layoutId = "v813", profileId = "synthetic-profile") {
  return serializePromptPlan(plan, { layoutId, profileId });
}

function spanFor(result, blockId) {
  const matches = result.messageSpans.filter((span) => span.blockId === blockId);
  assert.equal(matches.length, 1, `${blockId}: must have one explicit aggregate span`);
  return matches[0];
}

function metadataFor(result, blockId) {
  const matches = result.blockMetadata.filter((entry) => entry.id === blockId);
  assert.equal(matches.length, 1, `${blockId}: must have one metadata entry`);
  return matches[0];
}

const plan = freezeDeep(makePlan());
const before = JSON.stringify(plan);
const result = serialize(plan);
const repeated = serialize(plan);
assert.deepEqual(result, repeated, "serialization must be deterministic for the same immutable Plan and layout");
assert.equal(JSON.stringify(plan), before, "serializer must not mutate its Plan input");
assert.equal(result.messages.length, plan.messageGroups.length, "every declared physical group becomes exactly one message");
assert.equal(result.serializedFingerprint, repeated.serializedFingerprint);
assert.equal(typeof result.serializedFingerprint, "string");
assert(result.serializedFingerprint.length > 0);

assert.deepEqual(result.messages.map(({ role, content }) => ({ role, content })), [
  { role: "system", content: "STATIC ANCHOR|fictional" },
  { role: "user", content: "DUPLICATE|same bytes" },
  { role: "assistant", content: "DUPLICATE|same bytes" },
  { role: "assistant", content: "line 1\n\nline 2 | preserve separators" },
  { role: "system", content: "左侧🙂\n\n右侧" },
  { role: "system", content: "" },
  { role: "user", content: "CURRENT QUESTION|fixture only" }
], "physical messages follow explicit group order and preserve role, duplicate bodies, and embedded separators");
assert.equal(result.messages[0].cache_control.type, "ephemeral", "single-part groups preserve non-content message fields");

assert.deepEqual(spanFor(result, "cache-anchor"), {
  blockId: "cache-anchor", start: 0, end: 1,
  contributions: [{ messagePosition: 0, partIndex: 0, startOffset: 0, endOffset: "STATIC ANCHOR|fictional".length }]
});
assert.deepEqual(spanFor(result, "history-window"), {
  blockId: "history-window", start: 1, end: 4,
  contributions: [
    { messagePosition: 1, partIndex: 0, startOffset: 0, endOffset: "DUPLICATE|same bytes".length },
    { messagePosition: 2, partIndex: 1, startOffset: 0, endOffset: "DUPLICATE|same bytes".length },
    { messagePosition: 3, partIndex: 2, startOffset: 0, endOffset: "line 1\n\nline 2 | preserve separators".length }
  ]
});
assert.deepEqual(spanFor(result, "shared-prefix-left"), {
  blockId: "shared-prefix-left", start: 4, end: 5,
  contributions: [{ messagePosition: 4, partIndex: 0, startOffset: 0, endOffset: "左侧🙂".length }]
});
assert.deepEqual(spanFor(result, "shared-prefix-right"), {
  blockId: "shared-prefix-right", start: 4, end: 5,
  contributions: [{ messagePosition: 4, partIndex: 0, startOffset: "左侧🙂\n\n".length, endOffset: "左侧🙂\n\n右侧".length }]
});
assert.deepEqual(spanFor(result, "empty-message"), {
  blockId: "empty-message", start: 5, end: 6,
  contributions: [{ messagePosition: 5, partIndex: 0, startOffset: 0, endOffset: 0 }]
});
assert.deepEqual(spanFor(result, "current-turn"), {
  blockId: "current-turn", start: 6, end: 7,
  contributions: [{ messagePosition: 6, partIndex: 0, startOffset: 0, endOffset: "CURRENT QUESTION|fixture only".length }]
});

const expectedParts = plan.messageGroups.flatMap((group, messagePosition) =>
  group.parts.map((part, groupPartPosition) => ({ ...part, messagePosition, groupPartPosition })));
const actualParts = result.messageSpans.flatMap((span) => span.contributions.map((contribution) => ({
  blockId: span.blockId,
  index: contribution.partIndex,
  messagePosition: contribution.messagePosition,
  groupPartPosition: plan.messageGroups[contribution.messagePosition].parts.findIndex(part =>
    part.blockId === span.blockId && part.index === contribution.partIndex)
})));
assert.deepEqual(
  actualParts.slice().sort((a, b) => `${a.blockId}:${a.index}`.localeCompare(`${b.blockId}:${b.index}`)),
  expectedParts.map((part) => ({ blockId: part.blockId, index: part.index, messagePosition: part.messagePosition, groupPartPosition: part.groupPartPosition }))
    .sort((a, b) => `${a.blockId}:${a.index}`.localeCompare(`${b.blockId}:${b.index}`)),
  "each declared part must be attributed exactly once, including duplicate-text and empty-content parts"
);
for (let position = 0; position < result.messages.length; position += 1) {
  assert(result.messageSpans.some((span) => span.contributions.some((contribution) => contribution.messagePosition === position)),
    `physical message ${position} must have at least one explicit block contribution`);
}

const anchorMetadata = metadataFor(result, "cache-anchor");
assert.equal(anchorMetadata.kind, "GLOBAL_STATIC");
assert.equal(anchorMetadata.lifecycle, "STATIC", "metadata must report lifecycle state separately from semantic kind");
assert.equal(typeof anchorMetadata.fingerprint, "string");
assert(anchorMetadata.fingerprint.length > 0);
const frozenMetadata = metadataFor(result, "shared-prefix-right");
assert.equal(frozenMetadata.kind, "CONVERSATION_FROZEN");
assert.equal(frozenMetadata.lifecycle, "FROZEN", "frozen metadata must retain its lifecycle state");

const changedPlan = JSON.parse(JSON.stringify(plan));
const changedTurn = changedPlan.blocks.find(({ id }) => id === "current-turn");
changedTurn.messages[0].content += "|changed";
changedTurn.content += "|changed";
refreshBlockFingerprint(changedTurn);
const changedOutput = serialize(changedPlan);
assert.notEqual(changedOutput.serializedFingerprint, result.serializedFingerprint,
  "serialized identity must change when outbound message bytes change");

function expectReject(label, mutate) {
  const invalid = makePlan();
  mutate(invalid);
  assert.throws(() => serialize(invalid), undefined, `${label}: malformed Plan must be rejected before messages escape`);
}

expectReject("duplicate block id", (invalid) => {
  invalid.blocks.push({ ...invalid.blocks[0], messages: [] });
});
expectReject("duplicate use of one part", (invalid) => {
  invalid.messageGroups.splice(2, 0, { parts: [{ blockId: "history-window", index: 0 }] });
});
expectReject("unreferenced nonempty part", (invalid) => {
  invalid.messageGroups.pop();
});
expectReject("unknown block id", (invalid) => {
  invalid.messageGroups.push({ parts: [{ blockId: "unknown-block", index: 0 }] });
});
expectReject("unknown message index", (invalid) => {
  invalid.messageGroups[0].parts[0].index = 99;
});
expectReject("multi-part role mismatch", (invalid) => {
  const block = invalid.blocks.find(({ id }) => id === "shared-prefix-right");
  block.messages[0].role = "assistant";
  refreshBlockFingerprint(block);
});
expectReject("multi-part non-content field mismatch", (invalid) => {
  const block = invalid.blocks.find(({ id }) => id === "shared-prefix-right");
  block.messages[0].cache_control = { type: "different" };
  refreshBlockFingerprint(block);
});
expectReject("missing groups", (invalid) => {
  invalid.messageGroups = [];
});

console.log("PASS V9.4 PromptPlan serializer spans (explicit mapping, deterministic pure serialization, and malformed-group rejection)");
