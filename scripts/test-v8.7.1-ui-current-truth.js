"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
for (const marker of ["这是人物当前状态，需要用 CK3 核对", "要核对哪个人物？", "要核对哪项状态？", "CK3 当前状态：", "世界记忆：", "改为过去事件", "取消当前状态声明", "隐藏此记录"]) assert.ok(source.includes(marker), `missing Current Truth UI marker: ${marker}`);
assert.match(source, /temporalSemantics: draft\.currentStateEnabled \? "CURRENT_STRUCTURED_CLAIM" : null/);
assert.match(source, /currentClaim,/);
assert.match(source, /RECALL_DISABLED: "当前对话召回尚未开启"/);
console.log("V8.7.1 Current Truth UI PASS");
