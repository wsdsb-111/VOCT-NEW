"use strict";

const { SCHEMA_VERSION, fingerprint, planSeal } = require("./prompt-plan-contract");
const { requirePlan } = require("./prompt-plan-errors");
const { orderPlanBlocks, COMPAT_REVISION, STATIC_FIRST_REVISION } = require("./prompt-plan-layouts");
const writesByMessages = new WeakMap();

function trackMessages(messages) {
  if (writesByMessages.has(messages)) return writesByMessages.get(messages);
  const writes = [];
  const push = messages.push;
  Object.defineProperty(messages, "push", { configurable: true, value(...items) {
    const start = this.length;
    const result = push.apply(this, items);
    if (items.length) writes.push({ start, end: this.length });
    return result;
  } });
  writesByMessages.set(messages, writes);
  return writes;
}

/** Record message ownership while writing, including repeated text and multi-message scripts. */
function captureBlockSpans(messages, build) {
  const writes = trackMessages(messages);
  const firstWrite = writes.length;
  const start = messages.length;
  const result = build();
  const entries = Array.isArray(result) ? result : result ? [result] : [];
  let cursor = firstWrite;
  for (const entry of entries) {
    if (entry.messageSpan) {
      while (cursor < writes.length && writes[cursor].end <= entry.messageSpan.end) cursor++;
    } else if (entry.error || entry.deferredAccountingOnly === true) {
      entry.messageSpan = { start: cursor < writes.length ? writes[cursor].start : messages.length,
        end: cursor < writes.length ? writes[cursor].start : messages.length };
    } else {
      requirePlan(cursor < writes.length || !entry.content, "PLAN_MESSAGE_SPAN_MISSING");
      entry.messageSpan = cursor < writes.length ? { ...writes[cursor++] } : { start, end: start };
    }
  }
  requirePlan(cursor === writes.length, "PLAN_MESSAGE_SPAN_UNCOVERED");
  return result;
}

function createPromptAssembly() {
  const messages = [];
  const writes = trackMessages(messages);
  const blocks = [];
  let cursor = 0;
  let writeIndex = 0;
  Object.defineProperty(blocks, "push", { value(...entries) {
    for (const entry of entries) {
      if (!entry.messageSpan) {
        requirePlan(writeIndex < writes.length || entry.error || !entry.content, "PLAN_MESSAGE_SPAN_MISSING");
        entry.messageSpan = writeIndex < writes.length ? { ...writes[writeIndex] } : { start: cursor, end: cursor };
      }
      requirePlan(entry.messageSpan.start === cursor && entry.messageSpan.end <= messages.length, "PLAN_MESSAGE_SPAN_INVALID");
      cursor = entry.messageSpan.end;
      while (writeIndex < writes.length && writes[writeIndex].end <= cursor) writeIndex++;
    }
    return Array.prototype.push.apply(this, entries);
  } });
  return { messages, blocks };
}

function classifyBlock(definition, memoryContext) {
  const type = definition.type;
  if (type === "history") return "APPEND_ONLY_HISTORY";
  if (["current_user", "instruction", "action_confirmed_context"].includes(type) || definition.id === "suffix") return "CURRENT_TURN";
  if (definition.semanticKind && ["main_segment", "memory_dynamic_frozen"].includes(type)) return definition.semanticKind;
  if (["description", "examples", "custom", "main_segment", "main"].includes(type)) return "DYNAMIC_WORLDLINE";
  if (type === "cache_anchor" || definition.lifecycle === "GLOBAL_STATIC") return "GLOBAL_STATIC";
  if (definition.lifecycle === "CONVERSATION_FROZEN") return "CONVERSATION_FROZEN";
  if (type === "memory_dynamic_frozen") {
    return memoryContext?.pairMemoryMetrics?.pendingDynamicCount > 0 ? "QUERY_DYNAMIC_MEMORY" : "RESPONDER_FROZEN";
  }
  if (definition.lifecycle === "RESPONDER_FROZEN") return "RESPONDER_FROZEN";
  if (definition.lifecycle === "DYNAMIC") return type?.startsWith("memory_") ? "QUERY_DYNAMIC_MEMORY" : "DYNAMIC_WORLDLINE";
  if (["memory_direct_frozen", "memory_player_ledger_frozen", "memory_official_recollection", "memory_stable"].includes(type)) return "RESPONDER_FROZEN";
  if (type?.startsWith("memory_") || ["memories", "past_summaries", "third_party_evidence"].includes(type)) return "QUERY_DYNAMIC_MEMORY";
  return "DYNAMIC_WORLDLINE";
}

