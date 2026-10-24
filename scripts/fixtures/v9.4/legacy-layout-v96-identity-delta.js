"use strict";

const assert = require("node:assert/strict");

// Approved V9.6 privacy delta; the V9.4 source snapshot remains immutable.
// An unbound history author cannot disclose a character identity through metadata.
const budgetByCase = {
  v5: [1389, 0.22552362396492937],
  v6: [1389, 0.22552362396492937],
  v7: [1388, 0.2250689151937733],
  "v813-query-dynamic": [1808, 0.29547311652230757],
  "v813-success-frozen": [1808, 0.2950873184266362],
  glm_cache_v2: [1757, 0.28676350579402643],
  "deepseek_v89-v6": [1389, 0.22552362396492937]
};

function applyIdentityDelta(id, baseline) {
  const expected = structuredClone(baseline);
  const oldContent = "Synthetic Narrator: Line one\n\nLine two | separator fixture.";
  const messages = expected.messages.filter((message) => message.content === oldContent);
  assert.equal(messages.length, 1, `${id}: identity delta must affect exactly one author label`);
  messages[0].content = "未获知姓名的人物: Line one\n\nLine two | separator fixture.";
  const history = expected.diagnosticBlocks.find((block) => block.id === "history");
  assert(history, `${id}: expected history block must exist`);
  assert.equal(history.tokens, 33);
  history.tokens += 2;
  for (const key of ["totalTokens", "dynamicTokens", "dynamicTailTokens"]) expected.tokenCounts[key] += 2;
  [expected.requestBudget.estimatedInputTokens, expected.requestBudget.pressureRatio] = budgetByCase[id];
  return expected;
}

module.exports = { applyIdentityDelta };
