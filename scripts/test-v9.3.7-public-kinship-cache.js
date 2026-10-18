"use strict";

const assert = require("node:assert/strict");
const { createRelationshipResolver } = require("../src/app/main/game-data/relationship-resolver");
const { inferGenderFromPronoun } = require("../src/app/main/game-data/character");
const { buildStableKinship, createStableProfile, formatStableProfile } = require("../src/app/main/prompts/character-profile-v2");
const { buildFamilyFactBlock } = require("../src/app/main/worldline/character-family-facts");
const { buildLegacyFamilyLine } = require("../src/app/main/worldline/legacy-family-presentation");
const { buildFamilyEntityFactBundle } = require("../src/app/main/worldline/family-entity-fact-bundle");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");
const { getCachedKinshipGraph, getTargetedKinshipGraph } = require("../src/app/main/worldline/kinship-graph-cache");

const CAMPAIGN = "v937-public-kinship-fixture";
const SNAPSHOT = "1066.1.1/123";

function makeGameData(patch = {}) {
  const otherParent = {
    id: 1, childId: 10, name: "玩家", parentGender: "male", sourceOwnerId: 99,
    relationType: "parent", source: "CK3_OTHER_PARENT", sourceRelation: "kids.otherParent",
    publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT, ...patch
  };
  const characters = new Map([
    [1, { id: 1, shortName: "玩家", gender: "male" }],
    [10, { id: 10, shortName: "回应者", gender: "male" }],
    [99, { id: 99, shortName: "来源人物", gender: "female",
      children: [{ id: 10, name: "回应者", gender: "male", directParentEvidence: {
        source: "CK3_DIRECT_PARENT", sourceOwnerId: 10, childId: 10, parentId: 99,
        relationType: "parent", sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT",
        knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT
      }, otherParent }] }]
  ]);
  return {
    characters,
    campaignToken: CAMPAIGN, date: "1066.1.1", totalDays: 123,
    getMentionableCharacterProfiles() {
      return createRelationshipResolver({ onDiagnostic: () => false }).buildCanonicalProfiles(this.characters, this.totalDays,
        inferGenderFromPronoun, { campaignToken: this.campaignToken, sourceSnapshotId: `${this.date}/${this.totalDays}` });
    }
  };
}

function assertVisible(gameData, expected, label, directExpected = true) {
  const projected = createTraitProfileView(gameData, gameData.characters.get(10)).gameData;
  assert.equal(!!projected.characters.get(99).children[0]?.otherParent, expected, `${label}: custom template raw parent alias`);
  const graph = getCachedKinshipGraph(gameData);
  const targeted = getTargetedKinshipGraph(gameData, [1, 10, 99]);
  assert.equal(graph.relationBetween(1, 10).relation?.type || null, expected ? "PARENT_OF" : null, `${label}: cached graph`);
  assert.equal(targeted.relationBetween(1, 10).relation?.type || null, expected ? "PARENT_OF" : null, `${label}: targeted graph`);
  const stable = buildStableKinship(gameData.characters.get(10), gameData);
  assert.equal(stable.find(item => Number(item.runtimeId) === 1)?.kinshipType || null,
    expected ? "父亲" : null, `${label}: stable Prompt profile`);
  assert.equal(getCachedKinshipGraph(gameData, { includeOtherParents: false }).relationBetween(1, 10).relation,
    null, `${label}: no otherParent Memory authorization`);
  assert.equal(graph.relationBetween(99, 10).relation?.type || null, directExpected ? "PARENT_OF" : null,
    `${label}: original direct family evidence follows the same current-snapshot gate`);
}

assertVisible(makeGameData(), true, "fresh public parent");
for (const [label, patch] of [
  ["unknown", { publicStatus: "UNKNOWN" }],
  ["missing public marker", { publicStatus: undefined }],
  ["other campaign", { campaignToken: "other-campaign" }],
  ["old snapshot", { sourceSnapshotId: "1066.1.1/122" }],
  ["missing snapshot", { sourceSnapshotId: null }],
  ["wrong source owner", { sourceOwnerId: 77 }],
  ["wrong child", { childId: 88 }],
  ["wrong source", { source: "UNVERIFIED" }],
  ["missing source", { source: undefined }],
  ["secret knowledge conflict", { knowledgeStatus: "SECRET" }],
  ["wrong relation", { sourceRelation: "siblings.otherParent" }]
]) assertVisible(makeGameData(patch), false, label);

