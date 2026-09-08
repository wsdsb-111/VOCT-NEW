"use strict";

const assert = require("assert");
const { create, createCanonFixture } = require("./v8.7.1-canon-test-fixture");

(async () => {
  const fixture = createCanonFixture();
  try {
    await assert.rejects(create(fixture.service, { title: "官职", content: "韩世忠现任枢密使", temporalSemantics: "PAST_EVENT" }), /current_state_needs_structured_confirmation/);
    await assert.rejects(create(fixture.service, { title: "状态", content: "韩世忠如今活着" }), /current_state_needs_structured_confirmation/);
    console.log("V8.7.1 freeform current-state guard PASS");
  } finally { fixture.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
