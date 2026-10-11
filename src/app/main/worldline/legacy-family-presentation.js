"use strict";

const { getCachedKinshipGraph } = require("./kinship-graph-cache");
const { resolveRelationshipCurrentTruth } = require("./relationship-current-truth");
const { resolveCharacterAge } = require("./character-age-service");
const { formatDeathFact } = require("./character-temporal-facts");

const FAMILY_TYPES = new Set(["PARENT_OF", "CHILD_OF", "SIBLING_OF", "GRANDPARENT_OF", "GRANDCHILD_OF", "AUNT_UNCLE_OF", "COUSIN_OF", "NIECE_NEPHEW_OF", "SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"]);
const ENGLISH_LABELS = {
  父亲: "father", 母亲: "mother", 父母: "parent", 儿子: "son", 女儿: "daughter", 子女: "child",
  哥哥: "older brother", 弟弟: "younger brother", 姐姐: "older sister", 妹妹: "younger sister", 兄弟: "brother", 姐妹: "sister", 手足: "sibling", 兄弟姐妹: "sibling",
  祖父: "paternal grandfather", 祖母: "paternal grandmother", 外祖父: "maternal grandfather", 外祖母: "maternal grandmother", 祖辈亲属: "grandparent",
  伯父: "father's older brother", 叔父: "father's younger brother", 叔伯: "father's brother (seniority unknown)", 姑母: "father's sister", 舅父: "mother's brother", 姨母: "mother's sister",
  父系叔伯姑: "father's sibling", 母系舅姨: "mother's sibling", 叔伯辈亲属: "parent's sibling",
  堂哥: "older male paternal parallel cousin", 堂姐: "older female paternal parallel cousin", 堂弟: "younger male paternal parallel cousin", 堂妹: "younger female paternal parallel cousin", 堂亲: "paternal parallel cousin",
  表哥: "older male cross/maternal cousin", 表姐: "older female cross/maternal cousin", 表弟: "younger male cross/maternal cousin", 表妹: "younger female cross/maternal cousin", 表亲: "cross/maternal cousin", 堂表亲: "cousin (branch unknown)",
  丈夫: "husband", 妻子: "wife", 配偶: "spouse", 前夫: "former husband", 前妻: "former wife", 前配偶: "former spouse", 亡夫: "deceased husband", 亡妻: "deceased wife", 已故配偶: "deceased spouse",
  孙辈男亲: "grandson", 孙辈女亲: "granddaughter", 孙辈: "grandchild", 晚辈近亲: "niece/nephew"
};

function buildLegacyFamilyLine(character, gameData, { limit = 32, registry = null } = {}) {
  const graph = getCachedKinshipGraph(gameData);
  const edges = graph.relationsTo(character.id).filter(edge => FAMILY_TYPES.has(edge.type));
  const seen = new Set();
  const lines = [];
  let truncated = graph.scopeTruncated === true;
  for (const edge of edges) {
    if (seen.has(edge.from)) continue;
    seen.add(edge.from);
    if (lines.length >= limit) { truncated = true; break; }
    const fact = resolveRelationshipCurrentTruth({ gameData, subjectRuntimeId: edge.from, anchorRuntimeId: character.id, registry });
    const relation = fact?.relations[String(character.id)];
    if (!relation) continue;
    const profile = graph.nodes.get(edge.from) || {};
    const age = resolveCharacterAge(profile, { currentGameDate: gameData.date, currentTotalDays: gameData.totalDays });
    const state = fact.currentState;
    const details = [`sex: ${state.sex}`, `${age.label}: ${state.age ?? "unknown"}`, `life: ${state.alive === true ? "alive" : state.alive === false ? "dead" : "unknown"}`];
    const death = formatDeathFact(profile, { currentGameDate: gameData.date, currentTotalDays: gameData.totalDays, characters: graph.nodes });
    if (death) details.push(`death: ${death.text}`);
    if (profile.maritalStatus) details.push(`marital status: ${profile.maritalStatus}`);
    const traits = (profile.traits || []).map(trait => typeof trait === "string" ? trait : trait.name).filter(Boolean);
    if (traits.length) details.push(`traits: ${traits.join(", ")}`);
    if (!fact.evidence.sourceComplete) details.push("partial source");
    const viaId = edge.relationPath.length > 2 ? edge.relationPath[1] : null;
    if (viaId) details.push(`via #${viaId}`);
    lines.push(`${fact.identity.fullName} (#${edge.from}) = ${ENGLISH_LABELS[relation.label] || "relative"} (${relation.label}); ${details.join("; ")}`);
  }
  if (!lines.length && !truncated) return { text: null, count: 0 };
  return {
    text: `current CK3 family of ${character.fullName || character.shortName} (#${character.id}): ${lines.join(" | ")}${truncated ? " | Family list truncated; omitted relatives are not necessarily absent." : ""}. Current CK3 facts override memory and name-based guesses; unknown sex/age/seniority must remain unknown.`,
    count: lines.length
  };
}

module.exports = { buildLegacyFamilyLine };
