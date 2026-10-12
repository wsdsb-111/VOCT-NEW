"use strict";

const crypto = require("crypto");
const fs = require("fs");
const { normalizeProviderUsage, usageNumber } = require("../src/app/main/providers/usage-normalization");

function hash(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function safeName(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(value) ? value : "UNKNOWN";
}

function safeHash(value) {
  if (typeof value !== "string" || !value) return "UNKNOWN";
  return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : hash(value);
}

function cohortHash(value) {
  return typeof value === "string" && /^(?:GLM-[A-F]|DURABLE(?:-[A-Z0-9]{1,12})?|CONTROL|CANDIDATE|[AB])$/i.test(value) ? hash(value) : "UNKNOWN";
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
}

function createStats() {
  return { requestCount: 0, nativeHitRequests: 0, nativeHitStatus: { positive: 0, zero: 0, missing: 0 }, weightedCacheRequests: 0,
    cacheHitTokens: 0, cacheMissTokens: 0, weightedNativeHitRate: null, nativeReportingCoverage: null,
    missProvenance: { providerNative: 0, promptMinusNativeHit: 0, storedUnknown: 0, unknown: 0 },
    localStructureEstimate: { requests: 0, estimatedCommonPrefixTokens: 0 }, stablePrefix: { unchanged: 0, changed: 0, unknown: 0 },
    switches: { endpoint: 0, responder: 0, conversation: 0 }, switchUnknown: { endpoint: 0, responder: 0, conversation: 0 },
    sameEndpointZeroHitAnomalies: 0, sameEndpointZeroHitChecks: 0 };
}

function finalizeStats(stats) {
  const denominator = stats.cacheHitTokens + stats.cacheMissTokens;
  stats.weightedNativeHitRate = denominator > 0 ? stats.cacheHitTokens / denominator : null;
  stats.nativeReportingCoverage = stats.requestCount > 0 ? stats.nativeHitRequests / stats.requestCount : null;
  if (!stats.localStructureEstimate.requests) stats.localStructureEstimate.estimatedCommonPrefixTokens = null;
  stats.sameEndpointZeroHitAnomalies = stats.sameEndpointZeroHitChecks > 0 ? stats.sameEndpointZeroHitAnomalies : null;
  delete stats.sameEndpointZeroHitChecks;
  return stats;
}

function parseEntries(text, source) {
  if (source === "usage") {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
  }
  const entries = [];
  let invalidLines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch (_) { invalidLines += 1; }
  }
  return { entries, invalidLines };
}

function requestUsage(entry, source) {
  if (source === "diagnostics") {
    const raw = entry.rawUsage && typeof entry.rawUsage === "object" ? entry.rawUsage : {};
    const normalized = normalizeProviderUsage(raw);
    const stored = entry.normalizedUsage && typeof entry.normalizedUsage === "object" ? entry.normalizedUsage : {};
    const rawHit = usageNumber(raw.prompt_cache_hit_tokens) ?? usageNumber(raw.prompt_tokens_details?.cached_tokens);
    const hit = rawHit ?? usageNumber(normalized?.prompt_cache_hit_tokens) ?? usageNumber(stored.prompt_cache_hit_tokens);
    return { prompt: usageNumber(raw.prompt_tokens) ?? usageNumber(stored.prompt_tokens), hit,
      nativeMiss: usageNumber(raw.prompt_cache_miss_tokens), storedMiss: usageNumber(normalized?.prompt_cache_miss_tokens) ?? usageNumber(stored.prompt_cache_miss_tokens),
      estimated: raw.votc_estimated === true || entry.usageEstimated === true
        || (!entry.rawUsage && usageNumber(stored.prompt_tokens) != null && entry.providerUsage?.reportingStatus === "not_reported") };
  }
  return { prompt: usageNumber(entry.promptTokens), hit: usageNumber(entry.cacheHitTokens), nativeMiss: null,
    storedMiss: usageNumber(entry.cacheMissTokens), estimated: entry.usageEstimated === true };
}

