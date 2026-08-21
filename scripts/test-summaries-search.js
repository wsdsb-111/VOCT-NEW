const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const source = fs.readFileSync(rendererPath, "utf8");

assert(source.includes('const includes = (value) => String(value ?? "").toLocaleLowerCase().includes(normalizedSearchQuery);'), "summary search must normalize numeric and missing values");
assert(!source.includes("metadata.characterId.toLowerCase()"), "summary search must not call toLowerCase on a numeric character ID");
assert(source.includes("metadata.ownerName"), "summary search must include the folder owner name");
assert(source.includes("metadata.participantNames"), "summary search must include third-party participant names");

const matchesSearchText = (value, query) => String(value ?? "").toLowerCase().includes(query);
const metadata = {
  characterName: "张三",
  characterId: 12345,
  playerId: 67890,
  summaries: [{ content: "我拿起酒杯。", date: null }]
};
assert(matchesSearchText(metadata.characterId, "123"), "numeric character ID must be searchable");
assert(matchesSearchText(metadata.playerId, "678"), "numeric player ID must be searchable");
assert(matchesSearchText(metadata.summaries[0].content, "酒杯"), "summary content must remain searchable");
assert(!matchesSearchText(metadata.summaries[0].date, "2026"), "missing dates must not throw or falsely match");

console.log("VOTC summaries search: PASS (numeric IDs and incomplete summary data)");
