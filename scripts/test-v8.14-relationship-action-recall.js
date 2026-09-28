"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createActionEngine } = require("../resources/app/out/main/actions/action-engine");
const { ActionPromptBuilder } = require("../resources/app/out/main/actions/action-prompt-builder");
const { prepareActionMessages } = require("../resources/app/out/main/actions/action-prompt-compatibility-overlay");
const { ActionSandbox } = require("../resources/app/out/main/actions/action-sandbox");

const player = { id: 1, fullName: "Player", shortName: "Player", relationsToCharacters: [] };
const npc = { id: 2, fullName: "NPC", shortName: "NPC", relationsToCharacters: [] };
const history = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? "assistant" : "user",
  name: index % 2 ? "NPC" : "Player", content: index === 4 ? "I love you" : index === 5 ? "I love you too" : `line ${index}` }));
const conversation = { gameData: { playerID: 1, playerName: "Player", characters: new Map([[1, player], [2, npc]]) },
  messages: history, getHistory: () => history };
let sentMessages;
const Engine = createActionEngine({
  actionRegistry: { getAllActions: () => [{ id: "becomeSoulmatesWith", definition: {
    check: () => ({ canExecute: true, validTargetCharacterIds: [1] }),
    args: [], description: "Become soulmates"
  } }], getById: (id) => ({ validation: { valid: true }, filePath: path.join(__dirname,
    `../resources/app/default_userdata/actions/standard/z_${id}.js`) }) },
  settingsRepository: { getLanguage: () => "en", getActionsProviderConfig: () => ({}) },
  llmManager: { sendActionsRequest: async (messages) => { sentMessages = messages; return { content: '{"actions":[]}' }; } },
  ActionPromptBuilder,
  ActionSandbox,
  ActionEffectWriter: { writeEffect: () => ({ commandId: "test-command", status: "queued", hasCommandEnvelope: true }) },
  CriticalActionRecallObserver: class { observeMissingActions() {} observeCheck() {} build() { return []; } },
  buildStructuredResponseJsonSchema: () => ({}),
  buildStructuredResponseSchema: () => ({ parse: (value) => value }),
  healJsonResponseWithLogging: JSON.parse,
  resolveI18nString: (value) => value
});

(async () => {
  const result = await Engine.evaluateForCharacter(conversation, npc);
  assert.deepStrictEqual(result, { autoApproved: [], needsApproval: [] });
  assert(sentMessages[0].content.includes("I love you"), "reciprocal romantic confession guidance must reach all providers");
  assert(sentMessages[0].content.includes("becomeSoulmatesWith"));
  assert(sentMessages[0].content.includes("becomeFriendsWith"));
  assert(sentMessages[0].content.includes("becomeRivalsWith"));
  for (const actionId of ["becomeLoversWith", "becomeBestFriendsWith", "becomeNemesisWith", "becomeBloodBrothersWith"]) {
    assert(sentMessages[0].content.includes(actionId), `${actionId} must have selection guidance`);
  }
  assert(sentMessages[0].content.includes("one-sided"), "one-sided affection must remain a rejected boundary");
  assert(sentMessages[0].content.includes("questions"), "questions must not trigger relationship effects");
  assert(sentMessages[0].content.includes("unaccepted proposals"));
  assert(sentMessages[1].content.includes("I love you\nNPC: I love you too"), "two-person action context must keep the reciprocal exchange");
  const prepared = prepareActionMessages(sentMessages, { overlayEnabled: true, stablePrefixEnabled: true });
  assert.strictEqual(prepared.stablePrefixApplied, true, "DeepSeek stable-prefix block contract must survive");
  assert.strictEqual(prepared.overlayApplied, true);
  const relationshipIds = ["becomeSoulmatesWith", "becomeFriendsWith", "becomeRivalsWith", "becomeBloodBrothersWith",
    "becomeBestFriendsWith", "becomeLoversWith", "becomeNemesisWith"];
  for (const actionId of relationshipIds) {
    const action = await Engine.runInvocation(conversation, npc, { actionId, targetCharacterId: 1, args: {} });
    assert(action.confirmation, `${actionId} must still dispatch the official effect`);
    assert.deepStrictEqual(npc.relationsToCharacters, [], `${actionId} must not mutate the live NPC before CK3 readback`);
    assert.deepStrictEqual(player.relationsToCharacters, [], `${actionId} must not mutate the live player before CK3 readback`);
  }
  const standardDir = path.join(__dirname, "../resources/app/default_userdata/actions/standard");
  const actions = Object.fromEntries(relationshipIds.map((id) => [id, require(path.join(standardDir, `z_${id}.js`))]));
  for (const id of ["becomeSoulmatesWith", "becomeFriendsWith", "becomeRivalsWith", "becomeBloodBrothersWith", "becomeLoversWith"]) {
    assert.strictEqual(actions[id].check({ gameData: conversation.gameData, sourceCharacter: npc }).canExecute, true,
      `${id} should be available for a valid unrelated target`);
  }
  const bestFriend = actions.becomeBestFriendsWith;
  const nemesis = actions.becomeNemesisWith;
  assert.strictEqual(bestFriend.check({ gameData: conversation.gameData, sourceCharacter: npc }).canExecute, false);
  assert.strictEqual(nemesis.check({ gameData: conversation.gameData, sourceCharacter: npc }).canExecute, false);
  npc.relationsToCharacters.push({ id: 1, relations: ["Friend"] });
  assert.strictEqual(bestFriend.check({ gameData: conversation.gameData, sourceCharacter: npc }).canExecute, true);
  npc.relationsToCharacters[0].relations = ["Rival"];
  assert.strictEqual(nemesis.check({ gameData: conversation.gameData, sourceCharacter: npc }).canExecute, true);
  npc.relationsToCharacters = [];
  for (const [id, relation] of [["becomeSoulmatesWith", "Soulmate"], ["becomeFriendsWith", "Friend"],
    ["becomeRivalsWith", "Rival"], ["becomeBloodBrothersWith", "Blood Brother"],
    ["becomeBestFriendsWith", "Best Friend"], ["becomeLoversWith", "Lover"], ["becomeNemesisWith", "Nemesis"]]) {
    npc.relationsToCharacters = [{ id: 1, relations: [relation] }];
    assert.strictEqual(actions[id].check({ gameData: conversation.gameData, sourceCharacter: npc }).canExecute, false,
      `${id} must be unavailable when the same relation already exists`);
  }
  npc.relationsToCharacters = [];
  assert(!fs.readdirSync(standardDir).some((name) => /mentor|mentee|指导者/i.test(name)),
    "mentor is not an official standard Action and must not be claimed as trigger-tested");
  console.log("V8.14 relationship Action recall: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
