"use strict";

const { ids } = require("./memory4-contract");
const { currentRelationship } = require("./memory4-profile");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");

const CURRENT_RELATIONSHIP_SOURCE = "CURRENT_RUNTIME_RELATIONSHIP";
const QUOTE_CLOSE = new Map([["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"], ["\"", "\""]]);
const QUOTE_CLOSERS = new Set(QUOTE_CLOSE.values());
const INNER_THOUGHT_OR_REPORT = /心想|心道|心知|心里|内心|暗自|想着|想起|想到|思忖|思量|琢磨|以为|觉得|认为|怀疑|听说|听闻|耳闻|闻说|听到|据说|传闻|传言|谣言|相传|旁白|叙述|描写|有人说|别人说|他人说|他说|她说|他们说|某人说|被告知|转述|引用|thought|thinking|believed|thought to|heard|rumou?r|report|according to|someone said|he said|she said/iu;
const ATTRIBUTION_END = /(?:说(?:道|过)?|曰|道|表示|宣称|转述|引用|告诉|提到|say|says|said|tell|tells|told|claim|claims|claimed|declare|declares|declared|remark|remarks|remarked)\s*[：:,，]?$/iu;
const WRITTEN_QUOTE = /写下|写道|写着|书写|记下|刻下|刻有|题写|纸上|纸条|字条|碑文|字迹|牌匾|\b(?:wrote|written|writes?|inscribed|inscription)\b/iu;
const REPORTED_SPEECH = /听[^。.!！?？;；，,\r\n]{0,24}(?:说(?:道|过)?|曰|道|表示|宣称|转述|闻|到)|耳闻|闻说/u;
const SELF_ATTRIBUTION = /^(?:我|吾|朕|寡人|孤|本王|在下|鄙人|本人)(?:(?:对|向)[^，,：:。.!！?？;；\r\n]{1,20})?(?:说(?:道|过)?|曰|道|表示|宣称|告诉|提到|问(?:道)?|答(?:道)?|回答|回应|追问|喊(?:道)?)\s*[：:,，]?$/u;
const SELF_ATTRIBUTION_EN = /^I(?:\s+to\s+[^,:.]{1,40}\s+)?(?:say|says|said|tell|tells|told|ask|asks|asked|declare|declares|declared|remark|remarks|remarked)\s*[：:,]?$/iu;

function rows(value) {
  if (value instanceof Map) return [...value.values()];
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? Object.values(value) : [];
}

