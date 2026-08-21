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

for (const [text, actionId] of [
  ["我将张三的手砍了下来。", "isInjured"],
  ["我在张三手臂上砍了一刀。", "isInjured"],
  ["我在张三肩膀上刺了一剑。", "isInjured"],
  ["我将张三的脑袋割了下来。", "characterIsKilled"],
  ["张三的脑袋被我砍了下来。", "characterIsKilled"],
  ["张三身首异处。", "characterIsKilled"]
]) {
  const profile = ActionEngine.getSemanticActionProfile(text);
  assert.deepStrictEqual(profile.allowedActionIds, [actionId], `${text}: must resolve only ${actionId}`);
}

for (const text of ["我朝张三砍了一刀。", "我想砍下张三的手。", "我差点砍下张三的脑袋。", "我试图斩首张三，但失败了。"]) {
  assert.strictEqual(ActionEngine.getSemanticActionProfile(text).allowedActionIds.length, 0, `${text}: incomplete or failed physical action must not execute`);
}

console.log("VOTC v6.8 Chinese completion: PASS (result and quantity complements remain fail-closed)");