function addRequest(stats, entry, usage) {
  stats.requestCount += 1;
  const hit = usage.hit;
  if (hit == null) stats.nativeHitStatus.missing += 1;
  else {
    stats.nativeHitRequests += 1;
    stats.nativeHitStatus[hit === 0 ? "zero" : "positive"] += 1;
  }

  let miss = usage.nativeMiss;
  let provenance = miss == null ? null : "providerNative";
  const derivedMiss = hit != null && usage.prompt != null && usage.prompt >= hit ? usage.prompt - hit : null;
  if (miss == null && usage.storedMiss != null) {
    if (derivedMiss != null && usage.storedMiss === derivedMiss) {
      miss = derivedMiss;
      provenance = "promptMinusNativeHit";
    } else {
      provenance = "storedUnknown";
    }
  }
  if (miss == null && usage.storedMiss == null && derivedMiss != null) {
    miss = derivedMiss;
    provenance = "promptMinusNativeHit";
  }
  if (hit != null && miss != null) {
    if (usage.prompt != null && hit + miss > usage.prompt) stats.missProvenance.unknown += 1;
    else {
      stats.weightedCacheRequests += 1;
      stats.cacheHitTokens += hit;
      stats.cacheMissTokens += miss;
      stats.missProvenance[provenance || "unknown"] += 1;
    }
  } else if (hit != null) stats.missProvenance[provenance || "unknown"] += 1;

  const diff = entry.realRequestDiff || {};
  const prefix = usageNumber(diff.estimatedCommonPrefixTokens);
  if (prefix != null) {
    stats.localStructureEstimate.requests += 1;
    stats.localStructureEstimate.estimatedCommonPrefixTokens += prefix;
  }
  const stable = diff.stablePrefixUnchanged;
  stats.stablePrefix[stable === true ? "unchanged" : stable === false ? "changed" : "unknown"] += 1;
  for (const [name, field] of [["endpoint", "sameEndpoint"], ["responder", "sameResponder"], ["conversation", "sameConversation"]]) {
    if (diff[field] === false) stats.switches[name] += 1;
    else if (diff[field] !== true) stats.switchUnknown[name] += 1;
  }
  const alignment = entry.alignmentStatus || diff.alignmentStatus;
  const isComparableZeroHit = hit === 0
    && diff.sameEndpoint === true
    && diff.sameEffectiveParameters === true
    && typeof alignment === "string";
  if (isComparableZeroHit) {
    stats.sameEndpointZeroHitChecks += 1;
    if (alignment === "provider_zero_despite_large_prefix") stats.sameEndpointZeroHitAnomalies += 1;
  }
}

function buildCacheReport(entries, options) {
  const { source, population, from, to } = options || {};
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!["usage", "diagnostics"].includes(source)) throw new Error("source must be usage or diagnostics");
  if (!["history", "experiment"].includes(population)) throw new Error("population must be history or experiment");
  if (!isIsoDate(from) || !isIsoDate(to) || fromMs >= toMs) throw new Error("from/to must be a valid increasing ISO window");

  const report = { schemaVersion: 1, source, population, window: { from, to, endExclusive: true }, requestCount: 0, estimatedUsageTokenRecordsExcluded: 0, actionOutcomeExcluded: 0, groups: [] };
  const groups = new Map();
  for (const item of Array.isArray(entries) ? entries : []) {
    const entry = item && typeof item === "object" ? item : {};
    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < fromMs || timestamp >= toMs) continue;
    if (entry.requestType === "action_outcome") { report.actionOutcomeExcluded += 1; continue; }
    const usage = requestUsage(entry || {}, source);
    const isRequest = source === "diagnostics"
      ? Boolean(entry.rawUsage || entry.normalizedUsage || entry.providerUsage)
      : entry.isUsageRecord === true || entry.isUsageRecord !== false && [usage.prompt, usage.hit, usage.storedMiss].some((value) => value != null);
    if (!isRequest) continue;
    if (usage.estimated) report.estimatedUsageTokenRecordsExcluded += 1;
    const metricUsage = usage.estimated ? { ...usage, prompt: null, hit: null, nativeMiss: null, storedMiss: null } : usage;

    const diff = entry.realRequestDiff || {};
    const key = {
      provider: safeName(entry.provider || entry.providerType),
      model: safeName(entry.model),
      requestType: safeName(entry.requestType),
      layoutId: safeName(diff.promptProfile?.layoutId || entry.layoutId),
      endpointHash: safeHash(entry.endpointFingerprint || diff.endpointFingerprint),
      cohortHash: cohortHash(entry.cacheCohort)
    };
    const keyText = JSON.stringify(key);
    if (!groups.has(keyText)) groups.set(keyText, { ...key, all: createStats(), warm: createStats() });
    const group = groups.get(keyText);
    report.requestCount += 1;
    addRequest(group.all, entry, metricUsage);
    if (entry.cacheSamplePhase === "warm") addRequest(group.warm, entry, metricUsage);
  }
  report.groups = [...groups.values()].map((group) => {
    group.all = finalizeStats(group.all);
    group.warm = finalizeStats(group.warm);
    group.warmSampleStatus = group.warm.requestCount > 0 ? "explicit_warm_samples" : "unknown";
    return group;
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return report;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.slice(2);
    if (!["input", "source", "population", "from", "to"].includes(name) || !argv[index + 1]) throw new Error("Usage: --input FILE --source usage|diagnostics --population history|experiment --from ISO --to ISO");
    values[name] = argv[index + 1];
  }
  if (!values.input || !values.source || !values.population || !values.from || !values.to) throw new Error("Usage: --input FILE --source usage|diagnostics --population history|experiment --from ISO --to ISO");
  return values;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const parsed = parseEntries(fs.readFileSync(args.input, "utf8"), args.source);
    const entries = Array.isArray(parsed) ? parsed : parsed.entries;
    const report = buildCacheReport(entries, args);
    if (!Array.isArray(parsed)) report.invalidLines = parsed.invalidLines;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message === "source must be usage or diagnostics" || error.message === "population must be history or experiment" || error.message.startsWith("from/to") ? error.message : "Unable to build cache report; verify input format and arguments."}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildCacheReport, parseEntries, parseArgs };
