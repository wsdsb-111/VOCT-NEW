"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { makeConversation } = require("./test-v9.4-conversation-plan-main-chain");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { LLMManager, ProviderRegistry } = require("../src/app/main/provider-service");
const { DeepseekProvider, OpenAICompatibleProvider, ZhipuProvider } = require("../resources/app/out/main/providers");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v974-outbound-"));
const expectedName = "赵元宁";
const introduction = "我微笑着说：“我叫赵元宁。”";
const nameHeader = "=== 本角色已获知的姓名 ===";
const endpoint = "https://fixture.invalid/v1";

function createHarness(providerType, defaultModel, Provider) {
  const config = { id: "fixture", providerType, defaultModel, apiKey: "synthetic_api_key",
    baseUrl: endpoint, defaultParameters: { max_tokens: 128 }, glmClearThinking: true };
  const dataDir = path.join(root, providerType);
  const requests = [];
  const events = [];
  let changeBeforeGuard;
  let conversation;
  let store;
  let state;

  class FixtureProvider extends Provider {
    async listModels() { return [{ id: defaultModel, contextLength: 90000, contextLengthSource: "provider_native" }]; }
    fixtureClient() {
      changeBeforeGuard?.();
      return { chat: { completions: { async create(payload) {
        requests.push(structuredClone(payload));
        return { id: "fixture", choices: [{ message: { content: "明白了。" }, finish_reason: "stop" }] };
      } } } };
    }
    _nonStreamChatCompletion(request, _client, control, url) {
      return super._nonStreamChatCompletion(request, this.fixtureClient(), control, url);
    }
    _nonStreamZhipuChatCompletion(request, _client, control, url) {
      return super._nonStreamZhipuChatCompletion(request, this.fixtureClient(), control, url);
    }
  }

  const startScene = (scene, date, totalDays, diagnostics = true) => {
    state = makeConversation();
    const { npc, runtime, fixture } = state;
    ({ conversation } = state);
    const data = fixture.gameData;
    const playerId = data.playerID;
    data.date = date;
    data.totalDays = totalDays;
    const player = data.characters.get(playerId);
    Object.assign(player, { firstName: expectedName, shortName: expectedName, fullName: expectedName, traits: [] });
    data.playerName = expectedName;
    Object.assign(conversation, {
      id: scene, messages: [], glmAppendReceipts: new Map(), selectedCharacterIds: new Set([npc.id]),
      presentCharacterIds: new Set([npc.id]), temporarilyAbsentCharacterIds: new Map(),
      getCharacterDisclosureContext: Conversation.prototype.getCharacterDisclosureContext,
      recordCharacterDisclosures: Conversation.prototype.recordCharacterDisclosures,
      getActiveConversationCharacters: () => [...data.characters.values()].filter(character =>
        character.id === playerId || conversation.presentCharacterIds.has(character.id)),
      fillNpcQueue() {}, resumeConversation() {}, evaluateCompletedActions: async () => {},
      checkAndSummarizeIfNeeded: async () => ({ ...fixture.memoryContext, tokenBudget: 10000, conversationId: scene,
        ...conversation.getCharacterDisclosureContext(npc) })
    });
    conversation.memoryState.participantPresence = [playerId, npc.id].map(characterId => ({ characterId, joinedAtMessageId: 0 }));
    store = new ConversationDisclosureStore({ dataDir, getCurrentConversation: () => conversation,
      nameDiagnosticSink: diagnostics ? event => events.push(event) : undefined });
    const registry = new ProviderRegistry();
    registry.register(providerType, FixtureProvider);
    const settingsRepository = {
      getActiveProviderConfig: () => config,
      getGlobalStreamSetting: () => false,
      getChatPromptV813Layout: () => true,
      getActionApprovalSettings: () => ({ pauseOnApproval: false }),
      getCK3DebugLogPath: () => ""
    };
    const llmManager = new LLMManager({ settingsRepository, providerRegistry: registry, ...runtime, usageAnalytics: { record() {} } });
    Conversation.configure({ settingsRepository, llmManager, applicationServices: { characterKnowledge: store },
      createPromptFingerprint: text => createHash("sha256").update(String(text), "utf8").digest("hex").slice(0, 16),
      memoryEngine: { observeParticipants() {}, trace: { record() {} }, validatePlayerMemoryContext: () => ({ valid: true }) } });
    return conversation;
  };
  const respond = async () => conversation.respondAs(state.npc, conversation.turnEpoch);
  const speak = async message => { await conversation.sendMessage(message); return respond(); };
  const profile = () => store.getDisclosureProfile({ ownerRuntimeId: state.npc.id, targetRuntimeId: state.fixture.gameData.playerID });
  const assertWire = present => {
    const messages = requests.at(-1).messages;
    const fact = messages.find(message => message.content.includes(nameHeader));
    assert.equal(Boolean(fact), present);
    if (present) {
      assert(fact.content.includes(`- Target Runtime ID ${state.fixture.gameData.playerID}: ${expectedName}`));
      assert(fact.content.includes("不得声称尚未获知该姓名"));
    } else assert(!messages.some(message => message.content.includes(expectedName)), "an unspoken or revoked backend name must not reach the outbound request");
  };
  return { startScene, respond, speak, requests, events, profile, assertWire,
    get store() { return store; }, revokeBeforeGuard(callback) { changeBeforeGuard = callback; } };
}

