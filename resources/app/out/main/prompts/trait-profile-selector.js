"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { getCharacterPersonalName } = require("../memory-system/character-identity");
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
const escapePattern = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function explicitTraitClaim(entry, target, trait, gameData) {
  const names = [...new Set([target.shortName, target.fullName, target.firstName, target.name].filter(Boolean))]
    .filter(name => !(gameData?.characters instanceof Map) || [...gameData.characters.values()].filter(person =>
      [person.shortName, person.fullName, person.firstName, person.name].includes(name)).every(person => Number(person.id) === Number(target.id)));
  const labels = [...new Set([typeof trait === "string" ? trait : trait.name, ...getTraitAliases(trait)].filter(Boolean))];
  const text = String(entry.text || "");
  if (/[?？]|并非|不是|并不|不属实|不真实|未证实|未经证实|虚假|谣言|传言|听[^。！？.!?\n]*说|声称|自称|引用|未必|玩笑|虚构|误传|不曾|未曾|否认|怀疑|可能|也许|或许|据说|传闻|如果|假如|是否|未来|将来|将成为|将是|日后|终将|迟早|尚未|not\b|never\b|false\b|untrue\b|unconfirmed\b|den(?:y|ied)|might\b|may\b|rumou?r|heard\b|claims?\b|said\b|quotes?\b|alleged\b|jok(?:e|ing)\b|fiction\b|if\b|whether\b|will\b|would\b|going to|future\b|someday\b/i.test(text)) return false;
  const clauses = text.split(/[。！？.!?\n;；]/);
  return clauses.some(clause => {
    return names.some(name => labels.some(label => new RegExp(`(?:^|[\\s,，:："'（(])${escapePattern(name)}(?:\\s*(?:是|为|具有|拥有|具备)\\s*|\\s+(?:is|has|possesses)\\s+)(?:(?:a|an|the)\\s+|一[位个名]\\s*)?${escapePattern(label)}(?:$|[\\s,，:：)）"'\\]]|的)`, "i").test(clause)));
  });
}
function authorizedEntry(entry, observer, target, context) {
  const current = normalizeGameDate(context?.currentGameDate);
  const acquired = normalizeGameDate(entry?.acquiredDate);
  const conversation = normalizeGameDate(entry?.conversationDate);
  const sourceProof = entry?.source?.messageIds?.some(id => Number.isSafeInteger(id) && id >= 0)
    || entry?.source?.legacyRefs?.some(ref => ref.memoryId && ref.eventKey && /^[a-f0-9]{64}$/.test(ref.sourceHash || ""));
  return current && acquired && conversation && acquired.serial <= current.serial && conversation.serial <= current.serial
    && typeof context.campaignToken === "string" && !!context.campaignToken
    && entry.campaignToken === context.campaignToken && Number(entry.ownerId) === Number(observer?.id)
    && (entry.entityIds || []).includes(Number(target?.id)) && entry.deleted !== true
    && (entry.evidence?.knownBy || []).includes(Number(observer?.id))
    && ["private", "participants", "known_group"].includes(entry.evidence?.visibility)
    && ["witnessed", "game_fact"].includes(entry.evidence?.sourceType) && entry.evidence?.epistemicStatus === "observed"
    && !!entry.source?.conversationId && !!entry.source?.finalizationId && sourceProof;
}
function getTraitsForKnownProfile(observer, target, knowledgeContext = {}) {
  const entries = (knowledgeContext.memory4Packet?.details || []).map(item => item.traitKnowledgeEvidence).filter(Boolean);
  const secrets = normalizeGameDate(knowledgeContext.currentGameDate) && typeof knowledgeContext.campaignToken === "string"
    && knowledgeContext.campaignToken.trim() ? observer?.knownSecrets || [] : [];
  const secretTraits = { secret_bastard: "bastard", secret_disputed_heritage: "disputed_heritage", secret_witch: "witch",
    secret_cannibal: "cannibal", secret_deviant: "deviant", secret_incest: "incestuous", secret_adulterer: "adulterer" };
  return getTraitsForSelfProfile(target).filter(trait => {
    const facts = scopedDisclosureFacts(observer, target, knowledgeContext).filter(fact => fact.factType === "TRAIT"
      && fact.factKey === `trait_${normalizeTraitKey(trait)}`);
    if (facts.some(fact => fact.currentDirectObservation === true && fact.effectiveKnown === true)) return true;
    if (facts.some(fact => fact.status === "MANUAL_HIDDEN")) return false;
    return facts.some(fact => fact.effectiveKnown === true)
      || entries.some(entry => authorizedEntry(entry, observer, target, knowledgeContext) && explicitTraitClaim(entry, target, trait, knowledgeContext.gameData))
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
  const entries = (context.memory4Packet?.details || []).map(item => item.traitKnowledgeEvidence).filter(Boolean);
  return entries.some(entry => authorizedEntry(entry, observer, target, context)
    && explicitTraitClaim(entry, target, { name: value }, context.gameData)) ? value : "";
}

// A per-request presentation copy protects custom templates and scripts as well as bundled ones.
function createTraitProfileView(gameData, character, memoryContext = null) {
  const observer = gameData?.characters?.get(Number(character?.id)) || character;
  const knowledge = { ...memoryContext, campaignToken: gameData?.campaignToken, currentGameDate: gameData?.date, gameData };
  const copies = new Map();
  const relativeFields = new Set(["parents", "children", "siblings", "spouses", "concubines", "otherParent", "concubineOf", "betrothed"]);
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
      for (const key of Object.keys(value)) result[key] = copy(value[key], relativeFields.has(key) || relative && Array.isArray(value));
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
  getTraitsForSelfProfile, getTraitsForObservedProfile, getTraitsForKnownProfile, createTraitProfileView };