const cached = makeGameData();
const original = getCachedKinshipGraph(cached);
assert.strictEqual(getCachedKinshipGraph(cached), original, "unchanged scope reuses cache");
cached.characters.get(99).children[0].otherParent.publicStatus = "UNKNOWN";
assertVisible(cached, false, "public status revoked on the same GameData");
cached.characters.get(99).children[0].otherParent.publicStatus = "PUBLIC_LEGAL_PARENT";
assertVisible(cached, true, "fresh public evidence restored");
cached.totalDays = 124;
cached.characters.get(99).children[0].directParentEvidence.sourceSnapshotId = "1066.1.1/124";
assertVisible(cached, false, "snapshot advanced on the same GameData");
cached.characters.get(99).children[0].otherParent.sourceSnapshotId = "1066.1.1/124";
assertVisible(cached, true, "new snapshot evidence restored");
cached.date = "1066.1.2";
cached.characters.get(99).children[0].directParentEvidence.sourceSnapshotId = "1066.1.2/124";
assertVisible(cached, false, "date advanced without fresh evidence");

const normalized = makeGameData();
normalized.characters = normalized.getMentionableCharacterProfiles();
delete normalized.getMentionableCharacterProfiles;
assertVisible(normalized, true, "already normalized profile map");
normalized.characters.get(10).evidence.otherParentRelations[0].publicStatus = "UNKNOWN";
normalized.characters.get(99).children[0].otherParent.publicStatus = "UNKNOWN";
assertVisible(normalized, false, "normalized evidence mutation invalidates cache");

for (const patch of [{ campaignToken: "" }, { date: "" }, { totalDays: null }, { totalDays: "" }]) {
  assertVisible(Object.assign(makeGameData(), patch), false, "missing current source scope", false);
}

for (const normalizedProfiles of [false, true]) {
  for (const parentPatch of [
    { publicStatus: "UNKNOWN" },
    { publicStatus: "UNKNOWN", source: "CK3_DIRECT_PARENT" },
    { publicStatus: "PUBLIC_LEGAL_PARENT" },
    { publicStatus: "PUBLIC_LEGAL_PARENT", source: "UNVERIFIED" },
    { publicStatus: "PUBLIC_LEGAL_PARENT", source: "CK3_DIRECT_PARENT", knowledgeStatus: "SECRET" },
    { publicStatus: "PUBLIC_LEGAL_PARENT", source: "CK3_DIRECT_PARENT", campaignToken: "stale" }
  ]) {
    const data = makeGameData();
    data.characters.get(99).children = [];
    data.characters.get(10).parents = [{ id: 1, name: "秘密父母哨兵", gender: "male", ...parentPatch }];
    if (normalizedProfiles) {
      data.characters = data.getMentionableCharacterProfiles();
      delete data.getMentionableCharacterProfiles;
      const parentEvidence = data.characters.get(1).evidence.relations[0].directParentEvidence;
      assert(!Object.hasOwn(parentEvidence, "name") && !Object.hasOwn(parentEvidence, "spouses"),
        "normalized direct-parent evidence contains only provenance metadata");
      const view = createTraitProfileView(data, data.characters.get(10)).gameData;
      assert.deepEqual(view.characters.get(1).evidence.relations, [], "unknown direct-parent evidence is hidden from custom template aliases");
    }
    const graph = getCachedKinshipGraph(data);
    assert.equal(graph.relationBetween(1, 10).relation, null, "unknown or unbound direct parent cannot enter presentation graph");
    assert.doesNotMatch(buildLegacyFamilyLine(data.characters.get(10), data).text || "", /秘密父母哨兵/u);
    assert.equal(buildFamilyEntityFactBundle({ graph, responderId: 10, relationAnchorId: 10, targetRuntimeId: 1 }), null);
  }
}

const siblingData = makeGameData();
siblingData.characters.get(10).siblings = [{ id: 20, name: "兄弟", gender: "male" }];
siblingData.characters.set(20, { id: 20, shortName: "兄弟", gender: "male",
  parents: [{ id: 30, name: "秘密母亲哨兵", gender: "female", publicStatus: "UNKNOWN" }] });
assert.doesNotMatch(buildFamilyFactBlock(siblingData.characters.get(10), siblingData,
  { query: "你兄弟的母亲是谁？" }), /秘密母亲哨兵/u);

