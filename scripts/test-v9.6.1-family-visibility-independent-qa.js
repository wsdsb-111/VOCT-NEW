"use strict";

const assert = require("node:assert/strict");
const { getFamilyVisibility } = require("../src/app/main/worldline/family-visibility");
const { createTraitProfileView, isPublicCloseFamily } = require("../src/app/main/prompts/trait-profile-selector");

const campaignToken = "votc-v961-family-visibility-qa";
const date = "1180.3.12";
const totalDays = 431002;
const sourceSnapshotId = `${date}/${totalDays}`;

function person(id, name, overrides = {}) {
  return {
    id,
    name,
    firstName: name,
    shortName: name,
    fullName: `${name} 全名`,
    age: 20 + id % 30,
    ageSource: "CK3_CURRENT_AGE",
    birthDateTotalDays: 400000 - id,
    alive: true,
    primaryTitle: `title_${id}`,
    titleRankConcept: `rank_${id}`,
    heldCourtAndCouncilPositions: `office_${id}`,
    gender: id % 2 ? "female" : "male",
    traits: [{ traitId: "brave", name: "勇敢" }],
    secrets: [{ type: "secret_witch", marker: `secret-${id}` }],
    knownSecrets: [{ type: "secret_adulterer", marker: `known-secret-${id}` }],
    memories: [{ desc: `private-memory-${id}` }],
    conversationSummaries: [{ content: `private-history-${id}` }],
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    formerSpouses: [],
    ...overrides
  };
}

function parentProof(child, parent, overrides = {}) {
  return {
    id: parent.id,
    childId: child.id,
    parentId: parent.id,
    source: "CK3_DIRECT_PARENT",
    sourceOwnerId: child.id,
    relationType: "parent",
    sourceRelation: "parents",
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken,
    sourceSnapshotId,
    evidenceConflict: false,
    ...overrides
  };
}

function addParent(parent, child, overrides = {}) {
  const proof = parentProof(child, parent, overrides);
  child.parents.push({ ...proof, name: parent.fullName, gender: parent.gender });
  parent.children.push({ id: child.id, name: child.fullName, directParentEvidence: { ...proof } });
}

function addSibling(left, right, overrides = {}) {
  const row = (owner, target) => ({
    id: target.id,
    name: target.fullName,
    gender: target.gender,
    age: target.age,
    ageSource: "CK3_LIVE_RELATIVE_AGE",
    birthDateTotalDays: target.birthDateTotalDays,
    evidence: {
      age: [{
        value: target.age,
        ageSource: "CK3_LIVE_RELATIVE_AGE",
        sourceOwnerId: owner.id,
        relationType: "sibling",
        source: `${owner.id}.siblings`,
        campaignToken,
        sourceSnapshotId,
        ...overrides
      }]
    }
  });
  left.siblings.push(row(left, right));
  right.siblings.push(row(right, left));
}

function addCurrentSpouse(owner, spouse, overrides = {}) {
  owner.spouses.push({
    id: spouse.id,
    name: spouse.fullName,
    relationType: "CURRENT_SPOUSE",
    source: "CK3_GAME_CURRENT_SPOUSE",
    sourceOwnerId: owner.id,
    relatedCharacterId: owner.id,
    observerRuntimeId: owner.id,
    sourceRelation: "spouses",
    evidenceScope: "SOURCE_OWNER_RECORD_ONLY",
    publicStatus: "PUBLIC_LEGAL_MARRIAGE",
    knowledgeStatus: "UNKNOWN",
    campaignToken,
    sourceSnapshotId,
    evidenceConflict: false,
    targetBound: true,
    ...overrides
  });
}

