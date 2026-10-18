"use strict";
const assert = require("assert");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");
const { familyCharacters } = require("./v8.6.2-test-fixtures");
const CAMPAIGN = "votc8c-202610180003";
const DATE = "1171.9.20";
const TOTAL_DAYS = 428000;
const characters = familyCharacters();
for (const [characterId, character] of Object.entries(characters)) {
  if (character.parents && typeof character.parents === "object") {
    character.parents = Object.fromEntries(Object.entries(character.parents).map(([branch, parentId]) => {
      const id = String(parentId);
      return [branch, { id, source: "CK3_DIRECT_PARENT", sourceOwnerId: String(characterId), childId: String(characterId),
        parentId: id, relationType: "parent", sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT",
        knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN, sourceSnapshotId: `${DATE}/${TOTAL_DAYS}` }];
    }));
  }
  if (Array.isArray(character.children)) {
    character.children = character.children.map(childId => {
      const id = String(childId);
      return { id, directParentEvidence: { source: "CK3_DIRECT_PARENT", sourceOwnerId: id, childId: id,
        parentId: String(characterId), relationType: "parent", sourceRelation: "parents",
        publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN,
        sourceSnapshotId: `${DATE}/${TOTAL_DAYS}` } };
    });
  }
}
const profiles = new Map(Object.entries(characters).map(([id, character]) => [Number(id), character]));
const gameData = { date: DATE, totalDays: TOTAL_DAYS, campaignToken: CAMPAIGN, characters: profiles,
  getMentionableCharacterProfiles: () => profiles };
const block = buildFamilyFactBlock(characters["1"], gameData);
assert(block.includes("当前结构化家庭事实"));
assert(block.includes("父亲：父") && block.includes("亡妻：亡妻") && block.includes("1170年2月1日去世"));
assert(block.includes("Memory") && block.includes("不得覆盖"));
console.log("V8.6.2 Family Prompt: PASS");
