"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { captureActionConfirmation, verifyActionConfirmation } = require("../resources/app/out/main/actions/action-confirmation");
const { readActionCommandReadback } = require("../resources/app/out/main/actions/action-command-readback");
const { createActionEngine } = require("../resources/app/out/main/actions/action-engine");
const { ActionSandbox } = require("../resources/app/out/main/actions/action-sandbox");

const action = require("../resources/app/default_userdata/actions/standard/z_becomesTributaryOf.js");
const contractAction = require("../resources/app/default_userdata/actions/standard/z_changesTributaryContract.js");
const player = { id: 1, shortName: "玩家", isLandedRuler: true, isIndependentRuler: true };
const npc = { id: 2, shortName: "甲", isLandedRuler: true, isIndependentRuler: true };
const other = { id: 3, shortName: "乙", isLandedRuler: true, isIndependentRuler: true };
const vassal = { id: 4, shortName: "丙", isLandedRuler: true, isIndependentRuler: false };
const gameData = { playerID: 1, playerName: "玩家", characters: new Map([[1, player], [2, npc], [3, other], [4, vassal]]) };

const availability = action.check({ gameData, sourceCharacter: npc });
assert(availability.canExecute);
assert.deepStrictEqual(Array.from(availability.validTargetCharacterIds), [1, 2, 3]);
assert(!availability.validTargetCharacterIds.includes(4));
assert(contractAction.check({ gameData, sourceCharacter: npc }).canExecute);

const contractGroups = ["tributary_non_permanent", "tributary_permanent", "tributary_civilized", "tributary_league", "tributary_patronage", "tributary_subjugated"];
for (const [direction, tributaryId, suzerainId] of [["offer", 2, 3], ["demand", 3, 2]]) {
  for (const contractGroup of contractGroups) {
    let contractEffect = null;
    const result = contractAction.run({ gameData, sourceCharacter: npc, targetCharacter: other,
      args: { direction, contractGroup }, runGameEffect: (value) => { contractEffect = value; } });
    assert(contractEffect.includes("is_tributary_of ="), "existing exact tributary relationship must be checked");
    assert(contractEffect.indexOf("is_tributary_of =") < contractEffect.indexOf("end_tributary = yes"));
    assert(contractEffect.includes(`start_tributary = { contract_group = ${contractGroup}`));
    assert(contractEffect.indexOf(`has_subject_contract_group = ${contractGroup} }\n                add_trait = tributary`) > contractEffect.indexOf(`start_tributary = { contract_group = ${contractGroup}`),
      "mod trait and XP effects must only run after target contract readback");
    assert(contractEffect.includes("has_subject_contract_group = tributary_subjugated"), "old group must be captured before replacement");
    assert(contractEffect.includes("VOTC:TRIBUTARY_CONTRACT_ROLLBACK_FAILED"), "failed replacement must surface rollback failure");
    assert(!contractEffect.includes("start_tributary_interaction_effect"), "contract selection must not establish a new relationship");
    if (contractGroup === "tributary_civilized") assert(contractEffect.includes("TributeSystem_suzerain_is_civilized_trigger = yes"));
    if (contractGroup === "tributary_league") assert(contractEffect.includes("TributeSystem_suzerain_is_league_trigger = yes"));
    if (contractGroup === "tributary_patronage") assert(contractEffect.includes("TributeSystem_suzerain_is_patronage_trigger = yes"));
    assert.strictEqual(result.expectedStateChange.type, "TRIBUTARY_CONTRACT");
    assert.strictEqual(result.expectedStateChange.contractGroup, contractGroup);
    assert.strictEqual(result.expectedStateChange.tributaryRuntimeId, tributaryId);
    assert.strictEqual(result.expectedStateChange.suzerainRuntimeId, suzerainId);
  }
}
let playerContractEffect = null;
const playerContractResult = contractAction.run({ gameData, sourceCharacter: npc, targetCharacter: npc,
  args: { direction: "demand", contractGroup: "tributary_permanent", isPlayerSource: true }, runGameEffect: (value) => { playerContractEffect = value; } });
