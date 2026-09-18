"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainDir = path.join(root, "resources", "app", "out", "main");
const { TokenCounter } = require(path.join(mainDir, "provider-service.js"));
const { createPromptBuilder } = require(path.join(mainDir, "prompts", "prompt-builder.js"));
const { Conversation } = require(path.join(mainDir, "conversation", "conversation.js"));

class TemplateEngine {
  renderTemplateString(template) {
    return template;
  }
}

class PromptScriptLoader {
  executeDescription(_path, data, id) {
    const c = data.characters.get(id);
    return `[${c.shortName}'s character info: id(${c.id}); \nname: ${c.shortName}; \nage: ${c.age}; \ngold: ${c.gold}]\n[date(${data.date})]`;
  }
}

let v89Layout = true;
let runtimeProfileSplit = false;
let v810ProviderAdapter = true;
let providerConfig = null;
const promptSettings = {
  mainTemplate: "STABLE_MAIN",
  blocks: [
    { id: "main-system", type: "main", label: "Main", enabled: true, role: "system" },
    { id: "history", type: "history", label: "History", enabled: true },
    { id: "instruction", type: "instruction", label: "Instruction", enabled: true, role: "user", template: "FINAL_INSTRUCTION" }
  ],
  suffix: { enabled: false, template: "" }
};
const settingsRepository = {
  getPromptSettings: () => promptSettings,
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: v89Layout, chatPromptV89OutboundDiagnostics: true, chatPromptV89RuntimeProfileSplit: runtimeProfileSplit, chatPromptV810ProviderAdapter: v810ProviderAdapter })
};
const promptConfigManager = {
  getDefaultMainTemplateContent: () => "STABLE_MAIN",
  resolvePath: (value) => value
};
const PromptBuilder = createPromptBuilder({
  TemplateEngine,
  PromptScriptLoader,
  promptConfigManager,
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
  defaultChatInstruction: "FINAL_INSTRUCTION"
});

const responder = {
  id: 1,
  shortName: "父亲",
  fullName: "父亲",
  age: 42,
  gender: "male",
  children: [2],
  primaryTitle: "无",
  heldCourtAndCouncilPositions: "无",
  titleRankConcept: "concept_none"
};
const son = { id: 2, shortName: "儿子", fullName: "儿子", age: 18, gender: "male", parents: [1] };
const characters = new Map([[1, responder], [2, son]]);
const gameData = {
  date: "1175.1.1",
  totalDays: 1,
  characters,
  mentionedCharactersInContext: new Set(),
  getActiveParticipantRelationshipInfo: () => "ACTIVE_RELATIONSHIPS",
  findMentionedCharacterIdsInHistory: () => [2],
  getMentionedCharactersInfo: () => "MENTIONED_CONTEXT",
  getMentionableCharacterProfiles: () => characters
};
const history = [
  { role: "user", content: "PRIOR_USER" },
  { role: "assistant", content: "PRIOR_ASSISTANT" },
  { role: "user", content: "你的儿子近来如何？" }
];
const memoryContext = {
  activeParticipantIds: [1, 2],
  stableText: "STABLE_MEMORY",
  directStableText: "DIRECT_MEMORY",
  topicPatchText: "SESSION_TOPIC_ANCHOR",
  presenceText: "PRESENCE",
  worldStableText: "WORLD_STABLE",
  worldTopicText: "WORLD_TOPIC",
  worldSupplementalText: "WORLD_SUPPLEMENTAL",
  worldCurrentText: "WORLD_CURRENT",
  turnRecallText: "TURN_RECALL",
  thirdPartyEvidenceText: "THIRD_PARTY",
  worldTurnRecallText: "WORLD_TURN_RECALL"
};

const build = (sourceHistory = history) => PromptBuilder.buildMessagesWithTokenCount(sourceHistory, responder, gameData, "", memoryContext, providerConfig);
const blockIndex = (result, id) => result.blocks.findIndex((entry) => entry.block.id === id);
const familyContent = (result) => result.blocks.find((entry) => entry.block.id === "responder-family-facts")?.content;

