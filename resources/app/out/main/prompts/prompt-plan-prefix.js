"use strict";

const { fingerprint } = require("./prompt-plan-contract");

function calculatePlanPrefix(plan, serialized) {
  const blocks = new Map(plan.blocks.map(block => [block.id, block]));
  let messageCount = 0;
  const prefixBlocks = new Set();
  for (let position = 0; position < serialized.messages.length; position++) {
    const contributors = serialized.messageSpans.filter(span => span.contributions.some(part => part.messagePosition === position));
    if (!contributors.length || contributors.some(span => !blocks.get(span.blockId).cache.prefixEligible)) break;
    contributors.forEach(span => prefixBlocks.add(span.blockId));
    messageCount++;
  }
  const tokens = plan.blocks.filter(block => prefixBlocks.has(block.id)).reduce((sum, block) => sum + block.tokens.estimated, 0);
  return { messageCount, stablePrefixCandidateTokens: tokens, source: "LOCAL_ESTIMATE",
    prefixFingerprint: fingerprint([plan.layoutId, plan.layoutRevision,
      plan.blocks.filter(block => prefixBlocks.has(block.id)).map(block => [block.id, block.cache.contentFingerprint, block.permission.authorizedAtRevision])]) };
}

module.exports = { calculatePlanPrefix };
