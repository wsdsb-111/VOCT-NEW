"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const Handlebars = require("../resources/app/node_modules/handlebars").create();
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { Character } = require("../resources/app/out/main/game-data/character");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { createPromptBuilder } = require("../resources/app/out/main/prompts/prompt-builder");
const { createTemplateEngine } = require("../resources/app/out/main/prompts/template-engine");
const { PromptScriptLoader } = require("../resources/app/out/main/prompts/prompt-script-loader");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { LLMManager, ProviderRegistry, TokenCounter } = require("../resources/app/out/main/provider-service");

const root = path.resolve(__dirname, "..");
const promptsDir = path.join(root, "resources/app/default_userdata/prompts");
const temporary = fs.mkdtempSync(path.join(__dirname, ".v8.15.2-provider-traits-"));
const campaignToken = "votc-v8152-provider-fixture";
const date = "1164.5.20";
const nextYearDate = "1165.5.20";
const visibleKeys = [
  "beauty_good_1", "beauty_good_2", "beauty_good_3", "beauty_bad_1", "beauty_bad_2", "beauty_bad_3",
  "strong", "physique_good_1", "physique_good_2", "physique_good_3", "physique_bad_1", "physique_bad_2", "physique_bad_3",
  "albino", "scaly", "scarred", "clouded_eyes", "giant", "dwarf", "hunchbacked", "harelip", "clubfooted", "wheezing", "spindly",
  "one_eyed", "one_legged", "blind", "disfigured", "maimed", "incapable", "wounded_1", "wounded_2", "wounded_3",
  "measles", "weak",
  "obese", "malnourished", "bubonic_plague", "smallpox", "leper", "consumption", "typhus"
];
const observableBeforeWound = visibleKeys.filter(key => key !== "wounded_2");
const hiddenTraits = [
  { traitId: "intellect_good_3", name: "天才", localizedName: "天才", category: "Personality Trait" },
  { traitId: "brave", name: "勇敢", localizedName: "勇敢", category: "Personality Trait" },
  { traitId: "bastard", name: "私生子", localizedName: "私生子", category: "Secret Trait" }
];
const unknownSelfTrait = { traitId: "mod_uncertain", name: "城府深沉", localizedName: "城府深沉", category: "Other Mod Trait" };
const fingerprint = value => crypto.createHash("sha256").update(String(value || "")).digest("hex");
const GameData = createGameData({ fs, path, summariesDir: "", memorySystem: null, memoryEngine: null,
  getHistoricalReferenceByYear: () => null });
const mainTemplate = "SELFAGE={{character.age}};BIRTH={{character.birthDateTotalDays}}\nSELF={{#each character.traits}}{{traitId}}/{{localizedName}};{{/each}}\nOTHERS={{#each (otherCharacters gameData.characters character.id)}}[{{id}}:{{shortName}};AGE={{age}};BIRTH={{birthDateTotalDays}};{{#each traits}}{{traitId}}/{{localizedName}};{{/each}}]{{/each}}";

const settingsRepository = {
  getChatPromptV813Layout: () => false,
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: true,
    chatPromptV810ProviderAdapter: true, chatPromptV89OutboundDiagnostics: false }),
  getPromptSettings: () => ({ mainTemplate, blocks: [
    { id: "main", type: "main", enabled: true, role: "system" },
    { id: "character-description", type: "description", enabled: true,
      scriptPath: path.join(promptsDir, "character_description", "standard", "pListMccTest2.js") },
    { id: "history", type: "history", enabled: true },
    { id: "instruction", type: "instruction", enabled: true, role: "user", template: "Respond" }
  ] }),
  getActiveProviderConfig: () => ({ providerType: "openai-compatible", customName: "Fixture Provider",
    defaultModel: "fixture-model", customContextLength: 32768, customMaxOutputTokens: 512,
    defaultParameters: { temperature: 0, max_tokens: 512 } }),
  getGlobalStreamSetting: () => false,
  getCK3DebugLogPath: () => path.join(temporary, "debug.log")
};

const TemplateEngine = createTemplateEngine({ Handlebars, fs, path, defaultPromptsDir: promptsDir,
  promptsHelpersDir: path.join(promptsDir, "helpers"), PromptScriptSandbox });
const PromptBuilder = createPromptBuilder({ TemplateEngine, PromptScriptLoader, settingsRepository,
  promptConfigManager: { resolvePath: value => value, getDefaultMainTemplateContent: () => mainTemplate },
  path, TokenCounter, createPromptFingerprint: fingerprint, defaultChatInstruction: "Respond" });

