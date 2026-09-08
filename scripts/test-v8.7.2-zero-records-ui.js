"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
assert.match(source, /entries\.length === 0/);
assert.match(source, /if \(entries\.length === 0\) return null/);
assert.doesNotMatch(source, /当前检查点没有旧版 Supplemental。/);
assert.match(source, /legacyState\?\.supplemental/);
console.log("V8.7.2 zero legacy-records no-UI PASS");
