"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BranchRegistry } = require("../resources/app/out/main/worldline/branch-registry");
const { getCurrentTruth } = require("../resources/app/out/main/worldline/current-truth-adapter");
const { classifySelectedWorldFacts } = require("../resources/app/out/main/worldline/world-knowledge-classifier");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");

function branchInput(loadSessionId, date = "1175.1.1", fingerprint = "a".repeat(64)) {
  return { campaignToken: "v872-campaign", sourcePath: "C:\\saves\\autosave.ck3", fingerprint, gameDate: date, loadSessionId };
}

(async () => {
  const fixture = createCanonFixture();
  try {
    const snapshot = fixture.checkpoint().snapshot;
    for (const field of ["location", "alive", "faith", "culture", "liege", "courtEmployer"]) assert.equal(getCurrentTruth(snapshot, "2", field).available, true, `${field} must come from the production snapshot`);
    assert.equal(getCurrentTruth(snapshot, "2", "primaryTitle").available, false, "primary title has no production current-truth source");
    assert.equal(getCurrentTruth(snapshot, "2", "imprisoned").available, false, "imprisoned has no production current-truth source");
    const liege = fixture.service.getCurrentTruth({ entityId: "2", field: "liege" });
    assert.equal(liege.rawValue, "1");
    assert.equal(liege.displayValue, "赵思昭", "player-facing display must not expose the runtime id");
    const record = await create(fixture.service, { title: "直属领主", content: "由 CK3 结构化核对", temporalSemantics: "CURRENT_STRUCTURED_CLAIM", currentClaim: { entityId: "2", field: "liege" } });
    assert.equal(record.currentClaim.value, "1");
    assert.equal(record.currentClaim.displayValue, "赵思昭");
    await assert.rejects(create(fixture.service, { title: "伪造当前值", content: "由 CK3 结构化核对", temporalSemantics: "CURRENT_STRUCTURED_CLAIM", currentClaim: { entityId: "2", field: "liege", value: "赵思昭" } }), /current_claim_value_mismatch/);
    await assert.rejects(create(fixture.service, { title: "头衔", content: "由 CK3 结构化核对", temporalSemantics: "CURRENT_STRUCTURED_CLAIM", currentClaim: { entityId: "2", field: "primaryTitle" } }), /field_unsupported/);
    await assert.rejects(create(fixture.service, { title: "囚禁", content: "由 CK3 结构化核对", temporalSemantics: "CURRENT_STRUCTURED_CLAIM", currentClaim: { entityId: "2", field: "imprisoned" } }), /field_unsupported/);
    const facts = classifySelectedWorldFacts({ gameTruth: [{ id: "character:2", kind: "CHARACTER", sourceTier: "GAME_TRUTH", gameDate: snapshot.gameDate, payload: { id: "2", character: snapshot.characters["2"], match: { displayName: "韩世忠" } } }] }, snapshot.gameDate, snapshot);
    const expectedStructured = { LOCATION: "临安", ALIVE: true, FAITH: "儒教", CULTURE: "汉", LIEGE: "1", COURT_EMPLOYER: "1" };
    for (const [field, value] of Object.entries(expectedStructured)) {
      const fact = facts.find((item) => item.field === field);
      assert.equal(fact.structuredValue, value, `${field} must keep its authoritative structured value`);
      assert.ok(fact.structuredDisplayValue !== undefined, `${field} must include a player-facing display value`);
      assert.equal(fact.sourceTier, "GAME_TRUTH");
      assert.equal(fact.temporalSafe, true);
    }
  } finally { fixture.dispose(); }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v872-branch-"));
  try {
    const registry = new BranchRegistry({ root });
    const first = registry.observe(branchInput("votc-load-1"));
    const next = registry.observe(branchInput("votc-load-1", "1175.1.2", "b".repeat(64)));
    assert.equal(next.state, "SAME_BRANCH", "same load session may advance autosave");
    const boundary = registry.observe(branchInput("votc-load-2", "1175.1.3", "c".repeat(64)));
    assert.equal(boundary.state, "LOAD_BOUNDARY_CANDIDATE", "a changed load session cannot auto-continue by date");
    const confirmed = registry.confirmContinuation(branchInput("votc-load-2", "1175.1.3", "c".repeat(64)), first.branchId);
    assert.equal(confirmed.state, "SAME_BRANCH");
    const unknown = registry.observe(branchInput(null, "1175.1.4", "d".repeat(64)));
    assert.equal(unknown.state, "LOAD_BOUNDARY_CANDIDATE", "missing marker after a marked session must fail closed");
    const legacy = new BranchRegistry({ root: fs.mkdtempSync(path.join(os.tmpdir(), "votc-v872-legacy-")) });
    assert.equal(legacy.observe(branchInput(null)).state, "NEW_CAMPAIGN");
    assert.equal(legacy.observe(branchInput(null, "1175.1.2", "e".repeat(64))).state, "SAME_BRANCH", "pre-v8.7.2 rows remain compatible until a marker exists");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log("V8.7.2 Terra PASS: current truth contract and load boundary");
})().catch((error) => { console.error(error); process.exitCode = 1; });
