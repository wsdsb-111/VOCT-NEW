"use strict";

const assert = require("node:assert/strict");
const { getCachedKinshipGraph } = require("../src/app/main/worldline/kinship-graph-cache");
const { buildFamilyFactBlock } = require("../src/app/main/worldline/character-family-facts");
const { getTraitsForKnownProfile } = require("../src/app/main/prompts/trait-profile-selector");

const CAMPAIGN = "v9.3.9.1-mother-knowledge-fixture";
const DATE = "1190.5.2";
const TOTAL_DAYS = 100;
const SNAPSHOT = `${DATE}/${TOTAL_DAYS}`;

function directProof(childId, parentId, patch = {}) {
  return {
    source: "CK3_DIRECT_PARENT",
    sourceOwnerId: childId,
    childId,
    parentId,
    relationType: "parent",
    sourceRelation: "parents",
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT,
    ...patch
  };
}

function otherParent(childId, parentId, sourceOwnerId, patch = {}) {
  return {
    id: parentId,
    parentId,
    otherParentId: parentId,
    name: parentId === 2 ? "妻子" : "妾室",
    parentGender: "female",
    childId,
    sourceOwnerId,
    relationType: "parent",
    source: "CK3_OTHER_PARENT",
    sourceRelation: "kids.otherParent",
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT,
    ...patch
  };
}

function makeFixture({ motherProofPatches = new Map() } = {}) {
  const father = {
    id: 1,
    shortName: "玩家",
    fullName: "玩家",
    gender: "male",
    knownSecrets: [],
    children: []
  };
  const wife = {
    id: 2,
    shortName: "妻子",
    fullName: "妻子",
    gender: "female",
    traits: [{ name: "witch" }],
    knownSecrets: []
  };
  const concubine = {
    id: 3,
    shortName: "妾室",
    fullName: "妾室",
    gender: "female",
    traits: [],
    knownSecrets: []
  };
  const elderChild = {
    id: 4,
    shortName: "长子",
    fullName: "长子",
    gender: "male",
    birthDate: "1170.1.1",
    birthDateTotalDays: 1000,
    traits: [],
    parents: [{ id: father.id, name: father.fullName, gender: father.gender, ...directProof(4, father.id) }]
  };
  const youngerChild = {
    id: 5,
    shortName: "次子",
    fullName: "次子",
    gender: "male",
    birthDate: "1173.1.1",
    birthDateTotalDays: 2000,
    traits: [{ name: "bastard" }],
    parents: [{ id: father.id, name: father.fullName, gender: father.gender, ...directProof(5, father.id) }]
  };

  father.children = [
    { id: elderChild.id, fullName: elderChild.fullName, directParentEvidence: directProof(elderChild.id, father.id),
      otherParent: otherParent(elderChild.id, wife.id, father.id, motherProofPatches.get(elderChild.id)) },
    { id: youngerChild.id, fullName: youngerChild.fullName, directParentEvidence: directProof(youngerChild.id, father.id),
      otherParent: otherParent(youngerChild.id, concubine.id, father.id, motherProofPatches.get(youngerChild.id)) }
  ];

  const gameData = {
    campaignToken: CAMPAIGN,
    date: DATE,
    totalDays: TOTAL_DAYS,
    characters: new Map([[father.id, father], [wife.id, wife], [concubine.id, concubine],
      [elderChild.id, elderChild], [youngerChild.id, youngerChild]])
  };
  return { gameData, father, wife, concubine, elderChild, youngerChild };
}

function assertResolvedMother(graph, motherId, childId, expected, label) {
  const relation = graph.relationBetween(motherId, childId).relation;
  assert.equal(relation?.type || null, expected ? "PARENT_OF" : null, label);
}

