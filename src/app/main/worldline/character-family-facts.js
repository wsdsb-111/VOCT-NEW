"use strict";

const crypto = require("crypto");
const { inferGenderFromPronoun } = require("../game-data/character");
const { createRelationshipResolver } = require("../game-data/relationship-resolver");
const { resolveCharacterAge } = require("./character-age-service");
const { normalizeSpouseRecords } = require("./canonical-spouse-record");
const { getCachedKinshipGraph, getTargetedKinshipGraph } = require("./kinship-graph-cache");
const { formatDeathFact, resolveLifeStatus } = require("./character-temporal-facts");
const { resolveKinshipLabel } = require("./kinship-label-resolver");
const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");
const { resolveAnchoredRelationMention } = require("./anchored-relation-resolver");
const { buildFamilyEntityFactBundle } = require("./family-entity-fact-bundle");
const { resolveRelationshipCurrentTruth } = require("./relationship-current-truth");
const { buildStepFamilyFactBlock, isStepFamilyQuery } = require("./step-family-facts");

const DISPLAY_TYPES = new Set(["PARENT_OF", "CHILD_OF", "STEP_PARENT_OF", "STEP_CHILD_OF", "STEP_SIBLING_OF", "SIBLING_OF", "GRANDPARENT_OF", "AUNT_UNCLE_OF", "NIECE_NEPHEW_OF", "COUSIN_OF", "SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"]);

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
  if (canonical && canonical.ageSource === "CK3_CURRENT_AGE" && Number.isInteger(canonical.age) && canonical.age >= 0) {
    return { ...canonical, ageEvidenceConflict: profile?.ageEvidenceConflict === true || canonical.ageEvidenceConflict === true,
      evidence: profile?.evidence || canonical.evidence };
  }
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

function buildParentQuery(character, graph, query, metrics, gameData) {
  const chained = String(query).match(/你(?:的)?(兄弟|姐妹|兄长|哥哥|弟弟|姐姐|妹妹)(?:的)?(母亲|父亲)/u);
  const comparison = /同父异母|同母异父/u.test(query);
  if (!chained && !comparison) return null;
  const siblingQuery = chained ? `你${chained[1]}是谁` : query;
  let sibling = resolveAnchoredRelationMention({ query: siblingQuery, responderId: character.id, graph });
  if (comparison && sibling.status === "NO_RELATION_INTENT") {
    const ids = [...new Set(graph.relationsTo(character.id).filter(edge => edge.type === "SIBLING_OF").map(edge => String(edge.from)))];
    metrics.edgeVisits += ids.length;
    const named = String(query).match(/(?:你和|你与)([^，,。？！?]{1,30}?)(?:是|算|属于|为)/u)?.[1]?.trim();
    const matching = named ? ids.filter(id => {
      const candidate = graph.nodes.get(id);
      return [candidate?.fullName, candidate?.shortName, candidate?.firstName, candidate?.name].some(name => name === named);
    }) : ids;
    sibling = { ...sibling, status: matching.length === 1 ? "RELATION_RESOLVED" : matching.length > 1 ? "RELATION_AMBIGUOUS" : "RELATION_UNKNOWN",
      targetRuntimeId: matching.length === 1 ? matching[0] : null, intent: { relationTypes: ["SIBLING_OF"], sourcePhrase: named || "你们" } };
  }
  if (sibling.status !== "RELATION_RESOLVED" || !sibling.intent.relationTypes.includes("SIBLING_OF")) {
    return buildUnresolvedRelationConstraint(sibling);
  }
  const parents = id => {
    const edges = graph.relationsTo(id).filter(edge => edge.type === "PARENT_OF");
    metrics.edgeVisits += edges.length;
    return edges.filter(edge => !edge.parentEvidenceConflict && (!edge.parentEvidence?.length || edge.parentEvidence.some(item => item.publicStatus === "PUBLIC_LEGAL_PARENT"
      && item.campaignToken === gameData.campaignToken && item.sourceSnapshotId === `${gameData.date}/${gameData.totalDays}`)))
      .map(edge => { metrics.nodeVisits++; return graph.nodes.get(String(edge.from)); }).filter(Boolean);
  };
  const targetParents = parents(sibling.targetRuntimeId);
  const parent = (records, sex) => {
    const matches = records.filter(item => resolveCharacterSexConsensus({ snapshot: item }).sex === sex);
    return matches.length === 1 ? matches[0] : null;
  };
  const targetName = characterName(graph.nodes.get(String(sibling.targetRuntimeId)), sibling.targetRuntimeId);
  let line;
  if (chained) {
    const selected = parent(targetParents, chained[2] === "母亲" ? "female" : "male");
    line = selected ? `${targetName}的${chained[2]}：${characterName(selected, selected.id)}` : `${targetName}的${chained[2]}：未知（缺少唯一可信公开来源）`;
  } else {
    const ownParents = parents(character.id);
    const father = parent(ownParents, "male"), mother = parent(ownParents, "female");
    const otherFather = parent(targetParents, "male"), otherMother = parent(targetParents, "female");
    const complete = father && mother && otherFather && otherMother;
    const sameFather = complete && String(father.id) === String(otherFather.id);
    const sameMother = complete && String(mother.id) === String(otherMother.id);
    line = !complete ? "双亲关系未知（缺少完整可信公开来源），不得猜测同父异母或同母异父。"
      : `${characterName(character, character.id)}与${targetName}：${sameFather && !sameMother ? "同父异母" : !sameFather && sameMother ? "同母异父" : sameFather && sameMother ? "同父同母" : "双亲均不同"}；${sameMother && !sameFather
        ? `共同母亲为${characterName(mother, mother.id)}；双方父亲分别为${characterName(father, father.id)}、${characterName(otherFather, otherFather.id)}`
        : `双方母亲分别为${characterName(mother, mother.id)}、${characterName(otherMother, otherMother.id)}`}。`;
  }
  return `=== 当前结构化家庭事实（本轮 CK3 数据） ===\n- ${line}\n权威规则：本块只提供有公开来源的定向双亲事实，不代表角色知道其他私人经历或秘密；不得补造未知父母，不得由共同子女推断父母彼此为配偶。`;
}

