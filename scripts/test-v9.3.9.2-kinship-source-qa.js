"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = {
  id: versionPath,
  filename: versionPath,
  loaded: true,
  exports: { MEMORY_ENGINE_VERSION: "3.0" }
};

const { Character } = require("../src/app/main/game-data/character");
const { createGameData } = require("../src/app/main/game-data/game-data");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { buildFamilyFactBlock } = require("../src/app/main/worldline/character-family-facts");

const TokenCounter = {
  estimateTokens: value => Math.ceil(String(value ?? "").length / 4),
  estimateMessageTokens: message => Math.ceil(String(message?.content ?? "").length / 4),
  calculateTotalTokens: messages => (messages || []).reduce((total, message) => total + Math.ceil(String(message?.content ?? "").length / 4), 0)
};

const GameData = createGameData({ fs, path, memorySystem: {}, summariesDir: "", getHistoricalReferenceByYear: () => null });
const settingsRepository = {
  getPromptSettings: () => ({
    mainTemplate: "V9.3.9.2 kinship source QA",
    blocks: [{ id: "main", type: "main", enabled: true, role: "system" }, { id: "history", type: "history", enabled: true }],
    suffix: { enabled: false }
  }),
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: false }),
  getChatPromptV813Layout: () => true
};
const PromptBuilder = createPromptBuilder({
  TemplateEngine: class { renderTemplateString(template) { return String(template ?? ""); } },
  PromptScriptLoader: class {},
  promptConfigManager: { getDefaultMainTemplateContent: () => "", resolvePath: value => value },
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: value => String(value ?? ""),
  defaultChatInstruction: ""
});

const CAMPAIGN = "v9392-kinship-source-campaign";
const DATE = "1190年5月2日";
const TOTAL_DAYS = 106575;
const SNAPSHOT = DATE + "/" + TOTAL_DAYS;

function makeCharacter(id, name, age, gender = "male", extra = {}) {
  const row = Array(28).fill("");
  row[0] = String(id);
  row[1] = name;
  row[2] = name;
  row[4] = gender === "female" ? "she" : "he";
  row[5] = age == null ? "" : String(age);
  const character = new Character(row);
  character.ageSource = age == null ? null : "CK3_CURRENT_AGE";
  character.alive = true;
  Object.assign(character, extra);
  return character;
}

function makeGameData(characters, { playerId = 1, responderId = 2 } = {}) {
  const player = characters.find(character => Number(character.id) === playerId);
  const responder = characters.find(character => Number(character.id) === responderId);
  const gameData = new GameData([
    playerId, player?.fullName || "玩家", responderId, responder?.fullName || "回应者",
    DATE, "___________talk_scene", "", "", TOTAL_DAYS
  ]);
  gameData.date = DATE;
  gameData.totalDays = TOTAL_DAYS;
  gameData.campaignToken = CAMPAIGN;
  gameData.relationFingerprint = "v9392-kinship-source-revision";
  gameData.characters = new Map(characters.map(character => [Number(character.id), character]));
  return gameData;
}

function redactCurrentDemographics(gameData) {
  const characters = [...gameData.characters.values()].map(character => {
    const projected = Object.assign(Object.create(Object.getPrototypeOf(character)), character);
    projected.age = null;
    projected.ageSource = null;
    projected.birthDate = null;
    projected.birth = null;
    projected.birthDateTotalDays = null;
    projected.birthTotalDays = null;
    return projected;
  });
  return makeGameData(characters);
}

function addPublicParent(child, parent) {
  child.parents.push({
    id: parent.id,
    name: parent.fullName,
    gender: parent.gender,
    source: "CK3_DIRECT_PARENT",
    sourceOwnerId: child.id,
    childId: child.id,
    relationType: "parent",
    sourceRelation: "parents",
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT,
    evidenceConflict: false
  });
}

function addSiblingLinks(characters) {
  for (const subject of characters) {
    for (const target of characters) {
      if (subject.id !== target.id) subject.siblings.push({ id: target.id, name: target.fullName, gender: target.gender });
    }
  }
}

function buildPrompt(characters, { activeParticipantIds = characters.map(character => Number(character.id)) } = {}) {
  const gameData = makeGameData(characters);
  const responder = gameData.characters.get(2);
  const result = PromptBuilder.buildMessagesWithTokenCount([{ role: "user", content: "请按当前关系回应。" }], responder,
    gameData, "", { activeParticipantIds, subjectiveWorldPolicyActive: true,
      cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() } });
  const block = id => result.blocks.find(entry => entry.block?.id === id)?.content || "";
  return { result, relationship: block("live-relationships") || block("active-participant-relationship") };
}