const providerRequests = [];
class CapturingProvider {
  async chatCompletion(request) {
    providerRequests.push({ messages: request.messages.map(message => ({ role: message.role, content: message.content })) });
    return { content: "fixture response", usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 } };
  }
}
const registry = new ProviderRegistry();
registry.register("openai-compatible", CapturingProvider);
const llmManager = new LLMManager({ settingsRepository, providerRegistry: registry,
  usageAnalytics: { record() {} }, TokenCounter, PromptBuilder });
llmManager.getProviderCapabilities = async () => ({ providerType: "openai-compatible", modelId: "fixture-model",
  contextWindow: 32768, maxOutputTokens: 512 });

const trace = [];
const engine = new MemoryEngine({ baseDir: path.join(temporary, "memory"),
  summaryFoldersDir: path.join(temporary, "summaries"), trace: { record: (name, detail) => trace.push({ name, detail }) } });
for (const [id, name] of [[1, "甲"], [2, "乙"], [3, "丙"], [4, "丁"]]) {
  fs.mkdirSync(path.join(temporary, "summaries", `${id}_${name}`), { recursive: true });
}

function makeTrait(key, localizedName = `可见_${key}`) {
  return { traitId: key, name: localizedName, localizedName, category: "Appearance Trait" };
}

function visibleLabel(key) {
  if (key === "beauty_good_3") return "倾国倾城";
  if (key === "albino") return "白化病";
  if (key === "scarred") return "伤疤";
  if (key === "clouded_eyes") return "瞳孔浑浊";
  if (key === "measles") return "麻疹";
  if (key === "weak") return "虚弱";
  if (key === "wounded_2") return "重伤";
  return `可见_${key}`;
}

function promptSections(providerInput) {
  return {
    self: providerInput.match(/SELF=([^\r\n]*)/)?.[1] || "",
    others: providerInput.split("OTHERS=")[1]?.split(/\r?\n/)[0] || ""
  };
}

function makeCharacter(id, name, traits = [], age = 30, birthDateTotalDays = 414000) {
  return Object.assign(Object.create(Character.prototype), {
    id, firstName: name, shortName: name, fullName: name, name, nickname: null,
    gender: "male", sheHe: "he", age, birth: "1151.1.1", birthDate: "1151.1.1",
    birthDateTotalDays, birthTotalDays: birthDateTotalDays, gold: 100, prowess: 12, isDead: false, dead: false, alive: true,
    primaryTitle: "", titleRankConcept: "concept_none", heldCourtAndCouncilPositions: "",
    traits, personality: "", boldness: 50, compassion: 50, energy: 50, greed: 50, honor: 50,
    rationality: 50, sociability: 50, vengefulness: 50, zeal: 50,
    secrets: [], knownSecrets: [], modifiers: [], parents: [], children: [], siblings: [], spouses: [], concubines: [],
    relationsToCharacters: [], relationsToPlayer: [], opinions: [], opinionBreakdowns: []
  });
}

function makeGameData({ wound = false, gameDate = date,
  alphaAge = gameDate === nextYearDate ? 14 : 13,
  responderAge = gameDate === nextYearDate ? 31 : 30,
  totalDays = gameDate === nextYearDate ? 425365 : gameDate === date ? 425000 : 425001 } = {}) {
  const alphaTraits = observableBeforeWound.map(key => makeTrait(key, visibleLabel(key)));
  if (wound) alphaTraits.push(makeTrait("wounded_2", "重伤"));
  alphaTraits.push(...hiddenTraits);
  const characters = new Map([
    [1, makeCharacter(1, "甲", alphaTraits, alphaAge, 420000)],
    [2, makeCharacter(2, "乙", [makeTrait("strong", "强壮"), makeTrait("albino", "白化病"), makeTrait("scarred", "伤疤"),
      ...hiddenTraits.map(trait => ({ ...trait })), { ...unknownSelfTrait }], responderAge, 414000)],
    [3, makeCharacter(3, "丙", [makeTrait("one_eyed", "丙的独眼")], 30, 414000)],
    [4, makeCharacter(4, "丁", [makeTrait("beauty_good_3", "场外倾国倾城")], 30, 414000)]
  ]);
  return Object.assign(Object.create(GameData.prototype), {
    playerID: 1, playerName: "甲", aiID: 2, aiName: "乙", campaignToken, date: gameDate,
    year: Number(gameDate.slice(0, 4)), totalDays,
    scene: "hall", location: "厅堂", locationController: "甲", characters,
    mentionedCharactersInContext: new Set(), ck3RelationshipReadbackComplete: false,
    getMentionableCharacterProfiles() { return new Map(this.characters); },
    getMentionExclusionIds(activeIds = []) { return [...new Set([this.playerID, ...activeIds].map(Number))]; },
    getOfficialRecollectionSummary() { return null; },
    getActiveParticipantRelationshipInfo() { return ""; },
    getMentionedCharactersInfo() { return ""; },
    findMentionedCharacterIdsInHistory() { return []; },
    loadCharactersSummaries() {},
    syncOfficialRecollectionSummaries() {}
  });
}

