"use strict";

const OVERLAY_VERSION = "state-transition-overlay/v1";
const OVERLAY_BLOCK_ID = "action_state_transition_rules";
const OFFICIAL_BLOCK_IDS_WITHOUT_HISTORY = [
  "action_system_intro",
  "action_recent_messages",
  "action_roster",
  "action_available_actions",
  "action_examples",
  "action_final_instruction"
];
const OFFICIAL_BLOCK_IDS_WITH_HISTORY = [
  "action_system_intro",
  "action_recent_messages",
  "action_recent_actions",
  "action_roster",
  "action_available_actions",
  "action_examples",
  "action_final_instruction"
];
const STABLE_BLOCK_ORDER = [
  "action_system_intro",
  OVERLAY_BLOCK_ID,
  "action_available_actions",
  "action_examples",
  "action_roster",
  "action_recent_actions",
  "action_recent_messages",
  "action_final_instruction"
];
const OFFICIAL_BLOCK_PREFIXES = {
  action_system_intro: "You are an action selection engine in a roleplay AI system.",
  action_recent_messages: "Recent messages:",
  action_recent_actions: "Recent actions (last ",
  action_roster: "Characters in this conversation (order matches CK3 global list):",
  action_available_actions: "Available Actions:",
  action_examples: "Examples of correct JSON output:",
  action_final_instruction: "Given everything above, select the actions (if any) that should be executed right now."
};

const OVERLAY_CONTENT = `STATE TRANSITION RECALL RULES (${OVERLAY_VERSION})

Use only official Available Actions and their listed valid targets. These rules improve recall; they never override availability, schema, or local validation.

INJURY — isInjured:
- Select only for completed, newly inflicted physical harm in the current exchange.
- Ordinary punching or beating maps to injuryType "wounded". Use remove_eye, blind, cut_leg, cut_balls, or disfigured only when that exact severe result is explicit and completed.
- Do not select for threats, plans, commands, questions, attempts, misses, blocks, hypotheticals, prior injuries already represented in state, or merely discussing injury.

DEATH — characterIsKilled:
- Select only when death is explicit and completed, never for threats, attempts, near-death, unconsciousness, or injury alone.
- Official binding is SOURCE = victim and TARGET = killer. If the player kills the current NPC, select characterIsKilled for the NPC, target the PLAYER, and set isPlayerSource=false.
- If the required victim/killer binding cannot be represented by the official available action, do not invent or reverse it.

RELATIONSHIPS:
- Select becomeFriendsWith, becomeLoversWith, becomeSoulmatesWith, becomeRivalsWith, becomeNemesisWith, becomeBloodBrothersWith, or becomeBestFriendsWith only when the relationship is explicitly established, mutually accepted, sworn, or clearly completed now.
- Affection, flirting, friendliness, anger, insults, vague loyalty, or one sexual encounter alone do not establish these states.
- Respect official prerequisites, conflicting relations, existing higher states, and validTargetCharacterIds.`;

function expectedOfficialBlockIds(messages) {
  if (!Array.isArray(messages)) return null;
  if (messages.length === OFFICIAL_BLOCK_IDS_WITHOUT_HISTORY.length) return OFFICIAL_BLOCK_IDS_WITHOUT_HISTORY;
  if (messages.length === OFFICIAL_BLOCK_IDS_WITH_HISTORY.length) return OFFICIAL_BLOCK_IDS_WITH_HISTORY;
  return null;
}

function annotateOfficialActionMessages(messages) {
  const expectedIds = expectedOfficialBlockIds(messages);
  if (!expectedIds) return { valid: false, reason: "official_message_count_unverifiable", messages };
  const annotated = [];
  for (let index = 0; index < expectedIds.length; index++) {
    const message = messages[index];
    const expectedRole = index === expectedIds.length - 1 ? "user" : "system";
    if (!message || message.role !== expectedRole || typeof message.content !== "string" || message.content.length === 0) {
      return { valid: false, reason: `official_message_slot_${index}_unverifiable`, messages };
    }
    if (!message.content.startsWith(OFFICIAL_BLOCK_PREFIXES[expectedIds[index]])) {
      return { valid: false, reason: `official_message_contract_${index}_unverifiable`, messages };
    }
    if (message.blockId != null && message.blockId !== expectedIds[index]) {
      return { valid: false, reason: `official_block_id_mismatch_${index}`, messages };
    }
    annotated.push({ ...message, blockId: expectedIds[index] });
  }
  if (new Set(annotated.map((message) => message.blockId)).size !== annotated.length) {
    return { valid: false, reason: "official_block_id_duplicate", messages };
  }
  return { valid: true, reason: null, messages: annotated };
}

function prepareActionMessages(messages, { overlayEnabled = false, stablePrefixEnabled = false } = {}) {
  const annotated = annotateOfficialActionMessages(messages);
  const requestedStage = !overlayEnabled && !stablePrefixEnabled ? "A" : overlayEnabled && !stablePrefixEnabled ? "B" : overlayEnabled && stablePrefixEnabled ? "C" : "CUSTOM_STABLE_ONLY";
  if (!annotated.valid) {
    const cleanMessages = Array.isArray(messages) && messages.some((message) => message && Object.prototype.hasOwnProperty.call(message, "blockId")) ? messages.map(({ blockId, ...message }) => ({ ...message })) : messages;
    return {
      messages: cleanMessages,
      blockMessages: Array.isArray(messages) ? messages.map((message) => ({ ...message })) : [],
      blockMetadataValid: false,
      overlayApplied: false,
      stablePrefixApplied: false,
      failureReason: annotated.reason,
      experimentStage: requestedStage
    };
  }
  const blockMessages = [...annotated.messages];
  if (!overlayEnabled && !stablePrefixEnabled) {
    return {
      messages,
      blockMessages,
      blockMetadataValid: true,
      overlayApplied: false,
      stablePrefixApplied: false,
      failureReason: null,
      experimentStage: requestedStage
    };
  }
  if (overlayEnabled) {
    blockMessages.splice(1, 0, { role: "system", content: OVERLAY_CONTENT, blockId: OVERLAY_BLOCK_ID });
  }
  let ordered = blockMessages;
  let stablePrefixApplied = false;
  if (stablePrefixEnabled) {
    const positions = new Map(STABLE_BLOCK_ORDER.map((id, index) => [id, index]));
    const ids = blockMessages.map((message) => message.blockId);
    if (ids.some((id) => !positions.has(id)) || new Set(ids).size !== ids.length) {
      return {
        messages: annotated.messages.map(({ blockId, ...message }) => ({ ...message })),
        blockMessages: annotated.messages,
        blockMetadataValid: false,
        overlayApplied: false,
        stablePrefixApplied: false,
        failureReason: "stable_block_metadata_invalid",
        experimentStage: requestedStage
      };
    }
    ordered = [...blockMessages].sort((left, right) => positions.get(left.blockId) - positions.get(right.blockId));
    stablePrefixApplied = true;
  }
  return {
    messages: ordered.map(({ blockId, ...message }) => ({ ...message })),
    blockMessages: ordered,
    blockMetadataValid: true,
    overlayApplied: overlayEnabled,
    stablePrefixApplied,
    failureReason: null,
    experimentStage: requestedStage
  };
}

module.exports = {
  OVERLAY_VERSION,
  OVERLAY_BLOCK_ID,
  OVERLAY_CONTENT,
  STABLE_BLOCK_ORDER,
  annotateOfficialActionMessages,
  prepareActionMessages
};
