"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const { HistoricalEntityBindingCache } = require("../resources/app/out/main/worldline/historical-entity-binding");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

if (process.argv.includes("--large-graph")) {
  const characters = {};
  for (let i = 1; i <= 160000; i++) characters[i] = { id: i, gender: "male" };
  characters[1].children = [2, 3];
  const start = Date.now();
  const graph = buildKinshipGraph(characters);
  assert.equal(graph.nodes.size, 160000);
  assert.equal(graph.relationBetween(2, 3).relation.type, "SIBLING_OF");
  console.log(`160000 characters: ${Date.now() - start} ms`);
} else {
  const result = spawnSync(process.execPath, [__filename, "--large-graph"], { timeout: 10000, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.error || ""}\n${result.stderr}`);
  console.log(result.stdout.trim());
  const graph = buildKinshipGraph({ 1: { children: [2], spouse: 2 }, 2: {} });
  for (let i = 0; i < 1000; i++) assert.equal(graph.relationBetween(1, 2).relation, null);
  assert.equal(graph.diagnostics.length, 1, "repeated reads must not accumulate conflict rows");
  const cache = new HistoricalEntityBindingCache();
  const snapshot = { characters: { 1: { gender: "male" } }, definitionToRuntime: { figure: "1" }, runtimeToDefinitions: { 1: ["figure"] } };
  const input = { snapshot, candidateDefinitionIds: ["figure"], scope: { campaignId: "campaign", branchId: "branch", checkpointId: "checkpoint" } };
  assert.equal(cache.resolve(input).status, "RESOLVED_RUNTIME");
  assert.equal(cache.resolve({ ...input, definitionRecord: { metadata: { gender: "female" } } }).status, "IDENTITY_CONFLICT_GENDER");
  snapshot.runtimeToDefinitions[2] = ["figure"];
  assert.equal(cache.resolve(input).status, "AMBIGUOUS", "same-scope mutations must fail closed");
  const service = {
    currentCheckpoint: { id: "checkpoint", snapshot: { playthroughId: "campaign", gameDate: "1175.1.1", playerId: "1", characters: { 1: { id: 1, fullName: "父亲", children: [2] }, 2: { id: 2, fullName: "独子", gender: "male", alive: true }, 3: { id: 3, fullName: "同名他人", location: "私密地点" } }, definitionToRuntime: {}, runtimeToDefinitions: {} } },
    canon: { branch: () => ({ campaignId: "campaign", branchId: "branch" }) }, historicalDefinitionIndex: null, historicalBindingCache: new HistoricalEntityBindingCache()
  };
  const relationInspector = WorldlineService.prototype.getEntityKinshipInspector.call(service, { responderId: "1", query: "你的儿子近来如何" });
  assert.equal(relationInspector.target.runtimeId, "2", "a unique relation mention must resolve its target");
  assert.equal(relationInspector.identity.resolutionRule, "RELATION_MENTION_UNIQUE");
  assert.equal(relationInspector.relation.type, "CHILD_OF", "relation direction must describe target relative to responder");
  assert.equal(relationInspector.familyFact.relation, "CHILD_OF");
  const explicitInspector = WorldlineService.prototype.getEntityKinshipInspector.call(service, { responderId: "1", targetId: "2", query: "同名他人" });
  assert.equal(explicitInspector.target.runtimeId, "2");
  assert.deepEqual(explicitInspector.identity.runtimeCandidates, [], "an explicit target must not inherit candidates from a different query entity");
  assert.equal(explicitInspector.difference.status, "UNAVAILABLE", "unrelated query differences must not attach to an explicit target");
  console.log("V8.8 Sol performance and cache safety: PASS");
}
