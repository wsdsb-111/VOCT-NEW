"use strict";

const { LIMITS, createEvidence } = require("./social-consequence-types");

function ensureEvidenceStore(conversation) {
  if (!(conversation.temporarySocialEvidenceStore instanceof Map)) conversation.temporarySocialEvidenceStore = new Map();
  return conversation.temporarySocialEvidenceStore;
}

function getMemoryText(entry) {
  if (typeof entry?.content === "string") return entry.content;
  if (typeof entry?.text === "string") return entry.text;
  if (typeof entry?.memory?.content === "string") return entry.memory.content;
  if (typeof entry?.memory?.text === "string") return entry.memory.text;
  return "";
}

function captureMemoryEvidence({ conversation, messageId, characterId, memoryContext, estimateTokens }) {
  const store = ensureEvidenceStore(conversation);
  const evidence = [];
  let usedTokens = 0;
  for (const [index, entry] of (memoryContext?.turnRecall || []).entries()) {
    const content = getMemoryText(entry).trim();
    if (!content) continue;
    const tokens = Math.max(0, Number(estimateTokens?.(content)) || 0);
    if (usedTokens + tokens > LIMITS.memoryTokens) continue;
    usedTokens += tokens;
    evidence.push(createEvidence({
      evidenceId: `memory:${messageId}:${entry.memoryId || entry.memory?.memoryId || index}`,
      type: "memory",
      sourceMessageId: messageId,
      sourceEventId: entry.provenance?.sourceEventId || entry.memory?.provenance?.sourceEventId || null,
      actorId: characterId,
      content,
      confidence: Number(entry.confidence ?? entry.score ?? 0.8),
      worldStateConfirmed: false
    }));
  }
  const snapshot = Object.freeze({ characterId: Number(characterId), evidence: Object.freeze(evidence), tokens: usedTokens });
  store.set(messageId, snapshot);
  return snapshot;
}

function activeCharacters(conversation) {
  const values = typeof conversation.getActiveConversationCharacters === "function"
    ? conversation.getActiveConversationCharacters()
    : [...(conversation.gameData?.characters?.values?.() || [])];
  return values.filter((character) => character && !conversation.inactiveParticipantIds?.has?.(character.id) && !conversation.waitingCharacterIds?.has?.(character.id) && !conversation.departedCharacterIds?.has?.(character.id) && character.isDead !== true && character.dead !== true && character.alive !== false);
}

function resolveSpeaker(conversation, message, characters) {
  if (message?.role === "user") return conversation.gameData?.characters?.get?.(conversation.gameData.playerID) || null;
  return characters.find((character) => character.fullName === message?.name || character.shortName === message?.name) || null;
}

function normalizeRelations(characters) {
  return Object.freeze(characters.flatMap((character) => (character.relationsToCharacters || []).map((entry) => Object.freeze({
    sourceCharacterId: Number(character.id),
    targetCharacterId: Number(entry.id),
    relations: Object.freeze([...(entry.relations || [])])
  }))));
}

function normalizeOpinions(characters) {
  return Object.freeze(characters.flatMap((character) => (character.opinions || []).map((entry) => Object.freeze({
    sourceCharacterId: Number(character.id),
    targetCharacterId: Number(entry.id),
    value: Number(entry.opinion ?? entry.opinon ?? entry.value ?? 0)
  }))));
}

