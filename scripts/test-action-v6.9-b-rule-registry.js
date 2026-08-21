"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const system = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");

const loaded = [
  { id: "injury", validation: { valid: true }, definition: { triggerCategories: ["physical"] } },
  { id: "death", validation: { valid: true }, definition: { triggerCategories: ["physical", "death"] } },
  { id: "invalid", validation: { valid: false }, definition: { triggerCategories: ["physical"] } }
];
const index = system.actionRuleRegistry.buildCategoryIndex(loaded);
assert.deepStrictEqual([...system.actionRuleRegistry.getActionIdsForCategories(index, ["physical"])], ["injury", "death"]);
assert.deepStrictEqual([...system.actionRuleRegistry.getActionIdsForCategories(index, ["death", "physical"])], ["death", "injury"]);

assert.strictEqual(system.actionRuleRegistry.validateActionRules({ triggerCategories: ["physical"], semantic: { riskLevel: "high", deterministicInvocation: true } }).valid, true);
assert.strictEqual(system.actionRuleRegistry.validateActionRules({ triggerCategories: [""], semantic: {} }).valid, false);
assert.strictEqual(system.actionRuleRegistry.validateActionRules({ triggerCategories: ["physical"], semantic: { deterministicInvocation: "yes" } }).valid, false);
assert.strictEqual(system.actionRuleRegistry.validateActionRules({ triggerCategories: ["relationship"], semantic: { bilateralPersistentEffect: true } }).valid, false);

const binding = Object.freeze({ mode: "resolved", bindingId: "m:e:a", sourceCharacterId: 1, targetCharacterId: 2 });
const injury = system.deterministicInvocation.resolve({
  availableAction: { signature: "isInjured", deterministicInvocation: true, participantBinding: binding },
  evidenceText: "我在他的手臂上划了一剑。"
});
assert.strictEqual(injury.mode, "local");
assert.strictEqual(injury.invocation.args.injuryType, "wounded");
const intercourse = system.deterministicInvocation.resolve({
  availableAction: { signature: "intercourse", deterministicInvocation: true, participantBinding: binding },
  evidenceText: "我们已经完成了房事。"
});
assert.strictEqual(intercourse.mode, "local");
assert.deepStrictEqual(intercourse.invocation.args, {});
assert.strictEqual(system.deterministicInvocation.resolve({ availableAction: { signature: "isInjured", deterministicInvocation: false, participantBinding: binding } }).mode, "unsupported");

for (const file of ["z_isInjured.js", "z_intercourse.js"]) {
  const action = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", file));
  assert.strictEqual(action.semantic.deterministicInvocation, true, `${file} deterministic metadata`);
}
assert(!mainSource.includes("getActionIdsForTriggers"), "main.js must not own a manual action category map");
assert(!/deterministicAvailable\?\.signature\s*===/.test(mainSource), "main.js must not dispatch deterministic actions by action id");

console.log("VOTC v6.9-B rule registry: PASS (category index, metadata validation and deterministic resolver registry)");
