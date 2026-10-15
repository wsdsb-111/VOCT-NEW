"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { LLMManager, ProviderRegistry, TokenCounter } = require("../src/app/main/provider-service");
const versionModulePath = require.resolve("../src/app/main/version");
require.cache[versionModulePath] = {
  id: versionModulePath,
  filename: versionModulePath,
  loaded: true,
  exports: { MEMORY_ENGINE_VERSION: "3.0" }
};
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { Conversation } = require("../src/app/main/conversation/conversation");

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

function makeFixture({
  contextWindow = 8192,
  maxOutputTokens = 512,
  mutation = null,
  providerType = "v936-provider-budget-fixture",
  model = "v936-fixture-model"
} = {}) {
  const config = {
    providerType,
    customName: "V936 Fixture",
    defaultModel: model,
    apiKey: "fixture-only",
    customContextLength: contextWindow,
    customMaxOutputTokens: maxOutputTokens,
    defaultParameters: {}
  };
  const stats = { chatAttempts: 0, chatCalls: 0, lastRequest: null, listModelsCalls: 0 };
  class FixtureProvider {
    async listModels() {
      stats.listModelsCalls += 1;
      return [{ id: config.defaultModel, contextLength: contextWindow, maxOutputTokens }];
    }
    async chatCompletion(request, _config, control) {
      stats.chatAttempts += 1;
      mutation?.(request);
      control.beforeSend();
      stats.chatCalls += 1;
      stats.lastRequest = request;
      return { content: "V936_FIXTURE_RESPONSE", finish_reason: "stop" };
    }
  }
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(config.providerType, FixtureProvider);
  const settingsRepository = {
    getActiveProviderConfig: () => config,
    getGlobalStreamSetting: () => false,
    getChatPromptV89Settings: () => ({ chatPromptV89OutboundDiagnostics: false })
  };
  const manager = new LLMManager({
    settingsRepository,
    providerRegistry,
    usageAnalytics: { record() {} },
    TokenCounter,
    PromptBuilder: {}
  });
  return { manager, stats, config };
}

const promptState = { v813: false };
const promptSettingsRepository = {
  getPromptSettings: () => ({
    mainTemplate: "V936_GLOBAL_RULES",
    blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "V936_FINAL_INSTRUCTION" }
    ],
    suffix: { enabled: false, template: "" }
  }),
  getChatPromptV89Settings: () => ({
    chatPromptV89Layout: true,
    chatPromptV89RuntimeProfileSplit: false,
    chatPromptV810ProviderAdapter: true
  }),
  getChatPromptV813Layout: () => promptState.v813
};
const PromptBuilder = createPromptBuilder({
  TemplateEngine: class { renderTemplateString(template) { return String(template); } },
  PromptScriptLoader: class {},
  promptConfigManager: {
    getDefaultMainTemplateContent: () => "V936_GLOBAL_RULES",
    resolvePath: value => value
  },
  settingsRepository: promptSettingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: fingerprint,
  defaultChatInstruction: "V936_FINAL_INSTRUCTION"
});
Conversation.configure({ PromptBuilder, TokenCounter, createPromptFingerprint: fingerprint });

const promptResponder = {
  id: 2,
  shortName: "NPC-B",
  fullName: "NPC-B",
  age: 35,
  gender: "male",
  traits: [],
  parents: [],
  children: [],
  memories: [],
  conversationSummaries: [],
  primaryTitle: "无",
  heldCourtAndCouncilPositions: "无",
  titleRankConcept: "concept_none"
};
const promptPlayer = {
  id: 1, shortName: "玩家-A", fullName: "玩家-A", age: 40, gender: "female",
  traits: [], parents: [], children: []
};
const promptGameData = {
  date: "1200.1.1",
  year: 1200,
  dynasty: "V936",
  currentEraName: "V936 era",
  scene: "V936 scene",
  playerID: 1,
  characters: new Map([[1, promptPlayer], [2, promptResponder]]),
  mentionedCharactersInContext: new Set(),
  getActiveParticipantRelationshipInfo: () => "V936_LIVE_RELATIONSHIPS",
  getMentionExclusionIds: () => new Set(),
  findMentionedCharacterIdsInHistory: () => new Set(),
  getMentionedCharactersInfo: () => "",
  getMentionableCharacterProfiles() { return this.characters; }
};
const promptHistory = [
  { role: "user", content: "V936_PRIOR_USER" },
  { role: "assistant", content: "V936_PRIOR_ASSISTANT" },
  { role: "user", content: "V936_CURRENT_USER" }
];

