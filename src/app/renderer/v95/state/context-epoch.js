import { createContractError } from "../contracts/errors.v1.js";

const contextFields = ["campaignKey", "conversationKey", "viewKey"];

export function createContextEpoch() {
  let initialized = false;
  let identity = { campaignKey: null, conversationKey: null, viewKey: null };
  let campaignEpoch = 0;
  let conversationEpoch = 0;
  let viewEpoch = 0;

  function capture() {
    return Object.freeze({ campaignEpoch, conversationEpoch, viewEpoch });
  }

  function setContext(next) {
    if (!next || typeof next !== "object"
      || contextFields.some(field => !Object.prototype.hasOwnProperty.call(next, field)
        || !(next[field] === null || typeof next[field] === "string" || Number.isSafeInteger(next[field])))) {
      throw createContractError("VALIDATION_ERROR");
    }

    const campaignChanged = !initialized || !Object.is(identity.campaignKey, next.campaignKey);
    const conversationChanged = campaignChanged || !initialized || !Object.is(identity.conversationKey, next.conversationKey);
    const viewChanged = conversationChanged || !initialized || !Object.is(identity.viewKey, next.viewKey);
    if (campaignChanged) campaignEpoch += 1;
    if (conversationChanged) conversationEpoch += 1;
    if (viewChanged) viewEpoch += 1;
    identity = {
      campaignKey: next.campaignKey,
      conversationKey: next.conversationKey,
      viewKey: next.viewKey
    };
    initialized = true;
    return capture();
  }

  function resetConversation() {
    conversationEpoch += 1;
    viewEpoch += 1;
    return capture();
  }

  function advanceView() {
    viewEpoch += 1;
    return capture();
  }

  function isCurrent(token) {
    return Boolean(token && token.campaignEpoch === campaignEpoch
      && token.conversationEpoch === conversationEpoch && token.viewEpoch === viewEpoch);
  }

  return Object.freeze({ setContext, resetConversation, advanceView, capture, isCurrent });
}
