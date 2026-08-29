"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionsRoot = path.join(root, "resources/app/default_userdata/actions/standard");
const catalogBuilder = require(path.join(root, "resources/app/out/main/action-system/v4/catalog/available-action-catalog"));
const { actionMetadata, isValidTargetPolicy, targetAllowed } = require(path.join(root, "resources/app/out/main/action-system/v4/catalog/master-action-dictionary"));
const proposalValidator = require(path.join(root, "resources/app/out/main/action-system/v4/proposal/action-proposal-validator"));
const fastActionResolver = require(path.join(root, "resources/app/out/main/action-system/v4/performance/fast-action-resolver"));

function character(id, name) {
  return { id, shortName: name, fullName: name, gold: 500, relationsToCharacters: [] };
}

function loadAction(fileName) {
  const definition = require(path.join(actionsRoot, fileName));
  return { id: definition.signature, filePath: fileName, definition, validation: { valid: true } };
}

function fixtureAction(id, targetPolicy) {
  return {
    id,
    filePath: id,
    validation: { valid: true },
    definition: {
      signature: id,
      title: id,
      description: id,
      args: [],
      actionMetadata: targetPolicy === undefined ? {} : { targetPolicy },
      check: ({ gameData }) => ({ canExecute: true, validTargetCharacterIds: [...gameData.characters.keys()] }),
      run: () => null
    }
  };
}

function requiredArguments(entry) {
  const values = {};
  for (const argument of entry.arguments) {
    if (!argument.required) continue;
    if (argument.type === "enum") values[argument.name] = argument.options[0];
    else if (argument.type === "number") values[argument.name] = argument.min ?? 1;
    else if (argument.type === "boolean") values[argument.name] = true;
    else values[argument.name] = "test";
  }
  return values;
}

const player = character(1, "玩家");
const npcA = character(2, "甲");
const npcB = character(3, "乙");
const gameData = { playerID: 1, playerName: "玩家", characters: new Map([[1, player], [2, npcA], [3, npcB]]) };
const loadedActions = [
  loadAction("z_setEmotion.js"),
  loadAction("z_isUndressed.js"),
  loadAction("z_paysGoldTo.js"),
  loadAction("z_isImprisonedBy.js"),
  loadAction("z_isInjured.js"),
  loadAction("z_characterIsKilled.js"),
  loadAction("z_becomeFriendsWith.js"),
  loadAction("z_changeLocation.js"),
  fixtureAction("implicitOther"),
  fixtureAction("selfOnly", "self_only"),
  fixtureAction("unknownPolicy", "invalid_policy")
];
const loadedById = new Map(loadedActions.map((action) => [action.id, action]));
const validationErrors = [];
const registry = {
  getAllActions: () => loadedActions,
  getById: (id) => loadedById.get(id) || null,
  isActionDisabled: () => false,
  registerValidation: (id, validation) => validationErrors.push({ id, validation })
};
const conversation = {
  gameData,
  messages: [],
  inactiveParticipantIds: new Map(),
  getActiveConversationCharacters: () => [player, npcA, npcB]
};

function entry(catalog, actionId, sourceId = npcA.id) {
  const found = catalogBuilder.findEntry(catalog, actionId, sourceId);
  assert(found, `${actionId} must be available for source ${sourceId}`);
  return found;
}

async function validate(catalog, actionId, targetCharacterId, sourceCharacterId = npcA.id, argumentsValue = null) {
  const actionEntry = entry(catalog, actionId, sourceCharacterId);
  return proposalValidator.validate({
    proposal: {
      type: "action_call",
      actionId,
      sourceCharacterId,
      targetCharacterId,
      arguments: argumentsValue || requiredArguments(actionEntry),
      evidenceMessageIds: [1],
      confidence: 1
    },
    catalog,
    conversation,
    registry
  });
}

