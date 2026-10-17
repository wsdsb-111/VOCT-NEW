"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");
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

const ROOT = path.resolve(__dirname, "..");
const SIBLING_ID = 20;
const RESPONDER_ID = 10;
const PLAYER_ID = 1;
const PRIVATE_SECRET = "V937_PRIVATE_SECRET_SENTINEL";
const PRIVATE_MEMORY = "V937_PRIVATE_MEMORY_SENTINEL";
const RELATED_QUERY = "你兄弟的母亲是谁？";
const COMPARISON_QUERY = "你们是否同父异母？";
const AGE_QUERY = "你兄弟赵子明现在几岁？";

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function addAdversarialRows(lines) {
  const result = [...lines,
    line("memory", SIBLING_ID, ["family", FIXTURE_DATE, PRIVATE_MEMORY, 100, FIXTURE_TOTAL_DAYS]),
    line("secret", SIBLING_ID, [PRIVATE_SECRET, "只应留在未授权角色记录中的秘密描述", "secret", "unknown"]),
    line("secret_eob", SIBLING_ID)
  ];
  return result;
}

function addInvalidRows(lines) {
  return [...lines,
    line("kids", PLAYER_ID, [40, "无效证据孩子", "he", 50, "1188年5月2日", 2]),
    line("kid_other_parent", PLAYER_ID, [40, -5, "无效亲人哨兵", "PUBLIC_LEGAL_PARENT", "she"]),
    line("kid_eob", PLAYER_ID)
  ];
}

function addDuplicateParentRows(lines) {
  return [...lines,
    line("kids", PLAYER_ID, [SIBLING_ID, "赵子明", "he", 30, "1172年5月2日", 17]),
    line("kid_other_parent", PLAYER_ID, [SIBLING_ID, 3, "陈氏妾", "PUBLIC_LEGAL_PARENT", "she"]),
    line("kid_eob", PLAYER_ID)
  ];
}

function addConflictingMother(lines, status = "PUBLIC_LEGAL_PARENT") {
  return [...lines,
    line("siblings", RESPONDER_ID, [SIBLING_ID, "赵子明", "he", 30, "1172年5月2日", 17]),
    line("sibling_other_parent", RESPONDER_ID, [SIBLING_ID, 30, "赵氏", status, "she"]),
    line("sibling_eob", RESPONDER_ID, [SIBLING_ID, ""])
  ];
}

