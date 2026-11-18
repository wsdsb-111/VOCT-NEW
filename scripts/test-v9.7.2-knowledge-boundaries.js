"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { createTemplateEngine } = require("../src/app/main/prompts/template-engine");
const { PromptScriptLoader } = require("../src/app/main/prompts/prompt-script-loader");
const { PromptScriptSandbox } = require("../src/app/main/prompts/prompt-script-sandbox");
const { TokenCounter } = require("../src/app/main/provider-service");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");
const { extractCharacterDisclosures } = require("../src/app/main/conversation/character-disclosure-extraction");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { buildCharacterDisclosureContext } = require("../src/app/main/conversation/character-disclosure-context");
// Deliberate label collision between different canonical species: automatic
// same-species recognition must not turn this redaction fixture into known data.
const owner = { id: 2, shortName: "阿乙", firstName: "阿乙", fullName: "阿乙", traits: [{ traitId: "mummy", name: "吸血鬼", localizedName: "vampire" }],
  faith: "自身信仰", culture: "自身文化", modifiers: [{ name: "自身修正" }],
  parents: [], children: [], siblings: [], knownSecrets: [], opinionBreakdowns: [
    { id: 1, breakdown: [{ reason: "吸血鬼：-10", value: -10 }, { reason: "勇敢：+10", value: 10 }, { reason: "馈赠礼物", value: 5 }] }
  ] };
const target = { id: 1, shortName: "阿甲", firstName: "阿甲", fullName: "阿甲", primaryTitle: "测试公爵",
  isRuler: true, isLandedRuler: true, isIndependentRuler: true, isKnight: false,
  faith: "布鲁赫氏族", culture: "隐秘文化", titles: ["数组独有头衔"], titleCandidates: [{ name: "数组官职" }],
  traits: [{ traitId: "vampire", name: "吸血鬼" }, { traitId: "brave", name: "勇敢" }], parents: [], children: [], siblings: [],
  modifiers: [{ name: "吸血鬼的力量", description: "勇敢的测试公爵" }] };
const waiting = { id: 3, shortName: "阿丙", traits: [], parents: [], children: [], siblings: [], knownSecrets: [] };
const gameData = { playerID: 1, aiID: 2, campaignToken: "knowledge-regression", date: "1246.10.20", totalDays: 455000,
  characters: new Map([[1, target], [2, owner], [3, waiting]]) };
const promptsDir = path.resolve(__dirname, "../src/app/default_userdata/prompts");
const TemplateEngine = createTemplateEngine({ Handlebars: require("../resources/app/node_modules/handlebars").create(),
  fs, path, defaultPromptsDir: promptsDir, promptsHelpersDir: path.join(promptsDir, "helpers"), PromptScriptSandbox });
const provider = { providerType: "openai-compatible", defaultModel: "fixture", customContextLength: 32768, customMaxOutputTokens: 512 };
const mainTemplate = "{{character.shortName}}";
const PromptBuilder = createPromptBuilder({ TemplateEngine, PromptScriptLoader, path, TokenCounter,
  createPromptFingerprint: text => crypto.createHash("sha256").update(String(text || "")).digest("hex"),
  promptConfigManager: { resolvePath: value => value, getDefaultMainTemplateContent: () => mainTemplate },
  settingsRepository: {
    getChatPromptV813Layout: () => true,
    getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: true, chatPromptV810ProviderAdapter: true }),
    getActiveProviderConfig: () => provider,
    getPromptSettings: () => ({ mainTemplate, blocks: [
      { id: "main", type: "main", enabled: true },
      { id: "description", type: "description", enabled: true, scriptPath: path.join(promptsDir, "character_description/standard/pListMccTest2.js") },
      { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, template: "Respond" }
    ], suffix: { enabled: false } })
  }, defaultChatInstruction: "Respond" });
Object.assign(gameData, { year: 1246, scene: "hall", location: "hall", getActiveParticipantRelationshipInfo: () => "",
  getMentionExclusionIds: () => new Set(), findMentionedCharacterIdsInHistory: () => new Set(), getMentionedCharactersInfo: () => "",
  getMentionableCharacterProfiles() { return this.characters; } });
