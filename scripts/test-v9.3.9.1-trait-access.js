"use strict";

const assert = require("node:assert/strict");
const { getAutomaticTraitAccess, getTraitsForKnownProfile } = require("../src/app/main/prompts/trait-profile-selector");

const CAMPAIGN = "v9.3.9.1-trait-access-fixture";
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

function makeFixture({ fatherProofPatch = {}, motherProofPatches = new Map(), secretParentRow = null } = {}) {
  const father = { id: 1, name: "玩家", gender: "male", children: [] };
  const wife = { id: 2, name: "妻子", gender: "female", traits: [{ traitId: "witch", name: "巫师" }], spouses: [{ id: 1 }] };
  const concubine = { id: 3, name: "妾室", gender: "female", traits: [], spouses: [{ id: 1 }] };
  const elder = {
    id: 4,
    name: "长子",
    traits: [{ traitId: "brave", name: "勇敢" }],
    parents: [{ id: father.id, ...directProof(4, father.id, fatherProofPatch) }]
  };
  const youngerParents = [{ id: father.id, ...directProof(5, father.id, fatherProofPatch) }];
  if (secretParentRow) youngerParents.push(secretParentRow);
  const younger = {
    id: 5,
    name: "次子",
    traits: [
      { traitId: "scarred", name: "伤疤" },
      { traitId: "witch", name: "巫师" },
      { traitId: "deceitful", name: "狡诈" }
    ],
    parents: youngerParents
  };
  father.children = [
    { id: elder.id, directParentEvidence: directProof(elder.id, father.id, fatherProofPatch),
      otherParent: otherParent(elder.id, wife.id, father.id, motherProofPatches.get(elder.id)) },
    { id: younger.id, directParentEvidence: directProof(younger.id, father.id, fatherProofPatch),
      otherParent: otherParent(younger.id, concubine.id, father.id, motherProofPatches.get(younger.id)) }
  ];
  const stranger = { id: 9, name: "场外人物", traits: [] };
  const gameData = {
    campaignToken: CAMPAIGN,
    date: DATE,
    totalDays: TOTAL_DAYS,
    characters: new Map([[father.id, father], [wife.id, wife], [concubine.id, concubine],
      [elder.id, elder], [younger.id, younger], [stranger.id, stranger]])
  };
  return { gameData, father, wife, concubine, elder, younger, stranger };
}

function fact(ownerId, targetId, factKey, status, effectiveKnown = status === "MANUAL_KNOWN") {
  return {
    ownerId,
    entityId: targetId,
    factType: "TRAIT",
    factKey,
    status,
    effectiveKnown,
    current: true,
    campaignToken: CAMPAIGN,
    firstAcquiredDate: DATE
  };
}

function testPresenceScopedObservableAccess() {
  const { gameData, younger, stranger } = makeFixture();
  const visible = getAutomaticTraitAccess(stranger, younger, gameData, { activeParticipantIds: [9, 5] });
  assert.deepEqual(visible, { source: "OBSERVABLE", traitKeys: ["trait_scarred"] },
    "the in-person whitelist discloses only observable traits for the actual pair");
  assert.deepEqual(getAutomaticTraitAccess(stranger, younger, gameData), { source: null, traitKeys: [] },
    "missing presence cannot grant in-person observable access");
  assert.deepEqual(getAutomaticTraitAccess(stranger, younger, gameData, { activeParticipantIds: [9] }),
    { source: null, traitKeys: [] }, "a non-present target cannot be observed");
  assert.deepEqual(getAutomaticTraitAccess(stranger, younger, gameData, { activeParticipantIds: [5] }),
    { source: null, traitKeys: [] }, "a non-present observer cannot observe");

  const hiddenFacts = new Map([[younger.id, [
    fact(stranger.id, younger.id, "trait_scarred", "MANUAL_HIDDEN", false),
    fact(stranger.id, younger.id, "trait_witch", "MANUAL_HIDDEN", false)
  ]]]);
  const activeContext = { gameData, campaignToken: CAMPAIGN, currentGameDate: DATE,
    activeParticipantIds: [stranger.id, younger.id], disclosureProfiles: hiddenFacts };
  assert.deepEqual(getTraitsForKnownProfile(stranger, younger, activeContext).map(trait => trait.traitId), ["scarred"],
    "current observable access precedes a manual hide, while secret traits remain hidden");
  const absentContext = { ...activeContext, activeParticipantIds: [], disclosureProfiles: new Map([[younger.id, [
    fact(stranger.id, younger.id, "trait_scarred", "MANUAL_HIDDEN", false)
  ]]]) };
  assert.deepEqual(getTraitsForKnownProfile(stranger, younger, absentContext), [],
    "manual hidden remains effective when no automatic source applies");
}

