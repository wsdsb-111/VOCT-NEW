"use strict";

const assert = require("assert");
const { createSharedCandidatePool } = require("../resources/app/out/main/worldline/shared-candidate-pool");

let builds = 0;
const cache = new Map();
const makePool = () => createSharedCandidatePool({
  cache,
  key: "checkpoint:query:revisions",
  build: () => { builds += 1; return [{ id: "public:1", knowledgeLevel: "PUBLIC_WORLD", public: true, temporalSafe: true }]; }
});

const first = makePool();
const second = makePool();
assert.equal(builds, 1, "same safe query/revisions build one shared candidate pool");
assert.equal(first.cacheHit, false);
assert.equal(second.cacheHit, true);
assert.equal(JSON.stringify(first.candidates).includes("SECRET"), false, "shared pools carry only metadata candidates");

console.log("V8.6 Shared Candidate Pool: PASS (single build, cache reuse and no secret body cache)");
