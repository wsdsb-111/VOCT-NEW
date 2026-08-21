"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const system = require(path.join(root, "resources", "app", "out", "main", "action-system"));

const event = system.createActionEvent({
  eventId: "evt_1",
  category: "death_or_injury",
  evidence: { text: "测试证据", start: 2, end: 6 },
  executionStatus: "executed",
  resultStatus: "succeeded",
  sourceClauseIndex: 0
});
assert(Object.isFrozen(event) && Object.isFrozen(event.evidence));
assert.strictEqual(event.traceId, "action:evt_1");

const reference = system.createReferenceResolution({ referenceType: "third_person", surface: "他", start: 1, end: 2, mode: "resolved", characterId: 2, confidenceBasis: ["unique_interlocutor"] });
assert(Object.isFrozen(reference) && Object.isFrozen(reference.confidenceBasis));
const binding = system.createParticipantBinding({ messageId: 1, eventId: event.eventId, traceId: event.traceId, actionId: "isInjured", sourceCharacterId: 1, targetCharacterId: 2, references: [reference] });
assert(Object.isFrozen(binding) && Object.isFrozen(binding.references));
const available = system.createAvailableAction({ signature: "isInjured", sourceCharacterId: 1, sourceLocked: true, resolvedTargetCharacterId: 2, targetLocked: true, validTargetCharacterIds: [2], args: [], participantBinding: binding });
assert(Object.isFrozen(available) && Object.isFrozen(available.validTargetCharacterIds));
const invocation = system.createValidatedInvocation({ actionId: "isInjured", sourceCharacterId: 1, targetCharacterId: 2, bindingId: binding.bindingId, eventId: event.eventId, traceId: binding.traceId, args: { injuryType: "wounded" } });
assert(Object.isFrozen(invocation) && Object.isFrozen(invocation.args));
const result = system.createExecutionResult({ actionId: "isInjured", success: true, effectWritten: true, sourceCharacterId: 1, targetCharacterId: 2, bindingId: binding.bindingId, eventId: invocation.eventId, traceId: invocation.traceId });
assert(Object.isFrozen(result));
assert.deepStrictEqual([event.traceId, binding.traceId, invocation.traceId, result.traceId], Array(4).fill("action:evt_1"));
assert.strictEqual(result.eventId, event.eventId);
assert.strictEqual(result.effectWritten, true);

const analytics = [];
const originalLog = console.log;
console.log = () => {};
try {
  system.actionDecisionTrace.record({
    analytics: { record: (entry) => analytics.push(entry) },
    actionId: invocation.actionId,
    eventId: event.eventId,
    traceId: event.traceId,
    stage: "execution",
    outcome: "success",
    details: { source: 1, target: 2, content: "不得记录正文" }
  });
} finally {
  console.log = originalLog;
}
assert.strictEqual(analytics.length, 1);
assert.strictEqual(analytics[0].traceId, event.traceId);
assert.strictEqual("content" in analytics[0], false, "trace analytics must not retain message text");
assert.strictEqual(system.actionDecisionTrace.normalizeActionSkipReason("unresolved_action_participants"), "binding.unresolved_action_participants");
assert.strictEqual(system.actionDecisionTrace.normalizeSkipReason("generation", "stale_turn"), "generation.stale_turn");

console.log("VOTC v6.9-D contracts/trace: PASS (immutable pipeline, trace correlation and namespaced skips)");
