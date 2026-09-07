"use strict";
const assert = require("assert");
const { buildThirdPartyEvidencePatch } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");
const result = buildThirdPartyEvidencePatch({ query: "韩世忠为什么会答应那件事？", entities: [{ id: 3, aliases: ["韩世忠"], memories: [evidenceMemory()] }] });
assert.equal(result.triggered, true);
assert.equal(result.reason, "ENTITY_GROUNDED_RECALL");
console.log("V8.6.2 Third-party Evidence Trigger: PASS");
