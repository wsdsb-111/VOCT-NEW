"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { id: versionPath, filename: versionPath, loaded: true,
  exports: { MEMORY_ENGINE_VERSION: "3.0" } };
const { createGameData } = require("../src/app/main/game-data/game-data");
const { Character } = require("../src/app/main/game-data/character");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { createTraitProfileView, isPublicCloseFamily } = require("../src/app/main/prompts/trait-profile-selector");

const campaignToken = "votc-v96-family-age-qa";
const date = "1164.5.20";
const totalDays = 425000;
const snapshotId = date + "/" + totalDays;
const names = ["李思青", "李思安", "李思淳", "李思偃"];
const ages = [27, 24, 21, 18];
const birthDays = [360000, 370000, 380000, 390000];
const genders = ["female", "male", "male", "female"];

function makeCharacter(id, name, age, birthDateTotalDays, gender) {
  const raw = Array(28).fill("");
  raw[0] = id;
  raw[1] = name;
  raw[2] = name;
  raw[4] = gender === "female" ? "she" : "he";
  raw[5] = age;
  const character = new Character(raw);
  Object.assign(character, {
    name,
    firstName: name,
    gender,
    age,
    ageSource: "CK3_CURRENT_AGE",
    birth: "1140.1.1",
    birthDate: "1140.1.1",
    birthDateTotalDays,
    birthTotalDays: birthDateTotalDays,
    alive: true,
    traits: [],
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    concubines: [],
    relationsToCharacters: [],
    relationsToPlayer: [],
    opinions: [],
    opinionBreakdowns: []
  });
  return character;
}

function makeSiblingAgeProof(ownerId, age, overrides = {}) {
  return {
    value: age,
    ageSource: "CK3_LIVE_RELATIVE_AGE",
    sourceOwnerId: ownerId,
    relationType: "sibling",
    source: ownerId + ".siblings",
    campaignToken,
    sourceSnapshotId: snapshotId,
    ...overrides
  };
}

function makeFamilyGameData({ badPair = null, badProof = null, stepPair = null, extraCharacters = [] } = {}) {
  const characters = new Map(names.map((name, index) => [
    index + 1,
    makeCharacter(index + 1, name, ages[index], birthDays[index], genders[index])
  ]));
  for (const owner of characters.values()) {
    owner.siblings = [...characters.values()].filter(target => target.id !== owner.id).map(target => {
      const pair = [owner.id, target.id].sort((left, right) => left - right).join(":");
      const overrides = badPair === pair && owner.id === Math.max(owner.id, target.id) ? badProof : null;
      const row = {
        id: target.id,
        name: target.fullName,
        gender: target.gender,
        age: target.age,
        ageSource: "CK3_LIVE_RELATIVE_AGE",
        birthDateTotalDays: target.birthDateTotalDays,
        evidence: { age: [makeSiblingAgeProof(owner.id, target.age, overrides || {})] }
      };
      if (stepPair === pair) row.relationshipKind = "STEP";
      return row;
    });
  }
  for (const character of extraCharacters) characters.set(character.id, character);
  const gameData = {
    campaignToken,
    date,
    totalDays,
    year: 1164,
    playerID: 99,
    playerName: "玩家",
    aiID: 3,
    aiName: names[2],
    scene: "hall",
    location: "宫廷",
    locationController: null,
    characters,
    mentionedCharactersInContext: new Set()
  };
  return gameData;
}

function assertAgeAndBirthVisible(profile, expectedAge, expectedBirthDay, label) {
  assert.equal(profile.age, expectedAge, label + " should keep its current CK3 age");
  assert.equal(profile.birth, "1140.1.1", label + " should keep birth");
  assert.equal(profile.birthDate, "1140.1.1", label + " should keep birthDate");
  assert.equal(profile.birthDateTotalDays, expectedBirthDay, label + " should keep birthDateTotalDays");
  assert.equal(profile.birthTotalDays, expectedBirthDay, label + " should keep birthTotalDays");
}

function assertAgeAndBirthHidden(profile, label) {
  assert.equal(profile.age, null, label + " age should remain masked");
  for (const field of ["birth", "birthDate", "birthDateTotalDays", "birthTotalDays"]) {
    assert.equal(Object.hasOwn(profile, field), false, label + " " + field + " should remain masked");
  }
}

// Valid current sibling evidence exposes only the public close relative's current age and birth data.
{
  const gameData = makeFamilyGameData();
  const sourceTarget = gameData.characters.get(2);
  const projected = createTraitProfileView(gameData, gameData.characters.get(1)).gameData;
  assert.equal(isPublicCloseFamily(1, 2, gameData), true);
  for (let id = 2; id <= 4; id++) {
    const source = gameData.characters.get(id);
    assertAgeAndBirthVisible(projected.characters.get(id), source.age, source.birthDateTotalDays, source.fullName);
  }
  assertAgeAndBirthVisible(projected.characters.get(1), ages[0], birthDays[0], names[0]);
  assert.equal(sourceTarget.age, ages[1], "projection must not mutate the CK3 source profile");
  assert.equal(sourceTarget.birthDateTotalDays, birthDays[1], "projection must not mutate source birth data");
}

