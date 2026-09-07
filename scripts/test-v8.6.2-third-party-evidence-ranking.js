"use strict";
const assert = require("assert");
const { scoreEvidence } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");
const primary = scoreEvidence(evidenceMemory({ type: "promise", subjects: [3], provenance: {} }), { query: "承诺", entityId: 3, aliases: ["韩世忠"] });
const participant = scoreEvidence(evidenceMemory({ memoryId: "p", type: "folder_summary", subjects: [3], participants: [3], provenance: {} }), { query: "承诺", entityId: 3, aliases: ["韩世忠"] });
assert(primary.score > participant.score);
console.log("V8.6.2 Third-party Evidence Ranking: PASS");
