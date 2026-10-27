"use strict";

const { normalizeGameDate, resolveLifeStatus } = require("../worldline/character-temporal-facts");
const { getCharacterPersonalName } = require("../memory-system/character-identity");
const { currentDirectParentFilter, currentPublicParentFilter } = require("../worldline/kinship-graph-cache");
const { getFamilyVisibility } = require("../worldline/family-visibility");
const PRIVATE_FIELDS = ["personality", "sexuality", "boldness", "compassion", "energy", "greed", "honor", "rationality", "sociability", "vengefulness", "zeal", "capitalLocation"];
const profileViewSources = new WeakMap();

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

function isPublicCloseFamily(observerId, targetId, gameData) {
  const observer = runtimeCharacterId(observerId);
  const target = runtimeCharacterId(targetId);
  return !!observer && !!target && getFamilyVisibility(profileViewSources.get(gameData) || gameData, observer).ids.has(String(target));
}

function familyKnown(observer, target, context) {
  return context.familyVisibility ? context.familyVisibility.ids.has(String(runtimeCharacterId(target)))
    : isPublicCloseFamily(runtimeCharacterId(observer), runtimeCharacterId(target), context.identitySource || context.gameData);
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
  if (options.familyVisibility ? options.familyVisibility.ids.has(String(targetId)) : isPublicCloseFamily(observerId, targetId, gameData)) return { source: "PUBLIC_CLOSE_FAMILY", traitKeys };
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
    { activeParticipantIds: knowledgeContext.activeParticipantIds, familyVisibility: knowledgeContext.familyVisibility });
  const automaticTraitKeys = new Set(automatic.traitKeys);
  return getTraitsForSelfProfile(target).filter(trait => {
    const factKey = `trait_${normalizeTraitKey(trait)}`;
    const facts = scopedDisclosureFacts(observer, target, knowledgeContext).filter(fact => fact.factType === "TRAIT" && fact.factKey === factKey);
    if (facts.some(fact => fact.status === "MANUAL_HIDDEN")) return false;
    if (facts.some(fact => fact.currentDirectObservation === true && fact.effectiveKnown === true)) return true;
    return automaticTraitKeys.has(factKey) || facts.some(fact => fact.effectiveKnown === true)
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
  if (familyKnown(observer, target, context) || facts.some(fact => fact.effectiveKnown === true)) return value;
  return "";
}

function knownPersonalName(observer, target, context) {
  const source = context.identitySource?.characters?.get(Number(target.id)) || context.identitySource?.characters?.get(String(target.id))
    || context.gameData?.characters?.get(Number(target.id)) || context.gameData?.characters?.get(String(target.id)) || target;
  const personalName = getCharacterPersonalName(source, target.name);
  const normalize = value => String(value || "").normalize("NFKC").trim();
  const aliases = new Set([personalName, source.name, source.firstName, source.shortName, source.fullName].filter(Boolean).map(normalize));
  const facts = scopedDisclosureFacts(observer, target, context).filter(fact => fact.factType === "NAME" && aliases.has(normalize(fact.value)));
  const known = facts.find(fact => fact.effectiveKnown === true && fact.status !== "MANUAL_HIDDEN"
    && !facts.some(hidden => hidden.status === "MANUAL_HIDDEN" && normalize(hidden.value) === normalize(fact.value)));
  return known ? normalize(known.value) : null;
}

function isNameManuallyHidden(observer, target, context) {
  return scopedDisclosureFacts(observer, target, context).some(fact => fact.factType === "NAME" && fact.status === "MANUAL_HIDDEN");
}

function isAgeManuallyHidden(observer, target, context) {
  return scopedDisclosureFacts(observer, target, context).some(fact => fact.factType === "AGE" && fact.status === "MANUAL_HIDDEN");
}

// A per-request presentation copy protects custom templates and scripts as well as bundled ones.
function createTraitProfileView(gameData, character, memoryContext = null, { includeStepFamily = false } = {}) {
  const observer = gameData?.characters?.get(Number(character?.id)) || character;
  const identityData = profileViewSources.get(gameData) || gameData;
  // Identity aliases cover the entire raw directory; the bounded graph serves
  // family authorization only and cannot truncate the identity scrub table.
  const sourceProfiles = identityData?.characters instanceof Map ? identityData.characters : new Map(Object.entries(identityData?.characters || {}));
  const familyVisibility = getFamilyVisibility(identityData, observer?.id);
  const identitySource = identityData;
  const knowledge = { ...memoryContext, campaignToken: gameData?.campaignToken, currentGameDate: gameData?.date,
    gameData: identityData, identitySource, familyVisibility };
  const copies = new Map();
  const relativeFields = new Set(["parents", "children", "siblings", "spouse", "spouses", "formerSpouses", "deceasedSpouses", "concubines", "otherParent", "concubineOf", "betrothed"]);
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
        if (key === "parentName" && typeof value[key] === "string") {
          const parentId = runtimeCharacterId(value.parentId ?? value.otherParentId);
          result[key] = parentId === runtimeCharacterId(observer) || familyKnown(observer, { id: parentId }, knowledge)
            && !isNameManuallyHidden(observer, { id: parentId }, knowledge)
            ? value[key] : knownPersonalName(observer, { id: parentId }, knowledge) || "未获知姓名的人物";
          continue;
        }
        result[key] = copy(value[key], relativeFields.has(key) || relative && Array.isArray(value));
      }
      if (relative && Number(value.id) > 0 || Array.isArray(value.traits) || Object.hasOwn(value, "personality") || Array.isArray(value.secrets) || Object.hasOwn(value, "primaryTitle")) {
        const isSelf = Number(value.id) > 0 && Number(value.id) === Number(observer?.id);
        if (Array.isArray(value.traits)) result.traits = (isSelf ? getTraitsForSelfProfile(value) : getTraitsForKnownProfile(observer, value, knowledge)).map(trait => copy(trait));
        if (!isSelf) {
          const closeFamily = familyKnown(observer, value, knowledge);
          const ageFacts = scopedDisclosureFacts(observer, value, knowledge).filter(fact => fact.factType === "AGE");
          const knowsAge = !ageFacts.some(fact => fact.status === "MANUAL_HIDDEN")
            && (closeFamily || ageFacts.some(fact => fact.effectiveKnown === true));
          if (!knowsAge) {
            if ("age" in result) result.age = null;
            for (const key of ["birth", "birthDate", "birthDateTotalDays", "birthTotalDays", "ageAtDeath", "ageAtDeathSource"]) delete result[key];
          }
          for (const key of ["primaryTitle", "titleRankConcept", "heldCourtAndCouncilPositions"]) {
            if (key in result) result[key] = key === "heldCourtAndCouncilPositions"
              ? String(value[key] || "").split(/[,，、;；\n|]/).map(title => knownTitle(observer, value, title.trim(), knowledge)).filter(Boolean).join("、")
              : knownTitle(observer, value, String(value[key] || ""), knowledge);
          }
          if (!closeFamily || isNameManuallyHidden(observer, value, knowledge)) {
            const personalName = knownPersonalName(observer, value, knowledge) || "未获知姓名的人物";
            for (const key of ["name", "firstName", "shortName"]) if (key in result) result[key] = personalName;
            result.shortName = personalName;
            result.fullName = value.nickname ? `${personalName} '${value.nickname}'` : personalName;
            if ("house" in result) result.house = "未获知家族";
          }
          if (!closeFamily) for (const key of PRIVATE_FIELDS) delete result[key];
          for (const key of ["secrets", "knownSecrets", "memories", "conversationSummaries"]) if (key in result) result[key] = [];
        }
      }
    }
    return result;
  };
  const view = copy(gameData);
  profileViewSources.set(view, identityData);
  const projectedCharacter = copy(character);
  // Scrub generated CK3 display metadata, never spoken text or authorized memories.
  const hiddenAliases = new Map();
  const relationAliases = new Map();
  const projectedById = new Map();
  for (const [source, projected] of copies) if (runtimeCharacterId(source)) projectedById.set(runtimeCharacterId(source), projected);
  for (const person of sourceProfiles.values()) {
    const projected = view.characters?.get(Number(person.id)) || projectedById.get(runtimeCharacterId(person));
    if (!projected) continue;
    const fullIdentity = Number(person.id) === Number(observer.id)
      || familyKnown(observer, person, knowledge) && !isNameManuallyHidden(observer, person, knowledge);
    for (const alias of [person.name, person.firstName, person.shortName, person.fullName].filter(value => typeof value === "string" && value.length > 1)) {
      const names = relationAliases.get(alias) || new Set();
      names.add(projected.shortName || projected.name || "未获知姓名的人物");
      relationAliases.set(alias, names);
      if (!fullIdentity && ![projected.name, projected.firstName, projected.shortName, projected.fullName].includes(alias)) hiddenAliases.set(alias, projected.shortName || "未获知姓名的人物");
    }
    for (const key of ["primaryTitle", "heldCourtAndCouncilPositions", "titleRankConcept", "house"]) {
      const allowed = new Set(String(projected[key] || "").split(/[,，、;；\n|]/).map(value => value.trim()));
      for (const title of String(person[key] || "").split(/[,，、;；\n|]/).map(value => value.trim())) {
        if (title.length > 1 && !allowed.has(title) && !/^(?:none(?:\b|$)|concept_none$)/i.test(title)) hiddenAliases.set(title, "未获知身份");
      }
    }
  }
  const aliases = [...hiddenAliases.keys()].sort((left, right) => right.length - left.length);
  const aliasPattern = aliases.length ? new RegExp(aliases.map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gu") : null;
  const scrubDisplay = text => aliasPattern ? text.replace(aliasPattern, (alias, offset) => {
    if (/^[\p{Script=Latin}\d .'-]+$/u.test(alias)
      && (/[\p{L}\p{N}_]/u.test(text[offset - 1] || "") || /[\p{L}\p{N}_]/u.test(text[offset + alias.length] || ""))) return alias;
    return hiddenAliases.get(alias);
  }) : text;
  const visited = new WeakSet();
  const scrubMetadata = value => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (value instanceof Map) { for (const item of value.values()) scrubMetadata(item); return; }
    for (const key of Object.keys(value)) {
      if (["memories", "conversationSummaries", "secrets", "knownSecrets", "evidence"].includes(key)) continue;
      const item = value[key];
      if (typeof item === "string" && ["desc", "description", "scene", "location"].includes(key)) value[key] = scrubDisplay(item);
      else if (typeof item === "string" && ["liege", "consort"].includes(key) && item) {
        const names = relationAliases.get(item);
        value[key] = names?.size === 1 ? [...names][0] : "身份未获知";
      } else scrubMetadata(item);
    }
  };
  scrubMetadata(view);
  scrubMetadata(projectedCharacter);
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
  return { gameData: view, character: projectedCharacter };
}

module.exports = { NON_OBSERVABLE_TO_OTHERS, OBSERVABLE_TO_OTHERS, normalizeTraitKey, getTraitAliases, resolveTraitVisibility,
  getTraitsForSelfProfile, getTraitsForObservedProfile, isPublicCloseFamily, getAutomaticTraitAccess, getTraitsForKnownProfile, createTraitProfileView, isNameManuallyHidden, isAgeManuallyHidden };
