"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Handlebars = require(path.join(__dirname, "..", "resources", "app", "node_modules", "handlebars"));
const root = path.resolve(__dirname, "..");
const { getFrozenLegacyReferenceByYear } = require("./fixtures/v8.0-legacy-historical-reference");
const { getLegacyReferenceByYear } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-baseline"));

const template = fs.readFileSync(path.join(root, "resources", "app", "default_userdata", "prompts", "system", "default.hbs"), "utf8");
const start = template.indexOf("{{! VOTC_SEGMENT:world_context }}");
const end = template.indexOf("{{! VOTC_SEGMENT:character_base }}", start);
assert(start >= 0 && end > start, "world_context segment markers missing");
const renderWorldContext = Handlebars.compile(template.slice(start, end));

for (const year of [900, 1010, 1105, 1130, 1265, 1280]) {
  const baseGameData = { date: `${year}年1月1日`, year, dynasty: "fixture", currentEmperor: null };
  const legacy = renderWorldContext({ gameData: { ...baseGameData, historicalReferenceInfo: getFrozenLegacyReferenceByYear(year) } });
  const v8 = renderWorldContext({ gameData: { ...baseGameData, historicalReferenceInfo: getLegacyReferenceByYear(year) } });
  assert.strictEqual(v8, legacy, `world_context changed for ${year}`);
}

console.log("VOTC v8.0 Prompt compatibility: PASS (six era fixtures, byte-for-byte world_context)");
