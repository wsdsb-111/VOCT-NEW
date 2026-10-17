"use strict";

const { normalizeSpouseRecords } = require("./canonical-spouse-record");
const { resolveLifeStatus } = require("./character-temporal-facts");

const DIRECT_PARENT_SOURCE = "CK3_DIRECT_PARENT";
const PARENT_SPOUSE_SOURCE = "CK3_PARENT_SPOUSE";
const PARENT_SPOUSE_CHILD_SOURCE = "CK3_PARENT_SPOUSE_CHILD";

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function hasReliableGender(record) {
  return ["male", "female"].includes(record?.gender) && record.genderSource === "CK3_LIVE_RELATIVE";
}

function currentSnapshotId(gameData) {
  const totalDays = Number(gameData?.totalDays);
  const date = typeof gameData?.date === "string" ? gameData.date.trim() : "";
  return date && Number.isFinite(totalDays) && totalDays >= 0 ? `${date}/${totalDays}` : null;
}

function isFresh(record, gameData) {
  const snapshotId = currentSnapshotId(gameData);
  return typeof gameData?.campaignToken === "string" && gameData.campaignToken.length > 0
    && snapshotId !== null
    && record?.campaignToken === gameData.campaignToken
    && record?.sourceSnapshotId === snapshotId;
}

function isPublicDirectParent(record, ownerId, gameData) {
  return positiveId(record?.id) !== null
    && positiveId(record?.sourceOwnerId) === ownerId
    && positiveId(record?.childId) === ownerId
    && record?.relationType === "parent"
    && record?.source === DIRECT_PARENT_SOURCE
    && record?.sourceRelation === "parents"
    && record?.publicStatus === "PUBLIC_LEGAL_PARENT"
    && record?.knowledgeStatus === "UNKNOWN"
    && isFresh(record, gameData);
}

function getCompleteParents(character, gameData, metrics) {
  const ownerId = positiveId(character?.id);
  if (!ownerId || !Array.isArray(character?.parents)) return null;
  const parents = new Map();
  for (const record of character.parents) {
    metrics.nodeVisits += 1;
    if (record?.evidenceConflict === true || !isPublicDirectParent(record, ownerId, gameData) || !String(record.name || "").trim()) continue;
    const id = positiveId(record.id);
    const existing = parents.get(id);
    if (!existing) parents.set(id, record);
    else if (existing.name !== record.name
      || hasReliableGender(existing) && hasReliableGender(record) && existing.gender !== record.gender) return null;
    else if (!hasReliableGender(existing) && hasReliableGender(record)) parents.set(id, record);
  }
  return parents.size === 2 ? parents : null;
}

function mergedCharacterView(character, canonical, gameData) {
  const ownerId = positiveId(character?.id);
  const records = [...(Array.isArray(character?.parents) ? character.parents : []),
    ...(canonical !== character && Array.isArray(canonical?.parents) ? canonical.parents : [])];
  const directParents = new Map();
  const typedSteps = new Map();
  for (const record of records) {
    const id = positiveId(record?.id);
    if (!id) continue;
    if (record?.relationshipKind === "STEP") {
      const existing = typedSteps.get(id);
      if (!existing) typedSteps.set(id, { ...record });
      else if (existing.name !== record.name || existing.source !== record.source) existing.relationshipKindConflict = true;
      continue;
    }
    if (!isPublicDirectParent(record, ownerId, gameData)) continue;
    const existing = directParents.get(id);
    if (!existing) {
      directParents.set(id, { ...record, spouses: Array.isArray(record.spouses) ? [...record.spouses] : [] });
      continue;
    }
    if (existing.name !== record.name
      || hasReliableGender(existing) && hasReliableGender(record) && existing.gender !== record.gender) {
      existing.evidenceConflict = true;
    }
    if (!hasReliableGender(existing) && hasReliableGender(record)) {
      existing.gender = record.gender;
      existing.genderSource = record.genderSource || null;
    }
    if (!String(existing.name || "").trim() && String(record.name || "").trim()) existing.name = record.name;
    if (record.evidenceConflict === true) existing.evidenceConflict = true;
    if (Array.isArray(record.spouses)) existing.spouses.push(...record.spouses);
  }
  return {
    ...(canonical && typeof canonical === "object" ? canonical : {}),
    ...(character && typeof character === "object" ? character : {}),
    id: ownerId,
    parents: [...directParents.values(), ...typedSteps.values()]
  };
}

