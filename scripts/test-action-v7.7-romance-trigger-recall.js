"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.actionRegistry = {
  getAllActions: () => fs.readdirSync(actionsDir)
    .filter((file) => file.endsWith(".js"))
    .map((file) => {
      const definition = require(path.join(actionsDir, file));
      return { id: definition.signature, definition };
    })
};

const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();

const positiveCases = [
  ["今夜我与你共赴巫山，行了一场鱼水之欢。", "intercourse"],
  ["你我共度了春宵。", "intercourse"],
  ["云雨一番之后，二人相拥而眠。", "intercourse"],
  ["我们已有夫妻之实。", "intercourse"],
  ["从今以后，你便是我的情人。", "becomeLoversWith"],
  ["好，从现在起我们就是恋人了。", "becomeLoversWith"],
  ["我认定你就是我此生唯一的灵魂伴侣。", "becomeSoulmatesWith"],
  ["从此我们便是灵魂伴侣。", "becomeSoulmatesWith"]
];

for (const [text, expectedActionId] of positiveCases) {
  const profile = ActionEngine.getSemanticActionProfile(text);
  assert(profile.allowedActionIds.includes(expectedActionId), `${text}: must resolve ${expectedActionId}`);
}

const negativeCases = [
  "我想与你行一场鱼水之欢。",
  "今夜我们共度春宵吧？",
  "若你愿意，我们便共度春宵。",
  "我试图与你共度春宵，但你拒绝了。",
  "我回忆起曾与你共度春宵的旧事。",
  "你愿意从今以后做我的情人吗？",
  "我希望你成为我的恋人。",
  "若你答应，我们从此就是恋人。",
  "我回忆起我们曾是恋人的日子。",
  "你愿意成为我的灵魂伴侣吗？",
  "若你点头，我们从此便是灵魂伴侣。"
];

for (const text of negativeCases) {
  const selected = ActionEngine.getSemanticActionProfile(text).allowedActionIds;
  assert(!selected.includes("intercourse"), `${text}: must not execute intercourse`);
  assert(!selected.includes("becomeLoversWith"), `${text}: must not create lover relation`);
  assert(!selected.includes("becomeSoulmatesWith"), `${text}: must not create soulmate relation`);
}

console.log("VOTC v7.7 romance trigger recall: PASS (natural completion language and non-executed boundaries)");
