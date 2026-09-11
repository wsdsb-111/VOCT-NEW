"use strict";

const assert = require("assert");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { resolveRelationshipCurrentTruth } = require("../resources/app/out/main/worldline/relationship-current-truth");

const GameData = createGameData({ fs: {}, path: {}, memorySystem: {}, memoryEngine: { findMentionedCharactersInHistory: () => [] }, summariesDir: "", getHistoricalReferenceByYear: () => ({}) });

function createFixture(gender) {
  const gameData = new GameData([1, "玩家", 3, "回应者", "1170.1.1", "talk_scene_court", "京师", "玩家", 420000]);
  const player = { id: 1, shortName: "玩家", fullName: "玩家", gender: "male", birthDateTotalDays: 410000, siblings: [{ id: 2, name: "赵永和", gender: "female", birthDateTotalDays: 415000 }], evidence: { relations: [{ ownerId: 2, relationType: "sibling", source: "runtime" }] }, parents: [], children: [], traits: [], relationsToPlayer: [], relationsToCharacters: [] };
  const yonghe = { id: 2, shortName: "赵永和", fullName: "赵永和", gender, age: 6, birthDateTotalDays: 415000, siblings: [{ id: 1, name: "玩家", gender: "male", birthDateTotalDays: 410000 }], evidence: { relations: [{ ownerId: 1, relationType: "sibling", source: "runtime" }] }, parents: [], children: [], traits: [], relationsToPlayer: [], relationsToCharacters: [], conversationSummaries: [] };
  const responder = { id: 3, shortName: "回应者", fullName: "回应者", gender: "female", siblings: [], parents: [], children: [], traits: [], relationsToPlayer: [], relationsToCharacters: [] };
  gameData.characters = new Map([[1, player], [2, yonghe], [3, responder]]);
  gameData.getMentionableCharacterProfiles = () => gameData.characters;
  gameData.mentionedCharactersInContext = new Set([2]);
  return { gameData, player, yonghe, responder };
}

const canonical = createFixture("male");
const registry = new Map();
const fact = resolveRelationshipCurrentTruth({ gameData: canonical.gameData, subjectRuntimeId: 2, anchorRuntimeId: 1, registry });
assert.strictEqual(fact.currentState.sex, "male");
assert.strictEqual(fact.evidence.selectedSexSource, "CURRENT_RUNTIME");
assert.strictEqual(fact.evidence.memoryUsedForCurrentSex, false);
assert(fact.evidence.conflicts.includes("RELATION_SIDE_GENDER_CONFLICT"));
const mentioned = canonical.gameData.getMentionedCharactersInfo(canonical.responder, { currentFactRegistry: registry });
assert.match(mentioned, /性别：男性/);
assert.doesNotMatch(mentioned, /姐姐|妹妹|她/);
const active = canonical.gameData.getActiveParticipantRelationshipInfo(canonical.player, [2], registry);
assert.doesNotMatch(active, /姐姐|妹妹/);

const unknown = createFixture("unknown");
const unknownFact = resolveRelationshipCurrentTruth({ gameData: unknown.gameData, subjectRuntimeId: 2, anchorRuntimeId: 1, registry: new Map() });
assert.strictEqual(unknownFact.currentState.sex, "unknown", "one relation-side pronoun must not establish current sex");
assert.strictEqual(unknownFact.relations["1"].label, "手足");
const unknownMentioned = unknown.gameData.getMentionedCharactersInfo(unknown.responder, { currentFactRegistry: new Map() });
assert.match(unknownMentioned, /性别：未知/);
assert.match(unknownMentioned, /关系：手足/);
assert.doesNotMatch(unknownMentioned, /关系：(姐姐|妹妹|哥哥|弟弟)|性别：男性|性别：女性/);

console.log("VOTC v8.8.3 Sol Current Runtime Truth: PASS");