/** Consume only the authorized build's explicit spans; this module performs no source reads or commits. */
function buildPromptPlanV9({ authorizedInputs, requestType = "chat", layoutId, promptProfileId,
  scope = {}, revisionSnapshot = {}, providerConfig = {}, promptSettings = {}, memoryContext = null,
  mode = "legacy", estimateTokens = text => Math.ceil(text.length / 4) }) {
  const { messages, blocks: entries } = authorizedInputs;
  const inputRevisions = { promptSettings: fingerprint(promptSettings), conversation: null, memory: null,
    knowledge: null, worldline: null, source: null, ...revisionSnapshot };
  const normalizedScope = { campaignToken: null, conversationId: null, ownerId: null, responderId: null,
    playerId: null, conversationEpoch: null, logicalTurnEpoch: null, sourceSnapshotId: null, ...scope };
  const expanded = [];
  let originalCursor = 0;
  for (const entry of entries) {
    const span = entry.messageSpan;
    requirePlan(span && span.start === originalCursor && Number.isInteger(span.end)
      && span.end >= span.start && span.end <= messages.length, "PLAN_MESSAGE_SPAN_INVALID");
    originalCursor = span.end;
    const definition = entry.block;
    const ownedMessages = messages.slice(span.start, span.end).map(message => ({ ...message }));
    if ((entry.error || entry.deferredAccountingOnly === true) && ownedMessages.length === 0) continue;
    const committed = memoryContext?.committedDynamicPlanSources;
    const pending = memoryContext?.pendingDynamicPlanSources;
    if (mode === "v9" && definition.type === "memory_dynamic_frozen" && Array.isArray(committed) && Array.isArray(pending)) {
      const combined = [...committed, ...pending].map(source => source.frozenText).filter(Boolean).join("\n\n");
      requirePlan(combined === entry.content, "PLAN_FROZEN_SOURCE_PROJECTION_MISMATCH");
      for (const [sources, kind, id] of [[committed, "RESPONDER_FROZEN", definition.id],
        [pending, "QUERY_DYNAMIC_MEMORY", "memory-dynamic-pending"]]) {
        const content = sources.map(source => source.frozenText).filter(Boolean).join("\n\n");
        if (content) expanded.push({ entry: { ...entry, content, tokens: estimateTokens(content),
          block: { ...definition, id, semanticKind: kind } }, ownedMessages: [{ role: "system", content }],
          sourceRefs: sources.map(source => fingerprint(source.key)) });
      }
    } else expanded.push({ entry, ownedMessages });
  }
  requirePlan(originalCursor === messages.length, "PLAN_MESSAGE_SPAN_UNCOVERED");
  const blocks = expanded.map(({ entry, ownedMessages, sourceRefs }) => {
    const definition = entry.block;
    const kind = classifyBlock(definition, memoryContext);
    const stableCandidate = ["GLOBAL_STATIC", "CONVERSATION_FROZEN", "RESPONDER_FROZEN"].includes(kind);
    const sourceKind = ["custom", "examples", "description", "main", "main_segment"].includes(definition.type)
      ? "CUSTOM_LEGACY" : kind === "GLOBAL_STATIC" ? "TEMPLATE" : "AUTHORIZED_INPUT_SNAPSHOT";
    const revision = kind === "GLOBAL_STATIC" ? inputRevisions.promptSettings : inputRevisions.source;
    return { id: definition.id, legacyBlockId: definition.id, legacyType: definition.type, label: definition.label,
      kind, role: ownedMessages[0]?.role || definition.role || "system", content: String(entry.content ?? ""), order: 0,
      messages: ownedMessages,
      permission: { status: "AUTHORIZED", sourceKind, ownerId: normalizedScope.ownerId, campaignToken: normalizedScope.campaignToken,
        sourceRefs: sourceRefs?.length ? sourceRefs : [fingerprint([sourceKind, definition.id, revision, normalizedScope.sourceSnapshotId])],
        authorizedAtRevision: revision, visibility: kind === "GLOBAL_STATIC" ? "GLOBAL" : "RESPONDER_ONLY" },
      lifecycle: { state: kind === "GLOBAL_STATIC" ? "STATIC" : stableCandidate ? "FROZEN" : kind === "APPEND_ONLY_HISTORY" ? "APPEND_ONLY" : "DYNAMIC",
        freezeScope: kind === "GLOBAL_STATIC" ? "NONE" : kind === "CONVERSATION_FROZEN" ? "CONVERSATION" : kind === "RESPONDER_FROZEN" ? "RESPONDER_IN_CONVERSATION" : "NONE",
        invalidationRevision: revision },
      cache: { stableCandidate, contentFingerprint: fingerprint([String(entry.content ?? ""), ownedMessages]), prefixEligible: stableCandidate },
      tokens: { estimated: Math.max(0, Number(entry.tokens) || 0), source: "LOCAL_ESTIMATE" } };
  });
  const ordered = orderPlanBlocks(blocks, { layoutId, mode }).map((block, order) => ({ ...block, order }));
  const messageGroups = ordered.flatMap(block => block.messages.map((message, index) => ({ parts: [{ blockId: block.id, index }], separator: "" })));
  const plan = { schemaVersion: SCHEMA_VERSION, planId: fingerprint([normalizedScope, inputRevisions, requestType]), requestType,
    layoutId, promptProfileId, layoutRevision: mode === "v9" ? STATIC_FIRST_REVISION : COMPAT_REVISION,
    scope: normalizedScope, providerRoute: { providerType: providerConfig?.providerType || null,
      modelId: providerConfig?.defaultModel || null, routeKind: requestType }, inputRevisions,
    blocks: ordered, messageGroups,
    budget: { configuredContextTokens: null, effectiveInputBudgetTokens: null, reservedOutputTokens: null,
      safetyMarginTokens: null, estimatedInputTokens: null, memoryBudgetTokens: memoryContext?.tokenBudget ?? null },
    diagnostics: { onlyOpaqueFingerprints: true, planFingerprint: null,
      lifecycleCounts: Object.fromEntries([...new Set(ordered.map(block => block.kind))].map(kind => [kind, ordered.filter(block => block.kind === kind).length])) } };
  plan.diagnostics.planFingerprint = planSeal(plan);
  return plan;
}

module.exports = { buildPromptPlanV9, createPromptAssembly, captureBlockSpans };
