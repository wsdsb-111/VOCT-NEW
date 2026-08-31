const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const KIND_NAMES = [
  "TEXT_UNCOMPRESSED",
  "BINARY_UNCOMPRESSED",
  "UNIFIED_TEXT_ZIP",
  "UNIFIED_BINARY_ZIP",
  "SPLIT_TEXT_ZIP",
  "SPLIT_BINARY_ZIP"
];

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function memory() {
  const usage = process.memoryUsage();
  return {
    rssMb: Math.round(usage.rss / 1024 / 1024),
    heapMb: Math.round(usage.heapUsed / 1024 / 1024)
  };
}

function parseHeader(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 0, 3) !== "SAV") throw new Error("invalid_save_header");
  const version = parseInt(buffer.toString("ascii", 3, 5), 16);
  const kind = parseInt(buffer.toString("ascii", 5, 7), 16);
  const metaLength = parseInt(buffer.toString("ascii", 15, 23), 16);
  const newline = buffer.indexOf(10, 0, "ascii");
  if (newline < 0 || (newline !== 23 && newline !== 31)) throw new Error("invalid_save_header_length");
  return {
    version,
    kind,
    kindName: KIND_NAMES[kind] || "UNKNOWN",
    random: buffer.subarray(7, 15).toString("hex"),
    metaLength,
    headerLength: newline + 1
  };
}

function readHeader(savePath) {
  const fd = fs.openSync(savePath, "r");
  const buffer = Buffer.alloc(64);
  fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);
  return parseHeader(buffer);
}

function readRange(savePath, start, length) {
  const fd = fs.openSync(savePath, "r");
  const buffer = Buffer.alloc(length);
  const read = fs.readSync(fd, buffer, 0, length, start);
  fs.closeSync(fd);
  return buffer.subarray(0, read);
}

function readMetadata(savePath, header) {
  return readRange(savePath, header.headerLength, header.metaLength).toString("utf8");
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] : null;
}

function countTopLevelSections(body) {
  const sections = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let lineStart = true;
  for (let i = 0; i < body.length; i += 1) {
    const byte = body[i];
    if (lineStart) {
      let cursor = i;
      while (cursor < body.length && (body[cursor] === 9 || body[cursor] === 32 || body[cursor] === 13)) cursor += 1;
      if (depth === 0 && cursor < body.length && body[cursor] !== 35) {
        const keyStart = cursor;
        while (cursor < body.length && body[cursor] !== 61 && body[cursor] !== 10 && body[cursor] !== 13 && body[cursor] !== 32 && body[cursor] !== 9) cursor += 1;
        if (body[cursor] === 61 && cursor > keyStart) sections.push({ name: body.toString("utf8", keyStart, cursor), byteOffset: keyStart });
      }
      lineStart = false;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (byte === 92) escaped = true;
      else if (byte === 34) quoted = false;
    } else if (byte === 34) quoted = true;
    else if (byte === 123) depth += 1;
    else if (byte === 125) depth = Math.max(0, depth - 1);
    if (byte === 10) lineStart = true;
  }
  return sections.map((section, index) => ({
    ...section,
    occurrence: index + 1,
    approxBytes: (sections[index + 1]?.byteOffset || body.length) - section.byteOffset
  }));
}

