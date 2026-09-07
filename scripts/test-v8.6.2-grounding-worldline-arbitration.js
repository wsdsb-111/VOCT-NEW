"use strict";
const assert = require("assert");
const fs = require("fs");
const evidence = fs.readFileSync(require.resolve("../resources/app/out/main/memory-system/third-party-evidence"), "utf8");
const family = fs.readFileSync(require.resolve("../resources/app/out/main/worldline/character-family-facts"), "utf8");
assert(evidence.includes("当前 CK3 结构化事实决定现在状态") && evidence.includes("只约束已记录的过去事实"));
assert(family.includes("不得覆盖这些事实"));
console.log("V8.6.2 Grounding Worldline Arbitration: PASS");