function makeConversation(gameData, conversationId) {
  const conversation = Object.create(Conversation.prototype);
  Object.assign(conversation, {
    id: conversationId, conversationEpoch: null, gameData, messages: [], nextId: 0, isActive: true,
    isPaused: false, activeResponse: false, npcQueue: [], customQueue: null, inactiveParticipantIds: new Map(),
    pendingActionApprovals: new Map(),
    summaryParticipantProfiles: new Map(), stableProfileCache: new Map(), stableDescriptionCache: new Map(),
    disclosureProfilesByResponder: new Map(),
    cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() },
    frozenWorldlineByResponder: new Map(), frozenWorldlineCoverageByResponder: new Map(),
    worldlineCoveragePatchCacheByResponder: new Map(), selectedCharacterIds: new Set(), presentCharacterIds: new Set(),
    waitingCharacterIds: new Set(), temporarilyAbsentCharacterIds: new Map(), departedCharacterIds: new Set(),
    joinEvents: [], leaveEvents: [], presenceInitialized: false, turnEpoch: 1,
    memoryState: engine.createConversationState(conversationId), eventEmitter: new EventEmitter()
  });
  conversation.initializePresence([2]);
  conversation.messages.push({ id: conversation.nextId++, role: "user", content: "请描述在场人物。" });
  return conversation;
}

function seedAuthorizedAge(conversation) {
  const add = (speakerId, content) => {
    const speaker = conversation.gameData.characters.get(speakerId);
    const messageId = conversation.nextId++;
    conversation.messages.push({ id: messageId, role: "assistant", speakerCharacterId: speakerId,
      name: speaker.fullName, content, memory4Fragments: [{ start: 0, end: content.length,
        visibility: "participants", sourceType: "spoken", recipientIds: [speakerId === 2 ? 1 : 2], entityIds: [1, 2] }] });
    return messageId;
  };
  const questionId = add(2, "你今年多少岁？");
  const answerId = add(1, "今年13岁。");
  const context = conversation.buildFinalizationBaseContext();
  context.finalizationId = "v8152-provider-age-finalization";
  context.episodeId = "v8152-provider-age-episode";
  const snapshot = engine.memory4.buildOwnerSnapshot(context, 2);
  const question = snapshot.fragments.find(fragment => fragment.messageId === questionId);
  const answer = snapshot.fragments.find(fragment => fragment.messageId === answerId);
  assert(question && answer, "the AGE source uses real Owner-visible conversation fragments");
  assert.deepEqual(question.presentIds, [1, 2], "the AGE question was spoken in a shared scene");
  assert.deepEqual(answer.presentIds, [1, 2], "the AGE answer was spoken in a shared scene");
  const scope = { campaignToken, ownerId: 2 };
  engine.memory4.store.ensureDisclosureScope(scope);
  engine.memory4.store.recordKnownEvidence(snapshot);
  const characters = new Map(snapshot.disclosureCharacters.map(character => [character.id, character]));
  assert.equal(engine.memory4.recordDisclosures(snapshot, { campaignToken, date, characters }).status, "RECORDED",
    "the spoken age is persisted as a legitimate AGE proof before the Provider conversation opens");
  return snapshot;
}

function setupConversation(data, conversationId) {
  Conversation.configure({ memoryEngine: engine, settingsRepository, llmManager, PromptBuilder, TokenCounter,
    createPromptFingerprint: fingerprint, usageAnalytics: { record() {} },
    worldlineService: { getSettings: () => ({ v812MemoryEngine3Enabled: true, v812TemporalSummaryRecallEnabled: true }),
      isSubjectivePromptIntegrationEnabled: () => false },
    parseLog: async () => makeGameData({ wound: false }), createMessage: args => ({ type: "message", ...args }) });
  return makeConversation(data, conversationId);
}

