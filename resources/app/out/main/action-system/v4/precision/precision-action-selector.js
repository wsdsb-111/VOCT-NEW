"use strict";

const contextBuilder = require("./precision-context-builder");
const prompt = require("./precision-selector-prompt");
const selectorSchema = require("../proposal/action-selector-schema");
const availableActionCatalog = require("../catalog/available-action-catalog");
const cacheAnalytics = require("../analytics/selector-cache-analytics");

function promptBlocks(messages, telemetry) {
  return messages.map((message, index) => ({
    id: index === 0 ? "ae4-stable-prefix" : index === 1 ? "ae4-p2-dynamic" : "ae4-selection-request",
    label: index === 0 ? "AE4 Stable Prefix" : index === 1 ? "AE4 P2 Dynamic Context" : "AE4 Selection Request",
    type: index === 0 ? "action_stable" : "action_dynamic",
    position: index,
    fingerprint: index === 0 ? telemetry.stablePrefixHash : index === 1 ? telemetry.p2ContextHash : cacheAnalytics.hash(message.content)
  }));
}

async function select({ conversation, speaker, message, catalog, registry, llmManager, settingsRepository, analytics, signal, mode }) {
  const context = contextBuilder.build({ conversation, speaker, message, catalog });
  const promptBuild = prompt.buildMessages({ actions: registry.getAllActions(false), context });
  const serializedCatalog = availableActionCatalog.serialize(catalog);
  const serializedContext = contextBuilder.serialize(context);
  const telemetry = cacheAnalytics.build({ stablePrefix: promptBuild.stable, availableCatalog: serializedCatalog, context: serializedContext });
  const provider = settingsRepository.getActionsProviderConfig?.() || {};
  let output;
  try {
    output = await llmManager.sendActionsRequest(promptBuild.messages, "votc_ae4_q2", selectorSchema.jsonSchema, signal, {
      requestType: "action",
      engineVersion: "4.0",
      actionSystemMode: mode,
      actionStage: "precision_selector",
      messageId: message.id,
      provider: provider.providerType || null,
      model: provider.defaultModel || null,
      ...telemetry,
      cachedInputTokens: null,
      uncachedInputTokens: null,
      cacheHitRate: null,
      blocks: promptBlocks(promptBuild.messages, telemetry)
    });
  } catch (error) {
    analytics?.record?.({ requestType: "action_v4_selector_failure", engineVersion: "4.0", actionSystemMode: mode, messageId: message.id, failureReason: error instanceof Error ? error.message : String(error), ...telemetry }, null);
    return { valid: false, reason: "selector_transport_failure", decisions: [] };
  }
  if (signal?.aborted) return { valid: false, reason: "selector_aborted", decisions: [] };
  const content = output && typeof output.content === "string" ? output.content : null;
  if (!content) {
    analytics?.record?.({ requestType: "action_v4_selector_failure", engineVersion: "4.0", actionSystemMode: mode, messageId: message.id, failureReason: "empty_q2_response", ...telemetry }, null);
    return { valid: false, reason: "empty_q2_response", decisions: [] };
  }
  const parsed = selectorSchema.parse(content);
  if (!parsed.valid) {
    analytics?.record?.({ requestType: "action_v4_selector_failure", engineVersion: "4.0", actionSystemMode: mode, messageId: message.id, failureReason: parsed.reason, ...telemetry }, null);
    return { valid: false, reason: parsed.reason, decisions: [] };
  }
  return { valid: true, decisions: parsed.decisions, context, telemetry };
}

module.exports = { promptBlocks, select };