function testCurrentPublicMotherBindings() {
  const { gameData, father, wife, concubine, elderChild, youngerChild } = makeFixture();
  const graph = getCachedKinshipGraph(gameData);

  assertResolvedMother(graph, wife.id, elderChild.id, true, "current public proof binds the wife as the elder child's mother");
  assertResolvedMother(graph, concubine.id, youngerChild.id, true, "current public proof binds the concubine as the younger child's mother");
  assertResolvedMother(graph, concubine.id, elderChild.id, false, "the elder child's mother is not swapped with the other-parent record");
  assertResolvedMother(graph, wife.id, youngerChild.id, false, "the younger child's mother is not swapped with the other-parent record");
  assert.equal(graph.relationBetween(wife.id, concubine.id).relation, null,
    "the shared father does not create a relationship between the two mothers");

  const elderFacts = buildFamilyFactBlock(elderChild, gameData, { query: "你弟弟的母亲是谁？" });
  const youngerFacts = buildFamilyFactBlock(youngerChild, gameData, { query: "你哥哥的母亲是谁？" });
  assert.match(elderFacts, /次子的母亲：妾室/u, "the elder child can ask for his younger brother's mother's sourced fact");
  assert.match(youngerFacts, /长子的母亲：妻子/u, "the younger child can ask for his elder brother's mother's sourced fact");
  assert.doesNotMatch(elderFacts, /妻子是妾室|妾室是妻子/u);
  assert.doesNotMatch(youngerFacts, /妻子是妾室|妾室是妻子/u);

  // Only the user's explicit close-family exception grants traits, never a
  // spouse/concubine label or an unexposed biological-parent pointer.
  const privacyContext = {
    gameData,
    campaignToken: CAMPAIGN,
    currentGameDate: DATE,
    disclosureProfiles: new Map()
  };
  assert.deepEqual(getTraitsForKnownProfile(father, wife, privacyContext), [],
    "a public mother/parent edge does not disclose the wife's witch trait");
  assert.deepEqual(getTraitsForKnownProfile(father, youngerChild, privacyContext), youngerChild.traits,
    "the current public parent-child bond permits trait knowledge without disclosure");
  const stranger = { id: 99, traits: [], knownSecrets: [] };
  assert.deepEqual(getTraitsForKnownProfile(stranger, youngerChild, privacyContext), [],
    "a public parent-child bond does not broadcast traits to an unrelated observer");
}

function testInvalidOtherParentProofDoesNotInventMother() {
  const rejectedProofs = [
    ["UNKNOWN public status", { publicStatus: "UNKNOWN" }],
    ["SECRET public status", { publicStatus: "SECRET" }],
    ["SECRET knowledge status", { knowledgeStatus: "SECRET" }],
    ["old campaign", { campaignToken: "v9.3.8-old-campaign" }],
    ["old snapshot", { sourceSnapshotId: "1189.5.2/99" }],
    ["missing proof", null]
  ];

  for (const [label, patch] of rejectedProofs) {
    const motherProofPatches = new Map([[5, patch || {}]]);
    const fixture = makeFixture({ motherProofPatches });
    if (patch === null) fixture.gameData.characters.get(1).children[1].otherParent = null;
    const graph = getCachedKinshipGraph(fixture.gameData);
    assertResolvedMother(graph, fixture.concubine.id, fixture.youngerChild.id, false,
      `${label}: no mother edge is created without complete current public evidence`);
    assertResolvedMother(graph, fixture.wife.id, fixture.elderChild.id, true,
      `${label}: invalid evidence for one child does not revoke the unrelated valid mother fact`);

    const answer = buildFamilyFactBlock(fixture.elderChild, fixture.gameData, { query: "你弟弟的母亲是谁？" });
    assert.match(answer, /次子的母亲：未知（缺少唯一可信公开来源）/u,
      `${label}: a direct relation question says unknown instead of guessing`);
    assert.doesNotMatch(answer, /次子的母亲：妾室/u, `${label}: rejected evidence cannot supply a fabricated answer`);
  }
}

testCurrentPublicMotherBindings();
testInvalidOtherParentProofDoesNotInventMother();
console.log("V9.3.9.1 mother knowledge: PASS (current public parent sources, targeted facts, fail-closed scope and trait privacy)");
