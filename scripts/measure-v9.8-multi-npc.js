"use strict";

const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { setTimeout: wait } = require("node:timers/promises");
const { makeConversation } = require("./test-v9.4-conversation-plan-main-chain");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { createStartupPerformanceTrace } = require("../src/app/main/runtime/startup-performance-trace");

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = p => sorted.length ? Math.round(sorted[Math.ceil(p * sorted.length) - 1] * 100) / 100 : null;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}

async function measure({ npcCount, turns, historyPairs }) {
  const { conversation, fixture, npc } = makeConversation();
  const trace = createStartupPerformanceTrace({ enabled: true, maxEvents: 10000 });
  conversation.performanceTraceContext = trace.forConversation(conversation.id);
  const npcs = Array.from({ length: npcCount }, (_, ordinal) => ({
    ...npc, id: npc.id + ordinal, shortName: `测试回应者${ordinal + 1}`, fullName: `测试回应者${ordinal + 1}`
  }));
  for (const character of npcs) fixture.gameData.characters.set(character.id, character);
  conversation.getActiveConversationCharacters = () => [...fixture.gameData.characters.values()];
  conversation.fillNpcQueue = () => conversation.getTurnManager().fillQueue({ customQueue: npcs });
  conversation.resumeConversation = () => {};
  conversation.evaluateCompletedActions = async () => {};
  conversation.generationAttemptsByMessageId = new Map();
  const turnSamples = [], providerSamples = [], localSamples = [], outputLengths = [];
  let active = 0, round = 0, expectedOrdinal = 0, errors = 0;
  Conversation.configure({
    performanceTrace: trace,
    memoryEngine: { observeParticipants() {}, trace: { record() {} }, validatePlayerMemoryContext: () => ({ valid: true }) },
    ActionEngine: {},
    llmManager: {
      async sendChatRequest(messages, signal, _noStream, metadata) {
        assert.equal(active, 0, "the prior responder must finish before the next request");
        const ordinal = expectedOrdinal++;
        if (ordinal > 0) assert(messages.some(message => message.content.includes(`合成台词编号${round}-${ordinal}。`)));
        assert(metadata.promptPlanProof?.serialized?.messages);
        metadata.beforeSendGuard();
        const finish = trace.startSpan("provider.requestStart", { attribution: "PROVIDER", context: metadata.performanceTraceContext });
        const started = performance.now();
        active++;
        try {
          await wait(8, undefined, { signal });
          finish.mark("provider.firstByte");
          finish.mark("provider.firstVisibleToken");
          const content = `合成台词编号${round}-${ordinal + 1}。我们可以继续讨论这个话题。`;
          outputLengths.push(content.length);
          return { content, finish_reason: "stop" };
        } catch (error) {
          errors++;
          throw error;
        } finally {
          active--;
          providerSamples.push(performance.now() - started);
          finish({ step: "provider.streamEnd", result: signal.aborted ? "CANCELLED" : "OK" });
        }
      }
    }
  });
  for (let i = 0; i < historyPairs; i++) {
    conversation.messages.push({ id: conversation.nextId++, role: "user", speakerCharacterId: fixture.gameData.playerID,
      content: "历史合成对话，用于模拟较长已授权输入。" });
    conversation.messages.push({ id: conversation.nextId++, role: "assistant", speakerCharacterId: npc.id,
      content: "历史合成回应，内容与当前问题无关。" });
  }
  for (let i = 0; i < turns; i++) {
    round++;
    expectedOrdinal = 0;
    const started = performance.now(), providerStart = providerSamples.length;
    await conversation.sendMessage(`合成问题编号${i + 1}，请谈谈这件事。`);
    const priorCount = conversation.messages.filter(message => message.role === "assistant").length;
    await conversation.getTurnManager().processQueue();
    const elapsed = performance.now() - started;
    assert.equal(expectedOrdinal, npcCount);
    assert.equal(conversation.messages.filter(message => message.role === "assistant").length - priorCount, npcCount);
    turnSamples.push(elapsed);
    localSamples.push(elapsed - providerSamples.slice(providerStart).reduce((sum, item) => sum + item, 0));
  }
  const events = trace.snapshot().events;
  const sum = values => values.reduce((total, item) => total + item, 0);
  return { npcCount, turns, historyPairs, failures: errors, firstTurnMs: Math.round(turnSamples[0] * 100) / 100,
    warmTurnMs: summarize(turnSamples.slice(1)), localPerTurnMs: summarize(localSamples),
    syntheticProviderMs: summarize(providerSamples), syntheticProviderShare: Math.round(100 * sum(providerSamples) / sum(turnSamples)),
    queueWaitMs: summarize(events.filter(event => event.step === "conversation.queueWait").map(event => event.wallMs)),
    promptBuildMs: summarize(events.filter(event => event.step === "prompt.build").map(event => event.wallMs)),
    serializationMs: summarize(events.filter(event => event.step === "serialization").map(event => event.wallMs)),
    visibleLength: summarize(outputLengths), resourceSnapshot: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed } };
}

async function main() {
  const cases = [[1, 10, 0], [2, 10, 0], [3, 5, 0], [4, 3, 0], [3, 5, 70]];
  for (const [npcCount, turns, historyPairs] of cases) {
    const result = await measure({ npcCount, turns, historyPairs });
    console.log("V9.8 offline timing " + JSON.stringify(result));
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { measure };
