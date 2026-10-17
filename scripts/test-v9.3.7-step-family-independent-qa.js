"use strict";

const assert = require("node:assert/strict");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector.js");
const { getCachedKinshipGraph } = require("../src/app/main/worldline/kinship-graph-cache.js");
const { resolveLifeStatus } = require("../src/app/main/worldline/character-temporal-facts.js");
const {
  makeFamilyFixtureLines,
  loadRuntime,
  parseFixture,
  makeMemoryContext,
  render,
  line,
  characterLine,
  FIXTURE_DATE,
  FIXTURE_TOTAL_DAYS,
  FIXTURE_CAMPAIGN
} = require("./test-v9.3.7-family-performance");

const ROOT = require("node:path").resolve(__dirname, "..");
const RESPONDER_ID = 10;
const PLAYER_ID = 1;
const STEP_FATHER_ID = 50;
const STEP_MOTHER_ID = 51;
const STEP_BROTHER_ID = 60;
const MATERNAL_HALF_SIBLING_ID = 70;
const SECRET = "V937_STEP_FAMILY_SECRET_SENTINEL";
const HISTORICAL_MEMORY = "获准的Legacy记录（来源：旧关系记忆；时间：1184年至1190年）：崔兰曾是王承礼的继母；这段记录只说明当时的关系。";
const OTHER_CAMPAIGN = "votc8c-202610170002";

function pronoun(gender) {
  return gender === "female" ? "she" : "he";
}

function makeStepFamilyLines({
  siblingCount = 0,
  marriages = [],
  spouseChildren = [],
  maternalHalfSibling = false,
  addSecret = false
} = {}) {
  const lines = makeFamilyFixtureLines({ siblingCount });
  const extraCharacters = [
    { id: STEP_FATHER_ID, name: "沈承安", gender: "male", age: 42 },
    { id: STEP_MOTHER_ID, name: "崔兰", gender: "female", age: 39 },
    { id: 52, name: "韩仲文", gender: "male", age: 41 },
    { id: STEP_BROTHER_ID, name: "沈子明", gender: "male", age: 16 },
    { id: 61, name: "陆氏", gender: "female", age: 35 },
    { id: 62, name: "王元直", gender: "male", age: 40 },
    { id: 63, name: "崔玉珠", gender: "female", age: 17 },
    { id: 64, name: "崔玉安", gender: "male", age: 16 },
    { id: 65, name: "吕父", gender: "male", age: 42 },
    { id: 66, name: "程母", gender: "female", age: 39 },
    { id: MATERNAL_HALF_SIBLING_ID, name: "李明", gender: "male", age: 15 },
    { id: 71, name: "刘父", gender: "male", age: 38 }
  ];
  for (const character of extraCharacters) lines.push(characterLine(character));

  // This fixture uses the production parents row shape, with the appended
  // public-parent marker used by the current V9.3.7 source.
  lines.push(line("parents", RESPONDER_ID, [PLAYER_ID, "宋氏父", 0, "1142年5月2日", 48, "he", "PUBLIC_LEGAL_PARENT"]));
  lines.push(line("parents", RESPONDER_ID, [2, "王氏妻", 0, "1146年5月2日", 44, "she", "PUBLIC_LEGAL_PARENT"]));

  for (const marriage of marriages) {
    lines.push(line("parent_spouse", RESPONDER_ID, [
      marriage.parentId,
      marriage.spouseId,
      marriage.name,
      pronoun(marriage.gender),
      marriage.status || "PUBLIC_LEGAL_MARRIAGE"
    ]));
  }
  for (const child of spouseChildren) {
    lines.push(line("parent_spouse_child", RESPONDER_ID, [
      child.parentId,
      child.spouseId,
      child.childId,
      child.name,
      pronoun(child.gender),
      child.otherParentId,
      child.otherParentName,
      pronoun(child.otherParentGender),
      child.status || "PUBLIC_LEGAL_PARENT"
    ]));
    lines.push(line("parents", child.childId, [
      child.spouseId,
      child.spouseName,
      0,
      "1170年5月2日",
      42,
      pronoun(marriages.find(marriage => Number(marriage.spouseId) === Number(child.spouseId))?.gender),
      "PUBLIC_LEGAL_PARENT"
    ]));
    lines.push(line("parents", child.childId, [
      child.otherParentId,
      child.otherParentName,
      0,
      "1172年5月2日",
      40,
      pronoun(child.otherParentGender),
      "PUBLIC_LEGAL_PARENT"
    ]));
  }

  if (maternalHalfSibling) {
    lines.push(line("kids", 2, [MATERNAL_HALF_SIBLING_ID, "李明", "he", 30, "1175年5月2日", 15]));
    lines.push(line("kid_other_parent", 2, [MATERNAL_HALF_SIBLING_ID, 71, "刘父", "PUBLIC_LEGAL_PARENT", "he"]));
    lines.push(line("kid_eob", 2, [MATERNAL_HALF_SIBLING_ID, ""]));
    lines.push(line("siblings", RESPONDER_ID, [MATERNAL_HALF_SIBLING_ID, "李明", "he", 30, "1175年5月2日", 15]));
    lines.push(line("sibling_other_parent", RESPONDER_ID, [MATERNAL_HALF_SIBLING_ID, 71, "刘父", "PUBLIC_LEGAL_PARENT", "he"]));
    lines.push(line("sibling_eob", RESPONDER_ID, [MATERNAL_HALF_SIBLING_ID, ""]));
  }

  if (addSecret) {
    lines.push(line("secret", RESPONDER_ID, [SECRET, "未获准公开的亲属身份", "secret", "unknown"]));
    lines.push(line("secret_eob", RESPONDER_ID));
  }
  return lines;
}

function collectObjects(value, predicate, found = [], seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return found;
  seen.add(value);
  if (predicate(value)) found.push(value);
  if (value instanceof Map) {
    for (const entry of value.values()) collectObjects(entry, predicate, found, seen);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectObjects(entry, predicate, found, seen);
  } else {
    for (const entry of Object.values(value)) collectObjects(entry, predicate, found, seen);
  }
  return found;
}

