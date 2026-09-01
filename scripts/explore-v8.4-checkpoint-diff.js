const fs = require("fs");
const path = require("path");

const TARGET_IDS = ["121091", "96895", "96896", "140239", "33678786", "95304"];
const TARGET_DEFINITIONS = ["tangyin_yue_014", "nansong_yue_085", "han_12371", "licheng_xin_006"];

function entries(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
}

function scalar(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function idList(value) {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

function dateNumber(value) {
  const match = String(value || "").match(/^(-?\d+)\.(\d+)\.(\d+)$/);
  return match ? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]) : null;
}

function readHeader(savePath) {
  const fd = fs.openSync(savePath, "r");
  const buffer = Buffer.alloc(64);
  fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);
  if (buffer.toString("ascii", 0, 3) !== "SAV") throw new Error(`invalid_save_header:${savePath}`);
  const metaLength = parseInt(buffer.toString("ascii", 15, 23), 16);
  const newline = buffer.indexOf(10, 0, "ascii");
  if (newline < 0) throw new Error(`invalid_save_header_length:${savePath}`);
  return { headerLength: newline + 1, metaLength };
}

function summarizeRecord(id, record, bucket, gameDate) {
  const family = record?.family_data || {};
  const alive = record?.alive_data || {};
  const landed = record?.landed_data || {};
  const court = record?.court_data || {};
  const dead = record?.dead_data || {};
  const currentDate = dateNumber(gameDate);
  const birth = scalar(record?.birth) ?? null;
  const birthDate = dateNumber(birth);
  return {
    id: String(id),
    bucket,
    firstName: scalar(record?.first_name) ?? null,
    birth,
    age: currentDate !== null && birthDate !== null ? Math.floor((currentDate - birthDate) / 10000) : null,
    gender: record?.female === "yes" ? "female" : record?.female === "no" ? "male" : "male_inferred_from_missing_female",
    culture: scalar(record?.culture) ?? null,
    faith: scalar(record?.faith) ?? null,
    dynastyHouse: scalar(record?.dynasty_house) ?? null,
    spouse: scalar(family.spouse ?? family.primary_spouse) ?? null,
    parents: {
      father: scalar(family.real_father ?? family.father) ?? null,
      mother: scalar(family.real_mother ?? family.mother) ?? null
    },
    children: idList(family.child),
    domainTitles: idList(landed.domain),
    liege: scalar(landed.liege) ?? null,
    location: scalar(alive.location?.location) ?? null,
    employer: scalar(court.employer) ?? null,
    positions: idList(landed.court_positions ?? court.court_positions),
    alive: bucket === "living",
    death: dead.date ? { date: scalar(dead.date), cause: scalar(dead.reason) ?? null } : null,
    fields: Object.keys(record || {}).sort()
  };
}

function characterRecords(parsed) {
  return [
    ["living", parsed.living],
    ["dead_unprunable", parsed.deadUnprunable],
    ["dead_prunable", parsed.deadPrunable]
  ].flatMap(([bucket, map]) => entries(map).map(([id, record]) => ({ id: String(id), record, bucket })));
}

function historyEntries(history) {
  const rows = [];
  for (const [date, value] of entries(history)) {
    for (const event of Array.isArray(value) ? value : [value]) {
      if (!event || typeof event !== "object") continue;
      rows.push({
        date: String(date),
        type: scalar(event.type) ?? null,
        holder: scalar(event.holder) ?? null,
        fields: Object.keys(event).sort()
      });
    }
  }
  return rows.sort((a, b) => (dateNumber(a.date) || 0) - (dateNumber(b.date) || 0) || String(a.holder || "").localeCompare(String(b.holder || "")));
}

function summarizeTitle(id, record) {
  return {
    id: String(id),
    key: scalar(record?.key) ?? null,
    holder: scalar(record?.holder) ?? null,
    date: scalar(record?.date) ?? null,
    deFactoLiege: scalar(record?.de_facto_liege) ?? null,
    deJureLiege: scalar(record?.de_jure_liege) ?? null,
    history: historyEntries(record?.history),
    fields: Object.keys(record || {}).sort()
  };
}

function titleRecords(parsed) {
  return new Map(entries(parsed.titles).map(([id, record]) => [String(id), summarizeTitle(id, record)]));
}

function shallowValue(value) {
  const normalized = scalar(value);
  if (normalized === null || normalized === undefined || typeof normalized !== "object") return normalized ?? null;
  return Object.fromEntries(Object.keys(normalized).sort().slice(0, 16).map((key) => {
    const child = scalar(normalized[key]);
    return [key, child && typeof child === "object" ? (Array.isArray(normalized[key]) ? `[${normalized[key].length}]` : "{...}") : child ?? null];
  }));
}

