"use strict";

const selectorSchema = require("../proposal/action-selector-schema");
const pendingStore = require("../pending/explicit-pending-store");
const availableActionCatalog = require("../catalog/available-action-catalog");
const { compactDictionary } = require("../catalog/master-action-dictionary");
const cacheAnalytics = require("../analytics/selector-cache-analytics");

const COMPACT_RULES = `AE4_PERFORMANCE_COMPACT_SELECTOR_v2
Return only Q2 JSON. Select 0 to 2 decisions caused by CURRENT_MESSAGE.
Use only AVAILABLE_ACTIONS and listed participants. Never invent targets or required arguments.
Do not execute questions, conditions, hypotheticals, plans, past reports, failed attempts, or unaccepted proposals.
Use LAST_DIALOGUE only for references, target, amount, arguments, or a short pending response.
For consent_required actions, action_call creates Pending; acceptance/rejection/defer must use pending_response.
Confidence is analytics only. evidenceMessageIds must come from CURRENT_MESSAGE or LAST_DIALOGUE.
Follow each Action's sourceRole, targetRole, and targetPolicy exactly. Passive voice does not swap Action-contract roles.
Use the same MASTER_COMPACT_ACTION_DICTIONARY and Q2 schema as Precision.`;

function build({ conversation, speaker, message, catalog, registry }) {
  const previous = (conversation.messages || []).filter((entry) => ["user", "assistant"].includes(entry?.role) && String(entry.id) !== String(message.id)).slice(-2).map((entry) => ({ id: entry.id, role: entry.role, name: entry.name || null, content: entry.content }));
  const stable = `${COMPACT_RULES}\nMASTER_COMPACT_ACTION_DICTIONARY\n${JSON.stringify(compactDictionary(registry.getAllActions(false)))}\nQ2_OUTPUT_SCHEMA\n${JSON.stringify(selectorSchema.jsonSchema)}`;
  const dynamicContext = {
    availableActions: JSON.parse(availableActionCatalog.serialize(catalog)),
    currentSpeaker: { id: speaker.id, name: speaker.shortName || speaker.fullName },
    targetCandidates: catalog.state.participants,
    pending: pendingStore.listActive(conversation),
    lastDialogue: previous,
    currentMessage: { id: message.id, role: message.role, name: message.name || null, content: message.content }
  };
  const dynamic = `AE4_COMPACT_DYNAMIC_CONTEXT\n${JSON.stringify(dynamicContext)}`;
  return { stable, dynamic, dynamicContext, messages: [{ role: "system", content: stable }, { role: "system", content: dynamic }, { role: "user", content: "Return 0 to 2 Q2 decisions for CURRENT_MESSAGE." }] };
}

async function select({ conversation, speaker, message, catalog, registry, llmManager, settingsRepository, analytics, signal, mode }) {
  const built = build({ conversation, speaker, message, catalog, registry });
  const serializedCatalog = availableActionCatalog.serialize(catalog);
  const telemetry = cacheAnalytics.build({ stablePrefix: built.stable, availableCatalog: serializedCatalog, context: JSON.stringify(built.dynamicContext) });
  let output;
  try {
    output = await llmManager.sendActionsRequest(built.messages, "votc_ae4_q2_compact", selectorSchema.jsonSchema, signal, {
      requestType: "action",
      engineVersion: "4.0",
      actionSystemMode: mode,
      actionStage: "performance_compact",
      messageId: message.id,
      compactSelector: true,
      ...telemetry,
      blocks: built.messages.map((entry, index) => ({ id: `ae4-compact-${index}`, label: index === 0 ? "AE4 Compact Stable Prefix" : "AE4 Compact Dynamic", type: index === 0 ? "action_stable" : "action_dynamic", position: index, fingerprint: cacheAnalytics.hash(entry.content) }))
    });
  } catch (error) {
    analytics?.record?.({ requestType: "action_v4_selector_failure", engineVersion: "4.0", actionSystemMode: mode, messageId: message.id, actionStage: "performance_compact", failureReason: error instanceof Error ? error.message : String(error) }, null);
    return { valid: false, reason: "selector_transport_failure", decisions: [] };
  }
  const parsed = selectorSchema.parse(output && typeof output.content === "string" ? output.content : "");
  if (!parsed.valid) return { valid: false, reason: parsed.reason, decisions: [] };
  return { valid: true, decisions: parsed.decisions.slice(0, 2), telemetry };
}

module.exports = { COMPACT_RULES, build, select };
