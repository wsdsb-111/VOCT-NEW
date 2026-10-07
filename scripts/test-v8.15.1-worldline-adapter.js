"use strict";

const assert = require("assert");
const { buildSubjectiveWorldPrompt } = require("../resources/app/out/main/worldline/subjective-prompt-context");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { getCurrentTruth } = require("../resources/app/out/main/worldline/current-truth-adapter");
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");
const { classifySelectedWorldFacts } = require("../resources/app/out/main/worldline/world-knowledge-classifier");

const snapshot = parseGameState(`date=1066.9.15 played_character=1
living={
  1={first_name="甲" rite=34 culture=17 family_data={spouse=0 primary_spouse=0 real_father=0 real_mother=0 child=0} landed_data={liege=0} court_data={employer=0}}
  2={first_name="乙" rite=998 culture=999}
  3={first_name="丙" faith=shinto culture=yamato}
  4={first_name="丁" rite=0 culture=0}
  5={first_name="戊" faith=901 culture=901}
  6={first_name="己" family_data={real_father=0 father=1}}
  7={first_name="庚" rite=35}
}
rites={database={34={faith=100} 0={faith=0} 35={faith=444}}}
faiths={database={100={faith_type=taoism} 0={faith_type=zero_faith}}}
culture_manager={cultures={17={name=han culture_template=chinese} 0={name=zero_culture}}}
`);

assert.equal(snapshot.schemaVersion, 1, "worldline snapshot schema remains compatible");
assert.equal(snapshot.diagnostics.characterCount, 7);
assert.deepEqual(snapshot.diagnostics.missingFields, []);
assert.deepEqual(snapshot.diagnostics.parseWarnings, []);
assert.equal(snapshot.characters["1"].faith, "taoism", "rite and faith databases resolve a canonical faith type");
assert.equal(snapshot.characters["1"].culture, "han", "culture runtime IDs resolve to canonical names");
assert.equal(snapshot.characters["3"].faith, "shinto", "legacy direct faith strings remain unchanged");
assert.equal(snapshot.characters["3"].culture, "yamato", "legacy direct culture strings remain unchanged");
assert.equal(snapshot.characters["4"].faith, "zero_faith", "enumeration ID 0 remains resolvable");
assert.equal(snapshot.characters["4"].culture, "zero_culture", "culture ID 0 remains resolvable");
assert.equal(snapshot.characters["2"].faith, null, "unresolved rite IDs remain unknown");
assert.equal(snapshot.characters["2"].culture, null, "unresolved culture IDs remain unknown");
assert.equal(snapshot.characters["5"].faith, null, "unresolved direct faith IDs remain unknown");
assert.equal(snapshot.characters["5"].culture, null, "unresolved direct culture IDs remain unknown");
assert.equal(snapshot.characters["7"].faith, null, "an unresolved faith ID from a rite remains unknown");

assert.equal(getCurrentTruth(snapshot, "1", "faith").rawValue, "taoism");
assert.equal(getCurrentTruth(snapshot, "1", "culture").rawValue, "han");
assert.equal(getCurrentTruth(snapshot, "2", "faith").reason, "CURRENT_TRUTH_VALUE_UNAVAILABLE");
assert.equal(getCurrentTruth(snapshot, "2", "culture").reason, "CURRENT_TRUTH_VALUE_UNAVAILABLE");

const candidate = {
  id: "character:1",
  kind: "CHARACTER",
  sourceTier: "GAME_TRUTH",
  gameDate: snapshot.gameDate,
  payload: { id: "1", character: snapshot.characters["1"] }
};
const facts = classifySelectedWorldFacts({ gameTruth: [candidate] }, snapshot.gameDate, snapshot);
assert.equal(facts.find((fact) => fact.field === "FAITH").structuredValue, "taoism");
assert.equal(facts.find((fact) => fact.field === "CULTURE").structuredValue, "han");
assert(!facts.some((fact) => fact.field === "PARENTS" || fact.field === "SPOUSE"), "relation sentinel 0 does not become a person fact");
const prompt = buildSubjectiveWorldPrompt({ promptFacts: facts });
assert(prompt.includes("当前信仰为taoism"));
assert(prompt.includes("当前文化为han"));
assert(!prompt.includes("当前信仰为100") && !prompt.includes("当前文化为17"), "runtime IDs do not reach the prompt");
const unknownFacts = classifySelectedWorldFacts({ gameTruth: [{ ...candidate, id: "character:2", payload: { id: "2", character: snapshot.characters["2"] } }] }, snapshot.gameDate, snapshot);
assert(!unknownFacts.some((fact) => fact.field === "FAITH" || fact.field === "CULTURE"));
const unknownPrompt = buildSubjectiveWorldPrompt({ promptFacts: unknownFacts });
assert(!unknownPrompt.includes("998") && !unknownPrompt.includes("999"), "unresolved runtime IDs stay out of the prompt");

assert.equal(snapshot.characters["1"].spouse, null);
assert.equal(snapshot.characters["1"].parents.father, null);
assert.equal(snapshot.characters["1"].parents.mother, null);
assert.deepEqual(snapshot.characters["1"].children, []);
assert.equal(snapshot.characters["1"].liege, null);
assert.equal(snapshot.characters["1"].courtEmployer, null);
assert.equal(snapshot.characters["6"].parents.father, "1", "zero real_father falls through to a valid legacy father field");
const graph = buildKinshipGraph(snapshot.characters);
assert(!graph.nodes.has("0"), "relation sentinel 0 does not create a phantom person");
assert(graph.edges.every((edge) => edge.from !== "0" && edge.to !== "0"));

assert.deepEqual(snapshot.diagnostics.unresolvedRiteIds, [{ id: "998", count: 1, characterIds: ["2"] }]);
assert.deepEqual(snapshot.diagnostics.unresolvedFaithIds, [
  { id: "901", count: 1, characterIds: ["5"] },
  { id: "444", count: 1, characterIds: ["7"] }
]);
assert.deepEqual(snapshot.diagnostics.unresolvedCultureIds, [
  { id: "999", count: 1, characterIds: ["2"] },
  { id: "901", count: 1, characterIds: ["5"] }
]);
assert.deepEqual(snapshot.diagnostics.fieldCoverage, {
  faith: { total: 7, available: 3 },
  culture: { total: 7, available: 3 }
}, "coverage diagnostics distinguish missing fields from unresolved IDs");

console.log("V8.15.1 Worldline Adapter PASS: faith/culture canonicalization, unknown diagnostics, current truth, prompt and relation sentinels");
