"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const mainDir = path.resolve(__dirname, "../resources/app/out/main");
const { Conversation } = require(path.join(mainDir, "conversation/conversation"));
const { WorldlineService } = require(path.join(mainDir, "worldline/worldline-service"));
const { parseGameState } = require(path.join(mainDir, "worldline/game-state-adapter"));
const { createPromptBuilder } = require(path.join(mainDir, "prompts/prompt-builder"));
const { TokenCounter } = require(path.join(mainDir, "provider-service"));
const fingerprint = value => crypto.createHash("sha256").update(String(value || "")).digest("hex");

const settingsRepository = {
  getChatPromptV813Layout: () => true,
  getChatPromptV89Settings: () => ({}),
  getPromptSettings: () => ({ mainTemplate: "{{! VOTC_SEGMENT:stable_global }}Fixed rules", blocks: [
    { id: "main", type: "main", enabled: true, role: "system" },
    { id: "history", type: "history", enabled: true },
    { id: "instruction", type: "instruction", enabled: true, role: "user", template: "Respond" }
  ] })
};
const PromptBuilder = createPromptBuilder({
  TemplateEngine: class { renderTemplateString(template) { return template.replace(/\{\{!\s*VOTC_SEGMENT:[^}]+\}\}/g, ""); } },
  PromptScriptLoader: class {},
  promptConfigManager: { getDefaultMainTemplateContent: () => "Fixed rules", resolvePath: value => value },
  settingsRepository, path, TokenCounter, createPromptFingerprint: fingerprint, defaultChatInstruction: "Respond"
});

