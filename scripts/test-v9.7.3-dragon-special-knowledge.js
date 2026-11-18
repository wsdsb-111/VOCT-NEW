"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { captureRecognitionEvidence, activateSocialRecognition, preserveSocialRecognition, getSupernaturalPerception,
  hasSpecialRelationKnowledge } = require("../src/app/main/prompts/social-recognition-policy");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");
const { createLogParser } = require("../src/app/main/game-data/log-parser");
const { Character } = require("../src/app/main/game-data/character");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { buildCharacterDisclosureContext } = require("../src/app/main/conversation/character-disclosure-context");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");

const person = (id, traits = []) => ({ id, shortName: `真实姓名${id}`, fullName: `完整姓名${id}`, age: 42, primaryTitle: `真实头衔${id}`,
  titles: [`完整头衔${id}`], personality: "勇敢而贪婪", boldness: 70, greed: 60, faith: "人物信仰", culture: "人物文化",
  traits: traits.map(traitId => ({ traitId, name: traitId === "brave" ? "勇敢" : traitId })),
  secrets: ["SECRET_CONTENT"], knownSecrets: [], memories: ["PRIVATE_MEMORY"], conversationSummaries: ["OLD_DIALOGUE"], relationsToCharacters: [] });
const data = (left = ["vampire"], right = ["brave", "greedy", "witch", "bastard"]) => ({ playerID: 1, aiID: 2,
  campaignToken: "special-campaign", date: "1200.1.1", totalDays: 100, characters: new Map([[1, person(1, left)], [2, person(2, right)], [3, person(3)]]) });
const proof = (gameData, patch = {}) => ({ id: 2, hasSpecialRelation: true, source: "CK3_SPECIAL_RELATION", sourceOwnerId: 1,
  campaignToken: gameData.campaignToken, sourceSnapshotId: `${gameData.date}/${gameData.totalDays}`, relations: ["irrelevant localized relationship"], ...patch });
const activate = (gameData, ids = [1, 2]) => { captureRecognitionEvidence(gameData, []); activateSocialRecognition(gameData, ids); };

const pureDragonIds = ["myv_wyvern", "myv_wyvern_tamed", "myv_wyvern_legendary", "mm_royal_dragon_king", "mm_royal_complete",
  "mm_royal_white_empress", "mm_royal_black_emperor", "mm_royal_fire_king", "mm_royal_earth_king", "mm_royal_sea_king", "mm_royal_sky_king"];
for (const id of pureDragonIds) {
  for (const observer of ["vampire", "werewolf", "supehunter", "mummy", "psychic"]) {
    const gameData = data([observer], [id, "witch"]);
    assert.deepEqual(getSupernaturalPerception(gameData.characters.get(1), gameData.characters.get(2), gameData, { activeParticipantIds: [1, 2] }).traitKeys,
      ["trait_" + id], `${observer} sees only the pure dragon identity ${id}`);
  }
  const human = data([], [id]);
  assert.equal(getSupernaturalPerception(human.characters.get(1), human.characters.get(2), human, { activeParticipantIds: [1, 2] }).level, "NONE");
  for (const target of ["vampire", "werewolf", "supehunter", "mummy", "psychic", "sorcerer", "theurgist", "mage"]) {
    const reverse = data([id], [target, "witch"]);
    assert.deepEqual(getSupernaturalPerception(reverse.characters.get(1), reverse.characters.get(2), reverse, { activeParticipantIds: [1, 2] }).traitKeys,
      ["trait_" + target], `pure dragon ${id} identifies ${target} without revealing ordinary private traits`);
  }
}
for (const observer of pureDragonIds) for (const target of pureDragonIds) {
  const pair = data([observer], [target, "witch"]);
  assert.deepEqual(getSupernaturalPerception(pair.characters.get(1), pair.characters.get(2), pair, { activeParticipantIds: [1, 2] }).traitKeys,
    ["trait_" + target], `pure dragon pairs precisely recognize each other: ${observer} -> ${target}`);
}
for (const id of ["mm_dragon_half", "mm_dragon_lineage_1", "mm_dragon_black_blood", "mm_asc_dragon_body", "myv_wyvern_rider"]) {
  const gameData = data(["vampire"], [id]);
  assert.deepEqual(getSupernaturalPerception(gameData.characters.get(1), gameData.characters.get(2), gameData, { activeParticipantIds: [1, 2] }).traitKeys, [],
    "mixed blood, rider or borrowed body does not expose a pure dragon identity: " + id);
}
const sight = data(["myv_wyvern_legendary"], ["vampire", "brave"]);
const recognized = createTraitProfileView(sight, sight.characters.get(1), { activeParticipantIds: [1, 2] }).gameData.characters.get(2);
assert.deepEqual(recognized.traits.map(trait => trait.traitId), ["vampire"]);
assert.equal(recognized.age, null);
assert.equal(recognized.primaryTitle, "");
assert.equal(recognized.personality, undefined);
assert.equal(recognized.shortName, "未获知姓名的人物", "pure dragon perception authorizes species, not a full personal profile");
const hiddenIdentity = { ownerId: 1, entityId: 2, campaignToken: sight.campaignToken, current: true, factType: "TRAIT",
  factKey: "trait_vampire", status: "MANUAL_HIDDEN", effectiveKnown: false, firstAcquiredDate: sight.date };
