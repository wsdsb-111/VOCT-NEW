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

module.exports = { normalizeSex, resolveCharacterSex };
