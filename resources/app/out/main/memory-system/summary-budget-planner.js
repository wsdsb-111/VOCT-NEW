"use strict";

const { planRequestBudget } = require("../providers/request-budget");

function planSummaryRequest({ prompt, context, capabilities, countTokens } = {}) {
  const messages = Array.isArray(context?.messages) ? context.messages : [];
  const promptMessages = Array.isArray(prompt) ? prompt : messages;
  const sourceTokens = Math.max(0, Number(countTokens(messages)) || 0);
  const participantCount = Array.isArray(context?.participants) ? context.participants.length : 0;
  const presenceWindowCount = Array.isArray(context?.participantPresence) ? context.participantPresence.length : 0;
  const requiredOutputTokens = Math.max(256, Math.ceil(sourceTokens * 0.38)
    + messages.length * 12 + participantCount * 48 + presenceWindowCount * 48 + 256);
  const requestBudget = planRequestBudget({
    messages: promptMessages,
    capabilities,
    requestedOutputTokens: Math.min(requiredOutputTokens, capabilities.maxOutputTokens),
    countTokens
  });
  return {
    ...requestBudget,
    sourceTokens,
    requiredOutputTokens,
    wholeRequestSafe: requiredOutputTokens <= capabilities.maxOutputTokens && requestBudget.safe
  };
}

module.exports = { planSummaryRequest };
