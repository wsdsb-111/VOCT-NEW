"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Character } = require("../src/app/main/game-data/character");
const { createLogParser } = require("../src/app/main/game-data/log-parser");
const { getFamilyVisibility } = require("../src/app/main/worldline/family-visibility");
const { getCachedKinshipGraph, getTargetedKinshipGraph } = require("../src/app/main/worldline/kinship-graph-cache");
const { parseGameState } = require("../src/app/main/worldline/game-state-adapter");
const { resolveRelationshipCurrentTruth } = require("../src/app/main/worldline/relationship-current-truth");
const { resolveAnchoredRelationMention } = require("../src/app/main/worldline/anchored-relation-resolver");
const { createTraitProfileView, isPublicCloseFamily } = require("../src/app/main/prompts/trait-profile-selector");
const { buildFamilyFactBlock } = require("../src/app/main/worldline/character-family-facts");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { buildCharacterDisclosureContext } = require("../src/app/main/conversation/character-disclosure-context");

const date = "1180.3.12";
const days = 431002;
const campaignToken = "votc8c-123456789012";

class FixtureGameData {
  constructor(data) {
    this.playerID = Number(data[0]);
    this.date = String(data[4]);
    this.totalDays = Number(data[8]);
    this.characters = new Map();
  }
}

function line(type, owner, fields = []) {
  return ["VOTC:IN", type, owner, ...fields].join("/;/");
}

function person(id, name, pronoun, age) {
  const fields = Array(28).fill("");
  Object.assign(fields, { 0: id, 1: name, 2: name, 3: `官职${id}`, 4: pronoun, 5: age, 8: "unknown", 18: name });
  return ["VOTC:IN", "character", ...fields].join("/;/");
}

function fixture(kind, { relativePresent = true, spousePresent = true, duplicate = false } = {}) {
  const lines = [
    line("init", 1, ["家主", 1, "家主", date, "宫廷", "地点", "地点", days]),
    `VOTC:CAMPAIGN/${campaignToken}`,
    person(1, "家主", "he", 42)
  ];
  if (relativePresent) lines.push(person(2, "亲属", "she", 24));
  if (spousePresent) lines.push(person(3, "亲属配偶", "he", 26));
  if (kind === "parent") {
    lines.push(line("parents", 1, [2, "亲属", 410000, "1120.1.1", 60, "she", "PUBLIC_LEGAL_PARENT"]));
    lines.push(line("parent_spouse", 1, [2, 3, "亲属配偶", "he", "PUBLIC_LEGAL_MARRIAGE", ""]));
    if (duplicate) lines.push(line("parent_spouse", 1, [2, 3, "冲突配偶", "he", "PUBLIC_LEGAL_MARRIAGE", ""]));
  } else {
    const child = kind === "child";
    const prefix = child ? "kid" : "sibling";
    lines.push(line(child ? "kids" : "siblings", 1, [2, "亲属", "she", 420000, "1156.1.1", 24, ...(child ? ["PUBLIC_LEGAL_PARENT"] : [])]));
    lines.push(line(`${prefix}_spouse`, 1, [2, 3, "亲属配偶", "he", "PUBLIC_LEGAL_MARRIAGE", ""]));
    if (duplicate) lines.push(line(`${prefix}_spouse`, 1, [2, 3, "冲突配偶", "he", "PUBLIC_LEGAL_MARRIAGE", ""]));
    lines.push(line(`${prefix}_eob`, 1, [2, ""]));
  }
  return lines;
}

async function parse(lines) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v961-boundary-"));
  const file = path.join(directory, "debug.log");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  const previousLog = console.log;
  try {
    console.log = () => {};
    return await createLogParser({ GameData: FixtureGameData, Character })(file);
  } finally {
    console.log = previousLog;
    fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
}

function nestedRecord(data, kind) {
  const owner = data.characters.get(1);
  return (kind === "parent" ? owner.parents : kind === "child" ? owner.children : owner.siblings)[0].spouses[0];
}

function hiddenAge(ownerId, targetId) {
  return { disclosureProfiles: new Map([[targetId, [{
    campaignToken, ownerId, entityId: targetId, factType: "AGE", factKey: "age", value: "61",
    status: "MANUAL_HIDDEN", current: true, effectiveKnown: false, firstAcquiredDate: date
  }]]]) };
}

