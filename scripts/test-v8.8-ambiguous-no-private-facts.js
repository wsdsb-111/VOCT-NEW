"use strict";

const assert = require("assert");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");

const campaignToken = "ambiguous-family-fixture";
const date = "1175.2.1";
const totalDays = 430000;
const sourceSnapshotId = `${date}/${totalDays}`;
const directParentEvidence = (childId, parentId, name) => ({
  id: parentId,
  name,
  source: "CK3_DIRECT_PARENT",
  parentId,
  sourceOwnerId: childId,
  childId,
  relationType: "parent",
  sourceRelation: "parents",
  publicStatus: "PUBLIC_LEGAL_PARENT",
  knowledgeStatus: "UNKNOWN",
  campaignToken,
  sourceSnapshotId
});
const characters = new Map([
  [1, { id: 1, fullName: "父亲", gender: "male", children: [
    { id: 2, name: "长子", directParentEvidence: directParentEvidence(2, 1, "父亲") },
    { id: 3, name: "次子", directParentEvidence: directParentEvidence(3, 1, "父亲") }
  ] }],
  [2, { id: 2, fullName: "长子", gender: "male", location: "京师", parents: [directParentEvidence(2, 1, "父亲")] }],
  [3, { id: 3, fullName: "次子", gender: "male", location: "边境", parents: [directParentEvidence(3, 1, "父亲")] }]
]);
const block = buildFamilyFactBlock(characters.get(1), { date, totalDays, campaignToken, sourceSnapshotId, characters, getMentionableCharacterProfiles: () => characters }, { query: "你儿子怎么样" });
assert(block.includes("未选择任何人"));
assert(!block.includes("长子") && !block.includes("次子") && !block.includes("京师") && !block.includes("边境"));
console.log("V8.8 Ambiguous No Private Facts: PASS");
