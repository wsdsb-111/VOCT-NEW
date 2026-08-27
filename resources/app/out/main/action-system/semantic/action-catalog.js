"use strict";

const crypto = require("crypto");
const corpus = require("./semantic-corpus");
const { getInteractionPolicy } = require("../interaction/interaction-policy");

let cachedFingerprint = null;
let cachedCatalog = null;

function resolveRisk(action, registry) {
  if (typeof registry?.getEffectiveRiskLevel === "function") return registry.getEffectiveRiskLevel(action.id);
  return action.definition?.semantic?.riskLevel || (action.definition?.isDestructive ? "high" : "low");
}

function build(actions, registry) {
  const catalog = (actions || []).filter((action) => action?.id && action.id !== "noOp" && action.validation?.valid !== false).map((action) => ({
    actionId: action.id,
    categories: [...(action.definition?.triggerCategories || [])].sort(),
    meaning: corpus.forAction(action.id)?.meaning || action.definition?.title?.zh || action.definition?.title?.en || action.id,
    risk: resolveRisk(action, registry),
    interactionType: getInteractionPolicy(action.id).type
  })).sort((left, right) => left.actionId.localeCompare(right.actionId));
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
  if (fingerprint === cachedFingerprint) return cachedCatalog;
  cachedFingerprint = fingerprint;
  cachedCatalog = Object.freeze({ fingerprint, entries: Object.freeze(catalog.map(Object.freeze)) });
  return cachedCatalog;
}

module.exports = { build, resolveRisk };
