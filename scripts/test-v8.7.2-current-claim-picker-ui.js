"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
for (const marker of ["读取 CK3 当前事实", "当前事实只读预览", "保存时由服务端再次核验", "getCanonCurrentTruth", "所在地", "是否在世", "信仰", "文化", "直属领主", "所在宫廷"]) assert.ok(source.includes(marker), `missing current claim picker marker: ${marker}`);
assert.doesNotMatch(source, /primaryTitle|imprisoned/, "unsupported current truth fields must not be player-selectable");
console.log("V8.7.2 Current Claim picker UI PASS");
