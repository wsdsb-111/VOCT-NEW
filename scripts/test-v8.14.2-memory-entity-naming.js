"use strict";

const assert = require("node:assert/strict");
const MemoryEngine = require("../resources/app/out/main/memory-system/memory-engine").MemoryEngine;
const { buildCurrentMemory4RelationshipEvidence, buildMemory4EntityContext } = require("../resources/app/out/main/memory-system/memory4-entity-context");

const owner = { id: 1, name: "张道素", shortName: "张道素", fullName: "张道素" };
const player = { id: 2, name: "赵太初", shortName: "赵太初", fullName: "赵太初" };
const master = { id: 3, name: "张道正", shortName: "张道正", fullName: "张道正" };
const profiles = [owner, player];
const gameData = { campaignToken: "entity-context-campaign", date: "1044.11.8", playerID: player.id,
  characters: new Map([
    [owner.id, { ...owner, relationsToPlayer: ["朋友"], relationsToCharacters: [{ id: master.id, relations: ["teacher"] }] }],
    [player.id, player], [master.id, master]
  ]) };
const relationships = buildCurrentMemory4RelationshipEvidence({ gameData, ownerIds: [owner.id, player.id],
  entityIds: [owner.id, player.id, master.id] });

assert.deepEqual(relationships, [
  { campaignToken: "entity-context-campaign", ownerId: owner.id, entityId: player.id, status: "CONFIRMED",
    types: ["朋友"], source: "CURRENT_RUNTIME_RELATIONSHIP", knownToOwner: true, asOf: "1044.11.8" },
  { campaignToken: "entity-context-campaign", ownerId: owner.id, entityId: master.id, status: "CONFIRMED",
    types: ["teacher"], source: "CURRENT_RUNTIME_RELATIONSHIP", knownToOwner: true, asOf: "1044.11.8" }
]);

const genericFragment = { fragmentId: "generic", messageId: 10, sourceMessageIds: [10], speakerId: owner.id,
  recipientIds: [player.id], presentIds: [owner.id, player.id], knownBy: [owner.id], entityIds: [],
  visibilityEvidence: "finalization_source_paragraph", sourceTextVerified: true, sourceRole: "user", visibility: "public",
  text: "天师（师父）曾吩咐张道素领主人站桩满七天。" };
const generic = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [genericFragment], participantProfiles: profiles, mentionedEntities: [master], relationshipEvidence: relationships });
assert.deepEqual(generic.entityNameEvidence.map(row => [row.entityId, row.name]), [[owner.id, owner.name], [player.id, player.name]],
  "the owner self name and confirmed direct relationship can identify the player; a generic master title cannot identify a third party");
assert.deepEqual(generic.entityNameEvidence.find(row => row.entityId === player.id).evidence.map(item => item.source), ["OWNER_DIRECT_RELATIONSHIP"]);
assert.equal(generic.entityNameEvidence.some(row => row.entityId === master.id), false);
assert.deepEqual(generic.relationshipEvidence.map(row => [row.ownerId, row.entityId, row.types]), [[owner.id, player.id, ["朋友"]]],
  "unmentioned third-party relationship rows must not be sent with the fragment");

const namedFragment = { ...genericFragment, fragmentId: "named", messageId: 11, sourceMessageIds: [11],
  text: "师父张道正曾吩咐张道素。" };
const named = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [namedFragment], participantProfiles: profiles, mentionedEntities: [master], relationshipEvidence: relationships });
assert.deepEqual(named.entityNameEvidence.find(row => row.entityId === master.id), {
  fragmentId: "named", entityId: master.id, name: master.name,
  evidence: [{ source: "SOURCE_EXPLICIT_NAME", matchedAlias: "张道正", sourceMessageIds: [11] }]
});
assert.equal(named.relationshipEvidence.some(row => row.entityId === master.id), true,
  "a direct owner relationship may accompany the explicitly named, owner-visible entity");

const assistantNarration = { ...namedFragment, fragmentId: "assistant-narration", sourceRole: "assistant",
  text: "旁白：师父张道正走入大殿。" };
const narration = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [assistantNarration], participantProfiles: profiles, mentionedEntities: [master], relationshipEvidence: relationships });
assert.equal(narration.entityNameEvidence.some(row => row.entityId === master.id), false,
  "an assistant-authored third-person narration cannot disclose an unquoted name to its audience");
assert.equal(narration.entityNameEvidence.some(row => row.entityId === player.id), true,
  "a confirmed owner-to-recipient relationship remains visible despite assistant narration filtering");
assert.deepEqual(narration.relationshipEvidence.map(row => [row.entityId, row.types]), [[player.id, ["朋友"]]],
  "assistant narration filtering must not suppress the existing direct relationship readback");

const assistantDialogue = { ...namedFragment, fragmentId: "assistant-dialogue", messageId: 14, sourceMessageIds: [14],
  sourceRole: "assistant", text: "张道素说：‘我师父张道正今日到来。’" };
const dialogue = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [assistantDialogue], participantProfiles: profiles, mentionedEntities: [master], relationshipEvidence: relationships });
assert.equal(dialogue.entityNameEvidence.find(row => row.entityId === master.id)?.name, master.name,
  "a name quoted inside assistant-authored dialogue is visible to the audience");

const mixedFragment = { ...assistantNarration, fragmentId: "mixed-source", sourceRole: "mixed" };
const mixed = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [mixedFragment], participantProfiles: profiles, mentionedEntities: [master], relationshipEvidence: relationships });
assert.equal(mixed.entityNameEvidence.some(row => row.entityId === master.id), false,
  "mixed-role source text cannot disclose an explicit name");
