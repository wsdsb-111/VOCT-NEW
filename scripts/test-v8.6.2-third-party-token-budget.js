"use strict";
const assert = require("assert");
const { buildThirdPartyEvidencePatch } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");
const estimate = (text) => Math.ceil(String(text || "").length / 2);
const result = buildThirdPartyEvidencePatch({ query: "韩世忠的承诺", tokenBudget: 512, estimateTokens: estimate, entities: [{ id: 3, aliases: ["韩世忠"], memories: [evidenceMemory({ content: "韩世忠承诺赴约。".repeat(500) })] }] });
assert(result.tokens <= 512);
assert(result.entities.every((entity) => entity.tokens <= 320));
console.log("V8.6.2 Third-party Token Budget: PASS");
