"use strict";

const { getCachedKinshipGraph } = require("./kinship-graph-cache");
const { normalizeSex, resolveCharacterSexConsensus } = require("./character-demographic-normalizer");
const { resolveCharacterAge } = require("./character-age-service");
const { resolveLifeStatus } = require("./character-temporal-facts");
const { resolveKinshipLabel } = require("./kinship-label-resolver");
const { createRelationshipResolver } = require("../game-data/relationship-resolver");

function neutralLabel(type, fallback = "近亲") {
  if (type === "SIBLING_OF") return "手足";
  if (type === "PARENT_OF") return "父母";
  if (type === "CHILD_OF") return "子女";
  if (type === "SPOUSE_OF") return "配偶";
  if (type === "FORMER_SPOUSE_OF") return "前配偶";
  if (type === "DECEASED_SPOUSE_OF") return "已故配偶";
  return fallback;
}

function relationSideSex(profile, gameData, subjectRuntimeId) {
  const values = new Set((profile?.evidence?.gender || [])
    .filter((item) => item.priority > 1)
    .map((item) => item.value)
    .filter((value) => value === "male" || value === "female"));
  for (const character of gameData?.characters?.values?.() || []) {
    for (const field of ["parents", "children", "siblings"]) {
      for (const entry of character?.[field] || []) {
        if (Number(entry?.id) !== Number(subjectRuntimeId)) continue;
        const sex = normalizeSex(entry.gender ?? entry.sex ?? entry.female);
        if (sex !== "unknown") values.add(sex);
      }
    }
  }
  return { sex: values.size === 1 ? [...values][0] : "unknown", values: [...values], conflict: values.size > 1 };
}

function resolveRelationshipCurrentTruth({ gameData, subjectRuntimeId, anchorRuntimeId, registry = null } = {}) {
  const subjectId = Number(subjectRuntimeId);
  const anchorId = anchorRuntimeId == null ? null : Number(anchorRuntimeId);
  if (!gameData || !Number.isFinite(subjectId)) return null;
  const graph = getCachedKinshipGraph(gameData);
  const hasRuntimeStore = gameData.characters instanceof Map || gameData.characters && typeof gameData.characters === "object";
  const canonical = gameData.characters instanceof Map
    ? gameData.characters.get(subjectId) || null
    : gameData.characters?.[subjectId] || gameData.characters?.[String(subjectId)] || (!hasRuntimeStore ? graph.nodes.get(String(subjectId)) || null : null);
  const profile = graph.nodes.get(String(subjectId)) || canonical || null;
  if (!profile) return null;
  const canonicalResolution = canonical ? resolveCharacterSexConsensus({ snapshot: canonical }) : { sex: "unknown", conflict: false };
  const canonicalSex = canonicalResolution.sex;
  const sideEvidence = relationSideSex(profile, gameData, subjectId);
  const conflicts = [];
  if (canonicalResolution.conflict) conflicts.push("CURRENT_RUNTIME_GENDER_CONFLICT");
  if (sideEvidence.conflict || canonicalSex !== "unknown" && sideEvidence.values.some((value) => value !== canonicalSex)) conflicts.push("RELATION_SIDE_GENDER_CONFLICT");
  const sex = canonicalSex;
  const relationResult = Number.isFinite(anchorId) ? graph.relationBetween(subjectId, anchorId) : { relation: null, diagnostic: null };
  const anchor = gameData.characters instanceof Map
    ? gameData.characters.get(anchorId) || null
    : gameData.characters?.[anchorId] || gameData.characters?.[String(anchorId)] || graph.nodes.get(String(anchorId)) || null;
  const legacyResolution = canonical && anchor ? createRelationshipResolver().resolveDirectKinship({ ...canonical, gender: sex }, anchor) : null;
  const legacyType = legacyResolution?.type === "parent" ? "PARENT_OF" : legacyResolution?.type === "child" ? "CHILD_OF" : legacyResolution?.type === "sibling" ? "SIBLING_OF" : null;
  const relation = relationResult.relation || (legacyType ? { type: legacyType, source: "CURRENT_RUNTIME_RELATION", branch: null } : null);
  const relationLabel = relation ? (sex === "unknown" ? neutralLabel(relation.type, relation.label) : legacyType === relation.type ? legacyResolution.label : resolveKinshipLabel({ type: relation.type, sex, branch: relation.branch })) : null;
  const life = resolveLifeStatus(canonical || profile);
  const age = resolveCharacterAge(canonical || profile, { currentGameDate: gameData.date, currentTotalDays: gameData.totalDays });
  const fact = registry?.get(String(subjectId)) || {
    runtimeId: subjectId,
    identity: {
      shortName: canonical?.shortName || profile.shortName || profile.firstName || `#${subjectId}`,
      fullName: canonical?.fullName || profile.fullName || profile.shortName || `#${subjectId}`
    },
    currentState: {
      sex,
      alive: life.alive,
      age: age.age
    },
    relations: {},
    evidence: {
      sexSource: canonicalSex === "unknown" ? "UNKNOWN" : "CURRENT_RUNTIME",
      relationSource: relation?.source || "KINSHIP_GRAPH",
      sourceComplete: graph.scopeTruncated !== true && profile.partial !== true,
      conflicts,
      memoryUsedForCurrentSex: false,
      canonicalSex,
      relationSideSex: sideEvidence.sex,
      relationSideSexes: sideEvidence.values,
      historicalSex: "NOT_CONSULTED",
      memorySex: "NOT_CONSULTED",
      selectedSex: sex,
      selectedSexSource: canonicalSex === "unknown" ? "UNKNOWN" : "CURRENT_RUNTIME"
    }
  };
  fact.evidence.conflicts = [...new Set([...(fact.evidence.conflicts || []), ...conflicts])];
  if (Number.isFinite(anchorId)) fact.relations[String(anchorId)] = relation ? {
    type: relation.type,
    label: relationLabel,
    anchorRuntimeId: anchorId
  } : null;
  if (registry) registry.set(String(subjectId), fact);
  return fact;
}

module.exports = { resolveRelationshipCurrentTruth };
