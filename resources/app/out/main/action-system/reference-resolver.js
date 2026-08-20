"use strict";

const { buildMessageReferenceIndex, getCharacterGender } = require("./reference-context");

function unresolved(referenceType, surface, reason) {
  return { mode: "unresolved", referenceType, surface, characterId: null, confidenceBasis: [], reason };
}

function resolved(referenceType, surface, character, basis) {
  return { mode: "resolved", referenceType, surface, characterId: character.id, confidenceBasis: [basis], reason: null };
}

function getCharacter(gameData, id) {
  return id != null ? gameData?.characters?.get?.(id) || null : null;
}

function getExplicitVocativeId(index, source, gameData) {
  const firstPerson = source.search(/(?:我自己|本人|我)/);
  if (firstPerson < 0) return null;
  const vocative = index.mentions.filter((mention) => !mention.ambiguous && mention.end <= firstPerson && /^[\s，,：:]*$/.test(source.slice(mention.end, firstPerson)));
  if (vocative.length !== 1) return null;
  return getCharacter(gameData, vocative[0].characterId)?.id ?? null;
}

class ReferenceResolver {
  static resolveEventReferences({ message, event, speaker, gameData, referenceContext, primaryAddresseeId = null }) {
    const source = event?.evidence?.text || message?.content || "";
    const characters = Array.from(gameData?.characters?.values?.() || []);
    const index = referenceContext?.indexByMessageId?.get(message?.id) || buildMessageReferenceIndex({ messageId: message?.id, text: message?.content, characters });
    const activeIds = new Set(referenceContext?.activeParticipantIds?.length ? referenceContext.activeParticipantIds : characters.map((character) => character.id));
    const references = [];
    for (const mention of index.mentions) {
      if (mention.start >= (event?.evidence?.start ?? 0) && mention.end <= (event?.evidence?.end ?? source.length) && source.includes(mention.surface)) {
        references.push(mention.ambiguous ? unresolved("explicit_name", mention.surface, "ambiguous_named_character") : resolved("explicit_name", mention.surface, getCharacter(gameData, mention.characterId), "unique_explicit_name"));
      }
    }
    const localPronouns = source.match(/我自己|本人|我|您|你|对方|他|她|它|自己/g) || [];
    const explicitVocativeId = getExplicitVocativeId(index, message?.content || source, gameData);
    const configuredAddresseeId = primaryAddresseeId ?? message?.primaryAddresseeId ?? message?.addresseeCharacterId ?? referenceContext?.primaryAddresseeId ?? (referenceContext?.lastDirectedSpeakerId === speaker?.id ? referenceContext.lastDirectedAddresseeId : null);
    const interlocutors = characters.filter((character) => character.id !== speaker?.id && activeIds.has(character.id));
    for (const surface of localPronouns) {
      if (["我", "本人", "我自己"].includes(surface)) {
        references.push(speaker ? resolved("first_person", surface, speaker, "message_speaker") : unresolved("first_person", surface, "missing_speaker"));
      } else if (["你", "您"].includes(surface)) {
        const addressee = getCharacter(gameData, explicitVocativeId ?? configuredAddresseeId);
        if (addressee) references.push(resolved("second_person", surface, addressee, explicitVocativeId != null ? "explicit_vocative" : "primary_addressee"));
        else if (interlocutors.length === 1) references.push(resolved("second_person", surface, interlocutors[0], "unique_interlocutor"));
        else references.push(unresolved("second_person", surface, "unresolved_ambiguous_addressee"));
      } else if (surface === "对方") {
        const counterpart = getCharacter(gameData, configuredAddresseeId);
        if (counterpart) references.push(resolved("counterpart", surface, counterpart, "directed_addressee"));
        else if (interlocutors.length === 1) references.push(resolved("counterpart", surface, interlocutors[0], "unique_interlocutor"));
        else references.push(unresolved("counterpart", surface, "unresolved_ambiguous_counterpart"));
      } else if (surface === "它") {
        references.push(unresolved("third_person", surface, "unsupported_entity_reference"));
      } else if (["他", "她"].includes(surface)) {
        const gender = surface === "他" ? "male" : "female";
        const candidates = (referenceContext?.recentMentions || index.mentions).filter((mention) => mention.characterId != null && activeIds.has(mention.characterId) && (mention.messageId !== message?.id || mention.start < (event?.evidence?.end ?? Infinity))).map((mention) => getCharacter(gameData, mention.characterId)).filter(Boolean).filter((character, position, list) => list.findIndex((item) => item.id === character.id) === position).filter((character) => {
          const knownGender = getCharacterGender(character);
          return knownGender ? knownGender === gender : true;
        });
        if (candidates.length === 1) references.push(resolved("third_person", surface, candidates[0], `unique_recent_${gender}_mention`));
        else references.push(unresolved("third_person", surface, "ambiguous_third_person"));
      } else if (surface === "自己") {
        references.push({ mode: "resolved", referenceType: "reflexive", surface, characterId: null, confidenceBasis: ["clause_subject"], reason: null });
      }
    }
    return Object.freeze(references);
  }
}

module.exports = { ReferenceResolver };
