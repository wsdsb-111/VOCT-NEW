"use strict";

const assert = require("assert");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");

const characters = new Map([
  [1, { id: 1, fullName: "父亲", gender: "male", children: [2, 3] }],
  [2, { id: 2, fullName: "长子", gender: "male", location: "京师" }],
  [3, { id: 3, fullName: "次子", gender: "male", location: "边境" }]
]);
const block = buildFamilyFactBlock(characters.get(1), { date: "1175.2.1", getMentionableCharacterProfiles: () => characters }, { query: "你儿子怎么样" });
assert(block.includes("未选择任何人"));
assert(!block.includes("长子") && !block.includes("次子") && !block.includes("京师") && !block.includes("边境"));
console.log("V8.8 Ambiguous No Private Facts: PASS");
