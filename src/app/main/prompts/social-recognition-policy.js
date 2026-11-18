"use strict";

const { isSupernaturalIdentity, getSupernaturalGroup, getSupernaturalSpecies, normalizeTraitKey } = require("./trait-visibility-policy");
const { normalizeGameDate, resolveLifeStatus } = require("../worldline/character-temporal-facts");

const REASONS = new Set(["OWN_COURT_LORD", "HIGH_LIEGE", "REALM_PEERS", "NEIGHBORING_SOVEREIGN", "BORDERING_RULERS"]);
const SUPERNATURAL_PRESENCE_CUE = "察觉到非凡的气息，属于超自然存在；具体种族未辨明。";
const PERCEPTION_LABELS = { BLOOD: "血族感知", BEAST: "兽族感知", LEGEND: "传说感知", HELL: "地狱感知",
  SPIRIT: "生灵感知", SUPERNATURAL: "超自然感知", HUNTER: "猎人感知" };
const EXACT_GROUPS = new Set(["BLOOD", "HELL", "SPIRIT"]);
const LEGEND_FAMILIES = [new Set(["fae", "changeling", "kinain"]), new Set(["kueijin", "dhampyr"]), new Set(["mummy", "asekh_sen"])];
const RIVAL_IDENTITIES = new Set(["vampire", "werewolf", "supehunter"]);
const PURE_DRAGON_IDENTITIES = new Set(["myv_wyvern", "myv_wyvern_tamed", "myv_wyvern_legendary",
  "mm_royal_dragon_king", "mm_royal_complete", "mm_royal_white_empress", "mm_royal_black_emperor",
  "mm_royal_fire_king", "mm_royal_earth_king", "mm_royal_sea_king", "mm_royal_sky_king"]);
const evidenceByData = new WeakMap();
const frames = new WeakMap();
const endedData = new WeakSet();
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const hasCharacter = (data, id) => data?.characters?.has(Number(id));
const matches = (frame, data) => !!frame && frame.playerId === Number(data?.playerID)
  && !!frame.campaignToken && frame.campaignToken === data?.campaignToken;

function captureRecognitionEvidence(gameData, rows) {
  const pairs = new Map();
  const specialPairs = new Set();
  for (const [owner, target, player, reason] of rows) {
    if (!validId(owner) || !validId(target) || Number(owner) === Number(target)
      || Number(player) !== Number(gameData.playerID) || !REASONS.has(reason)
      || !hasCharacter(gameData, owner) || !hasCharacter(gameData, target)) continue;
    pairs.set(`${Number(owner)}:${Number(target)}`, reason);
  }
  if (gameData.ck3RelationshipReadbackComplete !== false && normalizeGameDate(gameData.date)
    && Number.isFinite(Number(gameData.totalDays))) for (const owner of gameData.characters.values()) {
    for (const relation of owner.relationsToCharacters || []) {
      if (relation.hasSpecialRelation !== true || relation.source !== "CK3_SPECIAL_RELATION"
        || relation.sourceOwnerId !== Number(owner.id) || !validId(relation.id) || Number(relation.id) === Number(owner.id)
        || !hasCharacter(gameData, relation.id) || relation.campaignToken !== gameData.campaignToken
        || relation.sourceSnapshotId !== `${gameData.date}/${Number(gameData.totalDays)}`) continue;
      specialPairs.add(`${Number(owner.id)}:${Number(relation.id)}`);
      specialPairs.add(`${Number(relation.id)}:${Number(owner.id)}`);
    }
  }
  evidenceByData.set(gameData, { playerId: Number(gameData.playerID), campaignToken: gameData.campaignToken,
    date: gameData.date, totalDays: gameData.totalDays, pairs, specialPairs });
}

function activateSocialRecognition(gameData, selectedIds) {
  const previous = frames.get(gameData);
  const evidence = evidenceByData.get(gameData);
  if (!matches(evidence, gameData)) return;
  endedData.delete(gameData);
  const frame = matches(previous, gameData) ? previous : { ...evidence, selectedIds: new Set() };
  for (const id of selectedIds) if (validId(id) && hasCharacter(gameData, id)) frame.selectedIds.add(Number(id));
  frames.set(gameData, frame);
}

function deactivateSocialRecognition(gameData) {
  if (gameData) endedData.add(gameData);
}

