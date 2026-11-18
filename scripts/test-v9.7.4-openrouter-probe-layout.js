"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.resolve(__dirname, "../resources/app/out/main/providers/index.js");
const compiled = new Module(filename, module);
compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(fs.readFileSync(path.resolve(__dirname, "../src/app/main/providers/index.js"), "utf8"), filename);
const { OpenRouterProvider } = compiled.exports;
const { createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");
(async () => {
  const config = { providerType: "openrouter", defaultModel: "deepseek/deepseek-v4-flash-0731", apiKey: "fixture-key" };
  const provider = new OpenRouterProvider();
  let sent;
  provider._nonStreamChatCompletion = async request => {
    sent = request;
    return { id: "fixture", content: "OK", finish_reason: "stop" };
  };
  assert.equal((await provider.testConnection(config)).success, true);
  assert.equal(sent.max_tokens, 128);
  assert.deepEqual(sent.reasoning, { exclude: true, enabled: false });
  for (const response of [{ content: "O", finish_reason: "length" }, { content: "OK" }, { content: "", finish_reason: "stop" }]) {
    provider._nonStreamChatCompletion = async () => response;
    assert.equal((await provider.testConnection(config)).success, false);
  }
  provider._nonStreamChatCompletion = async request => { sent = request; return { content: "chat", finish_reason: "stop" }; };
  await provider.chatCompletion({ model: config.defaultModel, messages: [{ role: "user", content: "chat" }], stream: false, max_tokens: 8192 }, config);
  assert.deepEqual(sent.reasoning, { exclude: true }, "regular chat reasoning policy is unchanged");

  function sequence(providerConfig) {
    const fixture = createFixture("v813-success-frozen");
    fixture.memoryContext.worldBackground = { text: "SYNTHETIC CAMPAIGN BACKGROUND" };
    const runtime = createPromptRuntime(path.resolve(__dirname, "../src/app/main"), fixture);
    const build = () => runtime.PromptBuilder.buildMessagesWithTokenCount(fixture.history, fixture.responder, fixture.gameData,
      fixture.currentSessionSummary, fixture.memoryContext, providerConfig);
    const first = build();
    assert.equal(first.promptProfile.layoutId, "v813");
    const dynamic = first.blocks.findIndex(row => row.block.stable !== true);
    for (const id of ["campaign-background-v9.7.1", "memory-official-recollection", "memory-direct-frozen", "memory-player-ledger-frozen"]) {
      const index = first.blocks.findIndex(row => row.block.id === id);
      assert(index >= 0 && index < dynamic, `${id} must precede dynamic state and history`);
    }
    fixture.responder.gold = 987;
    fixture.history.push({ role: "user", content: "NEW DYNAMIC TURN" });
    const second = build();
    const prefix = result => result.blocks.filter(row => row.block.stable === true).map(row => row.content);
    assert.deepEqual(prefix(second), prefix(first), "same-scene frozen content survives live gold/history updates");
    assert(second.messages.some(message => message.content.includes("NEW DYNAMIC TURN")));
    assert(second.messages.some(message => message.content.includes("987")), "current state still updates");
    return [first.messages, second.messages];
  }
  assert.deepEqual(sequence(config), sequence({ providerType: "deepseek", defaultModel: "deepseek-v4-flash" }),
    "OpenRouter and DeepSeek must send identical frozen-first message bytes for the same scene");
  console.log("PASS OpenRouter probe and frozen-first layout: strict completion, probe-only reasoning control, DeepSeek byte parity and dynamic updates");
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