function getCurrentMarriages(character, parents, gameData, metrics) {
  const ownerId = positiveId(character?.id);
  const parentIds = new Set(parents.keys());
  const bySpouseId = new Map();
  for (const parent of parents.values()) {
    metrics.nodeVisits += 1;
    const parentStatuses = [parent, gameData?.characters?.get?.(Number(parent.id))].filter(Boolean).map(resolveLifeStatus);
    if (parentStatuses.some(status => status.conflict || status.alive === false)) continue;
    const normalized = normalizeSpouseRecords(parent);
    for (const record of normalized) {
      metrics.edgeVisits += 1;
      const raw = record.raw;
      const spouseId = positiveId(record.runtimeId);
      const spouseStatuses = [raw, gameData?.characters?.get?.(spouseId)].filter(Boolean).map(resolveLifeStatus);
      if (record.relationType !== "CURRENT_SPOUSE" || !spouseId || parentIds.has(spouseId) || spouseId === ownerId
        || spouseStatuses.some(status => status.conflict || status.alive === false)
        || !raw || Number(raw.parentId) !== Number(parent.id)
        || !hasReliableGender(parent) || !hasReliableGender(raw)
        || positiveId(raw.sourceOwnerId) !== ownerId || raw.relationType !== "CURRENT_SPOUSE"
        || raw.source !== PARENT_SPOUSE_SOURCE || raw.sourceRelation !== "parents.spouses"
        || raw.publicStatus !== "PUBLIC_LEGAL_MARRIAGE" || raw.knowledgeStatus !== "UNKNOWN"
        || !isFresh(raw, gameData) || raw.evidenceConflict === true) continue;
      const spouse = {
        id: spouseId,
        name: String(raw.name || record.name || "").trim(),
        gender: raw.gender === "male" || raw.gender === "female" ? raw.gender : "unknown",
        genderSource: raw.genderSource || null,
        parentId: Number(parent.id),
        raw
      };
      const existing = bySpouseId.get(spouseId);
      if (!existing) bySpouseId.set(spouseId, spouse);
      else if (existing.name !== spouse.name || existing.gender !== spouse.gender
        || existing.parentId !== spouse.parentId) existing.conflict = true;
      metrics.sourceKinds.currentMarriage += 1;
    }
  }
  return [...bySpouseId.values()];
}

function isPublicChildParent(record, childId, ownerId, sourceRelation, gameData) {
  return positiveId(record?.id) !== null
    && positiveId(record?.sourceOwnerId) === ownerId
    && positiveId(record?.childId) === childId
    && record?.relationType === "parent"
    && record?.source === PARENT_SPOUSE_CHILD_SOURCE
    && record?.sourceRelation === sourceRelation
    && record?.publicStatus === "PUBLIC_LEGAL_PARENT"
    && record?.knowledgeStatus === "UNKNOWN"
    && isFresh(record, gameData);
}

