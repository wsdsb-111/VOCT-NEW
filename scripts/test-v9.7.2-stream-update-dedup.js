"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { makeConversation } = require("./test-v9.4-conversation-plan-main-chain");

async function runStreamCase(providerType, cancel) {
  const { conversation, npc, counts } = makeConversation();
  let phase = "setup";
  let actions = 0;
  let actionResults = 0;
  let usageTailConsumed = false;
  const updates = [];
  conversation.contextBudgetDiagnostics = { contextWindow: 32768, providerMaxOutputTokens: 4096 };
  conversation.contextUsageSceneRevision = JSON.stringify([conversation.gameData.scene || null,
    conversation.gameData.location || null, conversation.gameData.locationController || null]);
  conversation.emitUpdate = () => {
    const message = conversation.messages.find(entry => entry.isStreaming);
    updates.push({ phase, status: message?.streamStatus, content: message?.content });
  };
  Conversation.configure({
    settingsRepository: {
      getActiveProviderConfig: () => ({ providerType, defaultModel: "synthetic-stream" }),
      getGlobalStreamSetting: () => true,
      getChatPromptV813Layout: () => true,
      getGenerateFollowingMessagesSetting: () => true,
      getPauseOnRegenerationSetting: () => false
    },
    ActionEngine: { async evaluateForCharacter() { actions++; return { autoApproved: [], needsApproval: [] }; } },
    llmManager: {
      async sendChatRequest(messages, signal) {
        assert(signal instanceof AbortSignal, `${providerType}: cancellation must reach transport`);
        return (async function* () {
          phase = "initial-reasoning";
          for (let index = 0; index < 2000; index++) yield { delta: { reasoning: "hidden" } };
          phase = "content";
          yield { delta: { content: "甲" } };
          phase = "interleaved-reasoning";
          yield { delta: { reasoning: "hidden" } };
          yield { delta: { reasoning: "hidden" } };
          if (cancel) {
            phase = "cancel";
            conversation.getGenerationManager().cancelCurrent();
            assert.equal(signal.aborted, true);
          }
          phase = "final-content";
          yield { delta: { content: "乙" } };
          phase = "usage-only";
          yield { usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 } };
          usageTailConsumed = true;
          phase = "finished";
          return { content: "甲乙", finish_reason: "stop",
            usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 } };
        })();
      }
    }
  });
  conversation.handleActionResults = async () => { actionResults++; };
  const contextUsage = [];
  conversation.publishContextUsage = value => contextUsage.push(value);
  await conversation.respondAs(npc, conversation.turnEpoch);
  assert.equal(updates.filter(update => update.phase === "initial-reasoning").length, 0,
    `${providerType}: repeated hidden reasoning must not broadcast unchanged full history`);
  assert.deepEqual(updates.filter(update => update.phase === "interleaved-reasoning"),
    [{ phase: "interleaved-reasoning", status: "thinking", content: "甲" }],
    "content → reasoning must still broadcast the actual state change exactly once");
  assert.deepEqual(updates.filter(update => update.phase === "content"),
    [{ phase: "content", status: "generating", content: "甲" }]);
  if (cancel) {
    assert.equal(conversation.messages.some(entry => entry.content === "甲乙" || entry.isStreaming), false);
    assert.equal(actions, 0);
    assert.equal(actionResults, 0);
    assert.equal(counts.retained.length, 0, "cancelled requests must not commit memory success receipts");
  } else {
    assert.deepEqual(updates.filter(update => update.phase === "final-content"),
      [{ phase: "final-content", status: "generating", content: "甲乙" }]);
    assert.equal(updates.filter(update => update.phase === "usage-only").length, 0);
    assert.equal(usageTailConsumed, true, "usage-only tail and final response must be drained");
    assert.equal(actions, 1);
    assert.equal(actionResults, 1);
    assert.equal(counts.retained.length, 1);
    const message = conversation.messages.find(entry => entry.content === "甲乙");
    assert(message && !message.isStreaming && !message.streamStatus);
    const completedUsage = contextUsage.find(value => value.phase === "completed");
    assert(completedUsage, "completed stream must publish its final context usage");
    assert.equal(completedUsage.inputTokens, 100);
    assert.equal(completedUsage.outputTokens, 8);
  }
}

function checkRendererMappings() {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/app/renderer/assets/index-Dn3qWlAB.js"), "utf8");
  const mappings = [...source.matchAll(/const convertedEntries = backendEntries\.map\(\(entry\) => \{([\s\S]*?)\n\s*\}\);/g)];
  assert.equal(mappings.length, 2, "exercise both initial history and live event conversions");
  for (const [, body] of mappings) {
    const convert = vm.runInNewContext(`(backendEntries) => backendEntries.map((entry) => {${body}\n})`);
    for (const streamStatus of ["thinking", "generating", undefined]) {
      const [message] = convert([{ id: 1, type: "message", role: "assistant", content: "visible",
        datetime: "2000-01-01T00:00:00.000Z", isStreaming: !!streamStatus, streamStatus }]);
      assert.equal(message.streamStatus, streamStatus, "Renderer must preserve the backend stream status");
      assert.equal(message.content, "visible");
    }
  }
}

(async () => {
  for (const providerType of ["zhipu", "openrouter"]) {
    await runStreamCase(providerType, false);
    await runStreamCase(providerType, true);
  }
  checkRendererMappings();
  console.log("PASS stream updates: 2000 unchanged reasoning chunks → 0 redundant history broadcasts; interleaving, content, cancellation, usage tail, actions, memory receipt and both Renderer mappings");
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
