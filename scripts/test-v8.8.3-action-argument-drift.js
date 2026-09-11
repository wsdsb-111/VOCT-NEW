"use strict";

const assert = require("assert");
const { detectActionArgumentDrift } = require("../resources/app/out/main/actions/action-confirmation");

assert.deepStrictEqual(detectActionArgumentDrift({ amount: 100 }, { amount: 30 }), { code: "ACTION_ARGUMENT_DRIFT", requestedAmount: 100, selectedAmount: 30 });
assert.strictEqual(detectActionArgumentDrift({ amount: 100 }, { amount: 100 }), null);
assert.strictEqual(detectActionArgumentDrift(null, { amount: 100 }), null);
console.log("VOTC v8.8.3 action argument drift fixtures: PASS");
