"use strict";
const assert = require("assert");
const { buildThirdPartyEvidencePatch } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");
const result = buildThirdPartyEvidencePatch({ query: "韩世忠承诺", tokenBudget: 192, estimateTokens: (text) => Math.ceil(String(text || "").length / 2), entities: [{ id: 3, aliases: ["韩世忠"], memories: [evidenceMemory()] }] });
assert(result.tokens <= 192);
console.log("V8.6.2 Token Regression: PASS");