async function checkHiddenDeathAge() {
  const data = await parse(fixture("child"));
  const owner = data.characters.get(1);
  const deceased = data.characters.get(2);
  Object.assign(deceased, { alive: false, deathDate: "1178.1.1", ageAtDeath: 61, ageAtDeathSource: "CK3_AGE_AT_DEATH" });
  const memoryContext = hiddenAge(1, 2);
  const view = createTraitProfileView(data, owner, memoryContext);
  const projected = view.gameData.characters.get(2);
  const facts = buildFamilyFactBlock(view.character, view.gameData, {
    relationAuthorityGameData: data, ageAuthorityGameData: data, memoryContext
  });
  assert.ok(facts, "the proven deceased child appears in the family facts");
  assert.doesNotMatch(facts, /终年\s*61\s*岁/u, "MANUAL_HIDDEN age must not reappear in the family death text");
  assert.equal(projected.age, null, "the hidden current age is removed from the projected profile");
  assert.ok(projected.ageAtDeath == null, "the hidden age at death is removed from the projected profile");
}

async function checkNestedMarriages() {
  for (const kind of ["child", "sibling", "parent"]) {
    for (const relativePresent of [false, true]) {
      for (const spousePresent of [false, true]) {
        const label = `${kind}, relative canonical=${relativePresent}, spouse canonical=${spousePresent}`;
        const data = await parse(fixture(kind, { relativePresent, spousePresent }));
        const record = nestedRecord(data, kind);
        assert.equal(record.sourceOwnerId, 1, `${label}: owner-bound export`);
        assert.equal(record.targetBound, spousePresent, `${label}: parser target binding`);
        assert.equal(getFamilyVisibility(data, 1).ids.has("3"), true, `${label}: responder knows relative's spouse`);
        assert.equal(isPublicCloseFamily(1, 3, data), true, `${label}: pair lookup preserves an off-scene target's real source record`);
        if (spousePresent) {
          assert.equal(getFamilyVisibility(data, 3).ids.has("1"), true, `${label}: spouse knows the owner in reverse`);
          const target = data.characters.get(3);
          target.traits = [{ traitId: "brave", name: "勇敢" }];
          target.secrets = [{ type: "secret_witch", marker: "secret-marker" }];
          target.memories = [{ marker: "memory-marker" }];
          const projected = createTraitProfileView(data, data.characters.get(1)).gameData.characters.get(3);
          assert.equal(projected.fullName, target.fullName, `${label}: name is visible`);
          assert.equal(projected.age, target.age, `${label}: age is visible`);
          assert.equal(projected.primaryTitle, target.primaryTitle, `${label}: title is visible`);
          assert.deepEqual(projected.traits, target.traits, `${label}: traits are visible`);
          assert.deepEqual(projected.secrets, [], `${label}: secrets stay private`);
          assert.deepEqual(projected.memories, [], `${label}: history stays private`);
        }
      }
    }

    for (const invalid of ["stale", "wrongOwner", "wrongCampaign", "conflict", "duplicate"]) {
      const data = await parse(fixture(kind, { duplicate: invalid === "duplicate" }));
      const record = nestedRecord(data, kind);
      if (invalid === "stale") record.sourceSnapshotId = "stale";
      if (invalid === "wrongOwner") record.sourceOwnerId = 99;
      if (invalid === "wrongCampaign") record.campaignToken = "other-campaign";
      if (invalid === "conflict") record.evidenceConflict = true;
      assert.equal(getFamilyVisibility(data, 1).ids.has("3"), false, `${kind}: ${invalid} cannot authorize spouse identity`);
      assert.equal(getFamilyVisibility(data, 3).ids.has("1"), false, `${kind}: ${invalid} cannot authorize the reverse identity`);
    }
  }
}

