// ========================================
// VOTC v6.5 Action Runtime Boundary Tests
// ========================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
const source = fs.readFileSync(mainPath, "utf8");

const actionEngineStart = source.indexOf("class ActionEngine {");
const actionEngineEnd = source.indexOf("\nclass Conversation {", actionEngineStart);
assert(actionEngineStart >= 0 && actionEngineEnd > actionEngineStart, "Cannot extract ActionEngine from bundled main.js");
eval(`${source.slice(actionEngineStart, actionEngineEnd)}\nglobalThis.ActionEngine = ActionEngine;`);

const failures = [];
const run = (name, test) => {
  try {
    test();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`✗ ${name}: ${error.message}`);
  }
};

console.log("\n========================================");
console.log("VOTC v6.5 Action Runtime Boundary Tests");
console.log("========================================\n");

run("Production independently schedules player and NPC action messages", () => {
  assert(!/pendingPlayerActionMessage\s*\?\?\s*placeholder/.test(source), "obsolete player-or-NPC fallback is still present");
  assert(source.includes("buildTurnEvaluationPlan({"), "Conversation must build an independent turn evaluation plan");
  assert(source.includes("this.evaluateCompletedActions(npc, msgId, placeholder, responseState)"), "NPC reply must enter the independent evaluator with generation identity");

  const player = { id: 1, shortName: "Player" };
  const npc = { id: 2, shortName: "NPC" };
  const playerMessage = { id: "player-1", content: "我递给你50金币。" };
  const npcMessage = { id: "npc-1", content: "我挥拳打向卫兵。" };
  const plan = ActionEngine.buildTurnEvaluationPlan({ playerMessage, player, npcMessage, npc });
  assert.deepStrictEqual(plan.map((entry) => [entry.kind, entry.source.id, entry.message.id]), [
    ["player", 1, "player-1"],
    ["npc", 2, "npc-1"]
  ]);
});

run("ActionEvent rejects hypothetical and failed-before-execution candidates", () => {
  const hypothetical = ActionEngine.parseActionEvents("如果我杀了他，也许会惹麻烦。");
  assert.strictEqual(hypothetical.events.length, 0);
  assert(hypothetical.rejectedCandidates.some((candidate) => candidate.rejectionReason === "hypothetical"));

  const failedAttempt = ActionEngine.parseActionEvents("我试图拔剑，但剑卡在剑鞘里。");
  assert.strictEqual(failedAttempt.events.length, 0);
  assert(failedAttempt.rejectedCandidates.some((candidate) => candidate.rejectionReason === "failed_before_execution"));
});

run("ActionEvent keeps positive spans, execution result, order, and repeated categories", () => {
  const events = ActionEngine.getActionEvents("我先拿起酒杯，随后刺伤卫兵，最后离开大厅。");
  assert.deepStrictEqual(events.map((event) => event.category), ["daily_object_interaction", "death_or_injury", "combat", "location_or_exit"]);
  assert(events.every((event) => event.evidence.text.length > 0 && event.evidence.end === event.evidence.start + event.evidence.text.length));
  assert(!events[1].evidence.text.includes("离开大厅"), "injury evidence must not include a later location event");

  const combat = ActionEngine.getActionEvents("我挥剑刺向他，但他及时躲开了。");
  assert.strictEqual(combat.find((event) => event.category === "combat").executionStatus, "executed");
  assert.strictEqual(combat.find((event) => event.category === "combat").resultStatus, "failed");

  const repeated = ActionEngine.getActionEvents("我刺伤了第一个卫兵，随后又刺伤了第二个卫兵。");
  assert.strictEqual(repeated.filter((event) => event.category === "death_or_injury").length, 2);
});

run("Gold recall keeps real transfer after unrelated hypothetical text", () => {
  const events = ActionEngine.getActionEvents("如果我杀了他，也许会惹麻烦；我现在把50金币交给你。");
  assert.deepStrictEqual(events.map((event) => event.category), ["gold"]);
});

run("Every shipped standard action declares valid semantic metadata", () => {
  const actionFiles = fs.readdirSync(actionsDir).filter((file) => file.endsWith(".js"));
  assert(actionFiles.length > 0, "No standard actions found");
  for (const file of actionFiles) {
    const action = require(path.join(actionsDir, file));
    assert(Array.isArray(action.triggerCategories), `${file}: triggerCategories must be an array`);
    assert(action.semantic && typeof action.semantic === "object", `${file}: semantic metadata is missing`);
    assert(["low", "medium", "high"].includes(action.semantic.riskLevel), `${file}: invalid semantic riskLevel`);
    const hasMatcher = Array.isArray(action.semantic.evidencePatterns) && action.semantic.evidencePatterns.length > 0;
    assert(hasMatcher || action.semantic.requiresLegacyResolution || action.semantic.fallback, `${file}: semantic metadata needs evidencePatterns, legacy resolution, or fallback role`);
  }
});

console.log("\n========================================");
console.log(`Result: ${failures.length === 0 ? "PASS" : "FAIL"} (${5 - failures.length}/5 checks passed)`);
console.log("========================================\n");

if (failures.length > 0) process.exitCode = 1;
