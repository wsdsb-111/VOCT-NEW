"use strict";

function cleanText(value) {
  return String(value ?? "").replace(/<[^>]*>/g, "").trim();
}

function sanitizeStorageName(value) {
  return cleanText(value).replace(/[<>:"/\\|?*]/g, "_").trim();
}

function getCharacterPersonalName(character = {}, fallbackName = "") {
  const firstName = cleanText(character.firstName);
  if (firstName && !/^none$/i.test(firstName)) return firstName;
  let name = cleanText(character.shortName || fallbackName || character.fullName);
  name = name.replace(/『[^』]*』?/g, "").trim();
  const parts = name.replace(/[,，、]/g, " ").split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "unknown";
}

function getCharacterStorageDirectoryName(character = {}, fallbackName = "") {
  const id = Number(character.id);
  if (!Number.isFinite(id)) throw new Error("character_id_required");
  return `${id}_${sanitizeStorageName(getCharacterPersonalName(character, fallbackName)) || "unknown"}`;
}

function getCharacterMentionAliases(character = {}) {
  const aliases = new Set();
  const add = (value) => {
    const text = cleanText(value);
    if (text.length >= 2 && !/^none(?:\s|$)/i.test(text) && !/^concept_/i.test(text)) aliases.add(text);
  };
  for (const value of [character.firstName, character.shortName, character.fullName, character.name, character.primaryTitle, character.nickname, ...(character.mentionAliases || [])]) add(value);
  for (const value of [character.shortName, character.fullName]) {
    const text = cleanText(value);
    const titlePrefix = text.split(/[,，、]/)[0]?.trim();
    if (titlePrefix && titlePrefix !== text) add(titlePrefix);
    for (const match of text.matchAll(/『([^』]+)』/g)) add(match[1]);
  }
  const positions = cleanText(character.heldCourtAndCouncilPositions || character.courtPosition);
  for (const position of positions.split(/[,，、;；\n]/)) add(position);

  const titleText = [character.primaryTitle, character.shortName, character.fullName, character.titleRankConcept]
    .map(cleanText).join(" ").toLowerCase();
  if (character.allowDerivedHonorifics !== false && /皇帝|天子|帝国|emperor|kaiser|basileus|imperator|concept_emperor/.test(titleText)) {
    for (const alias of ["陛下", "皇帝", "天子"]) add(alias);
  }
  if (character.allowDerivedHonorifics !== false && /皇后|empress/.test(titleText)) {
    for (const alias of ["陛下", "皇后"]) add(alias);
  }
  if (character.allowDerivedHonorifics !== false && /国王|女王|王国|\bking\b|\bqueen\b|concept_kingdom/.test(titleText)) add("陛下");
  if (character.allowDerivedHonorifics !== false && /太子|王子|公主|亲王|prince|princess/.test(titleText)) add("殿下");
  return [...aliases];
}

module.exports = {
  getCharacterPersonalName,
  getCharacterStorageDirectoryName,
  getCharacterMentionAliases,
  sanitizeStorageName
};
