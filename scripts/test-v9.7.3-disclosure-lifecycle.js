"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { buildCharacterDisclosureContext } = require("../src/app/main/conversation/character-disclosure-context");
const { serializePromptPlan } = require("../src/app/main/prompts/prompt-plan-serializer");
const { prepareGlmAppendLayout } = require("../src/app/main/prompts/glm-append-layout");

const fixture = createFixture("v813-success-frozen");
const { gameData, responder, promptSettings } = fixture;
promptSettings.blocks.find(block => block.type === "examples").enabled = false;
const player = gameData.characters.get(gameData.playerID);
Object.assign(player, { shortName: "赵元宁", fullName: "赵元宁", firstName: "元宁", traits: [{ traitId: "witch", name: "巫师" }] });
gameData.playerName = player.shortName;
const late = { ...responder, id: 31003, shortName: "迟到者", firstName: "迟到者", fullName: "迟到者" };
gameData.characters.set(late.id, late);
const conversation = { id: "intro", conversationEpoch: 1, isActive: true, gameData,
  selectedCharacterIds: new Set([responder.id, late.id]), presentCharacterIds: new Set([responder.id]),
  messages: [], departedCharacterIds: new Set(), inactiveParticipantIds: new Map() };
const sourceContext = () => ({ conversationId: conversation.id, campaignToken: gameData.campaignToken, date: gameData.date,
  participants: [...gameData.characters.values()].map(({ id, shortName }) => ({ id, name: shortName })), messages: conversation.messages,
  participantPresence: [...gameData.characters.keys()].map(characterId => ({ characterId,
    joinedAtMessageId: characterId === late.id ? 100 : 0, leftAtMessageId: null })) });