function currentAgeSnapshotMatches(ageAuthorityGameData, projectedGameData) {
  if (!ageAuthorityGameData || !projectedGameData) return false;
  const isValidSnapshot = gameData => Number.isSafeInteger(Number(gameData.totalDays)) && Number(gameData.totalDays) >= 0
    && typeof gameData.date === "string" && !!gameData.date.trim()
    && typeof gameData.campaignToken === "string" && !!gameData.campaignToken.trim();
  return isValidSnapshot(ageAuthorityGameData) && isValidSnapshot(projectedGameData)
    && ageAuthorityGameData.campaignToken === projectedGameData.campaignToken
    && ageAuthorityGameData.date === projectedGameData.date
    && Number(ageAuthorityGameData.totalDays) === Number(projectedGameData.totalDays);
}

function buildTrustedSeniorityContext(ageAuthorityGameData, projectedGameData, seedIds, projectedGraph) {
  if (!currentAgeSnapshotMatches(ageAuthorityGameData, projectedGameData)
    || !Array.isArray(seedIds) || !seedIds.length || !projectedGraph?.nodes || !Array.isArray(projectedGraph.edges)) return null;
  const currentTotalDays = Number(projectedGameData.totalDays);
  const rawGraph = getTargetedKinshipGraph(ageAuthorityGameData, [...new Set(seedIds.map(String))], { maxDepth: 3, maxNodes: 4096 });
  if (rawGraph.scopeTruncated) return null;
  const projectedEdgeKeys = new Set(projectedGraph.edges.map(edge => `${edge.type}:${edge.from}:${edge.to}`));
  const hasProjectedEdge = (ownerId, entryId, field) => {
    const owner = String(ownerId), target = String(entryId);
    const type = field === "parents" ? "CHILD_OF" : field === "children" ? "PARENT_OF" : "SIBLING_OF";
    return projectedEdgeKeys.has(`${type}:${owner}:${target}`);
  };
  const ageAuthorityNodes = new Map();
  for (const [id, character] of rawGraph.nodes) {
    const characterId = String(character?.id ?? id);
    if (!projectedGraph.nodes.has(characterId)) continue;
    const ageOnlyCharacter = { ...character };
    for (const field of ["parents", "children", "siblings"]) {
      const entries = Array.isArray(character?.[field]) ? character[field] : field === "parents" && character?.parents && typeof character.parents === "object"
        ? Object.values(character.parents) : [];
      ageOnlyCharacter[field] = entries.filter(entry => {
        const entryId = entry && typeof entry === "object" ? entry.id ?? entry.runtimeId ?? entry.characterId : entry;
        const targetId = entryId === null || entryId === undefined ? "" : String(entryId);
        return targetId && projectedGraph.nodes.has(targetId) && hasProjectedEdge(characterId, targetId, field);
      });
    }
    ageAuthorityNodes.set(characterId, ageOnlyCharacter);
  }
  const profiles = createRelationshipResolver().buildCanonicalProfiles(ageAuthorityNodes, currentTotalDays, inferGenderFromPronoun, {
    campaignToken: projectedGameData.campaignToken,
    sourceSnapshotId: `${projectedGameData.date}/${projectedGameData.totalDays}`
  });
  const profileFor = id => profiles.get(Number(id)) || profiles.get(String(id)) || null;
  const ageById = new Map();
  for (const [id, profile] of profiles) {
    if (!profile || profile.ageEvidenceConflict === true || profile.evidence?.conflicts?.age === true
      || profile.evidence?.conflicts?.lifeStatus === true) continue;
    const life = resolveLifeStatus(profile);
    if (life.conflict || life.alive === false) continue;
    const age = resolveCharacterAge(profile, {
      currentGameDate: projectedGameData.date,
      currentTotalDays: projectedGameData.totalDays,
      currentCampaignToken: projectedGameData.campaignToken
    });
    if (age.age !== null && !age.sourceConflict && ["CK3_CURRENT_AGE", "CK3_LIVE_RELATIVE_AGE"].includes(age.ageSource)) {
      ageById.set(String(id), age.age);
    }
  }
  const birthOrdinal = (profile, id) => {
    if (!profile || profile.evidence?.conflicts?.birthDate === true || profile.evidence?.resolvedBirthSource !== "characters") return null;
    const evidence = (profile.evidence.birthDate || []).filter(item => item.priority === 1
      && Number(item.sourceOwnerId) === Number(id) && item.relationType === "canonical" && item.source === "characters");
    const values = [...new Set(evidence.map(item => Number(item.value))
      .filter(value => Number.isSafeInteger(value) && value >= 0 && value <= currentTotalDays))];
    return values.length === 1 ? values[0] : null;
  };
  return {
    compare(subjectId, referenceId) {
      const subjectAge = ageById.get(String(subjectId));
      const referenceAge = ageById.get(String(referenceId));
      if (!Number.isInteger(subjectAge) || !Number.isInteger(referenceAge)) return null;
      if (subjectAge !== referenceAge) return subjectAge > referenceAge ? 1 : -1;
      const subject = profileFor(subjectId);
      const reference = profileFor(referenceId);
      const subjectBirth = birthOrdinal(subject, subjectId);
      const referenceBirth = birthOrdinal(reference, referenceId);
      if (subjectBirth !== null && referenceBirth !== null && subjectBirth !== referenceBirth) return subjectBirth < referenceBirth ? 1 : -1;
      return null;
    }
  };
}