function summarizeWar(id, record, names) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  return {
    id: String(id),
    name: scalar(record.name) ?? scalar(names?.[id]) ?? null,
    attacker: scalar(record.attacker) ?? null,
    defender: scalar(record.defender) ?? null,
    startDate: scalar(record.start_date) ?? null,
    reachedMaxScoreDate: scalar(record.reached_max_score_date) ?? null,
    casusBelli: shallowValue(record.casus_belli),
    battleResultCount: idList(record.battle_results).length,
    fields: Object.keys(record).sort()
  };
}

function activeWarRecords(parsed) {
  return new Map(entries(parsed.activeWars).map(([id, record]) => [String(id), summarizeWar(id, record, parsed.warNames)]).filter(([, record]) => record));
}

function parseSave(savePath, parser) {
  const header = readHeader(savePath);
  const full = fs.readFileSync(savePath);
  const body = full.subarray(header.headerLength + header.metaLength);
  const parsed = parser.parseText(body, { encoding: "utf8", typeNarrowing: "none" }, (query) => ({
    date: query.at("/date"),
    playthroughId: query.at("/playthrough_id"),
    played: query.at("/played_character"),
    living: query.at("/living"),
    deadUnprunable: query.at("/dead_unprunable"),
    deadPrunable: query.at("/characters/dead_prunable"),
    characterLookup: query.at("/character_lookup"),
    titles: query.at("/landed_titles/landed_titles"),
    activeWars: query.at("/wars/active_wars"),
    warNames: query.at("/wars/names")
  }));
  const records = characterRecords(parsed);
  const byId = new Map(records.map((entry) => [entry.id, summarizeRecord(entry.id, entry.record, entry.bucket, parsed.date)]));
  const playedCharacter = scalar(parsed.played?.character) ?? null;
  const player = byId.get(String(playedCharacter || ""));
  return {
    file: path.basename(savePath),
    gameDate: scalar(parsed.date) ?? null,
    playthroughId: scalar(parsed.playthroughId) ?? null,
    playedCharacter,
    counts: {
      living: entries(parsed.living).length,
      deadUnprunable: entries(parsed.deadUnprunable).length,
      deadPrunable: entries(parsed.deadPrunable).length,
      titles: entries(parsed.titles).length,
      activeWars: entries(parsed.activeWars).length
    },
    characterLookup: Object.fromEntries(TARGET_DEFINITIONS.map((key) => [key, scalar(parsed.characterLookup?.[key]) ?? null])),
    playerChildren: player?.children || [],
    byId,
    titlesById: titleRecords(parsed),
    activeWarsById: activeWarRecords(parsed),
    warNames: parsed.warNames || {},
    sourcePath: savePath
  };
}

function compareCharacters(s0, s1, ids) {
  return ids.map((id) => ({
    id,
    s0: s0.byId.get(id) || null,
    s1: s1.byId.get(id) || null,
    status: !s0.byId.has(id) ? "NEW_IN_S1" : !s1.byId.has(id) ? "MISSING_IN_S1" : s0.byId.get(id).bucket !== s1.byId.get(id).bucket ? "BUCKET_CHANGED" : "PRESENT_BOTH"
  }));
}

