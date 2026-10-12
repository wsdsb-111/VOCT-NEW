"use strict";

const crypto = require("crypto");

const DEFAULT_MAX_RECORDS = 500;
const HARD_MAX_RECORDS = 2000;
const MAX_HASH_INPUT_BYTES = 4 * 1024 * 1024;
const UNKNOWN = "UNKNOWN";

const ORIGINS = new Set(["finalization", "recovery", "legacy_recompression", "letter_finalization", "other"]);
const OPERATIONS = new Set(["legacy_recompression", "letter_finalization"]);
const RETRY_REASONS = new Set(["output_truncated", "provider_retry", "source_changed_before_send", "other"]);
const STATUSES = new Set(["PREPARED", "PREFLIGHT_WAIT", "AUTHORIZED_TO_SEND", "PROVIDER_SENT", "PROVIDER_COMPLETED",
  "PARSED_OK", "INCOMPLETE", "INVALID_JSON", "INVALID_SHAPE", "REJECTED", "COMMITTED", "RETRY_SCHEDULED",
  "FAILED_PRE_SEND", "FAILED", "UNKNOWN"]);
const PARSE_STATUSES = new Set(["NOT_ATTEMPTED", "PARSED_OK", "INCOMPLETE", "INVALID_JSON", "INVALID_SHAPE",
  "INVALID_TRANSITIONS", "SOURCE_REJECTED", "ERROR", UNKNOWN]);
const HASH_DOMAINS = new Set(["campaign", "owner", "finalization", "endpoint", "effective_parameter", "policy",
  "source_digest", "system", "anchor", "user", "request"]);
const HASH_FIELDS = ["endpointHash", "effectiveParameterHash", "policyHash", "sourceDigest", "systemHash", "anchorHash",
  "userHash", "requestHash"];
const TOKEN_FIELDS = ["providerAttemptCount", "inputTokens", "hitTokens", "missTokens", "outputTokens",
  "requestedOutputTokens", "effectiveOutputTokens", "tokenEstimate"];