function parentSpouseEvidence(gameData) {
  return collectObjects(gameData, value =>
    value.source === "CK3_PARENT_SPOUSE"
    || value.source === "CK3_PARENT_SPOUSE_CHILD"
    || (typeof value.sourceRelation === "string" && value.sourceRelation.startsWith("parents.spouses")));
}

function addUndatedHistoricalSpouses(gameData) {
  // Legacy post-parse shape only: current CK3 logs do not emit former/deceased
  // spouse rows for a character's parents. A death date alone is not a marriage
  // interval and must not be promoted into a step-parent fact.
  const father = gameData.characters.get(RESPONDER_ID).parents.find(parent => Number(parent.id) === PLAYER_ID);
  assert.ok(father, "parsed responder must have a source-bound father record");
  father.formerSpouses = [{ id: 80, name: "杜氏前妻", relationType: "FORMER_SPOUSE" }];
  father.deceasedSpouses = [{
    id: 81,
    name: "赵氏亡妻",
    relationType: "DECEASED_SPOUSE",
    deathDate: "1188年5月2日"
  }];
}

function addTypedHistoricalStep(gameData, {
  name = "王氏旧继母",
  source = "LEGACY_TYPED_STEP_RELATION",
  campaignToken = gameData.campaignToken,
  sourceSnapshotId = gameData.date + "/" + gameData.totalDays
} = {}) {
  // This is a legacy post-parse GameData compatibility fixture. The current CK3
  // parser has no producer for typed historical STEP rows.
  const character = gameData.characters.get(RESPONDER_ID);
  const record = {
    id: 82,
    name,
    gender: "female",
    genderSource: "CK3_LIVE_RELATIVE",
    relationshipKind: "STEP",
    source,
    sourceOwnerId: RESPONDER_ID,
    childId: RESPONDER_ID,
    relationType: "parent",
    sourceRelation: "parents",
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken,
    sourceSnapshotId
  };
  character.parents.push(record);
  return record;
}

function makeHistoricalMemoryContext() {
  const context = makeMemoryContext();
  context.directStableText = HISTORICAL_MEMORY;
  return context;
}

function projectTraitProfile(gameData, includeStepFamily) {
  const responder = gameData.characters.get(RESPONDER_ID);
  const profile = createTraitProfileView(gameData, responder, makeMemoryContext(), { includeStepFamily });
  const charactersMapValues = [...profile.gameData.characters.values()];
  return {
    profile,
    responder: profile.gameData.characters.get(RESPONDER_ID),
    serialized: JSON.stringify({ charactersMapValues, character: profile.character })
  };
}

function getProjectionFixtureEvidence(gameData) {
  const responder = gameData.characters.get(RESPONDER_ID);
  const mother = responder.parents.find(parent => Number(parent.id) === 2);
  const spouse = mother?.spouses.find(item => Number(item.id) === STEP_FATHER_ID);
  const child = spouse?.children.find(item => Number(item.id) === STEP_BROTHER_ID);
  assert.ok(mother && spouse && child, "projection fixture must contain parsed parent, current spouse, and spouse child rows");
  return { responder, mother, spouse, child };
}

function makeProjectionFixtureLines() {
  return makeStepFamilyLines({
    marriages: [{ parentId: 2, spouseId: STEP_FATHER_ID, name: "沈承安", gender: "male" }],
    spouseChildren: [{
      parentId: 2,
      spouseId: STEP_FATHER_ID,
      spouseName: "沈承安",
      childId: STEP_BROTHER_ID,
      name: "沈子明",
      gender: "male",
      otherParentId: 61,
      otherParentName: "陆氏",
      otherParentGender: "female"
    }]
  });
}

function getCachedBirthGraphQuietly(gameData) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return getCachedKinshipGraph(gameData);
  } finally {
    console.log = originalLog;
  }
}

