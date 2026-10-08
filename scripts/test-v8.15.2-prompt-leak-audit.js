"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const appDir = path.join(__dirname, "..", "resources", "app");
const { Character } = require(path.join(appDir, "out", "main", "game-data", "character"));
const { createGameData } = require(path.join(appDir, "out", "main", "game-data", "game-data"));
const { Conversation } = require(path.join(appDir, "out", "main", "conversation", "conversation"));
const { createTraitProfileView } = require(path.join(appDir, "out", "main", "prompts", "trait-profile-selector"));
const { createPromptBuilder } = require(path.join(appDir, "out", "main", "prompts", "prompt-builder"));
const { createTemplateEngine } = require(path.join(appDir, "out", "main", "prompts", "template-engine"));
const { createLetterPromptBuilder } = require(path.join(appDir, "out", "main", "prompts", "letter-prompt-builder"));
const { PromptScriptLoader } = require(path.join(appDir, "out", "main", "prompts", "prompt-script-loader"));
const { PromptScriptSandbox } = require(path.join(appDir, "out", "main", "prompts", "prompt-script-sandbox"));
const { TokenCounter } = require(path.join(appDir, "out", "main", "provider-service"));
const Handlebars = require(path.join(appDir, "node_modules", "handlebars"));

const defaultPromptsDir = path.join(appDir, "default_userdata");
const defaultTemplate = path.join(defaultPromptsDir, "prompts", "system", "default.hbs");
const defaultLetterTemplate = path.join(defaultPromptsDir, "prompts", "system", "letter.hbs");
const defaultPList = path.join(defaultPromptsDir, "prompts", "character_description", "standard", "pListMccTest2.js");
const defaultLetterPList = path.join(defaultPromptsDir, "prompts", "character_description", "letter", "pListLetter.js");
const TemplateEngine = createTemplateEngine({
  Handlebars,
  fs,
  path,
  promptsHelpersDir: path.join(appDir, "__prompt_leak_audit_no_user_helpers__"),
  defaultPromptsDir,
  PromptScriptSandbox
});
const templateEngine = new TemplateEngine();
const GameData = createGameData({
  fs,
  path,
  memorySystem: {
    getCharacterPersonalName(character, fallbackName) {
      return character?.firstName || character?.shortName || fallbackName || "Unknown";
    }
  },
  memoryEngine: null,
  summariesDir: path.join(appDir, "__prompt_leak_audit_no_summaries__"),
  getHistoricalReferenceByYear: () => ({ period: "", context: "", notableEvents: [], notableFigures: [] })
});
const letterSettings = {
  mainTemplate: fs.readFileSync(defaultLetterTemplate, "utf8"),
  blocks: [
    { id: "main", type: "main", enabled: true, role: "system" },
    { id: "description", type: "description", enabled: true, scriptPath: "character_description/letter/pListLetter.js" },
    { id: "location-alias-probe", type: "custom", enabled: true, template: "locationController={{gameData.locationController}}" },
    { id: "instruction", type: "instruction", enabled: true, role: "user", template: "{{letter.content}}" }
  ]
};
const LetterPromptBuilder = createLetterPromptBuilder({
  TemplateEngine,
  PromptScriptLoader,
  settingsRepository: { getLetterPromptSettings: () => letterSettings },
  promptConfigManager: { resolvePath: scriptPath => path.join(defaultPromptsDir, "prompts", scriptPath) },
  memoryEngine: null,
  PromptBuilder: null,
  TokenCounter: null
});
const chatSettings = {
  mainTemplate: "Synthetic prompt-leak audit rules.",
  blocks: [
    { id: "main", type: "main", enabled: true, role: "system" },
    { id: "description", type: "description", enabled: true, scriptPath: "character_description/standard/pListMccTest2.js" },
    { id: "alias-probe", type: "custom", enabled: true, role: "system", template: "CUSTOM_PLAYER={{gameData.playerName}}|CUSTOM_AI={{gameData.aiName}}" },
    { id: "history", type: "history", enabled: true },
    { id: "instruction", type: "instruction", enabled: true, role: "user", template: "Reply." }
  ]
};
const ChatPromptBuilder = createPromptBuilder({
  TemplateEngine,
  PromptScriptLoader,
  promptConfigManager: {
    getDefaultMainTemplateContent: () => chatSettings.mainTemplate,
    resolvePath: scriptPath => path.join(defaultPromptsDir, "prompts", scriptPath)
  },
  settingsRepository: {
    getPromptSettings: () => chatSettings,
    getChatPromptV89Settings: () => ({}),
    getChatPromptV813Layout: () => true
  },
  path,
  TokenCounter,
  createPromptFingerprint: value => String(value || ""),
  defaultChatInstruction: "Reply."
});

