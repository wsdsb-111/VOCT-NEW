"use strict";

const { fingerprint } = require("./prompt-plan-contract");

function calculatePlanPrefix(plan, serialized) {
  const blocks = new Map(plan.blocks.map(block => [block.id, block]));
  const byPosition = new Map();
  for (const span of serialized.messageSpans) {
    for (const { messagePosition } of span.contributions) {
      if (!byPosition.has(messagePosition)) byPosition.set(messagePosition, new Set());
      byPosition.get(messagePosition).add(span.blockId);
    }
  }
  let messageCount = 0;
  const prefixBlocks = new Set();
  for (let position = 0; position < serialized.messages.length; position++) {
    const contributors = byPosition.get(position);
    if (!contributors || [...contributors].some(id => !blocks.get(id).cache.prefixEligible)) break;
    contributors.forEach(id => prefixBlocks.add(id));
    messageCount++;
  }
  const tokens = plan.blocks.filter(block => prefixBlocks.has(block.id)).reduce((sum, block) => sum + block.tokens.estimated, 0);
  return { messageCount, stablePrefixCandidateTokens: tokens, source: "LOCAL_ESTIMATE",
    prefixFingerprint: fingerprint([plan.layoutId, plan.layoutRevision,
      plan.blocks.filter(block => prefixBlocks.has(block.id)).map(block => [block.id, block.cache.contentFingerprint, block.permission.authorizedAtRevision])]) };
}

module.exports = { calculatePlanPrefix };