async function providerTurn(conversation, responderId) {
  const responder = conversation.gameData.characters.get(responderId);
  const memoryContext = await conversation.getMemoryContextFor(responder, 32768);
  assert(memoryContext, `MemoryContext should exist for responder ${responderId}`);
  const history = conversation.getPromptHistoryForCharacter(responderId);
  const prompt = PromptBuilder.buildMessagesWithTokenCount(history, responder, conversation.gameData, "", memoryContext,
    settingsRepository.getActiveProviderConfig());
  const requestIndex = providerRequests.length;
  await llmManager.sendChatRequest(prompt.messages, undefined, true, { responderId, conversationId: conversation.id,
    blocks: prompt.blocks.map(entry => ({ id: entry.block.id, type: entry.block.type, content: entry.content })) });
  return { memoryContext, prompt, providerInput: providerRequests[requestIndex].messages.map(message => message.content).join("\n") };
}

function directFact(ownerId, targetId, traitKey, gameData) {
  return engine.memory4.getCurrentDisclosures({ campaignToken, ownerId }, targetId, gameData)
    .find(fact => fact.factType === "TRAIT" && fact.factKey === `trait_${traitKey}`);
}

function assertDirectProof(ownerId, targetId, traitKey, gameData) {
  const fact = directFact(ownerId, targetId, traitKey, gameData);
  assert(fact?.effectiveKnown, `${ownerId} should currently know ${targetId}.${traitKey}`);
  assert.equal(fact.sourceKind, "DIRECT_OBSERVATION", `${traitKey} must have direct-observation provenance`);
  assert.equal(fact.acquisitionKind, "VISIBLE_TRAIT", `${traitKey} must be acquired as a visible trait`);
  assert.equal(fact.currentDirectObservation, true, `${traitKey} must be backed by an active-scene observation`);
  const raw = engine.memory4.store.getDisclosedFacts({ campaignToken, ownerId }, targetId)
    .find(entry => entry.factKey === `trait_${traitKey}`);
  const proof = Object.values(raw?.evidenceBySource || {}).find(entry => entry.sourceKind === "DIRECT_OBSERVATION");
  assert(proof, `${traitKey} direct-observation proof must be persisted in Memory4`);
  assert.equal(proof.sourceConversationId, "v8152-opening");
  assert.equal(proof.targetId, targetId);
}

