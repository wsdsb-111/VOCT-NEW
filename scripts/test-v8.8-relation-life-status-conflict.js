"use strict";

const assert = require("assert");
const { createRelationshipResolver } = require("../resources/app/out/main/game-data/relationship-resolver");
const { buildFamilyFactBlock, formatStructuredCharacter } = require("../resources/app/out/main/worldline/character-family-facts");
const { resolveCharacterAge } = require("../resources/app/out/main/worldline/character-age-service");
const { getCurrentTruth } = require("../resources/app/out/main/worldline/current-truth-adapter");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { buildDeterministicWorldSummary } = require("../resources/app/out/main/worldline/world-summary");

const campaignToken = "life-status-fixture";
const gameDate = "1175.2.1";
const totalDays = 430000;
const sourceSnapshotId = `${gameDate}/${totalDays}`;
const directParentEvidence = (childId, parentId, name) => ({
  id: parentId,
  name,
  source: "CK3_DIRECT_PARENT",
  parentId,
  sourceOwnerId: childId,
  childId,
  relationType: "parent",
  sourceRelation: "parents",
  publicStatus: "PUBLIC_LEGAL_PARENT",
  knowledgeStatus: "UNKNOWN",
  campaignToken,
  sourceSnapshotId
});
const characters = new Map([
  [1, { id: 1, fullName: "父亲", gender: "male", alive: true, children: [{ id: 2, name: "儿子", gender: "male", directParentEvidence: directParentEvidence(2, 1, "父亲") }] }],
  [2, { id: 2, fullName: "儿子", gender: "male", alive: true, age: 20, parents: [directParentEvidence(2, 1, "父亲")], deathDate: "1175年1月1日" }]
]);
const profiles = createRelationshipResolver({ onDiagnostic: () => false }).buildCanonicalProfiles(characters, totalDays, () => "unknown", { campaignToken, sourceSnapshotId });
const son = profiles.get(2);
assert.equal(son.alive, null);
assert.equal(son.evidence.conflicts.lifeStatus, true);
// Check the stable conflict decision and diagnostic code without freezing the resolver's growing result shape.
const lifeConflictAge = resolveCharacterAge(son, { currentGameDate: "1175.2.1", currentTotalDays: 430000 });
assert.equal(lifeConflictAge.age, null);
assert.equal(lifeConflictAge.label, "age");
assert.equal(lifeConflictAge.source, "LIFE_STATUS_CONFLICT");
assert.equal(lifeConflictAge.ageSource, "LIFE_STATUS_CONFLICT");
assert.equal(lifeConflictAge.conflict, true);
assert.equal(lifeConflictAge.rawAge, null);
assert.equal(lifeConflictAge.calculatedCalendarAge, null);
assert.equal(lifeConflictAge.asOfGameDate, "1175.2.1");
assert.equal(lifeConflictAge.diagnosticCode, "LIFE_STATUS_CONFLICT");
const family = buildFamilyFactBlock(profiles.get(1), { date: gameDate, totalDays, campaignToken, characters: profiles, getMentionableCharacterProfiles: () => profiles }, { query: "你儿子怎么样了" });
assert(family.includes("生死状态存在冲突"));
assert(!family.includes("1175年1月1日去世"));
const unavailableDeathAge = resolveCharacterAge({ alive: false, age: 80 }, { currentGameDate: "1200.1.1" });
assert.equal(unavailableDeathAge.age, null);
assert.equal(unavailableDeathAge.label, "ageAtDeath");
assert.equal(unavailableDeathAge.source, "AGE_AT_DEATH_UNAVAILABLE");
assert.equal(unavailableDeathAge.ageSource, "AGE_AT_DEATH_UNAVAILABLE");
assert.equal(unavailableDeathAge.conflict, false);
assert.equal(unavailableDeathAge.rawAge, null);
assert.equal(unavailableDeathAge.calculatedCalendarAge, null);
assert.equal(unavailableDeathAge.asOfGameDate, null);
assert.equal(unavailableDeathAge.reason, "DATE_EVIDENCE_UNAVAILABLE");
assert.equal(unavailableDeathAge.diagnosticCode, "DATE_EVIDENCE_UNAVAILABLE");
const directProfiles = createRelationshipResolver({ onDiagnostic: () => false }).buildCanonicalProfiles(new Map([[3, { id: 3, fullName: "矛盾人物", alive: true, deathDate: "1175年1月1日" }]]), 430000, () => "unknown");
assert.equal(directProfiles.get(3).evidence.conflicts.lifeStatus, true);
const currentTruth = getCurrentTruth({ gameDate: "1175.2.1", characters: { 3: { id: 3, alive: true, deathDate: "1175.1.1" } } }, 3, "alive");
assert.equal(currentTruth.available, false);
assert.equal(currentTruth.reason, "CURRENT_TRUTH_LIFE_STATUS_CONFLICT");
const rawConflict = { id: 4, fullName: "原始矛盾人物", gender: "male", alive: true, deathDate: "1175.1.1" };
const structured = formatStructuredCharacter(rawConflict, "1175.2.1");
assert(structured.text.includes("生死状态：存在冲突，未输出结论"));
assert(!structured.text.includes("在世") && !structured.text.includes("去世"));
const rawFamily = new Map([
  [5, { id: 5, fullName: "父亲", children: [{ id: 4, name: "原始矛盾人物", directParentEvidence: directParentEvidence(4, 5, "父亲") }] }],
  [4, { ...rawConflict, parents: [directParentEvidence(4, 5, "父亲")] }]
]);
const rawFamilyBlock = buildFamilyFactBlock(rawFamily.get(5), { date: gameDate, totalDays, campaignToken, characters: rawFamily, getMentionableCharacterProfiles: () => rawFamily }, { query: "你儿子怎么样了" });
assert(rawFamilyBlock.includes("生死状态存在冲突，未输出结论"));
assert(!rawFamilyBlock.includes("在世") && !rawFamilyBlock.includes("1175年1月1日去世"));
const checkpoint = (date, character) => ({ id: date, snapshot: { gameDate: date, playthroughId: "campaign", characters: { 9: { id: 9, fullName: "年度人物", ...character } } } });
const previous = checkpoint("1175.1.1", { alive: true });
assert.equal(WorldlineService.prototype._delta(previous, checkpoint("1176.1.1", {})).length, 0, "missing life status must not be treated as death");
assert.equal(WorldlineService.prototype._delta(previous, checkpoint("1176.1.1", { alive: true, deathDate: "1175.6.1" })).length, 0, "conflicting life status must not be treated as death");
assert.equal(WorldlineService.prototype._delta(previous, checkpoint("1176.1.1", { alive: false, deathDate: "1175.6.1" }))[0].type, "IMPORTANT_CHARACTER_DIED");
const spouseConflictGraph = buildKinshipGraph({
  10: { id: 10, fullName: "夫", spouses: [{ id: 11, fullName: "妻", alive: true, deathDate: "1175.1.1" }] },
  11: { id: 11, fullName: "妻", gender: "female", alive: true, deathDate: "1175.1.1" }
});
assert.equal(spouseConflictGraph.relationBetween(11, 10).relation.type, "SPOUSE_OF", "life-status conflict must not become deceased-spouse truth");
const spouseConflictBlock = buildFamilyFactBlock(spouseConflictGraph.nodes.get("10"), { date: "1175.2.1", getMentionableCharacterProfiles: () => spouseConflictGraph.nodes }, { query: "你妻子怎么样" });
assert(spouseConflictBlock.includes("生死状态存在冲突，未输出结论"));
assert(!spouseConflictBlock.includes("亡妻") && !spouseConflictBlock.includes("去世"));
const summaryFor = character => buildDeterministicWorldSummary({ selected: { gameTruth: [{ kind: "CHARACTER", payload: { id: character.id, character, match: {} } }] } }).topicItems[0].text;
assert(summaryFor(rawConflict).includes("生死状态存在冲突，未输出结论"));
assert(!summaryFor(rawConflict).includes("：存活") && !summaryFor(rawConflict).includes("已死亡"));
assert(summaryFor({ id: 12, fullName: "未知人物" }).includes("生死状态未知"));
console.log("V8.8 Relation Life Status Conflict: PASS");