function createConversation() {
  const conversation = Object.create(Conversation.prototype);
  conversation.id = "opening-presence";
  conversation.gameData = {
    date: "1162.5.19", year: 1162, scene: "Hall", location: "Hall", playerID: 1, aiID: 2,
    characters: new Map(["Player", "Alpha", "Beta", "Gamma"].map((name, index) => [index + 1,
      { id: index + 1, firstName: name, shortName: name, fullName: name, traits: [] }])),
    mentionedCharactersInContext: new Set(),
    findMentionedCharacterIdsInHistory: () => [], getMentionedCharactersInfo: () => "",
    getActiveParticipantRelationshipInfo: () => ""
  };
  conversation.gameData.characters.get(2).spouse = { id: 5, shortName: "KnownSpouse" };
  conversation.messages = [];
  conversation.nextId = 0;
  conversation.isPaused = false;
  conversation.inactiveParticipantIds = new Map();
  conversation.eventEmitter = new EventEmitter();
  conversation.canManagePresence = () => true;
  conversation.frozenWorldlineByResponder = new Map();
  conversation.frozenWorldlineCoverageByResponder = new Map();
  conversation.initializePresence();
  return conversation;
}

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8141-opening-"));
  let service;
  try {
    const autosavePath = path.join(tempRoot, "autosave.ck3");
    const settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: true,
      subjectiveWorldMode: "PRODUCTION", lastValidationStatus: "VALID" };
    service = new WorldlineService({ dataDir: tempRoot, settingsRepository: {
      getWorldlineSettings: () => settings, saveWorldlineSettings: next => Object.assign(settings, next), getCK3DebugLogPath: () => null
    } });
    service.currentCheckpoint = { id: "opening-cp", source: { path: autosavePath }, snapshot: parseGameState(`
      date=1162.5.19 played_character=1
      living={1={first_name="Player"} 2={first_name="Alpha" family_data={spouse=5}} 3={first_name="Beta"} 4={first_name="Gamma"}
        5={first_name="KnownSpouse" family_data={spouse=2}}}
    `) };
    service.buildState = "ACTIVE";
    service.getLiveState = () => ({ connected: false, gameDate: null, characters: [] });
    const calls = [];
    const getContext = service.getSubjectivePromptContextAsync.bind(service);
    service.getSubjectivePromptContextAsync = async args => { calls.push(args); return getContext(args); };
    Conversation.configure({ settingsRepository, worldlineService: service, createPromptFingerprint: fingerprint,
      createMessage: args => ({ type: "message", ...args }), usageAnalytics: { record: () => {} } });

    const conversation = createConversation();
    await conversation.prefetchFrozenWorldline();
    assert.deepEqual(calls.map(call => call.responderId), [2, 3, 4], "waiting responders retain their independent prefetch");
    for (const call of calls) {
      assert.deepEqual(call.activeParticipantIds, [2], "T0: only Alpha is actually present");
      assert.deepEqual(call.runtimeContext.activeParticipantIds, [2], "runtime context must use the same real presence");
      assert.deepEqual(call.mentionedEntityIds, [], "opening has no user mention and cannot invent selected-roster mentions");
      assert.deepEqual(call.directObservationFacts, [], "opening prefetch is not a scene observation");
    }
    const opening = conversation.frozenWorldlineByResponder.get(2);
    assert(opening?.worldTurnRecallText, "production worldline service produces an opening baseline");
    assert(!/Beta|Gamma/.test(opening.worldTurnRecallText), "strangers waiting in the roster cannot enter Alpha's worldline");
    assert(opening.worldTurnRecallText.includes("KnownSpouse"), "legal self and kinship knowledge survives roster isolation");
    for (const responderId of [3, 4]) {
      assert(conversation.frozenWorldlineByResponder.get(responderId)?.worldTurnRecallText.includes(conversation.gameData.characters.get(responderId).shortName));
      assert(conversation.frozenWorldlineCoverageByResponder.get(String(responderId)), "waiting responder retains a coverage manifest");
    }

    const memoryContext = { ...opening, activeParticipantIds: conversation.getActiveConversationCharacters().map(character => character.id),
      presenceText: conversation.buildPresenceContext(), cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() } };
    const build = () => PromptBuilder.buildMessagesWithTokenCount([{ role: "user", content: "Is anyone else here?" }],
      conversation.gameData.characters.get(2), conversation.gameData, "", memoryContext, { providerType: "deepseek", defaultModel: "deepseek-v4-flash" });
    const first = build();
    const firstMetadata = Conversation.buildPromptBlockMetadata(first);
    assert(!/Beta|Gamma/.test(first.messages.map(message => message.content).join("\n")), "T0: actual prompt excludes both waiting strangers");
    assert.equal((await conversation.joinWaitingCharacter(3)).success, true);
    memoryContext.activeParticipantIds = conversation.getActiveConversationCharacters().map(character => character.id);
    memoryContext.presenceText = conversation.buildPresenceContext();
    const second = build();
    assert(second.messages.some(message => message.content.includes("Beta")), "T1: Beta is visible after joining");
    assert(!second.messages.some(message => message.content.includes("Gamma")), "T1: Gamma remains waiting");
    assert.equal(Conversation.buildPromptBlockMetadata(second).prefixFingerprint, firstMetadata.prefixFingerprint,
      "late join changes the dynamic tail without changing the frozen prefix");
    assert.equal(conversation.frozenWorldlineByResponder.get(2), opening, "late join never rewrites the opening baseline");

    const laterOpening = createConversation();
    laterOpening.initializePresence([2, 3]);
    calls.length = 0;
    await laterOpening.prefetchFrozenWorldline();
    assert(calls.every(call => JSON.stringify(call.activeParticipantIds) === "[2,3]" && call.mentionedEntityIds.length === 0),
      "a new opening uses its actual two-person roster while Gamma still waits");

    const legacyCalls = [];
    Conversation.configure({ worldlineService: { isSubjectivePromptIntegrationEnabled: () => false,
      getPromptContext: args => { legacyCalls.push(args); return { stableText: "Worldline" }; } } });
    await createConversation().prefetchFrozenWorldline();
    assert(legacyCalls.every(call => JSON.stringify(call.runtimeContext.activeParticipantIds) === "[2]" && call.mentionedEntityIds.length === 0),
      "non-subjective opening also cannot convert selected characters to presence or mentions");
    console.log("V8.14.1 Opening Presence: PASS (real worldline baseline, T0/T1 prompt, lawful knowledge, frozen prefix, legacy path)");
  } finally {
    service?.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
