"use strict";

const assert = require("assert");
const { ACTION_LIFECYCLE_STATUSES } = require("../resources/app/out/main/actions/types");
const { captureActionConfirmation, verifyActionConfirmation, settleActionResult } = require("../resources/app/out/main/actions/action-confirmation");

const beforeGameData = { characters: new Map([[1, { id: 1, gold: 1000 }], [2, { id: 2, gold: 200 }]]) };
const expected = { type: "GOLD_TRANSFER", sourceRuntimeId: 1, targetRuntimeId: 2, amount: 100 };
const confirmation = captureActionConfirmation({ actionId: "playerPaysGoldTo", expectedStateChange: expected, gameData: beforeGameData, gameDataRevision: 4, dispatch: { commandId: "rc6-test", status: "awaiting_ack" } });

assert.deepStrictEqual(confirmation.before, { sourceGold: 1000, targetGold: 200, gameDataRevision: 4 });
assert.strictEqual(verifyActionConfirmation({ confirmation, gameData: beforeGameData, gameDataRevision: 4 }).status, "PENDING");
assert.strictEqual(verifyActionConfirmation({ confirmation, gameData: { characters: new Map([[1, { gold: 900 }], [2, { gold: 300 }]]) }, gameDataRevision: 5 }).status, ACTION_LIFECYCLE_STATUSES.CONFIRMED);
assert.strictEqual(verifyActionConfirmation({ confirmation, gameData: { characters: new Map([[1, { gold: 1000 }], [2, { gold: 200 }]]) }, gameDataRevision: 5 }).status, ACTION_LIFECYCLE_STATUSES.UNCONFIRMED);
assert.strictEqual(verifyActionConfirmation({ confirmation, gameData: { characters: new Map([[1, { gold: 900 }], [2, { gold: 200 }]]) }, gameDataRevision: 5 }).status, ACTION_LIFECYCLE_STATUSES.STATE_MISMATCH);
const settled = settleActionResult({ actionId: "playerPaysGoldTo", success: false, feedback: { message: "pending", sentiment: "neutral" }, diagnostic: { actionId: "playerPaysGoldTo" } }, { status: ACTION_LIFECYCLE_STATUSES.CONFIRMED, stateAfter: { sourceGold: 900, targetGold: 300 }, revisionAfter: 5, confirmedStateChange: expected });
assert.strictEqual(settled.success, true);
assert.strictEqual(settled.lifecycle.status, ACTION_LIFECYCLE_STATUSES.CONFIRMED);
console.log("VOTC v8.8.3 Gold confirmation fixtures: PASS");