function scanTopLevelStream(savePath, start) {
  return new Promise((resolve, reject) => {
    const sections = [];
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let lineStart = true;
    let lineKey = "";
    let lineKeyActive = false;
    let absoluteOffset = start;
    const stream = fs.createReadStream(savePath, { start, highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => {
      for (const byte of chunk) {
        if (lineStart) {
          if (byte === 9 || byte === 32 || byte === 13) {
            absoluteOffset += 1;
            continue;
          }
          lineStart = false;
          lineKey = "";
          lineKeyActive = depth === 0 && byte !== 35;
        }
        if (lineKeyActive && byte !== 61 && byte !== 9 && byte !== 13 && byte !== 32 && byte !== 10) lineKey += String.fromCharCode(byte);
        else if (lineKeyActive && byte === 61) {
          sections.push({ name: lineKey, byteOffset: absoluteOffset - lineKey.length });
          lineKeyActive = false;
        } else if (lineKeyActive && (byte === 9 || byte === 13 || byte === 32 || byte === 10)) lineKeyActive = false;
        if (quoted) {
          if (escaped) escaped = false;
          else if (byte === 92) escaped = true;
          else if (byte === 34) quoted = false;
        } else if (byte === 34) quoted = true;
        else if (byte === 123) depth += 1;
        else if (byte === 125) depth = Math.max(0, depth - 1);
        if (byte === 10) lineStart = true;
        absoluteOffset += 1;
      }
    });
    stream.on("error", reject);
    stream.on("end", () => resolve({ bytes: absoluteOffset - start, sections }));
  });
}

function collectStream(savePath, start) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = fs.createReadStream(savePath, { start, highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function copyRange(savePath, outputPath, start) {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(savePath, { start, highWaterMark: 1024 * 1024 });
    const output = fs.createWriteStream(outputPath);
    input.on("error", reject);
    output.on("error", reject);
    output.on("close", resolve);
    input.pipe(output);
  });
}

function entries(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function dateNumber(value) {
  const match = String(value || "").match(/^(-?\d+)\.(\d+)\.(\d+)$/);
  return match ? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]) : null;
}

function summarizeCharacter(id, record, bucket, gameDate) {
  const family = record?.family_data || {};
  const alive = record?.alive_data || {};
  const landed = record?.landed_data || {};
  const court = record?.court_data || {};
  const dead = record?.dead_data || {};
  const birth = record?.birth || null;
  const currentDate = dateNumber(gameDate);
  const birthDate = dateNumber(birth);
  const age = currentDate !== null && birthDate !== null ? Math.floor((currentDate - birthDate) / 10000) : null;
  return {
    id: String(id),
    bucket,
    firstName: record?.first_name ?? null,
    birth,
    age,
    gender: record?.female === "yes" ? "female" : record?.female === "no" ? "male" : "male_inferred_from_missing_female",
    culture: record?.culture ?? null,
    faith: record?.faith ?? null,
    dynastyHouse: record?.dynasty_house ?? null,
    spouse: family.spouse ?? family.primary_spouse ?? null,
    parents: { father: family.real_father ?? family.father ?? null, mother: family.real_mother ?? family.mother ?? null },
    children: family.child ?? [],
    domainTitles: landed.domain ?? [],
    liege: landed.liege ?? null,
    court: Object.keys(court).length ? { keys: Object.keys(court), employer: court.employer ?? null } : null,
    location: alive.location?.location ?? null,
    gold: alive.gold?.value ?? null,
    alive: bucket === "living",
    death: dead.date ? { date: dead.date, cause: dead.reason ?? null } : null,
    traits: record?.traits ?? [],
    positions: landed.court_positions ?? court.court_positions ?? null,
    fields: Object.keys(record || {})
  };
}

function characterRecords(parsed) {
  return [
    ["living", parsed.living],
    ["dead_unprunable", parsed.deadUnprunable],
    ["dead_prunable", parsed.deadPrunable]
  ].flatMap(([bucket, map]) => entries(map).map(([id, record]) => ({ id, bucket, record })));
}

