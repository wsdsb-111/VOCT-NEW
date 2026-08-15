const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const source = fs.readFileSync(mainPath, "utf8");
const engineStart = source.indexOf("class ActionEngine {");
const engineEnd = source.indexOf("\nclass Conversation {", engineStart);
if (engineStart < 0 || engineEnd < 0) throw new Error("Unable to locate ActionEngine in bundled main.js");
eval(`${source.slice(engineStart, engineEnd)}\nglobalThis.__TestActionEngine = ActionEngine;`);
const ActionEngine = globalThis.__TestActionEngine;

const triggerCases = [
  ["走吧", ["daily_movement"]],
  ["我拿起酒杯", ["daily_object_interaction"]],
  ["我摸着桌面", ["daily_object_interaction"]],
  ["我穿上外袍", ["daily_object_interaction"]],
  ["我吃下糕点", ["daily_object_interaction"]],
  ["我看向她", ["daily_object_interaction"]],
  ["我打赏他十金币", ["gold"]],
  ["我推倒他，又踢了他一脚", ["combat"]],
  ["我挥剑砍伤了他", ["combat", "death_or_injury"]],
  ["我试图刺伤他，但他躲开了", ["combat"]],
  ["他已经没有受伤", []],
  ["我亲吻她", ["intimate_contact"]],
  ["我想要亲吻她", []],
  ["我抚摸并挑逗她", ["intimate_contact"]],
  ["我顶入后缓缓研磨", ["intimate_contact"]],
  ["我们已经完成了房事", ["sexual_intercourse_completed"]],
  ["我计划派刺客暗杀他", ["scheme_start"]],
  ["我会杀了你", []],
  ["如果有机会，我计划暗杀他", []],
  ["他喝得醉醺醺", ["rp_status"]],
  ["我决定加入独立派系", ["faction_commitment"]],
  ["明天再加入独立派系", []],
  ["我释放了他", ["prisoner_resolution"]],
  ["明天释放他", []]
];

for (const [text, expected] of triggerCases) {
  assert.deepStrictEqual(ActionEngine.getActionTriggers(text).sort(), [...expected].sort(), text);
}

const makeCharacter = (id, shortName, age) => ({ id, shortName, fullName: shortName, age });
const characters = /* @__PURE__ */ new Map([
  [1, makeCharacter(1, "Player", 30)],
  [2, makeCharacter(2, "Adult NPC", 25)],
  [3, makeCharacter(3, "Minor NPC", 12)]
]);
const gameData = { characters, playerID: 1, playerName: "Player" };
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
const daily = require(path.join(actionsDir, "z_performDailyAction.js"));
const combat = require(path.join(actionsDir, "z_performCombatAction.js"));
const intimate = require(path.join(actionsDir, "z_performIntimateAction.js"));
const scheme = require(path.join(actionsDir, "z_startPersonalScheme.js"));
const hostileScheme = require(path.join(actionsDir, "z_startHostileScheme.js"));
const rpStatus = require(path.join(actionsDir, "z_setRoleplayStatus.js"));
const faction = require(path.join(actionsDir, "z_recordFactionCommitment.js"));
const prisoner = require(path.join(actionsDir, "z_resolvePrisoner.js"));

for (const action of [daily, combat, intimate, scheme, hostileScheme, rpStatus, faction, prisoner]) {
  const args = typeof action.args === "function" ? action.args({ gameData, sourceCharacter: characters.get(2) }) : action.args;
  assert(action.signature);
  assert(Array.isArray(action.triggerCategories) && action.triggerCategories.length > 0);
  assert(args.every((arg) => arg.name && arg.type && arg.description));
  assert.strictEqual(typeof action.check({ gameData, sourceCharacter: characters.get(2) }).requiresTarget, "boolean");
}

assert.doesNotThrow(() => combat.run({
  gameData,
  sourceCharacter: characters.get(2),
  targetCharacter: characters.get(2),
  args: { action: "slash", weapon: "sword", isPlayerSource: true }
}));
assert.doesNotThrow(() => intimate.run({
  gameData,
  sourceCharacter: characters.get(2),
  targetCharacter: characters.get(2),
  args: { action: "kiss", isPlayerSource: true }
}));
assert.throws(() => intimate.run({
  gameData,
  sourceCharacter: characters.get(2),
  targetCharacter: characters.get(3),
  args: { action: "kiss", isPlayerSource: true }
}), /adult/);

let schemeEffect = "";
assert.doesNotThrow(() => hostileScheme.run({
  gameData,
  sourceCharacter: characters.get(2),
  targetCharacter: characters.get(2),
  args: { scheme: "murder", isPlayerSource: true },
  runGameEffect: (effect) => { schemeEffect = effect; }
}));
assert.match(schemeEffect, /can_start_scheme/);
assert.match(schemeEffect, /type = murder/);
assert.throws(() => scheme.run({
  gameData,
  sourceCharacter: characters.get(2),
  targetCharacter: characters.get(3),
  args: { scheme: "seduce", isPlayerSource: true },
  runGameEffect: () => {}
}), /adult/);

let rpEffect = "";
assert.doesNotThrow(() => rpStatus.run({
  targetCharacter: characters.get(2),
  args: { status: "drunk" },
  runGameEffect: (effect) => { rpEffect = effect; }
}));
assert.match(rpEffect, /votc_rp_status_drunk/);

let factionEffect = "";
assert.doesNotThrow(() => faction.run({
  gameData,
  sourceCharacter: characters.get(2),
  targetCharacter: characters.get(2),
  args: { operation: "support_claimant", isPlayerSource: true },
  runGameEffect: (effect) => { factionEffect = effect; }
}));
assert.match(factionEffect, /votc_faction_commitment_support_claimant/);

let prisonerEffect = "";
assert.doesNotThrow(() => prisoner.run({
  targetCharacter: characters.get(2),
  args: { resolution: "release" },
  runGameEffect: (effect) => { prisonerEffect = effect; }
}));
assert.match(prisonerEffect, /release_from_prison = yes/);

console.log(`Action regression tests passed: ${triggerCases.length} trigger cases and 8 action scripts.`);