(async () => {
  assert.strictEqual(actionMetadata({ definition: {} }).targetPolicy, "other_only", "undeclared actions must default to other_only");
  assert.strictEqual(isValidTargetPolicy("invalid_policy"), false);
  assert.strictEqual(targetAllowed("invalid_policy", npcA.id, npcA.id), false, "unknown policy must fail closed");

  const catalog = await catalogBuilder.build({ conversation, speaker: npcA, registry, language: "zh", resolveI18nString: (value) => typeof value === "string" ? value : value.zh || value.en });
  assert(validationErrors.some((item) => item.id === "unknownPolicy"), "unknown policy must be rejected while building the catalog");
  assert.strictEqual(catalogBuilder.findEntry(catalog, "unknownPolicy", npcA.id), null);

  for (const actionId of ["setEmotion", "isUndressed"]) {
    const actionEntry = entry(catalog, actionId);
    assert.strictEqual(actionEntry.targetPolicy, "self_or_other");
    assert(actionEntry.validTargetCharacterIds.includes(npcA.id), `${actionId} catalog must retain self target`);
    assert.strictEqual((await validate(catalog, actionId, npcA.id)).valid, true, `${actionId} self-target must pass`);
  }

  for (const actionId of ["paysGoldTo", "isImprisonedBy", "isInjured", "characterIsKilled", "becomeFriendsWith", "implicitOther"]) {
    const actionEntry = entry(catalog, actionId);
    assert.strictEqual(actionEntry.targetPolicy, "other_only", `${actionId} must use the safe default`);
    assert(!actionEntry.validTargetCharacterIds.includes(npcA.id), `${actionId} catalog must exclude self target`);
    assert.strictEqual((await validate(catalog, actionId, npcA.id)).valid, false, `${actionId} self-target must be rejected`);
  }

  for (const actionId of ["paysGoldTo", "isImprisonedBy", "isInjured", "characterIsKilled", "becomeFriendsWith"]) {
    assert.strictEqual((await validate(catalog, actionId, npcB.id)).valid, true, `${actionId} ordinary other-target must still pass`);
  }

  const selfOnly = entry(catalog, "selfOnly");
  assert.deepStrictEqual(selfOnly.validTargetCharacterIds, [npcA.id]);
  assert.strictEqual((await validate(catalog, "selfOnly", npcA.id)).valid, true);
  assert.strictEqual((await validate(catalog, "selfOnly", npcB.id)).valid, false);

  const noTarget = entry(catalog, "changeLocation");
  assert.strictEqual(noTarget.targetPolicy, "none");
  assert.strictEqual(noTarget.requiresTarget, false);
  assert.deepStrictEqual(noTarget.validTargetCharacterIds, []);
  assert.strictEqual((await validate(catalog, "changeLocation", null)).valid, true);
  assert.strictEqual((await validate(catalog, "changeLocation", npcA.id)).valid, false);
  assert.strictEqual((await validate(catalog, "changeLocation", "missing_character")).valid, false);

  const serialized = JSON.parse(catalogBuilder.serialize(catalog));
  assert(catalog.entries.every((item) => isValidTargetPolicy(item.targetPolicy)), "internal catalog must retain a valid targetPolicy for every action");
  assert(serialized.every((item) => !Object.prototype.hasOwnProperty.call(item, "targetPolicy")), "Dynamic Catalog must not duplicate stable targetPolicy tokens");

  let resolution = fastActionResolver.resolve({ message: { id: 10, content: "他笑了起来。" }, speaker: npcA, catalog });
  assert.strictEqual(resolution.status, "HIT");
  assert.deepStrictEqual([resolution.decision.actionId, resolution.decision.sourceCharacterId, resolution.decision.targetCharacterId], ["setEmotion", npcA.id, npcA.id]);
  resolution = fastActionResolver.resolve({ message: { id: 11, content: "她脱下了自己的衣服。" }, speaker: npcA, catalog });
  assert.strictEqual(resolution.status, "HIT");
  assert.deepStrictEqual([resolution.decision.actionId, resolution.decision.sourceCharacterId, resolution.decision.targetCharacterId], ["isUndressed", npcA.id, npcA.id]);

  const paymentSelf = await validate(catalog, "paysGoldTo", npcA.id, npcA.id, { amount: 100 });
  assert.strictEqual(paymentSelf.valid, false, "他给自己支付了一百金币 must be rejected by local legality validation");

  const fakeUnknownCatalog = {
    entries: [{ ...entry(catalog, "implicitOther"), actionId: "unknownPolicy", targetPolicy: "invalid_policy", metadata: { ...entry(catalog, "implicitOther").metadata, targetPolicy: "invalid_policy" } }]
  };
  const unknownResult = await proposalValidator.validate({
    proposal: { actionId: "unknownPolicy", sourceCharacterId: npcA.id, targetCharacterId: npcB.id, arguments: {} },
    catalog: fakeUnknownCatalog,
    conversation,
    registry
  });
  assert.deepStrictEqual({ valid: unknownResult.valid, reason: unknownResult.reason }, { valid: false, reason: "rejected_invalid_target_policy" });

  const catalogSource = fs.readFileSync(path.join(root, "resources/app/out/main/action-system/v4/catalog/available-action-catalog.js"), "utf8");
  const validatorSource = fs.readFileSync(path.join(root, "resources/app/out/main/action-system/v4/proposal/action-proposal-validator.js"), "utf8");
  assert(!catalogSource.includes("setEmotion") && !catalogSource.includes("isUndressed"), "catalog target legality must not use action-name exceptions");
  assert(!validatorSource.includes("setEmotion") && !validatorSource.includes("isUndressed"), "validator target legality must not use action-name exceptions");
  assert(!/Number\(targetCharacterId\)\s*===\s*Number\(sourceCharacterId\)/.test(validatorSource), "validator must not restore a global source == target rejection");

  console.log("PASS v7.9.3 AE4 Errata-001 metadata-driven self-target policy");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