function testCurrentPublicCloseFamilyAccess() {
  const { gameData, father, wife, concubine, elder, younger, stranger } = makeFixture();
  assert.deepEqual(getAutomaticTraitAccess(father, younger, gameData), {
    source: "PUBLIC_CLOSE_FAMILY", traitKeys: ["trait_scarred", "trait_witch", "trait_deceitful"]
  }, "a current public parent-child edge supplies intrinsic family knowledge of target traits");
  assert.equal(getAutomaticTraitAccess(wife, elder, gameData).source, "PUBLIC_CLOSE_FAMILY",
    "a current public kids.otherParent row supplies a parent-child edge");
  assert.equal(getAutomaticTraitAccess(elder, younger, gameData).source, "PUBLIC_CLOSE_FAMILY",
    "sharing one validated public parent grants half-sibling family access");
  assert.deepEqual(getAutomaticTraitAccess(wife, concubine, gameData), { source: null, traitKeys: [] },
    "sharing the same spouse does not imply a family relation");
  assert.deepEqual(getAutomaticTraitAccess(stranger, younger, gameData), { source: null, traitKeys: [] },
    "a public family edge does not grant traits to an unrelated bystander");

  const hidden = new Map([[younger.id, [fact(father.id, younger.id, "trait_witch", "MANUAL_HIDDEN", false)]]]);
  const familyContext = { gameData, campaignToken: CAMPAIGN, currentGameDate: DATE, disclosureProfiles: hidden };
  assert.deepEqual(getTraitsForKnownProfile(father, younger, familyContext).map(trait => trait.traitId),
    ["scarred", "witch", "deceitful"], "public close-family automatic access precedes manual hidden fallback");
  const noAutomatic = new Map([[younger.id, [fact(wife.id, younger.id, "trait_deceitful", "MANUAL_KNOWN")]]]);
  const manualContext = { gameData, campaignToken: CAMPAIGN, currentGameDate: DATE, disclosureProfiles: noAutomatic };
  assert.deepEqual(getTraitsForKnownProfile(wife, younger, manualContext).map(trait => trait.traitId), ["deceitful"],
    "a directed manual disclosure remains the fallback without automatic family access");
}

function testPublicEvidenceFailsClosed() {
  const staleMother = new Map([[5, { sourceSnapshotId: "1189.5.2/99" }]]);
  const { gameData, father, wife, younger } = makeFixture({ motherProofPatches: staleMother });
  assert.deepEqual(getAutomaticTraitAccess(wife, younger, gameData), { source: null, traitKeys: [] },
    "stale other-parent evidence cannot create a parent-child access path");

  const unknownFixture = makeFixture({ fatherProofPatch: { publicStatus: "UNKNOWN" } });
  assert.deepEqual(getAutomaticTraitAccess(unknownFixture.father, unknownFixture.younger, unknownFixture.gameData),
    { source: null, traitKeys: [] }, "UNKNOWN direct-parent evidence cannot grant family access");
  assert.deepEqual(getAutomaticTraitAccess(unknownFixture.elder, unknownFixture.younger, unknownFixture.gameData),
    { source: null, traitKeys: [] }, "UNKNOWN shared-parent evidence cannot create sibling access");

  const secretParent = {
    id: 9,
    source: "CK3_DIRECT_PARENT",
    sourceOwnerId: 5,
    childId: 5,
    parentId: 9,
    relationType: "parent",
    sourceRelation: "parents",
    publicStatus: "UNKNOWN",
    knowledgeStatus: "SECRET",
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT
  };
  const secretFixture = makeFixture({ secretParentRow: secretParent });
  assert.deepEqual(getAutomaticTraitAccess(secretFixture.stranger, secretFixture.younger, secretFixture.gameData),
    { source: null, traitKeys: [] }, "an undisclosed biological-parent claim cannot create kinship access");

  const oldCampaign = makeFixture({ fatherProofPatch: { campaignToken: "older-campaign" } });
  assert.deepEqual(getAutomaticTraitAccess(oldCampaign.father, oldCampaign.younger, oldCampaign.gameData),
    { source: null, traitKeys: [] }, "a parent proof from another campaign cannot grant family access");
}

