"use strict";

const assert = require("assert");
const { resolveKnowledgeScope } = require("../resources/app/out/main/worldline/knowledge-scope-resolver");

const snapshot = {
  gameDate: "1170.6.6",
  characters: {
    "1": { id: "1", courtEmployer: "10", liege: "20" },
    "2": { id: "2", courtEmployer: "10", liege: "20" },
    "3": { id: "3", courtEmployer: "11", liege: "21" },
    "20": { id: "20" },
    "21": { id: "21" }
  }
};

const same = resolveKnowledgeScope({ snapshot, responderId: "1", subjectId: "2" });
assert.equal(same.sameCourt, true);
assert.equal(same.sameRealm, true);
assert.equal(same.asOf, "1170.6.6");
assert.equal(same.completeness, "COMPLETE");

const different = resolveKnowledgeScope({ snapshot, responderId: "1", subjectId: "3" });
assert.equal(different.sameCourt, false);
assert.equal(different.sameRealm, false);

const incomplete = resolveKnowledgeScope({ snapshot: { gameDate: "1170.6.6", characters: { "1": {} } }, responderId: "1", subjectId: "2" });
assert.equal(incomplete.sameCourt, null);
assert.equal(incomplete.sameRealm, null);
assert.equal(incomplete.completeness, "INCOMPLETE");

console.log("V8.6 Knowledge Scope: PASS (court/realm proof, as-of and fail-closed incomplete scope)");
