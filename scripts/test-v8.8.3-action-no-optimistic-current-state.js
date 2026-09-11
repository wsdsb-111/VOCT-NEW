"use strict";

const assert = require("assert");
const playerPaysGoldTo = require("../resources/app/default_userdata/actions/standard/z_playerPaysGoldTo");
const paysGoldTo = require("../resources/app/default_userdata/actions/standard/z_paysGoldTo");

const player = { id: 1, shortName: "Player", gold: 1000 };
const npc = { id: 2, shortName: "NPC", gold: 200 };
const target = { id: 3, shortName: "Target", gold: 50 };
const gameData = { playerID: player.id, playerName: player.shortName, characters: new Map([[1, player], [2, npc], [3, target]]) };
let writes = 0;
const playerResult = playerPaysGoldTo.run({ gameData, sourceCharacter: npc, targetCharacter: target, args: { amount: 100 }, runGameEffect: () => { writes += 1; } });
const npcResult = paysGoldTo.run({ gameData, sourceCharacter: npc, targetCharacter: target, args: { amount: 100 }, runGameEffect: () => { writes += 1; } });
assert.strictEqual(writes, 2);
assert.strictEqual(player.gold, 1000, "player gold must remain parser-owned before CK3 confirmation");
assert.strictEqual(npc.gold, 200, "NPC gold must remain parser-owned before CK3 confirmation");
assert.strictEqual(target.gold, 50, "target gold must remain parser-owned before CK3 confirmation");
assert.deepStrictEqual(playerResult.expectedStateChange, { type: "GOLD_TRANSFER", sourceRuntimeId: 1, targetRuntimeId: 3, amount: 100 });
assert.deepStrictEqual(npcResult.expectedStateChange, { type: "GOLD_TRANSFER", sourceRuntimeId: 2, targetRuntimeId: 3, amount: 100 });
console.log("VOTC v8.8.3 no optimistic gold mutation fixtures: PASS");
