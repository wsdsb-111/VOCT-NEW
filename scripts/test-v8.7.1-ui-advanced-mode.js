"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
for (const marker of ["Record：", "Branch：", "Revision：", "冲突标识", "在本次对话中持续提醒 NPC", "涉及人物 Runtime ID", "知情人物 Runtime ID"]) assert.ok(source.includes(marker), `missing advanced marker: ${marker}`);
assert.match(source, /开发者详情/);
assert.match(source, /setHistory\(previous => previous \? \{ \.\.\.previous, offset, records: \[\.\.\.previous\.records, \.\.\.records\]/);
console.log("V8.7.1 Luna advanced mode UI PASS");
