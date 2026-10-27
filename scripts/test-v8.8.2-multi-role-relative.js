"use strict";

const assert = require("assert");
const { buildLegacyStructuralKinshipGraph: buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");
const { HistoricalEntityBindingCache } = require("../resources/app/out/main/worldline/historical-entity-binding");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");

const characters = new Map([
  [5, { id: 5, fullName: "祖父", children: [3, 4] }],
  [3, { id: 3, fullName: "伯父", children: [1] }],
  [4, { id: 4, fullName: "叔父", children: [2] }],
  [1, { id: 1, fullName: "甲郎", gender: "male", spouse: 2 }],
  [2, { id: 2, fullName: "乙娘", gender: "female", spouse: 1 }],
  [9, { id: 9, fullName: "回应者" }]
]);
const graph = buildKinshipGraph(characters);
assert.equal(graph.relationBetween(2, 1).diagnostic.code, "RELATION_CONFLICT_TYPE");
const scoped = graph.relationBetweenOfTypes(2, 1, ["SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"]);
assert.equal(scoped.relation.type, "SPOUSE_OF");
assert.equal(scoped.diagnostic, null);

const result = resolveAnchoredRelationMention({ query: "甲郎的妻子是谁", responderId: 9, graph });
assert.equal(result.status, "RELATION_RESOLVED");
assert.equal(result.targetRuntimeId, "2");
const familyCharacters = new Map([...characters].map(([id, character]) => [id, { ...character }]));
familyCharacters.get(1).spouse = null;
familyCharacters.get(2).spouse = null;
familyCharacters.get(1).spouses = [{ id: 2, name: "乙娘", source: "CK3_GAME_CURRENT_SPOUSE", sourceOwnerId: 1,
  relatedCharacterId: 1, observerRuntimeId: 1, sourceRelation: "spouses", relationType: "CURRENT_SPOUSE",
  evidenceScope: "SOURCE_OWNER_RECORD_ONLY", publicStatus: "PUBLIC_LEGAL_MARRIAGE", knowledgeStatus: "UNKNOWN",
  campaignToken: "multi-role-fixture", sourceSnapshotId: "1175.1.1/430000", evidenceConflict: false, targetBound: true }];
const familyData = { date: "1175.1.1", totalDays: 430000, campaignToken: "multi-role-fixture", characters: familyCharacters,
  getMentionableCharacterProfiles: () => familyCharacters };
const block = buildFamilyFactBlock(familyCharacters.get(9), familyData, { query: "甲郎的妻子是谁" });
assert.match(block, /查询关系主体：甲郎/);
assert.match(block, /目标人物：乙娘/);

const snapshot = parseGameState(`date=1175.1.1 playthrough_id="campaign" played_character=9
  living={ 5={first_name="祖父"} 3={first_name="伯父" family_data={father=5}}
    4={first_name="叔父" family_data={father=5}}
    1={first_name="甲郎" female=no family_data={father=3 spouse=2}}
    2={first_name="乙娘" female=yes family_data={father=4}}
    9={first_name="回应者"} }`);
snapshot.indexes = { verifiedFullNameToRuntimeIds: { "甲郎": ["1"] }, givenNameToRuntimeIds: {} };
const inspector = WorldlineService.prototype.getEntityKinshipInspector.call({
  currentCheckpoint: {
    id: "checkpoint",
    snapshot
  },
  canon: { branch: () => ({ campaignId: "campaign", branchId: "branch" }) },
  historicalDefinitionIndex: null,
  historicalBindingCache: new HistoricalEntityBindingCache()
}, { query: "甲郎的妻子是谁", responderId: "9" });
assert.equal(inspector.target.runtimeId, "2", "the inspector target must be the relation target, not the named anchor");
assert.equal(inspector.relation.type, "SPOUSE_OF");
assert.equal(inspector.familyFact.relation, "SPOUSE_OF");

console.log("V8.8.2 Multi-role Relative: PASS");