async function main() {
  const debugPath = settingsRepository.getCK3DebugLogPath();
  fs.writeFileSync(debugPath, "fixture only", "utf8");
  const initialData = makeGameData();
  const ageSourceConversation = setupConversation(initialData, "v8152-age-source");
  const ageSourceSnapshot = seedAuthorizedAge(ageSourceConversation);
  const conversation = setupConversation(initialData, "v8152-opening");
  const ownerScope = { campaignToken, ownerId: 2 };
  engine.memory4.store.ensureDisclosureScope(ownerScope);
  engine.memory4.refreshCurrentFactState(ownerScope, initialData);
  const beautyCandidate = engine.memory4.getCurrentDisclosures(ownerScope, 1, initialData)
    .find(fact => fact.factKey === "trait_beauty_good_3");
  engine.memory4.updateManualDisclosure(ownerScope, 1, beautyCandidate,
    "MANUAL_HIDDEN", initialData, { expectedRevision: beautyCandidate.revision });

  const first = await providerTurn(conversation, 2);
  const firstSections = promptSections(first.providerInput);
  assert(firstSections.others.includes("beauty_good_3/倾国倾城"), "first ProviderInput must already include the visible beauty trait for B");
  assert(firstSections.others.includes("[1:甲;AGE=13;BIRTH=420000;"),
    "a legitimate age disclosure lets the Other profile read current CK3 age 13");
  assert(first.providerInput.includes("甲's character info:") && first.providerInput.includes("age: 13"),
    "the real PromptScriptSandbox description path carries the authorized Other age into ProviderInput");
  assert(first.providerInput.includes("SELFAGE=30;BIRTH=414000"), "the Self profile retains the responder's full own age data");
  assert(first.providerInput.includes("乙's character info:") && first.providerInput.includes("age: 30"),
    "the real description script retains the responder's own age");
  for (const key of observableBeforeWound) {
    assertDirectProof(2, 1, key, initialData);
    assert(firstSections.others.includes(`${key}/${visibleLabel(key)}`), `${key} should reach the first ProviderInput as an observed trait`);
  }
  for (const trait of [makeTrait("strong", "强壮"), makeTrait("albino", "白化病"), makeTrait("scarred", "伤疤"),
    ...hiddenTraits, unknownSelfTrait]) {
    assert(firstSections.self.includes(`${trait.traitId}/${trait.localizedName}`),
      `responder B must retain its own ${trait.traitId} trait in the Self prompt section`);
  }
  for (const trait of hiddenTraits) {
    assert(!firstSections.others.includes(trait.traitId) && !firstSections.others.includes(trait.localizedName),
      `unreported ${trait.traitId} must stay out of other-character profiles`);
  }
  assert(!firstSections.others.includes(unknownSelfTrait.traitId) && !firstSections.others.includes(unknownSelfTrait.localizedName),
    "an unknown mod trait on responder B must stay out of other-character profiles");
  assert(!first.providerInput.includes("场外倾国倾城"), "waiting D's raw observable trait must not leak into the prompt");
  assert(!first.providerInput.includes("丙的独眼"), "waiting C's raw observable trait must not leak before joining");
  const ageRecordAtOpening = engine.memory4.store.getDisclosedFacts(ownerScope, 1)
    .find(fact => fact.factType === "AGE" && fact.value === "13");
  assert(ageRecordAtOpening, "the legal current-age claim is stored as history before the opening prompt");
  const currentBeauty = directFact(2, 1, "beauty_good_3", initialData);
  assert.equal(currentBeauty.status, "AUTO_DISCLOSED", "same-scene observation overrides the earlier manual-hidden view");
  assert.throws(() => engine.memory4.updateManualDisclosure(ownerScope, 1, currentBeauty,
    "MANUAL_HIDDEN", initialData, { expectedRevision: currentBeauty.revision }), /memory4_disclosure_directly_observable/,
  "a current same-scene visible trait cannot be manually hidden as though it were unknowable");
  assert.equal(engine.memory4.store.getDisclosedFacts(ownerScope, 4)
    .some(fact => Object.values(fact.evidenceBySource || {}).some(proof => proof.sourceKind === "DIRECT_OBSERVATION")), false,
  "an off-scene waiting character must not receive any direct-observation proof");

  const directContext = conversation.gameData.directObservationContext;
  const observe = args => engine.memory4.observeVisibleTraits({ ...directContext, observerId: 2, targetId: 4,
    gameData: conversation.gameData, ...args });
  assert.equal(observe({ campaignToken: "spoofed-campaign" }).status, "SKIPPED", "campaign mismatch fails closed");
  assert.equal(observe({ gameDate: "1164.5.21" }).status, "SKIPPED", "game-date mismatch fails closed");
  assert.equal(observe({ participantPresence: [
    { characterId: 2, joinedAtMessageId: directContext.messageBoundary + 1, leftAtMessageId: null },
    { characterId: 4, joinedAtMessageId: 0, leftAtMessageId: null }
  ] }).status, "SKIPPED", "an observer window beginning after the boundary fails closed");
  assert.equal(observe({ participantPresence: [
    { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: directContext.messageBoundary },
    { characterId: 4, joinedAtMessageId: 0, leftAtMessageId: null }
  ] }).status, "SKIPPED", "an observer window ending at the boundary fails closed");
  assert.equal(engine.memory4.store.getDisclosedFacts(ownerScope, 4).length, 0,
    "spoofed scene tuples cannot persist off-scene observation evidence");
  assert.equal(directContext.messageBoundary, conversation.nextId, "the observation proof uses the real conversation boundary");
  assert.deepEqual(directContext.participantPresence.filter(window => [1, 2].includes(Number(window.characterId)))
    .map(window => Number(window.characterId)).sort(), [1, 2], "the observation proof uses actual player/responder presence windows");

  conversation.stableProfileCache.set("unchanged", "retain");
  conversation.stableDescriptionCache.set("unchanged", "retain");
  conversation.cacheV2FrozenSnapshots.responders.set(2, "retain");
  conversation.cacheV2FrozenSnapshots.prefixByResponder.set(2, "retain");
  const firstPrefix = Conversation.buildPromptBlockMetadata(first.prompt).prefixFingerprint;
  conversation.observeVisibleTraits();
  const repeated = await providerTurn(conversation, 2);
  assert.equal(Conversation.buildPromptBlockMetadata(repeated.prompt).prefixFingerprint, firstPrefix,
    "an unchanged observation keeps the provider's stable prefix fingerprint");
  assert.equal(conversation.stableProfileCache.get("unchanged"), "retain", "an unchanged observation does not clear the stable profile cache");
  assert.equal(conversation.stableDescriptionCache.get("unchanged"), "retain", "an unchanged observation does not clear the description cache");
  assert.equal(conversation.cacheV2FrozenSnapshots.responders.get(2), "retain", "an unchanged observation does not clear responder snapshots");
  assert.equal(conversation.cacheV2FrozenSnapshots.prefixByResponder.get(2), "retain", "an unchanged observation does not clear frozen prefixes");

  const join = await conversation.joinWaitingCharacter(3);
  assert.equal(join.success, true, "late join should enter the scene before its first ProviderInput");
  const joinedData = conversation.gameData;
  assertDirectProof(2, 3, "one_eyed", joinedData);
  assertDirectProof(3, 1, "beauty_good_3", joinedData);
  assertDirectProof(3, 2, "strong", joinedData);
  assertDirectProof(3, 2, "albino", joinedData);
  assertDirectProof(3, 2, "scarred", joinedData);
  const firstForJoiner = await providerTurn(conversation, 3);
  const joinerSections = promptSections(firstForJoiner.providerInput);
  assert(!joinerSections.others.includes("[1:甲;AGE=13;") && !firstForJoiner.providerInput.includes("age: 13"),
    "a late joiner with no AGE proof cannot inherit another Owner's current-age authorization");
  assert(joinerSections.others.includes("beauty_good_3/倾国倾城"), "late joiner should observe A before C's first response");
  assert(joinerSections.others.includes("strong/强壮"), "late joiner should observe B before C's first response");
  assert(joinerSections.others.includes("albino/白化病"), "late joiner should observe B's visible albinism");
  assert(joinerSections.others.includes("scarred/伤疤"), "late joiner should observe B's visible scarring");
  for (const trait of hiddenTraits) {
    assert(!joinerSections.others.includes(trait.traitId) && !joinerSections.others.includes(trait.localizedName),
      `late joiner must not see B's unreported ${trait.traitId} trait`);
  }
  assert(!joinerSections.others.includes(unknownSelfTrait.traitId) && !joinerSections.others.includes(unknownSelfTrait.localizedName),
    "late joiner must not see B's unknown mod trait");
  assert(!firstForJoiner.providerInput.includes("场外倾国倾城"), "late join must not make off-scene D observable");
  assert.equal(engine.memory4.store.getDisclosedFacts({ campaignToken, ownerId: 3 }, 4).length, 0,
    "late join cannot transfer observation rights to off-scene D");

  const nextDate = nextYearDate;
  const observedData = makeGameData({ wound: true, gameDate: nextDate });
  let refreshData = observedData;
  Conversation.configure({ parseLog: async () => refreshData });
  conversation.stableProfileCache.set("old", "stale");
  conversation.stableDescriptionCache.set("old", "stale");
  conversation.cacheV2FrozenSnapshots.responders.set(2, "stale");
  conversation.cacheV2FrozenSnapshots.prefixByResponder.set(2, "stale");
  await conversation.refreshGameDataForActionConfirmation();
  assertDirectProof(2, 1, "wounded_2", conversation.gameData);
  const advancedBeauty = directFact(2, 1, "beauty_good_3", conversation.gameData);
  assert.equal(advancedBeauty.firstAcquiredDate, date, "a continuing direct proof keeps its original first-acquired date");
  assert.equal(advancedBeauty.lastConfirmedDate, nextDate, "a continuing direct proof advances its last-confirmed date");
  const advancedBeautyRaw = engine.memory4.store.getDisclosedFacts(ownerScope, 1)
    .find(entry => entry.factKey === "trait_beauty_good_3");
  assert.equal(advancedBeautyRaw.firstAcquiredDate, date, "persisted first-acquired date must not drift on refresh");
  assert.equal(advancedBeautyRaw.lastConfirmedDate, nextDate, "persisted last-confirmed date must advance with observation");
  const beautyProofs = Object.values(advancedBeautyRaw.evidenceBySource)
    .filter(entry => entry.sourceKind === "DIRECT_OBSERVATION");
  const initialBeautyProof = beautyProofs.find(entry => entry.observedGameDate === date);
  const advancedBeautyProof = beautyProofs.find(entry => entry.observedGameDate === nextDate);
  assert(initialBeautyProof, "the initial dated direct-observation proof must remain persisted");
  assert(advancedBeautyProof, "a later confirmation must add a dated direct-observation proof");
  assert.equal(initialBeautyProof.acquiredDate, date, "the initial direct proof must retain its acquisition date");
  assert.equal(advancedBeautyProof.acquiredDate, nextDate, "a later dated direct proof must carry its own acquisition date");
  const advancedAge = engine.memory4.getCurrentDisclosures(ownerScope, 1, conversation.gameData)
    .find(fact => fact.factType === "AGE");
  assert.equal(advancedAge?.value, "13", "the historical AGE disclosure remains the spoken value after the year changes");
  assert.equal(advancedAge?.currentKnownAge, 14, "the authorized profile reads the new current CK3 age");
  assert.equal(advancedAge?.currentAgeReadDate, nextDate, "the current AGE read is scoped to the new game date");
  const historicalAgeAfterYear = engine.memory4.store.getDisclosedFacts(ownerScope, 1)
    .find(fact => fact.factType === "AGE" && fact.value === "13");
  assert.equal(historicalAgeAfterYear?.firstAcquiredDate, date, "the AGE acquisition date remains the original spoken date");
  assert.deepEqual(historicalAgeAfterYear?.evidenceBySource, ageRecordAtOpening.evidenceBySource,
    "current-age reading does not fabricate or mutate the historical AGE evidence");
  for (const key of visibleKeys) assertDirectProof(2, 1, key, conversation.gameData);
  assert.equal(conversation.stableProfileCache.size, 0, "new observation invalidates stable profile cache");
  assert.equal(conversation.stableDescriptionCache.size, 0, "new observation invalidates stable description cache");
  assert.equal(conversation.cacheV2FrozenSnapshots.responders.size, 0, "new observation invalidates responder snapshots");
  assert.equal(conversation.cacheV2FrozenSnapshots.prefixByResponder.size, 0, "new observation invalidates frozen prompt prefixes");
  const woundedTurn = await providerTurn(conversation, 2);
  assert(woundedTurn.providerInput.includes("wounded_2/重伤"), "new current wound should reach the next ProviderInput");
  const woundedSections = promptSections(woundedTurn.providerInput);
  assert(woundedSections.others.includes("[1:甲;AGE=14;BIRTH=420000;"),
    "cross-year ProviderInput reads current age 14 from CK3 without rewriting the historical claim");
  assert(woundedTurn.providerInput.includes("甲's character info:") && woundedTurn.providerInput.includes("age: 14"),
    "the real description script refreshes authorized current age across the year boundary");
  assert(woundedTurn.providerInput.includes("SELFAGE=31;BIRTH=414000") && woundedTurn.providerInput.includes("age: 31"),
    "the responder's Self age remains complete and current after the year changes");
  for (const key of visibleKeys) {
    const label = visibleLabel(key);
    assert(woundedTurn.providerInput.includes(`${key}/${label}`), `${key} should reach the ProviderInput`);
  }

  const frozenAge = conversation.disclosureProfilesByResponder.get(`${campaignToken}:2`)?.get(1)
    ?.find(fact => fact.factType === "AGE");
  assert(frozenAge?.effectiveKnown, "the opening profile freezes the legitimate AGE source for this Owner");
  const forgottenAge = engine.memory4.forgetSummaryProjection({ campaignToken, perspectiveOwnerId: 2,
    characterId: 1, conversationId: ageSourceSnapshot.conversationId, finalizationId: ageSourceSnapshot.finalizationId,
    sourceMessageIds: [1, 2], segmentIds: ageSourceSnapshot.fragments.map(fragment => fragment.fragmentId) },
  { ownerId: 2, counterpartId: 1 });
  assert(forgottenAge.disclosureEvidenceRevoked > 0, "forgetting the source revokes the frozen AGE authorization");
  const withoutForgottenAge = await providerTurn(conversation, 2);
  const forgottenProfile = conversation.disclosureProfilesByResponder.get(`${campaignToken}:2`)?.get(1) || [];
  assert.equal(forgottenProfile.some(fact => fact.factType === "AGE" && fact.effectiveKnown), false,
    "a frozen AGE profile is removed after its source is forgotten");
  assert(!promptSections(withoutForgottenAge.providerInput).others.includes("[1:甲;AGE=14;")
    && !withoutForgottenAge.providerInput.includes("age: 14"),
  "a forgotten AGE source cannot leak current CK3 age through the real ProviderInput");

  refreshData = makeGameData({ wound: false, gameDate: date });
  await conversation.refreshGameDataForActionConfirmation();
  const rolledBackEye = directFact(2, 1, "one_eyed", conversation.gameData);
  assert.equal(rolledBackEye?.effectiveKnown, true,
    "rolling back to the original observation date must retain that date's direct knowledge");
  assert.equal(rolledBackEye?.firstAcquiredDate, date, "rollback projection keeps the original acquisition date");
  assert.equal(rolledBackEye?.lastConfirmedDate, date, "rollback projection must not reveal a future confirmation date");
  assert.equal(rolledBackEye?.currentDirectObservation, false,
    "a proof last refreshed in the future is historical rather than a current-scene observation after rollback");
  assert.equal(directFact(2, 1, "wounded_2", conversation.gameData), undefined,
    "a wound first observed on the later date must not leak into an earlier-date projection");
  const earlierData = makeGameData({ wound: false, gameDate: "1164.5.19" });
  refreshData = earlierData;
  await conversation.refreshGameDataForActionConfirmation();
  assert.equal(directFact(2, 1, "one_eyed", conversation.gameData)?.effectiveKnown, false,
    "direct knowledge must not leak before its first-acquired date");
  assert.equal(directFact(2, 1, "wounded_2", conversation.gameData), undefined,
    "future wound proof must remain absent before its acquisition date");

  refreshData = makeGameData({ wound: false, gameDate: nextDate });
  conversation.stableProfileCache.set("old", "stale");
  conversation.stableDescriptionCache.set("old", "stale");
  conversation.cacheV2FrozenSnapshots.responders.set(2, "stale");
  conversation.cacheV2FrozenSnapshots.prefixByResponder.set(2, "stale");
  await conversation.refreshGameDataForActionConfirmation();
  assert.equal(directFact(2, 1, "wounded_2", conversation.gameData), undefined,
    "a removed current wound must not remain in the current disclosure projection");
  assert.equal(conversation.stableProfileCache.size, 0, "current-truth removal invalidates stable profile cache");
  assert.equal(conversation.stableDescriptionCache.size, 0, "current-truth removal invalidates stable description cache");
  assert.equal(conversation.cacheV2FrozenSnapshots.responders.size, 0, "current-truth removal invalidates responder snapshots");
  assert.equal(conversation.cacheV2FrozenSnapshots.prefixByResponder.size, 0, "current-truth removal invalidates frozen prompt prefixes");
  const removedTurn = await providerTurn(conversation, 2);
  assert(!removedTurn.providerInput.includes("wounded_2/重伤"), "removed wound must disappear from the next ProviderInput");

  const persistedEyeProof = engine.memory4.store.getDisclosedFacts(ownerScope, 1)
    .find(entry => entry.factKey === "trait_one_eyed");
  assert(Object.values(persistedEyeProof.evidenceBySource).some(proof => proof.sourceKind === "DIRECT_OBSERVATION"),
    "leaving the scene must preserve historical direct-observation evidence");
  conversation.markParticipantInactive(1, "left");
  const leftEye = directFact(2, 1, "one_eyed", conversation.gameData);
  assert(leftEye?.effectiveKnown, "leaving the scene must not erase historical observation knowledge");
  assert.equal(leftEye.currentDirectObservation, false, "leaving the scene immediately closes current direct observation");
  assert.equal(leftEye.sourceKind, "DIRECT_OBSERVATION", "the departed character's historical observation source remains intact");
  const hiddenAfterLeave = engine.memory4.updateManualDisclosure(ownerScope, 1, leftEye, "MANUAL_HIDDEN",
    conversation.gameData, { expectedRevision: leftEye.revision });
  assert.equal(hiddenAfterLeave.status, "MANUAL_HIDDEN", "a departed character's trait can be manually hidden after leaving the scene");
  assert.equal(directFact(2, 1, "one_eyed", conversation.gameData).effectiveKnown, false,
    "manual hidden state can suppress historical knowledge after departure");

  assert(!trace.some(entry => JSON.stringify(entry).includes("天才") || JSON.stringify(entry).includes("勇敢")
    || JSON.stringify(entry).includes("私生子")), "diagnostics must not record private trait text");
  console.log("V8.15.2 Provider Visible Traits: PASS (Self preservation, first-request disclosure, full whitelist, hidden/off-scene isolation, late join, date rollback, leave/manual-hidden, refresh/removal, cache invalidation)");
}

Conversation.configure({ settingsRepository, llmManager, PromptBuilder, TokenCounter,
  createPromptFingerprint: fingerprint, usageAnalytics: { record() {} } });

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(() => {
  const target = path.resolve(temporary);
  if (target.startsWith(path.resolve(__dirname) + path.sep)) fs.rmSync(target, { recursive: true, force: true });
});
