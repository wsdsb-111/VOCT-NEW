"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { Character, inferGenderFromPronoun } = require("../src/app/main/game-data/character");
const { createLogParser } = require("../src/app/main/game-data/log-parser");
const { createRelationshipResolver } = require("../src/app/main/game-data/relationship-resolver");
const { parseGameState } = require("../src/app/main/worldline/game-state-adapter");
const { diagnoseAgeLayers, resolveCharacterAge } = require("../src/app/main/worldline/character-age-service");
const { buildKinshipGraph } = require("../src/app/main/worldline/character-kinship-graph");
const { currentDirectParentFilter, currentPublicParentFilter } = require("../src/app/main/worldline/kinship-graph-cache");
const { AGE_DIAGNOSTIC_STAGES, collectAgeDiagnostic } = require("../src/app/main/worldline/age-diagnostics");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");

const CAMPAIGN = "votc8c-123456789012";
const DATE = "1190年5月2日";
const TOTAL_DAYS = 100;
const SNAPSHOT = `${DATE}/${TOTAL_DAYS}`;

function line(type, rootId, fields, trailing = true) {
  return `VOTC:IN/;/${type}/;/${[rootId, ...fields].join("/;/")}${trailing ? "/;/" : ""}`;
}

function characterLine(id, age) {
  const fields = Array(28).fill("");
  fields[0] = String(id);
  fields[1] = `角色${id}`;
  fields[2] = `角色${id}全名`;
  fields[3] = "头衔";
  fields[4] = "he";
  fields[5] = String(age);
  return `VOTC:IN/;/character/;/${fields.join("/;/")}`;
}

