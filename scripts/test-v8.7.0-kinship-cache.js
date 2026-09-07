"use strict";

const assert = require("assert");
const { getCachedKinshipGraph } = require("../resources/app/out/main/worldline/kinship-graph-cache");

let profileBuilds = 0;
const gameData = {
  campaignToken: "campaign-a",
  checkpointId: "checkpoint-a",
  gameDataRevision: 1,
  participantRelationRevision: 1,
  getMentionableCharacterProfiles() {
    profileBuilds++;
    return new Map([[1, { id: 1, children: [2] }], [2, { id: 2 }]]);
  }
};
const first = getCachedKinshipGraph(gameData);
const second = getCachedKinshipGraph(gameData);
assert.strictEqual(first, second);
assert.equal(profileBuilds, 1);
gameData.participantRelationRevision = 2;
const third = getCachedKinshipGraph(gameData);
assert.notStrictEqual(third, first);
assert.equal(profileBuilds, 2);
console.log("V8.7.0 Kinship Cache: PASS (revision-key reuse and invalidation)");
