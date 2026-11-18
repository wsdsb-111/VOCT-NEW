"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { captureRecognitionEvidence, activateSocialRecognition, preserveSocialRecognition, getSocialRecognitionSource,
  isSupernaturalIdentity } = require("../src/app/main/prompts/social-recognition-policy");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { buildCharacterDisclosureContext, formatSelfConcealment } = require("../src/app/main/conversation/character-disclosure-context");
const { resolveTraitVisibility } = require("../src/app/main/prompts/trait-visibility-policy");
const { createLogParser } = require("../src/app/main/game-data/log-parser");
const { Character } = require("../src/app/main/game-data/character");
const { Conversation } = require("../src/app/main/conversation/conversation");

const person = (id, name) => ({ id, shortName: name, name, fullName: name, primaryTitle: "王国" + id,
  traits: ["vampire", "mummy", "werewolf", "brave", "greedy", "witch", "bastard"].map(traitId => ({ traitId, name: traitId })) });
const characters = new Map([[1, person(1, "甲")], [2, person(2, "乙")], [3, person(3, "丙")], [4, person(4, "丁")]]);
const data = () => ({ playerID: 1, campaignToken: "social-campaign", date: "1200.1.1", totalDays: 100, characters });
const gameData = data();
const rows = [[2, 1, 1, "OWN_COURT_LORD"], [1, 3, 1, "NEIGHBORING_SOVEREIGN"], [3, 2, 1, "REALM_PEERS"]];
captureRecognitionEvidence(gameData, rows);
activateSocialRecognition(gameData, [1, 2]);
assert.equal(getSocialRecognitionSource(gameData, 2, 1), "OWN_COURT_LORD");
assert.equal(getSocialRecognitionSource(gameData, 1, 2), null, "recognition is directed");
assert.equal(getSocialRecognitionSource(gameData, 1, 3), null, "waiting/exported candidates do not get recognition");
activateSocialRecognition(gameData, [3]);
assert.equal(getSocialRecognitionSource(gameData, 1, 3), "NEIGHBORING_SOVEREIGN");
for (const key of ["vampire", "mummy", "werewolf", "mage", "demon", "fae", "wraith", "myv_wyvern"]) assert(isSupernaturalIdentity(key), key);
for (const key of ["brave", "greedy", "witch", "bastard", "mortal", "use_ingame_chargen", "hunter"]) assert(!isSupernaturalIdentity(key), key);
assert.equal(resolveTraitVisibility({ traitId: "vampire", category: "appearance" }).status, "NON_OBSERVABLE", "supernatural identity cannot masquerade as a visible trait category");
const temp = fs.mkdtempSync(path.resolve(__dirname, "../.build/social-recognition-"));
try {
  const conversation = { id: "social-scene", conversationEpoch: 1, isActive: true, gameData,
    selectedCharacterIds: new Set([2, 3]), presentCharacterIds: new Set([2]), messages: [],
    departedCharacterIds: new Set(), inactiveParticipantIds: new Map() };
  const service = new ConversationDisclosureStore({ dataDir: temp, getCurrentConversation: () => conversation });
  const context = buildCharacterDisclosureContext({ service, gameData, responderId: 2, targetIds: [1, 3], audienceIds: [1] });
  const view = createTraitProfileView(gameData, characters.get(2), context).gameData.characters.get(1);
  assert.equal(view.shortName, "甲");
  assert.equal(view.primaryTitle, "王国1");
  assert.deepEqual(view.traits.map(trait => trait.traitId), ["vampire", "mummy", "werewolf"], "politics cannot reveal ordinary private traits");
  const inverse = createTraitProfileView(gameData, characters.get(1), buildCharacterDisclosureContext({ service, gameData, responderId: 1, targetIds: [2] })).gameData.characters.get(2);
  assert.equal(inverse.shortName, "未获知姓名的人物", "courtier recognition does not authorize the lord in reverse");
  const conceal = formatSelfConcealment(context, gameData, 2, [1]);
  assert(conceal.includes("伪装") && conceal.includes("vampire") && conceal.includes("未获知"), "own real traits guide style while strangers remain unaware");
  assert.equal(fs.existsSync(service.filePath), false, "automatic recognition never writes disclosure records");
  const knownAudience = buildCharacterDisclosureContext({ service, gameData, responderId: 1, targetIds: [2], audienceIds: [2] });
  assert(formatSelfConcealment(knownAudience, gameData, 1, [2]).includes("已获知你的身份=吸血鬼、木乃伊、狼人"),
    "concealment uses listener-to-speaker knowledge, not speaker-to-listener knowledge");
  const target = service.getTargetView({ ownerRuntimeId: 2, targetRuntimeId: 1 });
  const hidden = target.facts.find(fact => fact.factKey === "trait_vampire");
  service.setManualStatus({ ...target.scope, factType: hidden.factType, factKey: hidden.factKey,
    factSourceSnapshotId: hidden.factSourceSnapshotId, expectedRevision: hidden.revision, status: "MANUAL_HIDDEN" });
  const hiddenView = createTraitProfileView(gameData, characters.get(2), buildCharacterDisclosureContext({ service, gameData, responderId: 2, targetIds: [1] }));
  assert(!hiddenView.gameData.characters.get(1).traits.some(trait => trait.traitId === "vampire"), "manual hidden wins");
  const witch = service.getTargetView({ ownerRuntimeId: 2, targetRuntimeId: 1 }).facts.find(fact => fact.factKey === "trait_witch");
  service.setManualStatus({ ...target.scope, factType: witch.factType, factKey: witch.factKey,
    factSourceSnapshotId: witch.factSourceSnapshotId, expectedRevision: witch.revision, status: "MANUAL_KNOWN" });
  // New CK3 readbacks cannot refresh a running scene's politics.
  const readback = data();
  captureRecognitionEvidence(readback, [[1, 2, 1, "REALM_PEERS"]]);
  preserveSocialRecognition(gameData, readback);
  assert.equal(getSocialRecognitionSource(readback, 2, 1), "OWN_COURT_LORD");
  assert.equal(getSocialRecognitionSource(readback, 1, 2), null);
  const switched = { ...data(), playerID: 4 };
  captureRecognitionEvidence(switched, rows);
  preserveSocialRecognition(gameData, switched);
  activateSocialRecognition(switched, [2, 4]);
  assert.equal(getSocialRecognitionSource(switched, 2, 1), null, "A's frame cannot follow a switch or inheritance to B");
  conversation.gameData = switched;
  conversation.selectedCharacterIds = new Set([1, 2]);
  assert(service.getDisclosureProfile({ ownerRuntimeId: 2, targetRuntimeId: 4 }).facts.some(fact => fact.factKey === "trait_vampire"
    && fact.effectiveKnown && fact.source === "SUPERNATURAL_RECOGNITION"),
    "B's own same-species recognition is freshly derived; A's manual hiding does not transfer");
  assert(!service.getDisclosureProfile({ ownerRuntimeId: 2, targetRuntimeId: 4 }).facts.some(fact => fact.factKey === "trait_witch" && fact.effectiveKnown));
  assert(service.getDisclosureProfile({ ownerRuntimeId: 2, targetRuntimeId: 1 }).facts.some(fact => fact.factKey === "trait_witch" && fact.effectiveKnown),
    "the old character's records remain their own history");
  conversation.recognitionPlayerId = 1;
  assert.equal(service.getDisclosureProfile({ ownerRuntimeId: 2, targetRuntimeId: 4 }).status, "BLOCKED", "a changed player cannot continue the old scene");
  const otherCampaign = { ...data(), campaignToken: "other" };
  preserveSocialRecognition(gameData, otherCampaign);
  assert.equal(getSocialRecognitionSource(otherCampaign, 2, 1), null);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

async function checkParserAndSelection() {
  const fixtureRoot = fs.mkdtempSync(path.resolve(__dirname, "../.build/social-export-"));
  const file = path.join(fixtureRoot, "debug.log");
  class GameData {
    constructor(data) { Object.assign(this, { playerID: Number(data[0]), aiID: Number(data[2]), date: data[4], totalDays: Number(data[8]), characters: new Map() }); }
  }
  const characterLine = id => {
    const fields = Array(28).fill("");
    Object.assign(fields, { 0: id, 1: "同名人物", 2: "同名人物", 4: "he", 5: "30", 18: "同名人物" });
    return ["VOTC:IN", "character", ...fields].join("/;/");
  };
  const header = id => `VOTC:IN/;/init/;/${id}/;/玩家/;/2/;/对象/;/1200.1.1/;/conversation/;/hall/;/hall/;/100`;
  const lines = [header(1), "VOTC:CAMPAIGN/votc8c-123456789012", ...[1, 2, 3, 4].map(characterLine),
    "VOTC:IN/;/social_recognition/;/2/;/1/;/1/;/HIGH_LIEGE",
    "VOTC:IN/;/social_recognition/;/3/;/1/;/1/;/REALM_PEERS"];
  const previousLog = console.log;
  try {
    console.log = () => {};
    fs.writeFileSync(file, lines.join("\n"));
    const parsed = await createLogParser({ GameData, Character })(file);
    const scene = { gameData: parsed, nextId: 0, summaryParticipantProfiles: new Map(), inactiveParticipantIds: new Map(),
      getPresenceState: () => ({}) };
    Conversation.prototype.initializePresence.call(scene);
    assert.equal(getSocialRecognitionSource(parsed, 2, 1), "HIGH_LIEGE", "actual parser + scene initialization activates the selected NPC");
    assert.equal(getSocialRecognitionSource(parsed, 3, 1), null, "pinned candidates remain inactive until selected into dialogue");
    // A second init is a new controlled character. Rows before it cannot follow.
    fs.writeFileSync(file, [...lines, header(4), "VOTC:CAMPAIGN/votc8c-123456789012", ...[1, 2, 3, 4].map(characterLine),
      "VOTC:IN/;/social_recognition/;/2/;/4/;/1/;/HIGH_LIEGE"].join("\n"));
    const next = await createLogParser({ GameData, Character })(file);
    activateSocialRecognition(next, [1, 2, 4]);
    assert.equal(next.playerID, 4);
    assert.equal(getSocialRecognitionSource(next, 2, 1), null, "old init evidence is discarded");
    assert.equal(getSocialRecognitionSource(next, 2, 4), null, "mismatched GetPlayer evidence is rejected even for same-name targets");
    fs.writeFileSync(file, [header(4), "VOTC:CAMPAIGN/votc8c-123456789012", ...[2, 4].map(characterLine),
      "VOTC:IN/;/social_recognition/;/2/;/4/;/4/;/HIGH_LIEGE"].join("\n"));
    const fresh = await createLogParser({ GameData, Character })(file);
    activateSocialRecognition(fresh, [2, 4]);
    assert.equal(getSocialRecognitionSource(fresh, 2, 4), "HIGH_LIEGE", "fresh dialogue derives B's own current relationships");
  } finally {
    console.log = previousLog;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  console.log("PASS social recognition: parser, actual selection, directed traits, inverse disguise, manual priority, frozen scene and current-player isolation");
}
checkParserAndSelection().catch(error => { console.error(error); process.exitCode = 1; });