const v89 = build();
assert.match(v89.messages[0].content, /^VOTC_CACHE_ANCHOR_v6/);
assert.strictEqual(v89.promptProfile.layoutId, "v6");
assert(blockIndex(v89, "memory-stable") < blockIndex(v89, "history"));
assert(blockIndex(v89, "history") < blockIndex(v89, "responder-game-facts"), "prior conversation must precede current runtime facts");
assert(blockIndex(v89, "current-presence-roster") < blockIndex(v89, "history-current-user"), "current runtime must precede current user input");
assert(blockIndex(v89, "history-current-user") < blockIndex(v89, "responder-family-facts"), "Family Facts must follow the current user input");
assert(blockIndex(v89, "responder-family-facts") < blockIndex(v89, "memory-topic-patch"), "query-derived evidence must follow Family Facts");
assert.strictEqual(v89.blocks.at(-1).block.id, "instruction", "final instruction must remain last");
Conversation.configure({ createPromptFingerprint: (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex") });
const metadata = Conversation.buildPromptBlockMetadata(v89);
assert.strictEqual(metadata.blocks.reduce((sum, block) => sum + block.messageCount, 0), v89.messages.length, "every real outbound message must map to one diagnostic block range");
const familyMetadata = metadata.blocks.find((block) => block.id === "responder-family-facts");
assert.strictEqual(v89.messages[familyMetadata.messageStartPosition].content, familyContent(v89));
assert.strictEqual(metadata.blocks.find((block) => block.id === "history").messageCount, 2, "prior history metadata must cover both outbound messages");
assert.strictEqual(metadata.blocks.find((block) => block.id === "history-current-user").messageCount, 1);
assert(metadata.blocks.filter((block) => block.tokens > 0).every((block) => block.messageStartPosition != null), "every emitted prompt block must map to its real outbound message range");

v89Layout = false;
const legacy = build();
assert.match(legacy.messages[0].content, /^VOTC_CACHE_ANCHOR_v5/);
assert.strictEqual(legacy.promptProfile.layoutId, "v5");
assert(blockIndex(legacy, "responder-family-facts") < blockIndex(legacy, "history"), "rollback must restore the v8.8.5 Family Facts position");
assert(blockIndex(legacy, "current-presence-roster") < blockIndex(legacy, "history"), "rollback must restore the v8.8.5 runtime-before-history order");

assert(familyContent(v89));
assert.strictEqual(familyContent(v89), familyContent(legacy), "V8.9 may move Family Facts but must not change their content");
const payload = (result) => result.messages.slice(1).map((message) => `${message.role}\0${message.content}`).sort();
assert.deepStrictEqual(payload(v89), payload(legacy), "V8.9 layout must preserve every non-anchor message byte-for-byte");

v89Layout = true;
providerConfig = { providerType: "deepseek", defaultModel: "deepseek-v4-flash-0731" };
const deepseek = build();
assert.deepStrictEqual(deepseek.messages, v89.messages, "DeepSeek must keep the V8.9 prompt bytes and order");
assert.strictEqual(deepseek.promptProfile.label, "DeepSeek V8.9 Layout");
assert.strictEqual(deepseek.promptProfile.layoutId, "v6");

providerConfig = { providerType: "openai-compatible", defaultModel: "deepseek-v4-flash-0731" };
const compatibleDeepseek = build();
assert.deepStrictEqual(compatibleDeepseek.messages, v89.messages, "the production OpenAI-compatible DeepSeek preset must keep the V8.9 prompt bytes and order");
assert.strictEqual(compatibleDeepseek.promptProfile.label, "DeepSeek V8.9 Layout");
assert.strictEqual(compatibleDeepseek.promptProfile.layoutId, "v6");

providerConfig = { providerType: "zhipu", defaultModel: "glm-5.3-flash" };
const glmHistory = Array.from({ length: 15 }, (_, index) => ({ role: index % 2 === 0 ? "user" : "assistant", content: `GLM_HISTORY_${index}` }));
glmHistory.push({ role: "user", content: "GLM_CURRENT_USER" });
const glm = build(glmHistory);
assert.match(glm.messages[0].content, /^VOTC_CACHE_BLOCK_v8\.10/);
assert.strictEqual(glm.promptProfile.label, "GLM Cache v1");
assert.strictEqual(glm.promptProfile.historyWindow, 12);
assert.strictEqual(glm.promptProfile.layoutId, "glm_cache_v1_v6");
assert.strictEqual(glm.blocks.find((entry) => entry.block.id === "history").content.match(/GLM_HISTORY_/g).length, 11, "GLM must retain only the 11 prior messages adjacent to its current user message");
assert(blockIndex(glm, "responder-game-facts") < blockIndex(glm, "history"), "GLM dynamic runtime must precede short history after the stable cache zone");
assert(blockIndex(glm, "memory-session-topic-anchor") < blockIndex(glm, "history"), "GLM session topic memory must live in the dynamic tail");
assert(glm.staticTokens > 0 && glm.dynamicTokens > 0);
assert(glm.omittedHistoryTokens > 0, "GLM must preserve omitted history pressure for rolling-summary decisions");

v810ProviderAdapter = false;
const glmRollback = build();
assert.match(glmRollback.messages[0].content, /^VOTC_CACHE_ANCHOR_v6/);
assert.strictEqual(glmRollback.promptProfile.label, "V8.9 Default Layout");
assert.deepStrictEqual(glmRollback.messages, v89.messages, "Disabling the adapter must restore the V8.9 prompt exactly");
v810ProviderAdapter = true;
providerConfig = null;

console.log("VOTC V8.9 chat prompt layout: PASS (v6 order, v5 rollback, Family Facts parity, final instruction)");

v89Layout = true;
runtimeProfileSplit = true;
memoryContext.stableDescriptionCache = new Map([[String(responder.id), "STALE_LEGACY_PROFILE"]]);
promptSettings.blocks.splice(1, 0, { id: "profile", type: "description", enabled: true, scriptPath: "fixture.js" });
responder.gold = 100;
const fresh1 = build();
responder.gold = 200;
const fresh2 = build();
assert.match(fresh2.messages[0].content, /^VOTC_CACHE_ANCHOR_v7/);
assert.strictEqual(fresh2.promptProfile.layoutId, "v7");
assert.strictEqual(fresh1.blocks.find(b => b.block.id === "profile-stable").content, fresh2.blocks.find(b => b.block.id === "profile-stable").content);
assert(fresh2.blocks.find(b => b.block.id === "profile-dynamic").content.includes("gold: 200"));
assert(blockIndex(fresh2, "profile-dynamic") > blockIndex(fresh2, "history"));
assert.strictEqual(familyContent(fresh1), familyContent(fresh2));
assert(![...memoryContext.stableDescriptionCache.entries()].filter(([key]) => key.startsWith("v7:")).some(([, value]) => value.includes("gold:")));
responder.shortName = "新姓名";
assert(build().blocks.find(b => b.block.id === "profile-stable").content.includes("新姓名"));
runtimeProfileSplit = false;
const restoredV6 = build();
assert.match(restoredV6.messages[0].content, /^VOTC_CACHE_ANCHOR_v6/);
assert.strictEqual(restoredV6.promptProfile.layoutId, "v6");
v89Layout = false;
runtimeProfileSplit = true;
const restoredV5 = build();
assert.match(restoredV5.messages[0].content, /^VOTC_CACHE_ANCHOR_v5/);
assert.strictEqual(restoredV5.promptProfile.layoutId, "v5");
console.log("V8.9.1 multi-turn profile PASS: fresh runtime, stable cache, identity refresh, v7/v6/v5 rollback");
