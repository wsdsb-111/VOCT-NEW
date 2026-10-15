"use strict";

function resolveActiveMemoryPairs({ ownerId, history = [], activeParticipantIds = [], playerId = null }) {
  const owner = Number(ownerId);
  const active = new Set(activeParticipantIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0 && id !== owner));
  const messages = history.filter(message => message && ["user", "assistant"].includes(message.role)
    && typeof message.content === "string" && message.content.trim() && !message.isStreaming);
  const speakers = [];
  for (const message of [...messages].reverse()) {
    const speaker = Number(message.speakerCharacterId ?? (message.role === "user" ? playerId : null));
    if (!active.has(speaker)) continue;
    const targets = [...new Set([message.addresseeId, message.targetCharacterId, ...(message.recipientIds || [])]
      .map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
    if (targets.length === 1 && targets[0] === owner) return { counterpartIds: [speaker], querySpeakerId: speaker, query: message.content, evidence: "DIRECT_PAIR" };
    if (targets.length && !targets.includes(owner)) continue;
    if (!speakers.some(row => row.id === speaker)) speakers.push({ id: speaker, message });
    break;
  }
  if (speakers.length) return {
    counterpartIds: speakers.slice(0, active.size === 1 ? 1 : 2).map(row => row.id),
    querySpeakerId: speakers[0].id, query: speakers[0].message.content,
    evidence: active.size === 1 ? "DIRECT_PAIR" : "GROUP_WITNESSED"
  };
  return { counterpartIds: [...active].slice(0, 2), querySpeakerId: null, query: "", evidence: "UNDETERMINED" };
}

module.exports = { resolveActiveMemoryPairs };