function buildFamily() {
  const rows = new Map();
  const make = (id, name, overrides) => {
    const value = person(id, name, overrides);
    rows.set(id, value);
    return value;
  };
  const ego = make(1, "主角");
  const father = make(2, "父亲");
  const mother = make(3, "母亲");
  const paternalGrandfather = make(4, "祖父");
  const paternalGrandmother = make(5, "祖母");
  const maternalGrandfather = make(6, "外祖父");
  const maternalGrandmother = make(7, "外祖母");
  const greatGrandfather = make(8, "曾祖父");
  const paternalAunt = make(9, "姑母");
  const auntSpouse = make(10, "姑父");
  const auntChild = make(11, "堂亲");
  const sibling = make(12, "兄弟");
  const siblingSpouse = make(13, "兄弟配偶");
  const niece = make(14, "侄女");
  const nieceSpouse = make(15, "侄女配偶");
  const siblingGrandchild = make(16, "侄孙");
  const siblingGrandchildSpouse = make(17, "侄孙配偶");
  const egoSpouse = make(18, "主角配偶");
  const child = make(19, "子女");
  const childSpouse = make(20, "子女配偶");
  const grandchild = make(21, "孙辈");
  const grandchildSpouse = make(22, "孙辈配偶");
  const greatGrandchild = make(23, "曾孙辈");
  const grandparentSibling = make(24, "祖父母的兄弟姐妹");
  const grandparentSiblingSpouse = make(25, "祖父母兄弟姐妹的配偶");
  const fatherSecondSpouse = make(26, "父亲再婚配偶");
  const motherSecondSpouse = make(27, "母亲再婚配偶");
  const spouseSibling = make(28, "主角配偶的兄弟姐妹");
  const spouseSiblingSpouse = make(29, "配偶兄弟姐妹的配偶");
  const auntSpouseSibling = make(30, "姑父的兄弟姐妹");
  const twinAliasStranger = make(31, "同名陌生人", { firstName: "共享别名", shortName: "共享别名", fullName: "共享别名 全名" });
  const invalidParent = make(32, "来源错误亲属");
  const staleSpouse = make(33, "过期配偶");
  const formerSpouse = make(34, "前配偶");

  const family = [
    ego, father, mother, paternalGrandfather, paternalGrandmother, maternalGrandfather, maternalGrandmother,
    greatGrandfather, paternalAunt, auntSpouse, auntChild, sibling, siblingSpouse, niece, nieceSpouse,
    siblingGrandchild, siblingGrandchildSpouse, egoSpouse, child, childSpouse, grandchild, grandchildSpouse,
    greatGrandchild, grandparentSibling, grandparentSiblingSpouse, fatherSecondSpouse, motherSecondSpouse,
    spouseSibling, spouseSiblingSpouse, auntSpouseSibling, twinAliasStranger, invalidParent, staleSpouse, formerSpouse
  ];
  const spouseChainSibling = make(35, "配偶之配偶兄弟姐妹");
  const betrothedTarget = make(36, "订婚对象");
  const auntChildSpouse = make(37, "堂亲配偶");
  family.push(spouseChainSibling);
  family.push(betrothedTarget);
  family.push(auntChildSpouse);

  addParent(paternalGrandfather, father);
  addParent(paternalGrandmother, father);
  addParent(maternalGrandfather, mother);
  addParent(maternalGrandmother, mother);
  addParent(father, ego);
  addParent(mother, ego);
  addParent(father, sibling);
  addParent(mother, sibling);
  addParent(sibling, niece);
  addParent(niece, siblingGrandchild);
  addParent(ego, child);
  addParent(child, grandchild);
  addParent(grandchild, greatGrandchild);
  addParent(paternalAunt, auntChild);
  addParent(greatGrandfather, paternalGrandfather);
  addParent(paternalAunt, invalidParent, { sourceOwnerId: ego.id });
  ego.formerSpouses.push({
    id: formerSpouse.id,
    name: formerSpouse.fullName,
    relationType: "FORMER_SPOUSE",
    source: "CK3_FORMER_SPOUSE",
    sourceOwnerId: ego.id,
    sourceRelation: "formerSpouses",
    publicStatus: "FORMER_SPOUSE",
    knowledgeStatus: "UNKNOWN",
    historicalStatus: "FORMER",
    campaignToken,
    sourceSnapshotId,
    evidenceConflict: false,
    targetBound: true
  });
  child.betrothed = {
    id: betrothedTarget.id,
    name: betrothedTarget.fullName,
    relationType: "BETROTHED",
    source: "CK3_CURRENT_BETROTHAL",
    sourceOwnerId: ego.id,
    relatedCharacterId: child.id,
    observerRuntimeId: ego.id,
    sourceRelation: "kids.betrothed",
    evidenceScope: "SOURCE_OWNER_RECORD_ONLY",
    publicStatus: "CURRENT_BETROTHAL",
    knowledgeStatus: "UNKNOWN",
    campaignToken,
    sourceSnapshotId,
    evidenceConflict: false,
    targetBound: true
  };

  addSibling(father, paternalAunt);
  addSibling(paternalGrandfather, grandparentSibling);
  addSibling(ego, sibling);

  addCurrentSpouse(paternalAunt, auntSpouse);
  addCurrentSpouse(ego, egoSpouse);
  addCurrentSpouse(sibling, siblingSpouse);
  addCurrentSpouse(niece, nieceSpouse);
  addCurrentSpouse(siblingGrandchild, siblingGrandchildSpouse);
  addCurrentSpouse(child, childSpouse);
  addCurrentSpouse(grandchild, grandchildSpouse);
  addCurrentSpouse(paternalGrandfather, paternalGrandmother);
  addCurrentSpouse(maternalGrandfather, maternalGrandmother);
  addCurrentSpouse(grandparentSibling, grandparentSiblingSpouse);
  addCurrentSpouse(father, fatherSecondSpouse);
  addCurrentSpouse(mother, motherSecondSpouse);
  addSibling(egoSpouse, spouseSibling);
  addCurrentSpouse(auntChild, auntChildSpouse);
  addCurrentSpouse(spouseSibling, spouseSiblingSpouse);
  addSibling(auntSpouse, auntSpouseSibling);
  addCurrentSpouse(auntSpouseSibling, spouseChainSibling);
  addCurrentSpouse(auntSpouse, staleSpouse, { sourceSnapshotId: "stale-snapshot" });

  // A duplicate alias must never make an unrelated person's identity a family fact.
  twinAliasStranger.firstName = sibling.firstName;
  twinAliasStranger.shortName = sibling.shortName;
  twinAliasStranger.fullName = sibling.fullName;

  return {
    gameData: { campaignToken, date, totalDays, characters: rows },
    ego,
    people: Object.fromEntries(family.map(item => [item.id, item])),
    includedIds: [
      ego.id, father.id, mother.id, paternalGrandfather.id, paternalGrandmother.id, maternalGrandfather.id,
      maternalGrandmother.id, paternalAunt.id, auntSpouse.id, sibling.id, siblingSpouse.id, niece.id,
      nieceSpouse.id, siblingGrandchild.id, siblingGrandchildSpouse.id, egoSpouse.id, child.id, childSpouse.id,
      grandchild.id, grandchildSpouse.id, grandparentSibling.id, grandparentSiblingSpouse.id,
      fatherSecondSpouse.id, motherSecondSpouse.id, auntChild.id, auntChildSpouse.id, spouseSibling.id
    ],
    excludedIds: [
      greatGrandfather.id, greatGrandchild.id, spouseSiblingSpouse.id,
      auntSpouseSibling.id, spouseChainSibling.id, twinAliasStranger.id, invalidParent.id, staleSpouse.id,
      formerSpouse.id, betrothedTarget.id
    ]
  };
}

