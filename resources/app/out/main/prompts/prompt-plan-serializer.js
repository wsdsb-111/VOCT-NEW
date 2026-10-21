"use strict";

const { fingerprint, validatePromptPlan } = require("./prompt-plan-contract");
const { requirePlan } = require("./prompt-plan-errors");

/** Pure serialization: every output contribution is declared by index, never found by its text. */
function serializePromptPlan(plan, { layoutId = plan.layoutId, profileId = plan.promptProfileId } = {}) {
  validatePromptPlan(plan);
  requirePlan(layoutId === plan.layoutId && profileId === plan.promptProfileId, "PLAN_LAYOUT_MISMATCH");
  const blocks = new Map(plan.blocks.map(block => [block.id, block]));
  const spans = new Map(plan.blocks.map(block => [block.id, { blockId: block.id, start: null, end: null, contributions: [] }]));
  const used = new Set();
  const messages = plan.messageGroups.map((group, messagePosition) => {
    requirePlan(Array.isArray(group.parts) && group.parts.length > 0 && typeof group.separator === "string", "PLAN_MESSAGE_SPAN_MISSING");
    let result = null;
    let offset = 0;
    for (const [position, part] of group.parts.entries()) {
      const block = blocks.get(part.blockId);
      const key = JSON.stringify([part.blockId, part.index]);
      requirePlan(block && Number.isInteger(part.index) && part.index >= 0 && block.messages[part.index]
        && !used.has(key), "PLAN_MESSAGE_PART_INVALID");
      used.add(key);
      const message = block.messages[part.index];
      if (!result) result = { ...message };
      else {
        const withoutContent = ({ content, ...rest }) => rest;
        requirePlan(JSON.stringify(withoutContent(result)) === JSON.stringify(withoutContent(message)), "PLAN_SHARED_MESSAGE_ROLE_MISMATCH");
        result.content += group.separator + message.content;
        offset += group.separator.length;
      }
      const span = spans.get(block.id);
      if (span.start === null) span.start = messagePosition;
      span.end = messagePosition + 1;
      span.contributions.push({ messagePosition, partIndex: part.index, startOffset: offset, endOffset: offset + message.content.length });
      offset += message.content.length;
      requirePlan(block.role === message.role || block.messages.length > 1, "PLAN_BLOCK_ROLE_INVALID");
    }
    return result;
  });
  for (const block of plan.blocks) {
    for (const [index] of block.messages.entries()) requirePlan(used.has(JSON.stringify([block.id, index])), "PLAN_MESSAGE_PART_UNCOVERED");
    requirePlan(!block.content || block.messages.length > 0, "PLAN_BLOCK_UNCOVERED");
    const span = spans.get(block.id);
    if (span.start === null) span.start = span.end = 0;
  }
  const messageSpans = [...spans.values()];
  const blockMetadata = plan.blocks.map(block => {
    const span = spans.get(block.id);
    return { id: block.id, type: block.legacyType, label: block.label, position: block.order,
      kind: block.kind, semanticClass: block.kind, lifecycle: block.lifecycle.state, tokens: block.tokens.estimated,
      stable: block.cache.stableCandidate, fingerprint: block.cache.contentFingerprint,
      messageStartPosition: span.start, messageCount: span.end - span.start };
  });
  const serializedFingerprint = fingerprint(messages);
  return { messages, messageSpans, blockMetadata, serializedFingerprint, serializedMessagesFingerprint: serializedFingerprint };
}

module.exports = { serializePromptPlan };
