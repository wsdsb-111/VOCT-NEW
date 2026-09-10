"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");
const { buildUnresolvedRelationConstraint } = require("../resources/app/out/main/worldline/character-family-facts");

const graph = buildKinshipGraph({
  1: { id: 1, fullName: "回应者" },
  10: { id: 10, fullName: "甲王", primaryTitle: "幽王", children: [11] },
  11: { id: 11, fullName: "甲王之子", gender: "male", location: "甲府" },
  20: { id: 20, fullName: "乙王", primaryTitle: "幽王", children: [21] },
  21: { id: 21, fullName: "乙王之子", gender: "male", location: "乙府" }
});

for (const query of ["幽王府又得一子叫什么", "神秘王府又得一子叫什么"]) {
  const result = resolveAnchoredRelationMention({ query, responderId: 1, graph });
  assert(["ANCHOR_AMBIGUOUS", "ANCHOR_UNKNOWN"].includes(result.status));
  const block = buildUnresolvedRelationConstraint(result);
  assert.match(block, /不得输出具体人物姓名、年龄、位置、生死状态、头衔、配偶或私人事实/);
  assert.match(block, /不得从 Memory、历史常识或模型猜测中选择某个具体人物/);
  assert.doesNotMatch(block, /甲王之子|乙王之子|甲府|乙府/);
}

console.log("V8.8.2 Anchor Fail Closed: PASS");
