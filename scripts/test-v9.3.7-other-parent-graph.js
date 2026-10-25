"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLogParser } = require("../src/app/main/game-data/log-parser");
const { createRelationshipResolver } = require("../src/app/main/game-data/relationship-resolver");
const { buildKinshipGraph } = require("../src/app/main/worldline/character-kinship-graph");
const { currentPublicParentFilter, currentDirectParentFilter } = require("../src/app/main/worldline/kinship-graph-cache");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");

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
    this.parents = [];
    this.children = [];
    this.siblings = [];
    this.secrets = [];
  }
}

async function parseFixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v937-other-parent-"));
  const logPath = path.join(dir, "debug.log");
  fs.writeFileSync(logPath, `${lines.join("\n")}\n`, "utf8");
  const parser = createLogParser({ GameData: FixtureGameData, Character: FixtureCharacter });
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await parser(logPath);
  } finally {
    console.log = originalLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertParentEdge(graph, parentId, childId) {
  const relation = graph.relationBetween(parentId, childId).relation;
  assert.equal(relation?.type, "PARENT_OF", `${parentId} should be a parent of ${childId}`);
  return relation;
}

async function main() {
  const gameData = await parseFixture([
    "VOTC:IN/;/init/;/1/;/玩家/;/2/;/NPC/;/1080年1月1日/;/Scene: testing/;/长安/;/长安/;/10000",
    "VOTC:CAMPAIGN/votc8c-202610170001",
    "VOTC:IN/;/character/;/1/;/共同父亲",
    "VOTC:IN/;/kids/;/1/;/101/;/妻生子/;/他/;/12000/;/1047年1月1日/;//;/PUBLIC_LEGAL_PARENT",
    "VOTC:IN/;/kid_other_parent/;/1/;/999/;/9/;/错误挂接/;/PUBLIC_LEGAL_PARENT/;/她",
    "VOTC:IN/;/kid_other_parent/;/1/;/101/;/2/;/妻子/;/PUBLIC_LEGAL_PARENT/;/她",
    "VOTC:IN/;/kid_eob/;/1/;/101/;/",
    "VOTC:IN/;/kids/;/1/;/102/;/妾生子/;/他/;/13000/;/1050年1月1日/;//;/PUBLIC_LEGAL_PARENT",
    "VOTC:IN/;/kid_other_parent/;/1/;/102/;/3/;/妾室",
    "VOTC:IN/;/kid_eob/;/1/;/102/;/",
    "VOTC:IN/;/siblings/;/1/;/103/;/同父异母兄弟/;/他/;/14000/;/1055年1月1日/;/",
    "VOTC:IN/;/sibling_other_parent/;/1/;/103/;/4/;/另一位父亲/;/UNKNOWN/;/他",
    "VOTC:IN/;/sibling_eob/;/1/;/103/;/"
  ]);

  const root = gameData.characters.get(1);
  assert.deepEqual(root.children[0].otherParent, {
    id: 2,
    otherParentId: 2,
    name: "妻子",
    parentGender: "female",
    sourceOwnerId: 1,
    relationType: "parent",
    source: "CK3_OTHER_PARENT",
    sourceRelation: "kids.otherParent",
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken: "votc8c-202610170001",
    sourceSnapshotId: "1080年1月1日/10000"
  }, "kid_other_parent is bound to the current child and keeps explicit source metadata");
  assert.equal(root.siblings[0].otherParent.otherParentId, 4, "sibling_other_parent is parsed on the sibling record");
  assert.equal(root.siblings[0].otherParent.publicStatus, "UNKNOWN", "missing public marker stays unknown");
  assert.equal(root.siblings[0].otherParent.parentGender, "male", "parent gender comes from the CK3 pronoun export");

  const relativeAge = {
    value: 17,
    ageSource: "CK3_LIVE_RELATIVE_AGE",
    sourceOwnerId: 1,
    relationType: "child",
    source: "1.children",
    campaignToken: gameData.campaignToken,
    sourceSnapshotId: `${gameData.date}/${gameData.totalDays}`
  };
  root.children[0].age = relativeAge.value;
  root.children[0].ageSource = relativeAge.ageSource;
  root.children[0].evidence = { age: [relativeAge] };

  const resolver = createRelationshipResolver({ onDiagnostic: () => false });
  const profiles = resolver.buildCanonicalProfiles(gameData.characters, gameData.totalDays, () => "unknown", {
    campaignToken: gameData.campaignToken,
    sourceSnapshotId: `${gameData.date}/${gameData.totalDays}`
  });
  const childOneEvidence = profiles.get(101)?.evidence?.otherParentRelations;
  const childTwoEvidence = profiles.get(102)?.evidence?.otherParentRelations;
  const siblingEvidence = profiles.get(103)?.evidence?.otherParentRelations;
  assert.ok(childOneEvidence?.some((item) => item.parentId === 2), "resolver should retain child.otherParent as parent evidence");
  assert.ok(childTwoEvidence?.some((item) => item.parentId === 3), "resolver should retain each child's distinct other parent");
  assert.ok(siblingEvidence?.some((item) => item.parentId === 4), "sibling.otherParent belongs to the sibling, not the source owner");
  assert.equal(childOneEvidence[0].sourceSnapshotId, "1080年1月1日/10000");
  assert.equal(childOneEvidence[0].campaignToken, "votc8c-202610170001");
  assert.equal(childOneEvidence[0].parentGender, "female");
  assert.equal(profiles.get(101).age, 17, "a correctly bound current relative-age record is accepted");
  assert.equal(profiles.get(101).evidence.age[0].sourceSnapshotId, relativeAge.sourceSnapshotId, "the resolver preserves age provenance");
  assert.equal(resolver.buildCanonicalProfiles(gameData.characters, gameData.totalDays, () => "unknown", {
    campaignToken: "votc8c-202610170002",
    sourceSnapshotId: relativeAge.sourceSnapshotId
  }).get(101).age, null, "a relative age from another Campaign is rejected");

  for (const invalid of [{ sourceOwnerId: 0 }, { childId: 999 }, { relationType: "spouse" },
    { source: "UNVERIFIED" }, { sourceRelation: "siblings.otherParent" }]) {
    const badOwner = { ...root, children: [{ ...root.children[0], otherParent: { ...root.children[0].otherParent, ...invalid } }], siblings: [] };
    const badProfiles = resolver.buildCanonicalProfiles(new Map([[1, badOwner]]), gameData.totalDays, () => "unknown");
    assert.deepEqual(badProfiles.get(101).evidence.otherParentRelations, [], "normalization must not launder invalid parent bindings");
  }

  const currentEvidenceFilters = { otherParentEvidenceFilter: currentPublicParentFilter(gameData),
    directParentEvidenceFilter: currentDirectParentFilter(gameData) };
  const graph = buildKinshipGraph(profiles, currentEvidenceFilters);
  const rawGraph = buildKinshipGraph(gameData.characters, currentEvidenceFilters);
  assertParentEdge(graph, 1, 101);
  assertParentEdge(graph, 1, 102);
  assertParentEdge(graph, 2, 101);
  assert.equal(graph.relationBetween(3, 102).relation, null, "an unmarked other parent stays unknown");
  assert.equal(graph.relationBetween(4, 103).relation, null, "an UNKNOWN sibling other parent cannot enter the current graph");
  assertParentEdge(rawGraph, 2, 101);
  assert.equal(rawGraph.relationBetween(4, 103).relation, null, "raw profiles use the same public/source filter");
  assert.equal(graph.relationBetween(101, 102).relation?.type, "SIBLING_OF", "the shared father still derives the sibling edge");
  assert.equal(graph.relationBetween(2, 3).relation, null, "different mothers do not acquire a spouse or kinship edge");
  assert.equal(graph.relationBetween(4, 1).relation, null, "sibling_other_parent must never attach the other parent to the root");

  for (const [parentId, childId, sourceRelation] of [[2, 101, "kids.otherParent"]]) {
    const relation = assertParentEdge(graph, parentId, childId);
    assert.ok(relation.parentEvidence?.some((evidence) => evidence.childId === String(childId)
      && evidence.parentId === String(parentId)
      && evidence.sourceOwnerId === "1"
      && evidence.source === "CK3_OTHER_PARENT"
      && evidence.sourceRelation === sourceRelation
      && evidence.otherParentId === String(parentId)
      && evidence.publicStatus === "PUBLIC_LEGAL_PARENT"
      && evidence.sourceSnapshotId === "1080年1月1日/10000"
      && evidence.campaignToken === "votc8c-202610170001"
      && evidence.knowledgeStatus === "UNKNOWN"), "edge should expose bounded source and unknown visibility/knowledge evidence");
  }

  const memorySafeGraph = buildKinshipGraph(profiles, { ...currentEvidenceFilters, includeOtherParents: false });
  assert.equal(memorySafeGraph.relationBetween(2, 101).relation, null, "callers can exclude other-parent edges from memory authorization");
  assert.equal(memorySafeGraph.relationBetween(1, 101).relation?.type, "PARENT_OF", "excluding extra edges preserves the existing graph");

  const isolatedOtherParentRecords = new Map([
    [10, { id: 10, siblings: [{ id: 21, otherParent: { id: 90, sourceOwnerId: 10, relationType: "parent", source: "CK3_OTHER_PARENT", sourceRelation: "siblings.otherParent" } }] }],
    [11, { id: 11, siblings: [{ id: 22, otherParent: { id: 90, sourceOwnerId: 11, relationType: "parent", source: "CK3_OTHER_PARENT", sourceRelation: "siblings.otherParent" } }] }]
  ]);
  const memoryGraphWithoutOtherParents = buildKinshipGraph(isolatedOtherParentRecords, { includeOtherParents: false });
  assert.equal(memoryGraphWithoutOtherParents.relationBetween(90, 21).relation, null, "memory graph excludes other-parent edges");
  assert.equal(memoryGraphWithoutOtherParents.relationBetween(21, 22).relation, null, "excluded other parents cannot derive a new sibling authorization edge");
  assert.equal(buildKinshipGraph(isolatedOtherParentRecords).relationBetween(21, 22).relation, null,
    "other-parent evidence without current campaign/snapshot context cannot derive sibling authorization");

  const stalePublicParent = { ...root.children[0].otherParent, campaignToken: "old-campaign", sourceSnapshotId: "old-date/1" };
  const promptCharacter = {
    id: 1,
    name: "共同父亲",
    children: [{ id: 101, name: "妻生子", directParentEvidence: root.children[0].directParentEvidence, otherParent: stalePublicParent }],
    evidence: {
      canonicalCharacter: { id: 1, name: "共同父亲", children: [{ id: 101, name: "妻生子",
        directParentEvidence: root.children[0].directParentEvidence, otherParent: stalePublicParent }] },
      otherParentRelations: [{ childId: 101, parentId: 2, otherParentId: 2, parentName: "旧战役配偶", sourceOwnerId: 1,
        relationType: "parent", source: "CK3_OTHER_PARENT", sourceRelation: "kids.otherParent", publicStatus: "PUBLIC_LEGAL_PARENT",
        knowledgeStatus: "UNKNOWN", campaignToken: "old-campaign", sourceSnapshotId: "old-date/1" }]
    }
  };
  const promptView = createTraitProfileView({ ...gameData, characters: new Map([[1, root]]), campaignToken: gameData.campaignToken }, promptCharacter).character;
  assert.equal(promptView.children[0].otherParent, undefined, "a stale public raw parent record is removed from the prompt projection");
  assert.equal(promptView.evidence.canonicalCharacter.children[0].otherParent, undefined, "the canonicalCharacter alias cannot bypass raw-record freshness filtering");
  assert.deepEqual(promptView.evidence.otherParentRelations, [], "stale normalized public evidence is removed from the prompt projection");

  const currentPublicParent = { ...root.children[0].otherParent, sourceOwnerId: 1, campaignToken: gameData.campaignToken,
    sourceSnapshotId: `${gameData.date}/${gameData.totalDays}` };
  const currentPromptView = createTraitProfileView({ ...gameData, characters: new Map([[1, root]]) }, {
    ...promptCharacter,
    children: [{ id: 101, name: "妻生子", directParentEvidence: root.children[0].directParentEvidence, otherParent: currentPublicParent }],
    evidence: { ...promptCharacter.evidence, otherParentRelations: [{ ...promptCharacter.evidence.otherParentRelations[0],
      sourceOwnerId: 1, campaignToken: gameData.campaignToken, sourceSnapshotId: `${gameData.date}/${gameData.totalDays}` }] }
  }).character;
  assert.equal(currentPromptView.children[0].otherParent?.id, currentPublicParent.id, "current public parent identity binding remains available to the prompt projection");
  assert.equal(currentPromptView.children[0].otherParent?.name, "未获知姓名的人物", "a public parent edge does not disclose an unknown co-parent name");
  assert.equal(currentPromptView.evidence.otherParentRelations[0]?.parentId, 2, "current public normalized parent evidence keeps its identity binding");
  assert.equal(currentPromptView.evidence.otherParentRelations[0]?.parentName, "未获知姓名的人物", "normalized evidence does not bypass the co-parent name gate");
  const unknownPromptView = createTraitProfileView({ ...gameData, characters: new Map([[1, root]]) }, {
    ...promptCharacter,
    children: [{ id: 101, name: "妻生子", directParentEvidence: root.children[0].directParentEvidence,
      otherParent: { ...currentPublicParent, name: "秘密母亲", publicStatus: "UNKNOWN" } }],
    evidence: { ...promptCharacter.evidence, otherParentRelations: [{ ...promptCharacter.evidence.otherParentRelations[0],
      parentName: "秘密母亲", sourceOwnerId: 1, publicStatus: "UNKNOWN", campaignToken: gameData.campaignToken,
      sourceSnapshotId: `${gameData.date}/${gameData.totalDays}` }] }
  }).character;
  assert.equal(unknownPromptView.children[0].otherParent, undefined, "current but unknown parent data stays hidden from the prompt projection");
  assert.equal(unknownPromptView.evidence.canonicalCharacter.children[0].otherParent, undefined, "unknown data stays hidden through the canonicalCharacter alias");
  assert.deepEqual(unknownPromptView.evidence.otherParentRelations, [], "unknown normalized evidence stays hidden from the prompt projection");

  const explicitPublic = new Map(profiles);
  explicitPublic.set(101, {
    ...profiles.get(101),
    evidence: {
      ...profiles.get(101).evidence,
      otherParentRelations: profiles.get(101).evidence.otherParentRelations.map((item) => ({ ...item, publicStatus: "PUBLIC_LEGAL_PARENT" }))
    }
  });
  const publicRelation = assertParentEdge(buildKinshipGraph(explicitPublic, currentEvidenceFilters), 2, 101);
  assert.equal(publicRelation.parentEvidence[0].publicStatus, "PUBLIC_LEGAL_PARENT", "explicit public legal-parent evidence is preserved");
  assert.equal(publicRelation.parentEvidence[0].knowledgeStatus, "UNKNOWN", "public parentage does not claim NPC knowledge");
  assert.equal(graph.nodes.get("2").gender, "female", "a restricted parent node only receives gender supported by the CK3 export");
  assert.equal(graph.nodes.has("4"), false, "UNKNOWN sibling parent evidence cannot create a parent node");
  assert.equal(graph.nodes.get("2").partial, true, "an unprofiled parent stays a restricted node");
  assert.equal(graph.nodes.get("2").age, undefined, "restricted parent nodes gain no age");
  assert.equal(graph.nodes.get("2").traits, undefined, "restricted parent nodes gain no traits");
  assert.equal(graph.nodes.get("2").memories, undefined, "restricted parent nodes gain no memory data");
  assert.equal(assertParentEdge(graph, 2, 101).parentEvidence.length, 1, "raw and normalized duplicate evidence deduplicates exactly");

  const evidenceOnlyProfiles = new Map([...profiles].map(([id, profile]) => [id, { ...profile, children: [], siblings: [] }]));
  assertParentEdge(buildKinshipGraph(evidenceOnlyProfiles, currentEvidenceFilters), 2, 101);
  const mismatchedEvidenceProfiles = new Map(evidenceOnlyProfiles);
  const child101Profile = mismatchedEvidenceProfiles.get(101);
  mismatchedEvidenceProfiles.set(101, {
    ...child101Profile,
    evidence: {
      ...child101Profile.evidence,
      otherParentRelations: child101Profile.evidence.otherParentRelations.map((item) => ({ ...item, sourceOwnerId: 999 }))
    }
  });
  assert.equal(buildKinshipGraph(mismatchedEvidenceProfiles, currentEvidenceFilters).relationBetween(2, 101).relation, null,
    "normalized other-parent evidence must bind to the child profile's source owner relation");
  const wrongRelationEvidenceProfiles = new Map(evidenceOnlyProfiles);
  wrongRelationEvidenceProfiles.set(101, {
    ...child101Profile,
    evidence: {
      ...child101Profile.evidence,
      otherParentRelations: child101Profile.evidence.otherParentRelations.map((item) => ({ ...item, sourceRelation: "siblings.otherParent" }))
    }
  });
  assert.equal(buildKinshipGraph(wrongRelationEvidenceProfiles, currentEvidenceFilters).relationBetween(2, 101).relation, null,
    "normalized other-parent evidence must match its child/sibling relation source");

  const invalidReferencesGraph = buildKinshipGraph({ 20: {
    id: 20,
    children: [
      { id: 21, name: "零值父母", otherParent: { id: 0, name: "零" } },
      { id: 22, name: "姓名父母", otherParent: { name: "仅有姓名" } },
      { id: 23, name: "自指父母", otherParent: { id: 23, name: "自己" } }
    ]
  } });
  assert.equal(invalidReferencesGraph.nodes.has("0"), false, "zero IDs cannot create other-parent nodes");
  assert.equal([...invalidReferencesGraph.nodes.values()].some((node) => node.name === "仅有姓名"), false, "name-only references cannot create identity nodes");
  assert.equal(invalidReferencesGraph.relationBetween(23, 23).relation, null, "self edges are rejected");

  const mismatchedBindingsGraph = buildKinshipGraph({ 30: {
    id: 30,
    children: [
      { id: 31, otherParent: { id: 91, sourceOwnerId: 300, sourceRelation: "kids.otherParent", publicStatus: "PUBLIC_LEGAL_PARENT" } },
      { id: 32, otherParent: { id: 92, childId: 320, sourceOwnerId: 30, sourceRelation: "kids.otherParent", publicStatus: "PUBLIC_LEGAL_PARENT" } },
      { id: 33, otherParent: { id: 93, sourceOwnerId: 30, sourceRelation: "siblings.otherParent", publicStatus: "PUBLIC_LEGAL_PARENT" } }
    ]
  } });
  assert.equal(mismatchedBindingsGraph.relationBetween(91, 31).relation, null, "a mismatched source owner cannot create a parent edge");
  assert.equal(mismatchedBindingsGraph.relationBetween(92, 32).relation, null, "a mismatched child ID cannot create a parent edge");
  assert.equal(mismatchedBindingsGraph.relationBetween(93, 33).relation, null, "the source relation must match the child/sibling record that carried it");

  console.log("V9.3.7 other-parent graph: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