function makePromptMemoryContext() {
  return {
    playerCenteredRecallEnabled: true,
    tokenBudget: 4096,
    activeParticipantIds: [1, 2],
    playerAnchorId: 1,
    baselineSnapshotId: "v936-baseline-snapshot-a",
    sourceFolderRevision: 7,
    sourceCampaignToken: "v936-fixture-campaign",
    sourcePairIds: [1],
    budgetPolicyRevision: "v9.3.6",
    conversationId: "v936-fixture-conversation",
    officialRecollectionText: "V936_OFFICIAL_FIXED_TITLE Date 1199.1.1 evidence A",
    directStableText: "V936_RECENT1_FIXED_TITLE Date 1200.1.1 evidence B",
    playerLedgerFrozenText: "V936_PLAYER_LEDGER_FIXED_TITLE Date 1198.1.1 evidence C",
    stableText: "V936_STABLE_MEMORY_DYNAMIC",
    mentionedSnapshotText: "V936_MENTIONED_MEMORY_DYNAMIC",
    temporalExtraText: "V936_TEMPORAL_MEMORY_DYNAMIC",
    topicPatchText: "V936_TOPIC_MEMORY_DYNAMIC",
    turnRecallText: "V936_TURN_MEMORY_DYNAMIC",
    thirdPartyEvidenceText: "V936_THIRD_PARTY_MEMORY_DYNAMIC",
    presenceText: "V936_PRESENCE_NONMEMORY",
    worldStableText: "V936_WORLD_STABLE_NONMEMORY",
    worldTopicText: "V936_WORLD_TOPIC_NONMEMORY",
    worldSupplementalText: "V936_WORLD_SUPPLEMENTAL_NONMEMORY",
    worldCurrentText: "V936_WORLD_CURRENT_NONMEMORY",
    worldTurnRecallText: "V936_WORLD_TURN_NONMEMORY",
    confirmedActionText: "V936_CONFIRMED_ACTION_NONMEMORY",
    freezePromptPrefix: true,
    stableProfileCache: new Map(),
    stableDescriptionCache: new Map(),
    cacheV2FrozenSnapshots: {
      conversation: null,
      responders: new Map(),
      prefixByResponder: new Map()
    }
  };
}

function buildRealPrompt(layout, memoryContext = makePromptMemoryContext()) {
  promptState.v813 = layout === "v813";
  const providerConfig = layout === "glm"
    ? { providerType: "zhipu", defaultModel: "glm-5.3-flash" }
    : { providerType: "openai-compatible", defaultModel: layout === "v813" ? "fixture-v813" : "fixture-normal" };
  const promptBuild = PromptBuilder.buildMessagesWithTokenCount(
    promptHistory,
    promptResponder,
    promptGameData,
    "V936_ROLLING_SUMMARY",
    memoryContext,
    providerConfig
  );
  const blockMetadata = Conversation.buildPromptBlockMetadata(promptBuild);
  const renderedMemoryTokens = PromptBuilder.getMemoryBlockTokenCount(promptBuild);
  return { promptBuild, blockMetadata, renderedMemoryTokens, providerConfig, memoryContext };
}

