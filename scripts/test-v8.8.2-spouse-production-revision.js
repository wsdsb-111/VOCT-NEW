"use strict";

const assert = require("assert");
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");
const { revisionKey } = require("../resources/app/out/main/worldline/kinship-graph-cache");

const aliveSource = 'date=1175.1.1 living={ 1={ first_name="甲" female=no birth=1150.1.1 } }';
const changedDemographicsSource = 'date=1175.1.1 dead_unprunable={ 1={ first_name="甲" female=yes birth=1149.1.1 death=1174.1.1 } }';
const aliveSnapshot = parseGameState(aliveSource);
const changedSnapshot = parseGameState(changedDemographicsSource);

assert.notEqual(aliveSnapshot.contentFingerprint, changedSnapshot.contentFingerprint, "production gamestate demographic changes must change the full-content fingerprint");
assert.notEqual(revisionKey(aliveSnapshot), revisionKey(changedSnapshot), "production content fingerprints must invalidate the kinship cache key");

console.log("V8.8.2 Spouse Production Revision: PASS");
