"use strict";

const assert = require("assert");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");

(async () => {
  const fixture = createCanonFixture();
  try {
    const record = await create(fixture.service, { title: "长期礼仪", content: "入殿前应先通报", type: "WORLD_ANNOTATION", temporalMode: "TIMELESS", importance: "HIGH", conflictKey: "rule:court-entry" });
    const hidden = await fixture.service.mutate({ token: fixture.service.branch().token, operation: "update", id: record.recordId, revision: record.revision, payload: { status: "HIDDEN", revisionReason: "hide" } });
    assert.equal(hidden.status, "HIDDEN");
    assert.equal(hidden.temporalMode, "TIMELESS");
    assert.equal(hidden.temporalSemantics, "DURABLE_WORLD_RULE");
    assert.equal(hidden.gameDate, null);
    assert.equal(hidden.totalDays, null);
    assert.equal(hidden.conflictKey, "rule:court-entry");
    console.log("V8.7.1 partial update temporal preservation PASS");
  } finally { fixture.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
