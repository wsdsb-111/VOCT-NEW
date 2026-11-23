"use strict";

const { isSupernaturalIdentity, getSupernaturalGroup, getSupernaturalSpecies, normalizeTraitKey } = require("./trait-visibility-policy");
const { normalizeGameDate, resolveLifeStatus } = require("../worldline/character-temporal-facts");

const REASONS = new Set(["OWN_COURT_LORD", "HIGH_LIEGE", "NEIGHBORING_SOVEREIGN", "BORDERING_RULERS"]);
const REALM_RELATIONS = new Set(["COURT_LORD", "LIEGE", "SOVEREIGN", "DIRECT_VASSAL"]);
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

function realmLabel(value) {
  const text = String(value ?? "").trim();
  return text && text.length <= 180 && !/[\[\]\u0000-\u001f\u007f]|hanfan_|^(?:concept_none|none|undefined|null)$/i.test(text) ? text : "";
}

function captureRealmIdentities(gameData, identities, eras) {
  const byOwner = new Map();
  if (!gameData.campaignToken || !normalizeGameDate(gameData.date) || !Number.isSafeInteger(gameData.totalDays)) return byOwner;
  const matchesFrame = (owner, target, player, day) => validId(owner) && validId(target) && hasCharacter(gameData, owner)
    && Number(player) === Number(gameData.playerID) && /^\d+$/.test(day) && Number(day) === gameData.totalDays;
  for (const [owner, target, player, day, relation, rawName, rawTitle, rawRank] of identities) {
    if (!matchesFrame(owner, target, player, day) || !REALM_RELATIONS.has(relation)
      || (Number(owner) === Number(target) && relation !== "SOVEREIGN")) continue;
    const [name, title, rank] = [rawName, rawTitle, rawRank].map(realmLabel);
    if (!name || !title) continue;
    const ownerId = Number(owner), targetId = Number(target);
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, new Map());
    const byTarget = byOwner.get(ownerId);
    const previous = byTarget.get(targetId);
    if (previous === null) continue;
    if (previous && (previous.name !== name || previous.title !== title || previous.rank !== rank
      || (previous.relations.has("DIRECT_VASSAL") !== (relation === "DIRECT_VASSAL")))) {
      byTarget.set(targetId, null);
      continue;
    }
    if (previous) previous.relations.add(relation);
    else byTarget.set(targetId, { targetId, name, title, rank, relations: new Set([relation]) });
  }
  for (const [owner, target, player, day, rawName, rawYear] of eras) {
    if (!matchesFrame(owner, target, player, day)) continue;
    const row = byOwner.get(Number(owner))?.get(Number(target));
    const eraName = realmLabel(rawName), eraYear = realmLabel(rawYear);
    if (!row?.relations.has("SOVEREIGN") || !eraName) continue;
    if (row.era && (row.era.name !== eraName || row.era.year !== eraYear)) row.era = false;
    else if (row.era === undefined) row.era = { name: eraName, year: eraYear };
  }
  return byOwner;
}

function captureRecognitionEvidence(gameData, rows, realmIdentities = [], reignEras = []) {
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
    date: gameData.date, totalDays: gameData.totalDays, pairs, specialPairs,
    realmIdentities: captureRealmIdentities(gameData, realmIdentities, reignEras) });
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
  const fresh = evidenceByData.get(nextData);
  // Action readbacks preserve the opening snapshot; they cannot refresh politics
  // or move the old controlled character's knowledge to a new player character.
  frames.delete(nextData);
  evidenceByData.delete(nextData);
  if (endedData.has(previousData)) { endedData.add(nextData); return; }
  if (!matches(previous, nextData)) return;
  const realmIdentities = new Map(previous.realmIdentities);
  if (matches(fresh, nextData)) {
    for (const [ownerId, rows] of realmIdentities) {
      const observed = fresh.realmIdentities.get(ownerId);
      if (!observed) continue;
      if (rows.size !== observed.size || [...rows].some(([targetId, row]) => {
        const current = observed.get(targetId);
        return row && current ? row.name !== current.name || row.title !== current.title || row.rank !== current.rank
          || row.relations.size !== current.relations.size || [...row.relations].some(relation => !current.relations.has(relation))
          || row.era?.name !== current.era?.name || row.era?.year !== current.era?.year : row !== current;
      })) realmIdentities.delete(ownerId);
    }
  }
  const frame = { ...previous, realmIdentities };
  frames.set(nextData, frame);
  evidenceByData.set(nextData, frame);
}

function getSocialRecognitionSource(gameData, ownerId, targetId) {
  const frame = frames.get(gameData);
  if (endedData.has(gameData) || !matches(frame, gameData) || !frame.selectedIds.has(Number(ownerId)) || !frame.selectedIds.has(Number(targetId))
    || !hasCharacter(gameData, ownerId) || !hasCharacter(gameData, targetId)) return null;
  return frame.pairs.get(`${Number(ownerId)}:${Number(targetId)}`) || null;
}

function getPublicRealmIdentities(gameData, ownerId) {
  const frame = frames.get(gameData);
  if (endedData.has(gameData) || !matches(frame, gameData) || !frame.selectedIds.has(Number(ownerId))
    || !hasCharacter(gameData, ownerId) || frame.totalDays !== gameData.totalDays
    || normalizeGameDate(frame.date)?.serial !== normalizeGameDate(gameData.date)?.serial) return [];
  const rows = [...(frame.realmIdentities.get(Number(ownerId))?.values() || [])].filter(Boolean);
  const uniqueSovereign = rows.filter(row => row.relations.has("SOVEREIGN")).length === 1;
  return rows.filter(row => uniqueSovereign || !row.relations.has("SOVEREIGN")).map(row => ({
    ...row, relations: [...row.relations], era: row.era ? { ...row.era } : null
  }));
}

function hasPublicRealmIdentity(gameData, ownerId, targetId) {
  return getPublicRealmIdentities(gameData, ownerId).some(row => row.targetId === Number(targetId));
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
  getPublicRealmIdentities, hasPublicRealmIdentity,
  preserveSocialRecognition, getSocialRecognitionSource, hasSpecialRelationKnowledge, getSupernaturalPerception, SUPERNATURAL_PRESENCE_CUE };
