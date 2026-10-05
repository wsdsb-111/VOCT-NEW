"use strict";

const { assertScope, hash, ids, legacySourceHash, directCounterpartIds } = require("./memory4-contract");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");

function resolveSpeaker(message, participants) {
  const direct = message.speakerCharacterId ?? message.characterId;
  if (direct != null) return ids([Number(direct)]).find(id => participants.some(person => Number(person.id) === id)) || null;
  const matches = ids(participants.filter(person => message.name && [person.name, person.shortName, person.fullName].includes(message.name)).map(person => Number(person.id)));
  return matches.length === 1 ? matches[0] : null;
}

// The caller supplies application-owned source annotations/persisted records,
// never the output of the new extractor. Legacy knownBy is an ACL, not proof
// that every word of a mixed message was spoken aloud.
function projectVisibleTranscript(context, ownerId) {
  assertScope({ ...context, ownerId });
  const participantIds = ids((context.participants || []).map(participant => participant.id));
  const fragments = [];
  const withheldMessageIds = [];
  const interactionEvidence = [];
  let usesLegacyEvidence = false;
  let presentMessageCount = 0;
  for (const message of context.messages || []) {
    if (!Number.isSafeInteger(message.id) || message.id < 0 || !["user", "assistant"].includes(message.role)
      || message.isStreaming || typeof message.content !== "string" || !message.content.trim()) continue;
    const presentIds = ids((context.participantPresence || []).filter(window =>
      Number.isSafeInteger(window.joinedAtMessageId) && window.joinedAtMessageId <= message.id
      && (window.leftAtMessageId == null || message.id < window.leftAtMessageId)).map(window => window.characterId))
      .filter(id => participantIds.includes(id));
    const speakerId = resolveSpeaker(message, context.participants || []);
    // Authorship remains evidence for self when old Presence is unavailable;
    // a participant list alone never grants observer access.
    if (!presentIds.includes(ownerId) && speakerId !== ownerId) continue;
    presentMessageCount++;
    if (presentIds.includes(ownerId)) {
      for (const entityId of presentIds.filter(id => id !== ownerId)) {
        interactionEvidence.push({ entityId, type: "shared_scene", messageId: message.id, source: "presence_window" });
      }
    }
    const selfOnly = speakerId === ownerId;
    if (!speakerId || !presentIds.includes(speakerId) && !selfOnly) {
      withheldMessageIds.push(message.id);
      usesLegacyEvidence = true;
      continue;
    }
    const sources = Array.isArray(message.memory4Fragments) ? message.memory4Fragments : [];
    const append = (start, end, source, fallback = false) => {
      const text = message.content.slice(start, end);
      if (!text.trim()) return;
      let knownBy = fallback || source.visibility === "private" ? [speakerId]
        : source.visibility === "known_group" ? ids([speakerId, ...ids(source.recipientIds), ...ids(source.knownBy)]).filter(id => presentIds.includes(id)) : presentIds;
      // Existing ACLs can narrow a deterministically bounded source, never
      // expand it or expose its unclassified neighbours.
      for (const acl of [message.knownBy, source.knownBy]) {
        if (Array.isArray(acl) && !fallback) knownBy = knownBy.filter(id => id === speakerId || ids(acl).includes(id));
      }
      if (!knownBy.includes(ownerId)) return;
      const fragmentId = `fragment_${hash([context.conversationId, message.id, start, end, text, knownBy])}`;
      fragments.push({ fragmentId, messageId: message.id, text, speakerId, presentIds: selfOnly ? ids([...presentIds, ownerId]) : presentIds, knownBy,
        visibility: fallback ? "private" : source.visibility, sourceType: fallback ? "self_report" : source.sourceType,
        recipientIds: fallback ? [] : ids(source.recipientIds).filter(id => knownBy.includes(id)),
        entityIds: fallback ? [] : ids(source.entityIds),
        visibilityEvidence: fallback ? "legacy_author_perspective" : "application_fragment" });
    };
    const uncertain = (start, end) => {
      if (!message.content.slice(start, end).trim()) return;
      usesLegacyEvidence = true;
      withheldMessageIds.push(message.id);
      if (selfOnly) append(start, end, {}, true);
    };
    let previousEnd = 0;
    for (const source of sources) {
      if (!Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end) || source.start < previousEnd
        || source.end <= source.start || source.end > message.content.length) throw new Error("memory4_invalid_fragment_span");
      uncertain(previousEnd, source.start);
      previousEnd = source.end;
      if (!["private", "participants", "known_group"].includes(source.visibility)) throw new Error("memory4_invalid_visibility");
      if (!["spoken", "witnessed", "game_fact"].includes(source.sourceType)) throw new Error("memory4_invalid_source_type");
      append(source.start, source.end, source);
    }
    uncertain(previousEnd, message.content.length);
  }
  // A user-edited legacy projection is an explicit owner-scoped assertion.
  // Ordinary model-generated projections stay in Legacy; their ACL alone is
  // not a deterministic speech/thought boundary and is not a migration grant.
  for (const memory of context.legacyMemories || []) {
    const provenance = memory.provenance || {};
    const sameSource = provenance.conversationId ? provenance.conversationId === context.conversationId
      : !!context.finalizationId && provenance.finalizationId === context.finalizationId;
    if (provenance.campaignToken !== context.campaignToken || provenance.folderOwnerId !== ownerId
      || !sameSource || !ids(memory.knownBy).includes(ownerId)
      || memory.deleted || memory.updatedBy !== "user" || provenance.extractionMode !== "user_edited_summary"
      || typeof memory.content !== "string" || !memory.content.trim() || !memory.memoryId) continue;
    usesLegacyEvidence = true;
    const fragmentId = `legacy_${hash([memory.memoryId, memory.version, memory.content, ownerId, context.campaignToken])}`;
    fragments.push({ fragmentId, messageId: null, text: memory.content, speakerId: ownerId, presentIds: [ownerId], knownBy: [ownerId],
      visibility: "private", sourceType: "self_report", recipientIds: [], entityIds: ids(memory.subjects),
      visibilityEvidence: "legacy_user_confirmed_projection", legacyMemoryId: memory.memoryId, legacySourceHash: legacySourceHash(memory) });
  }
  const withheld = [...new Set(withheldMessageIds)];
  return { fragments, presentMessageCount, withheldMessageIds: withheld, interactionEvidence,
    completeness: usesLegacyEvidence ? "partial" : "complete",
    visibilityEvidence: usesLegacyEvidence ? "legacy visibility evidence" : "application_fragment",
    legacyRetained: usesLegacyEvidence,
    sourceRevision: hash([context.campaignToken, ownerId, context.conversationId, context.date, context.totalDays, fragments, withheld, interactionEvidence]) };
}

