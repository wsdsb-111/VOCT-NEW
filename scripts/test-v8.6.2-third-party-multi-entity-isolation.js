"use strict";
const assert = require("assert");
const { buildThirdPartyEvidencePatch } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");
const result = buildThirdPartyEvidencePatch({ query: "韩世忠和岳飞分别说过什么？", entities: [
  { id: 3, aliases: ["韩世忠"], memories: [evidenceMemory()] },
  { id: 4, aliases: ["岳飞"], memories: [evidenceMemory({ memoryId: "yue", subjects: [4], participants: [2, 4], content: "岳飞说会守住襄阳。", provenance: { counterpartIds: [4] } })] }
] });
assert.equal(result.entities.length, 2);
assert(result.entities[0].text.includes("韩世忠") && !result.entities[0].text.includes("岳飞说会守住"));
assert(result.entities[1].text.includes("岳飞") && !result.entities[1].text.includes("韩世忠明确答应"));
console.log("V8.6.2 Third-party Multi-entity Isolation: PASS");
