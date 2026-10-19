"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Conversation } = require("../src/app/main/conversation/conversation");

function makeConversation() {
  const conversation = Object.create(Conversation.prototype);
  Object.assign(conversation, {
    id: "scene-context-usage",
    conversationEpoch: 3,
    turnEpoch: 7,
    contextUsageByResponder: new Map(),
    contextUsageSceneByResponder: new Map(),
    contextUsageSceneCapacityTokens: null,
    contextUsageSceneCapacitySource: null,
    contextUsageRevision: 0,
    contextUsageSceneRevision: null,
    gameData: { scene: "scene-a", location: "court-a", locationController: 4 },
    eventEmitter: new EventEmitter(),
    isResponseCurrent: responseState => responseState?.current === true
  });
  return conversation;
}

function makeRow(conversation, responderId, requestId, usedTokens, overrides = {}) {
  return {
    conversationId: conversation.id,
    conversationEpoch: conversation.conversationEpoch,
    turnEpoch: conversation.turnEpoch,
    sceneRevision: conversation.contextUsageSceneRevision,
    responderId,
    requestId,
    responderName: `人物${responderId}`,
    configuredContextLength: 192000,
    contextWindowTokens: 131072,
    contextWindowSource: "provider_native_cap",
    inputTokens: usedTokens - 1000,
    outputTokens: 1000,
    usedTokens,
    remainingContextTokens: 131072 - usedTokens,
    phase: "completed",
    ...overrides
  };
}

function testSceneLatestRowsCarryAcrossTurnsAndResetWithScene() {
  const conversation = makeConversation();
  conversation.resetContextUsageScene();
  const responseState = { current: true };

  conversation.publishContextUsage(makeRow(conversation, 27, 101, 60000), responseState);
  conversation.publishContextUsage(makeRow(conversation, 42, 201, 86000), responseState);
  let snapshot = conversation.getContextUsageSnapshot();
  assert.equal(snapshot.responders.length, 2, "the scene snapshot keeps one latest request per NPC");
  assert.equal(snapshot.sceneCapacityTokens, 192000, "the configured scene capacity stays separate from the lower Provider window");
  assert.equal(snapshot.sceneCapacitySource, "configured");
  assert.equal(snapshot.responders.find(row => row.responderId === 27).contextWindowTokens, 131072,
    "the per-request Provider window remains available for details");

  conversation.turnEpoch += 1;
  conversation.resetContextUsageTurn();
  snapshot = conversation.getContextUsageSnapshot();
  assert.equal(conversation.contextUsageByResponder.size, 0, "the active request map clears at the turn boundary");
  assert.equal(snapshot.responders.length, 2, "the scene view retains prior NPC rows across a new turn");
  assert.deepEqual(snapshot.responders.map(row => row.usedTokens).sort((left, right) => left - right), [60000, 86000],
    "the scene view stores individual requests instead of a cumulative total");
  assert.equal(conversation.publishContextUsage(makeRow(conversation, 27, 999, 190000, { turnEpoch: 7 }), responseState), false,
    "a late response from the prior turn cannot overwrite its retained scene row");
  assert.equal(conversation.getContextUsageSnapshot().responders.find(row => row.responderId === 27).requestId, 101,
    "the retained latest request remains unchanged after a stale publication");

  conversation.publishContextUsage(makeRow(conversation, 27, 102, 45000), responseState);
  snapshot = conversation.getContextUsageSnapshot();
  assert.equal(snapshot.responders.length, 2, "a later request replaces only that NPC's prior scene row");
  assert.equal(snapshot.responders.find(row => row.responderId === 27).usedTokens, 45000);
  assert.equal(snapshot.responders.find(row => row.responderId === 42).usedTokens, 86000);
  assert.equal(snapshot.sceneCapacityTokens, 192000, "the scene capacity remains stable across requests");

  conversation.gameData.scene = "scene-b";
  assert.equal(conversation.resetContextUsageScene(), true);
  snapshot = conversation.getContextUsageSnapshot();
  assert.equal(snapshot.responders.length, 0, "a new scene clears all retained per-NPC rows");
  assert.equal(snapshot.sceneCapacityTokens, null, "a new scene establishes its own capacity on its first request");
}

function testMissingUsageRemainsUnknown() {
  const conversation = makeConversation();
  conversation.resetContextUsageScene();
  conversation.publishContextUsage(makeRow(conversation, 27, 301, null, {
    inputTokens: null, outputTokens: null, remainingContextTokens: null, usageSource: "estimated"
  }), { current: true });
  const row = conversation.getContextUsageSnapshot().responders[0];
  assert.equal(row.usedTokens, null, "missing token usage is not converted to zero");
  assert.equal(conversation.getContextUsageSnapshot().sceneCapacityTokens, 192000);
}

function main() {
  testSceneLatestRowsCarryAcrossTurnsAndResetWithScene();
  testMissingUsageRemainsUnknown();
  console.log("V9.3.9.2 scene context usage checks passed.");
}

main();