// Non-family data stays masked; a scoped, current AGE disclosure remains a separate valid route.
{
  const stranger = makeCharacter(9, "场外人物", 42, 400000, "male");
  const gameData = makeFamilyGameData({ extraCharacters: [stranger] });
  assert.equal(isPublicCloseFamily(1, 9, gameData), false);
  assertAgeAndBirthHidden(createTraitProfileView(gameData, gameData.characters.get(1)).gameData.characters.get(9), "stranger");

  const fact = {
    campaignToken,
    ownerId: 1,
    entityId: 9,
    factType: "AGE",
    factKey: "age",
    status: "AUTO_DISCLOSED",
    current: true,
    effectiveKnown: true,
    firstAcquiredDate: date
  };
  const known = createTraitProfileView(gameData, gameData.characters.get(1), {
    disclosureProfiles: new Map([[9, [fact]]])
  }).gameData.characters.get(9);
  assertAgeAndBirthVisible(known, stranger.age, stranger.birthDateTotalDays, stranger.fullName);
}

// Campaign/snapshot mismatch and an explicit STEP marker cannot make a sibling age public.
for (const [label, options] of [
  ["stale campaign", { badPair: "1:2", badProof: { campaignToken: "other-campaign" } }],
  ["stale snapshot", { badPair: "1:2", badProof: { sourceSnapshotId: "1164.5.19/424999" } }],
  ["wrong source owner", { badPair: "1:2", badProof: { sourceOwnerId: 99 } }],
  ["step sibling", { stepPair: "1:2" }]
]) {
  const gameData = makeFamilyGameData(options);
  assert.equal(isPublicCloseFamily(1, 2, gameData), false, label + " must not authorize close-family age access");
  const projected = createTraitProfileView(gameData, gameData.characters.get(1)).gameData;
  assertAgeAndBirthHidden(projected.characters.get(2), label);
}

// A typed bastard-to-parent relation does not turn the hidden biological link into age permission.
{
  const parent = makeCharacter(10, "父亲", 50, 330000, "male");
  const child = makeCharacter(11, "私生子", 20, 390000, "male");
  child.traits = [{ traitId: "bastard", name: "私生子" }];
  const proof = {
    source: "CK3_DIRECT_PARENT",
    sourceOwnerId: child.id,
    childId: child.id,
    parentId: parent.id,
    relationType: "parent",
    sourceRelation: "parents",
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken,
    sourceSnapshotId: snapshotId
  };
  child.parents = [{ id: parent.id, name: parent.fullName, gender: parent.gender, ...proof }];
  const gameData = makeFamilyGameData({ extraCharacters: [parent, child] });
  assert.equal(isPublicCloseFamily(parent.id, child.id, gameData), false);
  const projected = createTraitProfileView(gameData, parent).gameData.characters.get(child.id);
  assertAgeAndBirthHidden(projected, "bastard parent");
}

// The assembled active-participant Prompt path emits pairwise order only for current public sibling pairs.
{
  const GameData = createGameData({
    fs,
    path,
    summariesDir: "",
    memorySystem: {},
    getHistoricalReferenceByYear: () => null
  });
  const settingsRepository = {
    getPromptSettings: () => ({
      mainTemplate: "V9.3.9.2 synthetic kinship prompt",
      blocks: [
        { id: "main", type: "main", enabled: true, role: "system" },
        { id: "history", type: "history", enabled: true }
      ],
      suffix: { enabled: false }
    }),
    getChatPromptV89Settings: () => ({ chatPromptV89Layout: false }),
    getChatPromptV813Layout: () => true
  };
  const TokenCounter = {
    estimateTokens: value => String(value || "").length,
    estimateMessageTokens: message => String(message?.content || "").length,
    calculateTotalTokens: messages => (messages || []).reduce((total, message) => total + String(message.content || "").length, 0)
  };
  const PromptBuilder = createPromptBuilder({
    TemplateEngine: class {
      renderTemplateString(template) {
        return String(template || "");
      }
    },
    PromptScriptLoader: class {},
    settingsRepository,
    promptConfigManager: { resolvePath: value => value, getDefaultMainTemplateContent: () => "" },
    path,
    TokenCounter,
    createPromptFingerprint: () => "",
    defaultChatInstruction: ""
  });
  const buildPrompt = options => {
    const data = makeFamilyGameData(options);
    const gameData = new GameData([
      data.playerID, data.playerName, data.aiID, data.aiName, data.date, "___________talk_scene",
      data.location, data.locationController || "", data.totalDays
    ]);
    Object.assign(gameData, data, { relationFingerprint: "v96-family-age-prompt-fixture" });
    const responder = gameData.characters.get(3);
    const result = PromptBuilder.buildMessagesWithTokenCount(
      [{ role: "user", content: "请准确称呼在场兄妹。" }],
      responder,
      gameData,
      "",
      {
        activeParticipantIds: [1, 2, 3, 4],
        subjectiveWorldPolicyActive: true,
        cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() }
      }
    );
    return result.messages.map(message => message.content).join("\n");
  };
  const prompt = buildPrompt();
  assert.match(prompt, /李思青年长于李思安/);
  assert.match(prompt, /李思安年长于李思淳/);
  assert.match(prompt, /李思淳年长于李思偃/);
  assert.doesNotMatch(prompt, /李思安年长于李思青|李思淳年长于李思安|李思偃年长于李思淳/);

  for (const [label, options] of [
    ["stale sibling proof", { badPair: "1:3", badProof: { sourceSnapshotId: "1164.5.19/424999" } }],
    ["step sibling marker", { stepPair: "1:3" }]
  ]) {
    const untrustedPrompt = buildPrompt(options);
    assert.doesNotMatch(untrustedPrompt, /李思青年长于李思淳|姐姐：李思青/,
      label + " must not expose an age-derived public sibling label");
  }
}

console.log("V9.6 family age independent QA: PASS");
