"use strict";

const assert = require("assert");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");

(async () => {
  const fixture = createCanonFixture({ gameDate: "1175.1.1", totalDays: 430000 });
  try {
    const record = await create(fixture.service, { title: "赴约", content: "韩世忠答应赴约", entities: ["2"] });
    fixture.advance({ gameDate: "1175.1.2", totalDays: 430001 });
    const page = await fixture.service.list();
    assert.equal(page.branch.state, "SAME_BRANCH");
    assert.equal(page.records[0].recordId, record.recordId);
    await fixture.service.prepare();
    assert.equal(fixture.service.recall({ responderId: "1", query: "韩世忠赴约", entityIds: ["2"] }).selected.length, 1);
    console.log("V8.7.1 Canon survives checkpoint advance PASS");
  } finally { fixture.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
