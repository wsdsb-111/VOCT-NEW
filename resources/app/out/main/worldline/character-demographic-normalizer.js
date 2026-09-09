"use strict";

function normalizeSex(value) {
  if (value === "male" || value === "female") return value;
  if (value === true || value === "yes") return "female";
  if (value === false || value === "no") return "male";
  return "unknown";
}

function resolveCharacterSex({ snapshot = null, live = null, historical = null } = {}) {
  const lanes = [
    [snapshot?.gender ?? snapshot?.sex ?? snapshot?.female, "CURRENT_SNAPSHOT"],
    [live?.gender ?? live?.sex ?? live?.female, "LIVE_STRUCTURED"],
    [historical?.gender ?? historical?.sex ?? historical?.female, "HISTORICAL_FALLBACK"]
  ];
  for (const [value, source] of lanes) {
    const sex = normalizeSex(value);
    if (sex !== "unknown") return { sex, source };
  }
  return { sex: "unknown", source: "UNKNOWN" };
}

function resolveCharacterSexConsensus({ snapshot = null, live = null, historical = null, relation = null } = {}) {
  if (snapshot?.evidence?.conflicts?.gender === true) return { sex: "unknown", source: "CONFLICT", conflict: true, status: "RELATION_GENDER_CONFLICT", evidence: [] };
  const lanes = [
    [snapshot?.gender ?? snapshot?.sex ?? snapshot?.female, "CURRENT_SNAPSHOT"],
    [relation?.gender ?? relation?.sex ?? relation?.female, "RELATION_METADATA"],
    [live?.gender ?? live?.sex ?? live?.female, "LIVE_STRUCTURED"],
    [historical?.gender ?? historical?.sex ?? historical?.female, "HISTORICAL_FALLBACK"]
  ].map(([value, source]) => ({ sex: normalizeSex(value), source })).filter((item) => item.sex !== "unknown");
  const values = new Set(lanes.map((item) => item.sex));
  if (values.size > 1) return { sex: "unknown", source: "CONFLICT", conflict: true, status: "RELATION_GENDER_CONFLICT", evidence: lanes };
  const selected = lanes[0] || { sex: "unknown", source: "UNKNOWN" };
  return { ...selected, conflict: false, status: selected.sex === "unknown" ? "UNKNOWN" : "RESOLVED", evidence: lanes };
}

module.exports = { normalizeSex, resolveCharacterSex, resolveCharacterSexConsensus };
