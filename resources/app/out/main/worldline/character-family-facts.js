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

function buildUnresolvedRelationConstraint(result) {
  const sex = result?.intent?.sexConstraint || null;
  const sexLabel = sex === "male" ? "男性亲属（仅用于查询筛选）" : sex === "female" ? "女性亲属（仅用于查询筛选）" : "无";
  const opposite = sex === "male" ? "女性、女儿、她、女子" : sex === "female" ? "男性、儿子、他、男子" : null;
  return `=== 当前亲属查询未完成解析 ===
- 查询关系：${result?.intent?.sourcePhrase || "未知"}
- 当前解析状态：${result?.status || "UNKNOWN"}
- 玩家语义性别约束：${sexLabel}
权威规则：
- 当前无法可靠确定具体关系主体或目标 Runtime ID。
- 不得输出具体人物姓名、年龄、位置、生死状态、头衔、配偶或私人事实。
- 不得从 Memory、历史常识或模型猜测中选择某个具体人物。
- 玩家语义中的性别只能作为 Query Constraint，不得升级为某个 Runtime Character 的 CK3 Game Truth。${opposite ? `\n- 不得将该目标改写为${opposite}。` : ""}`;
}

function buildGenderConflictConstraint(result) {
  return `=== 当前结构化亲属事实冲突（本轮 CK3 数据） ===
- 玩家使用了“${result?.mention || result?.intent?.sourcePhrase || "亲属"}”这一称谓。
- 当前 CK3 / Canonical 数据对候选人物性别存在冲突。
- 系统不能确认该人物为男性或女性。
权威规则：
- 不得依据玩家称谓替代 CK3 性别事实。
- 不得输出男性、女性、儿子、女儿、他、她等确定性性别结论。
- 不得从 Memory 或模型猜测具体人物；需要更多当前游戏数据后才能确定。`;
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
  if (relationResolution?.status === "RELATION_GENDER_CONFLICT") return buildGenderConflictConstraint(relationResolution);
  if (relationResolution?.status === "RELATION_AMBIGUOUS") {
    return `=== 当前结构化家庭事实（本轮 CK3 数据） ===\n- “${relationResolution.mention}”存在多个候选，系统未选择任何人，也未注入任一候选的私有事实。\n${buildUnresolvedRelationConstraint(relationResolution)}`;
  }
  if (relationResolution && relationResolution.status !== "NO_RELATION_INTENT" && relationResolution.status !== "RELATION_RESOLVED") {
    return buildUnresolvedRelationConstraint(relationResolution);
  }
  const relations = (relationResolution
    && relationResolution.status === "RELATION_RESOLVED"
    ? graph.relationsTo(relationResolution.relationAnchorRuntimeId).filter((edge) => String(edge.from) === String(relationResolution.targetRuntimeId) && relationResolution.intent.relationTypes.includes(edge.type))
    : graph.relationsTo(character.id).filter((edge) => DISPLAY_TYPES.has(edge.type)));
  const seen = new Set();
  const lines = [];
  for (const edge of relations) {
    const key = `${edge.from}:${edge.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const relative = graph.nodes.get(edge.from) || {};
    const relationAnchorId = relationResolution?.relationAnchorRuntimeId || character.id;
    const resolution = relationResolution?.status === "RELATION_RESOLVED" && typeof graph.relationBetweenOfTypes === "function"
      ? graph.relationBetweenOfTypes(edge.from, relationAnchorId, relationResolution.intent.relationTypes)
      : graph.relationBetween(edge.from, relationAnchorId);
    if (!resolution.relation) continue;
    const bundle = buildFamilyEntityFactBundle({ graph, responderId: character.id, relationAnchorId, targetRuntimeId: edge.from, relationTypes: relationResolution?.intent?.relationTypes || null, temporal });
    if (!bundle) continue;
    const sex = resolveCharacterSexConsensus({ snapshot: relative });
    const label = resolveKinshipLabel({ type: edge.type, sex: sex.sex, branch: edge.branch });
    const death = bundle.death ? { fact: bundle.death, text: formatDeathFact(relative, { ...temporal, characters: graph.nodes })?.text || "已故" } : null;
    const lifeStatus = resolveLifeStatus(relative);
    const age = { age: bundle.age, label: bundle.ageLabel };
    const details = [];
    if (!bundle.sourceComplete) details.push("来源范围不完整");
    if (sex.conflict) details.push("性别数据存在冲突，未输出性别结论");
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

module.exports = { buildFamilyFactBlock, formatStructuredCharacter, buildUnresolvedRelationConstraint };
