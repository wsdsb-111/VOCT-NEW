"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getSupernaturalPerception, captureRecognitionEvidence, activateSocialRecognition } = require("../src/app/main/prompts/social-recognition-policy");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { buildCharacterDisclosureContext, formatKnownCharacterFacts, formatSelfConcealment } = require("../src/app/main/conversation/character-disclosure-context");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { createTemplateEngine } = require("../src/app/main/prompts/template-engine");
const { PromptScriptLoader } = require("../src/app/main/prompts/prompt-script-loader");
const { PromptScriptSandbox } = require("../src/app/main/prompts/prompt-script-sandbox");
const { TokenCounter } = require("../src/app/main/provider-service");

const promptsDir = path.resolve(__dirname, "../src/app/default_userdata/prompts");
const TemplateEngine = createTemplateEngine({ Handlebars: require("../resources/app/node_modules/handlebars").create(),
  fs, path, defaultPromptsDir: promptsDir, promptsHelpersDir: path.join(promptsDir, "helpers"), PromptScriptSandbox });
const provider = { providerType: "openai-compatible", defaultModel: "fixture", customContextLength: 32768, customMaxOutputTokens: 512 };
const PromptBuilder = createPromptBuilder({ TemplateEngine, PromptScriptLoader, path, TokenCounter,
  createPromptFingerprint: text => require("node:crypto").createHash("sha256").update(String(text || "")).digest("hex"),
  promptConfigManager: { resolvePath: value => value, getDefaultMainTemplateContent: () => "{{character.shortName}}" },
  settingsRepository: { getChatPromptV813Layout: () => true,
    getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: true }), getActiveProviderConfig: () => provider,
    getPromptSettings: () => ({ mainTemplate: "{{character.shortName}}", blocks: [
      { id: "main", type: "main", enabled: true },
      { id: "description", type: "description", enabled: true, scriptPath: path.join(promptsDir, "character_description/standard/pListMccTest2.js") },
      { id: "history", type: "history", enabled: true }
    ], suffix: { enabled: false } }) }, defaultChatInstruction: "Respond" });

const character = (id, ids) => ({ id, name: `人物${id}`, shortName: `人物${id}`, fullName: `人物${id}`, primaryTitle: `秘密头衔${id}`,
  traits: ids.map(traitId => ({ traitId, name: traitId, desc: `ONLY_${traitId}_DESCRIPTION` })), knownSecrets: [] });
const makeData = (observer, target) => ({ playerID: 1, aiID: 2, campaignToken: "perception-fixture", date: "1200.1.1", totalDays: 100,
  year: 1200, scene: "hall", location: "hall", getActiveParticipantRelationshipInfo: () => "", getMentionExclusionIds: () => new Set(),
  findMentionedCharacterIdsInHistory: () => new Set(), getMentionedCharactersInfo: () => "", getMentionableCharacterProfiles() { return this.characters; },
  characters: new Map([[1, character(1, observer)], [2, character(2, target)], [3, character(3, [])]]) });
const recognize = (observer, target, options = {}) => {
  const gameData = makeData(observer, target);
  return getSupernaturalPerception(gameData.characters.get(1), gameData.characters.get(2), gameData, { activeParticipantIds: [1, 2], ...options });
};
assert.equal(recognize(["vampire"], ["mummy"]).level, "SUPERNATURAL");
assert.deepEqual(recognize(["vampire"], ["mummy"]).traitKeys, [], "unlike species outside the rival group receive no canonical trait keys");
for (const observer of ["vampire", "werewolf", "supehunter"]) for (const target of ["vampire", "werewolf", "supehunter"]) {
  assert.deepEqual(recognize([observer], [target]).traitKeys, ["trait_" + target], `${observer} precisely recognizes ${target}`);
}
assert.deepEqual(recognize(["werewolf"], ["werewolf"]).traitKeys, ["trait_werewolf"]);
assert.deepEqual(recognize(["vampire"], ["vampire", "mage"]).traitKeys, ["trait_vampire"], "same species does not reveal every target identity");
for (const target of ["vampire", "werewolf"]) {
  assert.deepEqual(recognize(["supehunter"], [target]).traitKeys, ["trait_" + target]);
  assert.deepEqual(recognize([target], ["supehunter"]).traitKeys, ["trait_supehunter"]);
}
for (const other of ["mummy", "mage", "sorcerer", "theurgist", "psychic"]) {
  assert.equal(recognize(["supehunter"], [other]).level, "SUPERNATURAL", "hunter senses only generic presence of " + other);
  assert.equal(recognize([other], ["supehunter"]).level, "SUPERNATURAL", other + " senses a hunter without identifying the species");
  assert.deepEqual(recognize(["supehunter"], [other]).traitKeys, []);
}
assert.deepEqual(recognize(["supehunter"], ["myv_wyvern"]).traitKeys, ["trait_myv_wyvern"], "pure dragons override ordinary cross-species sensing");
assert.deepEqual(recognize(["myv_wyvern"], ["supehunter"]).traitKeys, ["trait_supehunter"], "pure dragons precisely identify other supernatural races");
for (const added of ["sorcerer", "theurgist", "psychic"]) {
  assert.equal(recognize([added], ["vampire"]).level, "SUPERNATURAL");
  assert.equal(recognize(["vampire"], [added]).level, "SUPERNATURAL");
  assert.deepEqual(recognize([added], [added]).traitKeys, ["trait_" + added]);
}
for (const mundane of [[], ["hunter"], ["witch"], ["brave", "greedy", "bastard"]]) {
  assert.equal(recognize(mundane, ["vampire"]).level, "NONE");
  assert.equal(recognize(["vampire"], mundane).level, "NONE");
}
assert.equal(recognize(["vampire"], ["mummy"], { activeParticipantIds: [1] }).level, "NONE");
assert.equal(recognize(["vampire"], ["mummy"], { activeParticipantIds: undefined }).level, "NONE");
assert.equal(recognize(["vampire"], ["mummy"], { hiddenTraitKeys: ["trait_mummy"] }).level, "NONE");
const letter = makeData(["vampire"], ["mummy"]);
letter.letterData = { content: "hello" };
assert.equal(getSupernaturalPerception(letter.characters.get(1), letter.characters.get(2), letter, { activeParticipantIds: [1, 2] }).level, "NONE");
const switched = makeData(["vampire"], ["werewolf"]);
captureRecognitionEvidence(switched, []);
activateSocialRecognition(switched, [1, 2]);
switched.playerID = 3;
assert.equal(getSupernaturalPerception(switched.characters.get(1), switched.characters.get(2), switched, { activeParticipantIds: [1, 2, 3] }).level, "NONE");

