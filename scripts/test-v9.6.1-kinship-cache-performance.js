"use strict";

const assert = require("node:assert/strict");
const { getTargetedKinshipGraph } = require("../src/app/main/worldline/kinship-graph-cache");
const { getFamilyVisibility } = require("../src/app/main/worldline/family-visibility");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");

function fixture(size, dense) {
  const data = { campaignToken: "cache-bench", date: "1130.1.1", totalDays: 410000, characters: new Map() };
  for (let id = 1; id <= size; id++) data.characters.set(id, { id, name: `人物${id}甲`, shortName: `人物${id}甲`,
    age: 30, traits: [], parents: [], children: [], siblings: [], spouses: [] });
  for (let childId = 2; childId <= size; childId++) {
    if (!dense && childId > 2) break;
    const parentId = dense ? Math.floor(childId / 2) : 1;
    const proof = { id: parentId, parentId, childId, source: "CK3_DIRECT_PARENT", sourceOwnerId: childId,
      relationType: "parent", sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN",
      evidenceConflict: false, campaignToken: data.campaignToken, sourceSnapshotId: `${data.date}/${data.totalDays}` };
    data.characters.get(childId).parents.push({ ...proof, name: `人物${parentId}甲` });
    data.characters.get(parentId).children.push({ id: childId, name: `人物${childId}甲`, directParentEvidence: proof });
  }
  return data;
}
const rows = [];
for (const size of [1000, 5000, 10000]) for (const dense of [false, true]) {
  const data = fixture(size, dense);
  const options = { maxDepth: 8, maxNodes: 4096, deriveExtendedRelations: false };
  const started = performance.now();
  const first = getTargetedKinshipGraph(data, [1], options);
  const firstMs = performance.now() - started;
  const hitStart = performance.now();
  const second = getTargetedKinshipGraph(data, [1], options);
  const hitMs = performance.now() - hitStart;
  assert.strictEqual(second, first, "unchanged bounded graph is reused");
  assert(first.nodes.size <= options.maxNodes);
  assert(first.scopeMetrics.queued <= first.scopeMetrics.nodeVisits * 4 + 1, "deduplicated bounded-degree traversal has linear queue cost");
  assert.equal(first.scopeMetrics.fingerprintComputations, 1);
  if (!dense) assert.equal(first.scopeMetrics.nodeVisits, 2, "unrelated outer profiles do not enter the fingerprint");
  const record = data.characters.get(2).parents[0];
  record.evidenceConflict = true;
  const invalidated = getTargetedKinshipGraph(data, [1], options);
  assert.notStrictEqual(invalidated, first, "same-object, same-day proof mutation invalidates cache");
  assert.equal(invalidated.edges.some(edge => edge.type === "PARENT_OF" && edge.to === "2" && !edge.parentEvidenceConflict), false);
  record.evidenceConflict = false;
  const beforeClock = getTargetedKinshipGraph(data, [1], options);
  data.totalDays++; data.date = "1130.1.2";
  const expired = getTargetedKinshipGraph(data, [1], options);
  assert.notStrictEqual(expired, beforeClock);
  assert.equal(getFamilyVisibility(data, 1).ids.has("2"), false, "old proofs expire on clock advance");
  const projectionStart = performance.now();
  createTraitProfileView(data, data.characters.get(1));
  const projectionMs = performance.now() - projectionStart;
  rows.push({ size, density: dense ? "binary-family" : "sparse", firstMs: +firstMs.toFixed(2), hitMs: +hitMs.toFixed(2),
    projectionMs: +projectionMs.toFixed(2), nodes: first.nodes.size, queued: first.scopeMetrics.queued, truncated: first.scopeTruncated });
}
// A dense frontier exceeding the cap must not make an affirmative family grant.
const capped = fixture(1000, true);
const limited = getFamilyVisibility(capped, 1, { maxNodes: 16 });
assert(limited.scopeTruncated);
assert.deepEqual([...limited.ids], ["1"]);
const scopeA = fixture(1000, false), scopeB = fixture(1000, false);
scopeB.campaignToken = "other-campaign";
assert.notStrictEqual(getTargetedKinshipGraph(scopeA, [1]), getTargetedKinshipGraph(scopeB, [1]));
assert.notStrictEqual(getTargetedKinshipGraph(scopeA, [1]), getTargetedKinshipGraph(scopeA, [1000]));
console.log(JSON.stringify({ status: "PASS", rows }));
