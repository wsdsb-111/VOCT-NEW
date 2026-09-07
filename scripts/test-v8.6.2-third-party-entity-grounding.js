"use strict";
const assert = require("assert");
const { buildThirdPartyEvidencePatch } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");
const result = buildThirdPartyEvidencePatch({ query: "韩世忠为何拒绝？", entities: [{ id: 3, aliases: ["韩世忠"], memories: [evidenceMemory({ content: "韩世忠参与过讨论，但记录没有说明拒绝原因。" })] }] });
assert(result.triggered && result.text.includes("韩世忠"));
assert(!/记得|以前|上次/.test("韩世忠为何拒绝？"));
console.log("V8.6.2 Third-party Entity Grounding: PASS");