assert.equal(mixed.entityNameEvidence.some(row => row.entityId === player.id), true,
  "a confirmed owner-to-recipient relationship remains usable for mixed-role fragments");

assert.equal(named.entityNameEvidence.some(row => row.entityId === master.id), true,
  "an unquoted name in the user's original public source remains explicit evidence");

const noRelationship = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [genericFragment], participantProfiles: profiles, mentionedEntities: [master], relationshipEvidence: [] });
assert.equal(noRelationship.entityNameEvidence.some(row => row.entityId === player.id), false,
  "presence and speaker metadata alone must not expose an otherwise unknown player's canonical name");

const future = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: "1044.11.7",
  fragments: [genericFragment], participantProfiles: profiles, mentionedEntities: [master], relationshipEvidence: relationships });
assert.equal(future.entityNameEvidence.some(row => row.entityId === player.id), false,
  "current relationship data newer than the source date must not rewrite a past memory");
assert.equal(future.relationshipEvidence.length, 0);

const privateFragment = { ...namedFragment, fragmentId: "not-known", knownBy: [player.id] };
const privateResult = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [privateFragment], participantProfiles: profiles, mentionedEntities: [master], relationshipEvidence: relationships });
assert.deepEqual(privateResult, { entityNameEvidence: [], relationshipEvidence: [] },
  "name and relationship evidence must be scoped to the source fragment's knownBy owner");

const ambiguous = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [namedFragment], participantProfiles: profiles,
  mentionedEntities: [master, { id: 4, name: "张道正", shortName: "张道正" }], relationshipEvidence: [] });
assert.equal(ambiguous.entityNameEvidence.some(row => [master.id, 4].includes(row.entityId)), false,
  "duplicate aliases must not bind a third-party identity");

const mismatchedSource = { ...namedFragment, fragmentId: "mismatched-source", text: "师父吩咐张道素。", rawParagraphs: [
  { messageId: 99, text: "师父张道正曾吩咐张道素。" }
] };
const mismatched = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [mismatchedSource], participantProfiles: profiles, mentionedEntities: [master], relationshipEvidence: [] });
assert.equal(mismatched.entityNameEvidence.some(row => row.entityId === master.id), false,
  "untrusted raw paragraph names cannot introduce explicit name evidence");

const unverifiedRawParagraph = { ...genericFragment, fragmentId: "unverified-raw", messageId: 12,
  sourceMessageIds: [12], sourceTextVerified: true, text: "旧话中曾提及一位师父。",
  rawParagraphs: [{ messageId: 12, text: "师父张道正曾吩咐张道素。" }] };
const unverifiedRaw = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [unverifiedRawParagraph], participantProfiles: profiles, mentionedEntities: [master], relationshipEvidence: [] });
assert.equal(unverifiedRaw.entityNameEvidence.some(row => row.entityId === master.id), false,
  "raw paragraphs cannot introduce names even when the parent fragment is verified");

const zeroIdFragment = { ...namedFragment, fragmentId: "zero-source-id", messageId: 0, sourceMessageIds: [0] };
const zeroId = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [zeroIdFragment], participantProfiles: profiles, mentionedEntities: [master], relationshipEvidence: [] });
assert.deepEqual(zeroId.entityNameEvidence.find(row => row.entityId === master.id).evidence[0].sourceMessageIds, [0],
  "message ID 0 must be retained as source evidence");

const aliasProfile = { id: 4, name: "阿初", shortName: "阿初", fullName: "张太初" };
const aliasFragment = { ...namedFragment, fragmentId: "short-alias", messageId: 13, sourceMessageIds: [13], text: "阿初随后离开。" };
const aliasResult = buildMemory4EntityContext({ ownerId: owner.id, campaignToken: gameData.campaignToken, date: gameData.date,
  fragments: [aliasFragment], participantProfiles: profiles, mentionedEntities: [aliasProfile], relationshipEvidence: [] });
assert.deepEqual(aliasResult.entityNameEvidence.find(row => row.entityId === aliasProfile.id), {
  fragmentId: "short-alias", entityId: aliasProfile.id, name: "阿初",
  evidence: [{ source: "SOURCE_EXPLICIT_NAME", matchedAlias: "阿初", sourceMessageIds: [13] }]
}, "a short alias must not be expanded to an unmentioned full name");

const input = { conversationId: "naming-finalization", date: gameData.date, campaignToken: gameData.campaignToken,
  participants: profiles, mentionedEntities: [master], memory4RelationshipEvidence: relationships,
  messages: [{ id: 10, name: owner.name, content: genericFragment.text }] };
const fake = { memoryGeneration: 1, getFinalizationId: MemoryEngine.prototype.getFinalizationId };
const prepared = MemoryEngine.prototype.prepareFinalizationContext.call(fake, input);
let recoverySnapshot = null;
const recoveryEngine = { memoryGeneration: 1, store: { paths: { recovery: "unused" }, readJson: () => ({}),
  writeJson: (_file, snapshot) => { recoverySnapshot = snapshot; } }, rolling: { createState: () => ({}) },
isFinalizationCurrent: MemoryEngine.prototype.isFinalizationCurrent };
MemoryEngine.prototype.writeRecoverySnapshot.call(recoveryEngine, prepared);
assert.deepEqual(recoverySnapshot.mentionedEntities, [master]);
assert.deepEqual(recoverySnapshot.memory4RelationshipEvidence, relationships,
  "recovery snapshots must retain the original owner-scoped, date-stamped relationship evidence");

console.log("V8.14.2 memory entity naming: PASS");
