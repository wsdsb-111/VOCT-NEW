"use strict";

const SCHEMA_VERSION = "ae4-q2-v1";
const ACTION_CALL_KEYS = Object.freeze(["actionId", "arguments", "confidence", "evidenceMessageIds", "sourceCharacterId", "targetCharacterId", "type"]);
const PENDING_RESPONSE_KEYS = Object.freeze(["confidence", "evidenceMessageIds", "pendingId", "response", "type"]);

const jsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    decisions: {
      type: "array",
      maxItems: 3,
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: "action_call" },
              actionId: { type: "string", minLength: 1 },
              sourceCharacterId: { anyOf: [{ type: "integer" }, { type: "string", minLength: 1 }] },
              targetCharacterId: { anyOf: [{ type: "integer" }, { type: "string", minLength: 1 }, { type: "null" }] },
              arguments: { type: "object" },
              evidenceMessageIds: { type: "array", minItems: 1, maxItems: 4, items: { anyOf: [{ type: "integer" }, { type: "string" }] } },
              confidence: { type: "number", minimum: 0, maximum: 1 }
            },
            required: ["type", "actionId", "sourceCharacterId", "targetCharacterId", "arguments", "evidenceMessageIds", "confidence"]
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: "pending_response" },
              pendingId: { type: "string", minLength: 1 },
              response: { type: "string", enum: ["accept", "reject", "defer"] },
              evidenceMessageIds: { type: "array", minItems: 1, maxItems: 4, items: { anyOf: [{ type: "integer" }, { type: "string" }] } },
              confidence: { type: "number", minimum: 0, maximum: 1 }
            },
            required: ["type", "pendingId", "response", "evidenceMessageIds", "confidence"]
          }
        ]
      }
    }
  },
  required: ["decisions"]
});

function parse(content) {
  let value;
  try {
    value = JSON.parse(content);
  } catch (_error) {
    return { valid: false, reason: "unparseable_q2_json" };
  }
  if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.prototype.hasOwnProperty.call(value, "decisions") || !Array.isArray(value.decisions) || value.decisions.length > 3) return { valid: false, reason: "invalid_q2_schema" };
  for (const decision of value.decisions) {
    if (!decision || !["action_call", "pending_response"].includes(decision.type)) return { valid: false, reason: "invalid_q2_decision" };
    const expectedKeys = decision.type === "action_call" ? ACTION_CALL_KEYS : PENDING_RESPONSE_KEYS;
    if (Object.keys(decision).sort().join("|") !== expectedKeys.join("|")) return { valid: false, reason: "invalid_q2_schema" };
    if (!Array.isArray(decision.evidenceMessageIds) || decision.evidenceMessageIds.length < 1 || decision.evidenceMessageIds.length > 4) return { valid: false, reason: "invalid_q2_evidence" };
    if (!decision.evidenceMessageIds.every((id) => Number.isInteger(id) || typeof id === "string")) return { valid: false, reason: "invalid_q2_evidence" };
    if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) return { valid: false, reason: "invalid_q2_confidence" };
    if (decision.type === "action_call" && (typeof decision.actionId !== "string" || decision.actionId.length === 0 || !(Number.isInteger(decision.sourceCharacterId) || typeof decision.sourceCharacterId === "string" && decision.sourceCharacterId.length > 0) || !(decision.targetCharacterId === null || Number.isInteger(decision.targetCharacterId) || typeof decision.targetCharacterId === "string" && decision.targetCharacterId.length > 0) || !decision.arguments || typeof decision.arguments !== "object" || Array.isArray(decision.arguments))) return { valid: false, reason: "invalid_q2_action_call" };
    if (decision.type === "pending_response" && (typeof decision.pendingId !== "string" || !["accept", "reject", "defer"].includes(decision.response))) return { valid: false, reason: "invalid_q2_pending_response" };
  }
  return { valid: true, decisions: value.decisions };
}

module.exports = { SCHEMA_VERSION, jsonSchema, parse };
