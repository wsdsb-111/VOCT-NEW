"use strict";

const assert = require("assert");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");

(async () => {
  const fixture = createCanonFixture();
  try {
    await create(fixture.service, { title: "下月赴约", content: "韩世忠答应下月赴约", temporalMode: "PLANNED", gameDate: "1175.2.1", type: "PLANNED_DECISION", entities: ["2"] });
    await fixture.service.prepare();
    const recall = fixture.service.recall({ responderId: "1", query: "韩世忠赴约", entityIds: ["2"] });
    assert.equal(recall.selected.length, 1);
    assert.match(recall.text, /尚未发生/);
    console.log("V8.7.1 planned Canon PASS");
  } finally { fixture.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