const root = fs.mkdtempSync(path.resolve(__dirname, "../.build/supernatural-perception-"));
try {
  const gameData = makeData(["vampire"], ["mummy", "brave", "witch"]);
  const conversation = { id: "perception-scene", conversationEpoch: 1, recognitionPlayerId: 1, isActive: true, gameData,
    selectedCharacterIds: new Set([2, 3]), presentCharacterIds: new Set([2]), departedCharacterIds: new Set(),
    temporarilyAbsentCharacterIds: new Map(), inactiveParticipantIds: new Map(), messages: [] };
  const service = new ConversationDisclosureStore({ dataDir: root, getCurrentConversation: () => conversation });
  const context = owner => ({ ...buildCharacterDisclosureContext({ service, gameData, responderId: owner, targetIds: [1, 2, 3], audienceIds: [1, 2] }), activeParticipantIds: [1, 2] });
  const facts = service.getDisclosureProfile({ ownerRuntimeId: 1, targetRuntimeId: 2 }).facts;
  assert(facts.some(fact => fact.factType === "PERCEPTION"));
  assert(!facts.some(fact => fact.factKey === "trait_mummy" && fact.effectiveKnown));
  const coarse = createTraitProfileView(gameData, gameData.characters.get(1), context(1)).gameData.characters.get(2);
  assert.deepEqual(coarse.traits, []);
  assert.equal(coarse.shortName, "未获知姓名的人物");
  assert.equal(coarse.primaryTitle, "");
  assert(coarse.supernaturalPerception.includes("非凡"));
  for (const text of [JSON.stringify(facts), JSON.stringify(coarse), formatKnownCharacterFacts(context(1), gameData, 1)]) {
    for (const hidden of ["mummy", "ONLY_mummy_DESCRIPTION", "brave", "witch"]) assert(!text.includes(hidden), "coarse perception leaks " + hidden);
  }
  const sent = PromptBuilder.buildMessagesWithTokenCount([{ role: "user", speakerCharacterId: 2, content: "你好。" }],
    gameData.characters.get(1), gameData, "", context(1), provider).messages.map(message => message.content).join("\n");
  assert(sent.includes("气息感知") && sent.includes("传说感知") && sent.includes("具体种族未辨明"), "actual outbound prompt gets the safe category observation");
  for (const hidden of ["mummy", "ONLY_mummy_DESCRIPTION", "brave", "witch"]) assert(!sent.includes(hidden), "outbound prompt leaks " + hidden);
  assert.equal(createTraitProfileView(gameData, gameData.characters.get(1)).gameData.characters.get(2).supernaturalPerception, undefined,
    "missing explicit presence cannot activate the all-character prompt fallback");
  const concealed = formatSelfConcealment(context(2), gameData, 2, [1, 2]);
  assert(concealed.includes("未获知你的身份=mummy") && concealed.includes("只能感到非凡气息"));
  assert.equal(fs.existsSync(service.filePath), false, "sensing does not write a global/persistent identity catalogue");
  for (const [own, identity, label] of [["psychic", "vampire", "血族感知"], ["psychic", "bastet", "兽族感知"],
    ["psychic", "mummy", "传说感知"], ["psychic", "demon", "地狱感知"], ["psychic", "spirit", "生灵感知"],
    ["psychic", "automaton", "超自然感知"], ["alien", "psychic", "猎人感知"]]) {
    const groupData = makeData([own], [identity]);
    const groupService = new ConversationDisclosureStore({ dataDir: root,
      getCurrentConversation: () => ({ ...conversation, gameData: groupData }) });
    const groupContext = { ...buildCharacterDisclosureContext({ service: groupService, gameData: groupData,
      responderId: 1, targetIds: [1, 2], audienceIds: [1, 2] }), activeParticipantIds: [1, 2] };
    const outgoing = PromptBuilder.buildMessagesWithTokenCount([{ role: "user", speakerCharacterId: 2, content: "你好。" }],
      groupData.characters.get(1), groupData, "", groupContext, provider).messages.map(message => message.content).join("\n");
    assert(outgoing.includes(label), "actual outbound prompt must carry " + label);
    assert(!outgoing.includes(identity) && !outgoing.includes(`ONLY_${identity}_DESCRIPTION`), "category leaks the real target identity");
    assert(!fs.existsSync(groupService.filePath), "category generation must remain temporary");
  }
  const preciseData = makeData(["fae"], ["changeling", "sidhe"]);
  Object.assign(preciseData.characters.get(2).traits[0], { name: "PRIVATE_DYNAMIC_BRANCH", localizedName: "PRIVATE_DYNAMIC_BRANCH",
    desc: "PRIVATE_BRANCH_DESCRIPTION", aliases: ["PRIVATE_BRANCH_ALIAS"] });
  const preciseService = new ConversationDisclosureStore({ dataDir: root,
    getCurrentConversation: () => ({ ...conversation, gameData: preciseData }) });
  const preciseContext = () => ({ ...buildCharacterDisclosureContext({ service: preciseService, gameData: preciseData,
    responderId: 1, targetIds: [1, 2], audienceIds: [1, 2] }), activeParticipantIds: [1, 2] });
  const safeSpecies = preciseService.getDisclosureProfile({ ownerRuntimeId: 1, targetRuntimeId: 2 }).facts;
  assert(safeSpecies.some(fact => fact.value === "换生灵" && fact.speciesOnly));
  const preciseView = () => createTraitProfileView(preciseData, preciseData.characters.get(1), preciseContext()).gameData.characters.get(2);
  assert.deepEqual(preciseView().traits, [{ traitId: "changeling", name: "换生灵", desc: "" }]);
  const preciseSent = PromptBuilder.buildMessagesWithTokenCount([{ role: "user", speakerCharacterId: 2, content: "你好。" }],
    preciseData.characters.get(1), preciseData, "", preciseContext(), provider).messages.map(message => message.content).join("\n");
  for (const value of [JSON.stringify(safeSpecies), JSON.stringify(preciseView()), preciseSent]) {
    for (const hidden of ["PRIVATE_DYNAMIC_BRANCH", "PRIVATE_BRANCH_DESCRIPTION", "PRIVATE_BRANCH_ALIAS", "sidhe"]) {
      assert(!value.includes(hidden), "precise species identification leaks a subtype through " + hidden);
    }
  }
  const manual = status => {
    const current = preciseService.getTargetView({ ownerRuntimeId: 1, targetRuntimeId: 2 });
    const fact = current.facts.find(fact => fact.factKey === "trait_changeling");
    preciseService.setManualStatus({ ...current.scope, factType: "TRAIT", factKey: fact.factKey,
      factSourceSnapshotId: fact.factSourceSnapshotId, expectedRevision: fact.revision, status });
  };
  manual("MANUAL_KNOWN");
  assert.equal(preciseView().traits[0].name, "PRIVATE_DYNAMIC_BRANCH", "an explicit manual grant retains the full trait value");
  manual("MANUAL_HIDDEN");
  assert.deepEqual(preciseView().traits, []);
  assert.equal(preciseView().supernaturalPerception, undefined, "hidden main identity cannot leak through its private subtype");
  conversation.temporarilyAbsentCharacterIds.set(2, "away");
  assert(!service.getDisclosureProfile({ ownerRuntimeId: 1, targetRuntimeId: 2 }).facts.some(fact => fact.factType === "PERCEPTION"));
  conversation.temporarilyAbsentCharacterIds.clear();
  gameData.characters.set(2, character(2, ["vampire", "mummy"]));
  const exact = createTraitProfileView(gameData, gameData.characters.get(1), context(1)).gameData.characters.get(2);
  assert.deepEqual(exact.traits.map(trait => trait.traitId), ["vampire"]);
  assert.equal(exact.supernaturalPerception, undefined);
  const view = service.getTargetView({ ownerRuntimeId: 1, targetRuntimeId: 2 });
  const trait = view.facts.find(fact => fact.factKey === "trait_vampire");
  service.setManualStatus({ ...view.scope, factType: "TRAIT", factKey: trait.factKey,
    factSourceSnapshotId: trait.factSourceSnapshotId, expectedRevision: trait.revision, status: "MANUAL_HIDDEN" });
  assert(!createTraitProfileView(gameData, gameData.characters.get(1), context(1)).gameData.characters.get(2).traits.length, "manual hidden wins over same-species recognition");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log("PASS supernatural perception: generic/exact separation, hunter exceptions, human powers, presence, redaction and manual priority");