function graphFor(gameData) {
  const { buildKinshipGraph } = require(path.join(ROOT, "src/app/main/worldline/character-kinship-graph.js"));
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return buildKinshipGraph(gameData.getMentionableCharacterProfiles());
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

async function main() {
  const runtime = loadRuntime(ROOT);
  const baseLines = makeFamilyFixtureLines({ siblingCount: 1, siblingCharacterAge: null, siblingRelativeAge: 17 });
  const lines = addAdversarialRows(baseLines);
  const gameData = await parseFixture(runtime, lines);
  const graph = graphFor(gameData);

  const fatherChild = gameData.characters.get(PLAYER_ID).children.find(child => child.id === RESPONDER_ID);
  const halfSibling = gameData.characters.get(PLAYER_ID).children.find(child => child.id === SIBLING_ID);
  assert.equal(fatherChild.otherParent.id, 2, "player's mother evidence should remain bound to the player");
  assert.equal(halfSibling.otherParent.id, 3, "sibling's mother evidence should remain bound to that sibling");
  assert.equal(halfSibling.otherParent.sourceOwnerId, PLAYER_ID);
  assert.equal(halfSibling.otherParent.source, "CK3_OTHER_PARENT");
  assert.equal(halfSibling.otherParent.sourceRelation, "kids.otherParent");
  assert.equal(halfSibling.otherParent.publicStatus, "PUBLIC_LEGAL_PARENT");
  assert.equal(halfSibling.otherParent.knowledgeStatus, "UNKNOWN");
  assert.equal(halfSibling.otherParent.campaignToken, FIXTURE_CAMPAIGN);
  assert.equal(halfSibling.otherParent.sourceSnapshotId, `${FIXTURE_DATE}/${FIXTURE_TOTAL_DAYS}`);

  const edges = (from, to, type) => graph.edges.filter(edge => edge.from === String(from) && edge.to === String(to) && edge.type === type);
  assert.equal(edges(2, RESPONDER_ID, "PARENT_OF").length, 1, "wife must be parent only of her own child");
  assert.equal(edges(3, SIBLING_ID, "PARENT_OF").length, 1, "concubine must be parent only of her own child");
  assert.equal(edges(2, SIBLING_ID, "PARENT_OF").length, 0, "do not invent a mother-child edge across mothers");
  assert.equal(edges(3, RESPONDER_ID, "PARENT_OF").length, 0, "sibling_other_parent must not attach the mother to the responder");
  assert.equal(edges(2, 3, "SPOUSE_OF").length + edges(3, 2, "SPOUSE_OF").length, 0, "shared children must not imply the mothers are spouses");
  assert.equal(edges(RESPONDER_ID, SIBLING_ID, "SIBLING_OF").length, 1, "duplicate sibling rows should collapse to one graph edge");
  const motherEdge = edges(3, SIBLING_ID, "PARENT_OF")[0];
  assert.equal(motherEdge.parentEvidence.length, 2, "distinct CK3 source relations remain traceable");
  assert.ok(motherEdge.parentEvidence.every(item => item.otherParentId === item.parentId
    && item.childId === String(SIBLING_ID) && item.relationType === "parent" && item.source === "CK3_OTHER_PARENT"));
  assert.deepEqual(motherEdge.parentEvidence.map(item => `${item.sourceOwnerId}:${item.sourceRelation}`).sort(),
    ["1:kids.otherParent", "10:siblings.otherParent"].sort());
  const homonymLines = [...baseLines,
    characterLine({ id: 21, name: "赵子明", gender: "male", age: 17 }),
    characterLine({ id: 22, name: "另一父亲", gender: "male", age: 42 }),
    line("kids", 22, [21, "赵子明", "he", 30, "1172年5月2日", 17]),
    line("kid_eob", 22, [21, ""])
  ];
  const homonymData = await parseFixture(runtime, homonymLines);
  const homonymGraph = graphFor(homonymData);
  assert.equal(homonymGraph.nodes.get("20").name, homonymGraph.nodes.get("21").name, "fixture must contain homonyms");
  assert.notEqual(homonymGraph.nodes.get("20"), homonymGraph.nodes.get("21"), "homonyms with different IDs remain separate identities");
  const duplicateData = await parseFixture(runtime, addDuplicateParentRows(lines));
  const duplicateGraph = graphFor(duplicateData);
  const duplicateMotherEdges = duplicateGraph.edges.filter(edge => edge.from === "3" && edge.to === String(SIBLING_ID) && edge.type === "PARENT_OF");
  assert.equal(duplicateMotherEdges.length, 1, "duplicate parent records should create one graph edge");
  assert.equal(duplicateMotherEdges[0].parentEvidence.length, 2, "duplicate evidence should collapse while distinct source relations remain");
  const invalidData = await parseFixture(runtime, addInvalidRows(lines));
  const invalidGraph = graphFor(invalidData);
  assert.equal(invalidGraph.edges.filter(edge => edge.from === "-5" && edge.to === "40" && edge.type === "PARENT_OF").length, 0,
    "invalid parent IDs must not create graph edges");
  assert.equal(invalidGraph.edges.filter(edge => edge.from === "NaN" && edge.to === "40" && edge.type === "PARENT_OF").length, 0,
    "non-finite parent IDs must not create graph edges");

  const memoryContext = makeMemoryContext();
  const memoryBefore = JSON.stringify(memoryContext);
  const related = render(runtime, gameData, RELATED_QUERY, memoryContext);
  assert.match(related.familyText, /赵子明的母亲：陈氏妾/u, "targeted query should return this sibling's public mother");
  assert.equal(related.result.familyDiagnostics.some(item => item.targetedParentQuery === true), true,
    "PromptBuilder should record the actual targeted parent query path");
  assert.equal(JSON.stringify(memoryContext), memoryBefore, "family query must not mutate or expand memory authorization");
  const uniqueSiblingComparison = render(runtime, gameData, COMPARISON_QUERY, memoryContext);
  assert.match(uniqueSiblingComparison.familyText, /王承礼与赵子明：同父异母；双方母亲分别为王氏妻、陈氏妾/u,
    "NO_RELATION_INTENT comparison may select the only sibling candidate and use both public mothers");
  assert.equal(uniqueSiblingComparison.result.familyDiagnostics.some(item => item.targetedParentQuery === true), true,
    "unique implicit sibling comparison should use the targeted parent query path");
  const multipleSiblingLines = [...lines,
    characterLine({ id: 41, name: "王子乙", gender: "male", age: 17 }),
    line("siblings", RESPONDER_ID, [41, "王子乙", "he", 395, "1173年5月2日", 17]),
    line("sibling_other_parent", RESPONDER_ID, [41, 2, "王氏妻", "PUBLIC_LEGAL_PARENT", "she"]),
    line("sibling_eob", RESPONDER_ID, [41, ""])
  ];
  const multipleSiblingData = await parseFixture(runtime, multipleSiblingLines);
  const ambiguousSiblingComparison = render(runtime, multipleSiblingData, COMPARISON_QUERY, memoryContext);
  assert.match(ambiguousSiblingComparison.familyText, /RELATION_AMBIGUOUS/u,
    "implicit sibling comparison must fail closed when there is more than one sibling candidate");
  assert.ok(!ambiguousSiblingComparison.familyText.includes("赵子明")
    && !ambiguousSiblingComparison.familyText.includes("王子乙")
    && !ambiguousSiblingComparison.familyText.includes("陈氏妾"),
  "ambiguous comparison must not select or disclose one candidate's family facts");
  const ordinary = render(runtime, gameData, "继续说下去。", memoryContext);
  for (const prompt of [related.text, ordinary.text]) {
    assert.ok(!prompt.includes(PRIVATE_SECRET), "unshared CK3 secret must not enter the final prompt");
    assert.ok(!prompt.includes(PRIVATE_MEMORY), "another character's memory must not enter the final prompt");
  }
  const invalidPrompt = render(runtime, invalidData, "继续说下去。", memoryContext);
  assert.ok(!invalidPrompt.text.includes("无效亲人哨兵"), "invalid-ID parent data must not enter the final prompt");

  const conflictData = await parseFixture(runtime, addConflictingMother(lines));
  const conflictPrompt = render(runtime, conflictData, RELATED_QUERY);
  assert.match(conflictPrompt.familyText, /未知（缺少唯一可信公开来源）/u,
    "conflicting mothers must fail closed instead of selecting a candidate");
  assert.ok(!conflictPrompt.familyText.includes("陈氏妾") && !conflictPrompt.familyText.includes("赵氏"),
    "conflicting parent names must not leak into the targeted answer");
  const hiddenMotherData = await parseFixture(runtime, addConflictingMother(lines, "UNKNOWN"));
  const hiddenMotherPrompt = render(runtime, hiddenMotherData, RELATED_QUERY);
  assert.match(hiddenMotherPrompt.familyText, /赵子明的母亲：陈氏妾/u,
    "an unknown-status alternate parent must not override the sole public legal parent");
  assert.ok(!hiddenMotherPrompt.familyText.includes("赵氏"), "unknown-status parent identity must not leak");

  const missingAgeData = gameData;
  const missingAgePrompt = render(runtime, missingAgeData, AGE_QUERY);
  assert.match(missingAgePrompt.familyText, /17岁/u,
    "missing canonical age may use a current, source-bound relative age");
  const missingAgeDiag = missingAgePrompt.result.ageDiagnostics[0];
  assert.equal(missingAgeDiag?.ageSource, "CK3_LIVE_RELATIVE_AGE");
  assert.equal(missingAgeDiag?.selectedAge, 17);

  const age17Lines = addAdversarialRows(makeFamilyFixtureLines({ siblingCount: 1, siblingCharacterAge: 17, siblingRelativeAge: 17 }));
  const age17Data = await parseFixture(runtime, age17Lines);
  const age17Prompt = render(runtime, age17Data, AGE_QUERY);
  assert.match(age17Prompt.familyText, /17岁/u, "canonical current age 17 should be stated as 17");
  assert.equal(age17Prompt.result.ageDiagnostics[0]?.profileSelectionPath, "CURRENT_CANONICAL");

  const age18Lines = addAdversarialRows(makeFamilyFixtureLines({ siblingCount: 1, siblingCharacterAge: 18, siblingRelativeAge: 17 }));
  const age18Data = await parseFixture(runtime, age18Lines);
  const age18Prompt = render(runtime, age18Data, AGE_QUERY);
  assert.match(age18Prompt.familyText, /18岁/u, "canonical current age 18 should override a stale relative age 17");
  assert.equal(age18Prompt.result.ageDiagnostics[0]?.selectedAge, 18);
  assert.equal(age18Prompt.result.ageDiagnostics[0]?.rawAge, 18);
  assert.equal(age18Data.date, missingAgeData.date, "refresh fixtures must represent the same game date");
  assert.equal(age18Data.totalDays, missingAgeData.totalDays, "refresh fixtures must represent the same game snapshot day");
  assert.equal(age18Data.campaignToken, missingAgeData.campaignToken, "refresh fixtures must remain in the same campaign");
  const refreshData = await parseFixture(runtime, age17Lines);
  const { getCachedKinshipGraph } = require(path.join(ROOT, "src/app/main/worldline/kinship-graph-cache.js"));
  const cachedBeforeRefresh = getCachedKinshipGraph(refreshData, { includeOtherParents: true });
  const refreshSnapshot = `${refreshData.date}/${refreshData.totalDays}`;
  refreshData.characters.get(SIBLING_ID).age = 18;
  refreshData.characters.get(SIBLING_ID).ageSource = "CK3_CURRENT_AGE";
  const cachedAfterRefresh = getCachedKinshipGraph(refreshData, { includeOtherParents: true });
  assert.notEqual(cachedAfterRefresh, cachedBeforeRefresh, "same-snapshot age refresh must invalidate the cached family graph");
  assert.equal(cachedAfterRefresh.nodes.get(String(SIBLING_ID)).age, 18, "refreshed graph must expose the current age");
  assert.equal(`${refreshData.date}/${refreshData.totalDays}`, refreshSnapshot, "age refresh test must keep the same snapshot");
  const refreshedInPlace = render(runtime, refreshData, AGE_QUERY);
  assert.match(refreshedInPlace.familyText, /18岁/u, "same-object, same-snapshot refresh must use the new current age");
  const refreshedAgain = await parseFixture(runtime, age18Lines);
  const stableOne = render(runtime, refreshedAgain, AGE_QUERY);
  const stableTwo = render(runtime, refreshedAgain, AGE_QUERY);
  assert.equal(sha256(stableOne.familyText), sha256(stableTwo.familyText), "same-snapshot regeneration must preserve family facts");
  assert.equal(stableOne.promptTokens, stableTwo.promptTokens, "same-snapshot regeneration must preserve prompt token count");
  assert.match(stableOne.familyText, /18岁/u, "same-snapshot refresh must use the refreshed current age");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    fixtureHash: sha256(lines.join("\n")),
    assertions: ["LogParser→GameData→kinship graph→PromptBuilder", "parent evidence binding and duplicate collapse", "no cross-mother or inferred spouse edges", "invalid ID rejection", "homonym identity isolation", "unknown/private memory and secret exclusion", "conflicting parent fail-closed", "implicit sibling comparison unique success and multiple-candidate fail-closed", "source-bound age missing/17/18", "same-snapshot refresh and stable regeneration", "no memory authorization expansion"]
  }, null, 2)}\n`);
}

module.exports = { run: main };

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
