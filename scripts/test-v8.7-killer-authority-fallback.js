"use strict";
const assert = require("assert");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");
const data = { campaignToken: "killer-fixture", date: "1175.1.1", totalDays: 100, characters: new Map([
  [1, { id: 1, parents: [{ id: 2, source: "CK3_DIRECT_PARENT", sourceOwnerId: 1, childId: 1, parentId: 2,
    relationType: "parent", sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN",
    campaignToken: "killer-fixture", sourceSnapshotId: "1175.1.1/100" }] }],
  [2, { id: 2, alive: false, deathDate: "1171.9.2" }]
]) };
const text = buildFamilyFactBlock(data.characters.get(1), data);
assert(text.includes("若本块未给出致死者"));
assert(text.includes("Worldline Game Truth"));
assert(text.includes("不得从 Memory 或模型推测致死者"));
console.log("killer authority fallback PASS");