function manualHidden(ownerId, target, factType, factKey, value) {
  return {
    campaignToken,
    ownerId,
    entityId: target.id,
    factType,
    factKey,
    value,
    status: "MANUAL_HIDDEN",
    current: true,
    effectiveKnown: false,
    firstAcquiredDate: date
  };
}

const { gameData, ego, people, includedIds, excludedIds } = buildFamily();
const frozenGameData = structuredClone(gameData);
const visibility = getFamilyVisibility(gameData, ego.id);
const visibleIds = new Set([...visibility.ids].map(String));

for (const id of includedIds) {
  assert.equal(visibleIds.has(String(id)), true, `current proven family member ${id} is within the five-layer scope`);
  assert.equal(isPublicCloseFamily(ego.id, id, gameData), true, `family visibility delegates authorization for ${id}`);
}
for (const id of excludedIds) {
  assert.equal(visibleIds.has(String(id)), false, `out-of-window, stale, or unproven person ${id} is excluded`);
  assert.equal(isPublicCloseFamily(ego.id, id, gameData), false, `unproven person ${id} receives no family identity access`);
}
assert.equal(visibility.scopeTruncated, false);
const truncatedVisibility = getFamilyVisibility(gameData, ego.id, { maxNodes: 2 });
assert.equal(truncatedVisibility.scopeTruncated, true, "a bounded relation scope reports truncation");
assert.deepEqual([...truncatedVisibility.ids], [String(ego.id)], "a truncated scope authorizes no relative identity");

