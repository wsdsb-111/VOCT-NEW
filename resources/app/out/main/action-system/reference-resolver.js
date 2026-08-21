"use strict";

const { buildMessageReferenceIndex, getCharacterGender } = require("./reference-context");
const { createReferenceResolution } = require("./action-types");

function unresolved(referenceType, surface, reason, start = null, end = null) {
  return createReferenceResolution({ mode: "unresolved", referenceType, surface, characterId: null, confidenceBasis: [], reason, start, end });
}

function resolved(referenceType, surface, character, basis, start = null, end = null) {
  return createReferenceResolution({ mode: "resolved", referenceType, surface, characterId: character.id, confidenceBasis: [basis], reason: null, start, end });
}

function getCharacter(gameData, id) {
  return id != null ? gameData?.characters?.get?.(id) || null : null;
}

function getExplicitVocativeId(index, source, gameData, activeIds) {
  const firstPerson = source.search(/(?:我自己|本人|我)/);
  if (firstPerson < 0) return null;
  const vocative = index.mentions.filter((mention) => !mention.ambiguous && mention.end <= firstPerson && /^[\s，,：:]*$/.test(source.slice(mention.end, firstPerson)));
  if (vocative.length !== 1) return null;
  return activeIds.has(vocative[0].characterId) ? getCharacter(gameData, vocative[0].characterId)?.id ?? null : null;
}

class ReferenceResolver {
  static resolveEventReferences({ message, event, speaker, gameData, referenceContext, primaryAddresseeId = null, actionDefinition = null }) {
    const source = event?.evidence?.text || message?.content || "";
    const characters = Array.from(gameData?.characters?.values?.() || []);
    const index = referenceContext?.indexByMessageId?.get(message?.id) || buildMessageReferenceIndex({ messageId: message?.id, text: message?.content, characters });
    const activeIds = new Set(Array.isArray(referenceContext?.activeParticipantIds) ? referenceContext.activeParticipantIds : characters.map((character) => character.id));
    const completeIndex = buildMessageReferenceIndex({ messageId: message?.id, text: message?.content, characters });
    const isHighRisk = actionDefinition?.isDestructive === true || actionDefinition?.semantic?.riskLevel === "high";
    const evidenceStart = event?.evidence?.start ?? 0;
    const evidenceEnd = event?.evidence?.end ?? (evidenceStart + source.length);
    const localOffset = (mention) => ({ start: mention.start - evidenceStart, end: mention.end - evidenceStart });
    const getActiveCharacter = (id) => activeIds.has(id) ? getCharacter(gameData, id) : null;
    const references = [];
    for (const mention of completeIndex.mentions) {
      if (!mention.ambiguous && !activeIds.has(mention.characterId) && mention.start >= evidenceStart && mention.end <= evidenceEnd && source.includes(mention.surface)) {
        const offset = localOffset(mention);
        references.push(unresolved("explicit_name", mention.surface, "unavailable_reference_target", offset.start, offset.end));
      }
    }
    for (const mention of index.mentions) {
      if (mention.start >= evidenceStart && mention.end <= evidenceEnd && source.includes(mention.surface)) {
        const offset = localOffset(mention);
        if (mention.ambiguous) references.push(unresolved("explicit_name", mention.surface, "ambiguous_named_character", offset.start, offset.end));
        else if (!activeIds.has(mention.characterId)) references.push(unresolved("explicit_name", mention.surface, "unavailable_reference_target", offset.start, offset.end));
        else references.push(resolved("explicit_name", mention.surface, getCharacter(gameData, mention.characterId), "unique_explicit_name", offset.start, offset.end));
      }
    }
    const localPronouns = Array.from(source.matchAll(/我自己|本人|我|您|你|对方|他|她|它|自己/g)).map((match) => ({ surface: match[0], start: match.index, end: match.index + match[0].length }));
    const explicitVocativeId = getExplicitVocativeId(index, message?.content || source, gameData, activeIds);
    const configuredAddresseeId = primaryAddresseeId ?? message?.primaryAddresseeId ?? message?.addresseeCharacterId ?? referenceContext?.primaryAddresseeId ?? (referenceContext?.lastDirectedSpeakerId === speaker?.id ? referenceContext.lastDirectedAddresseeId : null);
    const interlocutors = characters.filter((character) => character.id !== speaker?.id && activeIds.has(character.id));
    for (const pronoun of localPronouns) {
      const { surface, start, end } = pronoun;
      if (["我", "本人", "我自己"].includes(surface)) {
        references.push(speaker ? resolved("first_person", surface, speaker, "message_speaker", start, end) : unresolved("first_person", surface, "missing_speaker", start, end));
      } else if (["你", "您"].includes(surface)) {
        const addressee = getActiveCharacter(explicitVocativeId ?? configuredAddresseeId);
        if (addressee) references.push(resolved("second_person", surface, addressee, explicitVocativeId != null ? "explicit_vocative" : "primary_addressee", start, end));
        else if (interlocutors.length === 1) references.push(resolved("second_person", surface, interlocutors[0], "unique_interlocutor", start, end));
        else references.push(unresolved("second_person", surface, "unresolved_ambiguous_addressee", start, end));
      } else if (surface === "对方") {
        const counterpart = getActiveCharacter(configuredAddresseeId);
        if (counterpart) references.push(resolved("counterpart", surface, counterpart, "directed_addressee", start, end));
        else if (interlocutors.length === 1) references.push(resolved("counterpart", surface, interlocutors[0], "unique_interlocutor", start, end));
        else references.push(unresolved("counterpart", surface, "unresolved_ambiguous_counterpart", start, end));
      } else if (surface === "它") {
        references.push(unresolved("third_person", surface, "unsupported_entity_reference", start, end));
      } else if (["他", "她"].includes(surface)) {
        const gender = surface === "他" ? "male" : "female";
        const candidates = (referenceContext?.recentMentions || index.mentions).filter((mention) => mention.characterId != null && activeIds.has(mention.characterId) && (mention.messageId !== message?.id || mention.start < (event?.evidence?.end ?? Infinity))).map((mention) => getCharacter(gameData, mention.characterId)).filter(Boolean).filter((character, position, list) => list.findIndex((item) => item.id === character.id) === position).filter((character) => {
          const knownGender = getCharacterGender(character);
          return knownGender ? knownGender === gender : true;
        });
        if (candidates.length === 1) references.push(resolved("third_person", surface, candidates[0], `unique_recent_${gender}_mention`, start, end));
        else if (activeIds.size === 2 && interlocutors.length === 1) {
          const [interlocutor] = interlocutors;
          const knownGender = getCharacterGender(interlocutor);
          if (knownGender && knownGender !== gender) references.push(unresolved("third_person", surface, "unresolved_gender_mismatch", start, end));
          else if (!knownGender && isHighRisk) references.push(unresolved("third_person", surface, "unknown_gender_high_risk", start, end));
          else references.push(resolved("third_person", surface, interlocutor, `unique_interlocutor_${gender}`, start, end));
        } else references.push(unresolved("third_person", surface, "ambiguous_third_person", start, end));
      } else if (surface === "自己") {
        references.push(createReferenceResolution({ mode: "resolved", referenceType: "reflexive", surface, characterId: null, confidenceBasis: ["clause_subject"], reason: null, start, end }));
      }
    }
    return Object.freeze(references);
  }
}

module.exports = { ReferenceResolver };
