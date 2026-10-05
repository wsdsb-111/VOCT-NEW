"use strict";

const assert = require("node:assert/strict");
const { scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");
const { buildMemory4EntityContext } = require("../resources/app/out/main/memory-system/memory4-entity-context");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

const campaignToken = "v8.14.2-nickname-target-alias";
const target = { id: 1, firstName: "甲", shortName: "甲", fullName: "甲", nickname: "北地之虎", primaryTitle: "明王", traits: [] };
const owner = { id: 2, firstName: "乙", shortName: "乙", fullName: "乙", traits: [] };
const speaker = { id: 3, firstName: "丙", shortName: "丙", fullName: "丙", traits: [] };
const characters = [target, owner, speaker];
const gameData = { campaignToken, date: "1170.1.1", characters: new Map(characters.map(character => [character.id, character])) };

function snapshot(text, disclosureCharacters = characters) {
  return { campaignToken, ownerId: 2, conversationId: "conversation-1", finalizationId: "finalization-1",
    date: gameData.date, sourceRevision: hash("source-revision"), disclosureCharacters,
    fragments: [{ fragmentId: "fragment-1", sourceMessageIds: [12], messageId: 12, text,
      speakerId: 3, sourceRole: "assistant", entityIds: disclosureCharacters.map(character => character.id),
      knownBy: [2], visibility: "public", sourceType: "spoken", sourceTextVerified: true,
      visibilityEvidence: "finalization_validated_segment" }] };
}

function scan(text, roster = characters) {
  return scanVisibleDisclosures(snapshot(text, roster), { ...gameData,
    characters: new Map(roster.map(character => [character.id, character])) }).disclosures;
}

const uniqueNickname = scan("“北地之虎是明王。”");
assert(uniqueNickname.some(row => row.entityId === 1 && row.factType === "TITLE" && row.value === "明王"),
  "a globally unique public nickname binds a current fact to its character");

const collidingName = { id: 4, firstName: "北地之虎", shortName: "北地之虎", fullName: "北地之虎", traits: [] };
assert.deepEqual(scan("“北地之虎是明王。”", [...characters, collidingName]), [],
  "a nickname colliding with another character name is ambiguous");

const otherNickname = { id: 4, firstName: "丁", shortName: "丁", fullName: "丁", nickname: "北地之虎", traits: [] };
assert.deepEqual(scan("“北地之虎是明王。”", [...characters, otherNickname]), [],
  "a nickname shared by two characters is ambiguous");

const aliasCollisionTarget = { ...target, nickname: "乙" };
assert.deepEqual(scan("“乙是明王。”", [aliasCollisionTarget, owner, speaker]), [],
  "a nickname colliding with another character's name alias is ambiguous");

const fragment = { fragmentId: "fragment-entity", messageId: 12, sourceMessageIds: [12], sourceRole: "assistant",
  text: "“北地之虎是明王。”", speakerId: 3, knownBy: [2], visibilityEvidence: "application_fragment" };
const entityContext = buildMemory4EntityContext({ ownerId: 2, campaignToken, date: gameData.date,
  fragments: [fragment], participantProfiles: characters });
assert(!entityContext.entityNameEvidence.some(row => row.entityId === 1),
  "a public nickname alone cannot grant the character's hidden real name as entity evidence");

console.log("V8.14.2 nickname target alias: PASS");
