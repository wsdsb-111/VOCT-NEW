"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const freeze = require("../src/app/main/memory-system/dynamic-summary-freeze");
const { buildPromptPlanV9, getPlanSourceBindings } = require("../src/app/main/prompts/prompt-plan-builder");
const { serializePromptPlan } = require("../src/app/main/prompts/prompt-plan-serializer");
const { validatePromptPlan } = require("../src/app/main/prompts/prompt-plan-contract");
const { preflightPromptPlan } = require("../src/app/main/prompts/prompt-plan-compat");
const { createEffectiveRequestSnapshot, fingerprintMessages } = require("../src/app/main/providers/effective-request");
const { createProviderDiagnostics } = require("../src/app/main/analytics/provider-diagnostics");
const { SCOPE } = require("./fixtures/v9.4/prompt-plan-security-fixture");
const PRIVATE_KEY = "C:\\private-user\\source-key-never-persist";
function projected(revision = "real-revision-7", scope = SCOPE) {
  return freeze.projectPlanSource({ sourceSummaryKey: PRIVATE_KEY, sourceRevision: revision, frozenText: "SYNTHETIC MEMORY BODY", memory: { provenance: { folderOwnerId: scope.ownerId, campaignToken: scope.campaignToken } } }, scope);
}
assert.equal(typeof freeze.projectPlanSource, "function", "trusted source projection must exist");
function build(committed = [], pending = [], scope = SCOPE) {
  const text = [...committed, ...pending].map(entry => entry.frozenText).join("\n\n");
  const entries = [
    { id: "anchor", type: "cache_anchor", content: "STATIC TEMPLATE" },
    ...(text ? [{ id: "memory-dynamic-frozen", type: "memory_dynamic_frozen", content: text }] : []),
    { id: "memory-direct-frozen", type: "memory_direct_frozen", content: "LEGACY BASELINE" },
    { id: "private-custom", type: "custom", content: "CUSTOM BODY" },
    { id: "turn", type: "current_user", content: "CURRENT QUESTION", role: "user" }
  ];
  const messages = entries.map(entry => ({ role: entry.role || "system", content: entry.content }));
  return buildPromptPlanV9({ authorizedInputs: { messages, blocks: entries.map((entry, index) => ({ block: entry, content: entry.content, tokens: 5, messageSpan: { start: index, end: index + 1 } })) },
    scope, layoutId: "v813", promptProfileId: "synthetic", providerConfig: { providerType: "synthetic", defaultModel: "fixture" }, revisionSnapshot: { source: "source-snapshot-r1" },
    memoryContext: { committedDynamicPlanSources: committed, pendingDynamicPlanSources: pending }, mode: "v9" });
}
const source = projected();
assert(!JSON.stringify(source).includes(PRIVATE_KEY) && !JSON.stringify(source).includes(SCOPE.campaignToken));
assert(!Object.keys(source).includes("key"), "only the sidecar retains raw source keys; diagnostic identity is not enumerable");
const pendingPlan = build([], [source]);
const pendingBlock = pendingPlan.blocks.find(block => block.kind === "QUERY_DYNAMIC_MEMORY");
assert.equal(pendingBlock.provenance.evidenceLevel, "SOURCE_BOUND");
const bindings = getPlanSourceBindings(pendingPlan, pendingBlock.id);
assert.equal(bindings.length, 1);
assert.equal(bindings[0].sourceKey, PRIVATE_KEY);
assert.equal(bindings[0].sourceRevision, "real-revision-7");
assert.equal(bindings[0].ownerId, SCOPE.ownerId);
assert(Object.isFrozen(bindings) && Object.isFrozen(bindings[0]));
assert(!JSON.stringify(pendingPlan).includes(PRIVATE_KEY), "raw keys remain exclusively in the in-process sidecar");
assert.equal(pendingPlan.blocks.find(block => block.id === "anchor").provenance.evidenceLevel, "TEMPLATE_STATIC");
assert.equal(pendingPlan.blocks.find(block => block.id === "memory-direct-frozen").provenance.evidenceLevel, "SNAPSHOT_DERIVED");
assert.equal(pendingPlan.blocks.find(block => block.id === "private-custom").provenance.evidenceLevel, "LEGACY_OBSERVED");
assert.equal(pendingPlan.blocks.find(block => block.id === "turn").provenance.evidenceLevel, "UNKNOWN", "the memory baseline snapshot cannot claim current player content");
const committedPlan = build([source], []);
assert.equal(committedPlan.blocks.find(block => block.id === "memory-dynamic-frozen").kind, "RESPONDER_FROZEN");
assert.equal(committedPlan.blocks.find(block => block.id === "memory-dynamic-frozen").provenance.evidenceLevel, "SOURCE_BOUND");
const untrusted = build([], [{ ...source }]);
assert.equal(untrusted.blocks.find(block => block.kind === "QUERY_DYNAMIC_MEMORY").provenance.evidenceLevel, "UNKNOWN");
for (const entry of [
  { sourceSummaryKey: "missing-revision", frozenText: "UNKNOWN SOURCE", memory: { provenance: { folderOwnerId: SCOPE.ownerId, campaignToken: SCOPE.campaignToken } } },
  { sourceSummaryKey: "pair-summary:legacy:synthetic-locator", sourceRevision: "r1", frozenText: "UNKNOWN SOURCE", memory: { provenance: { folderOwnerId: SCOPE.ownerId, campaignToken: SCOPE.campaignToken } } }
]) {
  const unknownPlan = build([], [freeze.projectPlanSource(entry, SCOPE)]);
  assert.equal(unknownPlan.blocks.find(block => block.kind === "QUERY_DYNAMIC_MEMORY").provenance.evidenceLevel, "UNKNOWN");
}
for (const scope of [{ ...SCOPE, ownerId: SCOPE.ownerId + 1 }, { ...SCOPE, campaignToken: "other-campaign" }, { ...SCOPE, conversationId: "other-conversation" }]) {
  assert.throws(() => build([], [source], scope), error => error.code === "PLAN_SOURCE_SCOPE_MISMATCH");
}
const revisedPlan = build([], [projected("real-revision-8")]);
assert.equal(revisedPlan.blocks.find(block => block.kind === "QUERY_DYNAMIC_MEMORY").content, pendingBlock.content);
assert.notDeepEqual(revisedPlan.blocks.find(block => block.kind === "QUERY_DYNAMIC_MEMORY").provenance.diagnosticIds, pendingBlock.provenance.diagnosticIds);
const serialized = serializePromptPlan(pendingPlan);
const proof = { plan: pendingPlan, serialized, ownerEvidence: true };
const snapshot = createEffectiveRequestSnapshot({ requestType: "chat", providerType: "synthetic", protocol: "openai_chat_completions", endpoint: "https://fixture.invalid/chat/completions", payload: { model: "fixture", messages: serialized.messages, max_tokens: 64 }, adapterInputMessagesFingerprint: fingerprintMessages(serialized.messages) });
assert(!JSON.stringify(snapshot.payload).includes("provenance") && !JSON.stringify(snapshot.payload).includes(PRIVATE_KEY));
let verifierCalls = 0;
assert(preflightPromptPlan({ snapshot, proof, budget: { safe: true }, expectedScope: SCOPE, proofVerifier: () => { verifierCalls++; return true; } }).ok);
for (const reason of ["FORGET_CHANGED", "SOURCE_REVISION_CHANGED", "KNOWLEDGE_REVOKED"]) {
  assert.throws(() => preflightPromptPlan({ snapshot, proof, budget: { safe: true }, expectedScope: SCOPE, proofVerifier: () => { verifierCalls++; return { valid: false, reason }; } }), error => error.code === "PLAN_SOURCE_REVOKED");
}
assert.equal(verifierCalls, 4);
const changed = JSON.parse(JSON.stringify(pendingPlan));
changed.blocks.find(block => block.id === pendingBlock.id).provenance.diagnosticIds = ["a".repeat(64)];
assert.throws(() => preflightPromptPlan({ snapshot, proof: { ...proof, plan: changed }, budget: { safe: true }, proofVerifier: () => true }), error => error.code === "PLAN_CHANGED_BEFORE_SEND");
changed.blocks[0].provenance.sourceKeys = [PRIVATE_KEY];
assert.throws(() => validatePromptPlan(changed), error => error.code === "PLAN_PROVENANCE_INVALID");
const oldPlan = JSON.parse(JSON.stringify(pendingPlan));
oldPlan.blocks.forEach(block => { delete block.provenance; });
assert(validatePromptPlan(oldPlan).ok, "optional provenance remains compatible with old consumers");
assert.deepEqual(serializePromptPlan(oldPlan).messages, serialized.messages);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v941-source-diag-"));
try {
  const Diagnostics = createProviderDiagnostics({ fs, path, dataDir: dir, TokenCounter: { estimateTokens: text => Math.ceil(String(text).length / 4) } });
  const diagnostics = new Diagnostics();
  const token = diagnostics.createCacheDiagnosticsObserver({ provider: "synthetic", model: "fixture", requestType: "chat", cacheDiagnosticContext: { plan: { layoutId: "v813" }, blockMetadata: serialized.blockMetadata, messageSpans: serialized.messageSpans } });
  diagnostics.attachEffectiveRequest(token, snapshot, { safe: true });
  diagnostics.recordResponse({ provider: "synthetic", model: "fixture", requestType: "chat", response: { content: "synthetic reply", finish_reason: "stop", usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } }, usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 }, metadata: { generationStatus: "COMPLETE", cacheDiagnosticsObserverToken: token } });
  const entry = diagnostics.getRecent(1)[0];
  assert.equal(entry.cacheDiagnosticsV2.provenance.evidenceCounts.SOURCE_BOUND, 1);
  assert.equal(entry.cacheDiagnosticsV2.provenance.authority, "LEGACY_VERIFIER");
  const persisted = fs.readFileSync(path.join(dir, "provider-diagnostics.jsonl"), "utf8");
  for (const secret of [PRIVATE_KEY, SCOPE.campaignToken, "SYNTHETIC MEMORY BODY", "CURRENT QUESTION", "LEGACY BASELINE"]) assert(!persisted.includes(secret), "diagnostics must retain counts, never raw source or content");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log("PASS V9.4.1 source provenance (trusted source sidecar, revisions, scopes, UNKNOWN, legacy compatibility, verifier and diagnostic privacy)");