function chooseCharacterSamples(parsed, gameDate) {
  const records = characterRecords(parsed);
  const byId = new Map(records.map((entry) => [String(entry.id), entry]));
  const playerId = String(parsed.played?.character || "");
  const player = byId.get(playerId);
  const yuefei = records.filter((entry) => entry.record?.first_name === "Yuefei_name").map((entry) => summarizeCharacter(entry.id, entry.record, entry.bucket, gameDate));
  const xinqijiEntry = byId.get("140239");
  const childId = firstValue(player?.record?.family_data?.child);
  const randomNpc = records.find((entry) => entry.bucket === "living" && String(entry.id) !== playerId && !entry.record?.dynasty_house && !entry.record?.playable_data);
  const dead = records.find((entry) => entry.bucket !== "living");
  return {
    player: player ? summarizeCharacter(player.id, player.record, player.bucket, gameDate) : null,
    xinQijiByObservedId: xinqijiEntry ? summarizeCharacter(xinqijiEntry.id, xinqijiEntry.record, xinqijiEntry.bucket, gameDate) : null,
    yuefeiAllSameSaveName: yuefei,
    playerChild: childId && byId.has(String(childId)) ? summarizeCharacter(childId, byId.get(String(childId)).record, byId.get(String(childId)).bucket, gameDate) : { id: childId || null, status: "NOT_FOUND" },
    randomNpc: randomNpc ? summarizeCharacter(randomNpc.id, randomNpc.record, randomNpc.bucket, gameDate) : null,
    deadCharacter: dead ? summarizeCharacter(dead.id, dead.record, dead.bucket, gameDate) : null,
    counts: {
      living: entries(parsed.living).length,
      deadUnprunable: entries(parsed.deadUnprunable).length,
      deadPrunable: entries(parsed.deadPrunable).length
    }
  };
}

function buildIndexes(parsed) {
  const records = characterRecords(parsed);
  const characterById = new Map();
  const historicalIdToCharacterIds = new Map();
  const normalizedNameToCharacterIds = new Map();
  for (const entry of records) {
    const id = String(entry.id);
    const record = entry.record || {};
    characterById.set(id, {
      id,
      firstName: record.first_name ?? null,
      birth: record.birth ?? null,
      culture: record.culture ?? null,
      faith: record.faith ?? null,
      dynastyHouse: record.dynasty_house ?? null,
      alive: entry.bucket === "living",
      deathDate: record.dead_data?.date ?? null,
      deathReason: record.dead_data?.reason ?? null,
      domainTitles: record.landed_data?.domain ?? [],
      spouse: record.family_data?.spouse ?? record.family_data?.primary_spouse ?? null
    });
    for (const key of ["historical_id", "historicalId", "historical_character_id"]) {
      if (record[key] !== undefined) {
        const list = historicalIdToCharacterIds.get(String(record[key])) || [];
        list.push(id);
        historicalIdToCharacterIds.set(String(record[key]), list);
      }
    }
    const name = String(record.first_name || "").trim().toLowerCase();
    if (name) normalizedNameToCharacterIds.set(name, [...(normalizedNameToCharacterIds.get(name) || []), id]);
  }
  const titleById = new Map(entries(parsed.titles).map(([id, title]) => [String(id), {
    id: String(id), key: title.key ?? null, holder: title.holder ?? null, date: title.date ?? null,
    deFactoLiege: title.de_facto_liege ?? null, deJureLiege: title.de_jure_liege ?? null,
    history: title.history ?? null, name: title.title_name_data?.name ?? null
  }]));
  const titleHolderHistory = [...titleById.values()].filter((title) => title.history && Object.keys(title.history).length).length;
  const realmToRuler = new Map([...titleById.values()].filter((title) => title.holder && /^(e|k)_/.test(title.key || "")).map((title) => [title.key, title.holder]));
  const warById = new Map(entries(parsed.wars?.active_wars).filter(([, war]) => war && typeof war === "object").map(([id, war]) => [String(id), {
    id: String(id), startDate: war.start_date ?? null, endDate: war.end_date ?? null,
    attacker: war.attacker?.participants?.map((p) => p.character) || [], defender: war.defender?.participants?.map((p) => p.character) || [],
    casusBelli: war.casus_belli?.type ?? null, name: war.name ?? null, result: war.result ?? null
  }]));
  return {
    counts: {
      characterById: characterById.size,
      historicalIdToCharacterIds: historicalIdToCharacterIds.size,
      normalizedNameToCharacterIds: normalizedNameToCharacterIds.size,
      titleById: titleById.size,
      titleHolderHistory,
      realmToRuler: realmToRuler.size,
      warById: warById.size
    },
    jsonBytes: {
      normalizedRecords: Buffer.byteLength(JSON.stringify([...characterById.values()])),
      characterById: Buffer.byteLength(JSON.stringify(Object.fromEntries(characterById))),
      titleById: Buffer.byteLength(JSON.stringify(Object.fromEntries(titleById))),
      warById: Buffer.byteLength(JSON.stringify(Object.fromEntries(warById)))
    }
  };
}

