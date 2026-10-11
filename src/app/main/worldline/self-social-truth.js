"use strict";

const { normalizeSpouseRecords } = require("./canonical-spouse-record");
const SOCIAL_FIELDS = new Set(["SPOUSE", "FRIEND", "LIEGE", "COURT_EMPLOYER", "PRIMARY_TITLE", "CURRENT_TITLE"]);

function buildSelfSocialTruth(snapshot, responderId, gameData) {
  const characters = gameData?.characters;
  const lookup = id => characters instanceof Map ? characters.get(Number(id)) || characters.get(String(id)) : characters?.[String(id)];
  const character = lookup(responderId);
  if (!character) return [];
  const name = value => {
    const id = value && typeof value === "object" ? value.id ?? value.characterId : value;
    const related = lookup(id) || snapshot?.characters?.[String(id)];
    return related?.shortName || related?.firstName || (value && typeof value === "object" ? value.name || value.shortName || value.fullName : String(value ?? ""));
  };
  const facts = [];
  const add = (field, label, value) => {
    if (value === undefined || value === null) return;
    facts.push({ factId: `self-runtime:${responderId}:${field}`, entityId: String(responderId), field, value: `${label}：${value || "无（本轮游戏资料）"}`, sourceTier: "GAME_TRUTH", knowledgeLevel: "SELF", selfKnowledgeVerified: true, verificationMode: "LIVE_RUNTIME", temporalSafe: true, asOf: gameData.date || null });
  };
  if (["spouse", "spouses", "formerSpouses", "deceasedSpouses", "consort"].some(key => Object.hasOwn(character, key))) {
    const records = normalizeSpouseRecords(character);
    const former = new Set(records.filter(item => ["FORMER_SPOUSE", "DECEASED_SPOUSE"].includes(item.relationType)).map(item => String(item.runtimeId ?? item.name)));
    const spouses = records.filter(item => item.relationType === "CURRENT_SPOUSE" && !former.has(String(item.runtimeId ?? item.name)));
    // A legacy consort string is not proof of a current marriage.
    add("SPOUSE", "当前配偶", spouses.length ? spouses.map(item => item.name || name(item.runtimeId)).join("、") : Object.hasOwn(character, "spouses") || Object.hasOwn(character, "spouse") ? "" : "未确认，不得沿用旧存档关系");
  }
  if (Array.isArray(character.relationsToCharacters)) {
    const relations = [...character.relationsToCharacters, ...(gameData.playerID != null ? [{ id: gameData.playerID, relations: character.relationsToPlayer }] : [])];
    const friends = relations.filter(item => (item.relations || []).some(label => /^(friend|friends|best_friend|best friend|朋友|好友|挚友|至交)$/i.test(String(label).trim())));
    if (friends.length) add("FRIEND", "本轮已确认朋友", [...new Set(friends.map(item => name(item.id)))].join("、"));
  }
  add("LIEGE", "当前直属领主", character.liege == null ? null : name(character.liege));
  add("COURT_EMPLOYER", "当前所在宫廷", character.courtEmployer == null ? null : name(character.courtEmployer));
  add("PRIMARY_TITLE", "当前头衔", character.primaryTitle);
  return facts;
}

module.exports = { SOCIAL_FIELDS, buildSelfSocialTruth };