function diffTransitions(s0, s1) {
  const deaths = [];
  for (const [id, before] of s0.byId) {
    const after = s1.byId.get(id);
    if (before.alive && after && !after.alive) deaths.push({ id, s0: before, s1: after });
  }
  deaths.sort((a, b) => String(a.s1.death?.date || "").localeCompare(String(b.s1.death?.date || "")) || a.id.localeCompare(b.id));

  const births = [];
  for (const [id, after] of s1.byId) {
    if (!s0.byId.has(id)) births.push({ id, s1: after, isPlayerChild: s1.playerChildren.includes(id) });
  }
  births.sort((a, b) => (dateNumber(a.s1.birth) || Number.MAX_SAFE_INTEGER) - (dateNumber(b.s1.birth) || Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
  return {
    deaths: deaths.slice(0, 20),
    deathTransitionCount: deaths.length,
    newCharacters: births.slice(0, 20),
    newCharacterCount: births.length,
    newPlayerChildren: births.filter((entry) => entry.isPlayerChild).slice(0, 20)
  };
}

function titleRank(key) {
  if (!key) return 0;
  const prefix = String(key).slice(0, 2);
  return { e_: 5, k_: 4, d_: 3, c_: 2, b_: 1 }[prefix] || 0;
}

function compareTitle(s0, s1, id) {
  const before = s0.titlesById.get(id) || null;
  const after = s1.titlesById.get(id) || null;
  const s0Date = dateNumber(s0.gameDate);
  const s1Date = dateNumber(s1.gameDate);
  const holderHistory = after?.history.filter((entry) => entry.holder && (dateNumber(entry.date) || 0) > s0Date && (dateNumber(entry.date) || 0) <= s1Date) || [];
  const status = !before ? "NEW_TITLE_IN_S1" : !after ? "TITLE_MISSING_IN_S1" : before.holder === after.holder ? "UNCHANGED_HOLDER" : holderHistory.some((entry) => entry.holder === after.holder) ? "HOLDER_CHANGED_RECONSTRUCTABLE" : "HOLDER_CHANGED_CURRENT_ONLY";
  return { id, s0: before, s1: after, holderHistory, status };
}

function diffTitles(s0, s1) {
  const ids = [...new Set([...s0.titlesById.keys(), ...s1.titlesById.keys()])];
  const comparisons = ids.map((id) => compareTitle(s0, s1, id));
  const holderChanges = comparisons.filter((entry) => entry.status === "HOLDER_CHANGED_RECONSTRUCTABLE" || entry.status === "HOLDER_CHANGED_CURRENT_ONLY");
  const playerTitleIds = ids.filter((id) => s0.titlesById.get(id)?.holder === s0.playedCharacter || s1.titlesById.get(id)?.holder === s1.playedCharacter);
  const playerTitles = playerTitleIds.map((id) => compareTitle(s0, s1, id)).sort((a, b) => titleRank(b.s1?.key || b.s0?.key) - titleRank(a.s1?.key || a.s0?.key) || String(a.s1?.key || a.s0?.key).localeCompare(String(b.s1?.key || b.s0?.key))).slice(0, 5);
  const majorTitleIds = ids.filter((id) => /^(e_|k_)/.test(String(s0.titlesById.get(id)?.key || s1.titlesById.get(id)?.key || "")) && (s0.titlesById.get(id)?.holder || s1.titlesById.get(id)?.holder)).sort((a, b) => String(s0.titlesById.get(a)?.key || s1.titlesById.get(a)?.key).localeCompare(String(s0.titlesById.get(b)?.key || s1.titlesById.get(b)?.key)));
  return {
    holderChangeCount: holderChanges.length,
    reconstructableHolderChangeCount: holderChanges.filter((entry) => entry.status === "HOLDER_CHANGED_RECONSTRUCTABLE").length,
    currentOnlyHolderChangeCount: holderChanges.filter((entry) => entry.status === "HOLDER_CHANGED_CURRENT_ONLY").length,
    playerTitles,
    majorTitleSamples: majorTitleIds.slice(0, 5).map((id) => compareTitle(s0, s1, id)),
    holderChangeSamples: holderChanges.sort((a, b) => a.status.localeCompare(b.status) || String(a.s1?.key || a.s0?.key).localeCompare(String(b.s1?.key || b.s0?.key))).slice(0, 20)
  };
}

function numericTokenEvidence(filePath, ids) {
  const source = fs.readFileSync(filePath);
  const output = {};
  for (const id of ids) {
    const needle = Buffer.from(String(id), "ascii");
    const contexts = [];
    let offset = 0;
    while (contexts.length < 4) {
      const found = source.indexOf(needle, offset);
      if (found < 0) break;
      const before = found > 0 ? source[found - 1] : 0;
      const after = found + needle.length < source.length ? source[found + needle.length] : 0;
      if (!((before >= 48 && before <= 57) || (after >= 48 && after <= 57))) {
        contexts.push(source.subarray(Math.max(0, found - 72), Math.min(source.length, found + needle.length + 120)).toString("utf8").replace(/\s+/g, " "));
      }
      offset = found + needle.length;
    }
    output[id] = { found: contexts.length > 0, contexts };
  }
  return output;
}

function diffWars(s0, s1, s1RawEvidence) {
  const s0Ids = [...s0.activeWarsById.keys()];
  const s1Ids = [...s1.activeWarsById.keys()];
  const stillActive = s0Ids.filter((id) => s1.activeWarsById.has(id));
  const inactiveCandidates = s0Ids.filter((id) => !s1.activeWarsById.has(id));
  const newActive = s1Ids.filter((id) => !s0.activeWarsById.has(id));
  const endedCandidates = inactiveCandidates.map((id) => {
    const evidence = s1RawEvidence?.[id] || { found: false, contexts: [] };
    const hasNameEntry = Object.prototype.hasOwnProperty.call(s1.warNames, id);
    return {
      id,
      s0: s0.activeWarsById.get(id),
      s1RawEvidence: evidence,
      status: evidence.found || hasNameEntry ? "ENDED_WAR_PARTIAL" : "ENDED_WAR_NOT_RECONSTRUCTABLE",
      reason: "S1 lacks an active war object and exposes no validated end_date/result store."
    };
  });
  const newActiveRecords = newActive.map((id) => {
    const war = s1.activeWarsById.get(id);
    const startDate = dateNumber(war.startDate);
    const withinWindow = startDate !== null && startDate > dateNumber(s0.gameDate) && startDate <= dateNumber(s1.gameDate);
    return { id, s1: war, status: withinWindow ? "WAR_STARTED_CONFIRMED_BY_GAMESTATE" : "ACTIVE_IN_S1_ONLY" };
  });
  return {
    s0ActiveCount: s0Ids.length,
    s1ActiveCount: s1Ids.length,
    stillActiveCount: stillActive.length,
    endedCandidateCount: endedCandidates.length,
    endedPartialCount: endedCandidates.filter((entry) => entry.status === "ENDED_WAR_PARTIAL").length,
    endedNotReconstructableCount: endedCandidates.filter((entry) => entry.status === "ENDED_WAR_NOT_RECONSTRUCTABLE").length,
    newActiveCount: newActiveRecords.length,
    startedConfirmedCount: newActiveRecords.filter((entry) => entry.status === "WAR_STARTED_CONFIRMED_BY_GAMESTATE").length,
    stillActiveSamples: stillActive.slice(0, 10).map((id) => ({ id, s0: s0.activeWarsById.get(id), s1: s1.activeWarsById.get(id) })),
    endedCandidates: endedCandidates.slice(0, 20),
    newActive: newActiveRecords.slice(0, 20)
  };
}

async function main() {
  const [, , s0Path, s1Path, jominiPath, outputPath] = process.argv;
  if (!s0Path || !s1Path || !jominiPath || !outputPath) throw new Error("usage: node explore-v8.4-checkpoint-diff.js <s0.ck3> <s1.ck3> <jomini-entry.cjs> <output.json>");
  const { Jomini } = require(jominiPath);
  const parser = await Jomini.initialize();
  const s0 = parseSave(s0Path, parser);
  if (global.gc) global.gc();
  const s1 = parseSave(s1Path, parser);
  const titleComparison = diffTitles(s0, s1);
  const preliminaryWarComparison = diffWars(s0, s1);
  if (global.gc) global.gc();
  const s1RawWarEvidence = numericTokenEvidence(s1.sourcePath, preliminaryWarComparison.endedCandidates.map((entry) => entry.id));
  const warComparison = diffWars(s0, s1, s1RawWarEvidence);
  const ids = [...new Set([...TARGET_IDS, ...s0.playerChildren, ...s1.playerChildren])];
  const result = {
    generatedAt: new Date().toISOString(),
    scope: "V8.4 checkpoint reconciliation for Luna Test 4A/4C/4E/4F and Terra Test 4B/4D",
    checkpoints: {
      s0: { file: s0.file, gameDate: s0.gameDate, playthroughId: s0.playthroughId, playedCharacter: s0.playedCharacter, counts: s0.counts, characterLookup: s0.characterLookup },
      s1: { file: s1.file, gameDate: s1.gameDate, playthroughId: s1.playthroughId, playedCharacter: s1.playedCharacter, counts: s1.counts, characterLookup: s1.characterLookup }
    },
    stableCharacterComparison: compareCharacters(s0, s1, ids),
    transitions: diffTransitions(s0, s1),
    historicalFigureComparison: compareCharacters(s0, s1, ["96895", "96896", "140239"]),
    titleComparison,
    warComparison,
    interpretation: {
      samePlaythroughId: s0.playthroughId && s0.playthroughId === s1.playthroughId,
      samePlayedCharacter: s0.playedCharacter === s1.playedCharacter,
      titleReconciliation: titleComparison.currentOnlyHolderChangeCount === 0 ? "CONFIRMED_BY_GAMESTATE" : "PARTIAL",
      warReconciliation: warComparison.endedCandidateCount === 0 ? "CONFIRMED_BY_GAMESTATE" : warComparison.endedNotReconstructableCount > 0 ? "PROMOTED_TO_SUPPLEMENTAL" : "PARTIAL"
    }
  };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`V8.4 checkpoint diff: PASS (${s0.gameDate} -> ${s1.gameDate}, deaths=${result.transitions.deathTransitionCount}, new=${result.transitions.newCharacterCount})`);
  console.log(`Output: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
