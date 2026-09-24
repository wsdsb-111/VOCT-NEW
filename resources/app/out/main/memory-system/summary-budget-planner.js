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
  const maxOutputTokens = Math.max(1, Math.floor(Number(capabilities?.maxOutputTokens) || 2048));
  const budgetOptions = {
    messages: promptMessages,
    capabilities,
    countTokens
  };
  let requestBudget = planRequestBudget({ ...budgetOptions, requestedOutputTokens: maxOutputTokens });
  if (!requestBudget.safe) {
    const minimumOutputTokens = Math.min(256, maxOutputTokens);
    const minimumBudget = planRequestBudget({ ...budgetOptions, requestedOutputTokens: minimumOutputTokens });
    if (minimumBudget.safe) {
      const availableOutputTokens = minimumBudget.effectiveInputBudget + minimumOutputTokens - minimumBudget.estimatedInputTokens;
      requestBudget = planRequestBudget({ ...budgetOptions, requestedOutputTokens: Math.min(maxOutputTokens, Math.floor(availableOutputTokens)) });
    }
  }
  return {
    ...requestBudget,
    sourceTokens,
    requiredOutputTokens,
    wholeRequestSafe: requiredOutputTokens <= requestBudget.reservedOutputTokens && requestBudget.safe
  };
}

module.exports = { planSummaryRequest };
