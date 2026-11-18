"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.resolve(__dirname, "../resources/app/out/main/providers/index.js");
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(fs.readFileSync(path.resolve(__dirname, "../src/app/main/providers/index.js"), "utf8"), filename);
const { DeepseekProvider } = compiled.exports;
const config = { providerType: "deepseek", defaultModel: "fixture-deepseek", defaultParameters: { max_tokens: 8192 } };
(async () => {
  const provider = new DeepseekProvider();
  let calls = 0;
  provider.chatCompletion = async request => {
    calls++;
    assert.equal(request.stream, false);
    assert.equal(request.max_tokens, 128, "connection probe needs enough tokens to finish its short response");
    assert.deepEqual(request.thinking, { type: "disabled" }, "probe must not spend its small budget on reasoning");
    assert.equal(request.messages[0].content, "Reply with exactly: OK");
    return { id: "fixture", content: "OK", finish_reason: "stop" };
  };
  assert.equal((await provider.testConnection(config)).success, true);
  assert.equal(calls, 1);
  for (const response of [
    { content: "O", finish_reason: "length" },
    { content: "OK" },
    { content: "", finish_reason: "stop" }
  ]) {
    provider.chatCompletion = async () => response;
    assert.equal((await provider.testConnection(config)).success, false, "incomplete/empty responses cannot pass");
  }
  assert.equal(config.defaultParameters.max_tokens, 8192, "probe cannot overwrite user settings");
  const chat = provider.buildDiagnosticRequest({ model: config.defaultModel, messages: [{ role: "user", content: "chat" }],
    stream: true, max_tokens: 4096, thinking: { type: "enabled" } }, config);
  assert.equal(chat.max_tokens, 4096);
  assert.deepEqual(chat.thinking, { type: "enabled" }, "ordinary chat reasoning remains enabled");
  console.log("PASS DeepSeek connection probe: sufficient budget, probe-only thinking disabled, strict completion and unchanged chat");
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
