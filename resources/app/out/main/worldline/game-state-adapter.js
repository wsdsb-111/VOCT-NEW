"use strict";

const crypto = require("node:crypto");
const { normalizeGameDate } = require("./character-temporal-facts");

function skipIgnored(text, cursor, end) {
  let next = cursor;
  while (next < end) {
    const code = text.charCodeAt(next);
    if (code === 9 || code === 10 || code === 13 || code === 32) {
      next += 1;
      continue;
    }
    if (code === 35) {
      while (next < end && text.charCodeAt(next) !== 10) next += 1;
      continue;
    }
    break;
  }
  return next;
}

function readToken(text, cursor, end) {
  let next = skipIgnored(text, cursor, end);
  if (next >= end) return null;
  const first = text.charCodeAt(next);
  if (first === 34) {
    let value = "";
    next += 1;
    let escaped = false;
    while (next < end) {
      const code = text.charCodeAt(next);
      next += 1;
      if (escaped) {
        value += String.fromCharCode(code);
        escaped = false;
      } else if (code === 92) escaped = true;
      else if (code === 34) return { value, next };
      else value += String.fromCharCode(code);
    }
    throw new Error("jomini_unterminated_string");
  }
  if (first === 123 || first === 125 || first === 61) return { value: text[next++], next };
  const start = next;
  while (next < end) {
    const code = text.charCodeAt(next);
    if (code === 9 || code === 10 || code === 13 || code === 32 || code === 35 || code === 123 || code === 125 || code === 61) break;
    next += 1;
  }
  if (next === start) return { value: text[next++], next };
  return { value: text.slice(start, next), next };
}

function readBlock(text, cursor, end) {
  if (text[cursor] !== "{") throw new Error("jomini_block_expected");
  const start = cursor + 1;
  let next = start;
  let depth = 1;
  let quoted = false;
  let escaped = false;
  while (next < end) {
    const code = text.charCodeAt(next);
    if (quoted) {
      if (escaped) escaped = false;
      else if (code === 92) escaped = true;
      else if (code === 34) quoted = false;
    } else if (code === 34) quoted = true;
    else if (code === 35) {
      while (next < end && text.charCodeAt(next) !== 10) next += 1;
      continue;
    } else if (code === 123) depth += 1;
    else if (code === 125) {
      depth -= 1;
      if (depth === 0) return { kind: "block", start, end: next, next: next + 1 };
    }
    next += 1;
  }
  throw new Error("jomini_unterminated_block");
}

function readValue(text, cursor, end) {
  const next = skipIgnored(text, cursor, end);
  if (next >= end) throw new Error("jomini_value_expected");
  if (text[next] === "{") return readBlock(text, next, end);
  const token = readToken(text, next, end);
  if (!token || ["{", "}", "="].includes(token.value)) throw new Error("jomini_scalar_expected");
  return { kind: "scalar", value: token.value, next: token.next };
}

function scanDirectEntries(text, start, end, visit) {
  let cursor = start;
  while (cursor < end) {
    const token = readToken(text, cursor, end);
    if (!token) break;
    if (["{", "}", "="].includes(token.value)) {
      cursor = token.next;
      continue;
    }
    const equal = readToken(text, token.next, end);
    if (!equal || equal.value !== "=") {
      cursor = token.next;
      continue;
    }
    const value = readValue(text, equal.next, end);
    visit(token.value, value);
    cursor = value.next;
  }
}

function collectFields(text, range, names) {
  const wanted = names instanceof Set ? names : new Set(names);
  const fields = Object.create(null);
  if (!range) return fields;
  scanDirectEntries(text, range.start, range.end, (key, value) => {
    if (!wanted.has(key)) return;
    if (fields[key] === undefined) fields[key] = value;
    else fields[key] = Array.isArray(fields[key]) ? [...fields[key], value] : [fields[key], value];
  });
  return fields;
}

function firstField(value) {
  return Array.isArray(value) ? value[0] : value;
}

function scalar(value) {
  const selected = firstField(value);
  return selected?.kind === "scalar" ? selected.value : null;
}

