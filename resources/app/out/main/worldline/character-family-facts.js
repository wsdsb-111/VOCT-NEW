"use strict";

const crypto = require("crypto");
const { resolveCharacterAge } = require("./character-age-service");
const { normalizeSpouseRecords } = require("./canonical-spouse-record");
const { getCachedKinshipGraph } = require("./kinship-graph-cache");
const { formatDeathFact, resolveLifeStatus } = require("./character-temporal-facts");
const { resolveKinshipLabel } = require("./kinship-label-resolver");
const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");
const { resolveAnchoredRelationMention } = require("./anchored-relation-resolver");
const { buildFamilyEntityFactBundle } = require("./family-entity-fact-bundle");
const { resolveRelationshipCurrentTruth } = require("./relationship-current-truth");

const DISPLAY_TYPES = new Set(["PARENT_OF", "CHILD_OF", "SIBLING_OF", "GRANDPARENT_OF", "AUNT_UNCLE_OF", "NIECE_NEPHEW_OF", "COUSIN_OF", "SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"]);

function characterName(character, id) {
  return character?.fullName || character?.shortName || character?.firstName || character?.name || `#${id}`;
}

function isExplicitCurrentAgeQuestion(query) {
  const text = String(query || "").normalize("NFKC").trim();
  if (!text || /(?:去年|前年|前些年|过去|以前|曾经|当年|那年|那时|当时|明年|后年|未来|将来|几年后|[零〇一二两三四五六七八九十百千]+年后|\d{3,6}\s*年|生前|去世时|去世时候|死亡时|死亡时候|死时|死的时候|终年|临终|historical|last year|years? ago|at (?:death|the time))/iu.test(text)) return false;
  return /(?:多大(?:了)?|几岁(?:了)?|多少岁|年龄|年纪|how old|what age|current age)/iu.test(text);
}

function sourceBoundSpouseProfile(anchorCharacter, targetRuntimeId, relationAnchorRuntimeId, relationTypes) {
  if (!anchorCharacter) return null;
  const record = normalizeSpouseRecords(anchorCharacter).find(item => String(item.runtimeId) === String(targetRuntimeId)
    && (relationTypes.includes("SPOUSE_OF") && item.relationType === "CURRENT_SPOUSE"
      || relationTypes.includes("FORMER_SPOUSE_OF") && item.relationType === "FORMER_SPOUSE"
      || relationTypes.includes("DECEASED_SPOUSE_OF") && item.relationType === "DECEASED_SPOUSE"));
  if (!record || !record.raw || typeof record.raw !== "object") return null;
  const raw = record.raw;
  const age = raw.age === null || raw.age === undefined || raw.age === "" ? NaN : Number(raw.age);
  const hasRelativeAge = Number.isInteger(age) && age >= 0
    && ["CK3_CURRENT_AGE", "CK3_LIVE_RELATIVE_AGE"].includes(raw.ageSource);
  const source = `spouse.${record.source}`;
  const sourceOwnerId = Number(relationAnchorRuntimeId);
  const ageSource = hasRelativeAge ? "CK3_LIVE_RELATIVE_AGE" : raw.ageSource;
  const ageEvidence = [...(raw.evidence?.age || [])];
  if (hasRelativeAge && !ageEvidence.some(item => item.ageSource === "CK3_LIVE_RELATIVE_AGE" && Number(item.value) === age)) {
    ageEvidence.push({ value: age, ageSource, sourceOwnerId, relationType: "spouse", source });
  }
  return {
    ...raw,
    ageSource,
    evidence: {
      ...raw.evidence,
      age: ageEvidence,
      relations: [...(raw.evidence?.relations || []), { ownerId: sourceOwnerId, relationType: "spouse", source }]
    }
  };
}

