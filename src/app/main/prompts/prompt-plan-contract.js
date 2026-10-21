"use strict";

const { createHmac, randomBytes } = require("node:crypto");
const { requirePlan } = require("./prompt-plan-errors");
const fingerprintKey = randomBytes(32);
const SCHEMA_VERSION = "prompt_plan_v9_1";
const KINDS = Object.freeze(["GLOBAL_STATIC", "CONVERSATION_FROZEN", "RESPONDER_FROZEN",
  "APPEND_ONLY_HISTORY", "DYNAMIC_WORLDLINE", "QUERY_DYNAMIC_MEMORY", "CURRENT_TURN"]);
const STATES = Object.freeze(["STATIC", "FROZEN", "APPEND_ONLY", "DYNAMIC"]);
const ROLES = Object.freeze(["system", "user", "assistant", "tool", "function"]);

/**
 * @typedef {"GLOBAL_STATIC"|"CONVERSATION_FROZEN"|"RESPONDER_FROZEN"|"APPEND_ONLY_HISTORY"|"DYNAMIC_WORLDLINE"|"QUERY_DYNAMIC_MEMORY"|"CURRENT_TURN"} PromptKind
 * @typedef {{campaignToken: string|null, conversationId: string|null, ownerId: number|null, responderId: number|null,
 * playerId: number|null, conversationEpoch: number|null, logicalTurnEpoch: number|null, sourceSnapshotId: string|null}} PromptScope
 * @typedef {{status: "AUTHORIZED", ownerId: number|null, campaignToken: string|null, sourceRefs: string[],
 * authorizedAtRevision: string|null, visibility: string}} PromptPermission
 * @typedef {{id: string, kind: PromptKind, legacyBlockId: string, role: string, content: string, order: number,
 * messages: Object[], permission: PromptPermission, lifecycle: {state: string, freezeScope: string, invalidationRevision: string|null},
 * cache: {stableCandidate: boolean, prefixEligible: boolean, contentFingerprint: string}, tokens: {estimated: number, source: "LOCAL_ESTIMATE"}}} PromptBlock
 * @typedef {{schemaVersion: "prompt_plan_v9_1", planId: string, requestType: string, layoutId: string,
 * layoutRevision: string, scope: PromptScope, providerRoute: Object, inputRevisions: Object,
 * blocks: PromptBlock[], messageGroups: Object[], budget: Object, diagnostics: Object}} PromptPlan
 */

// Process-local HMACs are diagnostic identities, never a persistent authority proof.
function fingerprint(value) {
  return createHmac("sha256", fingerprintKey).update(JSON.stringify(value)).digest("hex");
}

function planSeal(plan) {
  return fingerprint([plan.schemaVersion, plan.requestType, plan.layoutId, plan.layoutRevision,
    plan.promptProfileId, plan.scope, plan.providerRoute, plan.inputRevisions, plan.blocks, plan.messageGroups, plan.budget]);
}