function collectStepSiblings(character, parents, marriages, gameData, metrics) {
  const ownerId = positiveId(character?.id);
  const rootParentIds = new Set(parents.keys());
  const candidates = new Map();
  const sharedParentCandidates = new Map();
  let hasConflict = false;
  for (const marriage of marriages) {
    const raw = marriage.raw;
    if (marriage.conflict || !marriage.name) continue;
    for (const child of raw.children || []) {
      metrics.edgeVisits += 1;
      const childId = positiveId(child?.id);
      if (!childId || childId === ownerId || child?.evidenceConflict === true
        || positiveId(child?.sourceOwnerId) !== ownerId
        || positiveId(child?.sourceParentId) !== marriage.parentId
        || positiveId(child?.sourceSpouseId) !== marriage.id
        || child?.relationType !== "child" || child?.source !== PARENT_SPOUSE_CHILD_SOURCE
        || child?.sourceRelation !== "parents.spouses.children"
        || child?.publicStatus !== "PUBLIC_LEGAL_PARENT" || child?.knowledgeStatus !== "UNKNOWN"
        || !isFresh(child, gameData) || !String(child.name || "").trim()) continue;
      const childParents = Array.isArray(child.parents) ? child.parents : [];
      if (childParents.length !== 2) continue;
      const spouseParent = childParents.find((item) => Number(item.id) === marriage.id);
      const otherParent = childParents.find((item) => Number(item.id) !== marriage.id);
      if (!spouseParent || !otherParent
        || !isPublicChildParent(spouseParent, childId, ownerId, "parents.spouses.children.spouseParent", gameData)
        || !isPublicChildParent(otherParent, childId, ownerId, "parents.spouses.children.otherParent", gameData)
        || positiveId(spouseParent.id) === positiveId(otherParent.id)
        || [positiveId(spouseParent.id), positiveId(otherParent.id)].some((id) => id === childId || id === ownerId)) continue;
      const candidate = {
        id: childId,
        name: String(child.name).trim(),
        gender: child.gender === "male" || child.gender === "female" ? child.gender : "unknown",
        genderSource: child.genderSource || null,
        stepParentId: marriage.id,
        stepParentName: marriage.name,
        stepParentGender: marriage.gender,
        parentIds: [positiveId(spouseParent.id), positiveId(otherParent.id)]
      };
      const existing = candidates.get(childId) || sharedParentCandidates.get(childId);
      if (existing && (existing.name !== candidate.name || existing.gender !== candidate.gender
        || existing.stepParentId !== candidate.stepParentId
        || existing.parentIds.join(":") !== candidate.parentIds.join(":"))) {
        hasConflict = true;
        continue;
      }
      if (candidate.parentIds.some((id) => rootParentIds.has(id))) sharedParentCandidates.set(childId, candidate);
      else candidates.set(childId, candidate);
      metrics.nodeVisits += 1;
    }
  }
  return { candidates: [...candidates.values()], sharedParentCandidates: [...sharedParentCandidates.values()], hasConflict };
}

function explicitHistoricalSteps(character, gameData, metrics, directParentIds = new Set()) {
  const ownerId = positiveId(character?.id);
  const result = [];
  for (const record of character?.parents || []) {
    if (record?.relationshipKind !== "STEP" || record?.relationshipKindConflict
      || record?.source === DIRECT_PARENT_SOURCE
      || typeof record?.source !== "string" || !record.source.trim()
      || positiveId(record.sourceOwnerId) !== ownerId || positiveId(record.childId) !== ownerId
      || record.relationType !== "parent" || record.sourceRelation !== "parents"
      || record.publicStatus !== "PUBLIC_LEGAL_PARENT" || record.knowledgeStatus !== "UNKNOWN"
      || !isFresh(record, gameData) || !positiveId(record.id) || directParentIds.has(positiveId(record.id))
      || !String(record.name || "").trim()) continue;
    metrics.nodeVisits += 1;
    metrics.sourceKinds.typedStep += 1;
    result.push({
      id: Number(record.id),
      name: String(record.name).trim(),
      gender: record.gender === "male" || record.gender === "female" ? record.gender : "unknown",
      genderSource: record.genderSource || null,
      source: record.source
    });
  }
  return result;
}

function queryGender(query, malePattern, femalePattern, allPattern) {
  if (allPattern.test(query)) return null;
  if (malePattern.test(query)) return "male";
  if (femalePattern.test(query)) return "female";
  return null;
}

function halfSiblingKind(candidate, rootParents) {
  const shared = candidate.parentIds.filter((id) => rootParents.has(id));
  if (shared.length !== 1) return shared.length === 2 ? "FULL" : null;
  const gender = rootParents.get(shared[0])?.gender;
  if (gender === "male" && rootParents.get(shared[0])?.genderSource === "CK3_LIVE_RELATIVE") return "PATERNAL_HALF";
  if (gender === "female" && rootParents.get(shared[0])?.genderSource === "CK3_LIVE_RELATIVE") return "MATERNAL_HALF";
  return "SHARED_PARENT_UNKNOWN_GENDER";
}

