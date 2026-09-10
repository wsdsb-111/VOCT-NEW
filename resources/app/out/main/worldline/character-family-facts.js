"use strict";

const { resolveCharacterAge } = require("./character-age-service");
const { normalizeSpouseRecords } = require("./canonical-spouse-record");
const { getCachedKinshipGraph } = require("./kinship-graph-cache");
const { formatDeathFact, resolveLifeStatus } = require("./character-temporal-facts");
const { resolveKinshipLabel } = require("./kinship-label-resolver");
const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");
const { resolveAnchoredRelationMention } = require("./anchored-relation-resolver");
const { buildFamilyEntityFactBundle } = require("./family-entity-fact-bundle");

const DISPLAY_TYPES = new Set(["PARENT_OF", "CHILD_OF", "SIBLING_OF", "GRANDPARENT_OF", "AUNT_UNCLE_OF", "NIECE_NEPHEW_OF", "COUSIN_OF", "SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"]);

function characterName(character, id) {
  return character?.fullName || character?.shortName || character?.firstName || character?.name || `#${id}`;
}

function formatStructuredCharacter(character = {}, current = null, characters = null) {
  const temporal = current && typeof current === "object" ? current : { currentGameDate: current };
  const id = String(character.id ?? "");
  const name = characterName(character, id);
  const sex = resolveCharacterSexConsensus({ snapshot: character });
  const age = resolveCharacterAge(character, temporal);
  const death = formatDeathFact(character, { ...temporal, characters });
  const lifeStatus = resolveLifeStatus(character);
  const lifeStatusConflict = lifeStatus.conflict;
  const parts = [`${name} (#${id || "未知"})`, `性别：${sex.sex === "male" ? "男性" : sex.sex === "female" ? "女性" : "未知"}`];
  if (age.age !== null) parts.push(`${age.label === "ageAtDeath" ? "去世年龄" : "年龄"}：${age.age}岁`);
  if (lifeStatusConflict) parts.push("生死状态：存在冲突，未输出结论");
  else if (death) parts.push(death.text);
  else if (lifeStatus.alive === true) parts.push("在世");
  if (character.location) parts.push(`当前位置：${character.location}`);
  return { text: parts.join("；"), diagnostics: { sexSource: sex.source, ageSource: age.source, ageConflict: age.conflict, lifeStatusConflict, death: death?.fact || null } };
}

