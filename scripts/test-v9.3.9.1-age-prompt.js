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
const { createStableProfile, formatStableProfile } = require("../src/app/main/prompts/character-profile-v2");
const { computeAgeAtDate } = require("../src/app/main/worldline/character-temporal-facts");

const TokenCounter = {
  estimateTokens: value => Math.ceil(String(value ?? "").length / 4),
  estimateMessageTokens: message => Math.ceil(String(message?.content ?? "").length / 4),
  calculateTotalTokens: messages => (messages || []).reduce((total, message) => total + Math.ceil(String(message?.content ?? "").length / 4), 0)
};

const GameData = createGameData({
  fs,
  path,
  memorySystem: {},
  summariesDir: "",
  getHistoricalReferenceByYear: () => null
});

const settingsRepository = {
  getPromptSettings: () => ({
    mainTemplate: "V9.3.9.1 synthetic fixed prompt",
    blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true }
    ],
    suffix: { enabled: false }
  }),
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: false }),
  getChatPromptV813Layout: () => true
};

const PromptBuilder = createPromptBuilder({
  TemplateEngine: class {
    renderTemplateString(template) {
      return String(template ?? "");
    }
  },
  PromptScriptLoader: class {},
  promptConfigManager: { getDefaultMainTemplateContent: () => "", resolvePath: value => value },
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: value => String(value ?? ""),
  defaultChatInstruction: ""
});

function makeCharacter({ age, ageSource = null, birthDate = "1172年5月2日" } = {}) {
  const row = Array(28).fill("");
  row[0] = "2";
  row[1] = "回应者";
  row[2] = "回应者";
  row[4] = "he";
  row[5] = age == null ? "" : String(age);
  const character = new Character(row);
  if (ageSource !== null) character.ageSource = ageSource;
  character.birthDate = birthDate;
  return character;
}

function makeGameData(character, date) {
  const gameData = new GameData([99, "玩家", character.id, character.fullName, date, "___________talk_scene", "", "", 106575]);
  gameData.date = date;
  gameData.campaignToken = "v9391-synthetic-campaign";
  gameData.characters = new Map([[character.id, character]]);
  return gameData;
}

function makeCache() {
  return { conversation: null, responders: new Map(), prefixByResponder: new Map() };
}

const historicalSummary = "历史摘要原文本：我在1172年时18岁。";
const history = [
  { role: "assistant", content: historicalSummary },
  { role: "user", content: "我现在几岁？" }
];

function build(character, date, cache = makeCache()) {
  const gameData = makeGameData(character, date);
  const result = PromptBuilder.buildMessagesWithTokenCount(history, character, gameData, "", {
    activeParticipantIds: [character.id],
    subjectiveWorldPolicyActive: true,
    cacheV2FrozenSnapshots: cache
  });
  const block = id => result.blocks.find(entry => entry.block?.id === id)?.content || "";
  return {
    result,
    cache,
    stableProfile: block("responder-frozen-profile"),
    currentFacts: block("responder-game-facts"),
    allPromptText: result.messages.map(message => message.content).join("\n")
  };
}

function ageLine(text) {
  return String(text).split(/\r?\n/).find(line => line.includes("年龄：")) || "";
}

// Freeze an 18-year-old profile, then feed the same responder/cache an authoritative age of 17.
const responder = makeCharacter({ age: 18, ageSource: "CK3_CURRENT_AGE" });
const cache = makeCache();
const first = build(responder, "1190年5月2日", cache);
assert.equal(createStableProfile(responder, makeGameData(responder, "1190年5月2日")).age, 18,
  "stable profile creation continues to resolve and retain the trusted age");
assert.equal(cache.responders.get("2").profile.age, 18, "the frozen profile cache retains its original age field");
assert.equal(ageLine(first.stableProfile), "", "the stable profile does not present mutable age as frozen identity");
assert.match(ageLine(first.currentFacts), /年龄：18岁/u, "the first prompt exposes the current age in dynamic facts");

responder.age = 17;
responder.birthDate = "1172年5月2日";
const second = build(responder, "1190年5月1日", cache);
assert.equal(cache.responders.get("2").profile.age, 18, "the test preserves the existing frozen profile cache behavior");
assert.equal(ageLine(second.stableProfile), "", "the stale frozen profile contributes no age line");
assert.match(ageLine(second.currentFacts), /年龄：17岁/u, "the second prompt uses current dynamic age 17");
assert(!second.stableProfile.includes("18"), "frozen responder identity contains no stale age value");
assert(second.allPromptText.includes(historicalSummary), "the exact historical summary wording remains unchanged in the prompt");

// A normal 17-to-18 birthday transition remains authoritative; nothing globally subtracts one.
responder.age = 18;
const birthday = build(responder, "1190年5月2日", cache);
assert.equal(computeAgeAtDate("1172年5月2日", "1190年5月1日"), 17);
assert.equal(computeAgeAtDate("1172年5月2日", "1190年5月2日"), 18);
assert.match(ageLine(birthday.currentFacts), /年龄：18岁/u, "age on the birthday is not decremented");

// One day before the birthday, CK3's authoritative age stays 17.
responder.age = 17;
const beforeBirthday = build(responder, "1190年5月1日");
assert.match(ageLine(beforeBirthday.currentFacts), /年龄：17岁/u, "age before the birthday is not adjusted globally");

// Raw numbers without current-age provenance and missing ages remain unknown.
const unknownSource = makeCharacter({ age: 18, ageSource: "UNVERIFIED" });
const unknownPrompt = build(unknownSource, "1190年5月2日");
assert.match(ageLine(unknownPrompt.currentFacts), /年龄：游戏未提供/u, "an untrusted raw age is not promoted or adjusted");

const missingAge = makeCharacter({ age: null, ageSource: "CK3_CURRENT_AGE" });
const missingPrompt = build(missingAge, "1190年5月2日");
assert.match(ageLine(missingPrompt.currentFacts), /年龄：游戏未提供/u, "a missing trusted age remains unknown");

// Frozen profile text has no age even when the underlying value is unknown.
assert.doesNotMatch(formatStableProfile(createStableProfile(unknownSource, makeGameData(unknownSource, "1190年5月2日"))), /年龄：/u);

console.log("V9.3.9.1 age Prompt: PASS (mutable age excluded from frozen profile; current, unknown, missing, birthday and historical text preserved)");
