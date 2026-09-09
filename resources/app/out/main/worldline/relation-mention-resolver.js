"use strict";

const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");

const RELATION_MENTIONS = [
  { terms: ["你儿子"], types: ["CHILD_OF"], sex: "male", label: "儿子" },
  { terms: ["你女儿"], types: ["CHILD_OF"], sex: "female", label: "女儿" },
  { terms: ["你子女", "你的孩子"], types: ["CHILD_OF"], sex: null, label: "子女" },
  { terms: ["你父亲", "你爹"], types: ["PARENT_OF"], sex: "male", label: "父亲" },
  { terms: ["你母亲", "你娘"], types: ["PARENT_OF"], sex: "female", label: "母亲" },
  { terms: ["你父母"], types: ["PARENT_OF"], sex: null, label: "父母" },
  { terms: ["你祖父", "你爷爷"], types: ["GRANDPARENT_OF"], sex: "male", label: "祖父" },
  { terms: ["你祖母", "你奶奶"], types: ["GRANDPARENT_OF"], sex: "female", label: "祖母" },
  { terms: ["你孙子"], types: ["GRANDCHILD_OF"], sex: "male", label: "孙子" },
  { terms: ["你孙女"], types: ["GRANDCHILD_OF"], sex: "female", label: "孙女" },
  { terms: ["你兄弟"], types: ["SIBLING_OF"], sex: "male", label: "兄弟" },
  { terms: ["你姐妹"], types: ["SIBLING_OF"], sex: "female", label: "姐妹" },
  { terms: ["你妻子", "你夫人"], types: ["SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"], sex: "female", label: "妻子" },
  { terms: ["你丈夫", "你夫君"], types: ["SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"], sex: "male", label: "丈夫" }
];
const MAX_RELATION_CANDIDATES = 50;

function findRelationMention(query = "") {
  const text = String(query || "").replace(/你的/g, "你");
  const matches = RELATION_MENTIONS.flatMap((mention) => mention.terms.map((term) => ({ mention, index: text.lastIndexOf(term.replace(/你的/g, "你")), term }))).filter((match) => match.index >= 0);
  return matches.sort((left, right) => right.index - left.index || right.term.length - left.term.length)[0] || null;
}

function resolveRelationMention({ query = "", responderId = null, graph = null, recentTargetId = null } = {}) {
  const match = findRelationMention(query);
  if (!match || !graph || responderId === null || responderId === undefined) return { status: "RELATION_UNKNOWN", mention: match?.term || null, candidates: [] };
  const allCandidates = graph.relationsTo(responderId).filter((edge) => match.mention.types.includes(edge.type)).map((edge) => {
    const target = graph.nodes.get(edge.from) || { id: edge.from };
    const sex = resolveCharacterSexConsensus({ snapshot: target });
    const resolution = graph.relationBetween(edge.from, responderId);
    return { runtimeId: String(edge.from), name: target.fullName || target.shortName || target.firstName || `#${edge.from}`, relation: resolution.relation, sex };
  });
  const summarize = values => values.slice(0, MAX_RELATION_CANDIDATES).map((candidate) => ({ runtimeId: candidate.runtimeId, name: candidate.name }));
  if (graph.scopeTruncated) return { status: "RELATION_SOURCE_INCOMPLETE", mention: match.term, candidates: summarize(allCandidates), candidateTotal: allCandidates.length, truncated: true };
  if (allCandidates.some((candidate) => candidate.sex.conflict)) return { status: "RELATION_GENDER_CONFLICT", mention: match.term, candidates: summarize(allCandidates), candidateTotal: allCandidates.length, truncated: allCandidates.length > MAX_RELATION_CANDIDATES };
  const candidates = allCandidates.filter((candidate) => !match.mention.sex || candidate.sex.sex === match.mention.sex);
  if (candidates.length === 1) return { status: "RELATION_RESOLVED", mention: match.term, targetRuntimeId: candidates[0].runtimeId, relation: candidates[0].relation, candidates: summarize(candidates), candidateTotal: 1, truncated: false };
  const recent = candidates.find((candidate) => String(candidate.runtimeId) === String(recentTargetId));
  if (recent) return { status: "RELATION_RESOLVED", mention: match.term, targetRuntimeId: recent.runtimeId, relation: recent.relation, resolvedBy: "RECENT_RUNTIME_CONTEXT", candidates: summarize(candidates), candidateTotal: candidates.length, truncated: candidates.length > MAX_RELATION_CANDIDATES };
  return { status: candidates.length ? "RELATION_AMBIGUOUS" : "RELATION_UNKNOWN", mention: match.term, candidates: summarize(candidates), candidateTotal: candidates.length, truncated: candidates.length > MAX_RELATION_CANDIDATES };
}

module.exports = { findRelationMention, resolveRelationMention };
