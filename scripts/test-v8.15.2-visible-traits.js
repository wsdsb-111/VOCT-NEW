"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = path.resolve(__dirname, "..");
const policy = require(path.join(root, "resources/app/out/main/prompts/trait-visibility-policy"));
const { createLogParser } = require(path.join(root, "resources/app/out/main/game-data/log-parser"));

function checkVisibility(input, expected, canonicalKey) {
  const result = policy.resolveTraitVisibility(input);
  assert.strictEqual(result.status, expected, JSON.stringify(input));
  if (canonicalKey) assert.strictEqual(result.canonicalKey, canonicalKey);
}

assert.strictEqual(policy.OBSERVABLE_TO_OTHERS.size, 42);
assert(policy.OBSERVABLE_TO_OTHERS.has("wheezing"));
assert(policy.OBSERVABLE_TO_OTHERS.has("incapable"));
for (const key of policy.OBSERVABLE_TO_OTHERS) checkVisibility({ traitId: key }, "OBSERVABLE", key);
for (const key of policy.NON_OBSERVABLE_TO_OTHERS) checkVisibility({ traitId: key }, "NON_OBSERVABLE", key);

checkVisibility({ traitId: "beauty_good_3", name: "天才", category: "Personality Trait" }, "OBSERVABLE", "beauty_good_3");
checkVisibility({ traitId: "intellect_good_3", name: "倾国倾城", category: "Appearance" }, "NON_OBSERVABLE", "intellect_good_3");
checkVisibility({ traitId: "Beautiful", name: "天才", category: "Personality Trait" }, "OBSERVABLE", "beauty_good_3");
checkVisibility({ name: "倾国倾城" }, "OBSERVABLE", "beauty_good_3");
for (const name of ["伤疤", "瘢痕处处", "血肉模糊"]) checkVisibility({ name }, "OBSERVABLE", "scarred");
for (const key of ["one_eyed", "albino", "scarred"]) checkVisibility({ traitId: key, category: "Health Trait" }, "OBSERVABLE", key);
for (const [key, name] of [["clouded_eyes", "瞳孔浑浊"], ["measles", "麻疹"], ["weak", "虚弱"]]) {
  checkVisibility({ traitId: key, name, category: "Health Trait" }, "OBSERVABLE", key);
  checkVisibility({ name }, "OBSERVABLE", key);
}
checkVisibility({ name: "纤弱" }, "OBSERVABLE", "physique_bad_1");
checkVisibility({ traitId: "mod_visible_scar", name: "面部刀疤", category: "Appearance" }, "OBSERVABLE", "mod_visible_scar");
checkVisibility({ traitId: "mod_secretive", name: "城府深沉", category: "Personality Trait" }, "NON_OBSERVABLE", "mod_secretive");
checkVisibility({ traitId: "mod_conflict", name: "倾国倾城", category: "Personality Trait" }, "NON_OBSERVABLE", "mod_conflict");
checkVisibility({ traitId: "mod_health", name: "隐性疾病", category: "Health Trait" }, "UNKNOWN", "mod_health");
const customLocalized = { traitId: "mod_custom", name: "倾国倾城" };
assert.strictEqual(policy.resolveTraitVisibility(customLocalized).canonicalKey, policy.normalizeTraitKey(customLocalized));
assert(policy.getTraitAliases({ traitId: "beauty_good_3", name: "自定义名称" }).includes("倾国倾城"));
assert.strictEqual(policy.normalizeTraitKey("trait_beauty_good_3"), "beauty_good_3");

class TestGameData {
  constructor() { this.characters = new Map(); }
}
class TestCharacter {
  constructor(data) {
    this.id = Number(data[0]);
    this.traits = [];
    this.children = [];
    this.siblings = [];
  }
}

async function parseLines(lines) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "votc-visible-traits-"));
  const filename = path.join(directory, "debug.log");
  fs.writeFileSync(filename, lines.join("\n"), "utf8");
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await createLogParser({ GameData: TestGameData, Character: TestCharacter })(filename);
  } finally {
    console.log = originalLog;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

(async () => {
  const legacy = await parseLines([
    "VOTC:IN/;/init/;/0",
    "VOTC:IN/;/character/;/1",
    "VOTC:IN/;/trait/;/1/;/外貌特质/;/倾国倾城/;/old description",
    "VOTC:IN/;/kids/;/1/;/11/;/Child/;/he/;/0/;/0001.1.1",
    "VOTC:IN/;/kid_trait/;/1/;/11/;/健康特质/;/哮喘/;/old child description",
    "VOTC:IN/;/kid_eob/;/1",
    "VOTC:IN/;/siblings/;/1/;/12/;/Sibling/;/he/;/0/;/0001.1.1",
    "VOTC:IN/;/sibling_trait/;/1/;/12/;/身体特质/;/独眼/;/old sibling description",
    "VOTC:IN/;/sibling_eob/;/1"
  ]);
  assert.deepStrictEqual(legacy.characters.get(1).traits[0], {
    category: "外貌特质", name: "倾国倾城", desc: "old description"
  });
  assert.deepStrictEqual(legacy.characters.get(1).children[0].traits[0], {
    category: "健康特质", name: "哮喘", desc: "old child description"
  });
  assert.deepStrictEqual(legacy.characters.get(1).siblings[0].traits[0], {
    category: "身体特质", name: "独眼", desc: "old sibling description"
  });

  const current = await parseLines([
    "VOTC:IN/;/init/;/0",
    "VOTC:IN/;/character/;/1",
    "VOTC:IN/;/trait/;/1/;/beauty_good_3/;/外貌特质/;/倾国倾城/;/description",
    "VOTC:IN/;/kids/;/1/;/11/;/Child/;/he/;/0/;/0001.1.1",
    "VOTC:IN/;/kid_trait/;/1/;/11/;/wheezing/;/健康特质/;/哮喘/;/child description",
    "VOTC:IN/;/kid_eob/;/1",
    "VOTC:IN/;/siblings/;/1/;/12/;/Sibling/;/he/;/0/;/0001.1.1",
    "VOTC:IN/;/sibling_trait/;/1/;/12/;/one_eyed/;/身体特质/;/独眼/;/sibling description",
    "VOTC:IN/;/sibling_eob/;/1"
  ]);
  const characterTrait = current.characters.get(1).traits[0];
  assert.strictEqual(characterTrait.traitId, "beauty_good_3");
  assert.strictEqual(characterTrait.localizedName, "倾国倾城");
  assert.strictEqual(characterTrait.category, "外貌特质");
  assert.strictEqual(characterTrait.name, "倾国倾城");
  assert.strictEqual(current.characters.get(1).children[0].traits[0].traitId, "wheezing");
  assert.strictEqual(current.characters.get(1).siblings[0].traits[0].traitId, "one_eyed");

  process.stdout.write("v8.15.2 visible trait identity and policy checks passed\n");
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
