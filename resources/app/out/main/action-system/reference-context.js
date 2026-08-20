"use strict";

const MAX_RECENT_MESSAGES = 4;
const MAX_RECENT_MENTIONS = 12;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getDerivedNameAliases(value) {
  if (typeof value !== "string" || !/[·•\s]/.test(value.trim())) return [];
  const parts = value.trim().split(/[·•\s]+/).filter(Boolean);
  if (parts.length !== 2) return [];
  const separator = value.match(/[·•]/)?.[0] || " ";
  return [parts.join(""), parts.slice().reverse().join(""), parts.slice().reverse().join(separator)];
}

function getCharacterAliases(character) {
  const baseAliases = [character.fullName, character.shortName, ...(Array.isArray(character.aliases) ? character.aliases : [])];
  const aliases = baseAliases.flatMap((alias) => [alias, ...getDerivedNameAliases(alias)]);
  return Array.from(new Set(aliases.filter((alias) => typeof alias === "string" && alias.trim())));
}

function getCharacterGender(character) {
  const value = character.gender ?? character.sex ?? character.sexualityGender;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["female", "f", "woman", "woman_gender"].includes(normalized)) return "female";
    if (["male", "m", "man", "man_gender"].includes(normalized)) return "male";
  }
  if (character.isFemale === true) return "female";
  if (character.isMale === true) return "male";
  if (typeof character.fullName === "string" && /氏$/.test(character.fullName)) return "female";
  return null;
}

function buildMessageReferenceIndex({ messageId, text, characters }) {
  const source = typeof text === "string" ? text : "";
  const allCharacters = Array.from(characters || []);
  const aliasOwners = new Map();
  for (const character of allCharacters) {
    for (const alias of getCharacterAliases(character)) {
      const owners = aliasOwners.get(alias) || [];
      owners.push(character);
      aliasOwners.set(alias, owners);
    }
  }
  const mentions = [];
  for (const [alias, owners] of aliasOwners) {
    const pattern = new RegExp(escapeRegExp(alias), "g");
    for (const match of source.matchAll(pattern)) {
      mentions.push({
        characterId: owners.length === 1 ? owners[0].id : null,
        candidateCharacterIds: owners.map((character) => character.id),
        messageId,
        start: match.index,
        end: match.index + match[0].length,
        surface: match[0],
        explicit: true,
        gender: owners.length === 1 ? getCharacterGender(owners[0]) : null,
        ambiguous: owners.length !== 1
      });
    }
  }
  mentions.sort((left, right) => left.start - right.start || right.surface.length - left.surface.length);
  const filteredMentions = mentions.filter((mention, index) => !mentions.some((other, otherIndex) => otherIndex !== index && other.start === mention.start && other.end >= mention.end && other.surface.length > mention.surface.length));
  const pronouns = [];
  for (const match of source.matchAll(/我自己|本人|我|您|你|对方|他|她|它|自己/g)) {
    pronouns.push({ surface: match[0], start: match.index, end: match.index + match[0].length });
  }
  return Object.freeze({
    messageId,
    mentions: Object.freeze(filteredMentions),
    pronouns: Object.freeze(pronouns),
    explicitCharacterIds: Object.freeze(Array.from(new Set(filteredMentions.map((mention) => mention.characterId).filter((id) => id != null)))),
    aliasMatches: Object.freeze(filteredMentions)
  });
}

class ConversationReferenceContext {
  constructor({ conversationId = null, activeParticipantIds = [], primaryAddresseeId = null } = {}) {
    this.conversationId = conversationId;
    this.turnId = null;
    this.currentSpeakerId = null;
    this.primaryAddresseeId = primaryAddresseeId;
    this.activeParticipantIds = Array.from(new Set(activeParticipantIds));
    this.recentMentions = [];
    this.indexByMessageId = new Map();
    this.messageOrder = [];
    this.lastExplicitActorId = null;
    this.lastExplicitPatientId = null;
    this.lastDirectedSpeakerId = null;
    this.lastDirectedAddresseeId = primaryAddresseeId;
  }

  observeMessage({ message, speaker, characters, primaryAddresseeId = null, turnId = null }) {
    if (!message) return null;
    const messageId = message.id ?? `message_${this.messageOrder.length + 1}`;
    const index = buildMessageReferenceIndex({ messageId, text: message.content, characters });
    this.indexByMessageId.set(messageId, index);
    this.messageOrder = this.messageOrder.filter((id) => id !== messageId);
    this.messageOrder.push(messageId);
    while (this.messageOrder.length > MAX_RECENT_MESSAGES) this.indexByMessageId.delete(this.messageOrder.shift());
    this.currentSpeakerId = speaker?.id ?? null;
    this.turnId = turnId ?? messageId;
    if (primaryAddresseeId != null) {
      this.primaryAddresseeId = primaryAddresseeId;
      this.lastDirectedSpeakerId = this.currentSpeakerId;
      this.lastDirectedAddresseeId = primaryAddresseeId;
    }
    const freshMentions = [];
    for (const id of this.messageOrder) freshMentions.push(...(this.indexByMessageId.get(id)?.mentions || []));
    this.recentMentions = freshMentions.filter((mention) => mention.characterId != null).slice(-MAX_RECENT_MENTIONS);
    return index;
  }
}

module.exports = {
  ConversationReferenceContext,
  buildMessageReferenceIndex,
  getCharacterAliases,
  getDerivedNameAliases,
  getCharacterGender,
  escapeRegExp,
  MAX_RECENT_MESSAGES,
  MAX_RECENT_MENTIONS
};
