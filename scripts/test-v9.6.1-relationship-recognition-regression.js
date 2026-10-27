"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Character } = require("../src/app/main/game-data/character");
const { createLogParser } = require("../src/app/main/game-data/log-parser");
const {
  currentBetrothalEvidenceFilter,
  currentFormerSpouseEvidenceFilter,
  currentSpouseEvidenceFilter
} = require("../src/app/main/worldline/canonical-spouse-record");
const { buildKinshipGraph, buildLegacyStructuralKinshipGraph } = require("../src/app/main/worldline/character-kinship-graph");
const { currentDirectParentFilter } = require("../src/app/main/worldline/kinship-graph-cache");
const { parseRelationIntent } = require("../src/app/main/worldline/relation-intent-parser");
const { resolveAnchoredRelationMention } = require("../src/app/main/worldline/anchored-relation-resolver");

class FixtureGameData {
  constructor(data) {
    this.playerID = Number(data[0]);
    this.date = String(data[4] || "");
    this.totalDays = Number(data[8]);
    this.characters = new Map();
  }
}

function characterLine(id, name, pronoun) {
  const fields = Array(28).fill("");
  Object.assign(fields, { 0: id, 1: name, 2: name, 4: pronoun, 5: "30", 8: "unknown", 18: name });
  return ["VOTC:IN", "character", ...fields].join("/;/");
}

async function parseFixture(lines) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v961-relation-"));
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