function checkRemoteCollateralSpouse() {
  const characters = new Map();
  for (let id = 1; id <= 10; id++) {
    characters.set(id, { id, name: `人物${id}`, parents: [], children: [], siblings: [], spouses: [] });
  }
  // Person 5 and person 3 are siblings through a common parent, without a
  // direct siblings row. Person 9 is four generations below person 5.
  for (const [child, parent] of [[1, 2], [2, 3], [3, 4], [5, 4], [6, 5], [7, 6], [8, 7], [9, 8]]) {
    characters.get(child).parents.push({
      id: parent, parentId: parent, childId: child, sourceOwnerId: child,
      source: "CK3_DIRECT_PARENT", relationType: "parent", sourceRelation: "parents",
      publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN",
      campaignToken, sourceSnapshotId: `${date}/${days}`
    });
  }
  characters.get(9).spouses.push({
    id: 10, name: "人物10", source: "CK3_GAME_CURRENT_SPOUSE", sourceOwnerId: 9,
    relatedCharacterId: 9, observerRuntimeId: 9, sourceRelation: "spouses", relationType: "CURRENT_SPOUSE",
    evidenceScope: "SOURCE_OWNER_RECORD_ONLY", publicStatus: "PUBLIC_LEGAL_MARRIAGE", knowledgeStatus: "UNKNOWN",
    campaignToken, sourceSnapshotId: `${date}/${days}`, evidenceConflict: false, targetBound: true
  });
  const data = { characters, campaignToken, date, totalDays: days };
  const forward = getFamilyVisibility(data, 1);
  assert.equal(forward.scopeTruncated, false);
  assert.equal(forward.ids.has("9"), true, "the collateral descendant is at generation +2");
  assert.equal(forward.ids.has("10"), true, "the +2 collateral descendant's spouse is visible at a nine-edge discovery distance");
  assert.equal(getFamilyVisibility(data, 10).ids.has("1"), true, "the same one-marriage relationship is visible in reverse");
}

async function checkUnknownGender() {
  const children = fixture("child");
  children.push(person(4, "性别未明子女", "they", 18));
  children.push(line("kids", 1, [4, "性别未明子女", "they", 421000, "1162.1.1", 18, "PUBLIC_LEGAL_PARENT"]));
  children.push(line("kid_eob", 1, [4, ""]));
  const childData = await parse(children);
  const childGraph = getTargetedKinshipGraph(childData, [1], { maxDepth: 4 });
  assert.equal(resolveAnchoredRelationMention({ query: "你女儿是谁？", responderId: 1, graph: childGraph }).status,
    "RELATION_AMBIGUOUS", "an unknown-sex child cannot be discarded to force a unique daughter");

  const spouseLines = [
    line("init", 1, ["家主", 1, "家主", date, "宫廷", "地点", "地点", days]),
    `VOTC:CAMPAIGN/${campaignToken}`,
    person(1, "家主", "he", 42), person(2, "已知女性配偶", "she", 35), person(4, "性别未明配偶", "they", 30),
    line("current_spouse", 1, [2, "已知女性配偶", "she", "PUBLIC_LEGAL_MARRIAGE", ""]),
    line("current_spouse", 1, [4, "性别未明配偶", "they", "PUBLIC_LEGAL_MARRIAGE", ""])
  ];
  const spouseData = await parse(spouseLines);
  const spouseGraph = getTargetedKinshipGraph(spouseData, [1], { maxDepth: 4 });
  assert.equal(resolveAnchoredRelationMention({ query: "你妻子是谁？", responderId: 1, graph: spouseGraph }).status,
    "RELATION_AMBIGUOUS", "an unknown-sex spouse cannot be discarded to force a unique wife");
}

