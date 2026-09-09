"use strict";

const assert = require("assert");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");
const { classifyKnowledge } = require("../resources/app/out/main/worldline/character-knowledge-policy");

const characters = new Map([
  [1, { id: 1, fullName: "父亲", children: [2] }],
  [2, { id: 2, fullName: "儿子", gender: "male", alive: true, secrets: ["密谋夺位"], knownSecrets: ["私密正文"] }]
]);
const family = buildFamilyFactBlock(characters.get(1), { date: "1175.1.1", getMentionableCharacterProfiles: () => characters }, { query: "你的儿子如何" });
assert.match(family, /儿子/);
assert.doesNotMatch(family, /密谋夺位|私密正文/, "kinship projection must not include secret fields");
const denied = classifyKnowledge({ factId: "secret", entityId: "2", knowledgeLevel: "SECRET", knownBy: ["2"], authorizationComplete: true, body: "密谋夺位" }, { id: "1" }, { relation: "PARENT_OF" });
assert.equal(denied.decision, "DENY", "kinship context must not grant secret authorization");
assert.equal(denied.fact.body, undefined);
console.log("V8.8 Kinship Secret Negative: PASS");
