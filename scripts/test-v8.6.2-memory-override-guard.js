"use strict";
const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("../resources/app/out/main/worldline/character-family-facts"), "utf8");
assert(source.includes("Memory 只可补充过去经历与主观感受，不得覆盖这些事实"));
assert(source.includes("相对时间只能使用系统给出的结果"));
console.log("V8.6.2 Memory Override Guard: PASS");
