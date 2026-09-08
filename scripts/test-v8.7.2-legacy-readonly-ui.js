"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
assert.match(source, /api\.listSupplemental\(\)/);
assert.match(source, /旧版补充知识（只读）/);
assert.match(source, /只能查看/);
assert.doesNotMatch(source, /当前检查点没有旧版 Supplemental/);
assert.doesNotMatch(source, /api\.(createSupplemental|updateSupplemental|deleteSupplemental)/);
console.log("V8.7.2 legacy Supplemental read-only UI PASS");
