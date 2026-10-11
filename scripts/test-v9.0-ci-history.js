"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.join(__dirname, "..", ".github", "workflows", "regression.yml");
const workflowLines = fs.readFileSync(workflowPath, "utf8").split(/\r?\n/);
const checkoutIndex = workflowLines.findIndex(line => /^[ \t]*-[ \t]*name:[ \t]*Checkout[ \t]*$/.test(line));
assert.notEqual(checkoutIndex, -1, "regression workflow has a Checkout step");

const nextStepIndex = workflowLines.findIndex((line, index) => index > checkoutIndex && /^[ \t]*-[ \t]*name:/.test(line));
const checkoutStep = workflowLines.slice(checkoutIndex, nextStepIndex === -1 ? undefined : nextStepIndex).join("\n");
assert.match(checkoutStep, /^[ \t]*uses:[ \t]*actions\/checkout@v5[ \t]*$/m,
  "release regression uses the expected checkout action");
assert.match(checkoutStep, /^[ \t]*fetch-depth:[ \t]*0[ \t]*$/m,
  "release regression fetches the history required by historical baseline checks");

console.log("V9.0 CI checkout history: PASS (full Git history is available to regression checks)");
