"use strict";

const assert = require("assert");
const { buildRuntimeNameIndex, getRuntimeNameIndex } = require("../resources/app/out/main/worldline/runtime-name-index");

const snapshot = {
  gameDate: "1170.6.6",
  playerId: "100",
  characters: {
    "100": { id: "100", firstName: "思昭", fullName: "赵思昭" },
    "101": { id: "101", firstName: "世忠", fullName: "韩世忠" },
    "102": { id: "102", firstName: "思昭" }
  },
  nameToCharacterIds: { "思昭": ["100", "102"], "世忠": ["101"] }
};

const empty = buildRuntimeNameIndex(snapshot);
assert.deepEqual(empty.givenNameToRuntimeIds["思昭"], ["100", "102"]);
assert.deepEqual(empty.verifiedFullNameToRuntimeIds, {}, "a snapshot fullName string alone is never trusted provenance");
assert.equal(snapshot.indexes, undefined, "building an index must not mutate a checkpoint snapshot");

const wrongScope = buildRuntimeNameIndex(snapshot, {
  live: { gameDate: "1170.6.7", playerId: "100", characters: [{ id: "100", firstName: "思昭", fullName: "赵思昭" }] }
});
assert.deepEqual(wrongScope.verifiedFullNameToRuntimeIds, {}, "a Live name from another game date cannot backfill an old snapshot");

const trusted = buildRuntimeNameIndex(snapshot, {
  live: {
    gameDate: "1170年6月6日",
    playerId: "100",
    characters: [
      { id: "100", firstName: "思昭", fullName: "赵思昭" },
      { id: "101", firstName: "世忠", fullName: "韩世忠" },
      { id: "999", firstName: "无关", fullName: "无关人物" }
    ]
  }
});
assert.deepEqual(trusted.verifiedFullNameToRuntimeIds["赵思昭"], ["100"]);
assert.deepEqual(trusted.verifiedFullNameToRuntimeIds["韩世忠"], ["101"]);
assert.equal(trusted.fullNameProvenanceByRuntime["100"].kind, "LIVE_FULL_NAME");
assert.equal(trusted.fullNameProvenanceByRuntime["100"].gameDate, "1170.6.6");

const collision = buildRuntimeNameIndex(snapshot, {
  live: { gameDate: "1170.6.6", playerId: "100", characters: [{ id: "100", firstName: "思昭", fullName: "同名" }, { id: "102", firstName: "思昭", fullName: "同名" }] }
});
assert.deepEqual(collision.verifiedFullNameToRuntimeIds["同名"], ["100", "102"], "the index preserves full-name collisions for the resolver to keep ambiguous");

assert.strictEqual(getRuntimeNameIndex(snapshot), getRuntimeNameIndex(snapshot), "same snapshot without Live evidence reuses its immutable name index");

console.log("V8.6 Runtime Full Name Index: PASS (trusted Live scope, provenance, collisions, given names and immutability)");
