"use strict";

const assert = require("assert");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");

(async () => {
  const fixture = createCanonFixture({ gameDate: "1175.1.1", totalDays: 430000 });
  try {
    const record = await create(fixture.service, { title: "赴约", content: "韩世忠答应赴约", entities: ["2"] });
    assert.equal(record.temporalMode, "CURRENT_DATE");
    assert.equal(record.gameDate, "1175.1.1");
    assert.equal(record.totalDays, 430000);
    console.log("V8.7.1 current-date default PASS");
  } finally { fixture.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
