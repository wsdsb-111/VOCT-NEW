"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { execFileSync } = require("node:child_process");
const Module = require("node:module");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { buildCharacterDisclosureContext } = require("../src/app/main/conversation/character-disclosure-context");
const { captureRecognitionEvidence, activateSocialRecognition } = require("../src/app/main/prompts/social-recognition-policy");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { createActionEngine } = require("../src/app/main/actions/action-engine");
const { ActionPromptBuilder } = require("../src/app/main/actions/action-prompt-builder");
const { createStartupPerformanceTrace } = require("../src/app/main/runtime/startup-performance-trace");

function disclosureBatchParity() {
  const directory = fs.mkdtempSync(path.resolve(__dirname, "../.build/disclosure-performance-"));
  try {
    const characters = new Map([1, 2, 3, 4].map(id => [id, { id, shortName: `人物${id}`, fullName: `人物${id}`,
      primaryTitle: `头衔${id}`, traits: [{ traitId: "vampire", name: "吸血鬼" }, { traitId: "brave", name: "勇敢" }],
      parents: [], children: [], siblings: [], knownSecrets: [] }]));
    const gameData = { playerID: 1, campaignToken: "performance-campaign", date: "1200.1.1", totalDays: 100, characters };
    const conversation = { id: "synthetic-private-scene", conversationEpoch: 1, isActive: true, gameData,
      selectedCharacterIds: new Set([2, 3, 4]), presentCharacterIds: new Set([2, 3, 4]),
      departedCharacterIds: new Set(), inactiveParticipantIds: new Map(), messages: [] };
    captureRecognitionEvidence(gameData, [[2, 1, 1, "OWN_COURT_LORD"], [3, 2, 1, "REALM_PEERS"]]);
    activateSocialRecognition(gameData, [1, 2, 3, 4]);
    const store = new ConversationDisclosureStore({ dataDir: directory, getCurrentConversation: () => conversation });
    const state = { schemaVersion: 1, records: Array.from({ length: 1000 }, (_, index) => ({ campaignToken: "other-campaign",
      ownerRuntimeId: "1", targetRuntimeId: String(index + 1000), factType: "TRAIT", factKey: "trait_brave", value: "勇敢", evidence: [], revision: 1 })), sourceRevisions: {} };
    store._write(state);
    let reads = 0;
    const originalRead = store._read.bind(store);
    store._read = () => { reads++; return originalRead(); };
    const legacy = { getDisclosureProfile: payload => store.getDisclosureProfile(payload) };
    const build = service => buildCharacterDisclosureContext({ service, gameData, responderId: 2,
      targetIds: [1, 2, 3, 4, 4], audienceIds: [1, 2, 3, 4] });
    const before = build(legacy);
    assert.equal(reads, 6, "unbatched four-person context reads the same file for six directed pairs");
    reads = 0;
    const after = build(store);
    assert.deepEqual(after, before, "profiles, inverse knowledge, permission results and revision bytes remain identical");
    assert.equal(reads, 1, "one synchronous context shares one fully validated file snapshot");
    const reversed = { getDisclosureProfile: legacy.getDisclosureProfile,
      getDisclosureProfiles: payloads => store.getDisclosureProfiles(payloads).reverse() };
    assert.deepEqual(build(reversed), before, "directed scope identities, not result positions, associate batch results");

    const target = store.getTargetView({ ownerRuntimeId: 2, targetRuntimeId: 1 });
    const trait = target.facts.find(fact => fact.factKey === "trait_vampire");
    store.setManualStatus({ ...target.scope, factType: "TRAIT", factKey: trait.factKey, status: "MANUAL_HIDDEN",
      expectedRevision: trait.revision, factSourceSnapshotId: trait.factSourceSnapshotId });
    const hidden = build(store);
    assert.notEqual(hidden.characterKnowledgeRevision, after.characterKnowledgeRevision, "the next pre-send-style build re-reads manual revocation");
    assert.equal(hidden.disclosureProfiles.get(1).find(fact => fact.factKey === "trait_vampire").effectiveKnown, false);
    assert.deepEqual(hidden, build(legacy));
    const invalid = store.getDisclosureProfiles([{ ownerRuntimeId: 2, targetRuntimeId: 1, campaignToken: "wrong" },
      { ownerRuntimeId: 99, targetRuntimeId: 1 }, { ownerRuntimeId: 2, targetRuntimeId: 1 }]);
    assert.deepEqual(invalid.map(profile => profile.status), ["BLOCKED", "BLOCKED", "READY"]);
    characters.get(1).shortName = "更名";
    assert.deepEqual(build(store), build(legacy), "current facts are not cached between context builds");
    conversation.temporarilyAbsentCharacterIds = new Map([[3, { mode: "away" }]]);
    assert.deepEqual(build(store), build(legacy), "presence changes still rebuild scope and permissions");
    fs.writeFileSync(store.filePath, "{broken");
    reads = 0;
    assert.equal(build(store).disclosureProfiles.size, 0, "a corrupt source never reuses previously known facts");
    assert.equal(reads, 1, "a failed source is attempted only once within this batch");
    store._write(state);
    const measure = service => { reads = 0; const start = performance.now(); for (let i = 0; i < 10; i++) build(service);
      return { reads, milliseconds: Number((performance.now() - start).toFixed(2)) }; };
    const baseline = measure(legacy), optimized = measure(store);
    assert.deepEqual([baseline.reads, optimized.reads], [60, 10]);
    console.log("Disclosure benchmark (synthetic, 1000 records/10 builds):", JSON.stringify({ baseline, optimized }));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function frozenActionEngine() {
  const file = path.resolve(__dirname, "../src/app/main/actions/action-engine.js");
  const source = execFileSync("git", ["show", "59f93878b6f214bc47d7d73e953005272b32d460:src/app/main/actions/action-engine.js"],
    { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
  const baseline = new Module(file, module);
  baseline.filename = file; baseline.paths = Module._nodeModulePaths(path.dirname(file));
  baseline._compile(source, file);
  return baseline.exports.createActionEngine;
}

async function actionRun(factory, { enabled = false, mode = "success", brokenTrace = false, original = false } = {}) {
  let clock = 0, clockCalls = 0;
  const trace = createStartupPerformanceTrace({ enabled, now: () => { clockCalls++; return clock; } });
  const context = trace.forConversation("private-scene-never-export").nextTurn();
  const controller = new AbortController();
  const events = [], requests = [], handled = [];
  const actionsConfig = Object.freeze({ providerType: "deepseek", defaultModel: "synthetic-model", reasoning_effort: "high" });
  const npc = { id: 2, shortName: "NPC", fullName: "NPC" };
  const conv = Object.assign(Object.create(Conversation.prototype), {
    id: "private-scene-never-export", gameData: { playerName: "Player", playerID: 1,
      characters: new Map([[1, { id: 1, fullName: "Player" }], [2, npc]]) },
    messages: [], generationAttemptsByMessageId: new Map([[3, {}]]),
    getHistory: () => [{ role: "user", name: "Player", content: "private-text-never-export" }],
    isResponseCurrent: () => !controller.signal.aborted,
    recordGenerationSkipped: () => { events.push("skipped"); },
    handleActionResults: async (_id, _npc, results) => { events.push("results"); clock += 7;
      if (mode === "results-error") throw new Error("synthetic-results-error"); handled.push(results); }
  });
  const registry = [{ id: "testAction", definition: { args: [], description: "synthetic", check: async () => {
    events.push("check"); clock += 3; if (mode === "cancel-check") controller.abort();
    return { canExecute: mode !== "no-available", validTargetCharacterIds: [1] };
  } } }];
  const engine = factory({ actionRegistry: { getAllActions: () => registry, getById: () => ({ validation: { valid: true }, definition: {} }),
      getEffectiveDestructive: () => false, registerValidation: () => {} },
    settingsRepository: { getLanguage: () => "en", getActionsProviderConfig: () => actionsConfig,
      getActionApprovalSettings: () => ({ approvalMode: "all" }) },
    usageAnalytics: { record: () => {} },
    ActionPromptBuilder: { buildActionMessages: (...args) => { events.push("prompt"); clock += 2; return ActionPromptBuilder.buildActionMessages(...args); } },
    llmManager: { sendActionsRequest: async (messages, name, schema, signal, metadata) => {
      events.push("request"); clock += 11; assert.equal(signal, controller.signal);
      requests.push(structuredClone({ messages, name, schema, metadata }));
      if (mode === "cancel-request") { controller.abort(); throw Object.assign(new Error("synthetic-cancel"), { name: "AbortError" }); }
      if (mode === "request-error") throw new Error("synthetic-request-error");
      return { finish_reason: "stop", content: JSON.stringify({ actions: [{ actionId: "testAction", targetCharacterId: 1, args: {} }] }) };
    } },
    CriticalActionRecallObserver: class { build() { return {}; } },
    buildStructuredResponseJsonSchema: value => structuredClone(value), buildStructuredResponseSchema: () => ({ parse: value => value }),
    healJsonResponseWithLogging: JSON.parse, resolveI18nString: value => value, logVerboseLLM: () => {}
  });
  engine.runInvocation = async (_conv, _npc, invocation) => { events.push("execute"); clock += 4;
    return { actionId: invocation.actionId, success: true, lifecycle: { status: "ACKNOWLEDGED" } }; };
  const responseState = { controller };
  let thrown = null;
  try {
    if (original) {
      const result = await engine.evaluateForCharacter(conv, npc, controller.signal);
      if (conv.isResponseCurrent()) await conv.handleActionResults(3, npc, result); else conv.recordGenerationSkipped();
    } else {
      Conversation.configure({ ActionEngine: engine, performanceTrace: brokenTrace ? { enabled: true, startSpan() { throw new Error("trace-only-error"); } } : trace });
      await conv.evaluateCompletedActions(npc, 3, {}, responseState, context);
    }
  } catch (error) { thrown = error.message; }
  assert.equal(actionsConfig.reasoning_effort, "high");
  return { events, requests, handled, thrown, trace: trace.snapshot(), clockCalls };
}

async function actionTraceParity() {
  const baseline = frozenActionEngine();
  for (const mode of ["success", "no-available", "cancel-check", "cancel-request", "request-error", "results-error"]) {
    const previous = await actionRun(baseline, { mode, original: true });
    for (const enabled of [false, true]) {
      const current = await actionRun(createActionEngine, { mode, enabled });
      for (const key of ["events", "requests", "handled", "thrown"]) assert.deepEqual(current[key], previous[key], `${mode}/${enabled}: unchanged ${key}`);
      if (!enabled) { assert.equal(current.clockCalls, 0); assert.equal(current.trace.events.length, 0); continue; }
      const phases = current.trace.events;
      assert(phases.length > 0 && phases.every(event => event.sessionPhase === "TURN"));
      if (mode === "success") {
        for (const [step, milliseconds] of [["action.checks", 3], ["action.prompt", 2], ["action.request", 11], ["action.execution", 4], ["action.results", 7]]) {
          const phase = phases.find(event => event.step === step);
          assert(phase, step); assert.equal(phase.wallMs, milliseconds, step); assert.equal(phase.result, "OK");
          assert.equal(phase.attribution, step === "action.request" ? "PROVIDER" : "MAIN");
          assert.equal(phase.turnOrdinal, 1);
        }
      }
      if (mode.startsWith("cancel")) assert(phases.some(event => event.result === "CANCELLED"));
      if (mode === "request-error") assert.equal(phases.find(event => event.step === "action.request").result, "ERROR");
      if (mode === "results-error") assert.equal(phases.find(event => event.step === "action.results").result, "ERROR");
      for (const secret of ["private-scene-never-export", "private-text-never-export", "testAction", "synthetic-model", "signal"]) {
        assert(!JSON.stringify(current.trace).includes(secret), "diagnostics do not export payload or identities");
      }
    }
  }
  const broken = await actionRun(createActionEngine, { enabled: true, brokenTrace: true });
  assert.deepEqual(broken.requests, (await actionRun(baseline, { original: true })).requests, "trace failure cannot suppress or alter requests");
}

(async () => {
  disclosureBatchParity();
  await actionTraceParity();
  console.log("PASS preserved dialogue performance: batch parity, fresh revocation, frozen Action bytes/order and bounded phase traces");
})().catch(error => { console.error(error); process.exitCode = 1; });