async function parseSyntheticLog(lines) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v9.3.9-age-parser-"));
  const fixturePath = path.join(fixtureRoot, "debug.log");
  fs.writeFileSync(fixturePath, `${lines.join(os.EOL)}${os.EOL}`, "utf8");
  class TestGameData {
    constructor(data) {
      this.playerID = Number(data[0]);
      this.date = data[4];
      this.totalDays = Number(data[8]);
      this.characters = new Map();
    }
  }
  const parseLog = createLogParser({ GameData: TestGameData, Character });
  const previousLog = console.log;
  console.log = () => {};
  try {
    return await parseLog(fixturePath);
  } finally {
    console.log = previousLog;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function testAgeLayerDiagnosis() {
  const stages = ["ck3Panel", "rawCharacter", "parsedCharacter", "canonicalProfile", "resolvedAge", "familyFact", "prompt", "modelAnswer"];
  const codes = [null, "RAW_CK3_AGE_MISMATCH", "PARSER_AGE_MISMATCH", "PROFILE_AGE_MISMATCH",
    "AGE_SOURCE_SELECTION_MISMATCH", "FAMILY_BUNDLE_AGE_MISMATCH", "PROMPT_AGE_MISMATCH", "MODEL_ANSWER_MISMATCH"];
  for (let index = 1; index < stages.length; index++) {
    const observations = stages.slice(0, index + 1).map((stage, stageIndex) => ({ stage, age: stageIndex === index ? 18 : 17 }));
    const result = diagnoseAgeLayers(observations);
    assert.strictEqual(result.status, "MISMATCH");
    assert.strictEqual(result.diagnosticCode, codes[index]);
    assert.strictEqual(result.firstMismatchStage, stages[index]);
    assert.strictEqual(result.previousAge, 17);
    assert.strictEqual(result.observedAge, 18);
  }
  assert.strictEqual(diagnoseAgeLayers([
    { stage: "ck3Panel", age: 17 }, { stage: "parsedCharacter", age: 18 }
  ]).status, "INCOMPLETE", "a skipped layer must not be reported as the first mismatch");
  assert.strictEqual(diagnoseAgeLayers([
    { stage: "rawCharacter", age: 17 }, { stage: "parsedCharacter", age: null }
  ]).status, "INCOMPLETE", "unknown age remains unknown rather than becoming a mismatch");
  assert.strictEqual(diagnoseAgeLayers([
    { stage: "rawCharacter", age: "1e2" }, { stage: "parsedCharacter", age: 100 }
  ]).status, "INCOMPLETE", "non-decimal raw ages are not normalized into a diagnostic value");
  const partialMatch = diagnoseAgeLayers([
    { stage: "rawCharacter", age: 17 }, { stage: "parsedCharacter", age: 17 }
  ]);
  assert.strictEqual(partialMatch.status, "MATCH", "partial stage comparisons report only the observed span");
  assert.strictEqual(partialMatch.checkedFromStage, "rawCharacter");
  assert.strictEqual(partialMatch.checkedThroughStage, "parsedCharacter");

  const selected = resolveCharacterAge({ age: 17, ageSource: "CK3_CURRENT_AGE", birthDate: "1172.5.2" }, { currentGameDate: "1190.5.2" });
  assert.strictEqual(selected.age, 17, "diagnostics do not adjust a trusted current age");
  assert.strictEqual(selected.calculatedCalendarAge, 18, "calendar arithmetic remains diagnostic only");
}

function testSafeDiagnosticCollector() {
  const input = {
    characterId: 987654321,
    snapshotId: SNAPSHOT,
    observations: Object.fromEntries(AGE_DIAGNOSTIC_STAGES.map((stage) => [stage, { age: 17, snapshotId: SNAPSHOT }]))
  };
  input.observations.parsedCharacter.age = 18;
  const result = collectAgeDiagnostic(input);
  assert.strictEqual(result.status, "MISMATCH");
  assert.strictEqual(result.diagnosticCode, "PARSER_AGE_MISMATCH");
  assert.strictEqual(result.firstMismatchStage, "parsedCharacter");
  assert.strictEqual(result.checkedFromStage, "ck3Panel");
  assert.strictEqual(result.checkedThroughStage, "parsedCharacter");
  assert(/^[a-f0-9]{64}$/.test(result.characterIdHash));
  assert(!JSON.stringify(result).includes(String(input.characterId)), "diagnostics never output the raw runtime ID");

  for (const stage of ["ck3Panel", "rawCharacter", "modelAnswer"]) {
    const incomplete = structuredClone(input);
    delete incomplete.observations[stage];
    const report = collectAgeDiagnostic(incomplete);
    assert.strictEqual(report.status, "INCOMPLETE", `missing ${stage} evidence cannot locate a mismatch`);
    assert.strictEqual(report.diagnosticCode, null);
    assert(report.missingStages.includes(stage));
  }

  const stale = structuredClone(input);
  stale.observations.familyFact.snapshotId = "other-snapshot";
  assert.strictEqual(collectAgeDiagnostic(stale).status, "INCOMPLETE", "mixed snapshots cannot be compared");

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v9.3.9-age-diagnostic-"));
  const inputPath = path.join(fixtureRoot, "observations.json");
  try {
    fs.writeFileSync(inputPath, JSON.stringify(input), "utf8");
    const cli = spawnSync(process.execPath, [path.join(__dirname, "diagnose-v9.3.9-age.js"), inputPath], {
      cwd: path.resolve(__dirname, ".."), encoding: "utf8"
    });
    assert.strictEqual(cli.status, 0, "read-only diagnostic CLI accepts a complete observation file");
    const cliReport = JSON.parse(cli.stdout);
    assert.strictEqual(cliReport.diagnosticCode, "PARSER_AGE_MISMATCH");
    assert(!cli.stdout.includes(String(input.characterId)), "CLI output does not expose the raw runtime ID");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function testProductionParserCompatibility() {
  const parsed = await parseSyntheticLog([
    line("init", 1, ["玩家", 1, "回应者", DATE, "___________talk_scene", "地点", "控制者", TOTAL_DAYS]),
    characterLine(1, 40),
    characterLine(20, 11),
    `VOTC:CAMPAIGN/${CAMPAIGN}`,
    line("parents", 1, [2, "父亲", 900, "1160.1.1", 60, "he", "PUBLIC_LEGAL_PARENT"]),
    line("parents", 1, [2, "旧档重复父亲证据", 900, "1160.1.1"]),
    line("parents", 1, [3, "旧格式父母", 920, "1162.1.1"]),
    line("parent_spouse", 1, [2, 4, "继母", "she", "PUBLIC_LEGAL_MARRIAGE"]),
    line("parent_spouse_child", 1, [2, 4, 5, "继母之子", "he", 6, "另一家长", "she", "PUBLIC_LEGAL_PARENT"]),
    line("kids", 1, [7, "子女", "he", 1100, "1178.4.1", 14]),
    line("kid_other_parent", 1, [7, 8, "生母", "PUBLIC_LEGAL_PARENT", "she"]),
    line("kid_eob", 1, [7, 7]),
    line("kids", 1, [9, "旧格式子女", "he", 1090, "1181.1.1"]),
    line("kid_other_parent", 1, [9, 10, "旧格式另一家长"], false),
    line("kid_eob", 1, [9, 9]),
    line("kids", 1, [15, "零岁子女", "they", 1110, "1190.5.2", 0]),
    line("kids", 1, [16, "小数年龄子女", "they", 1110, "1190.5.2", "14.5"]),
    line("kids", 1, [17, "负年龄子女", "they", 1110, "1190.5.2", "-1"]),
    line("kids", 1, [18, "超范围年龄子女", "they", 1110, "1190.5.2", "9007199254740992"]),
    line("kids", 1, [19, "科学计数年龄子女", "they", 1110, "1190.5.2", "1e2"]),
    line("kids", 1, [20, "新格式可信子女", "they", 1110, "1190.5.2", 11, "PUBLIC_LEGAL_PARENT"]),
    line("kid_eob", 1, [20, 20]),
    line("kids", 1, [21, "新格式未知子女", "they", 1110, "1190.5.2", 10, "UNKNOWN"]),
    line("kid_eob", 1, [21, 21]),
    line("kids", 1, [22, "重复旧格式子女", "they", 1110, "1190.5.2", 10]),
    line("kid_eob", 1, [22, 22]),
    line("kids", 1, [22, "重复新格式子女", "they", 1110, "1190.5.2", 10, "PUBLIC_LEGAL_PARENT"]),
    line("siblings", 1, [11, "兄弟姐妹", "she", 1070, "1179.1.1", 13]),
    line("sibling_other_parent", 1, [11, 12, "另一位家长", "UNKNOWN", "he"]),
    line("siblings", 1, [13, "旧格式兄弟姐妹", "he", 1080, "1180.1.1"]),
    line("sibling_other_parent", 1, [13, 14, "旧格式另一位家长"], false)
  ]);

  const owner = parsed.characters.get(1);
  assert(owner instanceof Character, "production Character class constructs full character rows");
  assert.strictEqual(owner.age, 40);
  assert.strictEqual(owner.ageSource, "CK3_CURRENT_AGE");

  const currentParent = owner.parents[0];
  assert.strictEqual(currentParent.age, 60);
  assert.strictEqual(currentParent.ageSource, "CK3_LIVE_RELATIVE_AGE");
  assert.deepStrictEqual({ source: currentParent.source, sourceOwnerId: currentParent.sourceOwnerId, childId: currentParent.childId,
    relationType: currentParent.relationType, sourceRelation: currentParent.sourceRelation,
    publicStatus: currentParent.publicStatus, knowledgeStatus: currentParent.knowledgeStatus,
    campaignToken: currentParent.campaignToken, sourceSnapshotId: currentParent.sourceSnapshotId }, {
    source: "CK3_DIRECT_PARENT", sourceOwnerId: 1, childId: 1, relationType: "parent", sourceRelation: "parents",
    publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT
  });
  assert.strictEqual(owner.parents[1].age, null, "legacy parent rows without appended age remain unknown");
  assert.strictEqual(owner.parents[1].publicStatus, "UNKNOWN", "legacy parent rows do not gain public status");
  assert.strictEqual(owner.parents[1].source, undefined, "legacy parent rows do not gain trusted source metadata");
  assert.strictEqual(owner.parents[2].age, null, "old parent birth-date fields are not misread as an age");

  const spouse = currentParent.spouses[0];
  assert.strictEqual(spouse.id, 4);
  assert.strictEqual(spouse.publicStatus, "PUBLIC_LEGAL_MARRIAGE");
  assert.strictEqual(spouse.children[0].id, 5);
  assert.deepStrictEqual(spouse.children[0].parents.map((parent) => parent.id), [4, 6],
    "parent_spouse_child fields bind the spouse and the child's other public parent");
  assert(spouse.children[0].parents.every((parent) => parent.childId === 5 && parent.sourceOwnerId === 1
    && parent.sourceSnapshotId === SNAPSHOT && parent.campaignToken === CAMPAIGN));

  assert.strictEqual(owner.children[0].age, 14);
  assert.strictEqual(owner.children[0].otherParent.publicStatus, "PUBLIC_LEGAL_PARENT");
  assert.strictEqual(owner.children[1].age, null, "legacy child rows without GetAge remain unknown");
  assert.strictEqual(owner.children[1].otherParent.publicStatus, "UNKNOWN", "legacy other-parent rows remain unverified");
  assert.strictEqual(owner.children[2].age, 0, "zero is a valid integer relative age");
  assert.strictEqual(owner.children[3].age, null, "fractional relative ages remain unknown");
  assert.strictEqual(owner.children[4].age, null, "negative relative ages remain unknown");
  assert.strictEqual(owner.children[5].age, null, "unsafe integer relative ages remain unknown");
  assert.strictEqual(owner.children[6].age, null, "non-decimal numeric spellings remain unknown");
  assert.deepStrictEqual(owner.children[7].directParentEvidence, {
    source: "CK3_DIRECT_PARENT", sourceOwnerId: 20, childId: 20, parentId: 1, relationType: "parent",
    sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN",
    campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT
  }, "new kids rows bind public direct-parent evidence to the child ID and current owner");
  assert.strictEqual(owner.children[8].directParentEvidence.publicStatus, "UNKNOWN");
  assert.strictEqual(owner.children[0].directParentEvidence, undefined, "legacy kids rows do not gain direct-parent proof");
  assert.strictEqual(owner.children[9].directParentEvidence, undefined);
  assert.strictEqual(owner.children[10].directParentEvidence.evidenceConflict, true,
    "a new public row does not upgrade a duplicate legacy row for the same child");
  const directParentFilter = currentDirectParentFilter(parsed);
  assert.strictEqual(directParentFilter(owner.children[7].directParentEvidence, { childId: 20, parentId: 1 }), true,
    "new explicit public kids proof passes the current snapshot validator");
  assert.strictEqual(directParentFilter(owner.children[8].directParentEvidence, { childId: 21, parentId: 1 }), false,
    "explicit UNKNOWN kids proof remains rejected");
  assert.strictEqual(directParentFilter(owner.children[10].directParentEvidence, { childId: 22, parentId: 1 }), false,
    "a duplicate-row conflict remains rejected");
  assert.strictEqual(owner.siblings[0].age, 13);
  assert.strictEqual(owner.siblings[1].age, null, "legacy sibling rows without GetAge remain unknown");
  assert.strictEqual(owner.siblings[1].otherParent.publicStatus, "UNKNOWN", "legacy sibling other-parent rows remain unverified");

  const selectedRelativeAge = resolveCharacterAge(owner.children[0], {
    currentGameDate: parsed.date,
    currentTotalDays: parsed.totalDays,
    currentCampaignToken: parsed.campaignToken
  });
  assert.strictEqual(selectedRelativeAge.age, 14, "a relative age is trusted only in its parsed campaign and snapshot");

  const resolver = createRelationshipResolver({ onDiagnostic: () => false });
  const oneParentProfiles = resolver.buildCanonicalProfiles(new Map([[1, { ...owner, parents: [currentParent], children: [], siblings: [] }]]),
    parsed.totalDays, inferGenderFromPronoun, { campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT });
  const parentEvidence = oneParentProfiles.get(2).evidence.relations.find((relation) => relation.ownerId === 1).directParentEvidence;
  assert.strictEqual(parentEvidence.source, "CK3_DIRECT_PARENT");
  assert.strictEqual(parentEvidence.parentId, 2);
  assert.strictEqual(parentEvidence.sourceOwnerId, 1);
  assert.strictEqual(parentEvidence.childId, 1);
  assert.strictEqual(parentEvidence.publicStatus, "PUBLIC_LEGAL_PARENT");

  const conflictingProfiles = resolver.buildCanonicalProfiles(new Map([[1, { ...owner, children: [], siblings: [] }]]),
    parsed.totalDays, inferGenderFromPronoun, { campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT });
  const conflictingEvidence = conflictingProfiles.get(2).evidence.relations.find((relation) => relation.ownerId === 1).directParentEvidence;
  assert.strictEqual(conflictingEvidence.evidenceConflict, true,
    "trusted and legacy/untrusted evidence for one parent pair remains a conflict");

  const canonicalProfiles = resolver.buildCanonicalProfiles(parsed.characters, parsed.totalDays, inferGenderFromPronoun, {
    campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT
  });
  const childRelation = canonicalProfiles.get(20).evidence.relations.find((relation) => relation.ownerId === 1 && relation.relationType === "child");
  assert.deepStrictEqual(childRelation.directParentEvidence, owner.children[7].directParentEvidence,
    "the resolver preserves the complete kids proof on the canonical child relation");
  const currentFilters = { directParentEvidenceFilter: currentDirectParentFilter(parsed),
    otherParentEvidenceFilter: currentPublicParentFilter(parsed) };
  const rawGraph = buildKinshipGraph(parsed.characters, currentFilters);
  const canonicalGraph = buildKinshipGraph(canonicalProfiles, currentFilters);
  assert.strictEqual(rawGraph.relationBetween(1, 20).relation?.type, "PARENT_OF",
    "the production parser's current public kids proof builds the raw current graph edge");
  assert.strictEqual(canonicalGraph.relationBetween(1, 20).relation?.type, "PARENT_OF",
    "the same proof builds the edge through canonical profiles");

  const rawTraitView = createTraitProfileView(parsed, owner).character;
  assert(rawTraitView.children.some((child) => Number(child.id) === 20),
    "the raw trait projection retains a current child with valid proof");
  const canonicalTraitView = createTraitProfileView({ ...parsed, characters: canonicalProfiles }, canonicalProfiles.get(20)).character;
  assert(canonicalTraitView.evidence.relations.some((relation) => relation.ownerId === 1 && relation.relationType === "child"
    && relation.directParentEvidence?.source === "CK3_DIRECT_PARENT"),
  "the canonical child trait projection retains its validated reverse relation evidence");
}

function testProductionSaveParentEvidence() {
  const rawSave = `date=1150.1.1
playthrough_id="save-kinship-fixture"
played_character=1
living={
  1={ first_name="Child" female=no family_data={ father=2 mother=3 real_father=4 real_mother=5 } }
  2={ first_name="Legal father" female=no family_data={ child=1 } }
  3={ first_name="Legal mother" female=yes family_data={ child=1 } }
  4={ first_name="Secret biological father" female=no }
  5={ first_name="Secret biological mother" female=yes }
}`;
  const parsed = parseGameState(rawSave);
  const child = parsed.characters["1"];
  assert.strictEqual(child.parents.father, "2", "the production save parser exposes only the legal father field");
  assert.strictEqual(child.parents.mother, "3", "the production save parser exposes only the legal mother field");

  const fatherRelation = child.evidence.relations.find((item) => item.ownerId === "2" && item.relationType === "child");
  const motherRelation = child.evidence.relations.find((item) => item.ownerId === "3" && item.relationType === "child");
  assert(fatherRelation && motherRelation, "legal father and mother produce child-side current evidence");
  for (const [relation, parentId, sourceRelation] of [[fatherRelation, "2", "family_data.father"], [motherRelation, "3", "family_data.mother"]]) {
    assert.deepStrictEqual(relation.directParentEvidence, {
      source: "CK3_SAVE_LEGAL_PARENT",
      sourceSchemaVersion: 1,
      sourceOwnerId: "1",
      childId: "1",
      parentId,
      relationType: "parent",
      sourceRelation,
      publicStatus: "PUBLIC_LEGAL_PARENT",
      knowledgeStatus: "UNKNOWN",
      playthroughId: parsed.playthroughId,
      gameDate: parsed.gameDate,
      contentFingerprint: parsed.contentFingerprint,
      sourceSnapshotId: `${parsed.playthroughId}/${parsed.gameDate}/${parsed.contentFingerprint}`
    }, "save proof binds the raw legal field to the complete parsed snapshot");
  }
  assert(!child.evidence.relations.some((item) => ["4", "5"].includes(item.ownerId)),
    "real_father and real_mother never become public evidence");

  const filter = currentDirectParentFilter(parsed);
  assert.strictEqual(filter(fatherRelation.directParentEvidence, { childId: "1", parentId: "2" }), true);
  assert.strictEqual(filter(motherRelation.directParentEvidence, { childId: "1", parentId: "3" }), true);
  const graph = buildKinshipGraph(parsed.characters, { directParentEvidenceFilter: filter });
  assert.strictEqual(graph.relationBetween(2, 1).relation?.type, "PARENT_OF",
    "the production save adapter evidence creates the current legal father edge");
  assert.strictEqual(graph.relationBetween(3, 1).relation?.type, "PARENT_OF",
    "the production save adapter evidence creates the current legal mother edge");
  assert.notStrictEqual(graph.relationBetween(4, 1).relation?.type, "PARENT_OF",
    "a secret biological father does not create a graph edge");
  assert.notStrictEqual(graph.relationBetween(5, 1).relation?.type, "PARENT_OF",
    "a secret biological mother does not create a graph edge");

  const badTarget = structuredClone(fatherRelation.directParentEvidence);
  badTarget.parentId = "4";
  assert.strictEqual(filter(badTarget, { childId: "1", parentId: "4" }), false,
    "a complete proof cannot redirect the legal father relation to a different parent ID");
  const wrongSchema = structuredClone(fatherRelation.directParentEvidence);
  wrongSchema.sourceSchemaVersion = 2;
  assert.strictEqual(filter(wrongSchema, { childId: "1", parentId: "2" }), false,
    "unknown save evidence schemas fail closed");
  assert.strictEqual(currentDirectParentFilter({ ...parsed, gameDate: "1150.1.2" })(
    fatherRelation.directParentEvidence, { childId: "1", parentId: "2" }), false,
  "proof from a different game date is stale");
  assert.strictEqual(currentDirectParentFilter({ ...parsed, contentFingerprint: "0".repeat(64) })(
    fatherRelation.directParentEvidence, { childId: "1", parentId: "2" }), false,
  "proof from different save bytes is stale");
}

async function main() {
  testAgeLayerDiagnosis();
  testSafeDiagnosticCollector();
  testProductionSaveParentEvidence();
  await testProductionParserCompatibility();
  console.log("V9.3.9 age parser and layered diagnostics: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