function characterId(character) {
  const id = Number(character?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function displayName(character) {
  for (const value of [character?.shortName, character?.name, character?.fullName, character?.firstName]) {
    if (typeof value === "string" && value.trim() && !/^none(?:\s|$)/i.test(value.trim())) return value.trim();
  }
  return null;
}

function buildCurrentMemory4RelationshipEvidence({ gameData, ownerIds = [], entityIds = [] } = {}) {
  const asOf = normalizeGameDate(gameData?.date);
  if (!gameData?.campaignToken || !asOf || !(gameData.characters instanceof Map)) return [];
  const owners = ids(ownerIds).filter(id => gameData.characters.has(id));
  const entities = ids(entityIds).filter(id => gameData.characters.has(id));
  const evidence = [];
  for (const ownerId of owners) for (const entityId of entities) {
    if (ownerId === entityId) continue;
    const relationship = currentRelationship(gameData, ownerId, entityId);
    if (relationship.status !== "CONFIRMED" || relationship.knownToOwner !== true || !relationship.types.length) continue;
    evidence.push({ campaignToken: gameData.campaignToken, ownerId, entityId, status: "CONFIRMED",
      types: [...relationship.types], source: CURRENT_RELATIONSHIP_SOURCE, knownToOwner: true, asOf: asOf.canonical });
  }
  return evidence;
}

function profileAliases(character) {
  return [...new Set([character?.firstName, character?.shortName, character?.name, character?.fullName]
    .filter(value => typeof value === "string" && value.trim().length >= 2 && !/^none(?:\s|$)/i.test(value.trim()))
    .map(value => value.trim()))];
}

function identityAliases(character) {
  return [...new Set([...(Array.isArray(character?.names) ? character.names : []), character?.nickname,
    character?.firstName, character?.shortName, character?.name, character?.fullName]
    .filter(value => typeof value === "string" && value.trim() && !/^none(?:\s|$)/i.test(value.trim()))
    .map(value => value.trim()))];
}

function sourceIds(fragment) {
  const values = [...(Array.isArray(fragment.sourceMessageIds) ? fragment.sourceMessageIds : []), fragment.messageId];
  return [...new Set(values.filter(value => Number.isSafeInteger(value) && value >= 0))].sort((left, right) => left - right);
}

function resolveAttributedSpeaker(context, characters, speakerId) {
  const hasColonAttribution = /[:：]\s*$/u.test(context);
  if (!hasColonAttribution && !ATTRIBUTION_END.test(context)) return { kind: "none" };
  const candidates = rows(characters);
  if (!candidates.length) return { kind: "none" };
  if (!Number.isSafeInteger(Number(speakerId))) return { kind: "ambiguous" };
  const clauses = context.replace(/[:：]\s*$/u, "").split(/[，,]/u).map(value => value.trim()).filter(Boolean);
  for (const clause of clauses.reverse()) {
    const normalized = clause.normalize("NFKC").toLowerCase();
    const matches = [];
    for (const character of candidates) {
      const id = characterId(character);
      if (!id) continue;
      for (const alias of identityAliases(character)) {
        const normalizedAlias = alias.normalize("NFKC").toLowerCase();
        if (normalized.startsWith(normalizedAlias)) matches.push({ id, alias: normalizedAlias });
      }
    }
    if (!matches.length) continue;
    const longest = Math.max(...matches.map(match => match.alias.length));
    const matchedIds = [...new Set(matches.filter(match => match.alias.length === longest).map(match => match.id))];
    const suffix = normalized.slice(longest).trimStart();
    if (/^(?:的|之|手下|属下|部下|麾下|帐下|幕下|门下|身边|身侧|身旁|随从|侍从|家臣)/u.test(suffix)
      || matchedIds.length !== 1) return { kind: "ambiguous" };
    return { kind: matchedIds[0] === Number(speakerId) ? "self" : "other", characterId: matchedIds[0] };
  }
  return { kind: "none" };
}

function safeDirectSpeechContext(text, start, speakerAliases, attribution) {
  const prefix = text.slice(0, start - 1);
  const boundaries = [...prefix.matchAll(/[。.!！?？;；\r\n]/gu)];
  const boundary = boundaries.at(-1);
  const context = prefix.slice(boundary ? boundary.index + 1 : 0).trim();
  if (!context) return true;
  if (INNER_THOUGHT_OR_REPORT.test(context) || WRITTEN_QUOTE.test(context)) return false;
  const attributionClause = context.replace(/[:：]\s*$/u, "").split(/[，,]/u).at(-1).trim();
  if (REPORTED_SPEECH.test(attributionClause)) return false;
  const hasAttribution = /[:：]\s*$/u.test(context) || ATTRIBUTION_END.test(context);
  const attributedSpeaker = resolveAttributedSpeaker(context, attribution?.characters, attribution?.speakerId);
  if (attributedSpeaker.kind !== "none") return attributedSpeaker.kind === "self";
  if (hasAttribution && (SELF_ATTRIBUTION.test(attributionClause) || SELF_ATTRIBUTION_EN.test(attributionClause))) return true;
  if (!/[:：]\s*$/u.test(context) && !ATTRIBUTION_END.test(context)) return true;
  const normalized = context.normalize("NFKC").toLowerCase();
  return speakerAliases.some(alias => typeof alias === "string" && alias.trim()
      && normalized.startsWith(alias.normalize("NFKC").trim().toLowerCase()));
}

function directSpeechSpans(text, speakerAliases = [], attribution = null) {
  if (typeof text !== "string" || !text) return [];
  const spans = [];
  const stack = [];
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (stack.length) {
      const active = stack[stack.length - 1];
      if (character === active.close) {
        stack.pop();
        if (!stack.length) {
          const start = active.start + 1;
          const end = index;
          const value = text.slice(start, end);
          if (!active.nested && value.trim() && safeDirectSpeechContext(text, start, speakerAliases, attribution)) {
            spans.push({ start, end, text: value, source: "DIRECT_SPEECH" });
          }
        }
        continue;
      }
      if (QUOTE_CLOSE.has(character)) {
        for (const frame of stack) frame.nested = true;
        stack.push({ start: index, close: QUOTE_CLOSE.get(character), nested: true });
        continue;
      }
      if (QUOTE_CLOSERS.has(character)) return spans;
      continue;
    }
    if (QUOTE_CLOSE.has(character)) {
      stack.push({ start: index, close: QUOTE_CLOSE.get(character), nested: false });
      continue;
    }
    if (QUOTE_CLOSERS.has(character)) return spans;
  }
  return spans;
}

function aliasOccurrences(text, alias) {
  const matches = [];
  let offset = 0;
  while ((offset = text.indexOf(alias, offset)) >= 0) {
    const end = offset + alias.length;
    const asciiAlias = /^[a-z0-9 ]+$/i.test(alias);
    const before = text[offset - 1] || "";
    const after = text[end] || "";
    if (!asciiAlias || !/[\p{L}\p{N}_-]/u.test(before) && !/[\p{L}\p{N}_-]/u.test(after)) matches.push({ start: offset, end });
    offset = end;
  }
  return matches;
}

function explicitNameTexts(fragment, text, speakerAliases = [], speechAttributionCharacters = []) {
  if (fragment.sourceRole === "mixed") return [];
  if (fragment.sourceRole !== "assistant") return [text];
  return directSpeechSpans(text, speakerAliases, { speakerId: fragment.speakerId,
    characters: speechAttributionCharacters }).map(span => span.text);
}

function sourceParagraphs(fragment) {
  const sourceMessageIds = sourceIds(fragment);
  const applicationSource = fragment.visibilityEvidence === "application_fragment";
  const finalizationSource = ["finalization_validated_segment", "finalization_source_paragraph"].includes(fragment.visibilityEvidence)
    && fragment.sourceTextVerified === true;
  const letterSource = fragment.visibilityEvidence === "validated_letter" && fragment.sourceTextVerified === true
    && typeof fragment.sourceLetterId === "string" && !!fragment.sourceLetterId.trim();
  if (!letterSource && !sourceMessageIds.length || !applicationSource && !finalizationSource && !letterSource
    || typeof fragment.text !== "string" || !fragment.text.trim()) return [];
  return [{ text: fragment.text, sourceMessageIds, ...(letterSource ? { sourceLetterId: fragment.sourceLetterId } : {}) }];
}

function visibleConversationEntityIds(fragment) {
  return ids([fragment.speakerId, ...(fragment.recipientIds || [])]);
}

function relationshipIsValid(row, ownerId, campaignToken, sourceDate) {
  const entityId = Number(row?.entityId);
  const asOf = normalizeGameDate(row?.asOf);
  const date = normalizeGameDate(sourceDate);
  return Number(row?.ownerId) === ownerId && Number.isSafeInteger(entityId) && entityId > 0 && entityId !== ownerId
    && row?.campaignToken === campaignToken && row?.status === "CONFIRMED" && row?.knownToOwner === true
    && row?.source === CURRENT_RELATIONSHIP_SOURCE && Array.isArray(row.types) && row.types.length > 0
    && row.types.every(type => typeof type === "string" && type.trim())
    && asOf && date && asOf.serial <= date.serial;
}

function buildMemory4EntityContext({ ownerId, campaignToken, date, fragments = [], participantProfiles = [],
  mentionedEntities = [], relationshipEvidence = [], speechAttributionCharacters = [] } = {}) {
  const owner = Number(ownerId);
  if (!Number.isSafeInteger(owner) || owner < 1 || !campaignToken || !normalizeGameDate(date)) {
    return { entityNameEvidence: [], relationshipEvidence: [] };
  }
  const profiles = new Map();
  for (const profile of [...rows(participantProfiles), ...rows(mentionedEntities)]) {
    const id = characterId(profile);
    if (id && !profiles.has(id)) profiles.set(id, profile);
  }
  const attributionCharacters = rows(speechAttributionCharacters);
  if (!attributionCharacters.length) attributionCharacters.push(...profiles.values());
  const ownerName = displayName(profiles.get(owner));
  const entityNameEvidence = [];
  const scopedRelationships = [];
  const relationshipRows = Array.isArray(relationshipEvidence) ? relationshipEvidence : [];

  for (const fragment of fragments || []) {
    if (!fragment?.fragmentId || !ids(fragment.knownBy).includes(owner)) continue;
    const paragraphs = sourceParagraphs(fragment);
    const profileAliasOwners = new Map();
    for (const [id, profile] of profiles) for (const alias of profileAliases(profile)) {
      if (!profileAliasOwners.has(alias)) profileAliasOwners.set(alias, new Set());
      profileAliasOwners.get(alias).add(id);
    }
    const explicit = new Map();
    for (const paragraph of paragraphs) {
      const matches = [];
      const speakerAliases = profileAliases(profiles.get(Number(fragment.speakerId)));
      for (const text of explicitNameTexts(fragment, paragraph.text, speakerAliases, attributionCharacters)) {
        for (const [alias, owners] of profileAliasOwners) {
          if (owners.size !== 1) continue;
          const entityId = [...owners][0];
          for (const occurrence of aliasOccurrences(text, alias)) matches.push({ ...occurrence, entityId, alias,
            sourceMessageIds: paragraph.sourceMessageIds, sourceLetterId: paragraph.sourceLetterId });
        }
      }
      matches.sort((left, right) => left.start - right.start || right.end - right.start - (left.end - left.start));
      const occupied = [];
      for (const match of matches) {
        if (occupied.some(([start, end]) => match.start < end && match.end > start)) continue;
        occupied.push([match.start, match.end]);
        if (!explicit.has(match.entityId)) explicit.set(match.entityId, { alias: match.alias,
          sourceMessageIds: [...match.sourceMessageIds], sourceLetterId: match.sourceLetterId });
      }
    }

    const allowedIds = new Set([owner, ...visibleConversationEntityIds(fragment), ...explicit.keys()]);
    const relationships = relationshipRows.filter(row => relationshipIsValid(row, owner, campaignToken, date)
      && allowedIds.has(Number(row.entityId)));
    for (const row of relationships) scopedRelationships.push({ fragmentId: fragment.fragmentId, ownerId: owner,
      entityId: Number(row.entityId), types: [...row.types], status: row.status, knownToOwner: true,
      campaignToken, source: row.source, asOf: normalizeGameDate(row.asOf).canonical });

    const evidenceByEntity = new Map();
    const addName = (entityId, name, source, matchedAlias = null, sourceMessageIds = [], sourceLetterId = null) => {
      if (!name) return;
      const key = Number(entityId);
      if (!evidenceByEntity.has(key)) evidenceByEntity.set(key, { fragmentId: fragment.fragmentId,
        entityId: key, name, evidence: [] });
      const row = evidenceByEntity.get(key);
      if (!row.evidence.some(item => item.source === source && item.matchedAlias === matchedAlias)) {
        row.evidence.push({ source, ...(matchedAlias ? { matchedAlias } : {}),
          sourceMessageIds: [...sourceMessageIds], ...(sourceLetterId ? { sourceLetterId } : {}) });
      }
    };
    if (ownerName) addName(owner, ownerName, "OWNER_SELF");
    for (const [entityId, matched] of explicit) {
      if (entityId === owner) continue;
      addName(entityId, matched.alias, "SOURCE_EXPLICIT_NAME", matched.alias, matched.sourceMessageIds, matched.sourceLetterId);
    }
    for (const row of relationships) {
      const entityId = Number(row.entityId);
      if (entityId === owner || explicit.has(entityId)) continue;
      addName(entityId, displayName(profiles.get(entityId)), "OWNER_DIRECT_RELATIONSHIP");
    }
    entityNameEvidence.push(...evidenceByEntity.values());
  }

  return { entityNameEvidence, relationshipEvidence: scopedRelationships };
}

module.exports = { directSpeechSpans, buildCurrentMemory4RelationshipEvidence, buildMemory4EntityContext };