function resolveAgeBoundAmbiguousRelation(relationResolution, graph, ageAuthorityGameData, projectedGameData) {
  if (relationResolution?.status !== "RELATION_AMBIGUOUS"
    || !["older", "younger"].includes(relationResolution.intent?.birthOrder)
    || !["BIRTH_ORDER_UNAVAILABLE", "ANCHOR_BIRTH_ORDER_UNAVAILABLE", "CANDIDATE_BIRTH_ORDER_UNAVAILABLE"].includes(relationResolution.reason)) return relationResolution;
  const candidates = relationResolution.candidates || [];
  if (!candidates.length || relationResolution.candidateTotal !== candidates.length) return relationResolution;
  const anchorId = relationResolution.relationAnchorRuntimeId;
  const rows = candidates.map(candidate => {
    const runtimeId = String(candidate.runtimeId);
    const result = typeof graph.relationBetweenOfTypes === "function"
      ? graph.relationBetweenOfTypes(runtimeId, anchorId, relationResolution.intent.relationTypes)
      : graph.relationBetween(runtimeId, anchorId);
    const relation = result?.relation;
    const referenceId = relation?.type === "AUNT_UNCLE_OF"
      ? relation.seniorityReferenceId ?? relation.relationPath?.[1]
      : anchorId;
    return { candidate, relation, referenceId, valid: !result?.diagnostic && !!relation && referenceId != null };
  });
  if (rows.some(row => !row.valid)) return relationResolution;
  const seniority = buildTrustedSeniorityContext(ageAuthorityGameData, projectedGameData,
    rows.flatMap(row => [row.candidate.runtimeId, row.referenceId]), graph);
  if (!seniority) return relationResolution;
  for (const row of rows) {
    row.order = seniority.compare(row.candidate.runtimeId, row.referenceId);
    if (row.order === null) return relationResolution;
  }
  const matches = rows.filter(row => relationResolution.intent.birthOrder === "older" ? row.order > 0 : row.order < 0);
  if (!matches.length) return { ...relationResolution, status: "RELATION_UNKNOWN", candidates: [], candidateTotal: 0, reason: "NO_CURRENT_AGE_ORDER_MATCH" };
  if (matches.length > 1) return { ...relationResolution, candidates: matches.map(row => row.candidate), candidateTotal: matches.length, reason: "MULTIPLE_RELATION_CANDIDATES" };
  const selected = matches[0];
  const target = graph.nodes.get(String(selected.candidate.runtimeId)) || { id: selected.candidate.runtimeId };
  const relation = { ...selected.relation, seniority: selected.order, seniorityReferenceId: String(selected.referenceId) };
  return {
    ...relationResolution,
    status: "RELATION_RESOLVED",
    targetRuntimeId: String(selected.candidate.runtimeId),
    target: { runtimeId: String(selected.candidate.runtimeId), name: characterName(target, selected.candidate.runtimeId),
      sex: resolveCharacterSexConsensus({ snapshot: target }).sex, sexConflict: false },
    relation,
    candidates: [selected.candidate],
    candidateTotal: 1,
    resolution: { status: "RELATION_RESOLVED", source: relationResolution.anchor?.source, candidateTotal: rows.length }
  };
}

