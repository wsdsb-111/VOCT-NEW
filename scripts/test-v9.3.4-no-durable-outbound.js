"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const conversationSource = fs.readFileSync(path.join(root, "src/app/main/conversation/conversation.js"), "utf8");
const { LLMManager } = require(path.join(root, "src/app/main/provider-service.js"));

async function testDurableRequestIsRejectedBeforeProviderLookup() {
  const providerConfigLookups = [];
  const transportCalls = [];
  const manager = new LLMManager({
    settingsRepository: {
      getActiveProviderConfig: () => { providerConfigLookups.push("CHAT"); return null; },
      getActionsProviderConfig: () => { providerConfigLookups.push("ACTION"); return null; },
      getSummaryProviderConfig: () => { providerConfigLookups.push("SUMMARY"); return null; }
    },
    providerRegistry: {},
    usageAnalytics: {}
  });
  manager.getRouteProviderConfig = () => { providerConfigLookups.push("ROUTE"); return null; };
  manager.generate = () => { transportCalls.push("generate"); };

  const requests = [
    () => manager.sendChatRequest([], undefined, false, { requestType: "memory4_durable" }),
    () => manager.sendActionsRequest([], "", {}, undefined, { requestType: "memory4_durable" }),
    () => manager.sendSummaryRequest("synthetic durable prompt", undefined, { requestType: "memory4_durable" })
  ];
  for (const send of requests) {
    await assert.rejects(send, { message: "memory4_durable_retired" });
  }

  assert.deepStrictEqual(providerConfigLookups, [], "retired Durable requests must stop before provider selection");
  assert.deepStrictEqual(transportCalls, [], "retired Durable requests must never reach provider transport");
}

function testConversationHasNoDurableCallbacksOrRecompression() {
  assert.doesNotMatch(conversationSource, /requestDurable\s*:/, "conversation finalization and recovery must not expose Durable callbacks");
  assert.doesNotMatch(conversationSource, /queueLegacyRecompression|recompressLegacy/, "Legacy recall must not trigger paid recompression");
  assert.doesNotMatch(conversationSource, /memory4|Memory4|disclosureProfiles/i, "conversation must not depend on Memory4 recall or disclosure sidecars");
}

function testProviderServiceKeepsGenericBeforeSendGuardAfterRetirementGate() {
  const providerSource = fs.readFileSync(path.join(root, "src/app/main/provider-service.js"), "utf8");
  assert.strictEqual((providerSource.match(/requestType === "memory4_durable"/g) || []).length, 1, "provider service should retain only the hard retirement gate");
  assert.doesNotMatch(providerSource, /durableRequestTrace|durableTrace|durableNativeUsage/, "provider service must not retain Durable tracing");
  assert.match(providerSource, /metadata\.beforeSendGuard\?\.\(\)/, "the generic pre-send guard remains available to non-Durable requests");

  for (const method of ["sendChatRequest", "sendActionsRequest", "sendSummaryRequest"]) {
    const start = providerSource.indexOf(`async ${method}(`);
    assert.notStrictEqual(start, -1, `${method} must exist`);
    const end = providerSource.indexOf("\n  async ", start + 1);
    const body = providerSource.slice(start, end === -1 ? undefined : end);
    const retirementGate = body.indexOf("rejectRetiredDurableOutbound(metadata.requestType)");
    const providerSelection = Math.min(...[
      body.indexOf("getActiveProviderConfig("),
      body.indexOf("getActionsProviderConfig("),
      body.indexOf("getRouteProviderConfig(")
    ].filter(index => index >= 0));
    const requestControl = body.indexOf("this.createControl(");
    assert(retirementGate >= 0 && retirementGate < providerSelection && retirementGate < requestControl,
      `${method} must reject retired Durable before selecting a provider or reaching the generic pre-send guard`);
  }
}

async function main() {
  await testDurableRequestIsRejectedBeforeProviderLookup();
  testConversationHasNoDurableCallbacksOrRecompression();
  testProviderServiceKeepsGenericBeforeSendGuardAfterRetirementGate();
  console.log("V9.3.4 no Durable outbound checks passed.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