async function main() {
  const runtime = loadRuntime(ROOT);
  const memoryContext = makeMemoryContext();
  const memoryBefore = JSON.stringify(memoryContext);

  const currentStepfatherData = await parseFixture(runtime, makeStepFamilyLines({
    marriages: [{ parentId: 2, spouseId: STEP_FATHER_ID, name: "沈承安", gender: "male" }]
  }));
  const stepfather = render(runtime, currentStepfatherData, "你继父是谁？", memoryContext);
  assert.match(stepfather.familyText, /继父/u, "a current public marriage to the responder's mother should identify a stepfather");
  assert.match(stepfather.familyText, /沈承安/u, "the current stepfather answer must use the parsed spouse identity");

  const currentStepmotherData = await parseFixture(runtime, makeStepFamilyLines({
    marriages: [{ parentId: 1, spouseId: STEP_MOTHER_ID, name: "崔兰", gender: "female" }]
  }));
  const stepmother = render(runtime, currentStepmotherData, "你继母是谁？", memoryContext);
  assert.match(stepmother.familyText, /继母/u, "a current public marriage to the responder's father should identify a stepmother");
  assert.match(stepmother.familyText, /崔兰/u, "the current stepmother answer must use the parsed spouse identity");

  const currentStepSiblingData = await parseFixture(runtime, makeStepFamilyLines({
    marriages: [{ parentId: 2, spouseId: STEP_FATHER_ID, name: "沈承安", gender: "male" }],
    spouseChildren: [{
      parentId: 2,
      spouseId: STEP_FATHER_ID,
      spouseName: "沈承安",
      childId: STEP_BROTHER_ID,
      name: "沈子明",
      gender: "male",
      otherParentId: 61,
      otherParentName: "陆氏",
      otherParentGender: "female"
    }]
  }));
  const stepBrother = render(runtime, currentStepSiblingData, "你继兄弟是谁？", memoryContext);
  assert.match(stepBrother.familyText, /沈子明/u,
    "a step-sibling candidate with two public parents and no overlap should be identified");
  assert.match(stepBrother.familyText, /是继父沈承安的儿子/u,
    "a stepbrother answer must identify the responder's stepfather as the candidate's step-parent");
  assert.ok(!stepBrother.familyText.includes("继母"),
    "a child of the mother's current husband must not be described as brought by the stepmother");
  assert.ok(!stepBrother.familyText.includes("赵子明"),
    "a half-sibling must not be returned as a step-sibling");

  const currentStepmotherChildrenData = await parseFixture(runtime, makeStepFamilyLines({
    marriages: [{ parentId: PLAYER_ID, spouseId: STEP_MOTHER_ID, name: "崔兰", gender: "female" }],
    spouseChildren: [{
      parentId: PLAYER_ID,
      spouseId: STEP_MOTHER_ID,
      spouseName: "崔兰",
      childId: 63,
      name: "崔玉珠",
      gender: "female",
      otherParentId: 66,
      otherParentName: "程母",
      otherParentGender: "female"
    }, {
      parentId: PLAYER_ID,
      spouseId: STEP_MOTHER_ID,
      spouseName: "崔兰",
      childId: 64,
      name: "崔玉安",
      gender: "male",
      otherParentId: 65,
      otherParentName: "吕父",
      otherParentGender: "male"
    }]
  }));
  const stepSisterFromStepmother = render(runtime, currentStepmotherChildrenData, "你继姐妹是谁？", memoryContext);
  assert.match(stepSisterFromStepmother.familyText, /崔玉珠/u,
    "a daughter of the responder's current stepmother should be identified as the step-sister");
  assert.match(stepSisterFromStepmother.familyText, /是继母崔兰的女儿/u,
    "a step-sister answer must identify the responder's stepmother as her parent");
  assert.ok(!stepSisterFromStepmother.familyText.includes("继父"),
    "a daughter of the father's current wife must not be described through a stepfather path");
  const stepBrotherFromStepmother = render(runtime, currentStepmotherChildrenData, "你继兄弟是谁？", memoryContext);
  assert.match(stepBrotherFromStepmother.familyText, /崔玉安/u,
    "a son of the responder's current stepmother should be identified as the step-brother");
  assert.match(stepBrotherFromStepmother.familyText, /是继母崔兰的儿子/u,
    "a step-brother from the stepmother's family must retain the correct step-parent path");
  assert.ok(!stepBrotherFromStepmother.familyText.includes("继父"),
    "a son of the father's current wife must not be described through a stepfather path");
  const parsedResponder = currentStepSiblingData.characters.get(RESPONDER_ID);
  const parsedParents = parsedResponder.parents.filter(parent =>
    parent.source === "CK3_DIRECT_PARENT" && parent.publicStatus === "PUBLIC_LEGAL_PARENT");
  assert.equal(parsedParents.length, 2, "the responder fixture must contain exactly two source-bound public parents");
  const parsedMother = parsedParents.find(parent => Number(parent.id) === 2);
  const parsedMarriage = parsedMother?.spouses.find(spouse => Number(spouse.id) === STEP_FATHER_ID);
  const parsedStepChild = parsedMarriage?.children.find(child => Number(child.id) === STEP_BROTHER_ID);
  assert.equal(parsedStepChild?.parents.length, 2, "the step-sibling fixture must include both of the candidate's public parents");
  assert.ok(parsedStepChild.parents.every(parent =>
    parent.source === "CK3_PARENT_SPOUSE_CHILD" && parent.publicStatus === "PUBLIC_LEGAL_PARENT"
      && parent.knowledgeStatus === "UNKNOWN"),
  "both step-sibling parent records must remain source-bound, public, and separate from character knowledge");
  assert.equal(parsedStepChild.parents.some(parent =>
    parsedParents.some(knownParent => Number(knownParent.id) === Number(parent.id))), false,
  "the step-sibling fixture must have no biological parent overlap with the responder");
  const stepDiagnostics = JSON.stringify(stepBrother.result.familyDiagnostics || []);
  assert.ok(!stepDiagnostics.includes("沈子明") && !stepDiagnostics.includes("沈承安"),
    "family diagnostics must remain anonymous and omit relation names");
  const stepDiagnostic = stepBrother.result.familyDiagnostics?.find(item => item.targetedParentQuery === true);
  assert.ok(stepDiagnostic, "the final Prompt result must expose targeted family diagnostics");
  for (const field of ["nodeVisits", "edgeVisits", "buildMs", "tokenCount"]) {
    assert.equal(typeof stepDiagnostic[field], "number", `family diagnostics must report numeric ${field}`);
    assert.ok(Number.isFinite(stepDiagnostic[field]) && stepDiagnostic[field] >= 0,
      `family diagnostics ${field} must be finite and nonnegative`);
  }
  assert.ok(stepDiagnostic.tokenCount > 0, "diagnostics must report the emitted family block token count");
  assert.ok(!Object.keys(stepDiagnostic).some(key => /(?:name|runtime.?id|character.?id)/iu.test(key)),
    "family diagnostics must not expose names or character identifiers");
  assert.equal(stepDiagnostic.tokenCount, stepBrother.familyTokens,
    "diagnostic tokenCount must match the final responder-family-facts block");
  assert.match(stepBrother.familyText, /不证明角色本人知情/u,
    "public current relationship facts must not claim the responder personally knows them");

  const paternalHalfSiblingData = await parseFixture(runtime, makeStepFamilyLines({ siblingCount: 1 }));
  const paternalHalfSibling = render(runtime, paternalHalfSiblingData, "你们是否同父异母？", memoryContext);
  assert.match(paternalHalfSibling.familyText, /同父异母/u,
    "a shared father and different public mothers remain a half-sibling relation");
  assert.ok(!paternalHalfSibling.familyText.includes("继兄弟"),
    "a paternal half-sibling must not be relabeled as a step-sibling");
  assert.match(paternalHalfSibling.familyText, /赵子明/u,
    "without an explicit target, one unique same-father candidate may be identified");

  const multiplePaternalHalfData = await parseFixture(runtime, makeStepFamilyLines({ siblingCount: 2 }));
  const multiplePaternalHalf = render(runtime, multiplePaternalHalfData, "你们是否同父异母？", memoryContext);
  assert.match(multiplePaternalHalf.familyText, /RELATION_AMBIGUOUS/u,
    "multiple sibling candidates must remain ambiguous when the query has no explicit target");
  assert.ok(!multiplePaternalHalf.familyText.includes("赵子明")
    && !multiplePaternalHalf.familyText.includes("王氏子1"),
  "a no-intent same-father query must not select or disclose an arbitrary sibling");

  const maternalHalfSiblingData = await parseFixture(runtime, makeStepFamilyLines({
    maternalHalfSibling: true
  }));
  const maternalHalfSibling = render(runtime, maternalHalfSiblingData, "你们是否同母异父？", memoryContext);
  assert.match(maternalHalfSibling.familyText, /同母异父/u,
    "a shared mother and different public fathers receive the same half-sibling treatment");
  assert.ok(!maternalHalfSibling.familyText.includes("继兄弟"),
    "a maternal half-sibling must not be relabeled as a step-sibling");

  const assertNoCurrentSpouseProjection = (gameData, query, parentId, spouseName, childName, label) => {
    const output = render(runtime, gameData, query, memoryContext);
    assert.ok(!/当前继母：|当前继父：/u.test(output.familyText),
      `${label}: deceased or conflicting life evidence must not produce a current step-parent assertion`);
    assert.ok(!output.familyText.includes(spouseName), `${label}: the unconfirmed spouse must not be named as current`);
    const projectedParent = projectTraitProfile(gameData, true).responder.parents
      .find(parent => Number(parent.id) === Number(parentId));
    assert.ok(projectedParent, `${label}: the bound biological parent must remain in the custom-template profile`);
    assert.equal(projectedParent.spouses?.length || 0, 0,
      `${label}: invalid current spouse evidence and its subtree must be filtered from the custom-template profile`);
    assert.ok(!JSON.stringify(projectedParent).includes(spouseName)
      && !JSON.stringify(projectedParent).includes(childName),
    `${label}: spouse and spouse-child source rows must not leak through the projected parent`);
    return output;
  };

  const parentDeath = { deathDate: "1189年12月1日", deathDateTotalDays: 80, deathReason: "MURDER" };
  const deadFatherLines = makeStepFamilyLines({
    marriages: [{ parentId: PLAYER_ID, spouseId: STEP_MOTHER_ID, name: "崔兰", gender: "female" }],
    spouseChildren: [{
      parentId: PLAYER_ID,
      spouseId: STEP_MOTHER_ID,
      spouseName: "崔兰",
      childId: 63,
      name: "崔玉珠",
      gender: "female",
      otherParentId: 65,
      otherParentName: "吕父",
      otherParentGender: "male"
    }]
  });
  deadFatherLines.push(line("parent_death", RESPONDER_ID, [PLAYER_ID, parentDeath.deathDateTotalDays,
    parentDeath.deathDate, parentDeath.deathReason]));

  const deadFatherData = await parseFixture(runtime, deadFatherLines);
  const deadFatherRecord = deadFatherData.characters.get(RESPONDER_ID).parents
    .find(parent => Number(parent.id) === PLAYER_ID);
  const deadFatherCanonical = deadFatherData.characters.get(PLAYER_ID);
  Object.assign(deadFatherCanonical, { alive: false, ...parentDeath });
  assert.deepEqual(resolveLifeStatus(deadFatherRecord).alive, false,
    "the production parent_death row must make the observer-bound father record explicitly dead");
  assert.deepEqual(resolveLifeStatus(deadFatherCanonical).alive, false,
    "the canonical father record must independently confirm the same death");
  assert.equal(deadFatherRecord.deathDate, deadFatherCanonical.deathDate,
    "the source-bound and canonical father death dates must agree");
  assert.equal(deadFatherRecord.deathDateTotalDays, deadFatherCanonical.deathDateTotalDays,
    "the source-bound and canonical father death days must agree");
  assertNoCurrentSpouseProjection(deadFatherData, "你继母是谁？", PLAYER_ID, "崔兰", "崔玉珠", "confirmed dead father");

  const oneSidedDeadFatherData = await parseFixture(runtime, deadFatherLines);
  const oneSidedFatherRecord = oneSidedDeadFatherData.characters.get(RESPONDER_ID).parents
    .find(parent => Number(parent.id) === PLAYER_ID);
  const oneSidedFatherCanonical = oneSidedDeadFatherData.characters.get(PLAYER_ID);
  assert.equal(resolveLifeStatus(oneSidedFatherRecord).alive, false,
    "the one-sided fixture must carry explicit death only on the parsed parent relation");
  assert.equal(resolveLifeStatus(oneSidedFatherCanonical).alive, null,
    "the one-sided fixture must leave canonical life status unknown");
  assertNoCurrentSpouseProjection(oneSidedDeadFatherData, "你继母是谁？", PLAYER_ID, "崔兰", "崔玉珠", "one-sided dead father");

  const conflictingFatherData = await parseFixture(runtime, deadFatherLines);
  const conflictingFatherRecord = conflictingFatherData.characters.get(RESPONDER_ID).parents
    .find(parent => Number(parent.id) === PLAYER_ID);
  conflictingFatherRecord.alive = true;
  assert.equal(resolveLifeStatus(conflictingFatherRecord).conflict, true,
    "alive and death evidence on one parent record must resolve to a life-status conflict");
  assertNoCurrentSpouseProjection(conflictingFatherData, "你继母是谁？", PLAYER_ID, "崔兰", "崔玉珠", "conflicting father life evidence");

  const deadMotherLines = makeStepFamilyLines({
    marriages: [{ parentId: 2, spouseId: STEP_FATHER_ID, name: "沈承安", gender: "male" }],
    spouseChildren: [{
      parentId: 2,
      spouseId: STEP_FATHER_ID,
      spouseName: "沈承安",
      childId: 64,
      name: "崔玉安",
      gender: "male",
      otherParentId: 66,
      otherParentName: "程母",
      otherParentGender: "female"
    }]
  });
  deadMotherLines.push(line("parent_death", RESPONDER_ID, [2, parentDeath.deathDateTotalDays,
    parentDeath.deathDate, parentDeath.deathReason]));
  const deadMotherData = await parseFixture(runtime, deadMotherLines);
  Object.assign(deadMotherData.characters.get(2), { alive: false, ...parentDeath });
  assertNoCurrentSpouseProjection(deadMotherData, "你继父是谁？", 2, "沈承安", "崔玉安", "confirmed dead mother");

  const deceasedSpouseData = await parseFixture(runtime, makeStepFamilyLines({
    marriages: [{ parentId: 2, spouseId: STEP_FATHER_ID, name: "沈承安", gender: "male" }],
    spouseChildren: [{
      parentId: 2,
      spouseId: STEP_FATHER_ID,
      spouseName: "沈承安",
      childId: 64,
      name: "崔玉安",
      gender: "male",
      otherParentId: 66,
      otherParentName: "程母",
      otherParentGender: "female"
    }]
  }));
  const motherRecord = deceasedSpouseData.characters.get(RESPONDER_ID).parents
    .find(parent => Number(parent.id) === 2);
  const deceasedSpouseRecord = motherRecord.spouses.find(spouse => Number(spouse.id) === STEP_FATHER_ID);
  const deceasedSpouseCanonical = deceasedSpouseData.characters.get(STEP_FATHER_ID);
  Object.assign(deceasedSpouseRecord, { alive: false, ...parentDeath });
  Object.assign(deceasedSpouseCanonical, { alive: false, ...parentDeath });
  assert.equal(resolveLifeStatus(deceasedSpouseRecord).alive, false,
    "the source spouse record must explicitly confirm the spouse's death");
  assert.equal(resolveLifeStatus(deceasedSpouseCanonical).alive, false,
    "the canonical spouse record must independently confirm the same death");
  assertNoCurrentSpouseProjection(deceasedSpouseData, "你继父是谁？", 2, "沈承安", "崔玉安", "deceased current-spouse candidate");

  const authorizedPastStepParent = render(runtime, deadFatherData, "你以前的继母是谁？", makeHistoricalMemoryContext());
  assert.ok(authorizedPastStepParent.text.includes(HISTORICAL_MEMORY),
    "current-death fail-closed behavior must preserve already authorized, dated Legacy history");
  assert.ok(!authorizedPastStepParent.familyText.includes("当前继母：崔兰"),
    "preserving authorized historical memory must not restore a current stepmother assertion");

  const validProjectionData = await parseFixture(runtime, makeProjectionFixtureLines());
  const validProjection = projectTraitProfile(validProjectionData, true);
  const projectedMother = validProjection.responder.parents.find(parent => Number(parent.id) === 2);
  const projectedSpouse = projectedMother?.spouses.find(item => Number(item.id) === STEP_FATHER_ID);
  const projectedChild = projectedSpouse?.children.find(item => Number(item.id) === STEP_BROTHER_ID);
  assert.ok(projectedSpouse && projectedChild,
    "includeStepFamily must preserve current source-bound spouse and child rows in the custom-template profile view");
  assert.equal(projectedChild.parents.length, 2,
    "the custom-template view must preserve both validated nested parent records");
  assert.ok(projectedChild.sourceOwnerId === RESPONDER_ID && projectedChild.sourceParentId === 2
    && projectedChild.sourceSpouseId === STEP_FATHER_ID,
  "the retained spouse child must keep its observer, parent, and spouse bindings");
  assert.ok(projectedChild.parents.every(parent => parent.sourceOwnerId === RESPONDER_ID
    && parent.childId === STEP_BROTHER_ID && parent.publicStatus === "PUBLIC_LEGAL_PARENT"
    && parent.knowledgeStatus === "UNKNOWN"
    && parent.sourceSnapshotId === `${validProjectionData.date}/${validProjectionData.totalDays}`),
  "retained nested parents must remain current, public, observer-bound, and knowledge-unknown");
  assert.ok(validProjection.serialized.includes("沈承安") && validProjection.serialized.includes("沈子明"),
    "the serialized custom-template profile must include the validated step-family tree");

  const ordinaryProjection = projectTraitProfile(validProjectionData, false);
  const ordinaryMother = ordinaryProjection.responder.parents.find(parent => Number(parent.id) === 2);
  assert.equal(ordinaryMother?.spouses.length, 0,
    "the ordinary profile view must omit the new parent-spouse tree");
  assert.ok(!ordinaryProjection.serialized.includes("CK3_PARENT_SPOUSE")
    && !ordinaryProjection.serialized.includes("CK3_PARENT_SPOUSE_CHILD"),
  "the ordinary custom-template projection must not contain spouse or spouse-child evidence");

  const childProjectionCases = [
    ["snapshot", child => { child.sourceSnapshotId = "stale-step-snapshot"; }],
    ["public status", child => { child.publicStatus = "UNKNOWN"; }],
    ["knowledge status", child => { child.knowledgeStatus = "KNOWN"; }],
    ["observer owner", child => { child.sourceOwnerId = 999; }],
    ["parent binding", child => { child.sourceParentId = 999; }],
    ["spouse binding", child => { child.sourceSpouseId = 999; }],
    ["evidence conflict", child => { child.evidenceConflict = true; }]
  ];
  for (const [label, invalidate] of childProjectionCases) {
    const data = await parseFixture(runtime, makeProjectionFixtureLines());
    const { child } = getProjectionFixtureEvidence(data);
    const sentinel = `V937_REMOVED_STEP_CHILD_${label.replace(/\s+/gu, "_")}`;
    child.name = sentinel;
    invalidate(child);
    const projection = projectTraitProfile(data, true);
    const parent = projection.responder.parents.find(item => Number(item.id) === 2);
    const spouse = parent?.spouses.find(item => Number(item.id) === STEP_FATHER_ID);
    assert.equal(spouse?.children.length, 0, `invalid spouse-child ${label} must be removed from the raw custom-template tree`);
    assert.ok(!projection.serialized.includes(sentinel), `invalid spouse-child ${label} sentinel must not serialize`);
  }

  const nestedParentProjectionCases = [
    ["snapshot", parent => { parent.sourceSnapshotId = "stale-nested-parent"; }],
    ["observer owner", parent => { parent.sourceOwnerId = 999; }],
    ["child binding", parent => { parent.childId = 999; }],
    ["source path", parent => { parent.sourceRelation = "parents"; }],
    ["evidence conflict", parent => { parent.evidenceConflict = true; }]
  ];
  for (const [label, invalidate] of nestedParentProjectionCases) {
    const data = await parseFixture(runtime, makeProjectionFixtureLines());
    const { child } = getProjectionFixtureEvidence(data);
    const invalidParent = child.parents[0];
    const sentinel = `V937_REMOVED_NESTED_PARENT_${label.replace(/\s+/gu, "_")}`;
    invalidParent.name = sentinel;
    invalidate(invalidParent);
    const projection = projectTraitProfile(data, true);
    const parent = projection.responder.parents.find(item => Number(item.id) === 2);
    const spouse = parent?.spouses.find(item => Number(item.id) === STEP_FATHER_ID);
    const projectedChild = spouse?.children.find(item => Number(item.id) === STEP_BROTHER_ID);
    assert.equal(projectedChild?.parents.length, 1, `invalid nested parent ${label} must be filtered independently`);
    assert.ok(!projection.serialized.includes(sentinel), `invalid nested parent ${label} sentinel must not serialize`);
  }

  const directParentProjectionCases = [
    ["knowledge status", parent => { parent.knowledgeStatus = "KNOWN"; }],
    ["evidence conflict", parent => { parent.evidenceConflict = true; }]
  ];
  for (const [label, invalidate] of directParentProjectionCases) {
    const data = await parseFixture(runtime, makeProjectionFixtureLines());
    const directParent = data.characters.get(RESPONDER_ID).parents.find(parent => Number(parent.id) === PLAYER_ID);
    const sentinel = `V937_REMOVED_DIRECT_PARENT_${label.replace(/\s+/gu, "_")}`;
    directParent.name = sentinel;
    invalidate(directParent);
    const projection = projectTraitProfile(data, true);
    assert.ok(!projection.serialized.includes(sentinel), `invalid direct parent ${label} sentinel must not serialize`);
    assert.ok(!projection.responder.parents.some(parent => Number(parent.id) === PLAYER_ID),
      `invalid direct parent ${label} must be removed from custom-template access`);
  }

  const validTypedStepData = await parseFixture(runtime, makeStepFamilyLines());
  addTypedHistoricalStep(validTypedStepData, { name: "V937_VALID_TYPED_STEP" });
  const validTypedProjection = projectTraitProfile(validTypedStepData, true);
  assert.ok(validTypedProjection.serialized.includes("V937_VALID_TYPED_STEP"),
    "a source-bound current-snapshot legacy STEP record remains available in the custom-template view");
  const typedStepProjectionCases = [
    ["snapshot", record => { record.sourceSnapshotId = "stale-typed-step"; }],
    ["campaign", record => { record.campaignToken = OTHER_CAMPAIGN; }],
    ["owner", record => { record.sourceOwnerId = 999; }],
    ["child", record => { record.childId = PLAYER_ID; }],
    ["source path", record => { record.sourceRelation = "siblings"; }],
    ["public status", record => { record.publicStatus = "UNKNOWN"; }],
    ["knowledge status", record => { record.knowledgeStatus = "KNOWN"; }]
  ];
  for (const [label, invalidate] of typedStepProjectionCases) {
    const data = await parseFixture(runtime, makeStepFamilyLines());
    const sentinel = `V937_REMOVED_TYPED_STEP_${label.replace(/\s+/gu, "_")}`;
    const record = addTypedHistoricalStep(data, { name: sentinel });
    invalidate(record);
    const projection = projectTraitProfile(data, true);
    assert.ok(!projection.serialized.includes(sentinel), `invalid typed STEP ${label} sentinel must not serialize`);
  }

  const cacheData = await parseFixture(runtime, makeStepFamilyLines());
  const cachedBirthGraph = getCachedBirthGraphQuietly(cacheData);
  const cacheMother = cacheData.characters.get(RESPONDER_ID).parents.find(parent => Number(parent.id) === 2);
  assert.ok(cacheMother?.spouses.length === 0, "the birth graph fixture must start without a parent-spouse tree");
  const parsedStepTreeData = await parseFixture(runtime, makeProjectionFixtureLines());
  const parsedStepTree = getProjectionFixtureEvidence(parsedStepTreeData).spouse;
  cacheMother.spouses.push(parsedStepTree);
  assert.strictEqual(getCachedBirthGraphQuietly(cacheData), cachedBirthGraph,
    "adding a parser-produced spouse/children subtree must reuse the cached birth graph");
  const freshStepQuery = render(runtime, cacheData, "你继兄弟是谁？", memoryContext);
  assert.match(freshStepQuery.familyText, /沈子明/u,
    "the direct step-family query must read newly attached source evidence despite birth-graph cache reuse");

  const cachedStepChild = cacheMother.spouses[0].children[0];
  cachedStepChild.publicStatus = "UNKNOWN";
  assert.strictEqual(getCachedBirthGraphQuietly(cacheData), cachedBirthGraph,
    "changing only spouse-child evidence status must not rebuild the birth graph");
  const unknownChildQuery = render(runtime, cacheData, "你继兄弟是谁？", memoryContext);
  assert.ok(!unknownChildQuery.familyText.includes("沈子明"),
    "the direct step-family query must immediately hide child evidence changed to UNKNOWN");

  cacheMother.spouses[0].publicStatus = "UNKNOWN";
  assert.strictEqual(getCachedBirthGraphQuietly(cacheData), cachedBirthGraph,
    "changing only parent-spouse evidence status must not rebuild the birth graph");
  const unknownSpouseQuery = render(runtime, cacheData, "你继父是谁？", memoryContext);
  assert.ok(!unknownSpouseQuery.familyText.includes("沈承安"),
    "the direct step-family query must immediately hide spouse evidence changed to UNKNOWN");

  const unknownData = await parseFixture(runtime, makeStepFamilyLines({
    marriages: [{ parentId: 2, spouseId: STEP_FATHER_ID, name: "沈承安", gender: "male", status: "UNKNOWN" }],
    spouseChildren: [{
      parentId: 2,
      spouseId: STEP_FATHER_ID,
      spouseName: "沈承安",
      childId: STEP_BROTHER_ID,
      name: "沈子明",
      gender: "male",
      otherParentId: 61,
      otherParentName: "陆氏",
      otherParentGender: "female",
      status: "UNKNOWN"
    }],
    addSecret: true
  }));
  const unknownStepfather = render(runtime, unknownData, "你继父是谁？", memoryContext);
  const unknownStepSibling = render(runtime, unknownData, "你继兄弟是谁？", memoryContext);
  for (const output of [unknownStepfather, unknownStepSibling]) {
    assert.ok(!output.familyText.includes("沈承安") && !output.familyText.includes("沈子明"),
      "UNKNOWN marriage/parent status must not disclose a step-relative candidate");
    assert.ok(!output.text.includes(SECRET), "a private CK3 secret must not enter the final Prompt");
  }

  const multiCandidateData = await parseFixture(runtime, makeStepFamilyLines({
    marriages: [
      { parentId: 2, spouseId: STEP_FATHER_ID, name: "沈承安", gender: "male" },
      { parentId: 2, spouseId: 52, name: "韩仲文", gender: "male" }
    ]
  }));
  const multiCandidate = render(runtime, multiCandidateData, "你继父是谁？", memoryContext);
  assert.ok(multiCandidate.familyText.includes("沈承安") && multiCandidate.familyText.includes("韩仲文"),
    "both public candidates may be named only as an explicit ambiguity set");
  assert.ok(!multiCandidate.familyText.includes("当前继父：沈承安")
    && !multiCandidate.familyText.includes("当前继父：韩仲文"),
  "multiple current-spouse candidates must not be resolved by array order");
  assert.match(multiCandidate.familyText, /存在多个候选，未选择具体人物/u,
    "multiple current-spouse candidates should leave an explicit fail-closed result");

  const multipleStepSiblingsData = await parseFixture(runtime, makeStepFamilyLines({
    marriages: [{ parentId: 2, spouseId: STEP_FATHER_ID, name: "沈承安", gender: "male" }],
    spouseChildren: [{
      parentId: 2,
      spouseId: STEP_FATHER_ID,
      spouseName: "沈承安",
      childId: STEP_BROTHER_ID,
      name: "沈子明",
      gender: "male",
      otherParentId: 61,
      otherParentName: "陆氏",
      otherParentGender: "female"
    }, {
      parentId: 2,
      spouseId: STEP_FATHER_ID,
      spouseName: "沈承安",
      childId: 62,
      name: "王元直",
      gender: "male",
      otherParentId: 71,
      otherParentName: "刘父",
      otherParentGender: "male"
    }]
  }));
  const multipleStepSiblings = render(runtime, multipleStepSiblingsData, "你继兄弟是谁？", memoryContext);
  assert.match(multipleStepSiblings.familyText, /存在多个候选，未选择具体人物/u,
    "multiple step-sibling candidates must not be resolved by parser order");
  assert.ok(multipleStepSiblings.familyText.includes("沈子明")
    && multipleStepSiblings.familyText.includes("王元直"),
  "multiple step-sibling candidates may only be named as an explicit ambiguity set");

  const crossCampaignLines = makeStepFamilyLines({
    marriages: [{ parentId: 2, spouseId: STEP_FATHER_ID, name: "沈承安", gender: "male" }]
  });
  crossCampaignLines.push("VOTC:CAMPAIGN/" + OTHER_CAMPAIGN);
  const crossCampaignData = await parseFixture(runtime, crossCampaignLines);
  const crossCampaign = render(runtime, crossCampaignData, "你继父是谁？", memoryContext);
  assert.equal(crossCampaignData.campaignToken, OTHER_CAMPAIGN);
  assert.ok(!crossCampaign.familyText.includes("沈承安"),
    "source evidence from a different campaign must not confirm a current stepfather");

  const staleData = await parseFixture(runtime, makeStepFamilyLines({
    marriages: [{ parentId: 2, spouseId: STEP_FATHER_ID, name: "沈承安", gender: "male" }]
  }));
  const staleEvidence = parentSpouseEvidence(staleData);
  assert.ok(staleEvidence.length > 0, "the spouse fixture must retain source-bound parser evidence");
  for (const evidence of staleEvidence) evidence.sourceSnapshotId = "1189年5月2日/99";
  const stale = render(runtime, staleData, "你继父是谁？", memoryContext);
  assert.ok(!stale.familyText.includes("沈承安"),
    "stale parent-spouse evidence must not confirm a current stepfather");

  const undatedFormerData = await parseFixture(runtime, makeStepFamilyLines());
  addUndatedHistoricalSpouses(undatedFormerData);
  const historicalContext = makeHistoricalMemoryContext();
  const historicalMemoryBefore = JSON.stringify(historicalContext);
  const formerStepParent = render(runtime, undatedFormerData, "你以前的继母是谁？", historicalContext);
  assert.match(formerStepParent.familyText, /未确认当前继母/u,
    "the current-data result must be scoped to the current step-parent query");
  assert.match(formerStepParent.familyText, /没有可验证的既往婚姻期间/u,
    "former/deceased spouse metadata without a marriage period must not be promoted into a historical step relation");
  assert.ok(!formerStepParent.familyText.includes("杜氏前妻")
    && !formerStepParent.familyText.includes("赵氏亡妻"),
  "a divorce-unknown former spouse or death date alone must not identify a former step-parent");
  assert.ok(formerStepParent.text.includes(HISTORICAL_MEMORY),
    "an already authorized Legacy record with explicit relationship and time must remain available in the final Prompt");
  assert.ok(!formerStepParent.familyText.includes("从未有继母"),
    "current GameData coverage limits must not deny a separately authorized past record");
  assert.equal(JSON.stringify(historicalContext), historicalMemoryBefore,
    "a historical family query must not mutate or expand memory authorization");

  const typedHistoryData = await parseFixture(runtime, makeStepFamilyLines());
  const typedHistory = addTypedHistoricalStep(typedHistoryData);
  const typedHistoryPrompt = render(runtime, typedHistoryData, "你以前的继母是谁？", makeMemoryContext());
  assert.match(typedHistoryPrompt.familyText, /历史来源记载曾有王氏旧继母为继亲；当前关系未确认/u,
    "a strictly source-bound legacy typed STEP record must be preserved as history without claiming the current relationship");
  assert.ok(!typedHistoryPrompt.familyText.includes("继母：王氏旧继母"),
    "historical typed STEP evidence must never be presented as a current step-parent");
  assert.equal(typedHistory.source, "LEGACY_TYPED_STEP_RELATION",
    "the legacy positive fixture is explicitly source typed and is added only after real parsing");

  const staleTypedHistoryData = await parseFixture(runtime, makeStepFamilyLines());
  addTypedHistoricalStep(staleTypedHistoryData, {
    name: "过期旧继母",
    sourceSnapshotId: "1189年5月2日/99"
  });
  const staleTypedHistory = render(runtime, staleTypedHistoryData, "你以前的继母是谁？", makeMemoryContext());
  assert.ok(!staleTypedHistory.familyText.includes("过期旧继母"),
    "a stale typed STEP source must not be preserved as a current-snapshot historical fact");

  const crossCampaignTypedHistoryData = await parseFixture(runtime, makeStepFamilyLines());
  addTypedHistoricalStep(crossCampaignTypedHistoryData, {
    name: "异战役旧继母",
    campaignToken: OTHER_CAMPAIGN
  });
  const crossCampaignTypedHistory = render(runtime, crossCampaignTypedHistoryData, "你以前的继母是谁？", makeMemoryContext());
  assert.ok(!crossCampaignTypedHistory.familyText.includes("异战役旧继母"),
    "a typed STEP source from another campaign must not enter historical family facts");

  const unboundTypedHistoryData = await parseFixture(runtime, makeStepFamilyLines());
  const unboundTypedHistory = addTypedHistoricalStep(unboundTypedHistoryData, { name: "错绑旧继母" });
  unboundTypedHistory.childId = PLAYER_ID;
  const unboundTypedHistoryPrompt = render(runtime, unboundTypedHistoryData, "你以前的继母是谁？", makeMemoryContext());
  assert.ok(!unboundTypedHistoryPrompt.familyText.includes("错绑旧继母"),
    "typed STEP evidence with a mismatched owner/child binding must fail closed");

  const noMarriageData = await parseFixture(runtime, makeStepFamilyLines());
  const noMarriagePrompt = render(runtime, noMarriageData, "你现在的继母是谁？", makeMemoryContext());
  assert.ok(noMarriagePrompt.familyText.includes("这表示未知，不能回答“没有”"),
    "missing marriage evidence must explicitly prohibit treating unknown as proof of no step-parent");
  assert.ok(noMarriagePrompt.familyText.includes("不得补造父母生死、婚史"),
    "unknown step-parent facts must not invite invented explanations about parent death or remarriage");
  const ordinaryWithoutSpouse = render(runtime, noMarriageData, "继续说下去。", makeMemoryContext());
  const ordinaryWithSpouse = render(runtime, currentStepSiblingData, "继续说下去。", makeMemoryContext());
  assert.equal(ordinaryWithSpouse.text, ordinaryWithoutSpouse.text,
    "unrelated conversation text must remain byte-for-byte unchanged when spouse evidence is present");
  assert.equal(ordinaryWithSpouse.promptTokens, ordinaryWithoutSpouse.promptTokens,
    "unrelated conversation Prompt tokens must remain unchanged when spouse evidence is present");
  assert.equal(JSON.stringify(memoryContext), memoryBefore,
    "targeted step-family queries must not mutate or expand memory authorization");

  process.stdout.write(JSON.stringify({
    status: "PASS",
    campaignToken: FIXTURE_CAMPAIGN,
    snapshot: FIXTURE_DATE + "/" + FIXTURE_TOTAL_DAYS,
    assertions: [
      "production LogParser→GameData→PromptBuilder current stepfather and stepmother",
      "step-sibling final Prompt names the correct step-parent path for children of either parent’s spouse",
      "dead, one-sided, or conflicting parent and spouse life evidence cannot assert current step-parents or expose spouse trees to custom templates",
      "authorized dated Legacy history remains available after current step-family evidence is rejected",
      "step-sibling requires complete public parentage with no biological parent overlap",
      "same-father and same-mother half siblings are never labeled step-siblings",
      "a no-intent same-father query chooses only one unique candidate and leaves multiple candidates ambiguous",
      "UNKNOWN, private secret, cross-campaign, stale, and multiple-candidate evidence fail closed",
      "undated former/deceased spouse data does not invent a historical step relation",
      "authorized time-bounded Legacy memory remains in the final Prompt without memory authorization expansion",
      "unrelated Prompt text and token count are unchanged",
      "custom-template projection retains only fresh, bound, public step-family evidence and filters invalid sentinels",
      "new spouse evidence reuses the birth graph cache while direct step-family queries observe updated status"
    ]
  }, null, 2) + "\n");
}

module.exports = { run: main, makeStepFamilyLines, makeHistoricalMemoryContext };

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
