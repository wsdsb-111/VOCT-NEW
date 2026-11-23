"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");
const { DeepseekProvider, OpenAICompatibleProvider, ZhipuProvider } = require("../resources/app/out/main/providers");
const { prepareGlmAppendLayout } = require("../src/app/main/prompts/glm-append-layout");
const mainDir = path.resolve(__dirname, "../src/app/main");
const routes = [["deepseek", "deepseek-v4-flash", DeepseekProvider],
  ["openai-compatible", "deepseek-v4-flash-0731", OpenAICompatibleProvider],
  ["zhipu", "glm-5.3-flash", ZhipuProvider]];
const multiset = messages => messages.map(message => JSON.stringify(message)).sort();

for (const [providerType, defaultModel, Provider] of routes) {
  const config = { providerType, defaultModel, glmClearThinking: true };
  const fixture = createFixture("v813-success-frozen");
  const runtime = createPromptRuntime(mainDir, fixture);
  const build = (mode = "v9") => runtime.PromptBuilder.buildMessagesWithTokenCount(fixture.history, fixture.responder,
    fixture.gameData, fixture.currentSessionSummary, fixture.memoryContext, config, { promptPlanMode: mode });
  assert.equal(build().promptPlan.layoutRevision, "v9_4_static_first_1", "speaker examples retain their original order");
  fixture.promptSettings.blocks.find(block => block.type === "examples").enabled = false;
  const first = build();
  const legacy = build("legacy");
  assert.equal(first.promptPlan.layoutRevision, providerType === "openai-compatible" ? "v9_7_3_compatible_history_prefix_2" : "v9_7_3_history_prefix_1");
  assert.deepEqual(multiset(first.messages), multiset(legacy.messages));
  const blocks = first.promptPlan.blocks;
  const input = blocks.findIndex(block => block.legacyType === "current_user");
  assert.equal(blocks[input - 1].kind, "APPEND_ONLY_HISTORY");
  assert(blocks.findIndex(block => block.id === "live-character-state") > input);
  assert(blocks.findIndex(block => block.legacyType === "instruction") > input);
  const provider = new Provider();
  const wire = current => provider.buildDiagnosticRequest({ model: defaultModel, stream: true, messages: current.messages }, config).messages;
  fixture.responder.gold = 222;
  fixture.history.push({ role: "assistant", content: "new reply" }, { role: "user", content: "next turn" });
  const second = build();
  const inputEnd = first.serialized.messageSpans.find(span => span.blockId === blocks[input].id).end;
  assert.deepEqual(wire(second).slice(0, inputEnd), wire(first).slice(0, inputEnd), "first real user message stays in the wire prefix despite live state change");
  assert.notDeepEqual(wire(second).slice(inputEnd), wire(first).slice(inputEnd));
  assert(second.messages.some(message => message.content.includes("222")), "live state stays current");
  if (providerType === "openai-compatible") {
    fixture.history.splice(0, fixture.history.length, { role: "user", content: "first player line" });
    const opening = build();
    const openingEnd = wire(opening).findIndex(message => message.content === "first player line") + 1;
    assert(openingEnd > 0 && openingEnd <= wire(opening).findIndex(message => message.content.includes("222")));
    assert.deepEqual(multiset(opening.messages), multiset(build("legacy").messages));
    fixture.responder.gold = 333;
    fixture.history.push({ role: "assistant", content: "opening reply" }, { role: "user", content: "second player line" });
    assert.deepEqual(wire(build()).slice(0, openingEnd), wire(opening).slice(0, openingEnd), "cold opening becomes reusable without rewriting player history");
  }
  if (providerType !== "zhipu") assert.equal(prepareGlmAppendLayout(second, config, null).receipt, null);
  fixture.promptSettings.blocks.find(block => block.type === "instruction").enabled = false;
  assert.equal(build().promptPlan.layoutRevision, "v9_4_static_first_1", "no reorder without a response instruction");
}

// Isolate GLM's tail-only change using the normal examples-inclusive layout.
const fixture = createFixture("v813-success-frozen");
const runtime = createPromptRuntime(mainDir, fixture);
const config = { providerType: "zhipu", defaultModel: "glm-5.3-flash", glmClearThinking: true };
const buildGlm = () => runtime.PromptBuilder.buildMessagesWithTokenCount(fixture.history, fixture.responder,
  fixture.gameData, fixture.currentSessionSummary, fixture.memoryContext, config);
const original = buildGlm();
const first = prepareGlmAppendLayout(original, config, null);
assert.strictEqual(first.build.serialized, original.serialized, "the initial request is not rebuilt a second time");
fixture.history.push({ role: "assistant", content: "reply" }, { role: "user", content: "latest input" });
// Change only the rendered tail; changing prompt settings would invalidate the receipt.
const canonical = buildGlm();
const { fingerprint, planSeal } = require("../src/app/main/prompts/prompt-plan-contract");
const { serializePromptPlan } = require("../src/app/main/prompts/prompt-plan-serializer");
const updatedSuffix = { role: "system", content: "updated suffix" };
const plan = { ...canonical.promptPlan, diagnostics: { ...canonical.promptPlan.diagnostics },
  blocks: canonical.promptPlan.blocks.map(block => block.id === "suffix"
    ? { ...block, content: updatedSuffix.content, messages: [updatedSuffix],
      cache: { ...block.cache, contentFingerprint: fingerprint([updatedSuffix.content, [updatedSuffix]]) } } : block) };
