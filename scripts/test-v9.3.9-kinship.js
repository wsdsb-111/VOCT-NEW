"use strict";

const assert = require("node:assert/strict");
const { buildKinshipGraph, buildLegacyStructuralKinshipGraph } = require("../src/app/main/worldline/character-kinship-graph");
const { getCachedKinshipGraph, currentDirectParentFilter, currentPublicParentFilter } = require("../src/app/main/worldline/kinship-graph-cache");
const { resolveKinshipLabel } = require("../src/app/main/worldline/kinship-label-resolver");
const { buildStepFamilyFactBlock } = require("../src/app/main/worldline/step-family-facts");
const { buildFamilyEntityFactBundle } = require("../src/app/main/worldline/family-entity-fact-bundle");

const CAMPAIGN = "v9.3.9-kinship-fixture";
const DATE = "1190.5.2";
const TOTAL_DAYS = 100;
const SNAPSHOT = `${DATE}/${TOTAL_DAYS}`;
const SAVE_HASH = "a".repeat(64);

function directProof(childId = 20, parentId = 10, patch = {}) {
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

function saveParentProof(childId = 20, parentId = 10, patch = {}) {
  const playthroughId = "save-playthrough-1";
  const gameDate = "1190.5.2";
  const contentFingerprint = SAVE_HASH;
  return {
    source: "CK3_SAVE_LEGAL_PARENT", sourceSchemaVersion: 1,
    sourceOwnerId: String(childId), childId: String(childId), parentId: String(parentId),
    relationType: "parent", sourceRelation: "family_data.father",
    publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN",
    playthroughId, gameDate, contentFingerprint,
    sourceSnapshotId: `${playthroughId}/${gameDate}/${contentFingerprint}`,
    ...patch
  };
}

function scope(characters, patch = {}) {
  return { characters, campaignToken: CAMPAIGN, date: DATE, totalDays: TOTAL_DAYS, ...patch };
}

function directRoute(route, proof = directProof()) {
  if (route === "parents") return new Map([[20, { id: 20, parents: [{ id: 10, ...proof }] }]]);
  if (route === "children") return new Map([[10, { id: 10, children: [{ id: 20, directParentEvidence: proof }] }]]);
  if (route === "relation-parent") return new Map([[10, { id: 10, evidence: {
    relations: [{ ownerId: 20, relationType: "parent", directParentEvidence: proof }]
  } }]]);
  return new Map([[20, { id: 20, evidence: {
    relations: [{ ownerId: 10, relationType: "child", directParentEvidence: proof }]
  } }]]);
}

function assertEdge(graph, parentId, childId, expected, label) {
  assert.equal(graph.relationBetween(parentId, childId).relation?.type || null,
    expected ? "PARENT_OF" : null, label);
}

function testAllDirectParentRoutesFailClosed() {
  const data = scope(new Map());
  const routes = ["parents", "children", "relation-parent", "relation-child"];
  const filter = currentDirectParentFilter(data);
  for (const route of routes) {
    const accepted = buildKinshipGraph(directRoute(route), { directParentEvidenceFilter: filter });
    assertEdge(accepted, 10, 20, true, `${route}: current public direct-parent proof is accepted`);
    assertEdge(buildKinshipGraph(directRoute(route)), 10, 20, false,
      `${route}: the strict default builder cannot trust proof without a current validator`);
    assertEdge(buildKinshipGraph(directRoute(route, directProof(20, 10, { publicStatus: "UNKNOWN" })), {
      directParentEvidenceFilter: filter
    }), 10, 20, false, `${route}: UNKNOWN direct-parent proof is rejected`);
    assertEdge(buildLegacyStructuralKinshipGraph(directRoute(route)), 10, 20, false,
      `${route}: typed proof remains fail-closed even through the legacy structural API`);
  }

  const unmarked = new Map([[20, { id: 20, parents: [{ id: 10 }] }]]);
  assertEdge(buildKinshipGraph(unmarked), 10, 20, false, "strict builder rejects unmarked structural parentage");
  assertEdge(buildLegacyStructuralKinshipGraph(unmarked), 10, 20, true,
    "explicit legacy structural API preserves non-current graph diagnostics");

  const conflicted = new Map([
    [10, { id: 10, children: [{ id: 20, directParentEvidence: directProof() }] }],
    [20, { id: 20, evidence: { relations: [{ ownerId: 10, relationType: "child",
      directParentEvidence: directProof(20, 10, { evidenceConflict: true }) }] } }]
  ]);
  assertEdge(buildKinshipGraph(conflicted, { directParentEvidenceFilter: filter }), 10, 20, false,
    "a conflicting duplicate proof cannot be upgraded by a matching public row");
}

function testCurrentSaveLegalParentEvidence() {
  const proof = saveParentProof();
  const profiles = new Map([
    [10, { id: 10 }],
    [20, { id: 20, parents: { father: "10" }, evidence: { relations: [{ ownerId: "10", relationType: "child",
      source: "CK3_SAVE_LEGAL_PARENT", directParentEvidence: proof }] } }]
  ]);
  const gameData = { schemaVersion: 1, playthroughId: "save-playthrough-1", gameDate: "1190.5.2",
    contentFingerprint: SAVE_HASH, characters: profiles };
  const filter = currentDirectParentFilter(gameData);
  assertEdge(buildKinshipGraph(profiles, { directParentEvidenceFilter: filter }), 10, 20, true,
    "current legal father/mother evidence from the save parser is accepted");
  assertEdge(buildKinshipGraph(profiles), 10, 20, false,
    "save source evidence is rejected without the current snapshot validator");
  for (const patch of [
    { sourceRelation: "family_data.real_father" },
    { sourceSchemaVersion: 2 },
    { publicStatus: "UNKNOWN" },
    { contentFingerprint: "b".repeat(64) }
  ]) {
    const rejectedProfiles = new Map([
      [10, { id: 10 }],
      [20, { id: 20, parents: { father: "10" }, evidence: { relations: [{ ownerId: "10", relationType: "child",
        source: "CK3_SAVE_LEGAL_PARENT", directParentEvidence: saveParentProof(20, 10, patch) }] } }]
    ]);
    assertEdge(buildKinshipGraph(rejectedProfiles, { directParentEvidenceFilter: filter }), 10, 20, false,
      `save proof with ${Object.keys(patch)[0]} mismatch is rejected`);
  }
  const wrongLegalPointer = new Map(profiles);
  wrongLegalPointer.set(20, { ...profiles.get(20), parents: { father: "11" } });
  const wrongPointerGameData = { ...gameData, characters: wrongLegalPointer };
  assertEdge(buildKinshipGraph(wrongLegalPointer, { directParentEvidenceFilter: currentDirectParentFilter(wrongPointerGameData) }), 10, 20, false,
    "save metadata cannot authorize a parent absent from the child's legal father/mother fields");
  const orphanGameData = { ...gameData, characters: new Map([[20, profiles.get(20)]]) };
  assertEdge(buildKinshipGraph(orphanGameData.characters, { directParentEvidenceFilter: currentDirectParentFilter(orphanGameData) }), 10, 20, false,
    "save evidence cannot materialize a missing canonical parent profile");
  const invalidDate = "1190.2.31";
  const invalidDateProof = saveParentProof(20, 10, { gameDate: invalidDate,
    sourceSnapshotId: `save-playthrough-1/${invalidDate}/${SAVE_HASH}` });
  const invalidDateCharacters = new Map([
    [10, { id: 10 }],
    [20, { id: 20, parents: { father: "10" }, evidence: { relations: [{ ownerId: "10", relationType: "child",
      source: "CK3_SAVE_LEGAL_PARENT", directParentEvidence: invalidDateProof }] } }]
  ]);
  const invalidDateGameData = { ...gameData, gameDate: invalidDate, characters: invalidDateCharacters };
  assertEdge(buildKinshipGraph(invalidDateCharacters, { directParentEvidenceFilter: currentDirectParentFilter(invalidDateGameData) }),
    10, 20, false, "a matching malformed snapshot date cannot validate a save parent proof");

  const cachedData = { ...gameData };
  const before = getCachedKinshipGraph(cachedData);
  cachedData.gameDate = "1190.5.3";
  const after = getCachedKinshipGraph(cachedData);
  assert.notStrictEqual(after, before, "save gameDate participates in the live-parent cache scope");
  assertEdge(after, 10, 20, false, "a parent proof from the previous save date expires");
}

function otherParent(childId = 20, parentId = 30, sourceOwnerId = 10, sourceRelation = "kids.otherParent", patch = {}) {
  return {
    id: parentId,
    parentId,
    otherParentId: parentId,
    childId,
    sourceOwnerId,
    relationType: "parent",
    source: "CK3_OTHER_PARENT",
    sourceRelation,
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT,
    ...patch
  };
}

function testOtherParentRoutesFailClosed() {
  const data = scope(new Map());
  const filter = currentPublicParentFilter(data);
  const routes = [
    ["children.otherParent", new Map([[10, { id: 10, children: [{ id: 20,
      otherParent: otherParent() }] }]])],
    ["siblings.otherParent", new Map([[10, { id: 10, siblings: [{ id: 20,
      otherParent: otherParent(20, 30, 10, "siblings.otherParent") }] }]])],
    ["evidence.otherParentRelations", new Map([[20, { id: 20, evidence: {
      relations: [{ ownerId: 10, relationType: "child", source: "10.children" }],
      otherParentRelations: [otherParent()]
    } }]])]
  ];
  for (const [label, profiles] of routes) {
    assertEdge(buildKinshipGraph(profiles, { otherParentEvidenceFilter: filter }), 30, 20, true,
      `${label}: current complete PUBLIC proof is accepted`);
    assertEdge(buildKinshipGraph(profiles), 30, 20, false,
      `${label}: UNKNOWN typed records are rejected without a current filter`);
    const withEvidencePatch = (evidencePatch) => new Map([...profiles].map(([id, profile]) => [id, {
      ...profile,
      ...(profile.children ? { children: profile.children.map(child => ({ ...child,
        otherParent: { ...child.otherParent, ...evidencePatch } })) } : {}),
      ...(profile.siblings ? { siblings: profile.siblings.map(sibling => ({ ...sibling,
        otherParent: { ...sibling.otherParent, ...evidencePatch } })) } : {}),
      ...(profile.evidence?.otherParentRelations ? { evidence: { ...profile.evidence,
        otherParentRelations: profile.evidence.otherParentRelations.map(item => ({ ...item, ...evidencePatch })) } } : {})
    }]));
    const unknownProfiles = withEvidencePatch({ publicStatus: "UNKNOWN" });
    assertEdge(buildKinshipGraph(unknownProfiles, { otherParentEvidenceFilter: filter }), 30, 20, false,
      `${label}: current but UNKNOWN parentage does not create a graph edge`);
    const conflictProfiles = withEvidencePatch({ evidenceConflict: true });
    assertEdge(buildKinshipGraph(conflictProfiles, { otherParentEvidenceFilter: filter }), 30, 20, false,
      `${label}: evidence conflicts reject the current other-parent edge`);
  }
}

function testExplicitRevisionCacheExpiresNestedKidsProof() {
  const proof = directProof(20, 10);
  const gameData = scope(new Map([
    [10, { id: 10, children: [{ id: 20, directParentEvidence: proof }] }],
    [20, { id: 20 }]
  ]), { contentFingerprint: "unchanged-content-hash" });
  const current = getCachedKinshipGraph(gameData);
  assertEdge(current, 10, 20, true, "explicit revision accepts current nested kids proof");
  gameData.date = "1190.5.3";
  gameData.totalDays = 101;
  const expired = getCachedKinshipGraph(gameData);
  assert.notStrictEqual(expired, current, "date and totalDays advance invalidates cached current graph even with explicit revision");
  assertEdge(expired, 10, 20, false, "a nested kids proof from the previous snapshot expires");
}

function testCacheTracksMarriageChanges() {
  const data = scope(new Map([[1, { id: 1, spouses: [] }], [2, { id: 2 }]]));
  const before = getCachedKinshipGraph(data);
  assert.equal(before.relationBetween(1, 2).relation, null, "no spouse is inferred before a spouse record exists");
  data.characters.get(1).spouses.push({ id: 2, name: "当前配偶" });
  const after = getCachedKinshipGraph(data);
  assert.notStrictEqual(after, before, "spouse changes invalidate the fallback structural fingerprint");
  assert.equal(after.relationBetween(1, 2).relation?.type, "SPOUSE_OF", "the refreshed graph reflects the current spouse record");
}

function makeStepChildFixture({ parentProofPatch = {}, marriagePatch = {}, actorIsParent = false } = {}) {
  const actorId = 30;
  const childId = 60;
  const spouse = {
    id: actorId,
    name: "王氏正妻",
    gender: "female",
    genderSource: "CK3_LIVE_RELATIVE",
    parentId: 10,
    sourceOwnerId: childId,
    relationType: "CURRENT_SPOUSE",
    source: "CK3_PARENT_SPOUSE",
    sourceRelation: "parents.spouses",
    publicStatus: "PUBLIC_LEGAL_MARRIAGE",
    knowledgeStatus: "UNKNOWN",
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT,
    ...marriagePatch
  };
  const fatherProof = directProof(childId, 10, parentProofPatch);
  const motherProof = directProof(childId, 20, parentProofPatch);
  const parents = [
    { id: 10, name: "李某", gender: "male", genderSource: "CK3_LIVE_RELATIVE", ...fatherProof, spouses: [spouse] },
    { id: 20, name: "赵某", gender: "female", genderSource: "CK3_LIVE_RELATIVE", ...motherProof }
  ];
  if (actorIsParent) parents.push({ id: actorId, name: "王氏正妻", gender: "female", genderSource: "CK3_LIVE_RELATIVE",
    ...directProof(childId, actorId, parentProofPatch) });
  const child = { id: childId, name: "李家子", gender: "male", genderSource: "CK3_LIVE_RELATIVE", parents };
  const actor = { id: actorId, name: "王氏正妻", gender: "female", parents: [] };
  return { actor, gameData: scope(new Map([[actorId, actor], [childId, child]])) };
}

function testStepChildAndWifeFacts() {
  const { actor, gameData } = makeStepChildFixture();
  const stepChild = buildStepFamilyFactBlock(actor, gameData, { query: "我的继子是谁？" });
  assert.equal(stepChild.handled, true, "step-child questions enter the step-family fact path");
  assert.match(stepChild.text, /当前继子：李家子/u, "verified current parents plus marriage identify a step-child");
  assert.match(stepChild.text, /不证明庶出身份/u, "a current legal marriage does not establish concubine birth");
  assert.equal(buildStepFamilyFactBlock(actor, gameData, { query: "庶子女是谁？" }).handled, true,
    "concubine-child questions receive an explicit evidence-bounded answer");
  assert.equal(buildStepFamilyFactBlock(actor, gameData, { query: "丈夫的孩子是谁？" }).handled, false,
    "unrelated parent queries are not intercepted by the step-family path");

  const stale = makeStepChildFixture({ marriagePatch: { sourceSnapshotId: "stale/1" } });
  const staleFact = buildStepFamilyFactBlock(stale.actor, stale.gameData, { query: "我的继子是谁？" });
  assert.doesNotMatch(staleFact.text, /当前继子：李家子/u, "stale marriage evidence cannot establish a current step-child");

  const unknownParent = makeStepChildFixture({ parentProofPatch: { publicStatus: "UNKNOWN" } });
  const unknownFact = buildStepFamilyFactBlock(unknownParent.actor, unknownParent.gameData, { query: "我的继子是谁？" });
  assert.doesNotMatch(unknownFact.text, /当前继子：李家子/u, "UNKNOWN direct parent evidence cannot establish a step-child");

  const biological = makeStepChildFixture({ actorIsParent: true });
  const biologicalFact = buildStepFamilyFactBlock(biological.actor, biological.gameData, { query: "我的继子是谁？" });
  assert.doesNotMatch(biologicalFact.text, /当前继子：李家子/u, "a verified direct parent is not reclassified as a step-parent");

  const wifeId = 40;
  const rootId = 41;
  const spouse = {
    id: wifeId, name: "父亲正妻", gender: "female", genderSource: "CK3_LIVE_RELATIVE", parentId: 10,
    sourceOwnerId: rootId, relationType: "CURRENT_SPOUSE", source: "CK3_PARENT_SPOUSE", sourceRelation: "parents.spouses",
    publicStatus: "PUBLIC_LEGAL_MARRIAGE", knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT
  };
  const parents = [
    { id: 10, name: "父亲", gender: "male", genderSource: "CK3_LIVE_RELATIVE", ...directProof(rootId, 10), spouses: [spouse] },
    { id: 11, name: "母亲", gender: "female", genderSource: "CK3_LIVE_RELATIVE", ...directProof(rootId, 11) }
  ];
  const root = { id: rootId, name: "本人", parents };
  const wifeFacts = buildStepFamilyFactBlock(root, scope(new Map([[rootId, root]])), { query: "父亲的正妻是谁？" });
  assert.match(wifeFacts.text, /父亲当前唯一记录的公开合法妻子（家庭称谓可称“正妻”）：父亲正妻/u);
  assert.match(wifeFacts.text, /不证明她是本人的已验证生母，也不证明本人属于庶子女/u,
    "a father's only current public wife does not imply biological maternity or concubine birth");
}

function testLabelsAndHistoricalSourceAllowlist() {
  assert.equal(resolveKinshipLabel({ type: "STEP_PARENT_OF", sex: "female" }), "继母");
  assert.equal(resolveKinshipLabel({ type: "STEP_CHILD_OF", sex: "male" }), "继子");
  assert.equal(resolveKinshipLabel({ type: "STEP_CHILD_OF", sex: "female" }), "继女");
  assert.equal(resolveKinshipLabel({ type: "STEP_CHILD_OF" }), "继子女");
  assert.equal(resolveKinshipLabel({ type: "STEP_SIBLING_OF", sex: "female", seniority: 1 }), "继姐");
  const stepBundle = buildFamilyEntityFactBundle({
    graph: {
      nodes: new Map([["20", { id: 20, name: "继子" }]]),
      relationBetween: () => ({ relation: { type: "STEP_CHILD_OF", label: "继子", structuredPath: [] } })
    },
    responderId: 10,
    relationAnchorId: 10,
    targetRuntimeId: 20
  });
  assert.equal(stepBundle.relationshipKind, "STEP", "family entity bundles retain the non-biological relation kind");

  const actor = { id: 70, parents: [{ id: 71, name: "伪造继母", gender: "female", genderSource: "CK3_LIVE_RELATIVE",
    relationshipKind: "STEP", source: "UNVERIFIED", sourceOwnerId: 70, childId: 70, relationType: "parent",
    sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN",
    campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT }] };
  const facts = buildStepFamilyFactBlock(actor, scope(new Map([[70, actor]])), { query: "我以前的继母是谁？" });
  assert.doesNotMatch(facts.text, /历史来源记载曾有伪造继母/u,
    "arbitrary non-empty source tags cannot be promoted to historical step-parent facts");
}

testAllDirectParentRoutesFailClosed();
testCurrentSaveLegalParentEvidence();
testOtherParentRoutesFailClosed();
testExplicitRevisionCacheExpiresNestedKidsProof();
testCacheTracksMarriageChanges();
testStepChildAndWifeFacts();
testLabelsAndHistoricalSourceAllowlist();
console.log("V9.3.9 kinship evidence, cache, step-family, and labels: PASS");
