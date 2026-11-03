"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CampaignBackgroundStore, backgroundCampaignKey, backgroundPrompt } = require("../src/app/main/worldline/campaign-background");
const { CASES, createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v971-background-"));
const token = "votc8c-123456789012";
try {
  const store = new CampaignBackgroundStore(path.join(root, "background"));
  const empty = store.read(token);
  assert.equal(empty.text, "");
  assert(!fs.existsSync(store.root), "reading a new campaign creates no persistent defaults");
  const request = text => ({ ...store.read(token), text });
  const full = "龙".repeat(2999) + "🐉";
  const saved = store.save(token, request(full));
  assert.equal(saved.text, full);
  assert.equal(new CampaignBackgroundStore(store.root).read(token).text, full, "restart preserves all characters");
  assert.throws(() => store.save(token, request(full + "x")), /too_long/);
  assert.throws(() => store.save(token, { ...saved, revision: 0, text: "stale" }), /revision_changed/);
  assert.throws(() => store.save("votc8c-987654321098", { ...saved, text: "wrong campaign" }), /campaign_changed/);
  assert.equal(store.read("votc8c-987654321098").text, "");
  const file = path.join(store.root, `${backgroundCampaignKey(token)}.json`);
  const before = fs.readFileSync(file);
  let checks = 0;
  assert.throws(() => store.save(token, request("cancelled before commit"), () => ++checks === 1), /campaign_changed/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(fs.readdirSync(store.root), [path.basename(file)], "a refused commit leaves no temp files");
  store.save(token, request(" \n\t"));
  assert.equal(store.read(token).text, "");

  let builds = 0;
  for (const { id } of CASES) {
    for (const mode of ["legacy", "shadow", "v9"]) {
      const fixture = createFixture(id), runtime = createPromptRuntime(path.resolve(__dirname, "../src/app/main"), fixture);
      const build = context => runtime.PromptBuilder.buildMessagesWithTokenCount(fixture.history, fixture.responder, fixture.gameData,
        fixture.summary, context, fixture.definition.providerConfig, { promptPlanMode: mode });
      const baseline = build(fixture.memoryContext);
      const blank = build({ ...fixture.memoryContext, worldBackground: { ...empty, text: "" } });
      assert.deepEqual(blank.messages, baseline.messages, `${id}/${mode}: unset background must preserve all message bytes`);
      assert.deepEqual(blank.blocks, baseline.blocks, `${id}/${mode}: no new empty block, span or budget accounting`);
      const background = { ...saved, text: full };
      const context = { ...fixture.memoryContext, worldBackground: background };
      const populated = build(context);
      const block = populated.blocks.find(item => item.block.id === "campaign-background-v9.7.1");
      assert.equal(block.block.lifecycle, "CONVERSATION_FROZEN");
      assert(block.content.endsWith(full), "complete 3000-code-point background is preserved");
      assert.equal(populated.messages.filter(message => message.content === backgroundPrompt(background)).length, 1);
      assert.equal(populated.messages.find(message => message.content === block.content).role, "system");
      const dynamicIndex = populated.blocks.findIndex(item => item.block.stable !== true);
      assert(populated.blocks.indexOf(block) < dynamicIndex, "background precedes volatile conversation context");
      assert.deepEqual(build(context).messages, populated.messages, "rebuild does not mutate the stable background or prefix");
      const withoutMemory = runtime.PromptBuilder.buildMessagesWithTokenCount(fixture.history, fixture.responder, fixture.gameData,
        fixture.summary, context, fixture.definition.providerConfig, { promptPlanMode: mode, memoryMode: "exclude" });
      assert(withoutMemory.messages.some(message => message.content === block.content), "world premise is retained in memory budget probes");
      const constrained = runtime.planRequestBudget({ messages: populated.messages, capabilities: { contextWindow: 1024, maxOutputTokens: 128 },
        requestedOutputTokens: 128, countTokens: messages => runtime.TokenCounter.calculateTotalTokens(messages) });
      assert.equal(constrained.safe, false, "insufficient capacity refuses the full request instead of dropping the setting");
      builds++;
    }
  }
  const fixture = createFixture("v813-success-frozen"), runtime = createPromptRuntime(path.resolve(__dirname, "../src/app/main"), fixture);
  const legalReference = { period: "合法当前世界", context: "VERIFIED_GAME_HISTORY_REFERENCE", notableEvents: [], notableFigures: [] };
  let observedReference;
  const render = runtime.PromptBuilder.templateEngine.renderTemplateString;
  runtime.PromptBuilder.templateEngine.renderTemplateString = function(template, context) {
    if (context?.gameData?.historicalReferenceInfo) observedReference = context.gameData.historicalReferenceInfo;
    return render.call(this, template, context);
  };
  runtime.PromptBuilder.buildMessagesWithTokenCount(fixture.history, fixture.responder, fixture.gameData, fixture.summary,
    { ...fixture.memoryContext, worldBackground: { ...saved, text: "架空世界" }, historicalReferenceInfo: legalReference }, fixture.definition.providerConfig);
  assert.equal(observedReference, legalReference, "a valid supplied historical reference is retained");
  console.log(`PASS V9.7.1 campaign background: persistence, character limit, stale/scope/commit rejection; ${builds} layout/mode byte-preservation and stable-prefix cases`);
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("votc-v971-background-"));
  fs.rmSync(root, { recursive: true, force: true });
}