const REPORTED_FIELDS = ["inputReported", "hitReported", "missReported", "outputReported"];
const SAFE_ERROR_CODES = new Set(["memory4_generation_incomplete", "memory4_generation_changed", "memory4_provider_unavailable",
  "memory4_response_no_valid_entries", "memory4_response_invalid_json", "memory4_response_invalid_shape",
  "memory4_response_invalid_transitions", "memory4_response_source_mismatch", "memory4_request_source_changed_before_send",
  "provider_budget_blocked", "provider_cancelled", "provider_timeout", "provider_error"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;

function boundedMaxRecords(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return DEFAULT_MAX_RECORDS;
  return Math.max(1, Math.min(HARD_MAX_RECORDS, numeric));
}

function safeCount(value) {
  if (value === UNKNOWN) return UNKNOWN;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : UNKNOWN;
}

function safeIndex(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeTimestamp(value) {
  if (typeof value !== "string" || !value || value.length > 40) return null;
  const numeric = Date.parse(value);
  return Number.isFinite(numeric) ? new Date(numeric).toISOString() : null;
}

function safeCode(value, allowed) {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

function safeFinishReason(value) {
  if (value === UNKNOWN || value == null) return UNKNOWN;
  if (typeof value !== "string" || value.length > 48 || !/^[A-Za-z0-9_.:-]+$/.test(value)) return "OTHER";
  return value;
}

function safeHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value) ? value.toLowerCase() : null;
}

class DurableRequestTrace {
  constructor({ enabled = false, maxRecords = DEFAULT_MAX_RECORDS } = {}) {
    this.enabled = enabled === true;
    this.maxRecords = boundedMaxRecords(maxRecords);
    this.salt = this.enabled ? crypto.randomBytes(32) : null;
    this.records = [];
    this.recordsByAttemptId = new Map();
    this.runs = new WeakMap();
    this.droppedCount = 0;
    this.truncatedWindow = false;
  }

  setEnabled(enabled) {
    const next = enabled === true;
    if (next && !this.salt) this.salt = crypto.randomBytes(32);
    this.enabled = next;
  }

  hashValue(domain, value) {
    if (!this.enabled || !this.salt || !HASH_DOMAINS.has(domain) || typeof value !== "string") return null;
    if (Buffer.byteLength(value, "utf8") > MAX_HASH_INPUT_BYTES) return null;
    try {
      return crypto.createHmac("sha256", this.salt).update(`${domain}\0`, "utf8").update(value, "utf8").digest("hex");
    } catch { return null; }
  }

  beginRun(snapshot = {}, options = {}) {
    if (!this.enabled || !snapshot || typeof snapshot !== "object") return null;
    try {
      const { origin = "other", operation = null } = options && typeof options === "object" ? options : {};
      const campaignToken = typeof snapshot.campaignToken === "string" ? snapshot.campaignToken : "";
      const finalizationId = typeof snapshot.finalizationId === "string" ? snapshot.finalizationId : "";
      const run = Object.freeze({
        durableRunId: crypto.randomUUID(),
        origin: safeCode(origin, ORIGINS) || "other",
        operation: safeCode(operation, OPERATIONS),
        campaignScopeHash: this.hashValue("campaign", campaignToken),
        finalizationHash: finalizationId ? this.hashValue("finalization", `${campaignToken}\0${finalizationId}`) : null
      });
      this.runs.set(run, true);
      return run;
    } catch { return null; }
  }

  beginAttempt(run, chunk = {}, retry = {}) {
    if (!this.enabled || !run || !this.runs.has(run)) return null;
    if (this.records.length >= this.maxRecords) {
      this.droppedCount = Math.min(Number.MAX_SAFE_INTEGER, this.droppedCount + 1);
      this.truncatedWindow = true;
      return null;
    }
    try {
      const { parentAttemptId = null, retryDepth = 0, retryReason = null } = retry && typeof retry === "object" ? retry : {};
      const campaignToken = typeof chunk.campaignToken === "string" ? chunk.campaignToken : "";
      const ownerId = chunk.ownerId;
      const finalizationId = typeof chunk.finalizationId === "string" ? chunk.finalizationId : "";
      const chunkIndex = safeIndex(chunk.chunkIndex);
      const chunkTotal = safeIndex(chunk.chunkTotal);
      const suppliedPath = Array.isArray(chunk.chunkPath) ? chunk.chunkPath : [];
      const chunkPath = suppliedPath.length <= 16 && suppliedPath.every((value, index) => {
        const numeric = safeIndex(value);
        return numeric != null && (index === 0 || numeric <= 1);
      }) ? suppliedPath.map(Number) : chunkIndex == null ? [] : [chunkIndex];
      const depth = safeIndex(retryDepth);
      const metadata = {
        durableRunId: run.durableRunId,
        durableAttemptId: crypto.randomUUID(),
        durableParentAttemptId: typeof parentAttemptId === "string" && UUID_PATTERN.test(parentAttemptId) ? parentAttemptId : null,
        origin: safeCode(chunk.origin, ORIGINS) || run.origin,
        operation: safeCode(chunk.operation, OPERATIONS) || run.operation,
        ownerScopeHash: Number.isSafeInteger(ownerId) && ownerId > 0 && campaignToken
          ? this.hashValue("owner", `${campaignToken}\0${ownerId}`) : null,
        campaignScopeHash: run.campaignScopeHash || this.hashValue("campaign", campaignToken),
        finalizationHash: run.finalizationHash || (finalizationId
          ? this.hashValue("finalization", `${campaignToken}\0${finalizationId}`) : null),
        chunkIndex,
        chunkTotal,
        chunkPath,
        fragmentCount: safeCount(chunk.fragmentCount),
        retryDepth: depth == null ? 0 : Math.min(32, depth),
        retryReason: safeCode(retryReason, RETRY_REASONS) || UNKNOWN
      };
      for (const field of HASH_FIELDS) metadata[field] = safeHash(chunk[field]) || null;
      for (const field of TOKEN_FIELDS) metadata[field] = UNKNOWN;
      for (const field of REPORTED_FIELDS) metadata[field] = false;
      const row = {
        ...metadata,
        status: "PREPARED",
        requestPreparedAt: new Date().toISOString(),
        providerSendStartedAt: null,
        providerCompletedAt: null,
        finishReason: UNKNOWN,
        complete: UNKNOWN,
        truncated: UNKNOWN,
        parseStatus: "NOT_ATTEMPTED",
        errorCode: UNKNOWN,
        providerAttemptCount: UNKNOWN,
        inputTokens: UNKNOWN,
        hitTokens: UNKNOWN,
        missTokens: UNKNOWN,
        outputTokens: UNKNOWN,
        requestedOutputTokens: UNKNOWN,
        effectiveOutputTokens: UNKNOWN,
        tokenEstimate: UNKNOWN,
        inputReported: false,
        hitReported: false,
        missReported: false,
        outputReported: false
      };
      this.addRecord(row);
      return metadata;
    } catch { return null; }
  }

  beginTransportRetry(attempt, options = {}) {
    if (!this.enabled || !attempt || !this.recordsByAttemptId.has(attempt.durableAttemptId)) return null;
    try {
      const { providerAttemptCount = UNKNOWN } = options && typeof options === "object" ? options : {};
      this.record(attempt, { status: "RETRY_SCHEDULED", retryReason: "provider_retry" });
      if (this.records.length >= this.maxRecords) {
        this.droppedCount = Math.min(Number.MAX_SAFE_INTEGER, this.droppedCount + 1);
        this.truncatedWindow = true;
        attempt.durableAttemptId = null;
        attempt.durableParentAttemptId = null;
        return null;
      }
      const row = this.recordsByAttemptId.get(attempt.durableAttemptId);
      const child = {
        ...attempt,
        durableAttemptId: crypto.randomUUID(),
        durableParentAttemptId: attempt.durableAttemptId,
        retryDepth: Math.min(32, (safeIndex(attempt.retryDepth) || 0) + 1),
        retryReason: "provider_retry"
      };
      const childRow = {
        ...child,
        status: "PREPARED",
        requestPreparedAt: new Date().toISOString(),
        providerSendStartedAt: null,
        providerCompletedAt: null,
        finishReason: UNKNOWN,
        complete: UNKNOWN,
        truncated: UNKNOWN,
        parseStatus: "NOT_ATTEMPTED",
        errorCode: UNKNOWN,
        providerAttemptCount: safeCount(providerAttemptCount),
        inputTokens: UNKNOWN,
        hitTokens: UNKNOWN,
        missTokens: UNKNOWN,
        outputTokens: UNKNOWN,
        requestedOutputTokens: safeCount(child.requestedOutputTokens),
        effectiveOutputTokens: safeCount(child.effectiveOutputTokens),
        tokenEstimate: safeCount(child.tokenEstimate),
        inputReported: false,
        hitReported: false,
        missReported: false,
        outputReported: false
      };
      for (const field of HASH_FIELDS) childRow[field] = safeHash(row?.[field]) || safeHash(child[field]) || null;
      this.addRecord(childRow);
      Object.assign(attempt, child);
      return attempt;
    } catch { return null; }
  }

  record(attempt, fields = {}) {
    if (!this.enabled || !attempt || !fields || typeof fields !== "object") return false;
    try {
      const row = this.recordsByAttemptId.get(attempt.durableAttemptId);
      if (!row) return false;
      const status = safeCode(fields.status, STATUSES);
      if (status) row.status = status;
      if (fields.providerSendStartedAt !== undefined) row.providerSendStartedAt = safeTimestamp(fields.providerSendStartedAt);
      else if (status === "PROVIDER_SENT" && !row.providerSendStartedAt) row.providerSendStartedAt = new Date().toISOString();
      if (fields.providerCompletedAt !== undefined) row.providerCompletedAt = safeTimestamp(fields.providerCompletedAt);
      else if (["PROVIDER_COMPLETED", "PARSED_OK", "INCOMPLETE", "INVALID_JSON", "INVALID_SHAPE", "REJECTED", "COMMITTED"].includes(status)
        && !row.providerCompletedAt) row.providerCompletedAt = new Date().toISOString();
      if (fields.finishReason !== undefined) row.finishReason = safeFinishReason(fields.finishReason);
      if (typeof fields.complete === "boolean") row.complete = fields.complete;
      if (typeof fields.truncated === "boolean") row.truncated = fields.truncated;
      const parseStatus = safeCode(fields.parseStatus, PARSE_STATUSES);
      if (parseStatus) row.parseStatus = parseStatus;
      if (fields.errorCode !== undefined) {
        const safeErrorCode = SAFE_ERROR_CODES.has(fields.errorCode)
          || typeof fields.errorCode === "string" && /^memory4_[a-z_]{1,80}$/.test(fields.errorCode);
        row.errorCode = safeErrorCode ? fields.errorCode : UNKNOWN;
      }
      if (fields.retryReason !== undefined) row.retryReason = safeCode(fields.retryReason, RETRY_REASONS) || UNKNOWN;
      for (const field of TOKEN_FIELDS) {
        if (fields[field] !== undefined) {
          row[field] = safeCount(fields[field]);
          attempt[field] = row[field];
        }
      }
      for (const field of HASH_FIELDS) {
        if (fields[field] !== undefined) {
          row[field] = safeHash(fields[field]);
          attempt[field] = row[field];
        }
      }
      for (const field of REPORTED_FIELDS) {
        if (typeof fields[field] === "boolean") {
          const tokenField = ({ inputReported: "inputTokens", hitReported: "hitTokens",
            missReported: "missTokens", outputReported: "outputTokens" })[field];
          row[field] = fields[field] && row[tokenField] !== UNKNOWN;
          attempt[field] = row[field];
        }
      }
      return true;
    } catch { return false; }
  }

  addRecord(row) {
    this.records.push(row);
    this.recordsByAttemptId.set(row.durableAttemptId, row);
    while (this.records.length > this.maxRecords) {
      const removed = this.records.shift();
      this.recordsByAttemptId.delete(removed.durableAttemptId);
    }
  }

  getRecords() {
    try { return this.records.map(row => JSON.parse(JSON.stringify(row))); }
    catch { return []; }
  }

  exportReport() {
    return { version: 1, enabled: this.enabled, truncatedWindow: this.truncatedWindow,
      droppedCount: this.droppedCount, attempts: this.getRecords() };
  }
}

module.exports = { DurableRequestTrace, DEFAULT_MAX_RECORDS };