const hiddenSight = createTraitProfileView(sight, sight.characters.get(1), { activeParticipantIds: [1, 2],
  disclosureProfiles: new Map([[2, [hiddenIdentity]]]) }).gameData.characters.get(2);
assert.deepEqual(hiddenSight.traits, []);
assert.equal(hiddenSight.supernaturalPerception, undefined, "a pure dragon's detection cannot bypass manual hiding with a generic cue");

const gameData = data();
gameData.characters.get(1).relationsToCharacters.push(proof(gameData));
activate(gameData);
assert(hasSpecialRelationKnowledge(gameData, 1, 2) && hasSpecialRelationKnowledge(gameData, 2, 1), "one trusted special relationship authorizes both parties");
assert(!hasSpecialRelationKnowledge(gameData, 1, 3), "knowledge is not transitive");
for (const [owner, target] of [[1, 2], [2, 1]]) {
  const view = createTraitProfileView(gameData, gameData.characters.get(owner), { activeParticipantIds: [1, 2] }).gameData.characters.get(target);
  for (const key of ["shortName", "fullName", "age", "primaryTitle", "titles", "traits", "personality", "boldness", "greed", "faith", "culture"]) {
    assert.deepEqual(view[key], gameData.characters.get(target)[key], "special relations retain " + key);
  }
  for (const key of ["secrets", "knownSecrets", "memories", "conversationSummaries"]) assert.deepEqual(view[key], [], "special relations do not share " + key);
}
for (const patch of [{ hasSpecialRelation: false }, { hasSpecialRelation: null }, { sourceOwnerId: 3 }, { campaignToken: "other" },
  { sourceSnapshotId: "1199.1.1/1" }, { source: "LOCALIZED_TEXT" }]) {
  const invalid = data(); invalid.characters.get(1).relationsToCharacters.push(proof(invalid, patch)); activate(invalid);
  assert(!hasSpecialRelationKnowledge(invalid, 1, 2), "invalid relationship proof cannot grant full profiles: " + JSON.stringify(patch));
}
const merelyNamed = data(); merelyNamed.characters.get(1).relationsToCharacters.push({ id: 2, relations: ["friend lover soulmate mentor"] }); activate(merelyNamed);
assert(!hasSpecialRelationKnowledge(merelyNamed, 1, 2), "localized relation descriptions alone cannot authorize anything");
const waiting = data(); waiting.characters.get(1).relationsToCharacters.push(proof(waiting)); activate(waiting, [1]);
assert(!hasSpecialRelationKnowledge(waiting, 1, 2));
activateSocialRecognition(waiting, [2]); assert(hasSpecialRelationKnowledge(waiting, 1, 2));
const incomplete = data(); incomplete.characters.get(1).relationsToCharacters.push(proof(incomplete)); incomplete.ck3RelationshipReadbackComplete = false; activate(incomplete);
assert(!hasSpecialRelationKnowledge(incomplete, 1, 2));
const readback = data(); preserveSocialRecognition(gameData, readback);
assert(hasSpecialRelationKnowledge(readback, 1, 2), "action readback preserves the opening relationship snapshot");
const fresh = data(); activate(fresh);
assert(!hasSpecialRelationKnowledge(fresh, 1, 2), "next conversation refreshes an ended special relationship");
const letter = data(); letter.letterData = { content: "private letter" }; letter.characters.get(1).relationsToCharacters.push(proof(letter));
captureRecognitionEvidence(letter, []);
assert(hasSpecialRelationKnowledge(letter, 1, 2) && hasSpecialRelationKnowledge(letter, 2, 1), "a confirmed special relationship is known by the two explicit letter parties");
assert(!hasSpecialRelationKnowledge(letter, 1, 3));
assert.equal(getSupernaturalPerception(letter.characters.get(1), letter.characters.get(2), letter, { activeParticipantIds: [1, 2] }).level, "NONE");
const changed = { ...data(), playerID: 3 }; preserveSocialRecognition(gameData, changed);
assert(!hasSpecialRelationKnowledge(changed, 1, 2), "old controlled character cannot carry relationship knowledge to B");