const dataDir = fs.mkdtempSync(path.resolve(__dirname, "../.build/v973-disclosure-"));
const createStore = () => new ConversationDisclosureStore({ dataDir, getCurrentConversation: () => conversation });
let store = createStore();
const runtime = createPromptRuntime(path.resolve(__dirname, "../src/app/main"), fixture);
const buildRequest = (npc = responder, providerType = "deepseek", defaultModel = "deepseek-v4-flash") => {
  const knowledge = buildCharacterDisclosureContext({ service: store, gameData, responderId: npc.id, targetIds: [player.id] });
  return runtime.PromptBuilder.buildMessagesWithTokenCount(fixture.history, npc, gameData, fixture.currentSessionSummary,
    { ...fixture.memoryContext, ...knowledge, conversationId: conversation.id, sourceCampaignToken: gameData.campaignToken },
    { providerType, defaultModel }, { promptPlanMode: "v9" });
};
const build = (...args) => buildRequest(...args).promptPlan;
const disclosure = (plan, phase) => plan.blocks.find(block => block.id === `responder-disclosures-${phase}`);
const assertFacts = (block, kind) => {
  assert.equal(block?.kind, kind);
  assert.match(block.content, /赵元宁/);
  assert.match(block.content, /特质／身份：巫师/);
  assert(block.content.indexOf("赵元宁") < block.content.indexOf("特质／身份：巫师"));
};
try {
  const stableFingerprints = plan => plan.blocks.filter(block => block.cache.stableCandidate).map(block => block.cache.contentFingerprint);
  const before = build();
  assert.equal(disclosure(before, "current"), undefined);
  conversation.messages.push({ id: 1, role: "user", speakerCharacterId: player.id, name: player.shortName,
    content: "我叫赵元宁。我是巫师。" });
  assert.equal(store.recordConversation({ conversation, context: sourceContext() }).recorded, 2);
  for (const [provider, model] of [["deepseek", "deepseek-v4-flash"], ["openai-compatible", "fixture"], ["zhipu", "glm-5.3-flash"]]) {
    const plan = build(responder, provider, model);
    const current = disclosure(plan, "current");
    assertFacts(current, "DYNAMIC_WORLDLINE");
    assert.equal(plan.blocks.find(block => block.kind === "DYNAMIC_WORLDLINE"), current);
    const wire = serializePromptPlan(plan);
    const position = id => wire.messageSpans.find(span => span.blockId === id).start;
    assert(position(current.id) < position("responder-game-facts"));
    assert(position(current.id) < position(plan.blocks.find(block => block.legacyType === "current_user").id));
    assert.equal(disclosure(plan, "frozen"), undefined);
    assert.doesNotMatch(plan.blocks.find(block => block.id === "responder-game-facts").content, /已获知的姓名|已获知的特质/);
  }
  assert.deepEqual(stableFingerprints(build()), stableFingerprints(before), "fresh disclosure does not alter the frozen prefix");
  const glmConfig = { providerType: "zhipu", defaultModel: "glm-5.3-flash" };
  const firstGlm = prepareGlmAppendLayout(buildRequest(responder, glmConfig.providerType, glmConfig.defaultModel), glmConfig, null);
  fixture.history.push({ role: "assistant", content: "明白了。" }, { role: "user", content: "继续吧。" });
  const nextGlm = prepareGlmAppendLayout(buildRequest(responder, glmConfig.providerType, glmConfig.defaultModel), glmConfig, firstGlm.receipt);
  const outgoing = nextGlm.build.messages.map(message => message.content);
  assert(outgoing.indexOf(disclosure(nextGlm.build.promptPlan, "current").content)
    < outgoing.indexOf(nextGlm.build.promptPlan.blocks.find(block => block.id === "responder-game-facts").content));
  assert.equal(disclosure(build(late), "current"), undefined);
  gameData.date = "1175.6.15";
  gameData.totalDays++;
  assertFacts(disclosure(build(), "current"), "DYNAMIC_WORLDLINE");
  // Restart with a new conversation, then cross another game date without repeating the introduction.
  conversation.id = "after-restart";
  conversation.messages = [];
  conversation.presentCharacterIds.add(late.id);
  store = createStore();
  const plan = build();
  const frozen = disclosure(plan, "frozen");
  assertFacts(frozen, "RESPONDER_FROZEN");
  assert(frozen.order < plan.blocks.find(block => block.kind === "APPEND_ONLY_HISTORY").order);
  assert.equal(disclosure(plan, "current"), undefined);
  assert.equal(disclosure(build(late), "frozen"), undefined);
  gameData.date = "1175.6.16";
  gameData.totalDays++;
  assert.equal(disclosure(build(), "frozen").cache.contentFingerprint, frozen.cache.contentFingerprint);
  conversation.id = "same-date-new-scene";
  conversation.messages = [{ id: 1, role: "user", speakerCharacterId: player.id, name: player.shortName, content: "我叫赵元宁。我是巫师。" }];
  store.recordConversation({ conversation, context: sourceContext() });
  assert.equal(disclosure(build(), "frozen").cache.contentFingerprint, frozen.cache.contentFingerprint, "a prior fact is not moved down when repeated");
  conversation.messages[0].content = "我没有说过我的姓名。";
  store.recordConversation({ conversation, context: sourceContext() });
  assert.equal(disclosure(build(), "current"), undefined, "an edited source does not independently supply current disclosure");
  const target = store.getTargetView({ ownerRuntimeId: responder.id, targetRuntimeId: player.id });
  const trait = target.facts.find(fact => fact.factType === "TRAIT");
  store.setManualStatus({ ...target.scope, factType: trait.factType, factKey: trait.factKey,
    factSourceSnapshotId: trait.factSourceSnapshotId, expectedRevision: trait.revision, status: "MANUAL_HIDDEN" });
  assert.doesNotMatch(disclosure(build(), "frozen").content, /巫师/);
  const campaign = gameData.campaignToken;
  gameData.campaignToken = "other-campaign";
  assert.equal(disclosure(build(), "frozen"), undefined);
  gameData.campaignToken = campaign;
  gameData.date = "1175.6.13";
  assert.equal(disclosure(build(), "frozen"), undefined);
  console.log("PASS: spoken names and traits reach the correct Prompt zone across turns, dates and restart; stale and unrelated facts are excluded");
} finally {
  const parent = path.resolve(__dirname, "../.build");
  if (path.dirname(path.resolve(dataDir)) === parent && path.basename(dataDir).startsWith("v973-disclosure-"))
    fs.rmSync(dataDir, { recursive: true, force: true });
}