function makePrompt() {
  const memoryMessage = { role: "system", content: "V936_PLAYER_MEMORY_FACT" };
  const userMessage = { role: "user", content: "V936_CURRENT_UTTERANCE" };
  const memoryTokens = TokenCounter.estimateMessageTokens(memoryMessage) + 8;
  const messages = [memoryMessage, userMessage];
  const metadata = {
    requestType: "chat",
    maxTokens: 400,
    memoryBudgetTokens: memoryTokens,
    renderedMemoryTokens: memoryTokens,
    blocks: [
      {
        id: "memory-stable",
        type: "memory_stable",
        messageStartPosition: 0,
        messageCount: 1,
        tokens: TokenCounter.estimateMessageTokens(memoryMessage),
        fingerprint: fingerprint(memoryMessage.content)
      },
      {
        id: "history",
        type: "history",
        messageStartPosition: 1,
        messageCount: 1,
        tokens: TokenCounter.estimateMessageTokens(userMessage),
        fingerprint: fingerprint("user: V936_CURRENT_UTTERANCE")
      }
    ]
  };
  return { messages, metadata, memoryTokens };
}

async function rejectsWithoutChatCall(fixture, messages, metadata, matcher) {
  await assert.rejects(fixture.manager.sendChatRequest(messages, undefined, true, metadata), matcher || (() => true));
  assert.equal(fixture.stats.chatCalls, 0, "a rejected request must never reach the provider transport");
}

