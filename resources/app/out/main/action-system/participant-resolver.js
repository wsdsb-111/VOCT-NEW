"use strict";

const { createParticipantBinding, createUnresolvedBinding } = require("./action-types");
const { getCharacterAliases, escapeRegExp } = require("./reference-context");

function patternFor(character) {
  return getCharacterAliases(character).map(escapeRegExp).join("|");
}

function getActionPositions(text, definition) {
  const positions = [];
  for (const pattern of definition?.semantic?.evidencePatterns || []) {
    const flags = pattern.flags.replace("g", "").replace("y", "") + "g";
    for (const match of text.matchAll(new RegExp(pattern.source, flags))) positions.push(match.index);
  }
  return positions;
}

function replaceResolvedPronouns(text, references, gameData) {
  let result = text;
  for (const reference of references || []) {
    if (reference.mode !== "resolved" || reference.referenceType === "first_person" || !reference.surface || !reference.characterId) continue;
    const character = gameData?.characters?.get?.(reference.characterId);
    if (!character) continue;
    result = result.replace(reference.surface, character.fullName || character.shortName);
  }
  return result;
}

class ParticipantResolver {
  static resolve({ event, message, speaker, gameData, actionDefinition, actionId = null, references = [] }) {
    const participantRoles = actionDefinition?.semantic?.participantRoles;
    if (!participantRoles) return { mode: "speaker", sourceCharacter: speaker, targetCharacter: null, binding: null };
    const originalText = event?.evidence?.text || "";
    const characters = Array.from(gameData?.characters?.values?.() || []);
    const baseInput = { messageId: message?.id, eventId: event?.eventId, actionId, speakerCharacterId: speaker?.id, evidence: event?.evidence, references };
    if (!speaker || !originalText || characters.length === 0) return { mode: "unresolved", reason: "missing_participant_context", binding: createUnresolvedBinding({ ...baseInput, unresolvedReason: "missing_participant_context" }) };
    if (/(?:让|叫|命令).{0,24}(?:杀|刺|砍|关|囚禁|任命|雇佣|招募)/.test(originalText)) return { mode: "unresolved", reason: "unsupported_causative", binding: createUnresolvedBinding({ ...baseInput, unresolvedReason: "unsupported_causative" }) };
    const unresolvedReference = references.find((reference) => reference.mode === "unresolved");
    if (unresolvedReference) {
      const legacyReason = ["ambiguous_third_person", "unresolved_ambiguous_addressee", "unresolved_ambiguous_counterpart"].includes(unresolvedReference.reason) ? "ambiguous_pronoun" : unresolvedReference.reason;
      return { mode: "unresolved", reason: legacyReason, binding: createUnresolvedBinding({ ...baseInput, unresolvedReason: unresolvedReference.reason }) };
    }
    const evidenceText = replaceResolvedPronouns(originalText, references, gameData);
    const actionPositions = getActionPositions(evidenceText, actionDefinition);
    const actionBetween = (start, end) => actionPositions.some((position) => position >= start && position <= end);
    const matches = (pattern) => new RegExp(pattern).test(evidenceText);
    const resolve = (actor, patient, reason) => {
      const byRole = { actor, patient, speaker };
      const sourceCharacter = byRole[participantRoles.source];
      const targetCharacter = byRole[participantRoles.target];
      if (!sourceCharacter || !targetCharacter) return { mode: "unresolved", reason: "unresolved_participants", binding: createUnresolvedBinding({ ...baseInput, unresolvedReason: "unresolved_participants" }) };
      const binding = createParticipantBinding({
        ...baseInput,
        actorCharacterId: actor.id,
        patientCharacterId: patient.id,
        sourceCharacterId: sourceCharacter.id,
        targetCharacterId: targetCharacter.id,
        resolutionBasis: [reason, `participantRoles.source=${participantRoles.source}`, `participantRoles.target=${participantRoles.target}`]
      });
      return { mode: "resolved", sourceCharacter, targetCharacter, actor, patient, reason, binding };
    };
    const namedCharacters = characters.filter((character) => character.id !== speaker.id && patternFor(character) && new RegExp(patternFor(character)).test(evidenceText));
    const speakerIndex = evidenceText.indexOf("我");
    const reflexive = evidenceText.includes("自己");
    if (reflexive && speakerIndex >= 0 && actionPositions.length > 0) return resolve(speaker, speaker, "reflexive_speaker");
    if (namedCharacters.length === 1) {
      const character = namedCharacters[0];
      const namePattern = patternFor(character);
      if (matches(`我\\s*(?:被|遭)\\s*(?:${namePattern})`) || matches(`我\\s*为\\s*(?:${namePattern})\\s*所`)) return resolve(character, speaker, "explicit_passive");
      if (matches(`(?:${namePattern})\\s*被\\s*我`)) return resolve(speaker, character, "explicit_passive");
      if (matches(`(?:${namePattern})\\s*(?:把|将)\\s*我`)) return resolve(character, speaker, "explicit_active");
      if (matches(`我\\s*(?:把|将)\\s*(?:${namePattern})`)) return resolve(speaker, character, "explicit_active");
      const nameMatches = Array.from(evidenceText.matchAll(new RegExp(namePattern, "g")));
      const afterSpeaker = nameMatches.find((match) => speakerIndex >= 0 && match.index > speakerIndex && actionBetween(speakerIndex, match.index));
      if (afterSpeaker) return resolve(speaker, character, "explicit_active");
      const beforeSpeaker = nameMatches.slice().reverse().find((match) => speakerIndex >= 0 && match.index < speakerIndex && actionBetween(match.index, speakerIndex));
      if (beforeSpeaker) return resolve(character, speaker, "explicit_active");
      if (reflexive && nameMatches.length > 0 && actionPositions.some((position) => position > nameMatches[0].index)) return resolve(character, character, "reflexive_named_subject");
    }
    if (namedCharacters.length === 2) {
      const [first, second] = namedCharacters.slice().sort((left, right) => evidenceText.search(new RegExp(patternFor(left))) - evidenceText.search(new RegExp(patternFor(right))));
      const firstPattern = patternFor(first);
      const secondPattern = patternFor(second);
      if (matches(`(?:${firstPattern})\\s*(?:被|遭)\\s*(?:${secondPattern})`) || matches(`(?:${firstPattern})\\s*为\\s*(?:${secondPattern})\\s*所`)) return resolve(second, first, "explicit_passive");
      if (matches(`(?:${firstPattern})\\s*(?:把|将)\\s*(?:${secondPattern})`)) return resolve(first, second, "explicit_active");
      const firstIndex = evidenceText.search(new RegExp(firstPattern));
      const secondIndex = evidenceText.search(new RegExp(secondPattern));
      if (firstIndex >= 0 && secondIndex >= 0 && actionBetween(firstIndex, secondIndex)) return resolve(first, second, "explicit_active");
    }
    if (namedCharacters.length > 2) return { mode: "unresolved", reason: "multiple_possible_targets", binding: createUnresolvedBinding({ ...baseInput, unresolvedReason: "multiple_possible_targets" }) };
    const hasUnresolvedPronoun = /[他她它]|(?:你|您|对方)/.test(originalText);
    return { mode: "unresolved", reason: namedCharacters.length === 0 && !hasUnresolvedPronoun ? "missing_named_patient" : "ambiguous_participant_direction", binding: createUnresolvedBinding({ ...baseInput, unresolvedReason: namedCharacters.length === 0 && !hasUnresolvedPronoun ? "missing_named_patient" : "ambiguous_participant_direction" }) };
  }
}

module.exports = { ParticipantResolver };
