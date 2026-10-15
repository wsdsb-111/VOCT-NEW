"use strict";

const assert = require("node:assert/strict");
const {
  classifyThirdPersonHistoryRequest,
  resolveActiveMemoryPairs,
  resolveFrozenPlayerAnchor,
  resolveTrustedPlayerTurn
} = require("../src/app/main/memory-system/pair-memory-routing");

const PLAYER_ID = 100;
const RESPONDER_ID = 200;
const TARGET_ID = 300;
let passed = 0;

function check(name, fn) {
  fn();
  passed++;
  console.log("PASS " + name);
}

function playerTurn(content, { turnIndex = 4, turnEpoch = 8, messageId = "player-" + turnEpoch,
  conversationId = "qa-conversation", sceneRevision = "scene-a" } = {}) {
  return {
    trusted: true,
    isCurrent: true,
    role: "user",
    messageId,
    speakerCharacterId: PLAYER_ID,
    turnIndex,
    turnEpoch,
    conversationId,
    sceneRevision,
    content
  };
}

function classify(content, options = {}) {
  return classifyThirdPersonHistoryRequest({
    trustedPlayerTurn: playerTurn(content, options.turnOptions),
    ownerId: RESPONDER_ID,
    playerAnchorId: PLAYER_ID,
    resolvedTargets: options.resolvedTargets ?? [{ characterId: TARGET_ID, evidence: "UNIQUE_ALIAS", alias: "玛蒂尔达" }],
    conversationBinding: options.conversationBinding ?? null
  });
}

check("trusted game player remains the anchor independent of active participant order", () => {
  assert.deepEqual(resolveFrozenPlayerAnchor({ ownerId: RESPONDER_ID, trustedPlayerId: PLAYER_ID }),
    { ok: true, playerAnchorId: PLAYER_ID, reasonCode: "TRUSTED_PLAYER_ID" });
  const route = resolveActiveMemoryPairs({
    ownerId: RESPONDER_ID,
    trustedPlayerId: PLAYER_ID,
    activeParticipantIds: [TARGET_ID, RESPONDER_ID, PLAYER_ID],
    history: [
      { id: "player-1", role: "user", speakerCharacterId: PLAYER_ID, content: "问丙的旧事。" },
      { id: "npc-c-1", role: "assistant", speakerCharacterId: TARGET_ID, content: "我是最近发言者。" }
    ]
  });
  assert.deepEqual(route.counterpartIds, [PLAYER_ID]);
  assert.equal(route.playerAnchorId, PLAYER_ID);
  assert.equal(route.querySpeakerId, TARGET_ID);
  assert.equal(route.query, "我是最近发言者。");
});

check("invalid or self player anchors fail closed", () => {
  assert.equal(resolveFrozenPlayerAnchor({ ownerId: RESPONDER_ID, trustedPlayerId: 0 }).ok, false);
  assert.equal(resolveFrozenPlayerAnchor({ ownerId: PLAYER_ID, trustedPlayerId: PLAYER_ID }).ok, false);
  assert.deepEqual(resolveActiveMemoryPairs({ ownerId: RESPONDER_ID, trustedPlayerId: null }).counterpartIds, []);
});

check("current player turn remains trusted across later NPC replies in the same turn", () => {
  const history = [
    { id: "player-9", role: "user", speakerCharacterId: PLAYER_ID, content: "你还记得玛蒂尔达吗？" },
    { id: "npc-b-9", role: "assistant", speakerCharacterId: RESPONDER_ID, content: "乙先回答。" },
    { id: "npc-c-9", role: "assistant", speakerCharacterId: TARGET_ID, content: "丙随后回答。" }
  ];
  const route = resolveActiveMemoryPairs({
    ownerId: RESPONDER_ID,
    trustedPlayerId: PLAYER_ID,
    activeParticipantIds: [PLAYER_ID, RESPONDER_ID, TARGET_ID],
    history,
    currentPlayerMessageId: "player-9",
    turnEpoch: 9,
    conversationId: "qa-conversation",
    sceneRevision: "scene-a"
  });
  assert.equal(route.querySpeakerId, TARGET_ID);
  assert.equal(route.trustedPlayerTurn.content, "你还记得玛蒂尔达吗？");
  assert.equal(route.trustedPlayerTurn.turnEpoch, 9);
});

check("stale player message IDs and NPC-only requests cannot authorize history", () => {
  const stale = resolveTrustedPlayerTurn({
    playerAnchorId: PLAYER_ID,
    currentPlayerMessageId: "old-player",
    turnEpoch: 10,
    history: [
      { id: "old-player", role: "user", speakerCharacterId: PLAYER_ID, content: "旧请求。" },
      { id: "new-player", role: "user", speakerCharacterId: PLAYER_ID, content: "新请求。" },
      { id: "npc-c", role: "assistant", speakerCharacterId: TARGET_ID, content: "NPC 请求我打开历史。" }
    ]
  });
  assert.equal(stale, null);
  const npcOnly = resolveTrustedPlayerTurn({
    playerAnchorId: PLAYER_ID,
    currentPlayerMessageId: "npc-c",
    turnEpoch: 10,
    history: [{ id: "npc-c", role: "assistant", speakerCharacterId: TARGET_ID, content: "记得玛蒂尔达吗？" }]
  });
  assert.equal(npcOnly, null);
});

