"use strict";

const assert = require("assert");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");

(async () => {
  const fixture = createCanonFixture();
  try {
    const ordinary = await create(fixture.service, { title: "赴约约定", content: "韩世忠答应下月赴约", entities: ["2"] });
    await fixture.service.prepare();
    const first = fixture.service.recall({ responderId: "1", query: "韩世忠何时赴约", entityIds: ["2"] });
    const second = fixture.service.recall({ responderId: "1", query: "韩世忠何时赴约", entityIds: ["2"] });
    const unrelated = fixture.service.recall({ responderId: "1", query: "今日天气如何", entityIds: [] });
    assert.deepEqual(first.selected.map((item) => item.recordId), [ordinary.recordId]);
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(unrelated.cacheHit, false);
    assert.equal(unrelated.selected.length, 0);

    await create(fixture.service, { title: "宫门礼仪", content: "入殿前必须先通报", type: "WORLD_ANNOTATION", visibility: "SECRET", knownBy: ["1"], importance: "HIGH", temporalMode: "TIMELESS", conversationStable: true });
    await fixture.service.prepare();
    const authorized = fixture.service.recall({ responderId: "1", stable: true, conversationId: "conversation-a" });
    const blocked = fixture.service.recall({ responderId: "2", stable: true, conversationId: "conversation-a" });
    assert.match(authorized.text, /入殿前必须先通报/);
    assert.equal(blocked.text, null);
    assert.equal(JSON.stringify(blocked).includes("入殿前必须先通报"), false);
    console.log("V8.7.1 cache regression PASS");
  } finally { fixture.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