const root = fs.mkdtempSync(path.resolve(__dirname, "../.build/dragon-special-"));
async function run() {
  try {
    const conversation = { id: "special-scene", conversationEpoch: 1, recognitionPlayerId: 1, isActive: true, gameData,
      selectedCharacterIds: new Set([2, 3]), presentCharacterIds: new Set([2]), messages: [], departedCharacterIds: new Set(), inactiveParticipantIds: new Map() };
    const store = new ConversationDisclosureStore({ dataDir: root, getCurrentConversation: () => conversation });
    const ctx = owner => ({ ...buildCharacterDisclosureContext({ service: store, gameData, responderId: owner, targetIds: [1, 2, 3], audienceIds: [1, 2] }), activeParticipantIds: [1, 2] });
    assert.equal(fs.existsSync(store.filePath), false);
    const profile = store.getTargetView({ ownerRuntimeId: 1, targetRuntimeId: 2 });
    const brave = profile.facts.find(fact => fact.factKey === "trait_brave");
    assert(brave.effectiveKnown && brave.source === "SPECIAL_RELATION");
    store.setManualStatus({ ...profile.scope, factType: "TRAIT", factKey: brave.factKey, factSourceSnapshotId: brave.factSourceSnapshotId,
      expectedRevision: brave.revision, status: "MANUAL_HIDDEN" });
    const hidden = createTraitProfileView(gameData, gameData.characters.get(1), ctx(1)).gameData.characters.get(2);
    assert(!hidden.traits.some(trait => trait.traitId === "brave"));
    assert(!hidden.personality.includes("勇敢"), "a hidden trait cannot reappear in the full personality string");
    gameData.nestedProfile = { ...gameData.characters.get(2) };
    assert(!createTraitProfileView(gameData, gameData.characters.get(1), ctx(1)).gameData.nestedProfile.personality.includes("勇敢"),
      "a nested copy of the related character must respect the same hidden personality trait");
    delete gameData.nestedProfile;
    const builder = createPromptBuilder({ TemplateEngine: class {}, PromptScriptLoader: class {} });
    const projected = createTraitProfileView(gameData, gameData.characters.get(2), ctx(2));
    const rule = builder.buildPlayerIdentityKnowledge(projected.character, projected.gameData);
    assert(rule.includes("特殊关系") && !rule.includes("双方是当前可靠公开的近亲"), "special relationships are not mislabeled as relatives");
    assert(rule.includes("不授权秘密") || rule.includes("不授权个人秘密"));

    const fields = id => { const values = Array(28).fill(""); Object.assign(values, { 0: id, 1: `角色${id}`, 2: `角色${id}`, 4: "he", 5: "42" }); return ["VOTC:IN", "character", ...values].join("/;/"); };
    const header = ["VOTC:IN/;/init/;/1/;/玩家/;/2/;/对象/;/1200.1.1/;/conversation/;/hall/;/hall/;/100", "VOTC:CAMPAIGN/votc8c-123456789012", fields(1), fields(2)];
    const file = path.join(root, "debug.log");
    fs.writeFileSync(file, [...header, "VOTC:IN/;/new_relations/;/1/;/2/;/yes/;/STARTMULTILINE#本地化师徒说明#ENDMULTILINE/;/"].join("\n"));
    class GameData { constructor(values) { this.playerID = Number(values[0]); this.aiID = 2; this.date = values[4]; this.totalDays = Number(values[8]); this.characters = new Map(); } }
    const previous = console.log; let parsed;
    try { console.log = () => {}; parsed = await createLogParser({ GameData, Character })(file); } finally { console.log = previous; }
    activateSocialRecognition(parsed, [1, 2]);
    assert.equal(parsed.characters.get(1).relationsToCharacters[0].hasSpecialRelation, true, "parser preserves native yes/no instead of guessing text");
    assert(hasSpecialRelationKnowledge(parsed, 2, 1));
    console.log("PASS pure-dragon identity, trusted special relation full profiles, manual priority, frozen scene, parser and memory boundary");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
