const fs = require("fs");
const path = require("path");

const TARGET_PATTERN = /yue[_\s-]*fei|岳飞|岳飛|Yuefei_name|Fei_name11|xin[_\s-]*qiji|辛弃疾|辛棄疾|Qiji_name|Qiji[_\s-]|bookmark_dna_xin_qiji|licheng_xin_006|han_12371|nansong_yue_085|tangyin_yue_014/i;
const TARGET_DEFINITION_IDS = new Set([
  "nansong_yue_085",
  "tangyin_yue_014",
  "licheng_xin_006",
  "han_12371"
]);
const CONTROL_RUNTIME_IDS = ["95304", "33678786", "140239", "96895", "96896", "33579466", "16904564", "124155"];

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) output.push(fullPath);
    }
  }
  return output.sort();
}

function stripComment(line) {
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "#") return line.slice(0, i);
  }
  return line;
}

function braceDelta(line) {
  let delta = 0;
  let quoted = false;
  let escaped = false;
  const uncommented = stripComment(line);
  for (const ch of uncommented) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{") delta += 1;
    else if (ch === "}") delta -= 1;
  }
  return delta;
}

function firstField(block, field) {
  const match = block.match(new RegExp(`(?:^|[\\n{])\\s*${field}\\s*=\\s*(?:"([^"]*)"|([^\\s#\\r\\n{}]+))`, "m"));
  return match ? (match[1] ?? match[2]) : null;
}

function allFields(block, field) {
  const values = [];
  const pattern = new RegExp(`(?:^|[\\n{])\\s*${field}\\s*=\\s*(?:"([^"]*)"|([^\\s#\\r\\n{}]+))`, "gm");
  let match;
  while ((match = pattern.exec(block))) values.push(match[1] ?? match[2]);
  return [...new Set(values)];
}

function dateWithFlag(block, flag) {
  const match = block.match(/(?:^|[\n{])\s*(-?\d+\.\d+\.\d+)\s*=\s*\{[^{}]{0,240}\bbirth\s*=\s*yes\b/i);
  return match && flag === "birth" ? match[1] : null;
}

function matchingBrace(text, braceStart) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let comment = false;
  for (let i = braceStart; i < text.length; i += 1) {
    const ch = text[i];
    if (comment) {
      if (ch === "\n") comment = false;
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === "#") {
      comment = true;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}" && --depth === 0) return i;
  }
  return text.length - 1;
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineNumber(starts, offset) {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid;
  }
  return low + 1;
}

function extractDefinition(filePath, root, source) {
  const text = fs.readFileSync(filePath, "utf8");
  const starts = lineStarts(text);
  const blocks = [];
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
    const row = {
      definitionId,
      keyType: /^-?\d+$/.test(definitionId) ? "numeric" : "string",
        sourceType: source.sourceType,
        modId: source.modId,
        active: source.active,
        file: path.relative(root, filePath).replaceAll(path.sep, "/"),
        line: lineNumber(starts, tokenStart),
        bytes: Buffer.byteLength(block, "utf8"),
        name: firstField(block, "name"),
        dna: firstField(block, "dna"),
        dynasty: firstField(block, "dynasty"),
        dynastyHouse: firstField(block, "dynasty_house"),
        culture: firstField(block, "culture"),
        religion: firstField(block, "religion"),
        father: firstField(block, "father"),
        mother: firstField(block, "mother"),
        birth: dateWithFlag(block, "birth"),
        references: {
          spouses: allFields(block, "spouse"),
          employers: allFields(block, "employer"),
          titles: allFields(block, "title"),
          traits: allFields(block, "trait")
        },
        targetHit: TARGET_PATTERN.test(block)
    };
    if (row.targetHit) row.targetExcerpt = block.slice(0, 800).replace(/\r?\n/g, " ");
    blocks.push(row);
    cursor = blockEnd + 1;
  }
  return { bytes: Buffer.byteLength(text, "utf8"), blocks };
}

