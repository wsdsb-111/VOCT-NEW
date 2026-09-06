"use strict";

const assert = require("assert");
const { getRuntimeDefinitionIndex, runtimeDefinitionIds } = require("../resources/app/out/main/worldline/runtime-definition-index");

const snapshot = {
  definitionToRuntime: { han_001: "100", yue_001: "101", broken_forward: "102" },
  runtimeToDefinitions: { "100": ["han_001"], "101": ["yue_001", "reverse_only"], "103": ["reverse_without_forward"] }
};

const index = getRuntimeDefinitionIndex(snapshot);
assert.strictEqual(index, getRuntimeDefinitionIndex(snapshot), "one snapshot builds its reverse index once");
assert.deepEqual(runtimeDefinitionIds(snapshot, "100"), ["han_001"]);
assert.deepEqual(runtimeDefinitionIds(snapshot, "101"), ["yue_001", "reverse_only"], "forward and reverse evidence stay visible together");
assert.deepEqual(runtimeDefinitionIds(snapshot, "102"), ["broken_forward"]);
assert.deepEqual(runtimeDefinitionIds(snapshot, "103"), ["reverse_without_forward"]);
assert.equal(snapshot.runtimeDefinitionIndex, undefined, "the derived reverse index must not mutate persisted snapshot data");
assert.equal(index.forwardByDefinition.get("han_001"), "100");
assert.deepEqual(index.reverseByRuntime.get("101"), ["yue_001", "reverse_only"]);

console.log("V8.6 Runtime Definition Reverse Index: PASS (WeakMap reuse, forward/reverse evidence and immutable snapshots)");
