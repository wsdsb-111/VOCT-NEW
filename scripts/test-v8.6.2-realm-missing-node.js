"use strict";

const assert = require("assert");
const { createRealmRootIndex, resolveKnowledgeScope } = require("../resources/app/out/main/worldline/knowledge-scope-resolver");

const snapshot = {
  gameDate: "1170.6.6",
  characters: {
    "1": { liege: "999" },
    "2": { topLiege: "999" },
    "3": {}
  }
};
const roots = createRealmRootIndex(snapshot);

assert.equal(roots.get("1"), undefined, "a missing liege node cannot become a realm root");
assert.equal(roots.get("2"), undefined, "a missing top-liege node cannot become a realm root");
const missingPair = resolveKnowledgeScope({ snapshot, responderId: "1", subjectId: "2", realmRootByCharacter: roots });
assert.equal(missingPair.sameRealm, null, "two references to the same missing node remain UNKNOWN, not same-realm true");
assert.equal(missingPair.completeness, "INCOMPLETE", "missing realm evidence fails closed");
assert.equal(roots.get("3"), "3", "a present root character remains its own verified realm root");

console.log("V8.6.2 Realm Missing Node: PASS (missing liege references fail closed)");
