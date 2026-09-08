"use strict";

const assert = require("assert");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");

(async () => {
  const fixture = createCanonFixture();
  try {
    const record = await create(fixture.service, { title: "秘密会面", content: "韩世忠与玩家约定在西湖秘密会面", entities: ["2"], visibility: "SECRET", knownBy: ["1", "2"] });
    const page = await fixture.service.list();
    const blocked = await fixture.service.testRecall({ token: page.branch.token, recordId: record.recordId, responderId: "3", query: "韩世忠会面" });
    assert.equal(blocked.visibility, "DENY");
    assert.equal(blocked.promptText, null);
    assert.equal(JSON.stringify(blocked).includes("西湖"), false);
    console.log("V8.7.1 secret test API redaction PASS");
  } finally { fixture.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