function explicitTargetName(query) {
  const match = String(query).match(/(?:你和|你与|我和|我与)([^，,。？！?]{1,30}?)(?:是|算|属于|为)/u);
  return match ? match[1].trim() : null;
}

function filterByQueryTarget(candidates, query) {
  const target = explicitTargetName(query);
  if (!target) return candidates;
  return candidates.filter((candidate) => candidate.name === target);
}

function isStepFamilyQuery(query) {
  const text = String(query || "");
  return /继父母|继父|继母|继亲|继兄弟姐妹|继兄妹|继姐妹|继兄|继弟|继姐|继妹/u.test(text);
}

function candidatesLine(label, candidates, targetGender, targetName) {
  let matching = candidates;
  let unknownGender = false;
  if (targetGender) {
    unknownGender = candidates.some((candidate) => candidate.gender === "unknown");
    matching = candidates.filter((candidate) => candidate.gender === targetGender);
  }
  matching = filterByQueryTarget(matching, targetName);
  if (targetGender && unknownGender) return `- ${label}无法唯一确认：存在性别来源未知的当前候选。`;
  if (!matching.length) return `- 本轮公开关系资料未确认${label}；这表示未知，不能回答“没有”，也不得补造父母生死、婚史或当事人不知情的原因。`;
  if (matching.length === 1) {
    const candidate = matching[0];
    const lineage = candidate.stepParentName
      ? `；是继${candidate.stepParentGender === "male" ? "父" : "母"}${candidate.stepParentName}的${candidate.gender === "male" ? "儿子" : candidate.gender === "female" ? "女儿" : "子女"}，与本人无共同父母`
      : "";
    return `- ${label}：${candidate.name}${lineage}。`;
  }
  const names = matching.slice(0, 3).map((candidate) => candidate.name);
  const suffix = matching.length > names.length ? "等多位候选" : "";
  return `- ${label}存在多个候选，未选择具体人物：${names.join("、")}${suffix}。`;
}