function discoverRoots(baseRoot, workshopRoot, activeIds) {
  const roots = [{ root: baseRoot, sourceType: "base_game", modId: null, active: true }];
  if (!fs.existsSync(workshopRoot)) return roots;
  for (const entry of fs.readdirSync(workshopRoot, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const root = path.join(workshopRoot, entry.name, "history", "characters");
    if (fs.existsSync(root)) roots.push({ root, sourceType: "workshop", modId: entry.name, active: activeIds.has(entry.name) });
  }
  return roots;
}

function headerInfo(buffer) {
  const kinds = ["TEXT_UNCOMPRESSED", "BINARY_UNCOMPRESSED", "UNIFIED_TEXT_ZIP", "UNIFIED_BINARY_ZIP", "SPLIT_TEXT_ZIP", "SPLIT_BINARY_ZIP"];
  const newline = buffer.indexOf(10);
  return {
    version: parseInt(buffer.toString("ascii", 3, 5), 16),
    kind: parseInt(buffer.toString("ascii", 5, 7), 16),
    kindName: kinds[parseInt(buffer.toString("ascii", 5, 7), 16)] || "UNKNOWN",
    metaLength: parseInt(buffer.toString("ascii", 15, 23), 16),
    headerLength: newline + 1
  };
}

function entries(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
}

function summarizeRecord(id, bucket, record) {
  if (!record || typeof record !== "object") return { id, bucket, status: "NOT_FOUND" };
  const family = record.family_data || {};
  const dead = record.dead_data || {};
  return {
    id,
    bucket,
    firstName: record.first_name ?? null,
    birth: record.birth ?? null,
    female: record.female ?? null,
    culture: record.culture ?? null,
    faith: record.faith ?? null,
    dynastyHouse: record.dynasty_house ?? null,
    father: family.real_father ?? family.father ?? null,
    mother: family.real_mother ?? family.mother ?? null,
    spouse: family.spouse ?? family.primary_spouse ?? null,
    death: dead.date ? { date: dead.date, reason: dead.reason ?? null } : null,
    fields: Object.keys(record).sort()
  };
}

async function loadSaveEvidence(savePath, jominiPath, definitionRows) {
  const full = fs.readFileSync(savePath);
  const header = headerInfo(full.subarray(0, 64));
  const body = full.subarray(header.headerLength + header.metaLength);
  const { Jomini } = require(jominiPath);
  const parser = await Jomini.initialize();
  const parsed = parser.parseText(body, { encoding: "utf8", typeNarrowing: "none" }, (query) => ({
    date: query.at("/date"),
    lookup: query.at("/character_lookup"),
    living: query.at("/living"),
    deadUnprunable: query.at("/dead_unprunable"),
    deadPrunable: query.at("/characters/dead_prunable")
  }));
  const lookup = Object.fromEntries(entries(parsed.lookup).map(([key, value]) => [String(key), String(Array.isArray(value) ? value[0] : value)]));
  const reverse = new Map();
  for (const [key, value] of Object.entries(lookup)) {
    if (!reverse.has(value)) reverse.set(value, []);
    reverse.get(value).push(key);
  }
  const records = new Map();
  for (const [bucket, map] of [["living", parsed.living], ["dead_unprunable", parsed.deadUnprunable], ["dead_prunable", parsed.deadPrunable]]) {
    for (const [id, record] of entries(map)) records.set(String(id), { bucket, record });
  }
  const targets = definitionRows.filter((row) => TARGET_DEFINITION_IDS.has(row.definitionId)).map((row) => ({
    definitionId: row.definitionId,
    sourceType: row.sourceType,
    modId: row.modId,
    file: row.file,
    line: row.line,
    runtimeIds: lookup[row.definitionId] ? [lookup[row.definitionId]] : [],
    mappingConfidence: lookup[row.definitionId] ? "DIRECT" : "NOT_FOUND"
  }));
  const sourceRuntimeIds = [...new Set(targets.flatMap((row) => row.runtimeIds))];
  const observedIds = [...new Set([...CONTROL_RUNTIME_IDS, ...sourceRuntimeIds])];
  return {
    save: { fileName: path.basename(savePath), fileSize: full.length, header, gameDate: parsed.date ?? null },
    lookup: {
      count: Object.keys(lookup).length,
      targetDefinitions: targets,
      reverseForObservedRuntimeIds: Object.fromEntries(observedIds.map((id) => [id, reverse.get(id) || []])),
      definitionKeyType: "string_or_numeric_keys_are_serialized_as_text",
      note: "character_lookup is a separate save section; direct character records do not expose a historical_id field in this sample."
    },
    mappedRecords: Object.fromEntries(observedIds.map((id) => [id, records.has(id) ? summarizeRecord(id, records.get(id).bucket, records.get(id).record) : { id, status: "NOT_FOUND" }])),
    controls: {
      randomNpcRuntimeId: "95304",
      playerChildRuntimeId: "33678786",
      eventGeneratedSample: "NOT_SELECTED",
      crossCheckpoint: "UNKNOWN_WITH_ONE_AUTHORIZED_FULL_SAVE"
    }
  };
}

async function main() {
  const [, , baseRoot, workshopRoot, savePath, jominiPath, outputPath, activeCsv = ""] = process.argv;
  if (!baseRoot || !workshopRoot || !savePath || !jominiPath || !outputPath) throw new Error("usage: node explore-v8.4-definition-mapping.js <base-characters> <workshop-root> <save.ck3> <jomini-entry.cjs> <output.json> [active-mod-ids-csv]");
  const activeIds = new Set(activeCsv.split(",").map((item) => item.trim()).filter(Boolean));
  const catalogStarted = nowMs();
  const roots = discoverRoots(baseRoot, workshopRoot, activeIds);
  const allDefinitions = [];
  const rootResults = [];
  for (const source of roots) {
    const files = listFiles(source.root);
    const started = nowMs();
    let bytes = 0;
    let definitions = 0;
    for (const filePath of files) {
      const result = extractDefinition(filePath, source.root, source);
      bytes += result.bytes;
      definitions += result.blocks.length;
      allDefinitions.push(...result.blocks);
    }
    rootResults.push({ ...source, files: files.length, bytes, definitions, scanMs: nowMs() - started });
  }
  const byId = new Map();
  for (const row of allDefinitions) {
    if (!byId.has(row.definitionId)) byId.set(row.definitionId, []);
    byId.get(row.definitionId).push(row);
  }
  const duplicateIds = [...byId.entries()].filter(([, rows]) => rows.length > 1);
  const targets = allDefinitions.filter((row) => row.targetHit);
  const saveEvidence = await loadSaveEvidence(savePath, jominiPath, allDefinitions);
  const output = {
    generatedAt: new Date().toISOString(),
    scope: "read_only_v8.4_second_round_exploration",
    roots: rootResults,
    catalog: {
      totalDefinitions: allDefinitions.length,
      uniqueDefinitionIds: byId.size,
      duplicateDefinitionIds: duplicateIds.length,
      duplicateDefinitionIdSamples: duplicateIds.slice(0, 100).map(([definitionId, rows]) => ({ definitionId, occurrences: rows.length, sources: rows.slice(0, 8).map((row) => ({ sourceType: row.sourceType, modId: row.modId, file: row.file, line: row.line, active: row.active })) })),
      keyTypes: { string: allDefinitions.filter((row) => row.keyType === "string").length, numeric: allDefinitions.filter((row) => row.keyType === "numeric").length },
      targetBlockCount: targets.length,
      targetBlocks: targets.slice(0, 200)
    },
    saveEvidence,
    benchmark: {
      catalogBuildMs: nowMs() - catalogStarted,
      note: "Catalog rows are retained only for target blocks and bounded duplicate samples; no full catalog is written."
    }
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`V8.4 definition mapping exploration: PASS (${allDefinitions.length} definitions, ${targets.length} target blocks, ${saveEvidence.lookup.count} lookup entries)`);
  console.log(`Output: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