function buildKnowledgeMap(characters, dialogueEvidence, memorySnapshot, confirmedWorldEvents) {
  const result = {};
  for (const character of characters) result[character.id] = {};
  for (const item of dialogueEvidence) {
    for (const character of characters) result[character.id][item.evidenceId] = Object.freeze({ known: true, basis: "current_dialogue" });
  }
  for (const item of memorySnapshot?.evidence || []) {
    if (result[memorySnapshot.characterId]) result[memorySnapshot.characterId][item.evidenceId] = Object.freeze({ known: true, basis: "memory" });
  }
  for (const item of confirmedWorldEvents) {
    const directIds = new Set([item.actorId, item.targetId, item.affectedCharacterId].filter((value) => value != null).map(Number));
    for (const characterId of directIds) {
      if (result[characterId]) result[characterId][item.evidenceId] = Object.freeze({ known: true, basis: Number(characterId) === Number(item.actorId) ? "direct_actor" : "direct_victim" });
    }
    const witnessIds = item.witnessIds?.length > 0 ? item.witnessIds : item.observable !== false ? characters.map((character) => Number(character.id)) : [];
    for (const characterId of witnessIds) {
      if (!directIds.has(Number(characterId)) && result[characterId]) result[characterId][item.evidenceId] = Object.freeze({ known: true, basis: "visible_witness" });
    }
  }
  for (const value of Object.values(result)) Object.freeze(value);
  return Object.freeze(result);
}

function buildContext({ conversation, message, confirmedEvents = [] }) {
  const characters = activeCharacters(conversation);
  const speaker = resolveSpeaker(conversation, message, characters);
  const dialogueEvidence = Object.freeze([createEvidence({
    evidenceId: `dialogue:${message?.id ?? "message"}`,
    type: "dialogue",
    sourceMessageId: message?.id ?? null,
    actorId: speaker?.id ?? null,
    content: message?.content || "",
    confidence: 1,
    worldStateConfirmed: false
  })]);
  const confirmedWorldEvents = Object.freeze((confirmedEvents || []).filter((event) => event?.success === true && event.effectWritten === true && event.origin !== "social" && !String(event.eventId || "").startsWith("social:")).map((event, index) => createEvidence({
    evidenceId: `confirmed:${event.eventId || index}`,
    type: "confirmed_world_event",
    sourceMessageId: event.sourceMessageId ?? message?.id ?? null,
    sourceEventId: event.eventId ?? null,
    actorId: event.sourceCharacterId ?? null,
    targetId: event.targetCharacterId ?? null,
    affectedCharacterId: event.affectedCharacterId ?? null,
    actionId: event.actionId ?? null,
    content: event.actionId || "confirmed_action",
    confidence: 1,
    worldStateConfirmed: true,
    observable: event.observable !== false,
    witnessIds: event.witnessIds || []
  })));
  const memorySnapshot = ensureEvidenceStore(conversation).get(message?.id) || null;
  const memoryEvidence = memorySnapshot?.evidence || Object.freeze([]);
  const recentDialogue = Object.freeze((conversation.messages || []).filter((entry) => ["user", "assistant"].includes(entry?.role) && typeof entry.content === "string").slice(-LIMITS.recentDialogue).map((entry) => Object.freeze({ id: entry.id, role: entry.role, name: entry.name || null, content: entry.content })));
  return Object.freeze({
    conversationId: conversation.id ?? null,
    turnEpoch: conversation.turnEpoch ?? null,
    message: Object.freeze({ id: message?.id ?? null, role: message?.role || null, name: message?.name || null, content: String(message?.content || "") }),
    dialogueEvidence,
    confirmedWorldEvents,
    memoryEvidence,
    gameFacts: Object.freeze([]),
    directParticipants: Object.freeze(characters.map((character) => Object.freeze({ id: Number(character.id), name: character.fullName || character.shortName, isPlayer: Number(character.id) === Number(conversation.gameData?.playerID) }))),
    observerParticipants: Object.freeze([]),
    relationshipStates: normalizeRelations(characters),
    opinionStates: normalizeOpinions(characters),
    knowledgeMap: buildKnowledgeMap(characters, dialogueEvidence, memorySnapshot, confirmedWorldEvents),
    recentDialogue,
    recentConsequences: Object.freeze([...(conversation.socialConsequenceState?.history || [])])
  });
}

function releaseMessageEvidence(conversation, messageId) {
  return ensureEvidenceStore(conversation).delete(messageId);
}

module.exports = {
  ensureEvidenceStore,
  captureMemoryEvidence,
  buildContext,
  releaseMessageEvidence
};
