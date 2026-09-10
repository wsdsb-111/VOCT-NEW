"use strict";

const assert = require("assert");
const { parseRelationIntent } = require("../resources/app/out/main/worldline/relation-intent-parser");

const explicit = parseRelationIntent("燕王的配偶是谁");
assert.equal(explicit.detected, true);
assert.equal(explicit.label, "配偶");
assert.equal(explicit.sexConstraint, null);
assert.equal(explicit.anchorMode, "EXPLICIT");
const responder = parseRelationIntent("你的配偶近来如何");
assert.equal(responder.sexConstraint, null);
assert.equal(responder.anchorMode, "RESPONDER");
assert.equal(parseRelationIntent("燕王的丈夫是谁").sexConstraint, "male");
assert.equal(parseRelationIntent("燕王的妻子是谁").sexConstraint, "female");

console.log("V8.8.2 Spouse Neutral: PASS");