async function main() {
  for (const [type, model, Provider, mode] of [
    ["deepseek", "deepseek-v4-flash", DeepseekProvider, "v9"],
    ["zhipu", "glm-5.3-flash", ZhipuProvider, "v9"],
    ["openai-compatible", "fixture", OpenAICompatibleProvider, "legacy"]
  ]) {
    process.env.VOTC_PROMPT_PLAN_MODE = mode;
    const h = createHarness(type, model, Provider);
    let conversation = h.startScene("intro", "1175.6.14", 100);
    assert.equal(h.profile().facts.some(fact => fact.factType === "NAME"), false);
    await h.speak("今天天气如何？");
    h.assertWire(false);
    await h.speak(introduction);
    h.assertWire(true);
    assert.equal(h.events.filter(event => event.code === "NAME_OUTBOUND_CURRENT").length, 1);
    const state = JSON.parse(fs.readFileSync(h.store.filePath, "utf8"));
    const names = state.records.filter(row => row.factType === "NAME");
    assert.equal(names.length, 1);
    assert.equal(names[0].evidence.length, 1, "replaying the same message after the NPC reply is idempotent");
    assert.match(names[0].evidence[0].messageRevision, /^[a-f0-9]{64}$/);
    assert.match(names[0].evidence[0].factSourceSnapshotId, /^fact:[a-f0-9]{64}$/);

    const next = h.startScene("new-scene-after-restart", "1176.6.15", 467);
    assert.notEqual(next, conversation);
    conversation = next;
    assert.equal(h.profile().status, "READY");
    assert(h.profile().facts.some(fact => fact.factType === "NAME" && fact.effectiveKnown && fact.disclosurePhase === "prior"));
    await h.speak("你还记得我的名字吗？");
    h.assertWire(true);
    assert(h.events.some(event => event.code === "NAME_OUTBOUND_FROZEN"));

    conversation = h.startScene("reopened-after-rename", "1176.6.16", 468);
    const renamed = "赵新名";
    const player = conversation.gameData.characters.get(conversation.gameData.playerID);
    Object.assign(player, { firstName: renamed, shortName: renamed, fullName: renamed });
    conversation.gameData.playerName = renamed;
    assert.equal(h.profile().status, "READY");
    assert(!h.profile().facts.some(fact => fact.factType === "NAME"), "persisted evidence cannot authorize an updated CK3 identity");
    await h.speak("你还记得我的名字吗？");
    h.assertWire(false);
    assert(!h.requests.at(-1).messages.some(message => message.content.includes(renamed)));
    assert(h.events.some(event => event.code === "NAME_EVIDENCE_STALE"));

    conversation = h.startScene("reopened-original-character-facts", "1176.6.17", 469);
    await h.speak("你还记得我的名字吗？");
    h.assertWire(true);
    if (type === "zhipu") assert.equal(conversation.glmAppendReceipts.size, 1, "the authorized frozen request creates a GLM receipt");

    const formerCount = h.requests.length;
    await conversation.sendMessage("我们继续谈。");
    h.revokeBeforeGuard(() => {
      h.revokeBeforeGuard(null);
      const document = JSON.parse(fs.readFileSync(h.store.filePath, "utf8"));
      const evidence = document.records.find(row => row.factType === "NAME").evidence[0];
      delete document.sourceRevisions[JSON.stringify([evidence.conversationId, evidence.messageId])];
      fs.writeFileSync(h.store.filePath, JSON.stringify(document));
    });
    await h.respond();
    assert.equal(h.requests.length, formerCount, "revocation between Prompt build and guard must prevent transport");
    assert.equal(conversation.glmAppendReceipts.size, 0);
    assert(h.events.some(event => event.code === "NAME_EVIDENCE_STALE"));
    await h.speak("还是聊聊天气吧。");
    h.assertWire(false);
    assert.doesNotMatch(JSON.stringify(h.events), /赵元宁|微笑着说|synthetic_api_key|fixture\.invalid|你还记得/u);

    conversation = h.startScene("diagnostics-disabled", "1176.6.15", 467, false);
    const eventCount = h.events.length;
    await conversation.sendMessage(introduction);
    assert(h.profile().facts.some(fact => fact.factType === "NAME" && fact.disclosurePhase === "current"));
    const original = conversation.messages[0];
    const replacement = "我们只聊聊今天的天气。".padEnd(original.content.length, "。");
    assert.equal(replacement.length, original.content.length);
    original.content = replacement;
    conversation.recordCharacterDisclosures();
    assert(!h.profile().facts.some(fact => fact.factType === "NAME"),
      "the same message ID, date and length cannot retain a revoked name");
    await conversation.editUserMessage(conversation.messages[0].id, "还是聊聊天气吧。");
    assert(!h.profile().facts.some(fact => fact.factType === "NAME"));
    await h.respond();
    h.assertWire(false);
    assert.equal(h.events.length, eventCount, "the disabled trace has no effect on recording, editing or outbound permission");
  }
  console.log("PASS V9.7.4 real Conversation entry, Store restart, DeepSeek/GLM/legacy OpenAI-compatible transport payload, diagnostics and pre-send source revocation");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