function sourceBoundFamilyProfile(gameData, targetRuntimeId, relationResolution) {
  if (!gameData || targetRuntimeId === null || targetRuntimeId === undefined) return null;
  const targetId = Number(targetRuntimeId);
  const anchorId = Number(relationResolution?.relationAnchorRuntimeId);
  const characters = gameData.characters;
  const canonical = characters instanceof Map ? characters.get(targetId) || characters.get(String(targetId)) : characters?.[targetId];
  const anchorCharacter = characters instanceof Map ? characters.get(anchorId) || characters.get(String(anchorId)) : characters?.[anchorId];
  const profiles = typeof gameData.getMentionableCharacterProfiles === "function"
    ? gameData.getMentionableCharacterProfiles()
    : characters;
  const profile = profiles instanceof Map ? profiles.get(targetId) || profiles.get(String(targetId)) : profiles?.[targetId];
  if (canonical) return profile;
  if (profile) {
    const pathIds = new Set((relationResolution?.relation?.relationPath || [targetId, anchorId]).map(String));
    pathIds.add(String(anchorId));
    const validTypes = new Set(["parent", "child", "sibling", "spouse"]);
    const relationBound = (profile.evidence?.relations || []).some(evidence => pathIds.has(String(evidence.ownerId))
      && validTypes.has(evidence.relationType) && typeof evidence.source === "string" && evidence.source.length > 0);
    const sourceBound = [
      ...(profile.evidence?.age || []),
      ...(profile.evidence?.birthDate || []),
      ...(profile.evidence?.birthDateText || [])
    ].some(evidence => pathIds.has(String(evidence.sourceOwnerId))
      && validTypes.has(evidence.relationType) && typeof evidence.source === "string" && evidence.source.length > 0);
    if (relationBound && sourceBound) return profile;
  }
  const relationTypes = relationResolution?.intent?.relationTypes || [];
  const spouseType = relationTypes.some(type => ["SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"].includes(type));
  return spouseType ? sourceBoundSpouseProfile(anchorCharacter, targetId, anchorId, relationTypes) : null;
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
  return { text: parts.join("；"), diagnostics: { sexSource: sex.source, ageSource: age.ageSource, ageConflict: age.conflict, rawAge: age.rawAge, calculatedCalendarAge: age.calculatedCalendarAge, asOfGameDate: age.asOfGameDate, lifeStatusConflict, death: death?.fact || null } };
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

function buildFamilyFactBlock(character, gameData, { query = "", recentTargetId = null, currentFactRegistry = null, ageAuthorityGameData = null, ageDiagnostics = null } = {}) {
  if (!character?.id || !gameData) return null;
  const graph = getCachedKinshipGraph(gameData);
  const temporal = { currentGameDate: gameData.date, currentTotalDays: gameData.totalDays };
  let relationResolution = query ? resolveAnchoredRelationMention({ query, responderId: character.id, graph, recentTargetId }) : null;
  // A family inventory is not a request to select one ambiguous person.
  if (relationResolution?.status === "NO_RELATION_INTENT") relationResolution = null;
  if (relationResolution?.intent?.sourcePhrase) {
    console.log(`[VOTC Relation] query=${String(query).replace(/\s+/g, " ").trim()} intent=${relationResolution.intent.relationTypes.join(",") || "NONE"} sex=${relationResolution.intent.sexConstraint || "unknown"} anchorMention=${relationResolution.anchor.mention || "-"} anchorRuntimeId=${relationResolution.relationAnchorRuntimeId || "-"} targetRuntimeId=${relationResolution.targetRuntimeId || "-"} targetName=${relationResolution.target?.name || "-"} resolution=${relationResolution.status}`);
  }
  const canUseSourceAge = isExplicitCurrentAgeQuestion(query) && relationResolution?.status === "RELATION_RESOLVED";
  const selectedTargetId = canUseSourceAge ? String(relationResolution.targetRuntimeId) : null;
  let selectedAge = null;
  if (canUseSourceAge) {
    const sourceCharacter = sourceBoundFamilyProfile(ageAuthorityGameData, selectedTargetId, relationResolution);
    selectedAge = resolveCharacterAge(sourceCharacter || {}, {
      currentGameDate: ageAuthorityGameData?.date ?? gameData.date,
      currentTotalDays: ageAuthorityGameData?.totalDays ?? gameData.totalDays
    });
    if (Array.isArray(ageDiagnostics)) {
      ageDiagnostics.push({
        characterIdHash: crypto.createHash("sha256").update(selectedTargetId).digest("hex"),
        ageSource: selectedAge.ageSource,
        rawAge: selectedAge.rawAge,
        calculatedCalendarAge: selectedAge.calculatedCalendarAge,
        ageConflict: selectedAge.conflict,
        asOfGameDate: selectedAge.asOfGameDate
      });
    }
  }
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
    : graph.relationsTo(character.id).filter((edge) => DISPLAY_TYPES.has(edge.type) && (!query || ["PARENT_OF", "CHILD_OF", "SIBLING_OF", "SPOUSE_OF"].includes(edge.type))));
  const seen = new Set();
  const lines = [];
  for (const edge of relations) {
    if (lines.length >= 32) {
      lines.push("- 本次家庭列表已截断；未列出不等于不存在，不得据此推断亲属总人数。");
      break;
    }
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
    const currentFact = resolveRelationshipCurrentTruth({ gameData, subjectRuntimeId: edge.from, anchorRuntimeId: relationAnchorId, registry: currentFactRegistry });
    const sex = { sex: currentFact?.currentState?.sex || "unknown", conflict: currentFact?.evidence?.conflicts?.length > 0 };
    const label = currentFact?.relations[String(relationAnchorId)]?.label || resolveKinshipLabel({ type: edge.type, sex: "unknown", branch: edge.branch });
    const death = bundle.death ? { fact: bundle.death, text: formatDeathFact(relative, { ...temporal, characters: graph.nodes })?.text || "已故" } : null;
    const lifeStatus = resolveLifeStatus(relative);
    const age = selectedTargetId === String(edge.from) && selectedAge ? selectedAge : { age: bundle.age, label: bundle.ageLabel };
    const details = [];
    if (!bundle.sourceComplete) details.push("来源范围不完整");
    if (sex.conflict && sex.sex === "unknown") details.push("性别数据存在冲突，未输出性别结论");
    if (lifeStatus.conflict) details.push("生死状态存在冲突，未输出结论");
    else if (death) {
      details.push(death.text);
      if (age.label === "ageAtDeath" && age.age !== null && !/终年\s*\d+\s*岁/u.test(death.text)) details.push(`终年${age.age}岁`);
    }
    else if (lifeStatus.alive === true) details.push("在世");
    if (selectedTargetId === String(edge.from) && age.age === null) {
      details.push(age.label === "ageAtDeath" ? "去世年龄未知"
        : age.ageSource === "AGE_SOURCE_CONFLICT" ? "年龄来源冲突，当前年龄未知"
          : age.ageSource === "LIFE_STATUS_CONFLICT" ? "生死状态冲突，年龄未知" : "当前年龄未知（缺少可信年龄来源）");
    }
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

module.exports = { buildFamilyFactBlock, formatStructuredCharacter, buildUnresolvedRelationConstraint, isExplicitCurrentAgeQuestion };
