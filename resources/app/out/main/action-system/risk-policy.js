"use strict";

function getEffectiveRiskLevel(action, settings = {}) {
  const riskLevel = action?.definition?.semantic?.riskLevel ?? action?.semantic?.riskLevel;
  if (["low", "medium", "high"].includes(riskLevel)) return riskLevel;
  return (action?.definition?.isDestructive ?? action?.isDestructive) ? "high" : "low";
}

function getEffectiveDestructive(action, settings = {}) {
  if (getEffectiveRiskLevel(action, settings) === "high") return true;
  const signature = action?.id ?? action?.signature;
  if (signature && Object.prototype.hasOwnProperty.call(settings.destructiveOverrides || {}, signature)) return settings.destructiveOverrides[signature];
  return action?.definition?.isDestructive ?? action?.isDestructive ?? false;
}

function requiresApproval(action, settings = {}, approvalMode = "none") {
  if (approvalMode === "all") return false;
  if (approvalMode === "non-destructive") return getEffectiveDestructive(action, settings);
  return true;
}

function canApplyOverride(action, override) {
  return !(getEffectiveRiskLevel(action) === "high" && override === false);
}

module.exports = { getEffectiveRiskLevel, getEffectiveDestructive, requiresApproval, canApplyOverride };