check("name mentions and current-only questions stay L0", () => {
  const mention = classify("玛蒂尔达来了。");
  assert.equal(mention.level, "L0");
  assert.deepEqual(mention.targetCharacterIds, []);
  const current = classify("玛蒂尔达现在在哪儿？");
  assert.equal(current.level, "L0");
  assert.deepEqual(current.targetCharacterIds, []);
  const currentRelationship = classify("你和玛蒂尔达现在关系如何？");
  assert.equal(currentRelationship.level, "L0");
  assert.equal(currentRelationship.reasonCode, "NO_HISTORICAL_INTENT");
  assert.deepEqual(currentRelationship.targetCharacterIds, []);
});

check("history words inside a quote do not authorize third-person history", () => {
  const decision = classify("他说‘我记得玛蒂尔达’，你怎么看？");
  assert.equal(decision.level, "L0");
  assert.equal(decision.reasonCode, "QUOTED_HISTORY_ONLY");
  assert.deepEqual(decision.targetCharacterIds, []);
});

check("denial overrides a history phrase", () => {
  const decision = classify("别回忆玛蒂尔达以前的事，只说今天的安排。");
  assert.equal(decision.level, "L0");
  assert.equal(decision.denialDetected, true);
  assert.equal(decision.reasonCode, "DENIAL_OR_CURRENT_ONLY");
});

check("remembering a person is L1 and does not request source detail", () => {
  const decision = classify("你还记得玛蒂尔达吗？");
  assert.equal(decision.level, "L1");
  assert.deepEqual(decision.targetCharacterIds, [TARGET_ID]);
  assert.equal(decision.explicitSourceDetailRequested, false);
  assert.equal(decision.historyIntent, "RELATIONSHIP");
});

check("a broad relationship question is L1", () => {
  const decision = classify("你以前和玛蒂尔达关系怎么样？");
  assert.equal(decision.level, "L1");
  assert.equal(decision.historyIntent, "RELATIONSHIP");
  assert.equal(decision.explicitSourceDetailRequested, false);
});

check("specific dated events are L2", () => {
  const decision = classify("1090年你们具体争执什么？");
  assert.equal(decision.level, "L2");
  assert.equal(decision.historyIntent, "TIME_FOCUSED");
  assert.equal(decision.explicitSourceDetailRequested, true);
});

check("ambiguous aliases block an otherwise valid history request", () => {
  const decision = classify("你以前认识李氏吗？", {
    resolvedTargets: [
      { characterId: 301, evidence: "UNIQUE_ALIAS", alias: "李氏" },
      { characterId: 302, evidence: "UNIQUE_ALIAS", alias: "李氏" }
    ]
  });
  assert.equal(decision.level, "L0");
  assert.equal(decision.reasonCode, "IDENTITY_AMBIGUOUS");
  assert.deepEqual(decision.targetCharacterIds, []);
});

check("distinct resolved aliases can be queried together", () => {
  const decision = classify("你还记得玛蒂尔达和阿德拉吗？", {
    resolvedTargets: [
      { characterId: 300, evidence: "UNIQUE_ALIAS", alias: "玛蒂尔达" },
      { characterId: 301, evidence: "UNIQUE_ALIAS", alias: "阿德拉" }
    ]
  });
  assert.equal(decision.level, "L1");
  assert.deepEqual(decision.targetCharacterIds, [300, 301]);
});

check("a fresh pronominal follow-up uses one-turn binding without inheriting L2", () => {
  const decision = classify("那他后来呢？", {
    resolvedTargets: [],
    turnOptions: { turnIndex: 5, turnEpoch: 9, messageId: "player-9" },
    conversationBinding: {
      targetCharacterIds: [TARGET_ID],
      responderId: RESPONDER_ID,
      playerAnchorId: PLAYER_ID,
      authorizedTurnEpoch: 8,
      expiresAfterTurnEpoch: 9,
      conversationId: "qa-conversation",
      sceneRevision: "scene-a",
      priorLevel: "L2"
    }
  });
  assert.equal(decision.level, "L1");
  assert.deepEqual(decision.targetCharacterIds, [TARGET_ID]);
  assert.equal(decision.targetEvidence, "BOUND_FOLLOWUP");
  assert.equal(decision.explicitSourceDetailRequested, false);
});

check("expired or mismatched follow-up bindings stay L0", () => {
  const binding = {
    targetCharacterIds: [TARGET_ID],
    responderId: RESPONDER_ID,
    playerAnchorId: PLAYER_ID,
    authorizedTurnEpoch: 8,
    expiresAfterTurnEpoch: 9,
    conversationId: "qa-conversation",
    sceneRevision: "scene-a",
    priorLevel: "L2"
  };
  const expired = classify("那后来呢？", {
    resolvedTargets: [],
    turnOptions: { turnIndex: 6, turnEpoch: 10, messageId: "player-10" },
    conversationBinding: binding
  });
  assert.equal(expired.level, "L0");
  assert.equal(expired.reasonCode, "FOLLOWUP_BINDING_EXPIRED");
  const changedScene = classify("那后来呢？", {
    resolvedTargets: [],
    turnOptions: { turnIndex: 5, turnEpoch: 9, messageId: "player-9", sceneRevision: "scene-b" },
    conversationBinding: binding
  });
  assert.equal(changedScene.level, "L0");
  assert.equal(changedScene.reasonCode, "FOLLOWUP_BINDING_EXPIRED");
});

console.log("V9.3.6 pair memory routing: PASS (" + passed + " checks)");