assert(/global_var:votc_action_target = \{\s*is_landed = yes\s*is_tributary_of = global_var:votc_action_source/.test(playerContractEffect));
assert.strictEqual(playerContractResult.expectedStateChange.sourceRuntimeId, 1);
for (const [target, args] of [[undefined, { direction: "offer", contractGroup: "tributary_permanent" }],
  [npc, { direction: "offer", contractGroup: "tributary_permanent" }],
  [vassal, { direction: "demand", contractGroup: "tributary_permanent" }],
  [other, { direction: "offer", contractGroup: "invalid" }],
  [other, { direction: "invalid", contractGroup: "tributary_permanent" }]]) {
  let dispatched = false;
  const result = contractAction.run({ gameData, sourceCharacter: npc, targetCharacter: target,
    args, runGameEffect: () => { dispatched = true; } });
  assert.strictEqual(result.sentiment, "negative");
  assert.strictEqual(dispatched, false);
}

for (const direction of ["offer", "demand"]) {
  let effect = null;
  const result = action.run({ gameData, sourceCharacter: npc, targetCharacter: other, args: { direction }, runGameEffect: (value) => { effect = value; } });
  assert(effect.includes("start_tributary_interaction_effect"));
  assert(effect.includes("can_have_tributaries_trigger = yes"));
  assert(effect.includes("is_tributary_of ="));
  assert.strictEqual(result.expectedStateChange.type, "TRIBUTARY_RELATION");
  assert.strictEqual(result.expectedStateChange.tributaryRuntimeId, direction === "offer" ? 2 : 3);
  assert.strictEqual(result.expectedStateChange.suzerainRuntimeId, direction === "offer" ? 3 : 2);
  assert.strictEqual(result.expectedStateChange.sourceRuntimeId, 2);
  assert.strictEqual(result.expectedStateChange.targetRuntimeId, 3);
}

let effect = null;
const playerResult = action.run({ gameData, sourceCharacter: npc, targetCharacter: npc, args: { direction: "demand", isPlayerSource: true }, runGameEffect: (value) => { effect = value; } });
assert(effect.includes("TRIBUTARY = global_var:votc_action_target"));
assert.strictEqual(playerResult.expectedStateChange.sourceRuntimeId, 1);
assert.strictEqual(playerResult.expectedStateChange.tributaryRuntimeId, 2);
assert.strictEqual(playerResult.expectedStateChange.suzerainRuntimeId, 1);

for (const [target, args] of [[undefined, { direction: "offer" }], [npc, { direction: "offer" }], [vassal, { direction: "offer" }], [other, { direction: "invalid" }], [player, { direction: "offer", isPlayerSource: true }]]) {
  let dispatched = false;
  const result = action.run({ gameData, sourceCharacter: npc, targetCharacter: target, args, runGameEffect: () => { dispatched = true; } });
  assert.strictEqual(result.sentiment, "negative");
  assert.strictEqual(dispatched, false);
}

const expectedStateChange = { type: "TRIBUTARY_RELATION", sourceRuntimeId: 2, targetRuntimeId: 3, tributaryRuntimeId: 2, suzerainRuntimeId: 3 };
const confirmation = captureActionConfirmation({ actionId: action.signature, expectedStateChange, dispatch: { commandId: "tribute-1", status: "awaiting_ack" } });
assert.strictEqual(confirmation.type, "TRIBUTARY_RELATION");
assert.strictEqual(verifyActionConfirmation({ confirmation, commandReadback: { commandId: "tribute-1", acknowledged: true, sourceRuntimeId: 2, targetRuntimeId: 3, tributaryEstablished: true } }).status, "CONFIRMED");
assert.strictEqual(verifyActionConfirmation({ confirmation, commandReadback: { commandId: "tribute-1", acknowledged: true, sourceRuntimeId: 2, targetRuntimeId: 3, tributaryRejected: true } }).status, "NO_EFFECT");
assert.strictEqual(verifyActionConfirmation({ confirmation, commandReadback: { commandId: "tribute-1", acknowledged: true, sourceRuntimeId: 2, targetRuntimeId: 3 } }).status, "UNCONFIRMED");
assert.strictEqual(verifyActionConfirmation({ confirmation, commandReadback: { commandId: "tribute-1", acknowledged: true, sourceRuntimeId: 3, targetRuntimeId: 2, tributaryEstablished: true } }).status, "BINDING_FAILED");
const contractConfirmation = captureActionConfirmation({ actionId: contractAction.signature,
  expectedStateChange: { type: "TRIBUTARY_CONTRACT", sourceRuntimeId: 2, targetRuntimeId: 3, tributaryRuntimeId: 2, suzerainRuntimeId: 3, contractGroup: "tributary_permanent" },
  dispatch: { commandId: "contract-1", status: "awaiting_ack" } });
assert.strictEqual(verifyActionConfirmation({ confirmation: contractConfirmation, commandReadback: { commandId: "contract-1", acknowledged: true, sourceRuntimeId: 2, targetRuntimeId: 3, tributaryContractGroup: "tributary_permanent" } }).status, "CONFIRMED");
assert.strictEqual(verifyActionConfirmation({ confirmation: contractConfirmation, commandReadback: { commandId: "contract-1", acknowledged: true, sourceRuntimeId: 2, targetRuntimeId: 3, tributaryContractRejected: true } }).status, "NO_EFFECT");
assert.strictEqual(verifyActionConfirmation({ confirmation: contractConfirmation, commandReadback: { commandId: "contract-1", acknowledged: true, sourceRuntimeId: 2, targetRuntimeId: 3, tributaryContractGroup: "tributary_league" } }).status, "STATE_MISMATCH");
assert.strictEqual(verifyActionConfirmation({ confirmation: contractConfirmation, commandReadback: { commandId: "contract-1", acknowledged: true, sourceRuntimeId: 2, targetRuntimeId: 3, tributaryContractRollbackFailed: true } }).status, "STATE_MISMATCH");
assert.strictEqual(verifyActionConfirmation({ confirmation: contractConfirmation, commandReadback: { commandId: "contract-1", acknowledged: true, sourceRuntimeId: 2, targetRuntimeId: 3 } }).status, "UNCONFIRMED");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-tributary-readback-"));
const logPath = path.join(temporary, "debug.log");
fs.writeFileSync(logPath, 'VOTC:ACTION_BEGIN/ACTION_EFFECT/tribute-1\nVOTC:ACTION_SOURCE/;/2\nVOTC:ACTION_TARGET/;/3\nVOTC:TRIBUTARY_ESTABLISHED\nVOTC:RUN_ACK/ACTION_EFFECT/tribute-1\n');
readActionCommandReadback(logPath, "tribute-1").then(async (readback) => {
  assert.strictEqual(readback.tributaryEstablished, true);
  assert.strictEqual(readback.sourceRuntimeId, 2);
  assert.strictEqual(readback.targetRuntimeId, 3);
  fs.writeFileSync(logPath, 'VOTC:ACTION_BEGIN/ACTION_EFFECT/contract-1\nVOTC:ACTION_SOURCE/;/2\nVOTC:ACTION_TARGET/;/3\nVOTC:TRIBUTARY_CONTRACT_CONFIRMED/tributary_permanent\nVOTC:RUN_ACK/ACTION_EFFECT/contract-1\n');
  const contractReadback = await readActionCommandReadback(logPath, "contract-1");
  assert.strictEqual(contractReadback.tributaryContractGroup, "tributary_permanent");
  assert.strictEqual(verifyActionConfirmation({ confirmation: contractConfirmation, commandReadback: contractReadback }).status, "CONFIRMED");
  fs.writeFileSync(logPath, 'VOTC:ACTION_BEGIN/ACTION_EFFECT/contract-1\nVOTC:ACTION_SOURCE/;/2\nVOTC:ACTION_TARGET/;/3\nVOTC:TRIBUTARY_CONTRACT_ROLLBACK_FAILED\nVOTC:RUN_ACK/ACTION_EFFECT/contract-1\n');
  assert.strictEqual((await readActionCommandReadback(logPath, "contract-1")).tributaryContractRollbackFailed, true);
  let dispatchSourceId = null;
  const Engine = createActionEngine({
    actionRegistry: { getById: (id) => ({ validation: { valid: true }, filePath: path.join(__dirname, `../resources/app/default_userdata/actions/standard/z_${id}.js`) }) },
    settingsRepository: { getLanguage: () => "zh" },
    ActionSandbox,
    ActionEffectWriter: { writeEffect: (_data, sourceId, targetId) => { dispatchSourceId = sourceId; assert.strictEqual(targetId, 2); return { commandId: "tribute-1", status: "queued", hasCommandEnvelope: true }; } },
    resolveI18nString: (value) => typeof value === "object" ? value.zh : value
  });
  const conversation = { id: "test", gameData, messages: [], getHistory: () => [] };
  const submitted = await Engine.runInvocation(conversation, npc, { actionId: action.signature, targetCharacterId: 2, args: { direction: "demand", isPlayerSource: true } });
  assert.strictEqual(dispatchSourceId, 1, "player-initiated demand must bind the player as CK3 source");
  assert.strictEqual(submitted.success, false, "queued tribute must not claim confirmed success");
  assert.strictEqual(submitted.confirmation.type, "TRIBUTARY_RELATION");
  const contractSubmitted = await Engine.runInvocation(conversation, npc, { actionId: contractAction.signature, targetCharacterId: 2,
    args: { direction: "demand", contractGroup: "tributary_permanent", isPlayerSource: true } });
  assert.strictEqual(dispatchSourceId, 1, "player contract proposal must bind the player as CK3 source");
  assert.strictEqual(contractSubmitted.success, false);
  assert.strictEqual(contractSubmitted.confirmation.type, "TRIBUTARY_CONTRACT");
  console.log("V8.14 tributary action tests passed");
}).finally(() => fs.rmSync(temporary, { recursive: true, force: true }));
