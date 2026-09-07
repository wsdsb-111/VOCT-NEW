"use strict";

const assert = require("assert");
const { buildThirdPartyEvidencePatch, scoreEvidence } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");

const witnessed = scoreEvidence(evidenceMemory({ memoryId: "w", source: "witnessed", confidence: 0.8 }), { query: "韩世忠是否赴约", entityId: 3, aliases: ["韩世忠"] });
const rumor = scoreEvidence(evidenceMemory({ memoryId: "r", source: "rumor", confidence: 0.8 }), { query: "韩世忠是否赴约", entityId: 3, aliases: ["韩世忠"] });
assert(witnessed.score > rumor.score, "source authority must participate in ranking");

const result = buildThirdPartyEvidencePatch({
  query: "韩世忠是否赴约？",
  entities: [{ id: 3, aliases: ["韩世忠"], memories: [
    evidenceMemory({ memoryId: "yes", conflictKey: "赴约", polarity: "YES", source: "witnessed", content: "韩世忠明确答应赴约。" }),
    evidenceMemory({ memoryId: "noise", conflictKey: "别事", polarity: "YES", source: "witnessed", content: "韩世忠谈及军务。", importance: 1 }),
    evidenceMemory({ memoryId: "no", conflictKey: "赴约", polarity: "NO", source: "witnessed", content: "韩世忠明确拒绝赴约。", importance: 0.1 })
  ] }]
});
assert(result.conflict, "conflict audit must inspect the relevant pool before Top-K selection");
assert(result.text.includes("EVIDENCE_CONFLICT"));
assert.deepStrictEqual(new Set(result.entities[0].selected.map((entry) => entry.memory.memoryId)), new Set(["yes", "no"]));
console.log("V8.7.0 Third-party Authority / Conflict: PASS (authority rank and pre-Top-K audit)");
