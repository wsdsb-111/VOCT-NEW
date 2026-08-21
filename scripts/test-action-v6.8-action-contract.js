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
const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();

const positives = [
  ["我与张三已经达成停战。", "relationship", "agreedToTruceWith"],
  ["我与张三成为了挚友。", "relationship", "becomeBestFriendsWith"],
  ["我与张三结拜为义兄弟。", "relationship", "becomeBloodBrothersWith"],
  ["我与张三成为了朋友。", "relationship", "becomeFriendsWith"],
  ["我与张三成为了恋人。", "relationship", "becomeLoversWith"],
  ["我与张三成为了死敌。", "relationship", "becomeNemesisWith"],
  ["我与张三成为了仇敌。", "relationship", "becomeRivalsWith"],
  ["我与张三成为了灵魂伴侣。", "relationship", "becomeSoulmatesWith"],
  ["张三进入王座厅。", "location_or_exit", "changeLocation"],
  ["我对张三的好感增加了。", "opinion_change", "changeOpinionOf"],
  ["我杀死了张三。", "death_or_injury", "characterIsKilled"],
  ["张三已经改宗。", "faith_or_vassal", "convertsToReligionOf"],
  ["我与张三已经完成房事。", "sexual_intercourse_completed", "intercourse"],
  ["我任命张三加入议会。", "employment_or_office", "isAssignedToCouncilBy"],
  ["我任命张三担任宫廷职位。", "employment_or_office", "isAssignedToCourtPositionBy"],
  ["我任命张三为骑士。", "employment_or_office", "isEmployedAsKnightBy"],
  ["我雇佣了张三。", "employment_or_office", "isEmployedBy"],
  ["我罢免了张三的议会职务。", "employment_or_office", "isFiredFromCouncilOf"],
  ["我将张三关进地牢。", "imprisonment", "isImprisonedBy"],
  ["我刺伤张三。", "death_or_injury", "isInjured"],
  ["张三脱下了外袍。", "intimacy_or_clothing", "isUndressed"],
  ["张三向我称臣。", "faith_or_vassal", "isVassalizedBy"],
  ["张三离开大厅。", "location_or_exit", "leavesConversation"],
  ["我与张三正式结盟。", "relationship", "makeAlliance"],
  ["我给张三50金币。", "gold", "paysGoldTo"],
  ["我给张三50金币。", "gold", "playerPaysGoldTo"],
  ["张三正式加入独立派系。", "faction_commitment", "recordFactionCommitment"],
  ["我释放了张三。", "prisoner_resolution", "resolvePrisoner"],
  ["张三举杯敬酒。", "drinking_or_toast", "setEmotion"],
  ["张三醉了。", "rp_status", "setRoleplayStatus"],
  ["我开始拉拢张三。", "scheme_start", "startPersonalScheme"],
  ["我开始谋杀张三。", "scheme_start", "startHostileScheme"]
];

for (const [text, category, actionId] of positives) {
  const profile = ActionEngine.getSemanticActionProfile(text);
  assert(profile.reasons.includes(category), `${text}: missing category ${category}`);
  assert(profile.allowedActionIds.includes(actionId), `${text}: missing semantic action ${actionId}`);
}

assert.strictEqual(new Set(positives.map((entry) => entry[2])).size, 32, "every persistent standard action must have a positive semantic contract case");

for (const [text, , actionId] of positives) {
  const planned = `我计划${text}`;
  assert.strictEqual(ActionEngine.getSemanticActionProfile(planned).allowedActionIds.length, 0, `${actionId}: an explicit plan must not expose executable actions`);
}

for (const text of [
  "我想把张三关进地牢。",
  "我会给张三50金币。",
  "我计划任命张三为骑士。",
  "我过会儿给张三50金币。",
  "等下我就任命张三为骑士。",
  "迟些时候把张三关起来。",
  "改日我再杀他。",
  "我没有把张三关进地牢。",
  "我差点刺伤张三。",
  "我试图斩首张三，但失败了。",
  "我想与张三正式结盟。",
  "据说张三杀死了李四。",
  "我记得当年曾把张三关进地牢。"
]) {
  assert.strictEqual(ActionEngine.getSemanticActionProfile(text).allowedActionIds.length, 0, `${text}: plans and failed attempts must not expose executable actions`);
}

for (const file of fs.readdirSync(actionsDir).filter((name) => name.endsWith(".js"))) {
  const action = require(path.join(actionsDir, file));
  if (action.signature === "noOp") continue;
  assert(Array.isArray(action.triggerCategories) && action.triggerCategories.length > 0, `${action.signature}: must declare trigger categories`);
  assert(Array.isArray(action.semantic?.evidencePatterns), `${action.signature}: must declare deterministic semantic evidence`);
}

console.log("VOTC v6.8.1 action contract: PASS (32 persistent actions and non-execution boundaries)");
