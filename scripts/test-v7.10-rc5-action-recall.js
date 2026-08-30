"use strict";

const assert = require("assert");
const { CriticalActionRecallObserver, classifyWithGroundTruth } = require("../resources/app/out/main/actions/critical-action-recall-diagnostics");
const { createUsageAnalytics } = require("../resources/app/out/main/analytics/usage-analytics");
const retention = require("../resources/app/out/main/usage-analytics-retention");

const player = { id: 1, relationsToCharacters: [] };
const npc = { id: 2, shortName: "NPC", relationsToCharacters: [{ id: 3, relations: ["Friend"] }] };
const other = { id: 3, relationsToCharacters: [] };
const gameData = { playerID: 1, characters: new Map([[1, player], [2, npc], [3, other]]) };
const observer = new CriticalActionRecallObserver(npc, gameData);

observer.observeCheck("isInjured", { canExecute: true, validTargetCharacterIds: [1, 2, 3] });
observer.observeCheck("characterIsKilled", { canExecute: true, validTargetCharacterIds: [1, 3] });
observer.observeCheck("becomeBestFriendsWith", { canExecute: true, validTargetCharacterIds: [3] });
observer.observeCheck("becomeNemesisWith", { canExecute: false, validTargetCharacterIds: [] });
observer.observeCheck("becomeFriendsWith", { canExecute: true, validTargetCharacterIds: [1] });
observer.observeMissingActions(["isInjured", "characterIsKilled", "becomeBestFriendsWith", "becomeNemesisWith", "becomeFriendsWith"]);

const diagnostics = observer.build({
  selectedInvocations: [
    { actionId: "characterIsKilled", targetCharacterId: 1, args: { isPlayerSource: false } },
    { actionId: "becomeBestFriendsWith", targetCharacterId: 3, args: {} }
  ],
  autoApproved: [{ actionId: "characterIsKilled", success: false }],
  needsApproval: [{ actionId: "becomeBestFriendsWith" }],
  evaluationStatus: "completed"
});

const injury = diagnostics.find((item) => item.actionId === "isInjured");
const killed = diagnostics.find((item) => item.actionId === "characterIsKilled");
const bestFriend = diagnostics.find((item) => item.actionId === "becomeBestFriendsWith");
const nemesis = diagnostics.find((item) => item.actionId === "becomeNemesisWith");
const missingLover = diagnostics.find((item) => item.actionId === "becomeLoversWith");

assert.strictEqual(diagnostics.length, 9, "all nine RC5 critical actions must be represented");
assert.deepStrictEqual(injury.validTargetCharacterIds, [1, 2, 3]);
assert.strictEqual(injury.validationResult, "NOT_SELECTED");
assert.strictEqual(injury.missCategory, null, "an unlabeled live turn must not invent SELECTOR_MISS");
assert.strictEqual(classifyWithGroundTruth(injury, { shouldTrigger: true, targetCharacterId: 3 }), "SELECTOR_MISS");
assert.strictEqual(classifyWithGroundTruth(injury, { shouldTrigger: true, unrepresentableByOfficialBinding: true }), "UNREPRESENTABLE_BY_OFFICIAL_BINDING");
assert.strictEqual(killed.sourceCharacterId, 2, "official kill SOURCE remains the victim when isPlayerSource=false");
assert.strictEqual(killed.selectedTarget, 1, "official kill TARGET records the killer");
assert.strictEqual(killed.validationResult, "EFFECT_FAILED");
assert.strictEqual(killed.missCategory, "EFFECT_FAILED");
assert.strictEqual(bestFriend.validationResult, "PENDING_APPROVAL");
assert.strictEqual(classifyWithGroundTruth(bestFriend, { shouldTrigger: true, targetCharacterId: 1 }), "WRONG_TARGET");
assert.strictEqual(nemesis.availabilityReason, "UNAVAILABLE_PREREQUISITE");
assert.strictEqual(missingLover.availabilityReason, "VALIDATION_REJECTED");

let stored = null;
const memoryFs = {
  existsSync: () => stored !== null,
  readFileSync: () => stored,
  mkdirSync() {},
  writeFileSync: (_file, content) => { stored = content; }
};
const UsageAnalytics = createUsageAnalytics({ fs: memoryFs, dataDir: "memory", analyticsFile: "memory/usage.json", retention, createPromptFingerprint: () => "test" });
const analytics = new UsageAnalytics();
analytics.record({
  requestType: "action_recall_diagnostic",
  characterId: 2,
  actionRecallEvaluationStatus: "completed",
  actionExperimentStage: "A",
  criticalActionDiagnostics: diagnostics
}, null);
const report = analytics.getReport();
assert.strictEqual(report.criticalActionRecall.requests, 1);
assert.strictEqual(report.criticalActionRecall.observations, 9);
assert.strictEqual(report.criticalActionRecall.selected, 2);
assert(report.criticalActionRecall.byMissCategory.EFFECT_FAILED >= 1);
assert(report.criticalActionRecall.recent.some((item) => item.actionId === "characterIsKilled" && item.sourceCharacterId === 2 && item.selectedTarget === 1));
assert.strictEqual(report.criticalActionRecall.recent.find((item) => item.actionId === "isInjured").selectedTarget, null, "an unselected target must remain null rather than becoming character #0");

console.log("VOTC v7.10-RC5 Critical Action Recall: PASS (9-action availability, source/target, Ground Truth classification, analytics)");
