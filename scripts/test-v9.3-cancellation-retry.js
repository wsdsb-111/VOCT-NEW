"use strict";
const assert = require("node:assert/strict");
const { createRequestControl, awaitWithSignal } = require("../src/app/main/providers/provider-cancellation");
const { retryOperation } = require("../src/app/main/providers/provider-retry-policy");
const { ProviderPlatformFacade } = require("../src/app/main/providers/provider-platform");
const { classifyProviderError, toProviderError } = require("../src/app/main/providers/provider-errors");
const { buildProviderCapabilities } = require("../src/app/main/providers/provider-capabilities");
const { LLMManager, TokenCounter } = require("../src/app/main/provider-service");
const config = { providerType: "deepseek", defaultModel: "synthetic" };
const request = { model: "synthetic", messages: [{ role: "user", content: "synthetic only" }], stream: false };
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