const profileView = createTraitProfileView(gameData, ego);
const projected = profileView.gameData;
for (const id of includedIds.filter(id => id !== ego.id)) {
  const raw = people[id];
  const view = projected.characters.get(id);
  assert.equal(view.name, raw.name, `family ${id} keeps its name`);
  assert.equal(view.firstName, raw.firstName, `family ${id} keeps its first name`);
  assert.equal(view.shortName, raw.shortName, `family ${id} keeps its short name`);
  assert.equal(view.fullName, raw.fullName, `family ${id} keeps its full name`);
  assert.equal(view.age, raw.age, `family ${id} keeps current age`);
  assert.equal(view.primaryTitle, raw.primaryTitle, `family ${id} keeps title`);
  assert.equal(view.titleRankConcept, raw.titleRankConcept, `family ${id} keeps title rank`);
  assert.equal(view.heldCourtAndCouncilPositions, raw.heldCourtAndCouncilPositions, `family ${id} keeps offices`);
  assert.deepEqual(view.traits, raw.traits, `family ${id} keeps current traits`);
  for (const field of ["secrets", "knownSecrets", "memories", "conversationSummaries"]) {
    assert.deepEqual(view[field], [], `family access does not expose ${field}`);
  }
}

for (const [field, id] of [["parents", 2], ["parents", 3], ["children", 19], ["siblings", 12], ["spouses", 18]]) {
  const row = profileView.character[field].find(item => Number(item.id) === id);
  assert(row, `the responder keeps its proven ${field} relation to ${id}`);
  assert.equal(row.name, people[id].fullName, `the responder's ${field} relation keeps the relative's name`);
}

for (const id of excludedIds) {
  const raw = people[id];
  const view = projected.characters.get(id);
  assert.notEqual(view.name, raw.name, `excluded person ${id} has no automatic name disclosure`);
  assert.equal(view.age, null, `excluded person ${id} has no automatic age disclosure`);
  assert.equal(view.primaryTitle, "", `excluded person ${id} has no automatic title disclosure`);
  assert.deepEqual(view.traits, [], `excluded person ${id} has no automatic trait disclosure`);
}

const outsider = projected.characters.get(people[31].id);
assert.notEqual(outsider.name, people[31].name, "a duplicate alias does not authorize a stranger identity");
assert.notEqual(outsider.fullName, people[31].fullName, "a duplicate full-name alias remains masked for a stranger");
assert.equal(outsider.age, null);
assert.equal(outsider.primaryTitle, "");
assert.deepEqual(outsider.traits, []);
for (const field of ["secrets", "knownSecrets", "memories", "conversationSummaries"]) assert.deepEqual(outsider[field], []);

const manuallyHiddenTarget = people[12];
const hiddenFacts = [
  manualHidden(ego.id, manuallyHiddenTarget, "NAME", "name", manuallyHiddenTarget.name),
  manualHidden(ego.id, manuallyHiddenTarget, "AGE", "age", String(manuallyHiddenTarget.age)),
  manualHidden(ego.id, manuallyHiddenTarget, "TITLE", "title", manuallyHiddenTarget.primaryTitle),
  manualHidden(ego.id, manuallyHiddenTarget, "TRAIT", "trait_brave", "勇敢")
];
const manuallyHiddenView = createTraitProfileView(gameData, ego, {
  disclosureProfiles: new Map([[manuallyHiddenTarget.id, hiddenFacts]])
}).gameData.characters.get(manuallyHiddenTarget.id);
assert.notEqual(manuallyHiddenView.name, manuallyHiddenTarget.name, "manual-hidden name overrides family visibility");
assert.equal(manuallyHiddenView.age, null, "manual-hidden age overrides family visibility");
assert.equal(manuallyHiddenView.primaryTitle, "", "manual-hidden title overrides family visibility");
assert.deepEqual(manuallyHiddenView.traits, [], "manual-hidden trait overrides family visibility");

assert.deepEqual(gameData, frozenGameData, "visibility and profile projection leave source GameData immutable");
console.log("V9.6.1 family visibility independent QA: PASS");
