"use strict";

const { normalizeGameDate, resolveLifeStatus } = require("../worldline/character-temporal-facts");
const { getCharacterPersonalName } = require("../memory-system/character-identity");
const { currentDirectParentFilter, currentPublicParentFilter } = require("../worldline/kinship-graph-cache");
const PRIVATE_FIELDS = ["personality", "sexuality", "boldness", "compassion", "energy", "greed", "honor", "rationality", "sociability", "vengefulness", "zeal", "capitalLocation"];

const { NON_OBSERVABLE_TO_OTHERS, OBSERVABLE_TO_OTHERS, getTraitAliases, normalizeTraitKey, resolveTraitVisibility } = require("./trait-visibility-policy");

function getTraitsForSelfProfile(character) {
  return Array.isArray(character?.traits) ? character.traits : [];
}
function observable(trait) {
  return resolveTraitVisibility(trait).status === "OBSERVABLE";
}
function getTraitsForObservedProfile(character) {
  return getTraitsForSelfProfile(character).filter(observable);
}

function runtimeCharacterId(value) {
  const raw = value && typeof value === "object" ? value.id ?? value.runtimeId ?? value.characterId : value;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function characterAt(gameData, characterId) {
  if (!characterId) return null;
  const characters = gameData?.characters;
  return characters instanceof Map
    ? characters.get(characterId) ?? characters.get(String(characterId)) ?? null
    : characters?.[characterId] ?? characters?.[String(characterId)] ?? null;
}

function parentReferences(character) {
  if (Array.isArray(character?.parents)) return character.parents;
  const parents = character?.parents && typeof character.parents === "object" ? Object.values(character.parents) : [];
  return [...parents, character?.father, character?.mother].filter(value => value !== null && value !== undefined);
}

function evidenceRows(character) {
  return Array.isArray(character?.evidence?.relations) ? character.evidence.relations : [];
}

function explicitStepRelationship(record) {
  return ["relationshipKind", "parentage", "parentType", "kinshipType", "kind"]
    .some(key => typeof record?.[key] === "string" && /STEP|继亲|繼親/iu.test(record[key]));
}

function directParentCandidates(child, parent, childId, parentId) {
  const candidates = [];
  const add = value => {
    if (!value || typeof value !== "object") return;
    let proof = value.directParentEvidence || value.parentEvidence || value;
    if (!proof || typeof proof !== "object") return;
    // A typed step-parent must not become a direct relative through an otherwise
    // valid nested parent source; keep the conflict in the complete candidate set.
    if (explicitStepRelationship(value) || explicitStepRelationship(proof)) proof = { ...proof, evidenceConflict: true };
    const key = JSON.stringify(proof);
    if (!candidates.some(item => JSON.stringify(item) === key)) candidates.push(proof);
  };
  for (const reference of parentReferences(child)) {
    if (runtimeCharacterId(reference) === parentId && typeof reference === "object") add(reference);
  }
  for (const evidence of evidenceRows(child)) {
    if (runtimeCharacterId(evidence?.ownerId) === parentId && evidence?.directParentEvidence) add(evidence);
  }
  for (const evidence of evidenceRows(parent)) {
    if (runtimeCharacterId(evidence?.ownerId) === childId && evidence?.relationType === "parent") add(evidence);
  }
  for (const entry of Array.isArray(parent?.children) ? parent.children : []) {
    if (runtimeCharacterId(entry) === childId && (entry.directParentEvidence || entry.parentEvidence)) add(entry);
  }
  return candidates;
}

function hasCurrentPublicParent(gameData, childId, parentId) {
  const child = characterAt(gameData, childId);
  const parent = characterAt(gameData, parentId);
  if (!child || !parent) return false;
  const candidates = directParentCandidates(child, parent, childId, parentId);
  if (!candidates.length) return false;
  const accepts = currentDirectParentFilter(gameData);
  // A valid duplicate must not upgrade a conflicting or stale record for the same pair.
  return candidates.every(proof => accepts(proof, { childId, parentId }));
}

function currentPublicOtherParent(gameData, sourceParentId, childId) {
  const sourceParent = characterAt(gameData, sourceParentId);
  if (!sourceParent) return [];
  const accepts = currentPublicParentFilter(gameData);
  const candidates = [];
  for (const entry of Array.isArray(sourceParent.children) ? sourceParent.children : []) {
    if (runtimeCharacterId(entry) !== childId) continue;
    const evidence = entry.otherParent;
    if (evidence === null || evidence === undefined) continue;
    const parentId = runtimeCharacterId(evidence?.parentId ?? evidence?.otherParentId ?? evidence?.id);
    const identityFields = [evidence.id, evidence.parentId, evidence.otherParentId].filter(value => value !== null && value !== undefined);
    if (!parentId || explicitStepRelationship(entry) || explicitStepRelationship(evidence) || evidence.sourceRelation !== "kids.otherParent"
      || identityFields.some(value => runtimeCharacterId(value) !== parentId)
      || runtimeCharacterId(evidence.sourceOwnerId) !== sourceParentId
      || !accepts(evidence, evidence, { childId, sourceOwnerId: sourceParentId })) return [];
    candidates.push(evidence);
  }
  if (!candidates.length) return [];
  const signatures = new Set(candidates.map(evidence => JSON.stringify([
    runtimeCharacterId(evidence.id ?? evidence.parentId ?? evidence.otherParentId),
    runtimeCharacterId(evidence.sourceOwnerId),
    runtimeCharacterId(evidence.childId),
    evidence.source,
    evidence.sourceRelation,
    evidence.relationType,
    evidence.publicStatus,
    evidence.knowledgeStatus,
    evidence.campaignToken,
    evidence.sourceSnapshotId,
    evidence.evidenceConflict === true
  ])));
  // Repeated source rows must agree as a whole; a current row cannot mask a bad duplicate.
  return signatures.size === 1 ? [runtimeCharacterId(candidates[0].parentId ?? candidates[0].otherParentId ?? candidates[0].id)] : [];
}

function publicParentsOf(gameData, character) {
  const childId = runtimeCharacterId(character);
  if (!childId || !characterAt(gameData, childId)) return new Set();
  const candidateIds = new Set(parentReferences(character).map(runtimeCharacterId).filter(Boolean));
  for (const evidence of evidenceRows(character)) {
    const proof = evidence?.directParentEvidence;
    if (proof && runtimeCharacterId(evidence?.ownerId ?? proof.parentId)) candidateIds.add(runtimeCharacterId(evidence.ownerId ?? proof.parentId));
  }
  // CK3_OTHER_PARENT facts are bound to the current legal parent that emitted the kids.otherParent row.
  const otherParentRows = Array.isArray(character?.evidence?.otherParentRelations) ? character.evidence.otherParentRelations : [];
  for (const evidence of otherParentRows) {
    const ownerId = runtimeCharacterId(evidence?.sourceOwnerId);
    const accepts = currentPublicParentFilter(gameData);
    if (ownerId && evidence?.sourceRelation === "kids.otherParent"
      && accepts(evidence, evidence, { childId, sourceOwnerId: ownerId })) candidateIds.add(ownerId);
  }

  const parentIds = new Set();
  for (const parentId of candidateIds) {
    if (hasCurrentPublicParent(gameData, childId, parentId)) parentIds.add(parentId);
  }
  for (const parentId of [...parentIds]) {
    for (const otherParentId of currentPublicOtherParent(gameData, parentId, childId)) parentIds.add(otherParentId);
  }
  return parentIds;
}

function isPublicCloseFamily(observerId, targetId, gameData) {
  if (hasCurrentPublicParent(gameData, observerId, targetId)
    || hasCurrentPublicParent(gameData, targetId, observerId)) return true;
  const observer = characterAt(gameData, observerId);
  const target = characterAt(gameData, targetId);
  if (!observer || !target) return false;
  const observerParents = publicParentsOf(gameData, observer);
  const targetParents = publicParentsOf(gameData, target);
  if (observerParents.has(targetId) || targetParents.has(observerId)) return true;
  for (const parentId of observerParents) if (targetParents.has(parentId)) return true;
  return false;
}

function traitFactKeys(character, observableOnly = false) {
  const traits = observableOnly ? getTraitsForObservedProfile(character) : getTraitsForSelfProfile(character);
  return [...new Set(traits.map(normalizeTraitKey).filter(Boolean).map(key => `trait_${key}`))];
}

function getAutomaticTraitAccess(observer, target, gameData, options = {}) {
  const observerId = runtimeCharacterId(observer);
  const targetId = runtimeCharacterId(target);
  if (!observerId || !targetId || observerId === targetId) return { source: null, traitKeys: [] };
  const traitKeys = traitFactKeys(target);
  if (!traitKeys.length) return { source: null, traitKeys: [] };
  if (isPublicCloseFamily(observerId, targetId, gameData)) return { source: "PUBLIC_CLOSE_FAMILY", traitKeys };
  const activeParticipantIds = Array.isArray(options?.activeParticipantIds) ? options.activeParticipantIds : [];
  const present = new Set(activeParticipantIds.map(runtimeCharacterId).filter(Boolean));
  if (present.has(observerId) && present.has(targetId)) {
    const observableKeys = traitFactKeys(target, true);
    if (observableKeys.length) return { source: "OBSERVABLE", traitKeys: observableKeys };
  }
  return { source: null, traitKeys: [] };
}

function getTraitsForKnownProfile(observer, target, knowledgeContext = {}) {
  // Preserve the pre-V9.3.9 Owner -> Target proof from the current game log.
  const secrets = normalizeGameDate(knowledgeContext.currentGameDate) && typeof knowledgeContext.campaignToken === "string"
    && knowledgeContext.campaignToken.trim() ? observer?.knownSecrets || [] : [];
  const secretTraits = { secret_bastard: "bastard", secret_disputed_heritage: "disputed_heritage", secret_witch: "witch",
    secret_cannibal: "cannibal", secret_deviant: "deviant", secret_incest: "incestuous", secret_adulterer: "adulterer" };
  const automatic = getAutomaticTraitAccess(observer, target, knowledgeContext.gameData,
    { activeParticipantIds: knowledgeContext.activeParticipantIds });
  const automaticTraitKeys = new Set(automatic.traitKeys);
  return getTraitsForSelfProfile(target).filter(trait => {
    const factKey = `trait_${normalizeTraitKey(trait)}`;
    if (automaticTraitKeys.has(factKey)) return true;
    const facts = scopedDisclosureFacts(observer, target, knowledgeContext).filter(fact => fact.factType === "TRAIT" && fact.factKey === factKey);
    if (facts.some(fact => fact.currentDirectObservation === true && fact.effectiveKnown === true)) return true;
    if (facts.some(fact => fact.status === "MANUAL_HIDDEN")) return false;
    return facts.some(fact => fact.effectiveKnown === true)
      || secrets.some(secret => Number(secret.ownerId) === Number(target?.id) && secretTraits[secret.type] === normalizeTraitKey(trait));
  });
}

function scopedDisclosureFacts(observer, target, context) {
  const current = normalizeGameDate(context?.currentGameDate);
  const facts = context?.disclosureProfiles instanceof Map ? context.disclosureProfiles.get(Number(target?.id)) || [] : [];
  return facts.filter(fact => current && fact.campaignToken === context.campaignToken
    && Number(fact.ownerId) === Number(observer?.id) && Number(fact.entityId) === Number(target?.id)
    && (fact.current === true || fact.factType === "AGE") && ["AUTO_DISCLOSED", "MANUAL_KNOWN", "MANUAL_HIDDEN"].includes(fact.status)
    && (fact.status === "MANUAL_HIDDEN" || normalizeGameDate(fact.firstAcquiredDate)?.serial <= current.serial));
}

function knownTitle(observer, target, value, context) {
  if (!value || /^none(?:\s|$)|^concept_none$/i.test(value)) return "";
  const normalize = text => String(text).normalize("NFKC").trim();
  const facts = scopedDisclosureFacts(observer, target, context).filter(fact => fact.factType === "TITLE"
    && (normalize(fact.value) === normalize(value)
      || /^concept_/.test(value) && fact.aliases?.includes(normalize(value).toLowerCase())));
  if (facts.some(fact => fact.status === "MANUAL_HIDDEN")) return "";
  if (facts.some(fact => fact.effectiveKnown === true)) return value;
  return "";
}

// A per-request presentation copy protects custom templates and scripts as well as bundled ones.
function createTraitProfileView(gameData, character, memoryContext = null, { includeStepFamily = false } = {}) {
  const observer = gameData?.characters?.get(Number(character?.id)) || character;
  const knowledge = { ...memoryContext, campaignToken: gameData?.campaignToken, currentGameDate: gameData?.date, gameData };
  const copies = new Map();
  const relativeFields = new Set(["parents", "children", "siblings", "spouses", "concubines", "otherParent", "concubineOf", "betrothed"]);
  const currentParentBindings = new Set();
  for (const owner of gameData?.characters?.values?.() || []) {
    for (const [field, sourceRelation] of [["children", "kids.otherParent"], ["siblings", "siblings.otherParent"]]) {
      for (const child of owner[field] || []) {
        const record = child?.otherParent;
        if (!record || record.sourceOwnerId !== Number(owner.id) || record.sourceRelation !== sourceRelation) continue;
        currentParentBindings.add(`${owner.id}:${child.id}:${record.otherParentId ?? record.id}:${sourceRelation}`);
      }
    }
  }
  const publicParentSource = currentPublicParentFilter(gameData);
  const currentPublicParent = (record, childId = record?.childId) => publicParentSource(record, record, { childId })
    && (record.childId === null || record.childId === undefined || Number(record.childId) === Number(childId))
    && record.source === "CK3_OTHER_PARENT" && Number.isSafeInteger(record.sourceOwnerId) && record.sourceOwnerId > 0
    && record.relationType === "parent" && ["kids.otherParent", "siblings.otherParent"].includes(record.sourceRelation)
    && typeof gameData?.campaignToken === "string" && gameData.campaignToken.length > 0
    && record.campaignToken === gameData.campaignToken
    && record.sourceSnapshotId === `${gameData.date}/${gameData.totalDays}`
    && currentParentBindings.has(`${record.sourceOwnerId}:${childId}:${record.otherParentId ?? record.parentId ?? record.id}:${record.sourceRelation}`);
  const currentFamilySource = record => typeof gameData?.campaignToken === "string" && gameData.campaignToken.length > 0
    && record.campaignToken === gameData.campaignToken && record.sourceSnapshotId === `${gameData.date}/${gameData.totalDays}`;
  const isStepSourceRecord = (record, source, prefix) => record?.source === source
    || typeof record?.sourceRelation === "string" && record.sourceRelation.startsWith(prefix);
  const currentDirectParent = currentDirectParentFilter(gameData);
  const currentHistoricalStep = (record, childId) => includeStepFamily
    && record?.relationshipKind === "STEP" && !record.relationshipKindConflict && !record.evidenceConflict
    && record.source === "LEGACY_TYPED_STEP_RELATION" && record.sourceRelation === "parents"
    && record.relationType === "parent" && record.sourceOwnerId === Number(childId)
    && record.childId === Number(childId) && Number.isSafeInteger(Number(record.id)) && Number(record.id) > 0
    && record.publicStatus === "PUBLIC_LEGAL_PARENT" && record.knowledgeStatus === "UNKNOWN"
    && currentFamilySource(record);
  const currentMarriageLifeConsistent = (parent, spouse) => [parent, spouse,
    gameData?.characters?.get(Number(parent.id)), gameData?.characters?.get(Number(spouse.id))]
    .filter(Boolean).every(record => {
      const status = resolveLifeStatus(record);
      return !status.conflict && status.alive !== false;
    });
  const currentStepChild = (record, spouse) => includeStepFamily && record?.source === "CK3_PARENT_SPOUSE_CHILD"
    && record.sourceOwnerId === Number(observer?.id)
    && record.sourceParentId === Number(spouse.parentId) && record.sourceSpouseId === Number(spouse.id)
    && record.relationType === "child" && record.sourceRelation === "parents.spouses.children"
    && record.publicStatus === "PUBLIC_LEGAL_PARENT" && record.knowledgeStatus === "UNKNOWN"
    && !record.evidenceConflict && currentFamilySource(record);
  const copy = (value, relative = false) => {
    if (!value || typeof value !== "object") return value;
    if (copies.has(value)) return copies.get(value);
    if (value instanceof Date) return new Date(value);
    const result = value instanceof Map ? new Map() : value instanceof Set ? new Set()
      : Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
    copies.set(value, result);
    if (value instanceof Map) for (const [key, item] of value) result.set(key, copy(item));
    else if (value instanceof Set) for (const item of value) result.add(copy(item));
    else {
      for (const key of Object.keys(value)) {
        if (key === "parents" && Array.isArray(value[key])) {
          const historicalSteps = value[key].filter(item => currentHistoricalStep(item, value.id));
          if (historicalSteps.length) result.historicalStepRelations = historicalSteps.map(item => ({
            ...copy(item, true), relationType: "STEP_PARENT", temporalStatus: "HISTORICAL"
          }));
          result[key] = value[key].filter(item => (!isStepSourceRecord(item, "CK3_PARENT_SPOUSE_CHILD", "parents.spouses.children.")
            || includeStepFamily && item.source === "CK3_PARENT_SPOUSE_CHILD" && item.sourceOwnerId === Number(observer?.id) && item.childId === Number(value.id)
              && item.relationType === "parent" && ["parents.spouses.children.spouseParent", "parents.spouses.children.otherParent"].includes(item.sourceRelation)
              && item.publicStatus === "PUBLIC_LEGAL_PARENT" && item.knowledgeStatus === "UNKNOWN" && !item.evidenceConflict && currentFamilySource(item))
            && item?.relationshipKind !== "STEP"
            && (item?.source === "CK3_PARENT_SPOUSE_CHILD"
              || currentDirectParent(item, value.id))).map(item => copy(item, true));
          continue;
        }
        if (key === "relations" && Array.isArray(value[key])) {
          result[key] = value[key].filter(item => !["parent", "child"].includes(item?.relationType)
            || currentDirectParent(item.directParentEvidence, {
              childId: item.relationType === "child" ? value.id : item.ownerId,
              parentId: item.relationType === "child" ? item.ownerId : value.id
            })).map(item => copy(item));
          continue;
        }
        if (key === "spouses" && Array.isArray(value[key])) {
          result[key] = value[key].filter(item => !isStepSourceRecord(item, "CK3_PARENT_SPOUSE", "parents.spouses")
            || includeStepFamily && item.source === "CK3_PARENT_SPOUSE" && item.publicStatus === "PUBLIC_LEGAL_MARRIAGE" && item.parentId === Number(value.id)
              && item.relationType === "CURRENT_SPOUSE" && item.sourceRelation === "parents.spouses"
              && item.sourceOwnerId === Number(observer?.id) && item.knowledgeStatus === "UNKNOWN"
              && !item.evidenceConflict && currentFamilySource(item) && currentMarriageLifeConsistent(value, item)).map(item => copy(item, true));
          continue;
        }
        if (key === "children" && Array.isArray(value[key])) {
          result[key] = value[key].filter(item => isStepSourceRecord(item, "CK3_PARENT_SPOUSE_CHILD", "parents.spouses.children")
            ? currentStepChild(item, value)
            : currentDirectParent(item?.directParentEvidence || item?.parentEvidence, { childId: item?.id, parentId: value.id }))
            .map(item => copy(item, true));
          continue;
        }
        // A raw parentage record is not evidence that an NPC may learn its identity.
        if (key === "otherParent" && !currentPublicParent(value[key], value.id)) continue;
        if (key === "otherParentRelations" && Array.isArray(value[key])) {
          result[key] = value[key].filter(item => currentPublicParent(item)).map(item => copy(item));
          continue;
        }
        result[key] = copy(value[key], relativeFields.has(key) || relative && Array.isArray(value));
      }
      if (relative && Number(value.id) > 0 || Array.isArray(value.traits) || Object.hasOwn(value, "personality") || Array.isArray(value.secrets) || Object.hasOwn(value, "primaryTitle")) {
        const isSelf = Number(value.id) > 0 && Number(value.id) === Number(observer?.id);
        if (Array.isArray(value.traits)) result.traits = (isSelf ? getTraitsForSelfProfile(value) : getTraitsForKnownProfile(observer, value, knowledge)).map(trait => copy(trait));
        if (!isSelf) {
          const knowsAge = scopedDisclosureFacts(observer, value, knowledge).some(fact => fact.factType === "AGE"
            && fact.effectiveKnown === true && fact.status !== "MANUAL_HIDDEN");
          if (!knowsAge) {
            if ("age" in result) result.age = null;
            for (const key of ["birth", "birthDate", "birthDateTotalDays", "birthTotalDays"]) delete result[key];
          }
          for (const key of ["primaryTitle", "titleRankConcept", "heldCourtAndCouncilPositions"]) {
            if (key in result) result[key] = key === "heldCourtAndCouncilPositions"
              ? String(value[key] || "").split(/[,，、;；\n|]/).map(title => knownTitle(observer, value, title.trim(), knowledge)).filter(Boolean).join("、")
              : knownTitle(observer, value, String(value[key] || ""), knowledge);
          }
          const personalName = getCharacterPersonalName(gameData?.characters?.get(Number(value.id)) || value, value.name);
          if ("name" in result) result.name = personalName;
          result.shortName = personalName;
          result.fullName = value.nickname ? `${personalName} '${value.nickname}'` : personalName;
          for (const key of PRIVATE_FIELDS) delete result[key];
          for (const key of ["secrets", "knownSecrets", "memories", "conversationSummaries"]) if (key in result) result[key] = [];
        }
      }
    }
    return result;
  };
  const view = copy(gameData);
  for (const [alias, id] of [["playerName", gameData?.playerID], ["aiName", gameData?.aiID]]) {
    if (alias in view) view[alias] = view.characters?.get(Number(id))?.fullName || "";
  }
  const people = gameData?.characters instanceof Map ? [...gameData.characters.values()] : [];
  // String aliases must not bypass the character projection used by templates.
  if (gameData?.currentEmperor || gameData?.currentEmperorTitle) {
    const sources = people.filter(person => person.shortName === gameData.currentEmperor
      && person.primaryTitle === gameData.currentEmperorTitle);
    const emperor = sources.length === 1 ? view.characters.get(Number(sources[0].id)) : null;
    view.currentEmperor = emperor?.shortName || "";
    view.currentEmperorTitle = emperor?.primaryTitle || "";
    if (!view.currentEmperorTitle) view.currentEraName = "";
  }
  if (gameData?.locationController) {
    const sources = people.filter(person => person.fullName === gameData.locationController);
    view.locationController = sources.length === 1 ? view.characters.get(Number(sources[0].id))?.shortName || "" : "";
  }
  return { gameData: view, character: copy(character) };
}

module.exports = { NON_OBSERVABLE_TO_OTHERS, OBSERVABLE_TO_OTHERS, normalizeTraitKey, getTraitAliases, resolveTraitVisibility,
  getTraitsForSelfProfile, getTraitsForObservedProfile, getAutomaticTraitAccess, getTraitsForKnownProfile, createTraitProfileView };