function testConflictingOtherParentDuplicatesFailClosed() {
  const cases = [
    ["SECRET duplicate", { knowledgeStatus: "SECRET" }],
    ["stale duplicate", { sourceSnapshotId: "1189.5.2/99" }]
  ];
  for (const [label, patch] of cases) {
    const fixture = makeFixture();
    const original = fixture.father.children.find(entry => entry.id === fixture.elder.id);
    assert.equal(getAutomaticTraitAccess(fixture.wife, fixture.elder, fixture.gameData).source, "PUBLIC_CLOSE_FAMILY",
      `${label}: the baseline current public evidence is accepted`);
    fixture.father.children.push({ ...original, otherParent: { ...original.otherParent, ...patch } });
    assert.deepEqual(getAutomaticTraitAccess(fixture.wife, fixture.elder, fixture.gameData), { source: null, traitKeys: [] },
      `${label}: a valid duplicate cannot override a conflicting current-source record`);
  }
}

function testBoundedCurrentSaveParentEvidence() {
  const fingerprint = "a".repeat(64);
  const child = {
    id: 20,
    traits: [{ traitId: "witch", name: "巫师" }],
    parents: { father: 10 },
    evidence: { relations: [{
      ownerId: "10",
      relationType: "child",
      directParentEvidence: {
        source: "CK3_SAVE_LEGAL_PARENT",
        sourceSchemaVersion: 1,
        sourceOwnerId: "20",
        childId: "20",
        parentId: "10",
        relationType: "parent",
        sourceRelation: "family_data.father",
        publicStatus: "PUBLIC_LEGAL_PARENT",
        knowledgeStatus: "UNKNOWN",
        playthroughId: "trait-access-playthrough",
        gameDate: DATE,
        contentFingerprint: fingerprint,
        sourceSnapshotId: `trait-access-playthrough/${DATE}/${fingerprint}`
      }
    }] }
  };
  const parent = { id: 10, name: "父亲", traits: [] };
  const gameData = { schemaVersion: 1, playthroughId: "trait-access-playthrough", gameDate: DATE,
    contentFingerprint: fingerprint, characters: new Map([[10, parent], [20, child]]) };
  assert.deepEqual(getAutomaticTraitAccess(parent, child, gameData), {
    source: "PUBLIC_CLOSE_FAMILY", traitKeys: ["trait_witch"]
  }, "the current legal CK3 save parent source is accepted without roster enumeration");

  const guardedCharacters = new Proxy(gameData.characters, { get(map, key) {
    if (["keys", "values", "entries"].includes(key) || key === Symbol.iterator) throw new Error("whole_roster_scan");
    const value = Reflect.get(map, key, map);
    return typeof value === "function" ? value.bind(map) : value;
  } });
  gameData.characters = guardedCharacters;
  assert.deepEqual(getAutomaticTraitAccess(parent, child, gameData), {
    source: "PUBLIC_CLOSE_FAMILY", traitKeys: ["trait_witch"]
  }, "the access helper performs only bounded Map.get lookups");
}

function testExplicitStepMarkersDoNotGrantDirectFamilyAccess() {
  for (const nested of [false, true]) {
    const { gameData, father, younger } = makeFixture();
    const reference = younger.parents[0];
    younger.parents = [{ id: father.id, ...(nested ? {} : { relationshipKind: "STEP" }),
      directParentEvidence: { ...reference, ...(nested ? { relationshipKind: "STEP" } : {}) } }];
    assert.deepEqual(getAutomaticTraitAccess(father, younger, gameData), { source: null, traitKeys: [] },
      `a STEP marker on the ${nested ? "nested proof" : "outer parent reference"} cannot grant direct-family access`);
  }
  const { gameData, concubine, younger, father } = makeFixture();
  father.children[1].otherParent.relationshipKind = "STEP";
  assert.deepEqual(getAutomaticTraitAccess(concubine, younger, gameData), { source: null, traitKeys: [] },
    "a typed other-parent STEP record does not grant direct-family access");
}

testPresenceScopedObservableAccess();
testCurrentPublicCloseFamilyAccess();
testPublicEvidenceFailsClosed();
testConflictingOtherParentDuplicatesFailClosed();
testBoundedCurrentSaveParentEvidence();
testExplicitStepMarkersDoNotGrantDirectFamilyAccess();
console.log("V9.3.9.1 trait access: PASS (presence whitelist, public close kinship, manual fallback and bounded evidence)");
