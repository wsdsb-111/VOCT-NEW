"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionsRoot = path.join(root, "resources/app/default_userdata/actions/standard");
const { compactDictionary } = require(path.join(root, "resources/app/out/main/action-system/v4/catalog/master-action-dictionary"));
const availableActionCatalog = require(path.join(root, "resources/app/out/main/action-system/v4/catalog/available-action-catalog"));
const proposalValidator = require(path.join(root, "resources/app/out/main/action-system/v4/proposal/action-proposal-validator"));
const { ActionEngineV4 } = require(path.join(root, "resources/app/out/main/action-system/v4/action-engine-v4"));
const { createValidatedInvocation } = require(path.join(root, "resources/app/out/main/action-system/action-types"));
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
  load("z_changeOpinionOf.js"),
  load("z_isAssignedToCourtPositionBy.js"),
  load("z_isAssignedToCouncilBy.js"),
  load("z_isFiredFromCouncilOf.js"),
  load("z_changeLocation.js"),
  load("z_intercourse.js")
];
const dictionary = compactDictionary(actions);
const allStandardActions = fs.readdirSync(actionsRoot).filter((fileName) => fileName.endsWith(".js")).map(load);
assert(!JSON.stringify(compactDictionary(allStandardActions)).includes("isPlayerSource"), "Master Action Contract must hide participant override arguments for every shipped action");

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
assert.deepStrictEqual([contract("isInjured").sourceRole, contract("isInjured").targetRole], ["attacker", "victim"], "VOCT-NEW injury contract must bind attacker to source and actual victim to target");
assert.deepStrictEqual([contract("playerPaysGoldTo").sourceRole, contract("playerPaysGoldTo").targetRole], ["payer", "recipient"]);
assert.deepStrictEqual([contract("changeOpinionOf").sourceRole, contract("changeOpinionOf").targetRole], ["opinion_holder", "opinion_target"]);
assert.deepStrictEqual(contract("isInjured").requiredArguments, ["injuryType"]);
assert.deepStrictEqual(contract("changeOpinionOf").requiredArguments, ["value"]);
assert.deepStrictEqual(contract("isAssignedToCourtPositionBy").requiredArguments, ["court_position"]);
assert.deepStrictEqual(contract("isAssignedToCouncilBy").requiredArguments, ["council_position"]);
assert.deepStrictEqual(contract("changeLocation").requiredArguments, ["location"]);
assert.deepStrictEqual(contract("intercourse").requiredArguments, []);

const player = character(1, "玩家");
const npcA = character(2, "伯爵贝拉", { isLandedRuler: true });
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
  assert(serialized.every((entry) => JSON.stringify(Object.keys(entry)) === JSON.stringify(["actionId", "sourceCharacterId", "validTargetCharacterIds", "arguments"])), "Dynamic Catalog must not repeat stable Action Contract fields");
  assert(serialized.every((entry) => entry.arguments.every((argument) => argument.name !== "isPlayerSource")), "AE4 Catalog must hide participant override arguments");

  const dictionaryJson = JSON.stringify(dictionary);
  const precisionStable = precisionPrompt.stablePrefix(actions);
  const compactStable = compactSelector.build({ conversation, speaker: player, message: { id: 1, role: "user", content: "test" }, catalog, registry }).stable;
  assert(precisionStable.includes(dictionaryJson), "Precision must use the shared Master Action Contract");
  assert(compactStable.includes(dictionaryJson), "Compact Selector must use the same Master Action Contract");
  for (const promptText of [precisionStable, compactStable]) {
    assert(promptText.includes("sourceRole") && promptText.includes("targetRole") && promptText.includes("targetPolicy"));
    assert(/Passive voice/i.test(promptText), "both selectors must preserve contract roles in passive voice");
    assert(!promptText.includes("isPlayerSource"), "AE4 stable prompts must not expose participant override arguments");
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

  const injuryCases = corpus.cases.filter((entry) => /^isInjured-/.test(entry.id));
  assert(injuryCases.every((entry) => entry.expectedSourceCharacterId === 1 && entry.expectedTargetCharacterId === 2), "base injury fixtures must use attacker source and victim target");
  assert(injuryCases.every((entry) => entry.expectedArguments?.injuryType === "wounded"));
  const passiveInjury = corpus.cases.find((entry) => entry.expectedActions.includes("isInjured") && entry.participants.length === 6 && /被.*刺伤/.test(entry.message.content));
  assert(passiveInjury && passiveInjury.expectedSourceCharacterId === 4 && passiveInjury.expectedTargetCharacterId === 2, "passive/pronoun injury must preserve attacker to victim contract");

  const overrideValidation = await proposalValidator.validate({
    proposal: { actionId: "isAssignedToCourtPositionBy", sourceCharacterId: 1, targetCharacterId: 2, arguments: { court_position: "physician", isPlayerSource: true } },
    catalog,
    conversation,
    registry
  });
  assert.deepStrictEqual(overrideValidation, { valid: false, reason: "rejected_participant_override" }, "AE4 Validator must reject isPlayerSource");

  ActionEngineV4.configure({
    actionRegistry: registry,
    settingsRepository: { getLanguage: () => "en" },
    ActionSandbox: { executeAction: async () => { throw new Error("participant override reached executor"); } },
    ActionEffectWriter: { writeEffect: () => {} },
    resolveI18nString: (value) => typeof value === "string" ? value : value.en
  });
  const overrideExecution = await ActionEngineV4.runInvocation(conversation, player, createValidatedInvocation({
    actionId: "isAssignedToCouncilBy",
    sourceCharacterId: 1,
    targetCharacterId: 2,
    args: { council_position: "chancellor", isPlayerSource: true },
    engineVersion: "4.0"
  }));
  assert.strictEqual(overrideExecution.success, false);
  assert.strictEqual(overrideExecution.error, "participant_override_mismatch", "AE4 Executor boundary must not read participant overrides");

  const injury = actions.find((entry) => entry.id === "isInjured").definition;
  const appliedEffects = [];
  const victim = character(2, "伯爵贝拉", { sheHe: "她", hasTrait: () => false, addTrait: () => {}, removeTrait: () => {} });
  const originalRandom = Math.random;
  Math.random = () => 1;
  try {
    injury.run({ gameData: { ...gameData, characters: new Map([[1, player], [2, victim]]) }, sourceCharacter: player, targetCharacter: victim, runGameEffect: (effect) => appliedEffects.push(effect), args: { injuryType: "wounded" }, dryRun: false, lang: "zh" });
  } finally {
    Math.random = originalRandom;
  }
  assert(appliedEffects.length > 0);
  assert(appliedEffects.every((effect) => /global_var:votc_action_target/.test(effect) && !/global_var:votc_action_source\s*=\s*\{/.test(effect)), "injury CK3 effects must apply to targetCharacter");

  console.log("PASS v7.9.3 AE4 final preflight contracts, consent timing, immutable participants and target binding");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