/** Validate an authorized request-scoped plan. The verifier remains the existing authority service. */
function validatePromptPlan(plan, { phase = "BUILD", proofVerifier } = {}) {
  requirePlan(plan?.schemaVersion === SCHEMA_VERSION, "PLAN_SCHEMA_INVALID");
  requirePlan(typeof plan.layoutId === "string" && typeof plan.layoutRevision === "string", "PLAN_LAYOUT_INVALID");
  requirePlan(typeof plan.requestType === "string" && plan.scope && plan.inputRevisions && plan.budget, "PLAN_SCOPE_MISSING");
  requirePlan(Array.isArray(plan.blocks) && Array.isArray(plan.messageGroups), "PLAN_MESSAGE_SPAN_MISSING");
  const ids = new Set();
  for (const [order, block] of plan.blocks.entries()) {
    requirePlan(typeof block.id === "string" && block.id.length > 0 && !ids.has(block.id), "PLAN_BLOCK_ID_INVALID");
    ids.add(block.id);
    requirePlan(block.order === order && KINDS.includes(block.kind), "PLAN_BLOCK_ORDER_INVALID");
    requirePlan(ROLES.includes(block.role) && typeof block.content === "string", "PLAN_BLOCK_ROLE_INVALID");
    requirePlan(block.permission?.status === "AUTHORIZED" && Array.isArray(block.permission.sourceRefs)
      && block.permission.sourceRefs.length > 0, "PLAN_SOURCE_UNAUTHORIZED");
    requirePlan(block.permission.ownerId === plan.scope.ownerId
      && block.permission.campaignToken === plan.scope.campaignToken, "PLAN_SCOPE_MISMATCH");
    if (block.provenance != null) {
      const source = block.provenance;
      requirePlan(["SOURCE_BOUND", "SNAPSHOT_DERIVED", "TEMPLATE_STATIC", "LEGACY_OBSERVED", "UNKNOWN"].includes(source.evidenceLevel)
        && source.authority === "LEGACY_VERIFIER" && Number.isSafeInteger(source.sourceCount) && source.sourceCount >= 0
        && (source.evidenceLevel === "SOURCE_BOUND" ? source.sourceCount > 0 : source.sourceCount === 0)
        && Array.isArray(source.diagnosticIds) && source.diagnosticIds.every(id => typeof id === "string" && /^[a-f0-9]{64}$/.test(id))
        && Object.keys(source).every(key => ["evidenceLevel", "sourceCount", "diagnosticIds", "authority"].includes(key)), "PLAN_PROVENANCE_INVALID");
    }
    requirePlan(STATES.includes(block.lifecycle?.state), "PLAN_LIFECYCLE_INVALID");
    const expectedState = block.kind === "GLOBAL_STATIC" ? "STATIC"
      : ["CONVERSATION_FROZEN", "RESPONDER_FROZEN"].includes(block.kind) ? "FROZEN"
        : block.kind === "APPEND_ONLY_HISTORY" ? "APPEND_ONLY" : "DYNAMIC";
    requirePlan(block.lifecycle.state === expectedState, "PLAN_LIFECYCLE_INVALID");
    requirePlan(Array.isArray(block.messages), "PLAN_MESSAGE_SPAN_MISSING");
    for (const message of block.messages) requirePlan(message && ROLES.includes(message.role)
      && typeof message.content === "string", "PLAN_MESSAGE_INVALID");
    requirePlan(Number.isFinite(block.tokens?.estimated) && block.tokens.estimated >= 0
      && block.tokens.source === "LOCAL_ESTIMATE", "PLAN_TOKEN_ESTIMATE_INVALID");
    requirePlan(block.cache?.contentFingerprint === fingerprint([block.content, block.messages]), "PLAN_CONTENT_CHANGED");
  }
  if (phase === "PRE_SEND") {
    requirePlan(plan.diagnostics?.planFingerprint === planSeal(plan), "PLAN_CHANGED_BEFORE_SEND");
    if (plan.requestType === "chat") requirePlan(Number.isSafeInteger(plan.scope.ownerId) && plan.scope.ownerId > 0
      && plan.scope.ownerId === plan.scope.responderId && plan.scope.campaignToken != null
      && typeof plan.scope.conversationId === "string" && plan.scope.conversationId.length > 0, "PLAN_SCOPE_MISSING");
    requirePlan(typeof proofVerifier === "function", "PLAN_SOURCE_VERIFIER_REQUIRED");
    const verification = proofVerifier(plan);
    requirePlan(verification === true || verification?.valid === true, "PLAN_SOURCE_REVOKED");
  }
  return { ok: true, reasonCodes: [], checkedRevision: plan.inputRevisions.source };
}

module.exports = { SCHEMA_VERSION, KINDS, STATES, ROLES, fingerprint, planSeal, validatePromptPlan };
