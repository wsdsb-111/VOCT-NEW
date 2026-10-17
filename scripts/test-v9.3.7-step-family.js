"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLogParser } = require("../src/app/main/game-data/log-parser");
const { buildStepFamilyFactBlock, isStepFamilyQuery } = require("../src/app/main/worldline/step-family-facts");

class FixtureGameData {
  constructor(data) {
    this.playerID = Number(data[0]);
    this.characters = new Map();
    this.date = data[4];
    this.totalDays = Number(data[8]);
  }
}

class FixtureCharacter {
  constructor(data) {
    this.id = Number(data[0]);
    this.fullName = data[2] || data[1];
    this.parents = [];
    this.children = [];
    this.siblings = [];
    this.secrets = [];
  }
}

function row(type, rootId, ...fields) {
  return `VOTC:IN/;/${type}/;/${[rootId, ...fields].join("/;/")}`;
}

async function parseFixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v937-step-family-"));
  const filePath = path.join(dir, "debug.log");
  fs.writeFileSync(filePath, `${lines.join(os.EOL)}${os.EOL}`, "utf8");
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await createLogParser({ GameData: FixtureGameData, Character: FixtureCharacter })(filePath);
  } finally {
    console.log = originalLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const fixtureLines = [
    row("init", 1, "主角", 2, "回应者", "1080年1月1日", "测试", "长安", "长安", 10000),
    "VOTC:CAMPAIGN/votc8c-202610170001",
    row("character", 1, "主角"),
    row("parents", 1, 10, "父亲", 900, "1040年1月1日", 40, "he", "PUBLIC_LEGAL_PARENT"),
    row("parents", 1, 11, "母亲", 1200, "1041年1月1日", 39, "she", "PUBLIC_LEGAL_PARENT"),
    row("parent_spouse", 1, 10, 20, "继母", "she", "PUBLIC_LEGAL_MARRIAGE"),
    row("parent_spouse_child", 1, 10, 20, 30, "继母之子", "he", 22, "另一位父亲", "he", "PUBLIC_LEGAL_PARENT"),
    row("parent_spouse", 1, 10, 21, "秘密配偶", "she", "UNKNOWN"),
    row("parent_spouse_child", 1, 10, 21, 31, "秘密孩子", "he", 22, "秘密另一亲", "she", "UNKNOWN")
  ];
  const gameData = await parseFixture(fixtureLines);

  const root = gameData.characters.get(1);
  assert.equal(root.parents[0].gender, "male", "parent gender comes from the exported pronoun");
  assert.equal(root.parents[0].genderSource, "CK3_LIVE_RELATIVE", "known parent gender records its CK3 source");
  assert.equal(root.parents[1].gender, "female");
  assert.equal(root.parents[0].spouses.length, 1, "only an explicitly public legal marriage is retained");
  assert.equal(root.parents[0].spouses[0].id, 20);
  assert.equal(root.parents[0].spouses[0].gender, "female");
  assert.equal(root.parents[0].spouses[0].campaignToken, gameData.campaignToken);
  assert.equal(root.parents[0].spouses[0].sourceSnapshotId, "1080年1月1日/10000");
  assert.equal(root.parents[0].spouses[0].children.length, 1, "only a complete public legal parent row is retained");
  assert.deepEqual(root.parents[0].spouses[0].children[0].parents.map(parent => parent.id), [20, 22]);

  const canonicalRoot = {
    ...root,
    parents: root.parents.map(parent => ({ ...parent, spouses: [] }))
  };
  const canonicalGameData = {
    ...gameData,
    characters: new Map([[1, canonicalRoot]])
  };

  const parentFacts = buildStepFamilyFactBlock(root, canonicalGameData, { query: "继母是谁？" });
  assert.equal(parentFacts.handled, true);
  assert.match(parentFacts.text, /当前继母：继母/u, "fresh spouse rows on the responder brief must survive an empty canonical spouses array");
  assert.equal(parentFacts.metrics.targetedParentQuery, true);
  assert.equal(parentFacts.metrics.sourceKinds.currentMarriage, 1);

  const siblingFacts = buildStepFamilyFactBlock(root, canonicalGameData, { query: "继兄弟是谁？" });
  assert.equal(siblingFacts.handled, true);
  assert.match(siblingFacts.text, /继母之子/);
  assert.equal(siblingFacts.metrics.sourceKinds.currentMarriage, 1);
  assert.doesNotMatch(siblingFacts.text, /秘密配偶|秘密孩子|秘密另一亲/u, "unknown spouse and child rows must not leak into the facts");

  const halfSiblingLines = [
    ...fixtureLines,
    row("parent_spouse", 1, 11, 23, "继父", "he", "PUBLIC_LEGAL_MARRIAGE"),
    row("parent_spouse_child", 1, 11, 23, 32, "同父异母兄弟", "he", 10, "父亲", "he", "PUBLIC_LEGAL_PARENT"),
    row("parent_spouse", 1, 10, 24, "另一位继母", "she", "PUBLIC_LEGAL_MARRIAGE"),
    row("parent_spouse_child", 1, 10, 24, 33, "同母异父兄弟", "he", 11, "母亲", "she", "PUBLIC_LEGAL_PARENT")
  ];
  const halfSiblingData = await parseFixture(halfSiblingLines);
  const sameFatherFacts = buildStepFamilyFactBlock(halfSiblingData.characters.get(1), halfSiblingData, { query: "你和同父异母兄弟是继兄弟吗？" });
  assert.match(sameFatherFacts.text, /同父异母，不按继兄弟姐妹归类/u);
  assert.doesNotMatch(sameFatherFacts.text, /当前继兄弟：同父异母兄弟/u);
  const sameMotherFacts = buildStepFamilyFactBlock(halfSiblingData.characters.get(1), halfSiblingData, { query: "你和同母异父兄弟是继兄弟吗？" });
  assert.match(sameMotherFacts.text, /同母异父，不按继兄弟姐妹归类/u);
  assert.doesNotMatch(sameMotherFacts.text, /当前继兄弟：同母异父兄弟/u);
  assert.equal(isStepFamilyQuery("你继母是谁？"), true);
  assert.equal(isStepFamilyQuery("你和某人是同父异母吗？"), false, "ordinary half-sibling queries remain on the existing kinship fact path");
  assert.equal(isStepFamilyQuery("今天天气如何？"), false);

  const unrelated = buildStepFamilyFactBlock(root, gameData, { query: "今天天气如何？" });
  assert.deepEqual(unrelated, { handled: false, text: null, metrics: null });

  const ambiguousData = await parseFixture([
    ...fixtureLines,
    row("parent_spouse", 1, 10, 25, "另一位继母", "she", "PUBLIC_LEGAL_MARRIAGE")
  ]);
  const ambiguous = buildStepFamilyFactBlock(ambiguousData.characters.get(1), ambiguousData, { query: "继母是谁？" });
  assert.match(ambiguous.text, /存在多个候选，未选择具体人物/u);
  assert.doesNotMatch(ambiguous.text, /当前继母：继母/u, "multiple current spouses must not be silently selected");

  const unknownGenderData = await parseFixture([
    ...fixtureLines,
    row("parent_spouse", 1, 10, 26, "性别未知配偶", "they", "PUBLIC_LEGAL_MARRIAGE"),
    row("parent_spouse_child", 1, 10, 26, 27, "性别未知配偶之子", "he", 28, "另一位父亲", "he", "PUBLIC_LEGAL_PARENT")
  ]);
  const unknownGender = buildStepFamilyFactBlock(unknownGenderData.characters.get(1), unknownGenderData, { query: "继母是谁？" });
  assert.doesNotMatch(unknownGender.text, /性别未知配偶/u, "a public marriage without source-bound gender cannot be classified as a step-parent");
  assert.doesNotMatch(buildStepFamilyFactBlock(unknownGenderData.characters.get(1), unknownGenderData, { query: "继兄弟是谁？" }).text, /性别未知配偶之子/u,
    "unknown spouse gender cannot be used to derive step-sibling facts");

  const staleGameData = { ...gameData, campaignToken: "votc8c-202610170002" };
  const stale = buildStepFamilyFactBlock(root, staleGameData, { query: "继母是谁？" });
  assert.equal(stale.handled, true);
  assert.doesNotMatch(stale.text, /继母之子/);
  assert.match(stale.text, /未知|未确认/);

  const staleSnapshotRoot = {
    ...root,
    parents: root.parents.map(parent => ({
      ...parent,
      spouses: parent.spouses.map(spouse => ({ ...spouse, sourceSnapshotId: "1079年12月31日/9999" }))
    }))
  };
  const staleSnapshotCanonical = {
    ...root,
    parents: root.parents.map(parent => ({ ...parent, spouses: [] }))
  };
  const staleSnapshotGameData = { ...gameData, characters: new Map([[1, staleSnapshotCanonical]]) };
  const staleSnapshot = buildStepFamilyFactBlock(staleSnapshotRoot, staleSnapshotGameData, { query: "继母是谁？" });
  assert.doesNotMatch(staleSnapshot.text, /当前继母：继母/u, "stale source snapshots cannot confirm a current step-parent");

  process.stdout.write("V9.3.7 step-family parser and facts checks passed.\n");
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