function buildFamilyFactBlock(character, gameData, { query = "", recentTargetId = null } = {}) {
  if (!character?.id || !gameData) return null;
  const graph = getCachedKinshipGraph(gameData);
  const temporal = { currentGameDate: gameData.date, currentTotalDays: gameData.totalDays };
  const relationResolution = query ? resolveAnchoredRelationMention({ query, responderId: character.id, graph, recentTargetId }) : null;
  if (relationResolution?.intent?.sourcePhrase) {
    console.log(`[VOTC Relation] query=${String(query).replace(/\s+/g, " ").trim()} intent=${relationResolution.intent.relationTypes.join(",") || "NONE"} sex=${relationResolution.intent.sexConstraint || "unknown"} anchorMention=${relationResolution.anchor.mention || "-"} anchorRuntimeId=${relationResolution.relationAnchorRuntimeId || "-"} targetRuntimeId=${relationResolution.targetRuntimeId || "-"} targetName=${relationResolution.target?.name || "-"} resolution=${relationResolution.status}`);
  }
  if (relationResolution?.status === "NO_RELATION_INTENT") return null;
  if (relationResolution?.status === "RELATION_AMBIGUOUS") {
    return `=== 当前结构化家庭事实（本轮 CK3 数据） ===\n- “${relationResolution.mention}”存在多个候选，系统未选择任何人，也未注入任一候选的私有事实。\n权威规则：需要玩家提供姓名或更明确的上下文后再继续。`;
  }
  if (relationResolution && relationResolution.status !== "NO_RELATION_INTENT" && relationResolution.status !== "RELATION_RESOLVED") {
    if (relationResolution.intent.sexConstraint) {
      const sexLabel = relationResolution.intent.sexConstraint === "male" ? "男性" : "女性";
      return `=== 当前结构化亲属约束（本轮查询） ===\n- 玩家明确称目标为“${relationResolution.mention}”，该目标必须作为${sexLabel}亲属处理。\n权威规则：关系主体或具体人物尚未可靠解析时，不得将该目标改写为${relationResolution.intent.sexConstraint === "male" ? "女性、女儿、她、女子" : "男性、儿子、他、男子"}。不得用 Memory 或模型推测覆盖本约束。`;
    }
    return null;
  }
  const relations = (relationResolution
    && relationResolution.status === "RELATION_RESOLVED"
    ? graph.relationsTo(relationResolution.relationAnchorRuntimeId).filter((edge) => String(edge.from) === String(relationResolution.targetRuntimeId))
    : graph.relationsTo(character.id).filter((edge) => DISPLAY_TYPES.has(edge.type)));
  const seen = new Set();
  const lines = [];
  for (const edge of relations) {
    const key = `${edge.from}:${edge.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const relative = graph.nodes.get(edge.from) || {};
    const relationAnchorId = relationResolution?.relationAnchorRuntimeId || character.id;
    const resolution = graph.relationBetween(edge.from, relationAnchorId);
    if (!resolution.relation) continue;
    const bundle = buildFamilyEntityFactBundle({ graph, responderId: character.id, relationAnchorId, targetRuntimeId: edge.from, temporal });
    if (!bundle) continue;
    const sex = resolveCharacterSexConsensus({ snapshot: relative });
    const label = resolveKinshipLabel({ type: edge.type, sex: sex.sex, branch: edge.branch });
    const death = bundle.death ? { fact: bundle.death, text: formatDeathFact(relative, { ...temporal, characters: graph.nodes })?.text || "已故" } : null;
    const lifeStatus = resolveLifeStatus(relative);
    const age = { age: bundle.age, label: bundle.ageLabel };
    const details = [];
    if (lifeStatus.conflict) details.push("生死状态存在冲突，未输出结论");
    else if (death) details.push(death.text);
    else if (lifeStatus.alive === true) details.push("在世");
    if (!death && age.age !== null) details.push(`${age.age}岁`);
    if (relationResolution?.status === "RELATION_RESOLVED") {
      const anchor = graph.nodes.get(String(relationAnchorId)) || {};
      lines.push(`- 查询关系主体：${characterName(anchor, relationAnchorId)}；查询关系：${relationResolution.intent.label || label}；目标人物：${characterName(relative, edge.from)}（Runtime ID：${edge.from}；性别：${sex.sex === "male" ? "男性" : sex.sex === "female" ? "女性" : "未知"}${details.length ? `；${details.join("；")}` : ""}）`);
    } else {
      lines.push(`- ${label}：${characterName(relative, edge.from)}${details.length ? `（${details.join("；")}）` : ""}`);
    }
  }
  for (const spouse of relationResolution ? [] : normalizeSpouseRecords(character).filter((record) => record.runtimeId === null && record.name)) {
    lines.push(`- 配偶/伴侣（未绑定角色）：${spouse.name}`);
  }
  if (!lines.length) return null;
  return `=== 当前结构化家庭事实（本轮 CK3 数据） ===\n${lines.join("\n")}\n权威规则：亲属身份、性别、是否已故、死亡日期和年龄以本块结构化结果为准；相对时间只能使用系统给出的结果。若本块明确给出致死者，则以本块为准；若本块未给出致死者，可使用后续获准的 Current Game Truth / Worldline Game Truth。不得从 Memory 或模型推测致死者。Memory 只可补充过去经历与主观感受，不得覆盖这些事实。`;
}

module.exports = { buildFamilyFactBlock, formatStructuredCharacter };
