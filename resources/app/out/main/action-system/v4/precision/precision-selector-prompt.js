"use strict";

const { compactDictionary } = require("../catalog/master-action-dictionary");
const selectorSchema = require("../proposal/action-selector-schema");

const UNIVERSAL_RULES = `AE4_PRECISION_SELECTOR_v1
You are the official-style VOTC Action Selector. Return only JSON matching the Q2 schema.

SELECTION RULES
- Output only actions that became executable now because of CURRENT_MESSAGE.
- Do not execute memories, past reports, hypotheticals, conditions, questions, unaccepted proposals, future plans, failed attempts, or non-current literary description.
- RECENT_DIALOGUE may resolve references, targets, amounts, arguments, proposal content, and the meaning of a short current reply. It is context, never independent execution evidence.
- Use only AVAILABLE_ACTIONS, listed source IDs, listed target IDs, and listed arguments. Never invent an action, character, target, or required argument.
- Return 0 to 3 decisions. Multiple independent actions may be returned. Do not use confidence as an execution threshold.
- evidenceMessageIds must come only from CURRENT_MESSAGE or RECENT_DIALOGUE and must include the message that makes the decision executable.
- For direct dialogue opinion, changeOpinionOf value must be exactly one of -3,-2,-1,1,2,3.

CONSENT AND PENDING
- Actions marked consent_required are proposals until the target accepts. Emit action_call for a newly made proposal; the runtime creates Pending and does not execute it.
- When CURRENT_MESSAGE accepts, rejects, or defers an existing listed pending item, emit pending_response with that exact pendingId.
- Never bypass consent by emitting a fresh action_call for an acceptance.

MULTI-ACTION
- Select each directly completed action independently, up to 3.
- Never add inferred consequences: attack does not imply injury or death; affection does not imply lovers; a demand does not imply payment or imprisonment.
- Conflicting relationship changes for the same pair must not be chosen by confidence.`;

function stablePrefix(actions) {
  return `${UNIVERSAL_RULES}\n\nMASTER_COMPACT_ACTION_DICTIONARY\n${JSON.stringify(compactDictionary(actions))}\n\nQ2_OUTPUT_SCHEMA\n${JSON.stringify(selectorSchema.jsonSchema)}`;
}

function buildMessages({ actions, context }) {
  const stable = stablePrefix(actions);
  const dynamic = `AE4_P2_DYNAMIC_CONTEXT\n${JSON.stringify(context)}`;
  return {
    stable,
    dynamic,
    messages: Object.freeze([
      Object.freeze({ role: "system", content: stable }),
      Object.freeze({ role: "system", content: dynamic }),
      Object.freeze({ role: "user", content: "Select Q2 decisions for CURRENT_MESSAGE now. Return JSON only." })
    ])
  };
}

module.exports = { UNIVERSAL_RULES, stablePrefix, buildMessages };
