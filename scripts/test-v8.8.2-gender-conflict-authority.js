"use strict";

const assert = require("assert");
const { buildLegacyStructuralKinshipGraph: buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");

const characters = new Map([
  [1, { id: 1, fullName: "父亲", children: [2] }],
  [2, { id: 2, fullName: "孩子", gender: "unknown", evidence: { conflicts: { gender: true } } }]
]);
const graph = buildKinshipGraph(characters);
const result = resolveAnchoredRelationMention({ query: "你儿子怎么样", responderId: 1, graph });
assert.equal(result.status, "RELATION_GENDER_CONFLICT");

const campaignToken = "votc8c-202610180005";
const date = "1175.1.1";
const totalDays = 430000;
const currentCharacters = new Map([
  [1, { id: 1, fullName: "父亲", children: [{ id: 2, directParentEvidence: {
    source: "CK3_DIRECT_PARENT", sourceOwnerId: 2, childId: 2, parentId: 1,
    relationType: "parent", sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN", campaignToken, sourceSnapshotId: `${date}/${totalDays}`
  } }] }],
  [2, { id: 2, fullName: "孩子", gender: "unknown", evidence: { conflicts: { gender: true } } }]
]);
const currentGameData = { date, totalDays, campaignToken, characters: currentCharacters,
  getMentionableCharacterProfiles: () => currentCharacters };
const block = buildFamilyFactBlock(currentCharacters.get(1), currentGameData, { query: "你儿子怎么样" });
assert.match(block, /不能确认该人物为男性或女性/);
assert.match(block, /不得依据玩家称谓替代 CK3 性别事实/);
assert.doesNotMatch(block, /必须作为男性亲属处理/);

console.log("V8.8.2 Gender Conflict Authority: PASS");