function checkStoredManualHiddenAfterFamilyProof() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v961-disclosure-"));
  try {
    const target = { id: 1, name: "玩家", traits: [{ traitId: "witch", name: "巫师" }], parents: [], children: [], siblings: [], spouses: [] };
    const owner = { id: 2, name: "回应者", traits: [], parents: [], children: [], siblings: [], spouses: [] };
    const data = { playerID: 1, date, totalDays: days, campaignToken, characters: new Map([[1, target], [2, owner]]) };
    const conversation = { id: "v961-scene", conversationEpoch: 1, isActive: true, gameData: data,
      selectedCharacterIds: new Set([2]), presentCharacterIds: new Set([2]), departedCharacterIds: new Set(),
      inactiveParticipantIds: new Map(), messages: [] };
    const store = new ConversationDisclosureStore({ dataDir: directory, getCurrentConversation: () => conversation });
    const view = store.getTargetView({ ownerRuntimeId: 2, targetRuntimeId: 1 });
    const trait = view.facts.find(fact => fact.factKey === "trait_witch");
    assert.ok(trait && !trait.currentDirectObservation);
    store.setManualStatus({ ...view.scope, factType: "TRAIT", factKey: trait.factKey,
      factSourceSnapshotId: trait.factSourceSnapshotId, expectedRevision: trait.revision, status: "MANUAL_HIDDEN" });
    owner.parents.push({ id: 1, childId: 2, parentId: 1, sourceOwnerId: 2, source: "CK3_DIRECT_PARENT",
      sourceRelation: "parents", relationType: "parent", publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN",
      campaignToken, sourceSnapshotId: `${date}/${days}` });
    assert.equal(getFamilyVisibility(data, 2).ids.has("1"), true, "new current proof makes the target family");
    const profile = store.getDisclosureProfile({ ownerRuntimeId: 2, targetRuntimeId: 1 });
    assert.equal(profile.facts.find(fact => fact.factKey === "trait_witch")?.status, "MANUAL_HIDDEN");
    const context = buildCharacterDisclosureContext({ service: store, gameData: data, responderId: 2, targetIds: [1] });
    assert.equal(context.disclosureProfiles.get(1).find(fact => fact.factKey === "trait_witch")?.status, "MANUAL_HIDDEN");
    assert.deepEqual(createTraitProfileView(data, owner, context).gameData.characters.get(1).traits, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function checkShortestDiscoveryDepth() {
  const empty = id => ({ id, parents: [], children: [], siblings: [], spouses: [] });
  const characters = new Map(Array.from({ length: 6 }, (_, index) => [index + 1, empty(index + 1)]));
  // X (4) is first nominated by an inline path at the depth limit, but its
  // canonical record is also reachable through 1 -> 5 -> 4 at depth two.
  characters.get(1).parents.push({ id: 2, parents: [{ id: 3, parents: [{ id: 4 }] }] });
  characters.get(1).siblings.push({ id: 5 });
  characters.get(5).siblings.push({ id: 4 });
  characters.get(4).spouses.push({ id: 6 });
  const graph = getTargetedKinshipGraph({ characters, campaignToken, date, totalDays: days }, [1], { maxDepth: 3 });
  assert.equal(graph.nodes.has("6"), true, "the shorter path expands X and discovers its spouse within the depth limit");
}

function checkSaveSpouseProvenance() {
  const snapshot = parseGameState(`date=1180.3.12 playthrough_id="v961-save-fixture" played_character=1
    living={ 1={first_name="甲" female=no family_data={spouse=2}} 2={first_name="乙" female=yes} 3={first_name="丙" female=yes} }`);
  assert.equal(snapshot.characters["1"].spouse, "2");
  const proof = snapshot.characters["1"].evidence.relations.find(item => item.spouseEvidence)?.spouseEvidence;
  assert.equal(proof?.source, "CK3_SAVE_LEGAL_SPOUSE", "save parser binds the legal spouse to its snapshot");
  const graph = getCachedKinshipGraph(snapshot);
  for (const [subjectRuntimeId, anchorRuntimeId] of [[1, 2], [2, 1]]) {
    assert.equal(graph.relationBetweenOfTypes(subjectRuntimeId, anchorRuntimeId, ["SPOUSE_OF"]).relation?.type, "SPOUSE_OF");
    const fact = resolveRelationshipCurrentTruth({ gameData: snapshot, subjectRuntimeId, anchorRuntimeId });
    assert.equal(fact.relations[String(anchorRuntimeId)]?.type, "SPOUSE_OF");
  }
  const live = { campaignToken, date, totalDays: days, characters: new Map([
    [1, { id: 1, spouse: 2 }], [2, { id: 2 }]
  ]) };
  assert.equal(getCachedKinshipGraph(live).relationBetweenOfTypes(1, 2, ["SPOUSE_OF"]).relation, null,
    "an unproven live scalar spouse does not authorize a marriage");
  snapshot.characters["1"].spouse = "3";
  const changedGraph = getCachedKinshipGraph(snapshot);
  assert.equal(changedGraph.relationBetweenOfTypes(1, 2, ["SPOUSE_OF"]).relation, null,
    "old proof cannot authorize the former raw spouse");
  assert.equal(changedGraph.relationBetweenOfTypes(1, 3, ["SPOUSE_OF"]).relation, null,
    "old proof cannot authorize a newly substituted raw spouse");
}

async function main() {
  await checkHiddenDeathAge();
  await checkNestedMarriages();
  checkRemoteCollateralSpouse();
  await checkUnknownGender();
  checkStoredManualHiddenAfterFamilyProof();
  checkShortestDiscoveryDepth();
  checkSaveSpouseProvenance();
  console.log("V9.6.1 Terra boundary QA: PASS");
}

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
