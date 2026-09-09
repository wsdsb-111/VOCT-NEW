"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
assert.match(source, /function isValidGameDateInput\(value\)/);
assert.match(source, /supplemental_specific_date_invalid/);
assert.match(source, /supplemental_planned_date_invalid/);
assert.match(source, /function formatCanonError\(cause, developerMode\)/);
assert.match(source, /无法识别当前游戏日期，请刷新存档后重试/);
assert.match(source, /1171年9月20日/);
assert.match(source, /formatGameDateForDisplay\(record\.gameDate\)/);
console.log("V8.7.2 date UI validation and player-facing errors PASS");
