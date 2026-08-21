"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const killed = require(path.join(actionsDir, "z_characterIsKilled.js"));
const injured = require(path.join(actionsDir, "z_isInjured.js"));
globalThis.actionRegistry = { getAllActions: () => [{ id: killed.signature, definition: killed }, { id: injured.signature, definition: injured }] };
const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();

for (const text of [
  "我在张三的手臂上划了一剑。",
  "我用匕首割伤了张三的手臂。",
  "我一刀划破了张三的肩膀。",
  "我并没有杀他，只是在他的手臂上划了一剑。"
]) {
  assert.deepStrictEqual(ActionEngine.getSemanticActionProfile(text).allowedActionIds, ["isInjured"], `${text}: must resolve only injury`);
}

for (const text of [
  "我想在张三的手臂上划一剑。",
  "我会割伤张三的手臂。",
  "我试图划伤张三，但失败了。",
  "剑锋从张三的手臂旁划过。",
  "我朝张三挥剑划了一下。"
]) {
  assert.strictEqual(ActionEngine.getSemanticActionProfile(text).allowedActionIds.length, 0, `${text}: incomplete injury must fail closed`);
}

console.log("VOTC v6.8.3 natural injury: PASS (completed cuts only, negative boundaries fail closed)");