const PLAYER_ID = 101;
const RESPONDER_ID = 202;
const CONTROLLER_ID = 303;
const PRIVATE_TITLE = `PRIVATE_TITLE_SENTINEL\u7687\u5e1d`;
const CONTROLLER_TITLE = "CONTROLLER_TITLE_SENTINEL";
const campaignToken = "synthetic-prompt-leak-audit";
const date = "1164.5.20";
const leaks = [];

function makeCharacter(id, shortName, fullName, primaryTitle = "", firstName = shortName) {
  return new Character([
    id, shortName, fullName, primaryTitle, "he", "34", "100", "0", "", "", "0", "0",
    "", "", "culture", "faith", "house", "0", firstName, "Venice", "", "5", "0", "", "0", "",
    "concept_none", ""
  ]);
}

function makeGameData({ playerTitle = "", controllerFullName = "" } = {}) {
  const gameData = new GameData([
    PLAYER_ID, "Player", RESPONDER_ID, "Responder", date, "scene_name_throne_room", "Venice", controllerFullName, "100000"
  ]);
  gameData.campaignToken = campaignToken;
  const player = makeCharacter(PLAYER_ID, "Player", "Player Name", playerTitle, "Player");
  const responder = makeCharacter(RESPONDER_ID, "Responder", "Responder Name", "", "Responder");
  const controller = makeCharacter(CONTROLLER_ID, "Controller", controllerFullName || "Controller Name", CONTROLLER_TITLE, "Controller");
  for (const character of [player, responder, controller]) character.troops = { totalOwnedTroops: 0 };
  gameData.characters = new Map([[PLAYER_ID, player], [RESPONDER_ID, responder], [CONTROLLER_ID, controller]]);
  return { gameData, player, responder, controller };
}

function renderDefault(view) {
  return templateEngine.renderTemplate(defaultTemplate, { character: view.character, gameData: view.gameData });
}

function runPList(view, responderId = RESPONDER_ID) {
  return PromptScriptSandbox.executeDescription(defaultPList, { gameData: view.gameData, currentCharacterId: responderId });
}

function makeAliasAuditFixture() {
  const controllerFullName = `${CONTROLLER_TITLE}, Controller Name`;
  const { gameData, player, responder, controller } = makeGameData({ playerTitle: PRIVATE_TITLE, controllerFullName });
  gameData.playerName = player.fullName = `${PRIVATE_TITLE}, Player Name`;
  gameData.aiID = CONTROLLER_ID;
  gameData.aiName = controller.fullName;
  player.primaryTitle = PRIVATE_TITLE;
  controller.primaryTitle = CONTROLLER_TITLE;
  const conversation = Object.create(Conversation.prototype);
  conversation.gameData = gameData;
  conversation.messages = [];
  conversation.selectedCharacterIds = new Set([RESPONDER_ID, CONTROLLER_ID]);
  conversation.presentCharacterIds = new Set([RESPONDER_ID, CONTROLLER_ID]);
  conversation.waitingCharacterIds = new Set();
  conversation.temporarilyAbsentCharacterIds = new Map();
  conversation.departedCharacterIds = new Set();
  conversation.inactiveParticipantIds = new Map();
  conversation.presenceInitialized = true;
  conversation.canManagePresence = () => true;
  const memoryContext = {
    activeParticipantIds: [RESPONDER_ID, CONTROLLER_ID],
    presenceText: conversation.buildPresenceContext(),
    cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() }
  };
  const buildPrompt = (character, context = memoryContext, data = gameData) =>
    ChatPromptBuilder.buildMessagesWithTokenCount([], character, data, "", context).messages.map(message => message.content).join("\n");
  return { gameData, player, responder, controller, conversation, memoryContext, buildPrompt };
}