function titleEvidence(parsed, gameDate, playerId) {
  const titles = entries(parsed.titles).filter(([, title]) => String(title.holder || "") === String(playerId));
  const sample = titles.find(([, title]) => title.history && Object.keys(title.history).length) || titles[0];
  if (!sample) return { status: "NOT_FOUND" };
  const [id, title] = sample;
  const history = entries(title.history).sort((a, b) => (dateNumber(a[0]) || 0) - (dateNumber(b[0]) || 0));
  const current = history.filter(([date]) => (dateNumber(date) || 0) <= (dateNumber(gameDate) || Number.MAX_SAFE_INTEGER)).at(-1);
  const previous = history.filter(([date]) => (dateNumber(date) || 0) <= (dateNumber(gameDate) || Number.MAX_SAFE_INTEGER)).at(-2);
  return {
    status: "CONFIRMED",
    titleId: String(id),
    key: title.key ?? null,
    directHolder: title.holder ?? null,
    historyEntries: history.length,
    currentHistoryEntry: current ? { date: current[0], value: current[1] } : null,
    previousHistoryEntry: previous ? { date: previous[0], value: previous[1] } : null,
    entryTypes: [...new Set(history.flatMap(([, value]) => (Array.isArray(value) ? value : [value]).filter((x) => x && typeof x === "object").map((x) => x.type).filter(Boolean)))]
  };
}

function warEvidence(parsed) {
  const wars = entries(parsed.wars?.active_wars);
  const objects = wars.filter(([, value]) => value && typeof value === "object");
  const fields = [...new Set(objects.flatMap(([, war]) => Object.keys(war)))].sort();
  return {
    activeEntries: wars.length,
    activeWarObjects: objects.length,
    fields,
    endedOrHistoryTopLevel: false,
    activeSample: objects.slice(0, 3).map(([id, war]) => ({ id, fields: Object.keys(war), startDate: war.start_date ?? null, endDate: war.end_date ?? null, casusBelli: war.casus_belli?.type ?? null }))
  };
}

function directCharacterFieldCounts(records) {
  const keys = ["historical_id", "historicalId", "historical_character_id", "first_name", "birth", "female", "culture", "faith", "dynasty_house", "family_data", "alive_data", "court_data", "landed_data", "dead_data", "traits"];
  return Object.fromEntries(keys.map((key) => [key, records.filter(({ record }) => record && record[key] !== undefined).length]));
}

function saveDirectorySnapshot(savePath) {
  const directory = path.dirname(savePath);
  const files = fs.readdirSync(directory).filter((name) => name.toLowerCase().endsWith(".ck3")).map((name) => {
    const candidate = path.join(directory, name);
    const stat = fs.statSync(candidate);
    try {
      const header = readHeader(candidate);
      const meta = readMetadata(candidate, header);
      return { name, size: stat.size, mtime: stat.mtime.toISOString(), header: header.kindName, metaDate: firstMatch(meta, /meta_date=([^\r\n]+)/), metaVersion: firstMatch(meta, /version="([^"]+)"/) };
    } catch (error) {
      return { name, size: stat.size, mtime: stat.mtime.toISOString(), header: "UNKNOWN", error: error.message };
    }
  }).sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime));
  return { count: files.length, newestByMtime: files[0] || null, files: files.slice(0, 20) };
}

