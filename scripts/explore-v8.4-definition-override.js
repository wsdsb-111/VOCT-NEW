const fs = require("fs");
const path = require("path");

const PREFERRED_IDS = ["han_12371"];

function entries(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
}

function scalar(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) files.push(fullPath);
    }
  }
  return files.sort();
}

function stripComment(line) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "#") return line.slice(0, index);
  }
  return line;
}

function matchingBrace(text, braceStart) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let comment = false;
  for (let index = braceStart; index < text.length; index += 1) {
    const character = text[index];
    if (comment) {
      if (character === "\n") comment = false;
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === "#") {
      comment = true;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return text.length - 1;
}

function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) if (text[index] === "\n") starts.push(index + 1);
  return starts;
}

function lineNumber(starts, offset) {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return low + 1;
}

function firstField(block, field) {
  const match = block.match(new RegExp(`(?:^|[\\n{])\\s*${field}\\s*=\\s*(?:"([^"]*)"|([^\\s#\\r\\n{}]+))`, "m"));
  return match ? (match[1] ?? match[2]) : null;
}

function dateWithFlag(block, flag) {
  const match = block.match(new RegExp(`(?:^|[\\n{])\\s*(-?\\d+\\.\\d+\\.\\d+)\\s*=\\s*\\{[^{}]{0,240}\\b${flag}\\s*=\\s*yes\\b`, "i"));
  return match ? match[1] : null;
}

function extractDefinitions(filePath, source) {
  const text = fs.readFileSync(filePath, "utf8");
  const starts = lineStarts(text);
  const rows = [];
  for (let cursor = 0; cursor < text.length;) {
    if (text[cursor] === "#") {
      const newline = text.indexOf("\n", cursor);
      cursor = newline < 0 ? text.length : newline + 1;
      continue;
    }
    if (/\s/.test(text[cursor])) {
      cursor += 1;
      continue;
    }
    const tokenStart = cursor;
    while (cursor < text.length && !/[\s=]/.test(text[cursor])) cursor += 1;
    const definitionId = text.slice(tokenStart, cursor);
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    if (text[cursor] !== "=") {
      cursor = tokenStart + 1;
      continue;
    }
    cursor += 1;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    if (text[cursor] !== "{") {
      cursor = tokenStart + 1;
      continue;
    }
    const blockEnd = matchingBrace(text, cursor);
    const block = text.slice(tokenStart, blockEnd + 1);
    rows.push({
      definitionId,
      sourceType: source.sourceType,
      modId: source.modId,
      position: source.position,
      file: path.relative(source.root, filePath).replaceAll(path.sep, "/"),
      line: lineNumber(starts, tokenStart),
      name: firstField(block, "name"),
      birth: dateWithFlag(block, "birth"),
      culture: firstField(block, "culture"),
      religion: firstField(block, "religion"),
      dynasty: firstField(block, "dynasty"),
      dynastyHouse: firstField(block, "dynasty_house"),
      father: firstField(block, "father"),
      mother: firstField(block, "mother"),
      dna: firstField(block, "dna")
    });
    cursor = blockEnd + 1;
  }
  return rows;
}

function readHeader(savePath) {
  const descriptor = fs.openSync(savePath, "r");
  const header = Buffer.alloc(64);
  fs.readSync(descriptor, header, 0, header.length, 0);
  fs.closeSync(descriptor);
  const newline = header.indexOf(10);
  if (header.toString("ascii", 0, 3) !== "SAV" || newline < 0) throw new Error(`invalid_save_header:${savePath}`);
  return { headerLength: newline + 1, metaLength: parseInt(header.toString("ascii", 15, 23), 16) };
}

function summarizeRuntime(id, record, bucket) {
  if (!record || typeof record !== "object") return null;
  const family = record.family_data || {};
  return {
    id,
    bucket,
    firstName: scalar(record.first_name) ?? null,
    birth: scalar(record.birth) ?? null,
    culture: scalar(record.culture) ?? null,
    faith: scalar(record.faith) ?? null,
    dynastyHouse: scalar(record.dynasty_house) ?? null,
    father: scalar(family.real_father ?? family.father) ?? null,
    mother: scalar(family.real_mother ?? family.mother) ?? null,
    fields: Object.keys(record).sort()
  };
}

async function readSaveEvidence(savePath, jominiPath, candidateIds) {
  const header = readHeader(savePath);
  const full = fs.readFileSync(savePath);
  const body = full.subarray(header.headerLength + header.metaLength);
  const { Jomini } = require(jominiPath);
  const parser = await Jomini.initialize();
  const lookupResult = parser.parseText(body, { encoding: "utf8", typeNarrowing: "none" }, (query) => ({
    date: query.at("/date"),
    lookup: query.at("/character_lookup")
  }));
  const lookup = Object.fromEntries(entries(lookupResult.lookup).map(([key, value]) => [String(key), String(scalar(value))]));
  const selected = candidateIds.filter((id) => lookup[id]).map((id) => lookup[id]);
  const records = parser.parseText(body, { encoding: "utf8", typeNarrowing: "none" }, (query) => Object.fromEntries(selected.map((id) => [id, {
    living: query.at(`/living/${id}`),
    deadUnprunable: query.at(`/dead_unprunable/${id}`),
    deadPrunable: query.at(`/characters/dead_prunable/${id}`)
  }])));
  const runtimeById = Object.fromEntries(Object.entries(records).map(([id, value]) => {
    const living = scalar(value.living);
    const deadUnprunable = scalar(value.deadUnprunable);
    const deadPrunable = scalar(value.deadPrunable);
    return [id, summarizeRuntime(id, living || deadUnprunable || deadPrunable, living ? "living" : deadUnprunable ? "dead_unprunable" : deadPrunable ? "dead_prunable" : "not_found")];
  }));
  const faithIds = [...new Set(Object.values(runtimeById).map((runtime) => runtime?.faith).filter(Boolean))];
  const faithRecords = parser.parseText(body, { encoding: "utf8", typeNarrowing: "none" }, (query) => Object.fromEntries(faithIds.map((id) => [id, query.at(`/religion/faiths/${id}`)])));
  const faithById = Object.fromEntries(Object.entries(faithRecords).map(([id, record]) => [id, {
    id,
    key: scalar(record?.key) ?? null,
    religion: scalar(record?.religion) ?? null,
    fields: Object.keys(record || {}).sort()
  }]));
  return { gameDate: scalar(lookupResult.date) ?? null, lookup, runtimeById, faithById };
}

