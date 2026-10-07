"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const events = require("node:events");
const crypto = require("node:crypto");
const Handlebars = require("../resources/app/node_modules/handlebars").create();
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { getFactCandidates, scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const { createPromptBuilder } = require("../resources/app/out/main/prompts/prompt-builder");
const { createTemplateEngine } = require("../resources/app/out/main/prompts/template-engine");
const { PromptScriptLoader } = require("../resources/app/out/main/prompts/prompt-script-loader");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { LLMManager, ProviderRegistry, TokenCounter } = require("../resources/app/out/main/provider-service");
const memorySystem = require("../resources/app/out/main/memory-system");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8152-age-claims-qa-"));
const baseDir = path.join(temporary, "memory");
const summariesDir = path.join(temporary, "summaries");
const campaignToken = "v8152-age-owner-qa";
const sourceDate = "1164.5.20";
const nextDate = "1165.5.20";
const debugLogPath = path.join(temporary, "debug.log");
let conversationSequence = 0;
const root = path.resolve(__dirname, "..");
const promptsDir = path.join(root, "resources/app/default_userdata/prompts");
const mainTemplate = "SELF={{character.shortName}}/{{character.age}}\nOTHERS={{#each (otherCharacters gameData.characters character.id)}}[{{id}}:{{shortName}};AGE={{age}}]{{/each}}";
const settingsRepository = {
  getCK3DebugLogPath: () => debugLogPath,
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
  getGlobalStreamSetting: () => false
};
const TemplateEngine = createTemplateEngine({ Handlebars, fs, path, defaultPromptsDir: promptsDir,
  promptsHelpersDir: path.join(promptsDir, "helpers"), PromptScriptSandbox });
const PromptBuilder = createPromptBuilder({ TemplateEngine, PromptScriptLoader, settingsRepository,
  promptConfigManager: { resolvePath: value => value, getDefaultMainTemplateContent: () => mainTemplate },
  path, TokenCounter, createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
  defaultChatInstruction: "Respond" });
const providerRequests = [];
class CapturingProvider {
  async chatCompletion(request) {
    providerRequests.push({ messages: request.messages.map(message => ({ role: message.role, content: message.content })) });
    return { content: "fixture response", usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 } };
  }
}
const providerRegistry = new ProviderRegistry();
providerRegistry.register("openai-compatible", CapturingProvider);
const llmManager = new LLMManager({ settingsRepository, providerRegistry, usageAnalytics: { record() {} },
  TokenCounter, PromptBuilder });
llmManager.getProviderCapabilities = async () => ({ providerType: "openai-compatible", modelId: "fixture-model",
  contextWindow: 32768, maxOutputTokens: 512 });

for (const [id, name] of [[1, "甲"], [2, "乙"], [3, "丙"], [4, "丁"], [5, "戊"]]) {
  fs.mkdirSync(path.join(summariesDir, `${id}_${name}`), { recursive: true });
}
fs.writeFileSync(debugLogPath, "synthetic QA fixture", "utf8");

function makeCharacter(id, name, age) {
  return { id, name, firstName: name, shortName: name, fullName: name, age, traits: [], secrets: [], knownSecrets: [],
    gender: "male", sheHe: "he", birth: "1151.1.1", birthDate: "1151.1.1", birthDateTotalDays: 414000,
    birthTotalDays: 414000, gold: 100, prowess: 12, isDead: false, dead: false, alive: true,
    primaryTitle: "", titleRankConcept: "concept_none", heldCourtAndCouncilPositions: "", personality: "",
    boldness: 50, compassion: 50, energy: 50, greed: 50, honor: 50, rationality: 50, sociability: 50,
    vengefulness: 50, zeal: 50, modifiers: [], parents: [], children: [], siblings: [],
    spouses: [], concubines: [], relationsToCharacters: [], relationsToPlayer: [], opinions: [], opinionBreakdowns: [] };
}

function makeCharacters({ npcAge = 13, thirdAge = 10, fourthAge = 12 } = {}) {
  const responder = makeCharacter(2, "乙", npcAge);
  responder.primaryTitle = "皇帝";
  responder.traits = [{ traitId: "brave", name: "勇敢", localizedName: "勇敢", category: "Personality Trait" }];
  return new Map([[1, makeCharacter(1, "甲", 16)], [2, responder],
    [3, makeCharacter(3, "丙", thirdAge)], [4, makeCharacter(4, "丁", fourthAge)]]);
}

function makeGameData(characters = makeCharacters(), date = sourceDate) {
  return { campaignToken, date, totalDays: date === sourceDate ? 425000 : 425365, year: Number(date.slice(0, 4)), playerID: 1, playerName: "甲", aiID: 2, aiName: "乙",
    scene: "hall", location: "厅堂", locationController: "甲", characters, mentionedCharactersInContext: new Set(),
    ck3RelationshipReadbackComplete: false,
    getMentionableCharacterProfiles() { return new Map(this.characters); },
    getMentionExclusionIds(activeIds = []) { return [...new Set([this.playerID, ...activeIds].map(Number))]; },
    getOfficialRecollectionSummary() { return null; },
    getActiveParticipantRelationshipInfo() { return ""; },
    getMentionedCharactersInfo() { return ""; },
    findMentionedCharacterIdsInHistory() { return []; },
    loadCharactersSummaries() {}, syncOfficialRecollectionSummaries() {} };
}

function makeMessage(id, role, speakerId, text, { visibility = "participants", knownBy = null, entityIds = [1, 2, 3, 4],
  recipientIds = [1, 2, 3, 4].filter(characterId => characterId !== speakerId), sourceType = "spoken",
  annotated = true, fragmentEnd = text.length } = {}) {
  const character = makeCharacters().get(speakerId);
  const message = { id, role, speakerCharacterId: speakerId, name: character?.shortName || "", content: text };
  if (annotated) message.memory4Fragments = [{ start: 0, end: fragmentEnd, visibility, sourceType,
    ...(knownBy ? { knownBy } : {}), recipientIds, entityIds }];
  return message;
}

function makeOwnerSnapshot(engine, messages, { npcAge = 13, ownerId = 1, conversationId = "age-negative-fixture" } = {}) {
  const characters = makeCharacters({ npcAge });
  const participants = [...characters.values()];
  const context = { campaignToken, conversationId, finalizationId: `${conversationId}-finalization`,
    episodeId: `${conversationId}-episode`, date: sourceDate, totalDays: 425000, participants,
    participantPresence: participants.map(character => ({ characterId: character.id, joinedAtMessageId: 0, leftAtMessageId: null })),
    disclosureCharacters: participants.map(character => ({ id: character.id,
      names: [character.firstName, character.shortName, character.fullName, character.name],
      facts: getFactCandidates(character) })),
    messages };
  return { snapshot: engine.memory4.buildOwnerSnapshot(context, ownerId), characters };
}

function scan(engine, messages, options) {
  const { snapshot, characters } = makeOwnerSnapshot(engine, messages, options);
  return scanVisibleDisclosures(snapshot, { campaignToken, date: snapshot.date, characters });
}

function addMessage(conversation, id, role, speakerId, text) {
  conversation.messages.push(makeMessage(id, role, speakerId, text));
}

function makeConversationFixture(engine, conversationId, { characters = makeCharacters(), date = sourceDate,
  presentIds = [1, 2, 3, 4] } = {}) {
  const gameData = makeGameData(characters, date);
  const conversation = Object.create(Conversation.prototype);
  const npcIds = [...characters.keys()].filter(id => Number(id) !== Number(gameData.playerID));
  Object.assign(conversation, { id: conversationId, conversationEpoch: null, gameData, messages: [], nextId: 0,
    isActive: true, isPaused: false, activeResponse: false, npcQueue: [], customQueue: null,
    inactiveParticipantIds: new Map(), pendingActionApprovals: new Map(), summaryParticipantProfiles: new Map(),
    stableProfileCache: new Map(), stableDescriptionCache: new Map(), disclosureProfilesByResponder: new Map(),
    cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() },
    frozenWorldlineByResponder: new Map(), frozenWorldlineCoverageByResponder: new Map(),
    worldlineCoveragePatchCacheByResponder: new Map(), selectedCharacterIds: new Set(npcIds),
    presentCharacterIds: new Set(presentIds.filter(id => id !== Number(gameData.playerID))),
    waitingCharacterIds: new Set(npcIds.filter(id => !presentIds.includes(id))),
    temporarilyAbsentCharacterIds: new Map(), departedCharacterIds: new Set(), joinEvents: [], leaveEvents: [],
    presenceInitialized: true, turnEpoch: 1, memoryState: engine.createConversationState(conversationId),
    eventEmitter: new events.EventEmitter() });
  engine.observeParticipants(conversation, presentIds, 0);
  return conversation;
}