function preserveSocialRecognition(previousData, nextData) {
  const previous = frames.get(previousData);
  // Action readbacks preserve the opening snapshot; they cannot refresh politics
  // or move the old controlled character's knowledge to a new player character.
  frames.delete(nextData);
  evidenceByData.delete(nextData);
  if (endedData.has(previousData)) { endedData.add(nextData); return; }
  if (!matches(previous, nextData)) return;
  frames.set(nextData, previous);
  evidenceByData.set(nextData, previous);
}

function getSocialRecognitionSource(gameData, ownerId, targetId) {
  const frame = frames.get(gameData);
  if (endedData.has(gameData) || !matches(frame, gameData) || !frame.selectedIds.has(Number(ownerId)) || !frame.selectedIds.has(Number(targetId))
    || !hasCharacter(gameData, ownerId) || !hasCharacter(gameData, targetId)) return null;
  return frame.pairs.get(`${Number(ownerId)}:${Number(targetId)}`) || null;
}

function hasSpecialRelationKnowledge(gameData, ownerId, targetId) {
  const frame = frames.get(gameData) || evidenceByData.get(gameData);
  const selected = frame?.selectedIds || (gameData?.letterData ? new Set([Number(gameData.playerID), Number(gameData.aiID)]) : null);
  return !!(!endedData.has(gameData) && matches(frame, gameData) && normalizeGameDate(gameData.date) && Number.isFinite(Number(gameData.totalDays))
    && selected?.has(Number(ownerId)) && selected.has(Number(targetId))
    && hasCharacter(gameData, ownerId) && hasCharacter(gameData, targetId)
    && frame.specialPairs.has(`${Number(ownerId)}:${Number(targetId)}`));
}

function getSupernaturalPerception(observer, target, gameData, { activeParticipantIds = [], hiddenTraitKeys = [] } = {}) {
  const none = { level: "NONE", traitKeys: [] };
  const ownerId = Number(observer?.id), targetId = Number(target?.id);
  const frame = frames.get(gameData) || evidenceByData.get(gameData);
  if (endedData.has(gameData) || !validId(gameData?.playerID) || !gameData?.campaignToken || !normalizeGameDate(gameData?.date)
    || frame && !matches(frame, gameData) || gameData?.letterData || gameData?.scene === "letter"
    || ownerId === targetId || !activeParticipantIds.map(Number).includes(ownerId) || !activeParticipantIds.map(Number).includes(targetId)) return none;
  observer = gameData?.characters?.get(ownerId);
  target = gameData?.characters?.get(targetId);
  if (!observer || !target || [observer, target].some(person => {
    const life = resolveLifeStatus(person);
    return life.conflict || life.alive === false;
  })) return none;
  const own = new Set((observer.traits || []).filter(isSupernaturalIdentity).map(normalizeTraitKey));
  const hidden = new Set(hiddenTraitKeys);
  const other = (target.traits || []).filter(isSupernaturalIdentity).map(normalizeTraitKey);
  const species = getSupernaturalSpecies(other).filter(key => !hidden.has(`trait_${key}`));
  if (!own.size || !species.length) return none;
  const ownGroup = getSupernaturalGroup([...own]);
  const group = getSupernaturalGroup(other);
  const ownSpecies = getSupernaturalSpecies([...own]);
  const rival = ownSpecies.some(key => RIVAL_IDENTITIES.has(key));
  const pureDragon = [...own].some(key => PURE_DRAGON_IDENTITIES.has(key));
  const exact = species.filter(key => pureDragon || ownSpecies.includes(key) || rival && RIVAL_IDENTITIES.has(key)
    || PURE_DRAGON_IDENTITIES.has(key) || group === ownGroup && EXACT_GROUPS.has(group)
    || LEGEND_FAMILIES.some(family => family.has(key) && ownSpecies.some(id => family.has(id))));
  if (exact.length) return { level: "SPECIES", group, traitKeys: exact.map(key => `trait_${key}`) };
  return { level: "SUPERNATURAL", group, cue: `${PERCEPTION_LABELS[group]}：${SUPERNATURAL_PRESENCE_CUE}`, traitKeys: [] };
}

module.exports = { isSupernaturalIdentity, captureRecognitionEvidence, activateSocialRecognition, deactivateSocialRecognition,
  preserveSocialRecognition, getSocialRecognitionSource, hasSpecialRelationKnowledge, getSupernaturalPerception, SUPERNATURAL_PRESENCE_CUE };
