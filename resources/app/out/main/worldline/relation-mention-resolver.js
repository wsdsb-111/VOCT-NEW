"use strict";

const { parseRelationIntent } = require("./relation-intent-parser");
const { resolveAnchoredRelationMention } = require("./anchored-relation-resolver");

function findRelationMention(query = "") {
  const intent = parseRelationIntent(query);
  return intent.detected ? { term: intent.sourcePhrase, mention: { types: intent.relationTypes, sex: intent.sexConstraint, label: intent.label } } : null;
}

function resolveRelationMention(options = {}) {
  const result = resolveAnchoredRelationMention(options);
  return result.status === "NO_RELATION_INTENT" ? { status: "RELATION_UNKNOWN", mention: null, candidates: [] } : result;
}

module.exports = { findRelationMention, resolveRelationMention };
