"use strict";

const assert = require("assert");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");

(async () => {
  const fixture = createCanonFixture();
  try {
    await assert.rejects(create(fixture.service, { title: "现状", content: "韩世忠现在在临安" }), /current_state_needs_structured_confirmation/);
    await assert.rejects(create(fixture.service, { title: "现状", content: "位置备忘", temporalSemantics: "CURRENT_STRUCTURED_CLAIM" }), /current_claim_required/);
    await assert.rejects(create(fixture.service, { title: "现状", content: "结构化位置", temporalMode: "TIMELESS", temporalSemantics: "CURRENT_STRUCTURED_CLAIM", currentClaim: { entityId: "2", field: "location", value: "临安" } }), /current_claim_requires_current_date/);
    await assert.rejects(create(fixture.service, { title: "现状", content: "不存在的人物", temporalSemantics: "CURRENT_STRUCTURED_CLAIM", currentClaim: { entityId: "999", field: "location", value: "临安" } }), /current_claim_character_required/);
    const record = await create(fixture.service, { title: "韩世忠位置", content: "经 CK3 核对的位置", temporalSemantics: "CURRENT_STRUCTURED_CLAIM", currentClaim: { entityId: "2", field: "location", value: "临安" } });
    await fixture.service.prepare();
    const matched = fixture.service.recall({ responderId: "1", query: "韩世忠在哪里", entityIds: ["2"], currentFacts: [{ entityId: "2", field: "location", sourceTier: "GAME_TRUTH", structuredValue: "临安" }] });
    assert.deepEqual(matched.selected.map((item) => item.recordId), [record.recordId]);
    const mismatched = fixture.service.recall({ responderId: "1", query: "韩世忠在哪里", entityIds: ["2"], currentFacts: [{ entityId: "2", field: "location", sourceTier: "GAME_TRUTH", structuredValue: "建康" }] });
    assert.equal(mismatched.selected.length, 0);
    console.log("V8.7.1 current claim schema PASS");
  } finally { fixture.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
