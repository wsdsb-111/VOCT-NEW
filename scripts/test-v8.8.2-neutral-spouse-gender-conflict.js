"use strict";

const assert = require("assert");
const { buildLegacyStructuralKinshipGraph: buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");

const characters = new Map([
  [1, { id: 1, fullName: "甲君", spouses: [{ id: 2, name: "乙氏", source: "CK3_GAME_CURRENT_SPOUSE",
    sourceOwnerId: 1, relatedCharacterId: 1, observerRuntimeId: 1, sourceRelation: "spouses", relationType: "CURRENT_SPOUSE",
    evidenceScope: "SOURCE_OWNER_RECORD_ONLY", publicStatus: "PUBLIC_LEGAL_MARRIAGE", knowledgeStatus: "UNKNOWN",
    campaignToken: "neutral-spouse-fixture", sourceSnapshotId: "1175.1.1/430000", evidenceConflict: false, targetBound: true }] }],
  [2, { id: 2, fullName: "乙氏", gender: "unknown", evidence: { conflicts: { gender: true } } }]
]);
const graph = buildKinshipGraph(characters);

const neutral = resolveAnchoredRelationMention({ query: "甲君的配偶是谁", responderId: 1, graph });
assert.equal(neutral.status, "RELATION_RESOLVED");
assert.equal(neutral.targetRuntimeId, "2");
assert.equal(neutral.target.sexConflict, true);
const family = buildFamilyFactBlock(characters.get(1), { date: "1175.1.1", totalDays: 430000, campaignToken: "neutral-spouse-fixture", characters, getMentionableCharacterProfiles: () => characters }, { query: "甲君的配偶是谁" });
assert.match(family, /目标人物：乙氏/);
assert.match(family, /性别数据存在冲突/);

const gendered = resolveAnchoredRelationMention({ query: "甲君的妻子是谁", responderId: 1, graph });
assert.equal(gendered.status, "RELATION_GENDER_CONFLICT");

console.log("V8.8.2 Neutral Spouse Gender Conflict: PASS");
