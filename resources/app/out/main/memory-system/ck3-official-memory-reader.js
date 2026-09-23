"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");

function fieldText(value) {
  return value?.kind === "scalar" ? value.value : null;
}

function parseHolderMemoryIds(text, aliveData, { collectFields, readToken }) {
  const memories = collectFields(text, aliveData, ["memories"]).memories;
  if (!memories || memories.kind !== "block") return [];
  const ids = [];
  let cursor = memories.start;
  while (cursor < memories.end) {
    const token = readToken(text, cursor, memories.end);
    if (!token) break;
    if (/^\d+$/.test(token.value)) ids.push(token.value);
    cursor = token.next;
  }
  return [...new Set(ids)];
}

function parseVariableEntries(text, variables, { collectFields, readBlock, readToken }) {
  if (!variables || variables.kind !== "block") return [];
  const entries = [];
  const root = collectFields(text, variables, ["data"]).data;
  if (!root || root.kind !== "block") return entries;
  let cursor = root.start;
  while (cursor < root.end) {
    const token = readToken(text, cursor, root.end);
    if (!token) break;
    if (token.value !== "{") { cursor = token.next; continue; }
    const entry = readBlock(text, cursor, root.end);
    const fields = collectFields(text, entry, ["flag", "data"]);
    const value = collectFields(text, fields.data, ["type", "identity", "flag"]);
    const flag = fieldText(fields.flag);
    if (flag) entries.push({ flag, type: fieldText(value.type), identity: fieldText(value.identity), value: fieldText(value.flag) });
    cursor = entry.next;
  }
  return entries;
}

function parseOfficialMemoryDatabase(text, manager, characters, gameDate, parser) {
  const { collectFields, scanDirectEntries } = parser;
  const holderIds = new Map();
  for (const character of Object.values(characters || {})) {
    for (const memoryId of character.officialMemoryIds || []) {
      if (!holderIds.has(memoryId)) holderIds.set(memoryId, []);
      holderIds.get(memoryId).push(character.id);
    }
  }
  const database = Object.create(null);
  const root = collectFields(text, manager, ["database"]).database;
  if (!root || root.kind !== "block") return database;
  const today = normalizeGameDate(gameDate)?.serial;
  scanDirectEntries(text, root.start, root.end, (memoryId, record) => {
    if (!holderIds.has(memoryId) || record.kind !== "block") return;
    const fields = collectFields(text, record, ["type", "creation_date", "end_date", "participants", "variables"]);
    const type = fieldText(fields.type);
    const creationDate = fieldText(fields.creation_date);
    const endDate = fieldText(fields.end_date);
    if (!type || !normalizeGameDate(creationDate) || (today !== undefined && normalizeGameDate(endDate)?.serial < today)) return;
    const participants = Object.create(null);
    if (fields.participants?.kind === "block") scanDirectEntries(text, fields.participants.start, fields.participants.end, (role, value) => {
      if (value.kind === "scalar" && /^\d+$/.test(value.value)) participants[role] = value.value;
    });
    database[memoryId] = { memoryId, memoryType: type, creationDate, endDate, participants,
      variables: parseVariableEntries(text, fields.variables, parser), holderCharacterIds: holderIds.get(memoryId) };
  });
  return database;
}

module.exports = { parseHolderMemoryIds, parseOfficialMemoryDatabase };
