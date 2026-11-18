"use strict";
const assert = require("node:assert/strict");
const { mock } = require("node:test");
const { createRequestControl, awaitWithSignal } = require("../src/app/main/providers/provider-cancellation");
const { retryOperation } = require("../src/app/main/providers/provider-retry-policy");
const { ProviderPlatformFacade } = require("../src/app/main/providers/provider-platform");
const { classifyProviderError, toProviderError } = require("../src/app/main/providers/provider-errors");
const { buildProviderCapabilities } = require("../src/app/main/providers/provider-capabilities");
const { LLMManager, TokenCounter } = require("../src/app/main/provider-service");
const config = { providerType: "deepseek", defaultModel: "synthetic" };
const request = { model: "synthetic", messages: [{ role: "user", content: "synthetic only" }], stream: false };
async function verifyRouterTimeout(platform) {
  const watchdog = setTimeout(() => { throw new Error("OpenRouter timeout fixture hung"); }, 3000);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const config = { providerType: "openrouter", defaultModel: "synthetic" };
    for (const firstOutput of [false, true]) {
      let sends = 0;
      let transportSignal;
      const control = createRequestControl({ requestType: "chat" });
      const stream = await platform.generate({ async *chatCompletion(request, config, control) {
        control.beforeSend();
        sends++;
        transportSignal = request.signal;
        if (firstOutput) yield { delta: { content: "first reply" } };
        yield { delta: { reasoning: true } };
        await awaitWithSignal(new Promise(() => {}), transportSignal);
      } }, { ...request, stream: true }, config, { control });
      if (firstOutput) assert.equal((await stream.next()).value.delta.content, "first reply");
      const reasoning = stream.next();
      await new Promise(setImmediate);
      mock.timers.tick(firstOutput ? 44000 : 89000);
      assert.equal((await reasoning).value.delta.reasoning, true);
      const pending = assert.rejects(stream.next(), e => e.providerError.category === "TIMEOUT" && e.providerError.safeToReplay === false);
      mock.timers.tick(999);
      assert.equal(transportSignal.aborted, false);
      mock.timers.tick(1);
      await pending;
      assert.equal(transportSignal.aborted, true);
      assert.equal(sends, 1, "timeout cannot replay the request");
    }
  } finally { mock.timers.reset(); clearTimeout(watchdog); }
}
async function main() {
  let configured = null, providerCreations = 0;
  const manager = new LLMManager({ settingsRepository: { getActiveProviderConfig: () => configured,
    getActionsProviderConfig: () => configured, getSummaryProviderConfig: () => configured },
    providerRegistry: { createProvider: () => { providerCreations++; } }, usageAnalytics: { record() {} }, TokenCounter, PromptBuilder: {} });
  for (const value of [null, { providerType: "deepseek" }]) {
    configured = value;
    await assert.rejects(manager.sendChatRequest(request.messages), /provider|model/);
    await assert.rejects(manager.sendActionsRequest(request.messages, "votc_actions", {}), /provider|model/);
    await assert.rejects(manager.sendSummaryRequest(request.messages), /provider|model/);
  }
  assert.equal(providerCreations, 0, "missing config/model never instantiates a transport");
  let attempts = 0;
  await assert.rejects(retryOperation(async () => { attempts++; const e = new Error("private_server_payload"); e.status = 503; throw e; }, { initialDelay: 0, maxAttempts: 99 }), e => e.votcAttemptCount === 2);
  assert.equal(attempts, 2);
  const controller = new AbortController();
  attempts = 0;
  await assert.rejects(retryOperation(async () => { attempts++; const e = new Error("rate_limited"); e.status = 429; controller.abort(); throw e; }, { signal: controller.signal, initialDelay: 0 }), e => e.name === "AbortError");
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(retryOperation(async () => { attempts++; const e = new Error("private_network_payload"); e.code = "ECONNRESET"; throw e; }, { initialDelay: 0 }), /private_network_payload/);
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(retryOperation(async () => { attempts++; const e = new Error("long_retry"); e.status = 429; e.headers = { "retry-after": "31" }; throw e; }, { initialDelay: 0 }), /long_retry/);
  assert.equal(attempts, 1);
  const deadline = createRequestControl({ deadline: Date.now() + 20 });
  await assert.rejects(awaitWithSignal(new Promise(() => {}), deadline.signal), e => e.name === "TimeoutError");
  assert.equal(deadline.attemptCount, 0); deadline.dispose();
  let guards = 0, reservations = 0;
  const guard = createRequestControl({ beforeSend: () => { guards++; if (guards === 2) throw new Error("memory4_request_source_changed_before_send"); }, reserveAttempt: () => { reservations++; return true; } });
  guard.beforeSend(); assert.throws(() => guard.beforeSend(), /memory4_request_source_changed_before_send/);
  assert.equal(guard.attemptCount, 1); assert.equal(reservations, 1); guard.dispose();
  const budget = createRequestControl({ reserveAttempt: () => false });
  assert.throws(() => budget.beforeSend(), /provider_cost_budget_exceeded/); assert.equal(budget.attemptCount, 0); budget.dispose();
  const asyncReservation = createRequestControl({ reserveAttempt: async () => true });
  assert.throws(() => asyncReservation.beforeSend(), /provider_async_reservation_unsupported/); assert.equal(asyncReservation.attemptCount, 0); asyncReservation.dispose();
  const capabilities = buildProviderCapabilities(config, { contextWindow: 8192, maxOutputTokens: 2048 });
  capabilities.features.nonStreaming = { state: "UNSUPPORTED", source: "fixture" };
  const platform = new ProviderPlatformFacade();
  await verifyRouterTimeout(platform);
  const router = { providerType: "openrouter", defaultModel: "synthetic" };
  const routerManager = new LLMManager({ settingsRepository: { getActiveProviderConfig: () => router,
    getGlobalStreamSetting: () => false }, providerRegistry: { createProvider: () => ({
    async testConnection(config, control) {
      assert(control.deadline > Date.now() && control.deadline <= Date.now() + 30000);
      return { success: true };
    },
    async chatCompletion(request, config, control) {
      assert.equal(request.signal, control.signal);
      assert(control.deadline > Date.now() && control.deadline <= Date.now() + 120000);
      return { content: "ok", finish_reason: "stop" };
    }
  }) }, usageAnalytics: { record() {} }, TokenCounter, PromptBuilder: {} });
  routerManager.getProviderCapabilities = async () => ({ contextWindow: 8192, maxOutputTokens: 2048 });
  assert.equal((await routerManager.testProviderConnection()).success, true);
  assert.equal((await routerManager.sendChatRequest(request.messages)).content, "ok");
  attempts = 0;
  await assert.rejects(platform.generate({ chatCompletion: async () => { attempts++; return {}; } }, request, config, { capabilities }), e => e.providerError.category === "UNSUPPORTED");
  assert.equal(attempts, 0);
  const error = toProviderError(Object.assign(new Error("PRIVATE_KEY_SENTINEL"), { status: 429, headers: { "retry-after": "0.2" }, code: "PRIVATE_KEY_SENTINEL" }));
  assert.equal(error.providerError.retryAfterMs, 200); assert.equal(error.providerError.providerCode, null);
  assert.ok(!JSON.stringify(error).includes("PRIVATE_KEY_SENTINEL")); assert.ok(!error.message.includes("PRIVATE_KEY_SENTINEL"));
  assert.equal(classifyProviderError(Object.assign(new Error(), { status: 503 }), { responseStarted: true }).safeToReplay, false);
  console.log("V9.3 cancellation/retry: deadline, budget, guards, unsupported, privacy and bounded attempts passed");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
