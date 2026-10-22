"use strict";

const crypto = require("crypto");
const { BOOLEAN_CLAIM_FIELDS, CURRENT_CLAIM_FIELD_SET } = require("./current-truth-adapter");
const { normalizeGameDate } = require("./character-temporal-facts");

const TEMPORAL_MODES = new Set(["CURRENT_DATE", "SPECIFIC_DATE", "TIMELESS", "PLANNED"]);
const TEMPORAL_SEMANTICS = new Set(["PAST_EVENT", "DURABLE_WORLD_RULE", "CURRENT_STRUCTURED_CLAIM", "PLANNED"]);
const CURRENT_CLAIM_FIELDS = CURRENT_CLAIM_FIELD_SET;
const EXPLICIT_CURRENT_STATE_PATTERN = /(?:现在|目前|当前|如今|现居|现任|currently|\bnow\b)/iu;
const AMBIGUOUS_CURRENT_STATE_PATTERN = /(?:仍在|仍然在|依旧在|已经迁往)/giu;
const EVENT_SUBJECT_PATTERN = /(?:战事|战争|战斗|冲突|战役|谈判|对峙)\s*$/u;
const EVENT_CONTINUATION_PATTERN = /^\s*(?:持续|进行|延续)/u;

function isPotentialCurrentState(text) {
  const content = String(text || "");
  if (EXPLICIT_CURRENT_STATE_PATTERN.test(content)) return true;
  for (const sentence of content.split(/[。！？；\n]/u)) {
    for (const match of sentence.matchAll(AMBIGUOUS_CURRENT_STATE_PATTERN)) {
      const before = sentence.slice(0, match.index);
      const after = sentence.slice(match.index + match[0].length);
      if (match[0] === "已经迁往" || !EVENT_SUBJECT_PATTERN.test(before) || !EVENT_CONTINUATION_PATTERN.test(after)) return true;
    }
  }
  return false;
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
    if (gameDate == null || gameDate === "") throw new Error("supplemental_current_date_unavailable");
    const normalized = normalizeGameDate(gameDate);
    if (!normalized) throw new Error("supplemental_current_date_invalid");
    result.gameDate = normalized.canonical;
    result.totalDays = Number.isSafeInteger(totalDays) ? totalDays : null;
  } else if (temporalMode === "SPECIFIC_DATE") {
    if (result.gameDate == null || result.gameDate === "") throw new Error("supplemental_specific_date_required");
    const normalized = normalizeGameDate(result.gameDate);
    if (!normalized) throw new Error("supplemental_specific_date_invalid");
    result.gameDate = normalized.canonical;
    result.totalDays = null;
  } else if (temporalMode === "TIMELESS") {
    result.gameDate = null;
    result.totalDays = null;
  } else {
    if (result.gameDate == null || result.gameDate === "") result.gameDate = null;
    else {
      const normalized = normalizeGameDate(result.gameDate);
      if (!normalized) throw new Error("supplemental_planned_date_invalid");
      result.gameDate = normalized.canonical;
    }
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
