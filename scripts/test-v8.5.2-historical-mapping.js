"use strict";

const assert = require("assert");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

const genericRecord = { definitionId: "generic", displayName: "司马光", names: ["司马光"], sourceComplete: true, sourceRows: [{ source: { modId: null } }] };
const generic = WorldlineService.prototype.getHistoricalBindings.call({
  currentCheckpoint: { snapshot: { characters: {}, definitionToRuntime: {}, runtimeToDefinitions: {} } },
  getLiveState: () => ({ characters: [] }),
  historicalDefinitionIndex: { find: () => ({ status: "FOUND", candidates: [genericRecord], sourceComplete: true, candidateSetComplete: true }) }
}, { query: "司马光" });
assert.equal(generic.bindings[0].historicalName, "司马光");
assert.equal(generic.playerView.historicalCharacters[0].currentCharacter, "当前存档未找到");

const runtimeName = WorldlineService.prototype.getHistoricalBindings.call({
  currentCheckpoint: { snapshot: { characters: { "1": { fullName: "赵思昭" } }, definitionToRuntime: { unresolved: "1" }, runtimeToDefinitions: { "1": ["unresolved"] } } },
  getLiveState: () => ({ characters: [] }),
  historicalDefinitionIndex: { find: () => ({ status: "FOUND", candidates: [{ definitionId: "unresolved", displayName: null, names: ["raw_key"], sourceComplete: true }], sourceComplete: true, candidateSetComplete: true }) }
}, { query: "赵思昭" });
assert.equal(runtimeName.bindings[0].historicalName, "赵思昭", "verified localized runtime text must precede curated aliases or raw keys");
assert(!/raw_key/.test(runtimeName.bindings[0].historicalName));

console.log("V8.5.2 Historical Mapping: PASS (generic index names, runtime display names and raw-key suppression)");