async function run() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("unexpected_network_access"); };
  try {
    {
      const fixture = makeFixture();
      const { messages, metadata } = makePrompt();
      let sourceGuardCalls = 0;
      metadata.beforeSendGuard = () => { sourceGuardCalls += 1; };
      const response = await fixture.manager.sendChatRequest(messages, undefined, true, metadata);
      assert.equal(response.content, "V936_FIXTURE_RESPONSE");
      assert.equal(fixture.stats.chatCalls, 1, "a valid request must use exactly one provider transport");
      assert.equal(fixture.stats.lastRequest.max_tokens, 400, "the output reserve must reach the final provider request");
      assert.equal(sourceGuardCalls, 1, "the existing source guard must still run for the valid request");
    }

    for (const layout of ["normal", "glm", "v813"]) {
      const built = buildRealPrompt(layout);
      const messages = built.promptBuild.messages;
      const blockMetadata = built.blockMetadata;
      const memoryBlocks = blockMetadata.blocks.filter(block => block.id.startsWith("memory-")
        || block.type.startsWith("memory_") || block.id === "third-party-evidence-patch"
        || block.type === "third_party_evidence");
      assert(memoryBlocks.length > 0, `${layout} actual PromptBuilder output must include memory spans`);
      assert(memoryBlocks.every(block => Number.isSafeInteger(block.messageStartPosition) && block.messageCount > 0),
        `${layout} Conversation metadata must map every memory block to actual messages`);
      assert.equal(built.renderedMemoryTokens, memoryBlocks.reduce((total, block) => {
        const span = messages.slice(block.messageStartPosition, block.messageStartPosition + block.messageCount);
        return total + span.reduce((subtotal, message) => subtotal + TokenCounter.estimateMessageTokens(message) + 8, 0);
      }, 0), `${layout} Prompt helper and Conversation spans must agree on final message token counts`);

      const fixture = makeFixture({
        providerType: built.providerConfig.providerType,
        model: built.providerConfig.defaultModel
      });
      const response = await fixture.manager.sendChatRequest(messages, undefined, true, {
        requestType: "chat",
        maxTokens: 400,
        memoryBudgetTokens: built.renderedMemoryTokens,
        renderedMemoryTokens: built.renderedMemoryTokens,
        blocks: blockMetadata.blocks
      });
      assert.equal(response.content, "V936_FIXTURE_RESPONSE");
      assert.equal(fixture.stats.chatCalls, 1, `${layout} actual PromptBuilder/Conversation metadata must pass the final Provider guard`);
      assert.equal(fixture.stats.lastRequest.max_tokens, 400);
    }

    {
      const fixture = makeFixture();
      const { messages, metadata } = makePrompt();
      metadata.memoryBudgetTokens = 0;
      metadata.renderedMemoryTokens = 0;
      await rejectsWithoutChatCall(fixture, messages, metadata, /chat_memory_budget_exceeded/);
    }

    {
      const fixture = makeFixture();
      const userMessage = { role: "user", content: "V936_NO_MEMORY_REQUEST" };
      const messages = [userMessage];
      const metadata = {
        memoryBudgetTokens: 0,
        renderedMemoryTokens: 0,
        blocks: [{ id: "history", type: "history", messageStartPosition: 0, messageCount: 1, tokens: 0, fingerprint: fingerprint("user: V936_NO_MEMORY_REQUEST") }]
      };
      await fixture.manager.sendChatRequest(messages, undefined, true, metadata);
      assert.equal(fixture.stats.chatCalls, 1, "zero is a valid budget when the final request contains no memory blocks");
    }

    {
      const fixture = makeFixture();
      const { messages, metadata } = makePrompt();
      metadata.renderedMemoryTokens = metadata.memoryBudgetTokens + 1;
      await rejectsWithoutChatCall(fixture, messages, metadata, /chat_memory_budget_exceeded/);
    }

    {
      const fixture = makeFixture();
      const { messages, metadata } = makePrompt();
      metadata.blocks[0].messageStartPosition = null;
      metadata.blocks[0].messageCount = 0;
      await rejectsWithoutChatCall(fixture, messages, metadata, /chat_memory_budget_block_unmapped/);
    }

    {
      const fixture = makeFixture();
      const { messages, metadata } = makePrompt();
      metadata.blocks[1].messageStartPosition = 0;
      await rejectsWithoutChatCall(fixture, messages, metadata, /chat_memory_budget_blocks_overlap/);
    }

    {
      const fixture = makeFixture();
      const { messages, metadata } = makePrompt();
      metadata.blocks[0].messageStartPosition = messages.length;
      await rejectsWithoutChatCall(fixture, messages, metadata, /chat_memory_budget_block_mapping_invalid/);
    }

    {
      const fixture = makeFixture({ mutation: request => { request.messages[0].content += " changed"; } });
      const { messages, metadata } = makePrompt();
      await rejectsWithoutChatCall(fixture, messages, metadata);
      assert.equal(fixture.stats.chatAttempts, 1, "the changed-message case must reach the final guard before being rejected");
    }

    {
      const fixture = makeFixture({ mutation: () => {
        currentMetadata.blocks[0].fingerprint = "0000000000000000";
      } });
      const { messages, metadata } = makePrompt();
      const currentMetadata = metadata;
      await rejectsWithoutChatCall(fixture, messages, metadata);
      assert.equal(fixture.stats.chatAttempts, 1, "the changed-metadata case must reach the final guard before being rejected");
    }

    {
      const fixture = makeFixture({ contextWindow: 1024, maxOutputTokens: 512 });
      const { messages, metadata } = makePrompt();
      messages[1].content = "V936_NON_MEMORY_PROMPT_".repeat(300);
      metadata.blocks[1].fingerprint = fingerprint(`user: ${messages[1].content}`);
      await rejectsWithoutChatCall(fixture, messages, metadata, /chat_request_budget_exceeded/);
    }

    {
      const fixture = makeFixture();
      const { messages } = makePrompt();
      const response = await fixture.manager.sendChatRequest(messages, undefined, true, { requestType: "chat" });
      assert.equal(response.content, "V936_FIXTURE_RESPONSE");
      assert.equal(fixture.stats.chatCalls, 1, "requests without explicit memory-budget metadata must remain compatible");
    }
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  }
}

run().then(() => {
  console.log("V9.3.6 provider memory budget regression passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
