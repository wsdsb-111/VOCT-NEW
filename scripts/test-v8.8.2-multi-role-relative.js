"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");
const { HistoricalEntityBindingCache } = require("../resources/app/out/main/worldline/historical-entity-binding");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

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
const block = buildFamilyFactBlock(characters.get(9), { date: "1175.1.1", getMentionableCharacterProfiles: () => characters }, { query: "甲郎的妻子是谁" });
assert.match(block, /查询关系主体：甲郎/);
assert.match(block, /目标人物：乙娘/);

const snapshotCharacters = Object.fromEntries([...characters].map(([id, character]) => [id, { ...character }]));
snapshotCharacters[1].parents = [3];
snapshotCharacters[2].parents = [4];
snapshotCharacters[3].parents = [5];
snapshotCharacters[4].parents = [5];
const inspector = WorldlineService.prototype.getEntityKinshipInspector.call({
  currentCheckpoint: {
    id: "checkpoint",
    snapshot: {
      playthroughId: "campaign",
      gameDate: "1175.1.1",
      playerId: "9",
      characters: snapshotCharacters,
      indexes: { verifiedFullNameToRuntimeIds: { "甲郎": ["1"] }, givenNameToRuntimeIds: {} },
      definitionToRuntime: {},
      runtimeToDefinitions: {}
    }
  },
  canon: { branch: () => ({ campaignId: "campaign", branchId: "branch" }) },
  historicalDefinitionIndex: null,
  historicalBindingCache: new HistoricalEntityBindingCache()
}, { query: "甲郎的妻子是谁", responderId: "9" });
assert.equal(inspector.target.runtimeId, "2", "the inspector target must be the relation target, not the named anchor");
assert.equal(inspector.relation.type, "SPOUSE_OF");
assert.equal(inspector.familyFact.relation, "SPOUSE_OF");

console.log("V8.8.2 Multi-role Relative: PASS");