// Regression 1: currentEmperorTitle is a text alias of a character field and
// must follow the same responder-scoped title projection as that character.
{
  const { gameData, player, responder } = makeGameData({ playerTitle: PRIVATE_TITLE });
  gameData.updateCurrentEmperorInfo();
  const sourceMatches = [...gameData.characters.values()].filter(character =>
    character.shortName === gameData.currentEmperor && character.primaryTitle === gameData.currentEmperorTitle);
  assert.equal(sourceMatches.length, 1, "current emperor alias must have one canonical source character");
  assert.equal(sourceMatches[0].id, PLAYER_ID, "synthetic currentEmperorTitle source ID");

  const strangerView = createTraitProfileView(gameData, responder);
  assert.equal(strangerView.gameData.characters.get(PLAYER_ID).primaryTitle, "", "unrevealed source title is projected away");
  if (renderDefault(strangerView).includes(PRIVATE_TITLE)) leaks.push("default.hbs currentEmperorTitle alias");

  const selfView = createTraitProfileView(gameData, player);
  assert.equal(selfView.character.primaryTitle, PRIVATE_TITLE, "self retains the exact title");
  assert(renderDefault(selfView).includes(PRIVATE_TITLE), "default.hbs retains a self title");

  const knownTitleFact = {
    campaignToken,
    ownerId: RESPONDER_ID,
    entityId: PLAYER_ID,
    factType: "TITLE",
    factKey: "title_private_title_sentinel",
    value: PRIVATE_TITLE,
    status: "MANUAL_KNOWN",
    current: true,
    effectiveKnown: true,
    firstAcquiredDate: date
  };
  const knownView = createTraitProfileView(gameData, responder, {
    disclosureProfiles: new Map([[PLAYER_ID, [knownTitleFact]]])
  });
  assert.equal(knownView.gameData.characters.get(PLAYER_ID).primaryTitle, PRIVATE_TITLE,
    "an explicitly disclosed title remains visible to its recipient");
  assert(renderDefault(knownView).includes(PRIVATE_TITLE), "default.hbs retains an explicitly disclosed title");

  const unknownEmperorData = { ...gameData, currentEmperor: "Known Public Name", currentEmperorTitle: "UNKNOWN_EMPEROR_TITLE_SENTINEL" };
  if (renderDefault(createTraitProfileView(unknownEmperorData, responder)).includes("UNKNOWN_EMPEROR_TITLE_SENTINEL")) {
    leaks.push("unknown currentEmperorTitle alias");
  }

  const ambiguousEmperor = makeGameData({ playerTitle: PRIVATE_TITLE });
  ambiguousEmperor.gameData.characters.set(404, makeCharacter(404, "Player", "Player Name", PRIVATE_TITLE, "Duplicate"));
  ambiguousEmperor.gameData.updateCurrentEmperorInfo();
  const ambiguousEmperorSources = [...ambiguousEmperor.gameData.characters.values()].filter(character =>
    character.shortName === ambiguousEmperor.gameData.currentEmperor
      && character.primaryTitle === ambiguousEmperor.gameData.currentEmperorTitle);
  assert.equal(ambiguousEmperorSources.length, 2, "fixture must make the emperor alias ambiguous");
  if (renderDefault(createTraitProfileView(ambiguousEmperor.gameData, ambiguousEmperor.responder)).includes(PRIVATE_TITLE)) {
    leaks.push("ambiguous currentEmperorTitle alias");
  }
}