plan.diagnostics.planFingerprint = planSeal(plan);
const serialized = serializePromptPlan(plan);
const next = prepareGlmAppendLayout({ ...canonical, messages: serialized.messages, promptPlan: plan, serialized }, config, first.receipt);
assert.equal(next.build.glmAppendLayoutApplied, true);
assert.deepEqual(next.build.messages.at(-1), { role: "system", content: "updated suffix" });
assert.deepEqual(next.build.messages.slice(0, -first.receipt.tailCount).slice(0, first.build.messages.length - first.receipt.tailCount),
  first.build.messages.slice(0, -first.receipt.tailCount));
assert.deepEqual(multiset(next.build.messages), multiset(serialized.messages));
// V9.8.1 takes only the current responder's durable-looking fields from the reviewed script.
const { PromptScriptLoader } = require("../src/app/main/prompts/prompt-script-loader");
const standard = createFixture("v813-success-frozen");
const standardRuntime = createPromptRuntime(mainDir, standard);
const description = standard.promptSettings.blocks.find(block => block.type === "description");
description.id = "character-description";
description.scriptPath = path.resolve(__dirname, "../src/app/default_userdata/prompts/character_description/standard/pListMccTest2.js");
const examples = standard.promptSettings.blocks.find(block => block.type === "examples");
examples.enabled = false;
const fixtureLoader = standardRuntime.PromptBuilder.scriptLoader;
const stockLoader = new PromptScriptLoader();
stockLoader.executeExamples = fixtureLoader.executeExamples;
standardRuntime.PromptBuilder.scriptLoader = stockLoader;
standard.responder.faith = "fixture-response-faith";
standard.responder.personality = "fixture-response-personality";
standard.responder.traits = [{ id: "patient", category: "Personality Trait", name: "fixture-patient", desc: "fixture-description" }];
const player = standard.gameData.characters.get(standard.gameData.playerID);
player.culture = "fixture-player-culture-private";
const buildProfile = (provider = config, mode = "v9") => standardRuntime.PromptBuilder.buildMessagesWithTokenCount(
  standard.history, standard.responder, standard.gameData, standard.currentSessionSummary, standard.memoryContext,
  provider, { promptPlanMode: mode });
const old = buildProfile(config, "legacy");
const current = buildProfile();
const profileBlocks = build => build.promptPlan.blocks.filter(block => block.id.startsWith("glm-"));
const currentFacts = build => build.promptPlan.blocks.find(block => block.id === "responder-game-facts").content;
const [profile, identity] = profileBlocks(current);
assert.equal(profile.id, "glm-responder-profile");
assert.equal(identity.id, "glm-identity-rules");
assert(identity.content.includes("私下交谈和信件"));
assert(currentFacts(current).includes("当前回合开始交谈"));
assert(!currentFacts(current).includes(identity.content));
assert(currentFacts(old).includes(identity.content));
assert(profile.order < current.promptPlan.blocks.find(block => block.legacyType === "history").order);
assert(profile.content.includes("fixture-response-faith"));
assert(profile.content.includes("fixture-response-personality"));
assert(!profile.content.includes("fictional new title") && !profile.content.includes("primary title:"));
assert(!profile.content.includes("fixture-player-culture-private"));
assert(!profile.content.includes(player.fullName));
assert.deepEqual(profileBlocks(old), []);
assert.deepEqual(profileBlocks(buildProfile({ providerType: "deepseek", defaultModel: "deepseek-v4-flash" })), []);
assert.deepEqual(profileBlocks(buildProfile(config, "shadow")), []);
const provider = new ZhipuProvider();
const wireProfile = build => provider.buildDiagnosticRequest({ model: config.defaultModel, stream: true, messages: build.messages }, config).messages;
const before = wireProfile(current);
const historyEnd = current.serialized.messageSpans.find(span => span.blockId === "history").end;
standard.responder.primaryTitle = "fictional new title";
standard.responder.gold += 2;
standard.history.push({ role: "assistant", content: "new fixture reply" }, { role: "user", content: "new fixture input" });
const update = buildProfile();
assert.deepEqual(wireProfile(update).slice(0, historyEnd), before.slice(0, historyEnd));
assert(currentFacts(update).includes("fictional new title"));
standard.responder.faith = "fixture-current-faith";
const changed = profileBlocks(buildProfile())[0].content;
assert(changed.includes("fixture-current-faith") && !changed.includes("fixture-response-faith"));
examples.enabled = true;
assert.deepEqual(profileBlocks(buildProfile()), []);
examples.enabled = false;
standardRuntime.PromptBuilder.scriptLoader = fixtureLoader;
const custom = buildProfile();
assert.deepEqual(profileBlocks(custom), []);
assert(custom.messages.some(message => message.content.startsWith("DESCRIPTION FIXTURE:")));
console.log("PASS V9.8.1 GLM responder profile, exact legacy fallback, current game facts and history prefix");

console.log("PASS V9.7.3 provider prefix: production builders/adapters, live-state breakpoints, legacy/custom fallback and GLM tail freshness");
