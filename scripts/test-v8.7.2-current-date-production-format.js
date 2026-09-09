"use strict";

const assert = require("assert");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");

(async () => {
  const fixture = createCanonFixture({ gameDate: "1175年8月23日", totalDays: 429334 });
  try {
    const page = await fixture.service.list();
    assert.equal(page.branch.gameDate, "1175.8.23", "branch identity must be canonical internally");
    const record = await create(fixture.service, { title: "生产日期约定", content: "韩世忠答应在该日确认约定", entities: ["2"] });
    assert.equal(record.temporalMode, "CURRENT_DATE");
    assert.equal(record.gameDate, "1175.8.23", "localized Live/Checkpoint date must be canonicalized before storage");
    assert.equal(record.totalDays, 429334);
    console.log("V8.7.2 CURRENT_DATE production-format chain PASS");
  } finally { fixture.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
