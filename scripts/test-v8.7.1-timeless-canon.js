"use strict";

const assert = require("assert");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");

(async () => {
  const fixture = createCanonFixture();
  try {
    const record = await create(fixture.service, { title: "礼制", content: "祭礼必须使用青色灯笼", temporalMode: "TIMELESS", type: "WORLD_ANNOTATION", importance: "HIGH" });
    await fixture.service.prepare();
    const recall = fixture.service.recall({ responderId: "1", query: "祭礼灯笼" });
    assert.equal(record.gameDate, null);
    assert.equal(recall.selected.length, 1);
    console.log("V8.7.1 timeless Canon PASS");
  } finally { fixture.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