function resolveTrustedKinshipLabel(relation, sex, seniority, graph) {
  const step = relation.relationshipKind === "STEP" || relation.type === "STEP_SIBLING_OF";
  if (relation.type === "SIBLING_OF" || relation.type === "STEP_SIBLING_OF") {
    if (step) return sex === "male" ? seniority > 0 ? "继兄" : seniority < 0 ? "继弟" : "继兄弟"
      : sex === "female" ? seniority > 0 ? "继姐" : seniority < 0 ? "继妹" : "继姐妹" : "继兄弟姐妹";
    return sex === "male" ? seniority > 0 ? "哥哥" : seniority < 0 ? "弟弟" : "兄弟"
      : sex === "female" ? seniority > 0 ? "姐姐" : seniority < 0 ? "妹妹" : "姐妹"
        : seniority > 0 ? "年长手足" : seniority < 0 ? "年幼手足" : "手足";
  }
  const label = resolveKinshipLabel({ ...relation, sex, seniority });
  if (relation.type !== "AUNT_UNCLE_OF" || seniority === null) return label;
  const reference = relation.seniorityReferenceId ?? relation.relationPath?.[1];
  const branch = relation.branch;
  const parentLabel = branch === "PATERNAL" ? "父亲" : branch === "MATERNAL" ? "母亲" : null;
  if (!parentLabel || reference == null || !graph.nodes.has(String(reference))) return label;
  return `${label}（比${parentLabel}${seniority > 0 ? "年长" : "年幼"}）`;
}

