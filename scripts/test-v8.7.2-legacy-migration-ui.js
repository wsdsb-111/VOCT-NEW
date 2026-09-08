"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
assert.match(source, /getLegacySupplementalMigration/);
assert.match(source, /migrateLegacySupplemental/);
assert.match(source, /MIGRATION_REVIEW_REQUIRED/);
assert.match(source, /迁移审阅/);
assert.match(source, /确认迁移为 Canon/);
assert.match(source, /reviewConfirmed: true/);
assert.match(source, /重新选择明确知情人物/);
assert.match(source, /重新选择范围人物/);
console.log("V8.7.2 legacy Supplemental migration UI PASS");