function makeOffSceneSiblingCase({ ageConflict = false, lifeConflict = false } = {}) {
  const player = makeCharacter(1, "玩家甲", 30);
  const responder = makeCharacter(2, "回应者乙", 11, "male", { birthDateTotalDays: 10000 });
  const candidateA = makeCharacter(3, "候选甲", 9, "male", {
    birthDateTotalDays: 9000,
    ...(lifeConflict ? { alive: true, deathDateTotalDays: 50000 } : {})
  });
  const candidateB = makeCharacter(4, "候选乙", 13, "male", { birthDateTotalDays: 12000 });
  const parent = makeCharacter(5, "共同父亲丙", 40);
  for (const child of [responder, candidateA, candidateB]) addPublicParent(child, parent);
  addSiblingLinks([responder, candidateA, candidateB]);
  if (ageConflict) {
    const record = responder.siblings.find(item => Number(item.id) === candidateA.id);
    record.age = 12;
    record.ageSource = "CK3_LIVE_RELATIVE_AGE";
    record.evidence = { age: [{
      value: 12,
      ageSource: "CK3_LIVE_RELATIVE_AGE",
      sourceOwnerId: responder.id,
      relationType: "sibling",
      source: responder.id + ".siblings",
      campaignToken: CAMPAIGN,
      sourceSnapshotId: SNAPSHOT
    }] };
  }
  const authority = makeGameData([player, responder, candidateA, candidateB, parent]);
  const projected = redactCurrentDemographics(authority);
  const facts = buildFamilyFactBlock(projected.characters.get(responder.id), projected, {
    query: "你哥哥是谁？",
    ageAuthorityGameData: authority
  });
  return { facts, authority, projected, responder, candidateA, candidateB };
}

function testCurrentAgeOutranksContradictoryBirthOrdinalInFamilyFacts() {
  const { facts, candidateA, candidateB } = makeOffSceneSiblingCase();
  assert.match(facts, /查询关系：哥哥；目标人物：候选乙/u,
    "the older current CK3 age selects the target even when canonical birth ordinals point the other way");
  assert.doesNotMatch(facts, /目标人物：候选甲/u,
    "a birth ordinal cannot overrule a different trusted current age");
}

function testAgeConflictCannotBeBypassedByBirthOrdinal() {
  const { facts } = makeOffSceneSiblingCase({ ageConflict: true });
  assert.match(facts, /当前无法可靠确定具体关系主体或目标 Runtime ID/u,
    "conflicting current-age evidence stays unresolved even when one canonical birth ordinal looks decisive");
  assert.doesNotMatch(facts, /目标人物：候选[甲乙]/u);
}

function testLifeStatusConflictCannotBeBypassedByBirthOrdinal() {
  const { facts } = makeOffSceneSiblingCase({ lifeConflict: true });
  assert.match(facts, /当前无法可靠确定具体关系主体或目标 Runtime ID/u,
    "a life-status conflict cannot be used as a birth-order fallback");
  assert.doesNotMatch(facts, /目标人物：候选[甲乙]/u);
}

function testActualPromptPairUsesCurrentAgeInBothDirections() {
  const older = makeCharacter(1, "年长者甲", 11, "male", { birthDateTotalDays: 10000 });
  const younger = makeCharacter(2, "年幼者乙", 9, "male", { birthDateTotalDays: 9000 });
  older.siblings.push({ id: younger.id, name: younger.fullName, gender: "male" });
  younger.siblings.push({ id: older.id, name: older.fullName, gender: "male" });
  const prompt = buildPrompt([older, younger], { activeParticipantIds: [1, 2] }).relationship;
  assert.match(prompt, /年长者甲年长于年幼者乙/u,
    "the actual Prompt pair matrix uses the trusted current age ahead of opposite birth ordinal order");
  assert.match(prompt, /年长者甲是年幼者乙的哥哥/u,
    "the older participant receives the older-sibling title");
  assert.match(prompt, /年幼者乙是年长者甲的弟弟/u,
    "the younger participant receives the reverse younger-sibling title");
}

function run() {
  const originalLog = console.log;
  console.log = () => {};
  try {
    testCurrentAgeOutranksContradictoryBirthOrdinalInFamilyFacts();
    testAgeConflictCannotBeBypassedByBirthOrdinal();
    testLifeStatusConflictCannotBeBypassedByBirthOrdinal();
    testActualPromptPairUsesCurrentAgeInBothDirections();
  } finally {
    console.log = originalLog;
  }
  console.log("V9.3.9.2 kinship source QA: PASS (trusted current-age priority, age/life conflict fail-closed, actual Prompt pair titles in both directions)");
}

run();
