"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.__V67ActionSystem = actionSystem;

const { eventParser, interaction, ParticipantResolver, Conversation } = actionSystem;
const { LegacyActionEngineV3: ActionEngine } = require(path.join(root, "resources", "app", "out", "main", "action-system", "action-engine"));
Conversation.configure({ createPromptFingerprint: (value) => String(value).length.toString(16) });

const kiss = eventParser.parse("李思念轻轻吻了李思昭的脸颊。");
assert.strictEqual(kiss.events.length, 0, "a simple kiss is a social event, not an automatic CK3 effect");
assert.strictEqual(kiss.socialEvents[0]?.type, "romantic_affection");

const failedKiss = eventParser.parse("李思念想吻李思昭，却最终没有靠近。");
assert.strictEqual(failedKiss.events.length, 0);
assert.strictEqual(failedKiss.socialEvents.length, 0, "an uncompleted kiss must not create a completed social event");

const rejection = eventParser.parse("李思念吻了李思昭，李思昭皱眉将她推开。");
assert.deepStrictEqual(rejection.socialEvents.map((event) => event.type), ["romantic_affection", "affection_rejection"]);
assert.strictEqual(rejection.events.length, 0, "affection rejection must not be promoted into a positive or combat action by default");

const player = { id: 1, shortName: "李思昭", fullName: "李思昭" };
const npc = { id: 2, shortName: "李思念", fullName: "李思念" };
const socialProposal = interaction.proposalDetector.detect({
  text: "李思念，我可以吻你吗？",
  speaker: player,
  characters: [player, npc],
  registry: { getById: () => null, isActionDisabled: () => false }
});
assert.strictEqual(socialProposal?.interactionType, "requested_social_interaction");
assert.deepStrictEqual(socialProposal?.candidateActionIds, []);

const participantDefinition = {
  semantic: {
    participantRoles: { source: "actor", target: "patient" },
    evidencePatterns: [/亲吻/],
    bilateralPersistentEffect: true
  }
};
for (const count of [3, 4, 6]) {
  const characters = new Map([[1, player], [2, npc]]);
  for (let id = 3; id <= count; id++) characters.set(id, { id, shortName: `旁观者${id}`, fullName: `旁观者${id}` });
  const resolution = ParticipantResolver.resolve({
    event: { eventId: `social-${count}`, evidence: { text: "李思昭亲吻了李思念", start: 0, end: 9 } },
    message: { id: `message-${count}` },
    speaker: player,
    gameData: { characters },
    actionDefinition: participantDefinition,
    actionId: "social-test",
    references: [],
    activeParticipantIds: [...characters.keys()]
  });
  assert.strictEqual(resolution.mode, "resolved", `${count} participants must bind the named pair without enumerating observers`);
  assert.deepStrictEqual([resolution.sourceCharacter.id, resolution.targetCharacter.id], [1, 2]);
}

const modePolicy = { usePrecisionJudge: true, precisionJudgeScope: "final_ambiguity" };
assert.strictEqual(ActionEngine.shouldInvokePrecisionJudge({
  gate: { shouldEvaluate: false }, semanticProfile: { events: [{}] }, participantAmbiguous: false, candidateActions: [{ id: "x" }], modePolicy
}), null, "ordinary messages must never enter Precision Judge");
assert.strictEqual(ActionEngine.shouldInvokePrecisionJudge({
  gate: { shouldEvaluate: true }, semanticProfile: { events: [{}], resolutionMode: "unresolved", allowedActionIds: [] }, participantAmbiguous: false, candidateActions: [{ id: "x" }], modePolicy
}), "semantic_ambiguous", "Precision Judge requires a positive Gate and unresolved local event");

const promptContract = Conversation.buildPromptBlockMetadata({
  blocks: [
    { block: { id: "anchor", type: "cache_anchor", stable: true }, content: "anchor", tokens: 2 },
    { block: { id: "profile", type: "description", stable: true }, content: "profile", tokens: 3 },
    { block: { id: "memory", type: "memory_stable", stable: false }, content: "memory", tokens: 5 },
    { block: { id: "history", type: "history", stable: false }, content: "history", tokens: 7 }
  ]
});
assert.strictEqual(promptContract.stablePrefixEndPosition, 2);
assert.strictEqual(promptContract.stablePrefixTokens, 5);
assert.strictEqual(promptContract.dynamicSuffixTokens, 12);
assert(promptContract.blocks.every((block) => typeof block.fingerprint === "string" && typeof block.stable === "boolean"));

const promptBuilderSource = require("fs").readFileSync(path.join(root, "resources", "app", "out", "main", "prompts", "prompt-builder.js"), "utf8");
assert(promptBuilderSource.indexOf("Current User Message") < promptBuilderSource.indexOf("Turn Recall"), "dynamic Turn Recall must remain after the current user message");
assert(promptBuilderSource.includes("VOTC_CACHE_ANCHOR_v4"));

console.log("VOTC v7.9.1 production stability: PASS");