async function main() {
  const gameData = await parseFixture([
    "VOTC:IN/;/init/;/1/;/甲君/;/1/;/甲君/;/1178.1.1/;/conversation/;/宫廷/;/甲君/;/430000",
    "VOTC:CAMPAIGN/votc8c-123456789012",
    characterLine(1, "甲君", "he"),
    characterLine(2, "甲君长女", "she"),
    characterLine(3, "甲君长子", "he"),
    characterLine(4, "甲君姐姐", "she"),
    characterLine(7, "丙氏", "she"),
    characterLine(8, "丁氏", "she"),
    characterLine(10, "庚氏", "he"),
    characterLine(11, "丙子", "they"),
    "VOTC:IN/;/parents/;/1/;/6/;/甲君母/;/429000/;/1177.1.1/;/30/;/she/;/PUBLIC_LEGAL_PARENT",
    "VOTC:IN/;/parent_spouse/;/1/;/6/;/10/;/庚氏/;/he/;/PUBLIC_LEGAL_MARRIAGE/;/",
    "VOTC:IN/;/kids/;/1/;/2/;/甲君长女/;/she/;/430100/;/1178.1.1/;/12/;/PUBLIC_LEGAL_PARENT",
    "VOTC:IN/;/kid_betrothed/;/20/;/2/;/15/;/错 owner/;/he",
    "VOTC:IN/;/kid_betrothed/;/1/;/999/;/16/;/错 child/;/he",
    "VOTC:IN/;/kid_betrothed/;/1/;/2/;/5/;/乙氏/;/he",
    "VOTC:IN/;/kid_eob/;/1/;/2/;/",
    "VOTC:IN/;/kids/;/1/;/3/;/甲君长子/;/he/;/430200/;/1178.1.1/;/14/;/PUBLIC_LEGAL_PARENT",
    "VOTC:IN/;/kid_betrothed/;/1/;/3/;/7/;/丙氏/;/she",
    "VOTC:IN/;/kid_eob/;/1/;/3/;/",
    "VOTC:IN/;/kids/;/1/;/11/;/丙子/;/they/;/430300/;/1178.1.1/;/9/;/PUBLIC_LEGAL_PARENT",
    "VOTC:IN/;/kid_spouse/;/1/;/11/;/13/;/丁氏配偶/;/he/;/PUBLIC_LEGAL_MARRIAGE/;/",
    "VOTC:IN/;/kid_betrothed/;/1/;/11/;/14/;/戊氏配偶/;/she",
    "VOTC:IN/;/kid_eob/;/1/;/11/;/",
    "VOTC:IN/;/siblings/;/1/;/4/;/甲君姐姐/;/she/;/429000/;/1177.1.1/;/31/;/",
    "VOTC:IN/;/sibling_betrothed/;/1/;/4/;/99/;/戊氏/;/he",
    "VOTC:IN/;/sibling_eob/;/1/;/4/;/",
    "VOTC:IN/;/siblings/;/1/;/21/;/甲君弟/;/he/;/429100/;/1177.1.1/;/29/;/",
    "VOTC:IN/;/sibling_spouse/;/1/;/21/;/22/;/庚氏配偶/;/she/;/PUBLIC_LEGAL_MARRIAGE/;/",
    "VOTC:IN/;/sibling_eob/;/1/;/21/;/",
    "VOTC:IN/;/current_spouse/;/1/;/8/;/丁氏/;/she/;/PUBLIC_LEGAL_MARRIAGE/;/",
    "VOTC:IN/;/former_spouse/;/1/;/9/;/己氏/;/she/;/"
  ]);

  const owner = gameData.characters.get(1);
  const daughter = owner.children.find(item => Number(item.id) === 2);
  const son = owner.children.find(item => Number(item.id) === 3);
  const sibling = owner.siblings.find(item => Number(item.id) === 4);
  const statusConflictChild = owner.children.find(item => Number(item.id) === 11);
  const spouseSibling = owner.siblings.find(item => Number(item.id) === 21);
  const former = owner.formerSpouses.find(item => Number(item.id) === 9);
  const parentSpouse = owner.parents.find(item => Number(item.id) === 6).spouses[0];
  const betrothalFilter = currentBetrothalEvidenceFilter(gameData);
  const formerFilter = currentFormerSpouseEvidenceFilter(gameData);
  const spouseFilter = currentSpouseEvidenceFilter(gameData);

  assert.equal(daughter.betrothed.source, "CK3_CURRENT_BETROTHAL");
  assert.equal(daughter.betrothed.sourceOwnerId, 1);
  assert.equal(daughter.betrothed.sourceRelation, "kids.betrothed");
  assert.equal(daughter.betrothed.sourceSnapshotId, "1178.1.1/430000");
  assert.equal(daughter.betrothed.knowledgeStatus, "UNKNOWN");
  assert.equal(daughter.betrothed.targetBound, false);
  assert.equal(daughter.betrothed.gender, "male");
  assert.equal(daughter.betrothed.genderSource, "CK3_LIVE_RELATIVE");
  assert.equal(daughter.betrothed.sheHe, "he");
  assert.equal(sibling.betrothed.sourceRelation, "siblings.betrothed");
  assert.equal(sibling.betrothed.targetBound, false);
  assert.equal(statusConflictChild.betrothed.evidenceConflict, true);
  assert.equal(former.source, "CK3_FORMER_SPOUSE");
  assert.equal(former.historicalStatus, "FORMER");
  assert.equal(former.targetBound, false);
  assert.equal(owner.spouses[0].source, "CK3_GAME_CURRENT_SPOUSE");
  assert.equal(owner.spouses[0].targetBound, true);
  assert.equal(spouseFilter(statusConflictChild.spouses[0], { sourceOwnerId: 1, relatedCharacterId: 11, targetId: 13, sourceRelation: "kids.spouses" }), true);
  assert.equal(spouseFilter(spouseSibling.spouses[0], { sourceOwnerId: 1, relatedCharacterId: 21, targetId: 22, sourceRelation: "siblings.spouses" }), true);
  assert.equal(parentSpouse.source, "CK3_PARENT_SPOUSE");
  assert.equal(parentSpouse.relatedCharacterId, 6);
  assert.equal(parentSpouse.targetBound, true);

  assert.equal(betrothalFilter(daughter.betrothed, { sourceOwnerId: 1, relatedCharacterId: 2, targetId: 5, sourceRelation: "kids.betrothed" }), true);
  assert.equal(betrothalFilter(sibling.betrothed, { sourceOwnerId: 1, relatedCharacterId: 4, targetId: 99, sourceRelation: "siblings.betrothed" }), true);
  assert.equal(betrothalFilter(statusConflictChild.betrothed, { sourceOwnerId: 1, relatedCharacterId: 11, targetId: 14, sourceRelation: "kids.betrothed" }), false);
  assert.equal(betrothalFilter({ ...daughter.betrothed, sourceSnapshotId: "stale" }, { sourceOwnerId: 1, relatedCharacterId: 2, targetId: 5, sourceRelation: "kids.betrothed" }), false);
  assert.equal(betrothalFilter({ ...daughter.betrothed, campaignToken: "votc8c-000000000000" }, { sourceOwnerId: 1, relatedCharacterId: 2, targetId: 5, sourceRelation: "kids.betrothed" }), false);
  assert.equal(formerFilter(former, { sourceOwnerId: 1, targetId: 9 }), true);
  assert.equal(formerFilter({ ...former, sourceSnapshotId: "stale" }, { sourceOwnerId: 1, targetId: 9 }), false);
  assert.equal(spouseFilter(owner.spouses[0], { sourceOwnerId: 1, relatedCharacterId: 1, targetId: 8, sourceRelation: "spouses" }), true);
  assert.equal(spouseFilter(parentSpouse, { sourceOwnerId: 1, relatedCharacterId: 6, targetId: 10, sourceRelation: "parents.spouses" }), true);
  assert.equal(spouseFilter({ ...parentSpouse, sourceSnapshotId: "stale" }, { sourceOwnerId: 1, relatedCharacterId: 6, targetId: 10, sourceRelation: "parents.spouses" }), false);

  const noSiblingAgeData = { ...gameData, characters: new Map(gameData.characters) };
  noSiblingAgeData.characters.set(1, { ...owner, siblings: [{ ...sibling, ageSource: null, evidence: null }] });
  const noSiblingAgeFilter = currentBetrothalEvidenceFilter(noSiblingAgeData);
  assert.equal(noSiblingAgeFilter(sibling.betrothed, { sourceOwnerId: 1, relatedCharacterId: 4, targetId: 99, sourceRelation: "siblings.betrothed" }), false);

  const graph = buildKinshipGraph(gameData.characters, {
    directParentEvidenceFilter: currentDirectParentFilter(gameData),
    currentSpouseEvidenceFilter: spouseFilter,
    formerSpouseEvidenceFilter: formerFilter,
    betrothalEvidenceFilter: betrothalFilter
  });
  assert.equal(resolveAnchoredRelationMention({ query: "我女儿的未婚夫是谁？", responderId: 1, graph }).status,
    "RELATION_AMBIGUOUS", "an additional unknown-sex child prevents a unique daughter selection");
  const queryCharacters = new Map(gameData.characters);
  queryCharacters.delete(11);
  queryCharacters.set(1, { ...owner, children: owner.children.filter(child => Number(child.id) !== 11) });
  const queryGraph = buildKinshipGraph(queryCharacters, {
    directParentEvidenceFilter: currentDirectParentFilter(gameData), currentSpouseEvidenceFilter: spouseFilter,
    formerSpouseEvidenceFilter: formerFilter, betrothalEvidenceFilter: betrothalFilter
  });
  const daughterIntent = parseRelationIntent("我女儿的未婚夫是谁？");
  assert.deepStrictEqual(daughterIntent.relationTypes, ["BETROTHED_TO"]);
  assert.equal(daughterIntent.anchorMode, "RESPONDER_CHILD");
  assert.equal(daughterIntent.anchorSexConstraint, "female");
  assert.equal(daughterIntent.sexConstraint, "male");
  const daughterResult = resolveAnchoredRelationMention({ query: "我女儿的未婚夫是谁？", responderId: 1, graph: queryGraph });
  assert.equal(daughterResult.status, "RELATION_RESOLVED");
  assert.equal(daughterResult.relationAnchorRuntimeId, "2");
  assert.equal(daughterResult.targetRuntimeId, "5");
  assert.equal(daughterResult.relation.type, "BETROTHED_TO");
  assert.equal(daughterResult.relation.label, "未婚夫");
  assert.equal(graph.nodes.get("5").partial, true);
  assert.equal(graph.nodes.get("5").gender, "male");
  assert.equal(graph.relationBetweenOfTypes("13", "11", ["SPOUSE_OF"]).relation.type, "SPOUSE_OF");
  assert.equal(graph.relationBetweenOfTypes("22", "21", ["SPOUSE_OF"]).relation.type, "SPOUSE_OF");

  const sonResult = resolveAnchoredRelationMention({ query: "我儿子的未婚妻是谁？", responderId: 1, graph: queryGraph });
  assert.equal(sonResult.status, "RELATION_RESOLVED");
  assert.equal(sonResult.relationAnchorRuntimeId, "3");
  assert.equal(sonResult.targetRuntimeId, "7");
  assert.equal(sonResult.relation.label, "未婚妻");
  assert.equal(resolveAnchoredRelationMention({ query: "我的孩子与谁订婚？", responderId: 1, graph }).status, "RELATION_AMBIGUOUS");
  assert.equal(graph.relationBetweenOfTypes("5", "2", ["SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"]).relation, null);
  assert.equal(graph.relationBetweenOfTypes("99", "4", ["BETROTHED_TO"]).relation.type, "BETROTHED_TO");
  assert.equal(graph.relationBetweenOfTypes("99", "4", ["SPOUSE_OF", "FORMER_SPOUSE_OF"]).relation, null);
  assert.equal(graph.relationBetweenOfTypes("9", "1", ["FORMER_SPOUSE_OF"]).relation.type, "FORMER_SPOUSE_OF");

  const unverifiedFormerGraph = buildKinshipGraph({ 1: { id: 1, fullName: "甲君", formerSpouses: [{ id: 9, name: "己氏" }] }, 9: { id: 9, fullName: "己氏" } });
  assert.equal(unverifiedFormerGraph.relationBetweenOfTypes("9", "1", ["FORMER_SPOUSE_OF"]).relation, null);
  const legacyStructuralGraph = buildLegacyStructuralKinshipGraph({ 1: { id: 1, fullName: "甲君", formerSpouses: [{ id: 9, name: "己氏" }] }, 9: { id: 9, fullName: "己氏" } });
  assert.equal(legacyStructuralGraph.relationBetweenOfTypes("9", "1", ["FORMER_SPOUSE_OF"]).relation.type, "FORMER_SPOUSE_OF");
  const noMarriageGraph = buildKinshipGraph({ 1: { id: 1, alive: false, deathDate: "1177.1.1" }, 9: { id: 9, alive: false, deathDate: "1177.1.1" } });
  assert.equal(noMarriageGraph.relationBetweenOfTypes("9", "1", ["FORMER_SPOUSE_OF"]).relation, null);

  const conflictCharacters = new Map(gameData.characters);
  conflictCharacters.set(1, { ...owner, spouses: [...owner.spouses, { id: 9, name: "己氏" }] });
  const conflictGraph = buildKinshipGraph(conflictCharacters, {
    directParentEvidenceFilter: currentDirectParentFilter(gameData),
    currentSpouseEvidenceFilter: spouseFilter,
    formerSpouseEvidenceFilter: formerFilter,
    betrothalEvidenceFilter: betrothalFilter
  });
  const conflict = conflictGraph.relationBetweenOfTypes("9", "1", ["FORMER_SPOUSE_OF"]);
  assert.equal(conflict.relation, null);
  assert.equal(conflict.diagnostic.code, "RELATION_CONFLICT_EVIDENCE");

  const duplicateFormerData = { ...gameData, characters: new Map(gameData.characters) };
  duplicateFormerData.characters.set(1, { ...owner, formerSpouses: [former, { ...former, sourceSnapshotId: "stale" }] });
  const duplicateFormerGraph = buildKinshipGraph(duplicateFormerData.characters, {
    currentSpouseEvidenceFilter: currentSpouseEvidenceFilter(duplicateFormerData),
    formerSpouseEvidenceFilter: currentFormerSpouseEvidenceFilter(duplicateFormerData),
    betrothalEvidenceFilter: currentBetrothalEvidenceFilter(duplicateFormerData)
  });
  const duplicateFormer = duplicateFormerGraph.relationBetweenOfTypes("9", "1", ["FORMER_SPOUSE_OF"]);
  assert.equal(duplicateFormer.relation, null);
  assert.equal(duplicateFormer.diagnostic.code, "RELATION_CONFLICT_EVIDENCE");

  const duplicateCurrentData = { ...gameData, characters: new Map(gameData.characters) };
  duplicateCurrentData.characters.set(1, { ...owner, spouses: [owner.spouses[0], { ...owner.spouses[0], sourceSnapshotId: "stale" }] });
  const duplicateCurrentGraph = buildKinshipGraph(duplicateCurrentData.characters, {
    currentSpouseEvidenceFilter: currentSpouseEvidenceFilter(duplicateCurrentData),
    formerSpouseEvidenceFilter: currentFormerSpouseEvidenceFilter(duplicateCurrentData),
    betrothalEvidenceFilter: currentBetrothalEvidenceFilter(duplicateCurrentData)
  });
  const duplicateCurrent = duplicateCurrentGraph.relationBetweenOfTypes("8", "1", ["SPOUSE_OF"]);
  assert.equal(duplicateCurrent.relation, null);
  assert.equal(duplicateCurrent.diagnostic.code, "RELATION_CONFLICT_EVIDENCE");

  const alternateBetrothal = {
    ...sibling.betrothed,
    id: 100,
    name: "另一个对象",
    sheHe: "she",
    gender: "female",
    sourceOwnerId: 20,
    relatedCharacterId: 4,
    observerRuntimeId: 20,
    targetBound: false
  };
  const alternateSibling = {
    ...sibling,
    betrothed: alternateBetrothal,
    evidence: { age: sibling.evidence.age.map(evidence => ({ ...evidence, sourceOwnerId: 20, source: "20.siblings" })) }
  };
  const multiplePartnerData = { ...gameData, characters: new Map(gameData.characters) };
  multiplePartnerData.characters.set(20, { id: 20, fullName: "乙君", siblings: [alternateSibling] });
  const multiplePartnerGraph = buildKinshipGraph(multiplePartnerData.characters, {
    currentSpouseEvidenceFilter: currentSpouseEvidenceFilter(multiplePartnerData),
    formerSpouseEvidenceFilter: currentFormerSpouseEvidenceFilter(multiplePartnerData),
    betrothalEvidenceFilter: currentBetrothalEvidenceFilter(multiplePartnerData)
  });
  for (const partnerId of ["99", "100"]) {
    for (const direction of [[partnerId, "4"], ["4", partnerId]]) {
      const conflict = multiplePartnerGraph.relationBetweenOfTypes(direction[0], direction[1], ["BETROTHED_TO"]);
      assert.equal(conflict.relation, null);
      assert.equal(conflict.diagnostic.code, "RELATION_CONFLICT_EVIDENCE");
    }
  }

  const staleDuplicateEvidence = {
    ...sibling.betrothed,
    sourceOwnerId: 20,
    observerRuntimeId: 20,
    sourceSnapshotId: "stale"
  };
  const staleDuplicateSibling = {
    ...sibling,
    betrothed: staleDuplicateEvidence,
    evidence: { age: sibling.evidence.age.map(evidence => ({ ...evidence, sourceOwnerId: 20, source: "20.siblings" })) }
  };
  const staleDuplicateData = { ...gameData, characters: new Map(gameData.characters) };
  staleDuplicateData.characters.set(20, { id: 20, fullName: "乙君", siblings: [staleDuplicateSibling] });
  const staleDuplicateGraph = buildKinshipGraph(staleDuplicateData.characters, {
    currentSpouseEvidenceFilter: currentSpouseEvidenceFilter(staleDuplicateData),
    formerSpouseEvidenceFilter: currentFormerSpouseEvidenceFilter(staleDuplicateData),
    betrothalEvidenceFilter: currentBetrothalEvidenceFilter(staleDuplicateData)
  });
  for (const direction of [["99", "4"], ["4", "99"]]) {
    const conflict = staleDuplicateGraph.relationBetweenOfTypes(direction[0], direction[1], ["BETROTHED_TO"]);
    assert.equal(conflict.relation, null);
    assert.equal(conflict.diagnostic.code, "RELATION_CONFLICT_EVIDENCE");
  }

  console.log("V9.6.1 relationship recognition regression: PASS");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
