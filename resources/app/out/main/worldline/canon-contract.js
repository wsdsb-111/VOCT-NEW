"use strict";

const crypto = require("crypto");
const { BOOLEAN_CLAIM_FIELDS, CURRENT_CLAIM_FIELD_SET } = require("./current-truth-adapter");

const TEMPORAL_MODES = new Set(["CURRENT_DATE", "SPECIFIC_DATE", "TIMELESS", "PLANNED"]);
const TEMPORAL_SEMANTICS = new Set(["PAST_EVENT", "DURABLE_WORLD_RULE", "CURRENT_STRUCTURED_CLAIM", "PLANNED"]);
const CURRENT_CLAIM_FIELDS = CURRENT_CLAIM_FIELD_SET;
const CURRENT_STATE_PATTERN = /(?:现在|目前|当前|如今|现居|仍在|已经迁往|现任|currently|now)\s*(?:在|位于|居于|活着|已死|信仰|文化|领主|担任|为)?/i;

function isPotentialCurrentState(text) {
  return CURRENT_STATE_PATTERN.test(String(text || ""));
}

function normalizedSubject(value) {
  return String(value || "").toLocaleLowerCase().replace(/[\s\p{P}]+/gu, " ").trim().slice(0, 80);
}

function deriveConflictKey(payload = {}) {
  const claim = payload.currentClaim;
  if (claim?.entityId && CURRENT_CLAIM_FIELDS.has(claim.field)) return `current:${claim.entityId}:${claim.field}`;
  const entities = [...new Set([...(payload.entities || []), ...(payload.entityRefs || []).filter((item) => item?.namespace === "character").map((item) => item.id)].map(String).filter((item) => /^\d+$/.test(item)))].sort();
  const subject = normalizedSubject(payload.title);
  if (!subject || !entities.length) return null;
  if (["SECRET_AGREEMENT", "RP_POLITICAL_DECISION"].includes(payload.type)) return `agreement:${entities.join(",")}:${subject}`;
  if (["NARRATIVE_EVENT", "PLAYER_CANON"].includes(payload.type)) return `event:${entities.join(",")}:${crypto.createHash("sha256").update(subject).digest("hex").slice(0, 16)}`;
  return null;
}

function normalizeCanonPayload(payload, { gameDate = null, totalDays = null } = {}) {
  const result = { ...payload };
  const suppliedMode = result.temporalMode;
  const temporalMode = TEMPORAL_MODES.has(suppliedMode) ? suppliedMode : result.gameDate ? "SPECIFIC_DATE" : "CURRENT_DATE";
  if (suppliedMode != null && !TEMPORAL_MODES.has(suppliedMode)) throw new Error("supplemental_temporal_mode_invalid");
  if (temporalMode === "CURRENT_DATE") {
    if (typeof gameDate !== "string" || !gameDate) throw new Error("supplemental_current_date_unavailable");
    result.gameDate = gameDate;
    result.totalDays = Number.isSafeInteger(totalDays) ? totalDays : null;
  } else if (temporalMode === "SPECIFIC_DATE") {
    if (typeof result.gameDate !== "string" || !result.gameDate) throw new Error("supplemental_specific_date_required");
    result.totalDays = null;
  } else if (temporalMode === "TIMELESS") {
    result.gameDate = null;
    result.totalDays = null;
  } else {
    result.totalDays = null;
  }
  const temporalSemantics = result.temporalSemantics || (result.currentClaim ? "CURRENT_STRUCTURED_CLAIM" : temporalMode === "PLANNED" ? "PLANNED" : temporalMode === "TIMELESS" ? "DURABLE_WORLD_RULE" : "PAST_EVENT");
  if (!TEMPORAL_SEMANTICS.has(temporalSemantics)) throw new Error("supplemental_temporal_semantics_invalid");
  if (temporalSemantics === "CURRENT_STRUCTURED_CLAIM" && !result.currentClaim) throw new Error("supplemental_current_claim_required");
  if (temporalSemantics !== "CURRENT_STRUCTURED_CLAIM" && result.currentClaim) throw new Error("supplemental_current_claim_semantics_invalid");
  if (temporalSemantics === "CURRENT_STRUCTURED_CLAIM" && temporalMode !== "CURRENT_DATE") throw new Error("supplemental_current_claim_requires_current_date");
  if (isPotentialCurrentState(result.content) && temporalSemantics !== "CURRENT_STRUCTURED_CLAIM") throw new Error("supplemental_current_state_needs_structured_confirmation");
  result.temporalMode = temporalMode;
  result.temporalSemantics = temporalSemantics;
  if (result.conflictKey == null || result.conflictKey === "") result.conflictKey = deriveConflictKey(result);
  return result;
}

module.exports = { BOOLEAN_CLAIM_FIELDS, CURRENT_CLAIM_FIELDS, TEMPORAL_MODES, TEMPORAL_SEMANTICS, deriveConflictKey, isPotentialCurrentState, normalizeCanonPayload };
