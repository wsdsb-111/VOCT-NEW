"use strict";
const assert = require("assert");
const { buildThirdPartyEvidencePatch } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");
const result = buildThirdPartyEvidencePatch({ query: "韩世忠会来吗？", entities: [{ id: 3, aliases: ["韩世忠"], memories: [evidenceMemory({ type: "rumor", source: "rumor", epistemicStatus: "unverified" })] }] });
assert(result.text.includes("传闻/未核实") && result.text.includes("不能确认"));
console.log("V8.6.2 Third-party Epistemic Status: PASS");