for (const normalizedProfiles of [false, true]) {
  for (const [patch, dataPatch, expected] of [
    [{}, {}, true],
    [{ source: undefined }, {}, false],
    [{ knowledgeStatus: "SECRET" }, {}, false],
    [{ sourceOwnerId: 77 }, {}, false],
    [{ childId: 88 }, {}, false],
    [{ sourceRelation: "children" }, {}, false],
    [{ campaignToken: "old" }, {}, false],
    [{ sourceSnapshotId: "1066.1.1/122" }, {}, false],
    [{ sourceSnapshotId: "1066.1.1/-1" }, { totalDays: -1 }, false]
  ]) {
    const data = Object.assign(makeGameData(), dataPatch);
    data.characters.get(99).children = [];
    data.characters.get(10).parents = [{ id: 1, name: "当前公开父亲", gender: "male", source: "CK3_DIRECT_PARENT",
      sourceOwnerId: 10, childId: 10, relationType: "parent", sourceRelation: "parents",
      publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN,
      sourceSnapshotId: SNAPSHOT, ...patch }];
    if (normalizedProfiles) {
      data.characters = data.getMentionableCharacterProfiles();
      delete data.getMentionableCharacterProfiles;
    }
    assert.equal(!!getCachedKinshipGraph(data).relationBetween(1, 10).relation, expected, "typed direct parent source validation");
    assert.equal(!!getTargetedKinshipGraph(data, [1, 10]).relationBetween(1, 10).relation, expected, "targeted direct parent source validation");
    const view = createTraitProfileView(data, data.characters.get(10)).gameData;
    if (!normalizedProfiles) assert.equal(view.characters.get(10).parents.length > 0, expected, "raw direct-parent custom template alias uses the same source gate");
  }
  const legacy = makeGameData();
  legacy.characters.get(99).children = [];
  legacy.characters.get(10).parents = [{ id: 1, name: "旧日志明确父亲", gender: "male" }];
  if (normalizedProfiles) {
    legacy.characters = legacy.getMentionableCharacterProfiles();
    delete legacy.getMentionableCharacterProfiles;
  }
  assert.equal(getCachedKinshipGraph(legacy).relationBetween(1, 10).relation, null, "unbound legacy parent data cannot establish a current public fact");
}

const scope = makeGameData();
for (const level of ["spouse", "child", "parent"]) {
  for (const patch of [null, { source: undefined }, { source: "UNVERIFIED" }, { knowledgeStatus: "SECRET" }, { sourceSnapshotId: "old" }]) {
    const data = makeGameData();
    const parent = { id: 70, name: "继亲子女的另一双亲", source: "CK3_PARENT_SPOUSE_CHILD", sourceOwnerId: 10,
      childId: 60, relationType: "parent", sourceRelation: "parents.spouses.children.otherParent",
      publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT };
    const child = { id: 60, name: "继亲子女", source: "CK3_PARENT_SPOUSE_CHILD", sourceOwnerId: 10,
      sourceParentId: 1, sourceSpouseId: 50, relationType: "child", sourceRelation: "parents.spouses.children",
      publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT,
      parents: [parent] };
    const spouse = { id: 50, name: "当前继亲", source: "CK3_PARENT_SPOUSE", parentId: 1, sourceOwnerId: 10,
      relationType: "CURRENT_SPOUSE", sourceRelation: "parents.spouses", publicStatus: "PUBLIC_LEGAL_MARRIAGE",
      knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT, children: [child] };
    data.characters.get(10).parents = [{ id: 1, name: "旧格式明确父亲", source: "CK3_DIRECT_PARENT",
      sourceOwnerId: 10, childId: 10, relationType: "parent", sourceRelation: "parents",
      publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN,
      sourceSnapshotId: SNAPSHOT, spouses: [spouse] }];
    if (patch) Object.assign({ spouse, child, parent }[level], patch);
    const view = createTraitProfileView(data, data.characters.get(10), null, { includeStepFamily: true }).gameData;
    const visibleSpouses = view.characters.get(10).parents[0].spouses;
    const visibleChildren = visibleSpouses[0]?.children || [];
    const visibleParents = visibleChildren[0]?.parents || [];
    const visible = { spouse: visibleSpouses, child: visibleChildren, parent: visibleParents }[level];
    assert.equal(visible.length > 0, !patch, `${level}: typed source cannot masquerade as legacy in custom templates`);
  }
}

for (const age of [null, "", undefined, 60]) {
  assert.equal(createStableProfile({ id: 10, age }, scope).age, null, "raw ages without trusted provenance stay unknown");
}
assert.equal(createStableProfile({ id: 10, age: 30, ageSource: "CK3_CURRENT_AGE" }, scope).age, 30);
const deadProfile = createStableProfile({ id: 10, age: 60, ageSource: "CK3_CURRENT_AGE", alive: false }, scope);
assert.equal(deadProfile.age, null, "a dead character's stale current age is not an age-at-death fact");
assert.doesNotMatch(formatStableProfile(deadProfile), /年龄：60/u);

console.log("V9.3.7 public kinship cache: PASS (stable/targeted graphs, source revocation and Memory isolation)");
