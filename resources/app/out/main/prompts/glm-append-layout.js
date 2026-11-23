"use strict";

const { fingerprint, planSeal, validatePromptPlan } = require("./prompt-plan-contract");
const { serializePromptPlan } = require("./prompt-plan-serializer");
const { calculatePlanPrefix } = require("./prompt-plan-prefix");

const REVISION = "v9_7_3_glm_append_2";

// A receipt contains only opaque hashes and declared message indices. Every byte
// sent still comes from this turn's authorized plan, never a prior payload.
function prepareGlmAppendLayout(build, config, previous, { disabled = false } = {}) {
  const plan = build.promptPlan;
  if (disabled || config?.providerType !== "zhipu" || config.defaultModel !== "glm-5.3-flash"
    || build.promptProfile?.adapterEnabled !== true || build.promptPlanMode !== "v9" || plan?.layoutId !== "v813") return { build, receipt: null };
  validatePromptPlan(plan);
  if (plan.scope.ownerId !== plan.scope.responderId || !Number.isSafeInteger(plan.scope.ownerId)
    || !plan.scope.campaignToken || !plan.scope.conversationId || !plan.scope.playerId
    || plan.messageGroups.some(group => group.parts.length !== 1)) return { build, receipt: null };
  const blocks = new Map(plan.blocks.map(block => [block.id, block]));
  const rows = [];
  const historyHashes = [];
  for (const group of plan.messageGroups) {
    const part = group.parts[0];
    const block = blocks.get(part.blockId);
    const message = block.messages[part.index];
    const history = ["history", "current_user"].includes(block.legacyType);
    const ref = history ? `h:${historyHashes.length}` : `b:${fingerprint([block.id, part.index, group.separator])}`;
    const hash = fingerprint(message);
    if (history) historyHashes.push(hash);
    rows.push({ ref, hash, group, history, instruction: block.legacyType === "instruction", role: message.role });
  }
  // Keep the response instruction (and any configured suffix) at the end. In
  // multi-NPC turns the newest historical message may belong to another NPC.
  const instructionIndex = rows.findIndex(row => row.instruction);
  const tail = instructionIndex < 0 ? [] : rows.slice(instructionIndex);
  if (tail.some(row => row.history) || !tail.length && rows.at(-1)?.role !== "user") return { build, receipt: null };
  const tailRefs = new Set(tail.map(row => row.ref));
  const { campaignToken, conversationId, ownerId, responderId, playerId, conversationEpoch, sourceSnapshotId } = plan.scope;
  const { promptSettings, memory, knowledge, source, worldline } = plan.inputRevisions;
  const scopeKey = fingerprint([{ campaignToken, conversationId, ownerId, responderId, playerId, conversationEpoch, sourceSnapshotId },
    { promptSettings, memory, knowledge, source, worldline }, config]);
  // The response instruction and suffix are always rebuilt at the end; their
  // changing contents cannot invalidate a prefix they do not participate in.
  const nonHistoryKey = fingerprint(rows.filter(row => !row.history)
    .map(row => [row.ref, tailRefs.has(row.ref) ? [row.role] : row.hash]));
  const byRef = new Map(rows.map(row => [row.ref, row]));
  let ordered = rows;
  let applied = false;
  if (previous?.scopeKey === scopeKey && previous.nonHistoryKey === nonHistoryKey
    && previous.historyHashes.length > 0 && historyHashes.length > previous.historyHashes.length
    && previous.historyHashes.every((hash, index) => hash === historyHashes[index])) {
    const refs = [...previous.orderRefs.filter(ref => !tailRefs.has(ref)),
      ...rows.filter(row => row.history).slice(previous.historyHashes.length).map(row => row.ref), ...tailRefs];
    if (refs.length === rows.length && new Set(refs).size === refs.length && refs.every(ref => byRef.has(ref))
      && previous.orderRefs.every((ref, index) => tailRefs.has(ref) || byRef.get(ref)?.hash === previous.wireHashes[index])) {
      ordered = refs.map(ref => byRef.get(ref));
      applied = true;
    }
  }
  const receipt = { scopeKey, nonHistoryKey, historyHashes,
    orderRefs: ordered.map(row => row.ref), wireHashes: ordered.map(row => row.hash),
    tailCount: tail.length, serializedFingerprint: build.serialized.serializedFingerprint };
  if (!applied) return { build: { ...build, glmAppendLayoutApplied: false }, receipt };
  const nextPlan = { ...plan, layoutRevision: plan.layoutRevision === "v9_8_1_glm_profile_1" ? "v9_8_1_glm_profile_append_1" : REVISION, messageGroups: ordered.map(row => row.group),
    diagnostics: { ...plan.diagnostics } };
  nextPlan.diagnostics.planFingerprint = planSeal(nextPlan);
  const serialized = serializePromptPlan(nextPlan);
  const prefix = calculatePlanPrefix(nextPlan, serialized);
  const spans = new Map(serialized.messageSpans.map(span => [span.blockId, span]));
  const nextBuild = { ...build, promptPlan: nextPlan, serialized, messages: serialized.messages, promptPlanPrefix: prefix,
    blocks: build.blocks.map(entry => {
      const span = spans.get(entry.block.id);
      const positions = [...new Set(span.contributions.map(part => part.messagePosition))];
      return { ...entry, messageSpan: { start: span.start, end: span.end },
        ...(positions.length !== span.end - span.start ? { messagePositions: positions } : {}) };
    }), glmAppendLayoutApplied: applied };
  return { build: nextBuild, receipt: { ...receipt, serializedFingerprint: serialized.serializedFingerprint } };
}

module.exports = { prepareGlmAppendLayout, REVISION };