function sourceSignature(row) {
  return [row.name, row.birth, row.culture, row.religion, row.dynasty, row.dynastyHouse, row.father, row.mother].map((value) => value || "").join("|");
}

function chooseCandidates(byId) {
  const duplicates = [...byId.entries()].filter(([, rows]) => rows.length > 1).map(([definitionId, rows]) => ({ definitionId, rows }));
  const candidates = duplicates.filter((candidate) => new Set(candidate.rows.map(sourceSignature)).size > 1);
  const preferred = PREFERRED_IDS.map((id) => duplicates.find((candidate) => candidate.definitionId === id)).filter(Boolean);
  const remaining = candidates.filter((candidate) => !PREFERRED_IDS.includes(candidate.definitionId)).sort((a, b) => a.definitionId.localeCompare(b.definitionId));
  return [...preferred, ...remaining].slice(0, 5);
}

function matchSource(row, runtime, lookup) {
  const signals = [];
  if (row.name && row.name === runtime.firstName) signals.push("name");
  if (row.birth && row.birth === runtime.birth) signals.push("birth");
  if (row.father && lookup[row.father] && lookup[row.father] === runtime.father) signals.push("father_lookup");
  if (row.mother && lookup[row.mother] && lookup[row.mother] === runtime.mother) signals.push("mother_lookup");
  return { score: signals.length, signals };
}

async function main() {
  const [, , baseRoot, workshopRoot, savePath, jominiPath, outputPath, activeOrderCsv = ""] = process.argv;
  if (!baseRoot || !workshopRoot || !savePath || !jominiPath || !outputPath) throw new Error("usage: node explore-v8.4-definition-override.js <base-characters> <workshop-root> <save.ck3> <jomini-entry.cjs> <output.json> [active-mod-ids-in-launcher-order]");
  const activeOrder = activeOrderCsv.split(",").map((id) => id.trim()).filter(Boolean);
  const activePositions = new Map(activeOrder.map((id, index) => [id, index]));
  const sources = [{ root: baseRoot, sourceType: "base_game", modId: null, position: -1 }];
  for (const modId of activeOrder) {
    const root = path.join(workshopRoot, modId, "history", "characters");
    if (fs.existsSync(root)) sources.push({ root, sourceType: "workshop", modId, position: activePositions.get(modId) });
  }
  const rows = sources.flatMap((source) => listFiles(source.root).flatMap((filePath) => extractDefinitions(filePath, source)));
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.definitionId)) byId.set(row.definitionId, []);
    byId.get(row.definitionId).push(row);
  }
  const selected = chooseCandidates(byId);
  const saveEvidence = await readSaveEvidence(savePath, jominiPath, selected.map((candidate) => candidate.definitionId));
  const candidates = selected.map(({ definitionId, rows: sourceRows }) => {
    const runtimeId = saveEvidence.lookup[definitionId] || null;
    const runtime = runtimeId ? saveEvidence.runtimeById[runtimeId] : null;
    const sourcesWithMatch = sourceRows.map((row) => ({ ...row, match: runtime ? matchSource(row, runtime, saveEvidence.lookup) : { score: 0, signals: [] } }));
    const scores = sourcesWithMatch.map((row) => row.match.score);
    const maxScore = Math.max(...scores, 0);
    const uniqueBest = maxScore > 0 && scores.filter((score) => score === maxScore).length === 1;
    return {
      definitionId,
      runtimeId,
      runtime,
      faith: runtime?.faith ? saveEvidence.faithById[runtime.faith] || null : null,
      sources: sourcesWithMatch,
      status: !runtimeId ? "CONFLICT" : uniqueBest ? "PARTIAL" : "CONFLICT",
      likelyWinner: uniqueBest ? sourcesWithMatch[scores.indexOf(maxScore)].modId || "base_game" : "NOT_ASSERTED",
      limitation: "Launcher position establishes active ordering metadata only. Without a controlled new-game/load test or CK3 resolver output, this audit does not claim LOAD_ORDER_CONFIRMED."
    };
  });
  const output = {
    generatedAt: new Date().toISOString(),
    scope: "Terra Test 6 read-only duplicate Definition ID and active-playset audit",
    save: { file: path.basename(savePath), gameDate: saveEvidence.gameDate },
    activePlayset: { activeModCount: activeOrder.length, historyCharacterSourceCount: sources.length - 1, orderConvention: "position is the Launcher order supplied to this tool; it is evidence, not an assumed CK3 override rule." },
    candidates
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`V8.4 definition override audit: PASS (${candidates.length} duplicate IDs, ${sources.length - 1} active history sources)`);
  console.log(`Output: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
