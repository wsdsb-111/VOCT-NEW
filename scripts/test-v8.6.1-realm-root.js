"use strict";

const assert = require("assert");
const { createRealmRootIndex, resolveKnowledgeScope } = require("../resources/app/out/main/worldline/knowledge-scope-resolver");

const snapshot = { gameDate: "1170.6.6", characters: {
  "1": { courtEmployer: "a", liege: "2" }, "2": { liege: "3" }, "3": {},
  "4": { courtEmployer: "b", topLiege: "3" }, "5": { courtEmployer: "c", liege: "6" }, "6": { liege: "5" }
} };
const roots = createRealmRootIndex(snapshot);
assert.equal(roots.get("1"), "3");
assert.equal(roots.get("4"), "3");
assert.equal(roots.get("5"), undefined, "cyclic liege data must remain unresolved");
assert.equal(resolveKnowledgeScope({ snapshot, responderId: "1", subjectId: "4", realmRootByCharacter: roots }).sameRealm, true);
assert.equal(resolveKnowledgeScope({ snapshot, responderId: "1", subjectId: "5", realmRootByCharacter: roots }).sameRealm, null);
console.log("V8.6.1 Realm Root: PASS (recursive roots, top liege and cycles fail closed)");