const outbound = context => PromptBuilder.buildMessagesWithTokenCount([{ role: "user", name: target.fullName,
  speakerCharacterId: 1, content: "你好。" }], owner, gameData, "", context, provider).messages.map(message => message.content).join("\n");
const temp = fs.mkdtempSync(path.resolve(__dirname, "../.build/knowledge-boundaries-"));
try {
  const conversation = { id: "knowledge-scene", conversationEpoch: 1, isActive: true, gameData,
    selectedCharacterIds: new Set([2, 3]), presentCharacterIds: new Set([2]), messages: [],
    departedCharacterIds: new Set(), inactiveParticipantIds: new Map() };
  const service = new ConversationDisclosureStore({ dataDir: temp, getCurrentConversation: () => conversation });
  const context = () => ({ ...buildCharacterDisclosureContext({ service, gameData, responderId: 2, targetIds: [1, 3] }), activeParticipantIds: [1, 2] });
  const view = () => createTraitProfileView(gameData, owner, context());
  const first = view();
  const reasons = first.character.opinionBreakdowns[0].breakdown.map(item => item.reason).join("|");
  assert(!reasons.includes("吸血鬼") && !reasons.includes("勇敢"), "opinion explanations cannot reveal undisclosed target traits");
  assert(reasons.includes("馈赠礼物"), "unrelated opinion reasons remain available");
  assert.equal(first.character.traits[0].name, "吸血鬼", "redacting the target does not erase the responder's own same-named trait");
  for (const key of ["faith", "culture", "modifiers"]) {
    assert.equal(first.gameData.characters.get(1)[key], undefined, "an unrelated target's " + key + " cannot indirectly reveal identity");
    assert.deepEqual(first.character[key], owner[key], "the responder retains their own " + key);
  }
  assert.deepEqual(first.gameData.characters.get(1).titles, [], "array-only titles require disclosure");
  assert.deepEqual(first.gameData.characters.get(1).titleCandidates, [], "array-only offices require disclosure");
  assert.equal(target.modifiers[0].name, "吸血鬼的力量", "source game data stays intact");
  const initialPrompt = outbound(context());
  assert(!initialPrompt.includes("吸血鬼：-10") && !initialPrompt.includes("勇敢：+10"),
    "the real default description script cannot leak opinion reasons into the outbound messages");
  assert(!initialPrompt.includes("Independent ruler of"), "unknown political identity cannot bypass title filtering through role flags");
  gameData.nestedProfile = { id: 2, traits: [] };
  assert(!view().character.opinionBreakdowns[0].breakdown.some(row => row.reason.includes("吸血鬼")),
    "another nested copy of the responder ID cannot bypass metadata redaction");
  delete gameData.nestedProfile;

  const source = { conversationId: conversation.id, messageId: 0, messageRevision: "a".repeat(64), gameDate: gameData.date, campaignToken: gameData.campaignToken };
  const pronounData = { ...gameData, characters: new Map([[1, target], [2, { ...owner, gender: "male" }], [3, { ...waiting, gender: "male" }]]) };
  const mention = (text, audienceIds = [1, 2, 3], data = pronounData) => extractCharacterDisclosures({
    gameData: data, speakerId: 1, text, audienceIds, candidateTargetIds: [1, 2, 3], source }).disclosures;
  assert.deepEqual(mention("我勇敢。").map(row => row.ownerRuntimeId), [2, 3], "a bare affirmative personal trait reaches all present listeners");
  assert(mention("我是吸血鬼，我很勇敢。").some(row => row.factKey === "trait_brave"));
  assert(mention("我是吸血鬼，你能帮我吗？").some(row => row.factKey === "trait_vampire"), "a later question does not erase a preceding affirmative disclosure");
  assert(mention("你是吸血鬼。", [1, 2]).every(row => row.targetRuntimeId === 2));
  assert(mention("你是吸血鬼。", [1, 2]).some(row => row.ownerRuntimeId === 1), "second person resolves in a two-person conversation");
  assert.equal(mention("你是吸血鬼。").length, 0, "ambiguous second person is not assigned by matching a hidden trait");
  assert.equal(mention("他是吸血鬼。").length, 0, "two possible male referents remain ambiguous");
  const namedThird = mention("阿乙，他是吸血鬼。");
  assert.deepEqual(namedThird.map(row => [row.ownerRuntimeId, row.targetRuntimeId]), [[1, 2], [3, 2]], "a named third person is disclosed to every present listener without prior knowledge");
  assert(mention("他是吸血鬼。", [1, 2]).some(row => row.targetRuntimeId === 2), "a unique third-person referent is supported");
  assert(mention("我说：“我是吸血鬼。”").some(row => row.targetRuntimeId === 1), "first-person speech attribution remains spoken disclosure");
  assert.deepEqual(mention("我对阿乙说：“你是吸血鬼。”").map(row => [row.ownerRuntimeId, row.targetRuntimeId]), [[1, 2], [3, 2]],
    "an explicit addressee resolves second person while the trait reaches all present listeners");
  const competingNames = { ...pronounData, characters: new Map(pronounData.characters) };
  competingNames.characters.set(3, { ...waiting, gender: "male", traits: [{ traitId: "vampire", name: "吸血鬼" }] });
  assert.deepEqual(mention("我对阿丙说：“阿乙来了，你是吸血鬼。”", [1, 2, 3], competingNames)
    .map(row => [row.ownerRuntimeId, row.targetRuntimeId]), [[1, 3], [2, 3]], "the explicit addressee outranks a preceding third-person name");
  assert.deepEqual(mention("我对阿丙说，你是吸血鬼。", [1, 2, 3], competingNames)
    .map(row => [row.ownerRuntimeId, row.targetRuntimeId]), [[1, 3], [2, 3]], "plain directed speech retains its addressee");
  assert(mention("you are vampire.", [1, 2]).some(row => row.targetRuntimeId === 2), "English pronouns and canonical trait aliases remain supported");
  for (const text of ["你不是吸血鬼。", "他是吸血鬼吗？", "我的父亲是吸血鬼。", "我们是吸血鬼。", "我和你都是吸血鬼。", "我是木乃伊。"])
    assert.equal(mention(text, [1, 2]).length, 0, "negative, ambiguous, relational or nonexistent traits are not disclosed: " + text);
  for (const text of ["我告诉你，我是吸血鬼。", "告诉你吧，我是吸血鬼。"]) {
    const rows = extractCharacterDisclosures({ gameData, speakerId: 1, text, audienceIds: [1, 2], candidateTargetIds: [1, 2], source }).disclosures;
    assert(rows.some(row => row.factKey === "trait_vampire"), "direct self disclosure with a spoken introduction is captured: " + text);
  }
  for (const text of ["他告诉你，我是吸血鬼。", "我告诉你，我不是吸血鬼。", "如果我告诉你我是吸血鬼。", "我心想，我是吸血鬼。",
    "我告诉你，我是吸血鬼，不过这是假的。", "告诉你吧，我是吸血鬼，这是谎言。", "我告诉你，我是吸血鬼，只是故事。", "我告诉你，我是吸血鬼，这是编出来的。"]) {
    assert.equal(extractCharacterDisclosures({ gameData, speakerId: 1, text, audienceIds: [1, 2], candidateTargetIds: [1, 2], source }).disclosures.length, 0, text);
  }

  const { formatKnownCharacterFacts } = require("../src/app/main/conversation/character-disclosure-context");
  const manualView = service.getTargetView({ ownerRuntimeId: 2, targetRuntimeId: 1 });
  const brave = manualView.facts.find(fact => fact.factKey === "trait_brave");
  service.setManualStatus({ ...manualView.scope, factType: "TRAIT", factKey: brave.factKey, factSourceSnapshotId: brave.factSourceSnapshotId,
    expectedRevision: brave.revision, status: "MANUAL_KNOWN" });
  assert(formatKnownCharacterFacts(context(), gameData, 2).includes("勇敢"), "manual knowledge is explicitly presented to the responder");
  assert(outbound(context()).includes("特质／身份：勇敢"), "manual knowledge reaches the actual outbound messages");
  conversation.messages.push({ id: 0, role: "user", speakerCharacterId: 1, name: "阿甲", content: "我告诉你，我是吸血鬼。" });
  const sourceContext = () => ({ conversationId: conversation.id, campaignToken: gameData.campaignToken, date: gameData.date,
    participants: [target, owner, waiting].map(person => ({ id: person.id, name: person.shortName })), messages: conversation.messages,
    participantPresence: [{ characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null }, { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: null }] });
  assert(service.recordConversation({ conversation, context: sourceContext() }).recorded > 0);
  const known = formatKnownCharacterFacts(context(), gameData, 2);
  assert(known.includes("吸血鬼") && known.includes("勇敢"), "spoken and manual knowledge both reach the current context");
  assert(outbound(context()).includes("特质／身份：吸血鬼"), "spoken disclosure reaches the actual outbound messages");
  assert.equal(formatKnownCharacterFacts(context(), gameData, 3), "", "another responder cannot reuse the context");
  const waitingContext = buildCharacterDisclosureContext({ service, gameData, responderId: 3, targetIds: [1] });
  assert.equal(formatKnownCharacterFacts(waitingContext, gameData, 3), "", "the waiting character does not hear the disclosure");
  assert(view().character.opinionBreakdowns[0].breakdown.some(row => row.reason.includes("吸血鬼")), "known target traits may appear in derived explanations");
  const changed = service.getTargetView({ ownerRuntimeId: 2, targetRuntimeId: 1 });
  const fact = changed.facts.find(row => row.factKey === "trait_brave");
  service.setManualStatus({ ...changed.scope, factType: "TRAIT", factKey: fact.factKey, factSourceSnapshotId: fact.factSourceSnapshotId,
    expectedRevision: fact.revision, status: "MANUAL_HIDDEN" });
  assert(!formatKnownCharacterFacts(context(), gameData, 2).includes("勇敢"), "manual hidden takes priority");
  conversation.messages[0].content = "今天天气很好。";
  service.recordConversation({ conversation, context: sourceContext() });
  assert(!formatKnownCharacterFacts(context(), gameData, 2).includes("吸血鬼"), "editing the source revokes automatic knowledge");
  conversation.presentCharacterIds.add(3);
  conversation.messages.push({ id: 2, role: "user", speakerCharacterId: 1, name: "阿甲", content: "我是吸血鬼。" });
  const joinedContext = { ...sourceContext(), participantPresence: [...sourceContext().participantPresence,
    { characterId: 3, joinedAtMessageId: 2, leftAtMessageId: null }] };
  service.recordConversation({ conversation, context: joinedContext });
  assert(service.getTargetView({ ownerRuntimeId: 3, targetRuntimeId: 1 }).facts.some(row => row.factKey === "trait_vampire" && row.effectiveKnown),
    "a newly present listener learns the new disclosure with their own persisted audience proof");
  conversation.messages = [{ id: 3, role: "assistant", speakerCharacterId: 2, name: "阿乙", content: "阿甲是吸血鬼。" }];
  const independent = new ConversationDisclosureStore({ dataDir: path.join(temp, "independent"), getCurrentConversation: () => conversation });
  assert(!independent.getDisclosureProfile({ ownerRuntimeId: 2, targetRuntimeId: 1 }).facts.some(row => row.factKey === "trait_vampire" && row.effectiveKnown));
  independent.recordConversation({ conversation, context: { ...joinedContext, messages: conversation.messages } });
  for (const listener of [2, 3]) assert(independent.getDisclosureProfile({ ownerRuntimeId: listener, targetRuntimeId: 1 }).facts.some(row => row.factKey === "trait_vampire" && row.effectiveKnown),
    "a third-person trait assertion is independently persisted for its speaker and every other present listener");
  console.log("Knowledge boundaries: derived metadata, self traits, spoken/manual updates, audience ACL and revocation PASS; CK3/Provider NOT_RUN");
} finally {
  assert(path.dirname(temp) === path.resolve(__dirname, "../.build"));
  fs.rmSync(temp, { recursive: true, force: true });
}