function scalarList(text, value) {
  const selected = firstField(value);
  if (!selected) return [];
  if (selected.kind === "scalar") return [selected.value];
  const values = [];
  let cursor = selected.start;
  while (cursor < selected.end) {
    const token = readToken(text, cursor, selected.end);
    if (!token) break;
    if (!["{", "}", "="].includes(token.value)) values.push(token.value);
    cursor = token.next;
  }
  return values;
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function dateValue(value) {
  return normalizeGameDate(value)?.serial ?? null;
}

function parseHistory(text, value) {
  const selected = firstField(value);
  if (!selected || selected.kind !== "block") return [];
  const entries = [];
  scanDirectEntries(text, selected.start, selected.end, (date, entry) => {
    if (entry.kind !== "block" || dateValue(date) === null) return;
    const fields = collectFields(text, entry, ["holder", "type"]);
    entries.push({ date, holder: scalar(fields.holder), type: scalar(fields.type) });
  });
  return entries.sort((left, right) => (dateValue(left.date) || 0) - (dateValue(right.date) || 0));
}

function parseCharacter(text, id, bucket, record) {
  const fields = collectFields(text, record, ["first_name", "birth", "female", "culture", "faith", "dynasty_house", "family_data", "alive_data", "landed_data", "court_data", "dead_data", "traits"]);
  const family = firstField(fields.family_data);
  const alive = firstField(fields.alive_data);
  const landed = firstField(fields.landed_data);
  const court = firstField(fields.court_data);
  const dead = firstField(fields.dead_data);
  const familyFields = collectFields(text, family, ["spouse", "primary_spouse", "real_father", "father", "real_mother", "mother", "child"]);
  const aliveFields = collectFields(text, alive, ["location", "gold"]);
  const landedFields = collectFields(text, landed, ["domain", "liege", "court_positions"]);
  const courtFields = collectFields(text, court, ["employer", "court_positions"]);
  const deadFields = collectFields(text, dead, ["date", "death_date", "reason"]);
  const locationFields = collectFields(text, firstField(aliveFields.location), ["location"]);
  const goldFields = collectFields(text, firstField(aliveFields.gold), ["value"]);
  return {
    id: String(id),
    bucket,
    firstName: scalar(fields.first_name),
    birth: scalar(fields.birth),
    gender: scalar(fields.female) === "yes" ? "female" : scalar(fields.female) === "no" ? "male" : "unknown",
    culture: scalar(fields.culture),
    faith: scalar(fields.faith),
    dynastyHouse: scalar(fields.dynasty_house),
    spouse: scalar(familyFields.spouse) || scalar(familyFields.primary_spouse),
    parents: { father: scalar(familyFields.real_father) || scalar(familyFields.father), mother: scalar(familyFields.real_mother) || scalar(familyFields.mother) },
    children: scalarList(text, familyFields.child),
    domainTitles: scalarList(text, landedFields.domain),
    liege: scalar(landedFields.liege),
    courtEmployer: scalar(courtFields.employer),
    location: scalar(locationFields.location) || scalar(aliveFields.location),
    gold: scalar(goldFields.value) || scalar(aliveFields.gold),
    alive: bucket === "living",
    deathDate: scalar(deadFields.date) || scalar(deadFields.death_date),
    deathReason: scalar(deadFields.reason),
    traits: scalarList(text, fields.traits),
    positions: scalarList(text, landedFields.court_positions).concat(scalarList(text, courtFields.court_positions))
  };
}

function parseCharacterSection(text, value, bucket, characters, nameToCharacterIds) {
  const section = firstField(value);
  if (!section || section.kind !== "block") return;
  scanDirectEntries(text, section.start, section.end, (id, record) => {
    if (record.kind !== "block") return;
    const character = parseCharacter(text, id, bucket, record);
    characters[character.id] = character;
    const name = normalizeName(character.firstName);
    if (name) {
      if (!Object.hasOwn(nameToCharacterIds, name)) nameToCharacterIds[name] = [];
      nameToCharacterIds[name].push(character.id);
    }
  });
}

function parseLookup(text, value) {
  const section = firstField(value);
  const definitionToRuntime = Object.create(null);
  const runtimeToDefinitions = Object.create(null);
  if (!section || section.kind !== "block") return { definitionToRuntime, runtimeToDefinitions };
  scanDirectEntries(text, section.start, section.end, (definitionId, runtime) => {
    const runtimeId = scalar(runtime);
    if (!runtimeId) return;
    definitionToRuntime[definitionId] = runtimeId;
    if (!Object.hasOwn(runtimeToDefinitions, runtimeId)) runtimeToDefinitions[runtimeId] = [];
    runtimeToDefinitions[runtimeId].push(definitionId);
  });
  return { definitionToRuntime, runtimeToDefinitions };
}

function parseTitles(text, value) {
  const root = firstField(value);
  const nested = collectFields(text, root, ["landed_titles"]).landed_titles || root;
  const section = firstField(nested);
  const titles = Object.create(null);
  if (!section || section.kind !== "block") return titles;
  scanDirectEntries(text, section.start, section.end, (id, record) => {
    if (record.kind !== "block") return;
    const fields = collectFields(text, record, ["key", "holder", "date", "de_facto_liege", "de_jure_liege", "history", "title_name_data"]);
    const nameFields = collectFields(text, firstField(fields.title_name_data), ["name", "localization_key"]);
    titles[String(id)] = {
      id: String(id),
      key: scalar(fields.key),
      displayName: scalar(nameFields.name),
      localizationKey: scalar(nameFields.localization_key),
      holder: scalar(fields.holder),
      date: scalar(fields.date),
      deFactoLiege: scalar(fields.de_facto_liege),
      deJureLiege: scalar(fields.de_jure_liege),
      history: parseHistory(text, fields.history)
    };
  });
  return titles;
}

function parseParticipants(text, value, knownCharacterIds = new Set(), diagnostics = { rejectedNumericTokens: [], unknownRuntimeIds: [] }) {
  const selected = firstField(value);
  if (!selected || selected.kind !== "block") return [];
  const participants = new Set();
  const addExplicitRuntimeId = (candidate) => {
    const runtimeId = String(candidate || "");
    if (!/^\d+$/.test(runtimeId)) return;
    if (knownCharacterIds.has(runtimeId)) participants.add(runtimeId);
    else diagnostics.unknownRuntimeIds.push(runtimeId);
  };
  const inspect = (range, explicit = false) => {
    scanDirectEntries(text, range.start, range.end, (key, entry) => {
      if (key === "character" || key === "participant") {
        if (entry.kind === "scalar") addExplicitRuntimeId(entry.value);
        else inspect(entry, true);
        return;
      }
      if (key === "participants" && entry.kind === "block") {
        inspect(entry, true);
        return;
      }
      if (entry.kind === "scalar" && /^\d+$/.test(entry.value)) diagnostics.rejectedNumericTokens.push(entry.value);
    });
  };
  inspect(selected);
  return [...participants];
}

function parseWarActors(text, value, knownCharacterIds = new Set(), knownTitleIds = new Set(), diagnostics = { rejectedNumericTokens: [], unknownRuntimeIds: [], unresolvedActors: [] }) {
  const selected = firstField(value);
  if (!selected || selected.kind !== "block") return [];
  const actors = new Map();
  const add = (type, candidate, provenance) => {
    const value = String(candidate || "").trim();
    if (!value || value.length > 128 || !/^[a-zA-Z0-9_.-]+$/.test(value)) return;
    let actor;
    if (type === "CHARACTER" && knownCharacterIds.has(value)) actor = { type, runtimeId: value, provenance };
    else if (type === "TITLE" && knownTitleIds.has(value)) actor = { type, titleId: value, provenance };
    else if (type === "FACTION") actor = { type, factionId: value, provenance };
    else {
      actor = { type: "UNKNOWN", opaqueId: value, provenance };
      diagnostics.unresolvedActors?.push(`${provenance}:${value}`);
      if (type === "CHARACTER") diagnostics.unknownRuntimeIds.push(value);
    }
    actors.set(`${actor.type}:${actor.runtimeId || actor.titleId || actor.factionId || actor.opaqueId}`, actor);
  };
  const inspect = (range) => {
    scanDirectEntries(text, range.start, range.end, (key, entry) => {
      const normalizedKey = String(key || "").toLowerCase();
      const type = ["character", "participant"].includes(normalizedKey) ? "CHARACTER"
        : ["title", "landed_title"].includes(normalizedKey) ? "TITLE"
          : normalizedKey === "faction" ? "FACTION" : null;
      if (type) {
        if (entry.kind === "scalar") add(type, entry.value, `EXPLICIT_${normalizedKey.toUpperCase()}`);
        else inspect(entry);
        return;
      }
      if (["participants", "actors", "members"].includes(normalizedKey) && entry.kind === "block") inspect(entry);
      else if (entry.kind === "scalar" && /^\d+$/.test(entry.value)) diagnostics.rejectedNumericTokens.push(entry.value);
    });
  };
  inspect(selected);
  return [...actors.values()];
}

function parseWars(text, value, knownCharacterIds, diagnostics, knownTitleIds = new Set()) {
  const root = firstField(value);
  const section = firstField(collectFields(text, root, ["active_wars"]).active_wars);
  const wars = Object.create(null);
  if (!section || section.kind !== "block") return wars;
  scanDirectEntries(text, section.start, section.end, (id, record) => {
    if (record.kind !== "block") return;
    const fields = collectFields(text, record, ["start_date", "end_date", "attacker", "defender", "casus_belli", "name", "result"]);
    const attackerActors = parseWarActors(text, fields.attacker, knownCharacterIds, knownTitleIds, diagnostics);
    const defenderActors = parseWarActors(text, fields.defender, knownCharacterIds, knownTitleIds, diagnostics);
    wars[String(id)] = {
      id: String(id),
      startDate: scalar(fields.start_date),
      endDate: scalar(fields.end_date),
      attacker: attackerActors.filter(actor => actor.type === "CHARACTER").map(actor => actor.runtimeId),
      defender: defenderActors.filter(actor => actor.type === "CHARACTER").map(actor => actor.runtimeId),
      attackerActors,
      defenderActors,
      casusBelli: scalar(fields.casus_belli),
      name: scalar(fields.name),
      result: scalar(fields.result)
    };
  });
  return wars;
}

function fingerprint(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseGameState(gamestate) {
  const text = Buffer.isBuffer(gamestate) ? gamestate.toString("utf8") : String(gamestate || "");
  const root = { start: 0, end: text.length };
  const fields = collectFields(text, root, ["date", "playthrough_id", "played_character", "living", "dead_unprunable", "characters", "character_lookup", "landed_titles", "wars", "dynasties"]);
  const playedCharacterFields = collectFields(text, firstField(fields.played_character), ["character"]);
  const characters = Object.create(null);
  const nameToCharacterIds = Object.create(null);
  parseCharacterSection(text, fields.living, "living", characters, nameToCharacterIds);
  parseCharacterSection(text, fields.dead_unprunable, "dead_unprunable", characters, nameToCharacterIds);
  const charactersRoot = firstField(fields.characters);
  parseCharacterSection(text, collectFields(text, charactersRoot, ["dead_prunable"]).dead_prunable, "dead_prunable", characters, nameToCharacterIds);
  const lookup = parseLookup(text, fields.character_lookup);
  const dynastyHouses = Object.create(null);
  const houseSection = firstField(collectFields(text, firstField(fields.dynasties), ["dynasty_house"]).dynasty_house);
  if (houseSection?.kind === "block") scanDirectEntries(text, houseSection.start, houseSection.end, (id, record) => {
    if (record.kind !== "block") return;
    const names = collectFields(text, record, ["name", "localized_name"]);
    dynastyHouses[String(id)] = { name: scalar(names.name), localizedName: scalar(names.localized_name) };
  });
  const titles = parseTitles(text, fields.landed_titles);
  const warParticipantDiagnostics = { rejectedNumericTokens: [], unknownRuntimeIds: [], unresolvedActors: [] };
  const wars = parseWars(text, fields.wars, new Set(Object.keys(characters)), warParticipantDiagnostics, new Set(Object.keys(titles)));
  return {
    schemaVersion: 1,
    gameDate: scalar(fields.date),
    playthroughId: scalar(fields.playthrough_id),
    playerId: scalar(playedCharacterFields.character) || scalar(fields.played_character),
    contentFingerprint: fingerprint(Buffer.isBuffer(gamestate) ? gamestate : Buffer.from(text, "utf8")),
    characters,
    nameToCharacterIds,
    dynastyHouses,
    definitionToRuntime: lookup.definitionToRuntime,
    runtimeToDefinitions: lookup.runtimeToDefinitions,
    titles,
    wars,
    diagnostics: {
      characterCount: Object.keys(characters).length,
      titleCount: Object.keys(titles).length,
      activeWarCount: Object.keys(wars).length,
      warParticipantRejectedNumericTokens: [...new Set(warParticipantDiagnostics.rejectedNumericTokens)],
      warParticipantUnknownRuntimeIds: [...new Set(warParticipantDiagnostics.unknownRuntimeIds)],
      warParticipantUnresolvedActors: [...new Set(warParticipantDiagnostics.unresolvedActors)],
      missingFields: [scalar(fields.date) ? null : "date", scalar(fields.played_character) || scalar(playedCharacterFields.character) ? null : "played_character"].filter(Boolean),
      parseWarnings: []
    }
  };
}

module.exports = {
  collectFields,
  dateValue,
  parseParticipants,
  parseWarActors,
  parseGameState,
  parseHistory,
  parseWars,
  readBlock,
  readToken,
  scanDirectEntries
};