function buildFamilyFactBlock(character, gameData, { query = "", recentTargetId = null, currentFactRegistry = null, ageAuthorityGameData = null, ageDiagnostics = null, familyDiagnostics = null } = {}) {
  if (!character?.id || !gameData) return null;
  const started = performance.now();
  if (isStepFamilyQuery(query)) {
    const step = buildStepFamilyFactBlock(character, gameData, { query });
    if (step.handled) {
      if (Array.isArray(familyDiagnostics)) familyDiagnostics.push({ nodeVisits: step.metrics.nodeVisits,
        edgeVisits: step.metrics.edgeVisits, targetedParentQuery: true, buildMs: performance.now() - started });
      return step.text;
    }
  }
  const graph = getCachedKinshipGraph(gameData, { includeOtherParents: /母亲|父亲|父母|母后|母妃|父王|父皇|同父|同母/u.test(query) });
  const metrics = { nodeVisits: 0, edgeVisits: 0, targetedParentQuery: false };
  const parentQuery = buildParentQuery(character, graph, query, metrics, gameData);
  if (parentQuery) {
    metrics.targetedParentQuery = true;
    metrics.buildMs = performance.now() - started;
    if (Array.isArray(familyDiagnostics)) familyDiagnostics.push(metrics);
    return parentQuery;
  }
  const temporal = { currentGameDate: gameData.date, currentTotalDays: gameData.totalDays, currentCampaignToken: gameData.campaignToken };
  let relationResolution = query ? resolveAnchoredRelationMention({ query, responderId: character.id, graph, recentTargetId }) : null;
  // A family inventory is not a request to select one ambiguous person.
  if (relationResolution?.status === "NO_RELATION_INTENT") relationResolution = null;
  if (relationResolution?.status === "RELATION_AMBIGUOUS") {
    relationResolution = resolveAgeBoundAmbiguousRelation(relationResolution, graph, ageAuthorityGameData, gameData);
  }
  if (relationResolution?.intent?.sourcePhrase) {
    console.log(`[VOTC Relation] query=${String(query).replace(/\s+/g, " ").trim()} intent=${relationResolution.intent.relationTypes.join(",") || "NONE"} sex=${relationResolution.intent.sexConstraint || "unknown"} anchorMention=${relationResolution.anchor.mention || "-"} anchorRuntimeId=${relationResolution.relationAnchorRuntimeId || "-"} targetRuntimeId=${relationResolution.targetRuntimeId || "-"} targetName=${relationResolution.target?.name || "-"} resolution=${relationResolution.status}`);
  }
  const canUseSourceAge = isExplicitCurrentAgeQuestion(query) && relationResolution?.status === "RELATION_RESOLVED";
  const selectedTargetId = canUseSourceAge ? String(relationResolution.targetRuntimeId) : null;
  let selectedAge = null;
  if (canUseSourceAge) {
    const sourceCharacter = currentAgeSnapshotMatches(ageAuthorityGameData, gameData)
      ? sourceBoundFamilyProfile(ageAuthorityGameData, selectedTargetId, relationResolution) : null;
    selectedAge = resolveCharacterAge(sourceCharacter || {}, {
      currentGameDate: ageAuthorityGameData?.date ?? gameData.date,
      currentTotalDays: ageAuthorityGameData?.totalDays ?? gameData.totalDays,
      currentCampaignToken: ageAuthorityGameData?.campaignToken ?? gameData.campaignToken
    });
    if (Array.isArray(ageDiagnostics)) {
      ageDiagnostics.push({
        characterIdHash: crypto.createHash("sha256").update(selectedTargetId).digest("hex"),
        ageSource: selectedAge.ageSource,
        rawAge: selectedAge.rawAge,
        calculatedCalendarAge: selectedAge.calculatedCalendarAge,
        ageConflict: selectedAge.conflict,
        asOfGameDate: selectedAge.asOfGameDate,
        selectedAge: selectedAge.age,
        promptAge: selectedAge.age,
        sourceConflict: selectedAge.sourceConflict,
        currentAgeSourceOwnerIdHash: selectedAge.sourceOwnerId == null ? null : crypto.createHash("sha256").update(String(selectedAge.sourceOwnerId)).digest("hex"),
        currentAgeRelationType: selectedAge.currentAgeRelationType,
        currentAgeEvidenceSourceType: selectedAge.currentAgeEvidenceSourceType,
        profileSelectionPath: sourceCharacter?.ageSource === "CK3_CURRENT_AGE" ? "CURRENT_CANONICAL" : "BOUND_RELATIVE_OR_UNKNOWN",
        diagnosticCode: selectedAge.diagnosticCode || (selectedAge.age === null ? "RELATIVE_AGE_MISSING" : selectedAge.conflict ? "CALENDAR_AGE_MISMATCH" : "AGE_SOURCE_MATCH")
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
  const seniorityContext = buildTrustedSeniorityContext(ageAuthorityGameData, gameData,
    [character.id, relationResolution?.relationAnchorRuntimeId || character.id, ...relations.map(edge => edge.from)], graph);
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
    const seniorityReferenceId = resolution.relation.type === "AUNT_UNCLE_OF"
      ? resolution.relation.seniorityReferenceId ?? resolution.relation.relationPath?.[1]
      : relationAnchorId;
    const trustedOrder = seniorityReferenceId == null ? null : seniorityContext?.compare(edge.from, seniorityReferenceId) ?? null;
    const trustedRelation = { ...resolution.relation, seniority: trustedOrder,
      ...(seniorityReferenceId == null ? {} : { seniorityReferenceId: String(seniorityReferenceId) }) };
    const bundle = buildFamilyEntityFactBundle({ graph, responderId: character.id, relationAnchorId, targetRuntimeId: edge.from, relationTypes: relationResolution?.intent?.relationTypes || null, temporal });
    if (!bundle) continue;
    const currentFact = resolveRelationshipCurrentTruth({ gameData, subjectRuntimeId: edge.from, anchorRuntimeId: relationAnchorId, registry: currentFactRegistry, kinshipGraph: graph });
    const sex = { sex: currentFact?.currentState?.sex || "unknown", conflict: currentFact?.evidence?.conflicts?.length > 0 };
    const label = trustedOrder !== null
      ? resolveTrustedKinshipLabel(trustedRelation, sex.sex, trustedOrder, graph)
      : edge.relationshipKind === "STEP" || edge.type.startsWith("STEP_")
        ? resolveTrustedKinshipLabel(trustedRelation, "unknown", null, graph)
        : currentFact?.relations[String(relationAnchorId)]?.label || resolveKinshipLabel({ type: edge.type, sex: "unknown", branch: edge.branch, relationshipKind: edge.relationshipKind });
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
      const useAgeAwareLabel = trustedOrder !== null && ["SIBLING_OF", "STEP_SIBLING_OF", "COUSIN_OF", "AUNT_UNCLE_OF"].includes(resolution.relation.type);
      lines.push(`- 查询关系主体：${characterName(anchor, relationAnchorId)}；查询关系：${useAgeAwareLabel ? label : relationResolution.intent.label || label}；目标人物：${characterName(relative, edge.from)}（Runtime ID：${edge.from}；性别：${sex.sex === "male" ? "男性" : sex.sex === "female" ? "女性" : "未知"}${details.length ? `；${details.join("；")}` : ""}）`);
    } else {
      lines.push(`- ${label}：${characterName(relative, edge.from)}${details.length ? `（${details.join("；")}）` : ""}`);
    }
  }
  for (const spouse of relationResolution ? [] : normalizeSpouseRecords(character).filter((record) => record.runtimeId === null && record.name)) {
    lines.push(`- 配偶/伴侣（未绑定角色）：${spouse.name}`);
  }
  if (!lines.length) return null;
  metrics.nodeVisits = seen.size;
  metrics.edgeVisits = relations.length;
  metrics.buildMs = performance.now() - started;
  if (Array.isArray(familyDiagnostics)) familyDiagnostics.push(metrics);
  return `=== 当前结构化家庭事实（本轮 CK3 数据） ===\n${lines.join("\n")}\n权威规则：亲属身份、性别、是否已故、死亡日期和年龄以本块结构化结果为准；相对时间只能使用系统给出的结果。若本块明确给出致死者，则以本块为准；若本块未给出致死者，可使用后续获准的 Current Game Truth / Worldline Game Truth。不得从 Memory 或模型推测致死者。Memory 只可补充过去经历与主观感受，不得覆盖这些事实。`;
}

module.exports = { buildFamilyFactBlock, formatStructuredCharacter, buildUnresolvedRelationConstraint, isExplicitCurrentAgeQuestion };
