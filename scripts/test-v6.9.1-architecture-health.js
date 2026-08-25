"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const actionSystemDir = path.join(root, "resources", "app", "out", "main", "action-system");
const mainSource = fs.readFileSync(mainPath, "utf8");
const engineSource = fs.readFileSync(path.join(actionSystemDir, "action-engine.js"), "utf8");
const conversationSource = fs.readFileSync(path.join(actionSystemDir, "conversation.js"), "utf8");
const conversationRuntimeSource = fs.readFileSync(path.join(actionSystemDir, "conversation-runtime.js"), "utf8");
const semanticSource = fs.readFileSync(path.join(actionSystemDir, "semantic-resolver.js"), "utf8");
const system = require(actionSystemDir);

assert(fs.statSync(mainPath).size <= 420000, `main.js too large: ${fs.statSync(mainPath).size}`);
for (const marker of [
  "getLegacySemanticProfileForEvidence",
  "legacyResolveMetadataSemanticCandidates",
  "requiresLegacyResolution",
  "legacyResolver",
  "class ActionEngine",
  "class Conversation {",
  "AbortController",
  "pendingApprovals",
  "globalThis.__V67ActionSystem"
]) {
  assert(!mainSource.includes(marker), `main.js must not contain ${marker}`);
}
for (const actionId of ["characterIsKilled", "isInjured", "intercourse"]) {
  assert(!mainSource.includes(actionId), `main.js must not contain Action ID semantic mapping for ${actionId}`);
}
assert(fs.existsSync(path.join(actionSystemDir, "action-engine.js")), "ActionEngine module is missing");
assert(fs.existsSync(path.join(actionSystemDir, "conversation.js")), "Conversation module is missing");
assert(!semanticSource.includes("legacyResolver") && !semanticSource.includes("requiresLegacyResolution"), "Semantic Resolver must own a metadata-only resolution path");
assert(engineSource.includes("actionSystem.semanticResolver.resolve"), "ActionEngine must delegate semantic resolution to Semantic Resolver");
assert(!engineSource.includes("globalThis.__V67ActionSystem"), "ActionEngine production path must not use the test façade global");
assert(conversationRuntimeSource.includes("new ConversationTurnManager") && conversationRuntimeSource.includes("new GenerationManager"), "conversation-runtime must own service wiring");
assert(!conversationSource.includes("new ConversationTurnManager") && !conversationSource.includes("new GenerationManager"), "Conversation must consume runtime services instead of constructing them directly");
assert(conversationSource.includes("let actionRegistry = null;"), "Conversation must declare actionRegistry as an injected dependency");
assert(conversationSource.includes("actionRegistry = dependencies.actionRegistry || actionRegistry;"), "Conversation.configure must inject actionRegistry");
assert(/Conversation\.configure\(\{[\s\S]{0,160}actionRegistry,/.test(mainSource), "main.js must pass actionRegistry to Conversation.configure");
assert(!conversationSource.includes("new (this.getActionSystem()"), "Conversation getters must not rebuild runtime managers");
assert(!/getApprovalManager\(\) \{[\s\S]{0,220}createApprovalManager\(\)/.test(conversationSource), "getApprovalManager must not create a fallback manager");
for (const method of ["checkpointFinalization", "createFinalSummary"]) {
  assert(!mainSource.includes(`${method},`), `Conversation instance method ${method} must not be injected as an undefined main-process global`);
}

const missingResolver = system.actionRuleRegistry.validateActionRules({
  signature: "missingResolver",
  triggerCategories: ["physical"],
  semantic: { deterministicInvocation: true }
});
assert.deepStrictEqual(missingResolver, { valid: false, message: "Deterministic action is missing registered resolver." });

const event = system.createActionEvent({ eventId: "evt_health", category: "death_or_injury", evidence: { text: "测试", start: 0, end: 2 } });
const binding = system.createParticipantBinding({ eventId: event.eventId, traceId: event.traceId, actionId: "isInjured", sourceCharacterId: 1, targetCharacterId: 2 });
const invocation = system.createValidatedInvocation({ actionId: "isInjured", sourceCharacterId: 1, targetCharacterId: 2, bindingId: binding.bindingId, eventId: binding.eventId, traceId: binding.traceId });
const result = system.createExecutionResult({ actionId: invocation.actionId, success: true, effectWritten: true, sourceCharacterId: 1, targetCharacterId: 2, bindingId: invocation.bindingId, eventId: invocation.eventId, traceId: invocation.traceId });
assert.strictEqual(binding.traceId, event.traceId);
assert.strictEqual(invocation.traceId, event.traceId);
assert.strictEqual(result.traceId, event.traceId);
assert.strictEqual(result.eventId, event.eventId);
assert.strictEqual(result.effectWritten, true);

(async () => {
  const baseExecution = {
    effectWriter: { writeEffect: () => {} },
    filePath: "architecture-health",
    gameData: {},
    sourceCharacter: { id: 1 },
    targetCharacter: { id: 2 },
    args: {},
    conversation: {},
    dryRun: false,
    lang: "zh"
  };
  const noEffect = await system.actionExecutor.execute({
    ...baseExecution,
    actionSandbox: { executeAction: async () => ({ message: "no effect" }) }
  });
  assert.strictEqual(noEffect.effectWritten, false, "script success without runGameEffect must not report an effect write");
  const withEffect = await system.actionExecutor.execute({
    ...baseExecution,
    actionSandbox: { executeAction: async (_file, context) => { context.runGameEffect("effect"); return null; } }
  });
  assert.strictEqual(withEffect.effectWritten, true, "runGameEffect must report an effect write");
  console.log(`VOTC v6.9.1 architecture health: PASS (main.js ${fs.statSync(mainPath).size} bytes)`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
