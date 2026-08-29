"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionsRoot = path.join(root, "resources/app/default_userdata/actions/standard");
const { compactDictionary } = require(path.join(root, "resources/app/out/main/action-system/v4/catalog/master-action-dictionary"));
const availableActionCatalog = require(path.join(root, "resources/app/out/main/action-system/v4/catalog/available-action-catalog"));
const precisionPrompt = require(path.join(root, "resources/app/out/main/action-system/v4/precision/precision-selector-prompt"));
const compactSelector = require(path.join(root, "resources/app/out/main/action-system/v4/performance/compact-action-selector"));
const benchmark = require("./action-engine-v4-benchmark");

function load(fileName) {
  const definition = require(path.join(actionsRoot, fileName));
  return { id: definition.signature, filePath: fileName, definition, validation: { valid: true } };
}

function character(id, name, extra = {}) {
  return { id, shortName: name, fullName: name, gold: 500, relationsToCharacters: [], ...extra };
}

const actions = [
  load("z_characterIsKilled.js"),
  load("z_isInjured.js"),
  load("z_playerPaysGoldTo.js"),
  load("z_paysGoldTo.js"),
  load("z_changeOpinionOf.js")
];
const dictionary = compactDictionary(actions);

function contract(actionId) {
  const value = dictionary.find((entry) => entry.actionId === actionId);
  assert(value, `${actionId} must exist in Master Compact Action Dictionary`);
  for (const field of ["shortDescription", "sourceRole", "targetRole", "executionMode", "targetPolicy", "requiredArguments", "optionalArguments", "relationshipTransition", "riskLevel"]) {
    assert(Object.prototype.hasOwnProperty.call(value, field), `${actionId} contract must expose ${field}`);
  }
  assert(!Object.prototype.hasOwnProperty.call(value, "description"), "Master contract must not contain the full description field");
  assert(value.shortDescription.length <= 180, "shortDescription must remain compact");
  return value;
}

assert.deepStrictEqual([contract("characterIsKilled").sourceRole, contract("characterIsKilled").targetRole], ["victim", "killer"]);
assert.deepStrictEqual([contract("isInjured").sourceRole, contract("isInjured").targetRole], ["attacker", "victim"], "selector contract must match the current official injury executor direction");
assert.deepStrictEqual([contract("playerPaysGoldTo").sourceRole, contract("playerPaysGoldTo").targetRole], ["payer", "recipient"]);
assert.deepStrictEqual([contract("changeOpinionOf").sourceRole, contract("changeOpinionOf").targetRole], ["opinion_holder", "opinion_target"]);
assert.deepStrictEqual(contract("isInjured").requiredArguments, ["injuryType"]);
assert.deepStrictEqual(contract("changeOpinionOf").requiredArguments, ["value"]);

const player = character(1, "玩家");
const npcA = character(2, "伯爵贝拉");
const npcB = character(3, "公爵阿尔诺");
const gameData = { playerID: 1, playerName: "玩家", characters: new Map([[1, player], [2, npcA], [3, npcB]]) };
const conversation = { gameData, messages: [], inactiveParticipantIds: new Map(), getActiveConversationCharacters: () => [player, npcA, npcB] };
const registry = {
  getAllActions: () => actions,
  getById: (id) => actions.find((action) => action.id === id) || null,
  isActionDisabled: () => false,
  registerValidation: () => {}
};

(async () => {
  const catalog = await availableActionCatalog.build({ conversation, speaker: player, registry, language: "en", resolveI18nString: (value) => typeof value === "string" ? value : value.en });
  const serialized = JSON.parse(availableActionCatalog.serialize(catalog));
  assert(serialized.length > 0);
  assert(serialized.every((entry) => typeof entry.shortDescription === "string" && typeof entry.sourceRole === "string" && typeof entry.targetRole === "string"));

  const dictionaryJson = JSON.stringify(dictionary);
  const precisionStable = precisionPrompt.stablePrefix(actions);
  const compactStable = compactSelector.build({ conversation, speaker: player, message: { id: 1, role: "user", content: "test" }, catalog, registry }).stable;
  assert(precisionStable.includes(dictionaryJson), "Precision must use the shared Master Action Contract");
  assert(compactStable.includes(dictionaryJson), "Compact Selector must use the same Master Action Contract");
  for (const promptText of [precisionStable, compactStable]) {
    assert(promptText.includes("sourceRole") && promptText.includes("targetRole") && promptText.includes("targetPolicy"));
    assert(/Passive voice/i.test(promptText), "both selectors must preserve contract roles in passive voice");
  }

  const corpus = benchmark.loadJson(benchmark.DEFAULT_CORPUS);
  const participantCounts = new Set(corpus.cases.map((entry) => entry.participants.length));
  assert.deepStrictEqual([...participantCounts].sort((left, right) => left - right), [3, 4, 6]);
  const multi = corpus.cases.filter((entry) => entry.participants.length >= 4);
  for (const actionId of ["characterIsKilled", "isInjured", "isImprisonedBy", "paysGoldTo", "isAssignedToCourtPositionBy", "isAssignedToCouncilBy", "isFiredFromCouncilOf", "becomeLoversWith", "agreedToTruceWith", "changeOpinionOf"]) {
    assert(multi.some((entry) => entry.expectedActions.includes(actionId)), `${actionId} needs a 4/6-person target benchmark`);
  }
  assert(multi.some((entry) => /被/.test(entry.message.content)), "multiplayer benchmark must cover passive voice");
  assert(multi.some((entry) => /他|她/.test(entry.message.content)), "multiplayer benchmark must cover pronouns");
  assert(multi.some((entry) => entry.history.length > 0), "multiplayer benchmark must cover prior-turn reference resolution");

  console.log("PASS v7.9.3 AE4 preflight Action Contract and multiplayer target binding");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
