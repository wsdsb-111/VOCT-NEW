"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "evals", "v7.6-semantic-golden-set.json"), "utf8"));
const actionPrompt = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "action-prompt-builder.js"), "utf8");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
const actionIds = new Set(fs.readdirSync(actionsDir).filter((file) => file.endsWith(".js")).map((file) => require(path.join(actionsDir, file)).signature));

assert(cases.length >= 30 && cases.length <= 50, "the lightweight semantic review set must stay between 30 and 50 cases");
assert.strictEqual(new Set(cases.map((entry) => entry.id)).size, cases.length, "semantic case IDs must be unique");
for (const entry of cases) {
  assert(["action", "non_action", "summary"].includes(entry.kind), `${entry.id}: invalid kind`);
  assert(typeof entry.input === "string" && entry.input.length > 4, `${entry.id}: input required`);
  assert(Array.isArray(entry.expectedActionIds), `${entry.id}: expectedActionIds required`);
  assert(Array.isArray(entry.summaryMustInclude) && entry.summaryMustInclude.length > 0, `${entry.id}: summary expectations required`);
  for (const actionId of entry.expectedActionIds) assert(actionIds.has(actionId), `${entry.id}: unknown action ${actionId}`);
  if (entry.kind !== "action") assert.strictEqual(entry.expectedActionIds.length, 0, `${entry.id}: non-action/summary case must not execute an action`);
}
const kindCounts = Object.fromEntries(["action", "non_action", "summary"].map((kind) => [kind, cases.filter((entry) => entry.kind === kind).length]));
assert(kindCounts.action >= 10 && kindCounts.non_action >= 10 && kindCounts.summary >= 10, "golden set must balance positive actions, negative boundaries and summaries");
for (const boundary of ["Questions", "commands", "plans", "threats", "hypotheticals", "memories", "reports", "failed attempts"]) {
  assert(actionPrompt.includes(boundary), `action prompt must retain the ${boundary} non-action boundary`);
}
assert(actionPrompt.includes("CURRENT_COMPLETED_ACTION or NON_ACTION"));

console.log(`VOTC v7.6 semantic golden set: PASS (${cases.length} cases: ${kindCounts.action} action, ${kindCounts.non_action} non-action, ${kindCounts.summary} summary)`);