function evidenceCompleteness(contributions) {
  const statuses = contributions.map(item => item.completeness || "legacy_partial");
  if (!statuses.length) return "legacy_partial";
  return statuses.every(status => status === "complete") ? "complete"
    : statuses.includes("legacy_partial") ? "legacy_partial" : "partial";
}

function updateKnownEntities(previous, snapshot) {
  assertScope(snapshot);
  if (previous && (previous.campaignToken !== snapshot.campaignToken || previous.ownerId !== snapshot.ownerId)) throw new Error("memory4_scope_mismatch");
  const index = JSON.parse(JSON.stringify(previous || { campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId, revision: 0, entities: {} }));
  const evidence = new Map();
  const add = (entityId, type) => {
    if (entityId === snapshot.ownerId) return;
    if (!evidence.has(entityId)) evidence.set(entityId, new Set());
    evidence.get(entityId).add(type);
  };
  // Co-presence is kept even when no fragment is safe to extract. It is not
  // direct-conversation evidence and grants no access to withheld prose.
  for (const evidence of snapshot.interactionEvidence || []) {
    if (evidence.source === "presence_window" && evidence.type === "shared_scene" && ids([evidence.entityId]).length) add(evidence.entityId, evidence.type);
  }
  for (const fragment of snapshot.fragments) {
    if (!fragment.knownBy.includes(snapshot.ownerId)) throw new Error("memory4_invisible_source");
    // Only an explicit visible exchange supports direct conversation, not a
    // folder, a shared participant list, or a character mentioned in the text.
    if (fragment.visibility !== "private") {
      fragment.presentIds.forEach(id => add(id, "shared_scene"));
      directCounterpartIds([fragment], snapshot.ownerId).forEach(id => add(id, "direct_conversation"));
    }
    fragment.entityIds.forEach(id => add(id, "mention"));
  }
  const affected = new Set([...evidence.keys(), ...Object.entries(index.entities)
    .filter(([, row]) => Object.hasOwn(row.evidenceByConversation || {}, snapshot.conversationId)).map(([key]) => Number(key))]);
  for (const entityId of affected) {
    const key = String(entityId);
    const row = index.entities[key] || { entityId, evidenceTypes: [], directConversationCount: 0, sharedSceneCount: 0, mentionCount: 0,
      firstSeenDate: snapshot.date || null, lastSeenDate: snapshot.date || null, sourceEpisodeIds: [], sourceConversationIds: [], evidenceByConversation: {}, completeness: "partial", revision: 0 };
    const types = evidence.get(entityId);
    if (types?.size) row.evidenceByConversation[snapshot.conversationId] = {
      types: [...types].sort(), date: normalizeGameDate(snapshot.date)?.canonical || null,
      episodeId: snapshot.episodeId || null, sourceRevision: snapshot.sourceRevision || null,
      completeness: snapshot.completeness || "partial"
    };
    else delete row.evidenceByConversation[snapshot.conversationId];
    const contributions = Object.entries(row.evidenceByConversation).map(([conversationId, value]) => ({ conversationId,
      types: Array.isArray(value) ? value : value.types || [], date: Array.isArray(value) ? null : value.date,
      episodeId: Array.isArray(value) ? null : value.episodeId, completeness: Array.isArray(value) ? "legacy_partial" : value.completeness }));
    if (!contributions.length && !Object.keys(row.disclosedFacts || {}).length) { delete index.entities[key]; continue; }
    row.directConversationCount = contributions.filter(item => item.types.includes("direct_conversation")).length;
    row.sharedSceneCount = contributions.filter(item => item.types.includes("shared_scene")).length;
    row.mentionCount = contributions.filter(item => item.types.includes("mention")).length;
    row.evidenceTypes = [...new Set(contributions.flatMap(item => item.types))].sort();
    row.sourceConversationIds = contributions.map(item => item.conversationId).sort();
    row.sourceEpisodeIds = [...new Set(contributions.map(item => item.episodeId).filter(Boolean))].sort();
    const dates = contributions.map(item => normalizeGameDate(item.date)).filter(Boolean).sort((a, b) => a.serial - b.serial);
    row.firstSeenDate = dates[0]?.canonical || null;
    row.lastSeenDate = dates.at(-1)?.canonical || null;
    row.completeness = evidenceCompleteness(contributions);
    row.revision++;
    index.entities[key] = row;
  }
  index.revision++;
  return index;
}

module.exports = { projectVisibleTranscript, updateKnownEntities, evidenceCompleteness };