// Regression 2: locationController is another string alias. Resolve its unique
// source fullName to a character ID, then use that ID's sanitized projection.
{
  const controllerFullName = `${CONTROLLER_TITLE}, Controller Name`;
  const { gameData, responder, controller } = makeGameData({ controllerFullName });
  const sourceMatches = [...gameData.characters.values()].filter(character => character.fullName === gameData.locationController);
  assert.equal(sourceMatches.length, 1, "locationController alias must resolve unambiguously");
  const sourceId = sourceMatches[0].id;
  assert.equal(sourceId, CONTROLLER_ID, "synthetic locationController source ID");

  const strangerView = createTraitProfileView(gameData, responder);
  const projectedController = strangerView.gameData.characters.get(sourceId);
  assert.equal(projectedController.shortName, "Controller", "source ID maps to the canonical projected name");
  assert.equal(projectedController.primaryTitle, "", "controller title is not disclosed by the alias");
  if (runPList(strangerView).includes(CONTROLLER_TITLE)) leaks.push("pListMccTest2 locationController alias");

  const selfGameData = { ...gameData, locationController: responder.fullName };
  const selfView = createTraitProfileView(selfGameData, responder);
  assert(runPList(selfView).includes("Responder's throneroom"), "pList keeps the responder's own location-controller name");

  const unknown = makeGameData();
  unknown.gameData.locationController = "UNKNOWN_LOCATION_ALIAS_SENTINEL";
  if (runPList(createTraitProfileView(unknown.gameData, unknown.responder)).includes("UNKNOWN_LOCATION_ALIAS_SENTINEL")) {
    leaks.push("unknown locationController alias");
  }

  const ambiguousAlias = `${CONTROLLER_TITLE}, Shared Controller Name`;
  const ambiguous = makeGameData({ controllerFullName: ambiguousAlias });
  ambiguous.gameData.characters.set(404, makeCharacter(404, "Second Controller", ambiguousAlias, CONTROLLER_TITLE, "Second"));
  const ambiguousView = createTraitProfileView(ambiguous.gameData, ambiguous.responder);
  if (runPList(ambiguousView).includes(CONTROLLER_TITLE)) leaks.push("ambiguous locationController alias");
}

// Letter prompts use the real builder, template and description script. A
// private runtime location is not implied to a letter recipient, but a place
// the sender states in the letter remains part of the letter itself.
{
  const runtimeLocation = "PRIVATE_RUNTIME_LOCATION_SENTINEL";
  const locationController = "PRIVATE_LOCATION_CONTROLLER_SENTINEL";
  const bodyLocation = "LETTER_BODY_LOCATION_SENTINEL";
  const { gameData, responder } = makeGameData({ controllerFullName: locationController });
  gameData.location = runtimeLocation;
  gameData.locationController = locationController;
  const selfTraits = [
    { name: "SELF_PERSONALITY_TRAIT_SENTINEL", category: "Personality Trait", desc: "self trait" },
    { name: "SELF_OTHER_TRAIT_SENTINEL", category: "Body", desc: "self trait" }
  ];
  responder.traits = selfTraits;

  const letter = { letterId: "synthetic-letter", content: `我此刻在${bodyLocation}，请回信。` };
  const messages = new LetterPromptBuilder().buildMessages(gameData, letter);
  const prompt = messages.map(message => message.content).join("\n");
  if (prompt.includes(runtimeLocation)) leaks.push("letter gameData.location");
  if (prompt.includes(locationController)) leaks.push("letter gameData.locationController");
  assert(prompt.includes(bodyLocation), "the sender's explicitly stated location remains in letter content");
  for (const trait of selfTraits) assert(prompt.includes(trait.name), `letter responder retains self trait ${trait.name}`);
  assert.equal(gameData.location, runtimeLocation, "letter projection must not mutate source game data");
  assert.equal(gameData.locationController, locationController, "letter projection must not mutate source controller data");
}