function appendConversationMessage(conversation, role, speakerId, text, options) {
  const id = conversation.nextId++;
  conversation.messages.push(makeMessage(id, role, speakerId, text, options));
  return id;
}

function buildOwnerSnapshot(engine, conversation, ownerId) {
  const context = conversation.buildFinalizationBaseContext();
  context.finalizationId = `${conversation.id}-${ownerId}-finalization`;
  context.episodeId = `${conversation.id}-${ownerId}-episode`;
  return engine.memory4.buildOwnerSnapshot(context, ownerId);
}

function recordConversationDisclosures(engine, snapshot) {
  const scope = { campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId };
  engine.memory4.store.ensureDisclosureScope(scope);
  engine.memory4.store.recordKnownEvidence(snapshot);
  const characters = new Map(snapshot.disclosureCharacters.map(character => [character.id, character]));
  return engine.memory4.recordDisclosures(snapshot, { campaignToken: snapshot.campaignToken, date: snapshot.date, characters });
}

function scanConversation(engine, conversation, ownerId) {
  const snapshot = buildOwnerSnapshot(engine, conversation, ownerId);
  const characters = new Map(snapshot.disclosureCharacters.map(character => [character.id, character]));
  return { snapshot, result: scanVisibleDisclosures(snapshot, { campaignToken: snapshot.campaignToken,
    date: snapshot.date, characters }) };
}

async function providerTurn(conversation, responderId) {
  const responder = conversation.gameData.characters.get(responderId);
  const memoryContext = await conversation.getMemoryContextFor(responder, 32768);
  assert(memoryContext, `MemoryContext should exist for responder ${responderId}`);
  const history = conversation.getPromptHistoryForCharacter(responderId);
  const prompt = PromptBuilder.buildMessagesWithTokenCount(history, responder, conversation.gameData, "", memoryContext,
    settingsRepository.getActiveProviderConfig());
  const requestIndex = providerRequests.length;
  await llmManager.sendChatRequest(prompt.messages, undefined, true, { responderId, conversationId: conversation.id });
  return { memoryContext, prompt, providerInput: providerRequests[requestIndex].messages.map(message => message.content).join("\n") };
}