function buildStepFamilyFactBlock(character, gameData, { query = "" } = {}) {
  const text = String(query || "");
  const parentMention = /继父母|继父|继母|继亲/u.test(text);
  const siblingMention = /继兄弟姐妹|继兄妹|继姐妹|继兄|继弟|继姐|继妹/u.test(text);
  if (!isStepFamilyQuery(text)) return { handled: false, text: null, metrics: null };

  const metrics = {
    nodeVisits: 0,
    edgeVisits: 0,
    candidateCount: 0,
    sourceKinds: { currentMarriage: 0, deceasedSpouse: 0, typedStep: 0 },
    targetedParentQuery: true
  };
  const ownerId = positiveId(character?.id);
  const canonical = ownerId && gameData?.characters?.get?.(ownerId);
  const anchor = mergedCharacterView(character, canonical, gameData);
  const parents = getCompleteParents(anchor, gameData, metrics);
  const lines = [];
  let marriages = [];
  if (parents) marriages = getCurrentMarriages(anchor, parents, gameData, metrics);

  if (parentMention) {
    const parentGender = queryGender(text, /继父|继父母/u, /继母/u, /继父母/u);
    const currentCandidates = marriages
      .filter((marriage) => !marriage.conflict && marriage.gender !== "unknown"
        && marriage.genderSource === "CK3_LIVE_RELATIVE" && marriage.name)
      .map((marriage) => ({ id: marriage.id, name: marriage.name, gender: marriage.gender }));
    const typedHistory = explicitHistoricalSteps(anchor, gameData, metrics, new Set(parents?.keys() || []));
    const historyForQuery = parentGender ? typedHistory.filter((record) => record.gender === parentGender
      && record.genderSource === "CK3_LIVE_RELATIVE") : typedHistory;
    metrics.candidateCount += currentCandidates.length + historyForQuery.length;
    const reliableGenderMissing = marriages.some((marriage) => !marriage.conflict && marriage.name
      && (marriage.gender === "unknown" || marriage.genderSource !== "CK3_LIVE_RELATIVE"));
    lines.push(reliableGenderMissing
      ? "- 当前有合法婚姻来源，但性别证据不完整，无法分类为继父或继母。"
      : candidatesLine(parentGender === "male" ? "当前继父" : parentGender === "female" ? "当前继母" : "当前继亲", currentCandidates, parentGender, text));
    if (historyForQuery.length) {
      const historical = filterByQueryTarget(historyForQuery, text);
      if (historical.length === 1) lines.push(`- 历史来源记载曾有${historical[0].name}为继亲；当前关系未确认。`);
      else if (historical.length > 1) lines.push(`- 历史来源记载有多位继亲候选，未选择具体人物：${historical.slice(0, 3).map(item => item.name).join("、")}。当前关系未确认。`);
    }
  }

  if (siblingMention) {
    const siblingGender = queryGender(text, /继兄|继弟|继兄弟/u, /继姐|继妹|继姐妹/u, /继兄弟姐妹|继兄妹/u);
    let result = { candidates: [], sharedParentCandidates: [], hasConflict: false };
    if (parents) result = collectStepSiblings(anchor, parents, marriages, gameData, metrics);
    let candidates = result.candidates;
    const unknownSiblingGender = Boolean(siblingGender && candidates.some((candidate) => candidate.gender === "unknown"
      || candidate.genderSource !== "CK3_LIVE_RELATIVE"));
    candidates = candidates.filter((candidate) => !siblingGender || candidate.gender === siblingGender
      && candidate.genderSource === "CK3_LIVE_RELATIVE");
    candidates = filterByQueryTarget(candidates, text);
    metrics.candidateCount += candidates.length;
    if (!parents) lines.push("- 继兄弟姐妹关系未知：当前双亲来源不完整或未标记为公开合法父母，不能据此判定是否共享父母。");
    else if (result.hasConflict) lines.push("- 继兄弟姐妹关系存在互相冲突的公开来源，当前无法唯一确认。");
    else if (unknownSiblingGender) lines.push("- 继兄弟姐妹关系无法唯一确认：当前候选的性别来源不完整。");
    else if (explicitTargetName(text) && result.sharedParentCandidates.some((candidate) => candidate.name === explicitTargetName(text))) {
      const shared = result.sharedParentCandidates.filter((candidate) => candidate.name === explicitTargetName(text));
      const stepNames = result.candidates.filter((candidate) => candidate.name === explicitTargetName(text));
      if (shared.length > 1 || stepNames.length) lines.push("- 同名人物对应不同的亲属来源，无法确认具体对象。");
      else {
        const kind = halfSiblingKind(shared[0], parents);
        lines.push(kind === "PATERNAL_HALF"
          ? `- ${shared[0].name}与本人同父异母，不按继兄弟姐妹归类。`
          : kind === "MATERNAL_HALF"
            ? `- ${shared[0].name}与本人同母异父，不按继兄弟姐妹归类。`
            : "- 当前已确认共享父母，但其性别来源不足，不能分类为继兄弟姐妹。");
      }
    } else lines.push(candidatesLine(siblingGender === "male" ? "当前继兄弟" : siblingGender === "female" ? "当前继姐妹" : "当前继兄弟姐妹", candidates, null, text));
  }

  lines.push("- 历史覆盖：当前 CK3 资料没有可验证的既往婚姻期间；不根据 former/deceased spouse 或死亡日期推断继亲。获准的既有 Legacy 内容若明确记载过去关系，只能按原记录叙述过去，不得外推当前关系。" );
  lines.push("- 本块只证明来源标记为公开的本轮关系事实，不证明角色本人知情；knowledgeStatus UNKNOWN 保持未知，未知或秘密关系不进入事实。" );
  return { handled: true, text: `=== 当前结构化继亲事实（本轮 CK3 数据） ===\n${lines.join("\n")}`, metrics };
}

module.exports = { buildStepFamilyFactBlock, isStepFamilyQuery };
