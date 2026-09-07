"use strict";
const assert = require("assert");
const { centralityFor } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");
assert.equal(centralityFor(evidenceMemory({ type: "promise", subjects: [3], provenance: {} }), 3, ["韩世忠"]), "PRIMARY_SUBJECT");
assert.equal(centralityFor(evidenceMemory({ type: "folder_summary", subjects: [3], provenance: { counterpartIds: [3] } }), 3, ["韩世忠"]), "COUNTERPART");
assert.equal(centralityFor(evidenceMemory({ type: "folder_summary", subjects: [3], provenance: {} }), 3, ["韩世忠"]), "PARTICIPANT_ONLY");
console.log("V8.6.2 Third-party Subject Centrality: PASS");