async function main() {
  const engine = new MemoryEngine({ baseDir, summaryFoldersDir: summariesDir, trace: { record() {} } });
  const gameData = makeGameData();
  Conversation.configure({ memoryEngine: engine, settingsRepository, llmManager, PromptBuilder, TokenCounter,
    usageAnalytics: { record() {} },
    worldlineService: { getSettings: () => ({ v812MemoryEngine3Enabled: true, v812TemporalSummaryRecallEnabled: true }),
      isSubjectivePromptIntegrationEnabled: () => false },
    createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
    runFileManager: { isAvailable: () => true }, parseLog: async () => gameData,
    createError: input => ({ type: "error", ...input }), createMessage: input => ({ type: "message", ...input }),
    events, uuid: { v4: () => `v8152-age-question-answer-${++conversationSequence}` }, path });
  const conversation = new Conversation();
  await conversation.gameDataReady;
  await conversation.worldlinePrefetchPromise;
  await conversation.memoryRecoveryPromise;
  engine.observeParticipants(conversation, [1, 2], 0);
  addMessage(conversation, 1, "user", 1, "你今年多少岁？");
  addMessage(conversation, 2, "assistant", 2, "今年13岁。");
  conversation.nextId = 3;

  const context = conversation.buildFinalizationBaseContext();
  context.finalizationId = "v8152-age-question-answer-finalization";
  context.episodeId = "v8152-age-question-answer-episode";
  const ownerSnapshot = engine.memory4.buildOwnerSnapshot(context, 1);
  const questionFragment = ownerSnapshot.fragments.find(fragment => fragment.messageId === 1);
  const answerFragment = ownerSnapshot.fragments.find(fragment => fragment.messageId === 2);
  assert(questionFragment && answerFragment, "the real Conversation owner snapshot retains both spoken fragments");
  assert.equal(questionFragment.sourceRole, "user");
  assert.equal(answerFragment.sourceRole, "assistant");
  assert.deepEqual(questionFragment.presentIds, [1, 2], "the two original participants heard the age question");
  assert.deepEqual(answerFragment.presentIds, [1, 2], "the answer was visible to the original Owner");
  assert(questionFragment.knownBy.includes(1) && questionFragment.knownBy.includes(2));
  assert(answerFragment.knownBy.includes(1));

  const sourceCharacters = new Map(ownerSnapshot.disclosureCharacters.map(character => [character.id, character]));
  const scanned = scanVisibleDisclosures(ownerSnapshot, { campaignToken, date: sourceDate, characters: sourceCharacters });
  const ageDisclosure = scanned.disclosures.find(row => row.entityId === 2 && row.factType === "AGE" && row.value === "13");
  assert(ageDisclosure, "the two-person age question binds the NPC's matching subjectless answer for its questioner");
  assert.deepEqual(ageDisclosure.evidence.sourceMessageIds, [1, 2], "both question and answer message IDs are retained as evidence");
  assert(ageDisclosure.evidence.sourceFragmentIds.length >= 2, "both question and answer fragment IDs are retained");
  assert.equal(ageDisclosure.evidence.sourceTextHashes.length, 2, "both question and answer text hashes are retained");

  const scope = { campaignToken, ownerId: 1 };
  const recorded = recordConversationDisclosures(engine, ownerSnapshot);
  assert.equal(recorded.status, "RECORDED", "the question-bound age passes through the real Memory4 persistence path");
  const listenerConversation = new Conversation();
  await listenerConversation.gameDataReady;
  await listenerConversation.worldlinePrefetchPromise;
  await listenerConversation.memoryRecoveryPromise;
  listenerConversation.presentCharacterIds = new Set([2, 3, 4]);
  listenerConversation.waitingCharacterIds.clear();
  engine.observeParticipants(listenerConversation, [1, 2, 3, 4], 0);
  addMessage(listenerConversation, 1, "user", 1, "乙，你今年多少岁？");
  addMessage(listenerConversation, 2, "assistant", 2, "今年13岁。");
  listenerConversation.nextId = 3;
  const listenerSnapshots = new Map();
  for (const ownerId of [3, 4]) {
    const listenerSnapshot = buildOwnerSnapshot(engine, listenerConversation, ownerId);
    const listenerQuestion = listenerSnapshot.fragments.find(fragment => fragment.messageId === 1);
    const listenerAnswer = listenerSnapshot.fragments.find(fragment => fragment.messageId === 2);
    assert(listenerQuestion && listenerAnswer, `Owner ${ownerId} has both spoken fragments in the real owner snapshot`);
    assert(listenerQuestion.knownBy.includes(ownerId) && listenerAnswer.knownBy.includes(ownerId),
      `Owner ${ownerId} heard both halves of the question and answer`);
    const listenerResult = scanVisibleDisclosures(listenerSnapshot, { campaignToken, date: sourceDate,
      characters: new Map(listenerSnapshot.disclosureCharacters.map(character => [character.id, character])) });
    const listenerAge = listenerResult.disclosures.find(row => row.entityId === 2 && row.factType === "AGE" && row.value === "13");
    assert(listenerAge, `Owner ${ownerId} can learn the named responder's age as a legal four-person listener`);
    assert.deepEqual(listenerAge.evidence.sourceMessageIds, [1, 2], "listener evidence retains both source messages");
    const listenerScope = { campaignToken, ownerId };
    const listenerRecorded = recordConversationDisclosures(engine, listenerSnapshot);
    assert.equal(listenerRecorded.status, "RECORDED", `Owner ${ownerId} persists the listener disclosure`);
    const fact = engine.memory4.store.getDisclosedFacts(listenerScope, 2)
      .find(row => row.factType === "AGE" && row.value === "13");
    const proof = Object.values(fact?.evidenceBySource || {}).find(row => row.sourceKind === "CONVERSATION");
    assert(proof, `Owner ${ownerId} has persisted conversation evidence`);
    assert.deepEqual(proof.knownBy, [ownerId], "each listener proof remains scoped to exactly that Owner");
    assert.deepEqual(proof.sourceMessageIds, [1, 2], "persisted listener proof links question and answer");
    listenerSnapshots.set(ownerId, listenerSnapshot);
  }
  const persisted = engine.memory4.store.getDisclosedFacts(scope, 2).find(fact => fact.factType === "AGE" && fact.value === "13");
  assert(persisted, "the age claim is written to the Memory4 disclosure store");
  const persistedProof = Object.values(persisted.evidenceBySource).find(proof => proof.sourceKind === "CONVERSATION");
  assert.deepEqual(persistedProof.sourceMessageIds, [1, 2], "persisted proof must link the question and answer");

  const reopened = new MemoryEngine({ baseDir, summaryFoldersDir: summariesDir, trace: { record() {} } });
  const currentTruth = makeGameData(makeCharacters({ npcAge: 14 }), nextDate);
  currentTruth.characters.get(1).age = 17;
  const afterRestart = reopened.memory4.getCurrentDisclosures(scope, 2, currentTruth)
    .find(fact => fact.factType === "AGE");
  assert.equal(afterRestart?.value, "13", "restart reads the spoken age rather than replacing it with backend age 14");
  assert.equal(afterRestart?.firstAcquiredDate, sourceDate, "restart preserves the question-bound acquisition date");
  assert.equal(afterRestart?.current, false, "the saved age remains a historical disclosure, not current truth");
  assert.equal(afterRestart?.currentKnownAge, 14, "a valid historical age disclosure authorizes reading the current CK3 age");
  assert.equal(afterRestart?.currentAgeReadDate, nextDate, "the current age carries its actual as-of game date");
  const unchangedHistory = reopened.memory4.store.getDisclosedFacts(scope, 2)
    .find(fact => fact.factType === "AGE" && fact.value === "13");
  assert.equal(unchangedHistory?.value, "13", "reading current age must not rewrite the historical spoken value");
  assert.equal(unchangedHistory?.firstAcquiredDate, sourceDate, "reading current age must not alter the historical learned date");
  assert.deepEqual(unchangedHistory?.evidenceBySource, persisted.evidenceBySource,
    "reading current age must not fabricate or mutate the historical disclosure proof");

  const archivedAge = reopened.memory4.getCurrentDisclosures(scope, 2, null, { currentGameDate: nextDate })
    .find(fact => fact.factType === "AGE");
  assert.equal(archivedAge?.value, "13", "archive reads retain the historical spoken age");
  assert.equal(archivedAge?.currentKnownAge, null, "archive/history reads never overlay a current CK3 age");
  assert.equal(archivedAge?.currentAgeReadDate, null, "archive/history reads do not invent a current-age read date");
  const beforeDisclosure = reopened.memory4.getCurrentDisclosures(scope, 2,
    makeGameData(makeCharacters({ npcAge: 13 }), "1164.5.19"));
  assert.equal(beforeDisclosure.some(fact => fact.factType === "AGE"), false,
    "an age proof dated in the future cannot authorize current age before it was learned");
  const unavailableAge = reopened.memory4.getCurrentDisclosures(scope, 2,
    makeGameData(makeCharacters({ npcAge: null }), nextDate)).find(fact => fact.factType === "AGE");
  assert.equal(unavailableAge?.currentKnownAge, null, "missing current CK3 age remains unavailable despite historical authorization");
  assert.throws(() => reopened.memory4.getCurrentDisclosures(scope, 2,
    { ...currentTruth, campaignToken: "wrong-campaign" }), /memory4_disclosure_current_scope_invalid/,
  "a campaign mismatch fails closed instead of carrying current age across campaigns");
  const listenerScope = { campaignToken, ownerId: 3 };
  const listenerAfterRestart = reopened.memory4.getCurrentDisclosures(listenerScope, 2, currentTruth)
    .find(fact => fact.factType === "AGE");
  assert.equal(listenerAfterRestart?.value, "13", "a listener's persisted age remains the historical answer after restart");
  assert.equal(listenerAfterRestart?.firstAcquiredDate, sourceDate, "listener evidence retains its acquisition date across the year boundary");
  assert.equal(listenerAfterRestart?.currentKnownAge, 14, "a listener's authorized profile reads current age 14 in 1165");
  assert.equal(listenerAfterRestart?.currentAgeReadDate, nextDate, "listener current age carries its actual 1165 read date");
  assert.equal(reopened.memory4.getCurrentDisclosures({ campaignToken, ownerId: 5 }, 2, currentTruth)
    .some(fact => fact.factType === "AGE"), false,
  "an Owner without its own conversation proof receives no age authorization");
  assert.throws(() => reopened.memory4.getCurrentDisclosures({ campaignToken: "wrong-campaign", ownerId: 3 }, 2, currentTruth),
    /memory4_disclosure_current_scope_invalid/,
  "a different campaign fails closed instead of carrying a listener age authorization");

  const uiConversation = { id: "v8152-age-ui-context", isActive: true, gameData: currentTruth };
  const summariesManager = createSummariesManager({ fs, path, summariesDir, memoryEngine: reopened, memorySystem,
    getCurrentConversation: () => uiConversation,
    requestSummary: async () => { throw new Error("AGE UI DTO read must not call a provider"); } });
  const uiData = await summariesManager.getMemory4OwnerData({ ownerId: 1, expectedCampaignToken: campaignToken,
    expectedContextId: uiConversation.id });
  const uiProfile = uiData.known.items.find(item => item.entityId === 2);
  const uiAge = uiProfile?.disclosedFacts.find(fact => fact.factType === "AGE");
  assert.equal(uiAge?.value, "13", "the Memory4 UI DTO exposes the persisted spoken age");
  assert.equal(uiAge?.current, false, "the UI DTO labels the saved age historical after CK3 age changes");
  assert.equal(uiAge?.firstAcquiredDate, sourceDate);
  assert.equal(uiAge?.currentKnownAge, 14, "the live UI DTO separates authorized current age from the historical value");
  assert.equal(uiAge?.currentAgeReadDate, nextDate, "the live UI DTO records when current CK3 age was read");
  const listenerUiConversation = { id: listenerConversation.id, isActive: true, gameData: currentTruth };
  const listenerSummariesManager = createSummariesManager({ fs, path, summariesDir, memoryEngine: reopened, memorySystem,
    getCurrentConversation: () => listenerUiConversation,
    requestSummary: async () => { throw new Error("AGE UI DTO read must not call a provider"); } });
  const listenerUiData = await listenerSummariesManager.getMemory4OwnerData({ ownerId: 3,
    expectedCampaignToken: campaignToken, expectedContextId: listenerUiConversation.id });
  const listenerUiAge = listenerUiData.known.items.find(item => item.entityId === 2)?.disclosedFacts
    .find(fact => fact.factType === "AGE");
  assert.equal(listenerUiAge?.value, "13", "the listener UI DTO exposes the persisted spoken age after the year advances");
  assert.equal(listenerUiAge?.currentKnownAge, 14, "the listener UI DTO projects current age separately from the historical answer");

  Conversation.configure({ memoryEngine: reopened, settingsRepository, llmManager, PromptBuilder, TokenCounter,
    usageAnalytics: { record() {} },
    worldlineService: { getSettings: () => ({ v812MemoryEngine3Enabled: true, v812TemporalSummaryRecallEnabled: true }),
      isSubjectivePromptIntegrationEnabled: () => false },
    createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
    runFileManager: { isAvailable: () => true }, parseLog: async () => currentTruth,
    createError: input => ({ type: "error", ...input }), createMessage: input => ({ type: "message", ...input }),
    events, uuid: { v4: () => `v8152-age-provider-${++conversationSequence}` }, path });
  listenerConversation.gameData = currentTruth;
  listenerConversation.presentCharacterIds = new Set([2, 3, 4]);
  listenerConversation.disclosureProfilesByResponder.clear();
  appendConversationMessage(listenerConversation, "user", 1, "丙今年多少岁？");
  const listenerProviderTurn = await providerTurn(listenerConversation, 3);
  const listenerPromptAge = listenerProviderTurn.memoryContext.disclosureProfiles.get(2)
    .find(fact => fact.factType === "AGE");
  assert.equal(listenerPromptAge?.value, "13", "Conversation memory context retains the spoken age for the listener");
  assert.equal(listenerPromptAge?.currentKnownAge, 14, "Conversation memory context reads the current CK3 age after restart");
  assert(listenerProviderTurn.providerInput.includes("[2:乙;AGE=14]"),
    "the real PromptBuilder and captured Provider request contain the listener-authorized current age");

  const playerAnswerConversation = makeConversationFixture(reopened, "age-player-user-answer");
  appendConversationMessage(playerAnswerConversation, "assistant", 3, "甲，你今年多少岁？");
  appendConversationMessage(playerAnswerConversation, "user", 1, "今年16岁。");
  const playerAnswerSnapshots = new Map();
  for (const ownerId of [4, 2]) {
    const { snapshot: playerSnapshot, result: playerResult } = scanConversation(reopened, playerAnswerConversation, ownerId);
    const playerAnswerFragment = playerSnapshot.fragments.find(fragment => fragment.messageId === 1);
    assert.equal(playerAnswerFragment?.sourceRole, "user", "the player's answer keeps its real user role");
    assert.equal(playerAnswerFragment?.speakerId, 1, "the player remains the source speaker");
    const playerAge = playerResult.disclosures.find(row => row.entityId === 1 && row.factType === "AGE" && row.value === "16");
    assert(playerAge, `Owner ${ownerId} learns the player's matching bare age answer to an NPC question`);
    assert.deepEqual(playerAge.evidence.sourceMessageIds, [0, 1], "the player's question and answer sources remain paired");
    const playerRecorded = recordConversationDisclosures(reopened, playerSnapshot);
    assert.equal(playerRecorded.status, "RECORDED", `Owner ${ownerId} persists the player's age answer`);
    const playerFact = reopened.memory4.store.getDisclosedFacts({ campaignToken, ownerId }, 1)
      .find(row => row.factType === "AGE" && row.value === "16");
    const playerProof = Object.values(playerFact?.evidenceBySource || {}).find(row => row.sourceKind === "CONVERSATION");
    assert(playerProof, `Owner ${ownerId} receives a persisted player-age proof`);
    assert.deepEqual(playerProof.knownBy, [ownerId], "player-age evidence remains isolated per Owner");
    assert.deepEqual(playerProof.sourceMessageIds, [0, 1], "persisted player-age proof keeps both source messages");
    playerAnswerSnapshots.set(ownerId, playerSnapshot);
  }

  const restartedPlayerEngine = new MemoryEngine({ baseDir, summaryFoldersDir: summariesDir, trace: { record() {} } });
  const playerOwner4Scope = { campaignToken, ownerId: 4 };
  const playerOwner4Age = restartedPlayerEngine.memory4.getCurrentDisclosures(playerOwner4Scope, 1, currentTruth)
    .find(row => row.factType === "AGE");
  assert.equal(playerOwner4Age?.value, "16", "restart preserves the player's spoken age as historical evidence");
  assert.equal(playerOwner4Age?.firstAcquiredDate, sourceDate);
  assert.equal(playerOwner4Age?.current, false, "the saved player age remains historical after CK3 advances");
  assert.equal(playerOwner4Age?.currentKnownAge, 17, "the historical proof authorizes a separate current CK3 age");
  assert.equal(playerOwner4Age?.currentAgeReadDate, nextDate);
  const playerOwner2Age = restartedPlayerEngine.memory4.getCurrentDisclosures({ campaignToken, ownerId: 2 }, 1, currentTruth)
    .find(row => row.factType === "AGE");
  assert.equal(playerOwner2Age?.value, "16", "a second Owner recovers its independent copy of the player's age");
  assert.equal(playerOwner2Age?.currentKnownAge, 17);

  const playerUiConversation = { id: playerAnswerConversation.id, isActive: true, gameData: currentTruth };
  const playerSummariesManager = createSummariesManager({ fs, path, summariesDir, memoryEngine: restartedPlayerEngine, memorySystem,
    getCurrentConversation: () => playerUiConversation,
    requestSummary: async () => { throw new Error("player AGE UI DTO read must not call a provider"); } });
  const playerUiData = await playerSummariesManager.getMemory4OwnerData({ ownerId: 4,
    expectedCampaignToken: campaignToken, expectedContextId: playerUiConversation.id });
  const playerUiAge = playerUiData.known.items.find(item => item.entityId === 1)?.disclosedFacts
    .find(row => row.factType === "AGE");
  assert.equal(playerUiAge?.value, "16", "the UI DTO keeps the player's historical spoken age");
  assert.equal(playerUiAge?.current, false);
  assert.equal(playerUiAge?.currentKnownAge, 17, "the UI DTO separates the current CK3 age from the spoken value");
  assert.equal(playerUiAge?.currentAgeReadDate, nextDate);

  Conversation.configure({ memoryEngine: restartedPlayerEngine, settingsRepository, llmManager, PromptBuilder, TokenCounter,
    usageAnalytics: { record() {} },
    worldlineService: { getSettings: () => ({ v812MemoryEngine3Enabled: true, v812TemporalSummaryRecallEnabled: true }),
      isSubjectivePromptIntegrationEnabled: () => false },
    createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
    runFileManager: { isAvailable: () => true }, parseLog: async () => currentTruth,
    createError: input => ({ type: "error", ...input }), createMessage: input => ({ type: "message", ...input }),
    events, uuid: { v4: () => `v8152-player-age-provider-${++conversationSequence}` }, path });
  playerAnswerConversation.gameData = currentTruth;
  playerAnswerConversation.disclosureProfilesByResponder.clear();
  const playerProviderTurn = await providerTurn(playerAnswerConversation, 4);
  const playerPromptAge = playerProviderTurn.memoryContext.disclosureProfiles.get(1)
    .find(row => row.factType === "AGE");
  assert.equal(playerPromptAge?.value, "16", "the NPC prompt retains the historical player age");
  assert.equal(playerPromptAge?.currentKnownAge, 17, "the NPC prompt receives the authorized current player age");
  assert(playerProviderTurn.providerInput.includes("[1:甲;AGE=17]"),
    "the captured real Provider request contains the current player age authorized by its proof");

  const playerOwner2Snapshot = playerAnswerSnapshots.get(2);
  const forgottenPlayerProjection = restartedPlayerEngine.memory4.forgetSummaryProjection({ campaignToken,
    perspectiveOwnerId: 2, characterId: 1, conversationId: playerOwner2Snapshot.conversationId,
    finalizationId: playerOwner2Snapshot.finalizationId, sourceMessageIds: [0, 1],
    segmentIds: playerOwner2Snapshot.fragments.map(fragment => fragment.fragmentId) }, { ownerId: 2, counterpartId: 1 });
  assert(forgottenPlayerProjection.disclosureEvidenceRevoked > 0, "forgetting revokes the player's age proof for that Owner");
  assert.equal(restartedPlayerEngine.memory4.getCurrentDisclosures({ campaignToken, ownerId: 2 }, 1, currentTruth)
    .find(row => row.factType === "AGE")?.currentKnownAge ?? null, null,
  "forgetting the source removes Owner 2's current-age authorization");
  assert.equal(restartedPlayerEngine.memory4.getCurrentDisclosures(playerOwner4Scope, 1, currentTruth)
    .find(row => row.factType === "AGE")?.currentKnownAge, 17,
  "forgetting Owner 2's source leaves Owner 4's independent proof intact");
  playerAnswerConversation.disclosureProfilesByResponder.clear();
  const forgottenPlayerProviderTurn = await providerTurn(playerAnswerConversation, 2);
  assert.equal(forgottenPlayerProviderTurn.memoryContext.disclosureProfiles.get(1)
    .some(row => row.factType === "AGE"), false, "the refreshed NPC context drops the forgotten player age");
  assert.equal(forgottenPlayerProviderTurn.providerInput.includes("[1:甲;AGE=17]"), false,
    "the real Provider request no longer contains current player age after Forget");

  const playerOwner4Snapshot = playerAnswerSnapshots.get(4);
  assert.deepEqual(playerOwner4Snapshot.projectionLineages, [],
    "this direct disclosure fixture has no directed-summary projection lineage");
  const owner4NpcAgeProof = Object.values(reopened.memory4.store.getDisclosedFacts({ campaignToken, ownerId: 4 }, 2)
    .find(row => row.factType === "AGE" && row.value === "13")?.evidenceBySource || {})
    .find(proof => proof.sourceKind === "CONVERSATION");
  const owner4PlayerAgeProof = Object.values(reopened.memory4.store.getDisclosedFacts({ campaignToken, ownerId: 4 }, 1)
    .find(row => row.factType === "AGE" && row.value === "16")?.evidenceBySource || {})
    .find(proof => proof.sourceKind === "CONVERSATION");
  assert.deepEqual(owner4NpcAgeProof?.sourceMessageIds, [1, 2]);
  assert.deepEqual(owner4PlayerAgeProof?.sourceMessageIds, [0, 1]);
  assert.notEqual(owner4NpcAgeProof?.sourceConversationId, owner4PlayerAgeProof?.sourceConversationId,
    "the synthetic cross-conversation fallback repro uses distinct conversation scopes with overlapping local IDs");
  assert.throws(() => restartedPlayerEngine.memory4.forgetSummaryProjection({ campaignToken,
    perspectiveOwnerId: 4, characterId: 1, conversationId: playerOwner4Snapshot.conversationId,
    finalizationId: playerOwner4Snapshot.finalizationId, sourceMessageIds: [0, 1],
    segmentIds: playerOwner4Snapshot.fragments.map(fragment => fragment.fragmentId) }, { ownerId: 4, counterpartId: 1 }),
  /memory4_projection_disclosure_unmapped/,
  "the legacy no-lineage fallback fails closed when a different conversation has a partially overlapping local message ID");
  assert.equal(restartedPlayerEngine.memory4.getCurrentDisclosures(playerOwner4Scope, 1, currentTruth)
    .find(row => row.factType === "AGE")?.currentKnownAge, 17,
  "the fail-closed cross-conversation Forget rejection preserves the Owner's valid player-age proof");
  assert.equal(restartedPlayerEngine.memory4.getCurrentDisclosures(playerOwner4Scope, 2, currentTruth)
    .find(row => row.factType === "AGE")?.currentKnownAge, 14,
  "the fail-closed cross-conversation Forget rejection preserves the unrelated NPC-age proof");

  const forgottenProjection = reopened.memory4.forgetSummaryProjection({ campaignToken, perspectiveOwnerId: 1,
    characterId: 2, conversationId: ownerSnapshot.conversationId, finalizationId: ownerSnapshot.finalizationId,
    sourceMessageIds: [1, 2], segmentIds: ownerSnapshot.fragments.map(fragment => fragment.fragmentId) },
  { ownerId: 1, counterpartId: 2 });
  assert(forgottenProjection.disclosureEvidenceRevoked > 0, "forgetting the age source revokes its disclosure authorization");
  const forgottenAge = reopened.memory4.getCurrentDisclosures(scope, 2, currentTruth)
    .find(fact => fact.factType === "AGE");
  assert.equal(forgottenAge?.currentKnownAge ?? null, null, "a forgotten historical disclosure no longer authorizes current age");
  const forgottenListenerProjection = reopened.memory4.forgetSummaryProjection({ campaignToken, perspectiveOwnerId: 3,
    characterId: 2, conversationId: listenerSnapshots.get(3).conversationId,
    finalizationId: listenerSnapshots.get(3).finalizationId, sourceMessageIds: [1, 2],
    segmentIds: listenerSnapshots.get(3).fragments.map(fragment => fragment.fragmentId) },
  { ownerId: 3, counterpartId: 2 });
  assert(forgottenListenerProjection.disclosureEvidenceRevoked > 0,
    "forgetting a listener's source revokes that Owner's AGE proof");
  const forgottenListenerAge = reopened.memory4.getCurrentDisclosures(listenerScope, 2, currentTruth)
    .find(fact => fact.factType === "AGE");
  assert.equal(forgottenListenerAge?.currentKnownAge ?? null, null,
    "a forgotten listener proof no longer authorizes current age");
  listenerConversation.disclosureProfilesByResponder.clear();
  const forgottenListenerProviderTurn = await providerTurn(listenerConversation, 3);
  assert.equal(forgottenListenerProviderTurn.memoryContext.disclosureProfiles.get(2)
    .some(fact => fact.factType === "AGE"), false,
  "a listener's refreshed Conversation context drops the forgotten age authorization");
  assert.equal(forgottenListenerProviderTurn.providerInput.includes("[2:乙;AGE=14]"), false,
    "the real Provider input omits current age after the listener forgets its source");
  assert.equal(reopened.memory4.getCurrentDisclosures({ campaignToken, ownerId: 4 }, 2, currentTruth)
    .find(fact => fact.factType === "AGE")?.currentKnownAge, 14,
  "forgetting one listener's source does not revoke another Owner's independent proof");

  const answer = makeMessage(2, "assistant", 2, "今年13岁。");
  assert.equal(scan(engine, [answer]).disclosures.some(row => row.entityId === 2 && row.factType === "AGE"), false,
    "a subjectless answer without an Owner age question is not disclosed");
  assert.equal(scan(engine, [makeMessage(1, "user", 1, "你喜欢这座城吗？"), answer]).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE"), false,
  "an unrelated Owner question cannot authorize an age answer");
  assert.equal(scan(engine, [makeMessage(1, "user", 1, "你今年多少岁？"),
    makeMessage(2, "assistant", 3, "丙插话：“我有件事想说。”"),
    makeMessage(3, "assistant", 2, "今年13岁。")]).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE"), false,
  "a third NPC interruption breaks the Owner question-to-answer binding");
  assert.equal(scan(engine, [makeMessage(1, "user", 1, "你今年多少岁？", { visibility: "private" }), answer]).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE"), false,
  "a private question the responder could not hear cannot authorize an age answer");
  assert.equal(scan(engine, [makeMessage(1, "user", 1, "我今年16岁比你大三岁。")]).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE"), false,
  "a comparative age difference cannot be used to infer the other character's age");
  assert.equal(scan(engine, [makeMessage(1, "user", 1, "你今年多少岁？"), answer], { npcAge: 14 }).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE"), false,
  "an answer that disagrees with the current CK3 age is rejected");
  assert(scan(engine, [makeMessage(1, "assistant", 2, "我今年13岁。")]).disclosures
    .some(row => row.entityId === 2 && row.factType === "AGE" && row.value === "13"),
  "an explicit current self-age assertion remains admissible without a question");

  Conversation.configure({ memoryEngine: engine, settingsRepository, llmManager, PromptBuilder, TokenCounter,
    usageAnalytics: { record() {} },
    worldlineService: { getSettings: () => ({ v812MemoryEngine3Enabled: true, v812TemporalSummaryRecallEnabled: true }),
      isSubjectivePromptIntegrationEnabled: () => false },
    createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
    runFileManager: { isAvailable: () => true }, parseLog: async () => makeGameData(),
    createError: input => ({ type: "error", ...input }), createMessage: input => ({ type: "message", ...input }),
    events, uuid: { v4: () => `v8152-age-boundary-${++conversationSequence}` }, path });
  const hasAge = (result, entityId = null) => result.disclosures.some(row => row.factType === "AGE"
    && (entityId == null || row.entityId === entityId));

  const playerBareAnswer = makeConversationFixture(engine, "age-player-bare-user-answer");
  appendConversationMessage(playerBareAnswer, "assistant", 3, "甲，你今年多少岁？");
  appendConversationMessage(playerBareAnswer, "user", 1, "今年16岁。");
  const playerBareOwner = scanConversation(engine, playerBareAnswer, 4);
  const playerBareFragment = playerBareOwner.snapshot.fragments.find(fragment => fragment.messageId === 1);
  assert.equal(playerBareFragment?.sourceRole, "user", "a player answer retains its real user role");
  assert.equal(playerBareFragment?.speakerId, 1, "the bare answer is spoken by the player character");
  assert(hasAge(playerBareOwner.result, 1), "an NPC's question and the player's bare current-age answer authorize a listener");

  const hiddenSpoken = makeConversationFixture(engine, "age-hidden-spoken-interruption");
  appendConversationMessage(hiddenSpoken, "assistant", 3, "甲，你今年多少岁？");
  const hiddenSpokenId = appendConversationMessage(hiddenSpoken, "assistant", 2, "乙悄声对丙说：稍后再说。",
    { visibility: "known_group", recipientIds: [3], entityIds: [2, 3] });
  appendConversationMessage(hiddenSpoken, "user", 1, "今年16岁。");
  const hiddenSpokenOwner = scanConversation(engine, hiddenSpoken, 4);
  assert.equal(hiddenSpokenOwner.snapshot.fragments.some(fragment => fragment.messageId === hiddenSpokenId), false,
    "the real projection omits the private spoken source from an unrelated Owner");
  assert(hiddenSpokenOwner.snapshot.spokenMessageIds.includes(hiddenSpokenId),
    "the projection retains only the source ID for the hidden spoken message");
  assert.equal(hiddenSpokenOwner.snapshot.withheldMessageIds.includes(hiddenSpokenId), false,
    "a complete hidden annotation is not misrepresented as a withheld gap");
  assert.equal(hasAge(hiddenSpokenOwner.result, 1), false,
    "an Owner-invisible but verified spoken message breaks bare-age question binding");

  const withheldSpoken = makeConversationFixture(engine, "age-withheld-spoken-gap");
  appendConversationMessage(withheldSpoken, "assistant", 3, "甲，你今年多少岁？");
  const spokenPrefix = "乙悄声对丙说：稍后再说。";
  const withheldSpokenId = appendConversationMessage(withheldSpoken, "assistant", 2, `${spokenPrefix}未分类尾注`,
    { visibility: "known_group", recipientIds: [3], entityIds: [2, 3], fragmentEnd: spokenPrefix.length });
  appendConversationMessage(withheldSpoken, "user", 1, "今年16岁。");
  const withheldSpokenOwner = scanConversation(engine, withheldSpoken, 4);
  assert(withheldSpokenOwner.snapshot.spokenMessageIds.includes(withheldSpokenId),
    "the source ID comes from the actual annotated spoken span");
  assert(withheldSpokenOwner.snapshot.withheldMessageIds.includes(withheldSpokenId),
    "projectVisibleTranscript marks the unclassified tail as a real withheld message ID");
  assert.equal(hasAge(withheldSpokenOwner.result, 1), false,
    "a production withheld spoken-message ID breaks bare-age binding");

  const finalizationClassified = makeConversationFixture(engine, "age-finalization-classified-interruption");
  appendConversationMessage(finalizationClassified, "assistant", 3, "甲，你今年多少岁？");
  const classifiedText = "乙悄声对丙说：稍后再说。";
  const classifiedId = appendConversationMessage(finalizationClassified, "assistant", 2, classifiedText, { annotated: false });
  appendConversationMessage(finalizationClassified, "user", 1, "今年16岁。");
  const classifiedContext = finalizationClassified.buildFinalizationBaseContext();
  classifiedContext.finalizationId = `${finalizationClassified.id}-finalization`;
  classifiedContext.episodeId = `${finalizationClassified.id}-episode`;
  classifiedContext.verifiedSummarySegments = [{ segmentId: "age-hidden-classified-segment", content: classifiedText,
    participants: [2, 3], knownBy: [2, 3], visibility: "known_group", source: "spoken",
    provenance: { messageIds: [classifiedId], speakerIds: [2], extractionMode: "visibility_source_paragraph" } }];
  const classifiedSnapshot = engine.memory4.buildOwnerSnapshot(classifiedContext, 4);
  const classifiedResult = scanVisibleDisclosures(classifiedSnapshot, { campaignToken,
    date: classifiedSnapshot.date, characters: new Map(classifiedSnapshot.disclosureCharacters.map(character => [character.id, character])) });
  assert.equal(classifiedSnapshot.fragments.some(fragment => fragment.messageId === classifiedId), false,
    "a verified private finalization source remains absent from an Owner outside its audience");
  assert.equal(classifiedSnapshot.withheldMessageIds.includes(classifiedId), false,
    "the coordinator removes a message classified by verified finalization evidence from withheld IDs");
  assert(classifiedSnapshot.spokenMessageIds.includes(classifiedId),
    "the verified source message ID still reaches the Owner projection without its content");
  assert.equal(hasAge(classifiedResult, 1), false,
    "finalization-classified invisible speech breaks bare-age binding after withheld cleanup");

  const nonSpokenTrace = makeConversationFixture(engine, "age-nonspoken-trace-between-answer");
  appendConversationMessage(nonSpokenTrace, "assistant", 3, "甲，你今年多少岁？");
  const traceId = nonSpokenTrace.nextId++;
  nonSpokenTrace.messages.push({ id: traceId, role: "system", kind: "internal_trace", content: "state refresh" });
  appendConversationMessage(nonSpokenTrace, "user", 1, "今年16岁。");
  const nonSpokenOwner = scanConversation(engine, nonSpokenTrace, 4);
  assert.equal(nonSpokenOwner.snapshot.spokenMessageIds.includes(traceId), false,
    "a system/internal trace is not recorded as a spoken source");
  assert.equal(nonSpokenOwner.snapshot.withheldMessageIds.includes(traceId), false,
    "a nonspoken trace does not become a withheld spoken source");
  assert(hasAge(nonSpokenOwner.result, 1), "a nonspoken internal trace does not break a bare-age exchange");

  for (const sourceType of ["witnessed", "game_fact"]) {
    const nonSpokenSource = makeConversationFixture(engine, `age-${sourceType}-interruption`);
    appendConversationMessage(nonSpokenSource, "user", 1, "乙，你今年多少岁？");
    const nonSpokenMessageId = appendConversationMessage(nonSpokenSource, "assistant", 3, "丙的当前状态已确认。",
      { sourceType });
    appendConversationMessage(nonSpokenSource, "assistant", 2, "今年13岁。");
    const nonSpokenSourceOwner = scanConversation(engine, nonSpokenSource, 4);
    assert(nonSpokenSourceOwner.snapshot.fragments.some(fragment => fragment.messageId === nonSpokenMessageId
      && fragment.sourceType === sourceType), `${sourceType} remains a real annotated nonspoken fragment`);
    assert.equal(nonSpokenSourceOwner.snapshot.spokenMessageIds.includes(nonSpokenMessageId), false,
      `${sourceType} is excluded from spoken-message provenance`);
    assert(hasAge(nonSpokenSourceOwner.result, 2), `${sourceType} does not break question-to-answer binding`);
  }

  const explicitAfterHidden = makeConversationFixture(engine, "age-explicit-self-after-hidden-message");
  appendConversationMessage(explicitAfterHidden, "assistant", 3, "甲，你今年多少岁？");
  appendConversationMessage(explicitAfterHidden, "assistant", 2, "乙悄声对丙说：稍后再说。",
    { visibility: "known_group", recipientIds: [3], entityIds: [2, 3] });
  appendConversationMessage(explicitAfterHidden, "user", 1, "我今年16岁。");
  const explicitAfterHiddenOwner = scanConversation(engine, explicitAfterHidden, 4);
  const explicitPlayerAge = explicitAfterHiddenOwner.result.disclosures.find(row => row.entityId === 1 && row.factType === "AGE");
  assert(explicitPlayerAge, "an explicit player self-age remains admissible after an unrelated hidden message");
  assert.deepEqual(explicitPlayerAge.evidence.sourceMessageIds, [2],
    "an explicit self-age stands on its own answer source without reusing the old question");

  const threePerson = makeConversationFixture(engine, "age-three-person", { presentIds: [1, 2, 3] });
  appendConversationMessage(threePerson, "user", 1, "乙，你今年多少岁？");
  appendConversationMessage(threePerson, "assistant", 2, "今年13岁。");
  const threePersonOwner = scanConversation(engine, threePerson, 3);
  assert(hasAge(threePersonOwner.result, 2), "a third participant learns the age after hearing a uniquely named Q&A");

  const namedOnly = makeConversationFixture(engine, "age-named-only-target");
  appendConversationMessage(namedOnly, "user", 1, "乙今年多大？");
  appendConversationMessage(namedOnly, "assistant", 2, "今年13岁。");
  assert(hasAge(scanConversation(engine, namedOnly, 3).result, 2),
    "a uniquely named target does not require a second-person pronoun");

  const completeSelfReport = makeConversationFixture(engine, "age-complete-self-report");
  appendConversationMessage(completeSelfReport, "assistant", 2, "我今年13岁。");
  for (const ownerId of [3, 4]) {
    assert(hasAge(scanConversation(engine, completeSelfReport, ownerId).result, 2),
      `Owner ${ownerId} may learn a complete current self-age report without a preceding question`);
  }

  const ownerExcludedQuestion = makeConversationFixture(engine, "age-acl-owner-excluded-question");
  appendConversationMessage(ownerExcludedQuestion, "user", 1, "乙，你今年多少岁？", { knownBy: [1, 2, 4] });
  appendConversationMessage(ownerExcludedQuestion, "assistant", 2, "今年13岁。");
  const ownerExcludedQuestionSnapshot = buildOwnerSnapshot(engine, ownerExcludedQuestion, 4);
  const ownerExcludedQuestionFragment = ownerExcludedQuestionSnapshot.fragments.find(fragment => fragment.messageId === 0);
  assert.deepEqual(ownerExcludedQuestionFragment.presentIds, [1, 2, 3, 4]);
  assert.equal(ownerExcludedQuestionFragment.knownBy.includes(3), false);
  assert.deepEqual(ownerExcludedQuestion.messages[0].memory4Fragments[0].recipientIds, [2, 3, 4],
    "the raw recipient list still includes the listener despite its narrower Q ACL");
  assert.equal(hasAge(scanConversation(engine, ownerExcludedQuestion, 3).result), false,
    "being present and listed as a recipient cannot replace an Owner-excluded question ACL");

  const ownerExcludedAnswer = makeConversationFixture(engine, "age-acl-owner-excluded-answer");
  appendConversationMessage(ownerExcludedAnswer, "user", 1, "乙，你今年多少岁？");
  appendConversationMessage(ownerExcludedAnswer, "assistant", 2, "今年13岁。", { knownBy: [1, 2, 4] });
  const ownerExcludedAnswerSnapshot = buildOwnerSnapshot(engine, ownerExcludedAnswer, 4);
  const ownerExcludedAnswerFragment = ownerExcludedAnswerSnapshot.fragments.find(fragment => fragment.messageId === 1);
  assert.deepEqual(ownerExcludedAnswerFragment.presentIds, [1, 2, 3, 4]);
  assert.equal(ownerExcludedAnswerFragment.knownBy.includes(3), false);
  assert.deepEqual(ownerExcludedAnswer.messages[1].memory4Fragments[0].recipientIds, [1, 3, 4],
    "the raw recipient list still includes the listener despite its narrower A ACL");
  assert.equal(hasAge(scanConversation(engine, ownerExcludedAnswer, 3).result), false,
    "being present and listed as a recipient cannot replace an Owner-excluded answer ACL");

  const responderExcludedQuestion = makeConversationFixture(engine, "age-acl-responder-excluded-question");
  appendConversationMessage(responderExcludedQuestion, "user", 1, "乙，你今年多少岁？", { knownBy: [1, 3, 4] });
  appendConversationMessage(responderExcludedQuestion, "assistant", 2, "今年13岁。");
  const responderExcludedSnapshot = scanConversation(engine, responderExcludedQuestion, 3);
  const responderExcludedFragment = responderExcludedSnapshot.snapshot.fragments.find(fragment => fragment.messageId === 0);
  assert.deepEqual(responderExcludedFragment.presentIds, [1, 2, 3, 4]);
  assert.equal(responderExcludedFragment.knownBy.includes(2), false);
  assert.deepEqual(responderExcludedQuestion.messages[0].memory4Fragments[0].recipientIds, [2, 3, 4],
    "the raw recipient list includes the responder but cannot override the Q ACL");
  assert.equal(hasAge(responderExcludedSnapshot.result), false,
    "a responder excluded from the question ACL cannot be attributed its following answer");

  const quotedNpcQuestion = makeConversationFixture(engine, "age-quoted-npc-question");
  appendConversationMessage(quotedNpcQuestion, "assistant", 3, "“乙，你今年多少岁？”");
  appendConversationMessage(quotedNpcQuestion, "assistant", 2, "今年13岁。");
  const quotedOwner = scanConversation(engine, quotedNpcQuestion, 4);
  assert(hasAge(quotedOwner.result, 2), "an Owner can hear an NPC's verified direct-speech question to another NPC");

  const ownerMissesQuestion = makeConversationFixture(engine, "age-owner-misses-question", { presentIds: [1, 2, 4] });
  appendConversationMessage(ownerMissesQuestion, "user", 1, "乙，你今年多少岁？");
  engine.observeParticipants(ownerMissesQuestion, [3], ownerMissesQuestion.nextId);
  appendConversationMessage(ownerMissesQuestion, "assistant", 2, "今年13岁。");
  assert.equal(hasAge(scanConversation(engine, ownerMissesQuestion, 3).result), false,
    "an Owner who joins after the question cannot infer the missing half of the exchange");

  const ownerMissesAnswer = makeConversationFixture(engine, "age-owner-misses-answer");
  appendConversationMessage(ownerMissesAnswer, "user", 1, "乙，你今年多少岁？");
  const hiddenAnswerId = ownerMissesAnswer.nextId;
  ownerMissesAnswer.memoryState.participantPresence.find(window => window.characterId === 3).leftAtMessageId = hiddenAnswerId;
  appendConversationMessage(ownerMissesAnswer, "assistant", 2, "今年13岁。");
  assert.equal(hasAge(scanConversation(engine, ownerMissesAnswer, 3).result), false,
    "an Owner who leaves before the answer cannot learn the age");

  const responderMissesQuestion = makeConversationFixture(engine, "age-responder-misses-question", { presentIds: [1, 3, 4] });
  appendConversationMessage(responderMissesQuestion, "user", 1, "乙，你今年多少岁？");
  const responderJoinId = responderMissesQuestion.nextId;
  engine.observeParticipants(responderMissesQuestion, [2], responderJoinId);
  appendConversationMessage(responderMissesQuestion, "assistant", 2, "今年13岁。");
  assert.equal(hasAge(scanConversation(engine, responderMissesQuestion, 3).result), false,
    "a responder who was absent for the question cannot answer an unseen prompt");

  const interrupted = makeConversationFixture(engine, "age-interruption");
  appendConversationMessage(interrupted, "user", 1, "乙，你今年多少岁？");
  appendConversationMessage(interrupted, "assistant", 4, "等等，我有话要说。");
  appendConversationMessage(interrupted, "assistant", 2, "今年13岁。");
  assert.equal(hasAge(scanConversation(engine, interrupted, 3).result), false,
    "an intervening spoken message breaks question-to-answer binding");

  const wrongSpeaker = makeConversationFixture(engine, "age-wrong-speaker");
  appendConversationMessage(wrongSpeaker, "user", 1, "乙，你今年多少岁？");
  appendConversationMessage(wrongSpeaker, "assistant", 3, "今年10岁。");
  assert.equal(hasAge(scanConversation(engine, wrongSpeaker, 4).result), false,
    "a different speaker cannot answer a question addressed to the named responder");

  const wrongAge = makeConversationFixture(engine, "age-wrong-backend-age", {
    characters: makeCharacters({ npcAge: 14 }) });
  appendConversationMessage(wrongAge, "user", 1, "乙，你今年多少岁？");
  appendConversationMessage(wrongAge, "assistant", 2, "今年13岁。");
  assert.equal(hasAge(scanConversation(engine, wrongAge, 3).result, 2), false,
    "a bare answer that disagrees with the responder's current CK3 age is rejected");

  const playerWrongSpeaker = makeConversationFixture(engine, "age-player-wrong-speaker");
  appendConversationMessage(playerWrongSpeaker, "assistant", 3, "甲，你今年多少岁？");
  appendConversationMessage(playerWrongSpeaker, "assistant", 2, "今年13岁。");
  assert.equal(hasAge(scanConversation(engine, playerWrongSpeaker, 4).result, 1), false,
    "an NPC answer cannot be rebound as the player's answer to an NPC question");

  const playerWrongAge = makeConversationFixture(engine, "age-player-wrong-backend-age", {
    characters: makeCharacters() });
  playerWrongAge.gameData.characters.get(1).age = 17;
  appendConversationMessage(playerWrongAge, "assistant", 3, "甲，你今年多少岁？");
  appendConversationMessage(playerWrongAge, "user", 1, "今年16岁。");
  assert.equal(hasAge(scanConversation(engine, playerWrongAge, 4).result, 1), false,
    "a player's bare answer that disagrees with current CK3 age is rejected");

  const thirdPersonAttribution = makeConversationFixture(engine, "age-third-person-attribution");
  appendConversationMessage(thirdPersonAttribution, "assistant", 4, "甲问道：“乙，你今年多少岁？”");
  appendConversationMessage(thirdPersonAttribution, "assistant", 2, "今年13岁。");
  assert.equal(hasAge(scanConversation(engine, thirdPersonAttribution, 3).result), false,
    "a quote attributed to a different speaker is not treated as a question this speaker asked");

  for (const [id, text] of [["age-no-target", "你今年多少岁？"], ["age-multiple-targets", "乙和丙，你们今年多少岁？"]]) {
    const ambiguous = makeConversationFixture(engine, id);
    appendConversationMessage(ambiguous, "user", 1, text);
    appendConversationMessage(ambiguous, "assistant", 2, "今年13岁。");
    assert.equal(hasAge(scanConversation(engine, ambiguous, 3).result), false,
      "a multi-person question without one unique target fails closed");
  }

  const duplicateAliases = makeCharacters();
  for (const key of ["name", "firstName", "shortName", "fullName"]) duplicateAliases.get(3)[key] = "乙";
  const duplicateName = makeConversationFixture(engine, "age-ambiguous-name", { characters: duplicateAliases });
  appendConversationMessage(duplicateName, "user", 1, "乙，你今年多少岁？");
  appendConversationMessage(duplicateName, "assistant", 2, "今年13岁。");
  assert.equal(hasAge(scanConversation(engine, duplicateName, 4).result), false,
    "a name shared by two characters does not bind an age question");

  for (const [text, factType, value] of [
    ["我将成为皇帝。", "TITLE", "皇帝"],
    ["我会成为皇帝。", "TITLE", "皇帝"],
    ["我以后会是皇帝。", "TITLE", "皇帝"],
    ["我将是皇帝。", "TITLE", "皇帝"],
    ["我将为皇帝。", "TITLE", "皇帝"],
    ["我明天是皇帝。", "TITLE", "皇帝"],
    ["我明日就是皇帝。", "TITLE", "皇帝"],
    ["我下个月是皇帝。", "TITLE", "皇帝"],
    ["我来年是皇帝。", "TITLE", "皇帝"],
    ["我以后是皇帝。", "TITLE", "皇帝"],
    ["我之后就是皇帝。", "TITLE", "皇帝"],
    ["我届时是皇帝。", "TITLE", "皇帝"],
    ["乙将成为皇帝。", "TITLE", "皇帝"],
    ["乙将是皇帝。", "TITLE", "皇帝"],
    ["赵光义将是皇帝。", "TITLE", "皇帝"],
    ["赵光义明天就是皇帝。", "TITLE", "皇帝"],
    ["我以后会变得勇敢。", "TRAIT", "勇敢"],
    ["我明天就是一个勤勉的人。", "TRAIT", "勤勉"],
    ["我将成为一个勇敢的人。", "TRAIT", "勇敢"]
  ]) {
    const characters = makeCharacters();
    if (value === "勤勉") characters.get(2).traits.push({ traitId: "diligent", name: "勤勉", localizedName: "勤勉",
      category: "Personality Trait" });
    const future = makeConversationFixture(engine, `future-${Buffer.from(text).toString("hex").slice(0, 12)}`, { characters });
    const speakerId = text.startsWith("我") ? 2 : 1;
    appendConversationMessage(future, speakerId === 1 ? "user" : "assistant", speakerId, text);
    const result = scanConversation(engine, future, 1).result;
    assert.equal(result.disclosures.some(row => row.entityId === 2 && row.factType === factType && row.value === value), false,
      `future language cannot disclose a matching backend ${factType}: ${text}`);
  }

  for (const [text, factType, value] of [
    ["我现在是皇帝。", "TITLE", "皇帝"], ["我目前是皇帝。", "TITLE", "皇帝"],
    ["我如今是皇帝。", "TITLE", "皇帝"], ["我确实是皇帝。", "TITLE", "皇帝"],
    ["我就是皇帝。", "TITLE", "皇帝"], ["我已经成为皇帝了。", "TITLE", "皇帝"],
    ["我已经是皇帝了。", "TITLE", "皇帝"], ["我现在担任宰相。", "TITLE", "宰相"],
    ["我很勇敢。", "TRAIT", "勇敢"], ["我是勇敢的。", "TRAIT", "勇敢"],
    ["我的特质是勇敢。", "TRAIT", "勇敢"], ["我现在很勤勉。", "TRAIT", "勤勉"]
  ]) {
    const characters = makeCharacters();
    if (value === "宰相") characters.get(2).heldCourtAndCouncilPositions = "宰相";
    if (value === "勤勉") characters.get(2).traits.push({ traitId: "diligent", name: "勤勉", localizedName: "勤勉",
      category: "Personality Trait" });
    const current = makeConversationFixture(engine, `current-${factType}`, { characters });
    appendConversationMessage(current, "assistant", 2, text);
    assert(scanConversation(engine, current, 1).result.disclosures
      .some(row => row.entityId === 2 && row.factType === factType && row.value === value),
    `an explicit current ${factType} assertion remains admissible: ${text}`);
  }

  console.log("V8.15.2 age claims independent QA: PASS (two/four-person Conversation persistence, restart/UI/Provider projection, hearing and target boundaries, Future TITLE/TRAIT guard)");
}

main().catch(error => { console.error(error.stack || error.message || error); process.exitCode = 1; })
  .finally(() => {
    const target = path.resolve(temporary);
    if (target.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(target, { recursive: true, force: true });
  });