// Actual chat provider messages must use projected gameData aliases and the
// Conversation-generated presence roster, including after custom templates run.
{
  const fixture = makeAliasAuditFixture();
  const { gameData, player, responder, controller, memoryContext, buildPrompt } = fixture;
  assert(memoryContext.presenceText.includes("- Responder\n- Controller"), "presence roster uses the current participant personal names");
  assert(!memoryContext.presenceText.includes(PRIVATE_TITLE), "presence roster does not retain the player title");
  assert(!memoryContext.presenceText.includes(CONTROLLER_TITLE), "presence roster does not retain the controller title");

  const strangerPrompt = buildPrompt(responder);
  if (strangerPrompt.includes(PRIVATE_TITLE)) leaks.push("final chat messages playerName alias");
  if (strangerPrompt.includes(CONTROLLER_TITLE)) leaks.push("final chat messages aiName alias");
  assert(strangerPrompt.includes("CUSTOM_PLAYER=Player|CUSTOM_AI=Controller"),
    "custom final-message template receives projected playerName and aiName");
  assert(strangerPrompt.includes("=== 当前在场人物（仅本轮有效） ===\n- Responder\n- Controller"),
    "actual final messages contain the sanitized Conversation presence roster");

  const selfPrompt = buildPrompt(player);
  assert(selfPrompt.includes(PRIVATE_TITLE), "self retains their full title in final messages");
  assert(selfPrompt.includes(`CUSTOM_PLAYER=${gameData.playerName}|CUSTOM_AI=Controller`),
    "self alias remains complete while the other alias stays projected");

  const disclosedTitleFact = {
    campaignToken,
    ownerId: RESPONDER_ID,
    entityId: PLAYER_ID,
    factType: "TITLE",
    factKey: "title_private_title_sentinel",
    value: PRIVATE_TITLE,
    status: "MANUAL_KNOWN",
    current: true,
    effectiveKnown: true,
    firstAcquiredDate: date
  };
  const disclosedPrompt = buildPrompt(responder, {
    ...memoryContext,
    disclosureProfiles: new Map([[PLAYER_ID, [disclosedTitleFact]]])
  });
  assert(disclosedPrompt.includes(PRIVATE_TITLE), "an explicitly disclosed title remains in the final profile messages");

  const raw = {
    playerName: gameData.playerName,
    aiName: gameData.aiName,
    playerFullName: player.fullName,
    playerTitle: player.primaryTitle,
    controllerFullName: controller.fullName,
    controllerTitle: controller.primaryTitle
  };
  assert.deepEqual({
    playerName: gameData.playerName,
    aiName: gameData.aiName,
    playerFullName: player.fullName,
    playerTitle: player.primaryTitle,
    controllerFullName: controller.fullName,
    controllerTitle: controller.primaryTitle
  }, raw, "prompt construction leaves raw source game data unchanged");

  const missingPlayer = Object.assign(Object.create(Object.getPrototypeOf(gameData)), gameData, { characters: new Map(gameData.characters) });
  missingPlayer.characters.delete(PLAYER_ID);
  const missingController = Object.assign(Object.create(Object.getPrototypeOf(gameData)), gameData, { characters: new Map(gameData.characters) });
  missingController.characters.delete(CONTROLLER_ID);
  const fullBlocks = chatSettings.blocks;
  chatSettings.blocks = fullBlocks.filter(block => block.type !== "description");
  try {
    const missingPlayerPrompt = buildPrompt(responder, memoryContext, missingPlayer);
    assert(missingPlayerPrompt.includes("CUSTOM_PLAYER=|CUSTOM_AI=Controller"),
      "missing player target fails closed in the actual final custom message");
    const missingControllerPrompt = buildPrompt(responder, memoryContext, missingController);
    assert(missingControllerPrompt.includes("CUSTOM_PLAYER=Player|CUSTOM_AI="),
      "missing ai target fails closed in the actual final custom message");
  } finally {
    chatSettings.blocks = fullBlocks;
  }
}

assert.deepEqual(leaks, [], `default prompt alias leaks: ${leaks.join(", ") || "none"}`);
console.log("V8.15.2 prompt leak audit: PASS (chat and letter aliases, actual presence messages, missing-target fail-closed, self traits, disclosed titles, and stated-letter content)");
