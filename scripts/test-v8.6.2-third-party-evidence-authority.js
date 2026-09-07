"use strict";
const assert = require("assert");
const { buildThirdPartyEvidencePatch } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");
const result = buildThirdPartyEvidencePatch({ query: "韩世忠答应了吗？", entities: [{ id: 3, aliases: ["韩世忠"], memories: [evidenceMemory()] }] });
assert(result.text.includes("不得否认") && result.text.includes("不得补造"));
assert(result.text.includes("当前 CK3 结构化事实决定现在状态"));
console.log("V8.6.2 Third-party Evidence Authority: PASS");