function debugLogSnapshot(debugPath) {
  if (!debugPath || !fs.existsSync(debugPath)) return { status: "NOT_FOUND" };
  const stat = fs.statSync(debugPath);
  const text = fs.readFileSync(debugPath, "utf8");
  const targetLines = text.split(/\r?\n/).filter((line) => /140239|弃疾|辛/.test(line)).slice(-10).map((line) => line.replace(/\[[^\]]+\]\[I\]/, "[I]"));
  return { status: "CONFIRMED", size: stat.size, mtime: stat.mtime.toISOString(), liveGameDate: null, liveGameDateReason: "No CK3 game-date line was identified; wall-clock log timestamps are not game dates.", targetLines };
}

async function main() {
  const [, , savePath, jominiPath, outputPath, debugPath] = process.argv;
  if (!savePath || !jominiPath || !outputPath) throw new Error("usage: node explore-v8.4-gamestate.js <save.ck3> <jomini-entry.cjs> <output.json> [debug.log]");
  const started = nowMs();
  const stat = fs.statSync(savePath);
  const header = readHeader(savePath);
  const metadata = readMetadata(savePath, header);
  const bodyStart = header.headerLength + header.metaLength;
  const fullReadStart = nowMs();
  const full = fs.readFileSync(savePath);
  const fullReadMs = nowMs() - fullReadStart;
  const body = full.subarray(bodyStart);
  const zipSignature = full.indexOf(Buffer.from("PK\x03\x04")) >= 0 || full.indexOf(Buffer.from("PK\x05\x06")) >= 0;
  const container = {
    fileSize: stat.size,
    mtime: stat.mtime.toISOString(),
    header,
    metadata: {
      metaDate: firstMatch(metadata, /meta_date=([^\r\n]+)/),
      saveGameVersion: firstMatch(metadata, /save_game_version=([^\r\n]+)/),
      gameVersion: firstMatch(metadata, /version="([^"]+)"/),
      playerName: firstMatch(metadata, /meta_player_name="([^"]*)"/),
      titleName: firstMatch(metadata, /meta_title_name="([^"]*)"/),
      ironman: firstMatch(metadata, /ironman=([^\r\n]+)/)
    },
    bodyStart,
    bodySize: body.length,
    zipSignature,
    classification: header.kind === 0 && !zipSignature ? "PLAIN_TEXT_SAVE" : header.kind === 1 && !zipSignature ? "BINARY_CONTAINER" : zipSignature ? "COMPRESSED_ARCHIVE" : "UNKNOWN"
  };
  const sectionStart = nowMs();
  const sections = countTopLevelSections(body);
  const sectionScanMs = nowMs() - sectionStart;
  const streamStart = nowMs();
  const streamScan = await scanTopLevelStream(savePath, bodyStart);
  const streamScanMs = nowMs() - streamStart;
  const { Jomini } = require(jominiPath);
  const parser = await Jomini.initialize();
  const directParseStart = nowMs();
  const parsed = parser.parseText(body, { encoding: "utf8", typeNarrowing: "none" }, (query) => ({
    date: query.at("/date"), playthroughId: query.at("/playthrough_id"), played: query.at("/played_character"),
    living: query.at("/living"), deadUnprunable: query.at("/dead_unprunable"), deadPrunable: query.at("/characters/dead_prunable"),
    characterLookup: query.at("/character_lookup"), titles: query.at("/landed_titles/landed_titles"), wars: query.at("/wars"),
    provinces: query.at("/provinces"), dynasties: query.at("/dynasties"), units: query.at("/units")
  }));
  const directParseMs = nowMs() - directParseStart;
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v84-gamestate-"));
  const tempGamestate = path.join(tempDirectory, "gamestate");
  const tempExtractStart = nowMs();
  await copyRange(savePath, tempGamestate, bodyStart);
  const tempExtractMs = nowMs() - tempExtractStart;
  const tempBody = fs.readFileSync(tempGamestate);
  const tempParseStart = nowMs();
  parser.parseText(tempBody, { encoding: "utf8", typeNarrowing: "none" }, (query) => query.at("/date"));
  const tempParseMs = nowMs() - tempParseStart;
  const directStreamStart = nowMs();
  const directStreamBody = await collectStream(savePath, bodyStart);
  const directStreamMs = nowMs() - directStreamStart;
  const indexStart = nowMs();
  const indexes = buildIndexes(parsed);
  const indexBuildMs = nowMs() - indexStart;
  const records = characterRecords(parsed);
  const gameDate = parsed.date;
  const selectedCharacters = chooseCharacterSamples(parsed, gameDate);
  const title = titleEvidence(parsed, gameDate, parsed.played?.character);
  const rawHash = crypto.createHash("sha256").update(Buffer.concat([full.subarray(0, Math.min(full.length, 1024 * 1024)), full.subarray(Math.max(0, full.length - 1024 * 1024))])).digest("hex");
  const result = {
    generatedAt: new Date().toISOString(),
    sample: "autosave_1.ck3",
    container,
    topLevel: { sections, uniqueNames: [...new Set(sections.map((section) => section.name))], sectionScanMs, streamScanMs, streamBytes: streamScan.bytes },
    parse: {
      gameDate,
      gameDateType: Object.prototype.toString.call(gameDate),
      playthroughId: parsed.playthroughId,
      playedCharacter: parsed.played?.character ?? null,
      targetedParseMs: directParseMs,
      observedMemoryAfterParse: memory(),
      counts: {
        characterLookup: entries(parsed.characterLookup).length,
        provinces: entries(parsed.provinces).length,
        dynastiesTopLevel: Object.keys(parsed.dynasties || {}).length,
        units: entries(parsed.units).length,
        titles: entries(parsed.titles).length
      },
      characterFieldCounts: directCharacterFieldCounts(records),
      historicalIdValuesObserved: records.filter(({ record }) => ["historical_id", "historicalId", "historical_character_id"].some((key) => record?.[key] !== undefined)).slice(0, 20).map(({ id, record }) => ({ id, values: { historical_id: record.historical_id, historicalId: record.historicalId, historical_character_id: record.historical_character_id } }))
    },
    characters: selectedCharacters,
    title,
    wars: warEvidence(parsed),
    indexes,
    benchmark: {
      fullReadMs,
      fullReadBytes: full.length,
      directStreamReadMs: directStreamMs,
      directStreamBytes: directStreamBody.length,
      tempGamestateExtractMs: tempExtractMs,
      tempDiskBytes: fs.statSync(tempGamestate).size,
      tempGamestateParseMs: tempParseMs,
      incrementalScanMs: streamScanMs,
      targetedParseMs: directParseMs,
      indexBuildMs,
      totalMs: nowMs() - started,
      observedMemoryAfterIndex: memory(),
      note: "RSS/heap are process checkpoints, not OS-level peak samples; full parse object materialization was intentionally not used as a production design."
    },
    saveDirectory: saveDirectorySnapshot(savePath),
    identity: { contentHashFragment: rawHash, filePathIncluded: false, playthroughId: parsed.playthroughId, gameDate, playedCharacter: parsed.played?.character ?? null, branchId: null, branchStatus: "UNKNOWN_WITH_ONE_SAMPLE" },
    debugLog: debugLogSnapshot(debugPath),
    feasibility: {
      archiveEntryStream: zipSignature ? "TESTED" : "NOT_APPLICABLE_UNCOMPRESSED_SAMPLE",
      streamParser: "PARTIAL_TOP_LEVEL_SCANNER_ONLY",
      workerIsolation: "RECOMMENDED_FOR_FULL_PARSE_OOM_AND_MAIN_PROCESS_LATENCY",
      checkpointReconciliation: "UNKNOWN_WITH_ONE_SAMPLE",
      annualDeltaHooks: "SEE_REPORT_AND_MOD_SCRIPT_AUDIT"
    }
  };
  fs.unlinkSync(tempGamestate);
  fs.rmdirSync(tempDirectory);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`V8.4 gamestate exploration: PASS (${container.classification}, ${Math.round(container.fileSize / 1024 / 1024)} MB, ${sections.length} top-level occurrences)`);
  console.log(`Output: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
