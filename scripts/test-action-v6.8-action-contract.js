const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.actionRegistry = {
  getAllActions: () => fs.readdirSync(actionsDir).filter((file) => file.endsWith(".js")).map((file) => {
    const definition = require(path.join(actionsDir, file));
    return { id: definition.signature, definition };
  })
};
const engineStart = source.indexOf("class ActionEngine {");
const engineEnd = source.indexOf("\nclass Conversation {", engineStart);
assert(engineStart >= 0 && engineEnd > engineStart, "Cannot extract ActionEngine");
eval(`${source.slice(engineStart, engineEnd)}\nglobalThis.__V68ActionEngine = ActionEngine;`);
const ActionEngine = globalThis.__V68ActionEngine;

const positives = [
  ["我给张三50金币。", "gold", "paysGoldTo"],
  ["我将张三关进地牢。", "imprisonment", "isImprisonedBy"],
  ["我刺伤张三。", "death_or_injury", "isInjured"],
  ["我与张三正式结盟。", "relationship", "makeAlliance"],
  ["我对张三的好感增加了。", "opinion_change", "changeOpinionOf"],
  ["我任命张三为骑士。", "employment_or_office", "isEmployedAsKnightBy"],
  ["张三向我称臣。", "faith_or_vassal", "isVassalizedBy"],
  ["张三离开大厅。", "location_or_exit", "leavesConversation"],
  ["张三举杯敬酒。", "drinking_or_toast", "setEmotion"],
  ["张三脱下外袍。", "intimacy_or_clothing", "isUndressed"],
  ["我与张三已经完成房事。", "sexual_intercourse_completed", "intercourse"],
  ["张三微笑。", "visible_pose", "setEmotion"],
  ["张三醉了。", "rp_status", "setRoleplayStatus"],
  ["张三正式加入独立派系。", "faction_commitment", "recordFactionCommitment"],
  ["我释放张三。", "prisoner_resolution", "resolvePrisoner"],
  ["我开始拉拢张三。", "scheme_start", "startPersonalScheme"],
  ["我开始谋杀张三。", "scheme_start", "startHostileScheme"]
];

for (const [text, category, actionId] of positives) {
  const profile = ActionEngine.getSemanticActionProfile(text);
  assert(profile.reasons.includes(category), `${text}: missing category ${category}`);
  assert(profile.allowedActionIds.includes(actionId), `${text}: missing semantic action ${actionId}`);
}

for (const text of [
  "我想把张三关进地牢。",
  "我会给张三50金币。",
  "我计划任命张三为骑士。",
  "我差点刺伤张三。",
  "我试图斩首张三，但失败了。",
  "我想与张三正式结盟。"
]) {
  assert.strictEqual(ActionEngine.getSemanticActionProfile(text).allowedActionIds.length, 0, `${text}: plans and failed attempts must not expose executable actions`);
}

for (const file of fs.readdirSync(actionsDir).filter((name) => name.endsWith(".js"))) {
  const action = require(path.join(actionsDir, file));
  if (action.signature === "noOp") continue;
  assert(Array.isArray(action.triggerCategories) && action.triggerCategories.length > 0, `${action.signature}: must declare trigger categories`);
  assert(action.semantic?.requiresLegacyResolution || Array.isArray(action.semantic?.evidencePatterns), `${action.signature}: must declare deterministic semantic evidence or an explicit legacy contract`);
}

console.log("VOTC v6.8 action contract: PASS (all persistent categories and non-execution boundaries)");
