"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const source = fs.readFileSync(mainPath, "utf8");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.actionRegistry = {
  getAllActions: () => fs.readdirSync(actionsDir).filter((file) => file.endsWith(".js")).map((file) => {
    const definition = require(path.join(actionsDir, file));
    return { id: definition.signature, definition };
  })
};
const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();

const gateCases = [
  ["我在他的手臂上划了一剑。", ["death_or_injury"]],
  ["我明天会在他的手臂上划一剑。", []],
  ["请你把他关进地牢。", ["imprisonment"]],
  ["我试图刺伤他，但他躲开了。", ["combat"]],
  ["我没有杀死他，只是刺伤了他的手臂。", ["combat", "death_or_injury"]],
  ["我想起昨天他被关进地牢。", ["imprisonment"]],
  ["我与张三正式成为恋人。", ["relationship"]],
  ["我们已经完成了房事。", ["sexual_intercourse_completed"]]
];

for (const [text, expected] of gateCases) {
  assert.deepStrictEqual(ActionEngine.getActionTriggers(text).sort(), [...expected].sort(), `gate: ${text}`);
}

const parserCases = [
  ["我在他的手臂上划了一剑。", ["death_or_injury"], []],
  ["我明天会在他的手臂上划一剑。", [], ["non_executed"]],
  ["请你把他关进地牢。", [], ["non_executed"]],
  ["我试图刺伤他，但他躲开了。", ["combat", "death_or_injury"], []],
  ["我没有杀死他，只是刺伤了他的手臂。", ["combat", "death_or_injury"], ["negated"]],
  ["我想起昨天他被关进地牢。", [], []],
  ["我与张三正式成为恋人。", ["relationship"], []],
  ["我们已经完成了房事。", ["sexual_intercourse_completed"], []]
];

for (const [text, expectedCategories, expectedRejections] of parserCases) {
  const parsed = ActionEngine.parseActionEvents(text);
  assert.deepStrictEqual(parsed.events.map((event) => event.category).sort(), [...expectedCategories].sort(), `parser events: ${text}`);
  for (const rejection of expectedRejections) {
    assert(parsed.rejectedCandidates.some((candidate) => candidate.rejectionReason === rejection), `parser rejection ${rejection}: ${text}`);
  }
  for (const event of parsed.events) {
    assert.strictEqual(event.executionStatus, "executed", `event execution status: ${text}`);
    assert(Number.isInteger(event.evidence.start) && Number.isInteger(event.evidence.end), `event offsets: ${text}`);
  }
}

console.log("VOTC v6.9-A gate/parser characterization: PASS (candidate and event boundaries preserved)");
