"use strict";
const assert = require("assert");
const { buildThirdPartyEvidencePatch } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");
const result = buildThirdPartyEvidencePatch({ query: "韩世忠答应了吗？", entities: [{ id: 3, aliases: ["韩世忠"], memories: [evidenceMemory({ type: "conflict", unresolved: true })] }] });
assert(result.conflict && result.text.includes("EVIDENCE_CONFLICT") && result.text.includes("不得随机选边"));
console.log("V8.6.2 Third-party Evidence Conflict: PASS");
