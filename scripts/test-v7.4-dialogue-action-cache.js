"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.actionRegistry = {
  getAllActions: () => fs.readdirSync(actionsDir).filter((file) => file.endsWith(".js")).map((file) => {
    const definition = require(path.join(actionsDir, file));
    return { id: definition.signature, definition, validation: { valid: true } };
  })
};
const { getActionEngine } = require("./action-engine-test-helper");
const { MemoryEngine } = require(path.join(root, "resources", "app", "out", "main", "memory-system"));
const ActionEngine = getActionEngine();

const conversation = { actionGateProcessedTriggers: new Set(), memoryContext: { stableText: "旧记忆里的杀人叙述不得成为当前证据。" } };
for (const content of [
  "今日天气不错。",
  "你愿意把他关进地牢吗？",
  "如果明日开战，我或许会拔剑。",
  "我试图推开他，但没能成功。"
]) {
  const result = ActionEngine.shouldEvaluateForMessage(conversation, { id: content, role: "assistant", name: "乙", content });
  assert.strictEqual(result.shouldEvaluate, true, `local gate must not skip current reply: ${content}`);
  assert(result.semanticProfile.events.length > 0, "model semantic fallback must supply one current-message event");
  assert.strictEqual(result.semanticProfile.events[0].evidence.text, content, "fallback evidence must contain only the current reply");
  assert.strictEqual(result.semanticProfile.resolutionMode, "model_fallback");
}

const explicit = ActionEngine.shouldEvaluateForMessage({ actionGateProcessedTriggers: new Set() }, { id: 5, role: "assistant", name: "乙", content: "我已经把丙关进地牢。" });
assert.strictEqual(explicit.shouldEvaluate, true);
assert(explicit.semanticProfile.allowedActionIds.length > 0, "metadata-positive action text must retain its narrow semantic allowlist");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v74-cache-"));
try {
  const engine = new MemoryEngine({ baseDir: path.join(tempDir, "memory"), summaryFoldersDir: path.join(tempDir, "summaries"), trace: { record() {} } });
  engine.store.saveMemory({ memoryId: "stable_a", participants: [2], knownBy: [2], content: "乙发誓守住城门。", importance: 1, status: "open", totalDays: 10 });
  engine.store.saveMemory({ memoryId: "stable_b", participants: [2], knownBy: [2], content: "乙必须偿还旧债。", importance: 0.95, status: "open", totalDays: 20 });
  const options = { characterId: 2, directCounterpartIds: [1], tokenBudget: 800, currentTotalDays: 30, estimateTokens: (text) => String(text).length };
  const first = engine.retrieveForResponder({ ...options, query: "城门守军" });
  const second = engine.retrieveForResponder({ ...options, query: "旧债钱财", directCounterpartIds: [3, 4] });
  assert.strictEqual(first.stableText, second.stableText, "stable long-term memory must not be re-ranked by query or active roster changes inside a conversation");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const providerServiceSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "provider-service.js"), "utf8");
const actionPromptSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "action-prompt-builder.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
const defaultPromptSource = fs.readFileSync(path.join(root, "resources", "app", "default_userdata", "prompts", "system", "default.hbs"), "utf8");
assert(providerServiceSource.includes('thinking: { type: "enabled" }'), "DeepSeek normal chat must explicitly enable thinking");
assert(providerServiceSource.includes("max_tokens: 4096"), "DeepSeek normal chat must keep the requested 4096-token budget");
assert(mainSource.includes("角色回复不设固定句数、段落数或人为短回复目标"), "normal roleplay replies must not be artificially shortened");
assert(mainSource.includes("VOTC_CACHE_ANCHOR_v3"), "the conversation cache anchor must change with the V7.4 prompt contract");
assert(mainSource.includes("PROMPT_DEFAULTS_MANIFEST_VERSION = 2"), "the V7.4 bundled prompt update must advance its migration manifest");
assert(mainSource.includes("9ef5e409071b1474e460bddbf2002e50420c153414bf53ac4255973c789742c6"), "the unchanged LF V7.4 predecessor must be eligible for safe prompt migration");
assert(mainSource.includes("LEGACY_CHAT_INSTRUCTION") && mainSource.includes("DEFAULT_CHAT_INSTRUCTION"), "the untouched legacy reply instruction must migrate without overwriting custom instructions");
assert(defaultPromptSource.includes("不设固定句数或段落数"), "the default prompt must request naturally complete emotional replies");
assert(defaultPromptSource.includes("长期稳定记忆") && defaultPromptSource.includes("本轮事实只以当前对话消息"), "the default prompt must separate recalled context from current-turn facts");
assert(defaultPromptSource.includes("不得展示思维过程"), "thinking chat must return only the in-character response");
assert(providerServiceSource.includes('isDeepseekStructuredSummary ? { thinking: { type: "enabled" }, max_tokens: 4096'), "DeepSeek final summaries must restore thinking with a bounded structured-output budget");
assert(actionPromptSource.includes("VOTC_ACTION_CACHE_ANCHOR_v10"), "the action prompt anchor must change with the V7.5 two-stage semantic boundary");
assert(actionPromptSource.includes("they never prove that an action happened in the current turn"), "action selection must not treat recalled memory as current evidence");
assert(rendererSource.includes("Memory Engine 2.3 · V7.7.1"));
assert(rendererSource.includes("动作语义直通"));
assert(rendererSource.includes("稳定记忆前缀"));
assert(rendererSource.includes("DeepSeek 思考与摘要"));
assert(rendererSource.includes("V7.7.1 适配状态"));

console.log("VOTC v7.4 dialogue/action/cache: PASS (UI, prompt migration, thinking chat, stable memory prefix, semantic-direct action routing)");
