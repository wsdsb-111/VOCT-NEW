"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
assert.match(source, /draft\.currentTruth\?\.available/);
assert.match(source, /draft\.currentTruth\.displayValue/);
assert.match(source, /currentClaim = \{ entityId: truth\.entityId, field: truth\.field, value: truth\.rawValue \}/);
assert.match(source, /当前值不允许手动填写/);
console.log("V8.7.2 Current Claim read-only preview UI PASS");
