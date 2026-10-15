"use strict";

const { assertScope, hash, ids, strings, directCounterpartIds } = require("./memory4-contract");

function optionalId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function messageIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(value => Number.isSafeInteger(value) && value >= 0))]
    .sort((a, b) => a - b);
}

function createProjectionLineage({ campaignToken, ownerId, conversationId = null, finalizationId = null, sourceLetterId = null,
  counterpartId, segmentIds = [], legacyMemoryIds = [], projectionId = null, sourceSegmentIds = [], sourceMessageIds = [] } = {}) {
  const scope = { campaignToken, ownerId };
  assertScope(scope);
  const counterpart = Number(counterpartId);
  if (!Number.isSafeInteger(counterpart) || counterpart <= 0 || counterpart === ownerId) throw new Error("memory4_projection_counterpart_invalid");
  const conversation = optionalId(conversationId), finalization = optionalId(finalizationId), letter = optionalId(sourceLetterId);
  const segments = strings(segmentIds), legacyIds = strings(legacyMemoryIds);
  if (!conversation && !finalization && !segments.length && !legacyIds.length) throw new Error("memory4_projection_lineage_incomplete");
  const identity = ["memory4_projection_v1", campaignToken, ownerId, conversation, finalization, counterpart, segments];
  if (!conversation && !finalization && !segments.length) identity.push("legacy", legacyIds);
  const expectedId = `m4p_${hash(identity)}`;
  if (projectionId != null && projectionId !== expectedId) throw new Error("memory4_projection_id_mismatch");
  return { campaignToken, ownerId, conversationId: conversation, finalizationId: finalization, sourceLetterId: letter,
    counterpartId: counterpart, segmentIds: segments, legacyMemoryIds: legacyIds, projectionId: expectedId,
    ...(strings(sourceSegmentIds).length ? { sourceSegmentIds: strings(sourceSegmentIds) } : {}),
    ...(messageIds(sourceMessageIds).length ? { sourceMessageIds: messageIds(sourceMessageIds) } : {}) };
}

function projectionLineageFromSummary(summary, { ownerId = null, counterpartId = null, legacyMemoryIds = [] } = {}) {
  const provenance = summary?.provenance || {};
  const campaignToken = summary?.campaignToken || provenance.campaignToken;
  if (typeof campaignToken !== "string" || !campaignToken.trim()) return null;
  const numericOwnerId = Number(summary?.perspectiveOwnerId ?? provenance.folderOwnerId ?? ownerId);
  const numericCounterpartId = Number(counterpartId ?? summary?.characterId ?? provenance.counterpartId);
  if (!Number.isSafeInteger(numericOwnerId) || !Number.isSafeInteger(numericCounterpartId) || numericCounterpartId === numericOwnerId) return null;
  const conversationId = summary?.conversationId || provenance.conversationId;
  const finalizationId = summary?.finalizationId || provenance.finalizationId;
  const segmentIds = summary?.perspectiveSummarySegmentIds || summary?.segmentIds || provenance.perspectiveSummarySegmentIds || provenance.segmentIds || [];
  const sourceIds = [summary?.perspectiveMemoryIds, summary?.legacyMemoryIds,
    provenance.perspectiveMemoryIds, provenance.legacyMemoryIds, legacyMemoryIds].flatMap(value => Array.isArray(value) ? value : []);
  const sourceSegmentIds = summary?.sourceSegmentIds || provenance.sourceSegmentIds || [];
  const sourceMessageIds = summary?.sourceMessageIds || provenance.sourceMessageIds || [];
  if (!optionalId(conversationId) && !optionalId(finalizationId) && !strings(segmentIds).length && !strings(sourceIds).length) return null;
  return createProjectionLineage({ campaignToken, ownerId: numericOwnerId,
    conversationId, finalizationId, counterpartId: numericCounterpartId, segmentIds,
    legacyMemoryIds: sourceIds, projectionId: summary?.projectionId || provenance.projectionId || null,
    sourceSegmentIds, sourceMessageIds, sourceLetterId: summary?.sourceLetterId || summary?.letterId
      || provenance.sourceLetterId || provenance.letterId || null });
}

function segmentAliases(values) {
  return new Set(strings(values).flatMap(value => {
    const aliases = [value];
    let stripped = value;
    while (stripped.startsWith("segment_")) {
      stripped = stripped.slice("segment_".length);
      aliases.push(stripped);
    }
    return aliases;
  }));
}

function intersects(left, right) {
  const values = segmentAliases(left);
  return strings(right).some(value => values.has(value) || [...values].some(alias => segmentAliases([value]).has(alias)));
}

function sameOptional(left, right, key) {
  return !left[key] || !right[key] || left[key] === right[key];
}

function matchesProjectionLineage(left, right) {
  if (!left || !right || left.campaignToken !== right.campaignToken || Number(left.ownerId) !== Number(right.ownerId)
    || Number(left.counterpartId) !== Number(right.counterpartId)) return false;
  if (left.projectionId && right.projectionId && left.projectionId === right.projectionId) return true;
  if (!sameOptional(left, right, "conversationId") || !sameOptional(left, right, "finalizationId")
    || !sameOptional(left, right, "sourceLetterId")) return false;
  return intersects(left.segmentIds, right.sourceSegmentIds?.length ? right.sourceSegmentIds : right.segmentIds)
    || intersects(left.legacyMemoryIds, right.legacyMemoryIds);
}

function matchesSourceLineage(scope, source, counterpartIds, target) {
  if (!source || scope.campaignToken !== target.campaignToken || Number(scope.ownerId) !== Number(target.ownerId)) return false;
  const pairMatches = ids(counterpartIds).includes(Number(target.counterpartId));
  const exactSummaryMatch = target.legacyMemoryIds.length && intersects(target.legacyMemoryIds, source.summaryIds || []);
  if (!pairMatches && !exactSummaryMatch) return false;
  if (target.finalizationId && source.finalizationId !== target.finalizationId
    || target.conversationId && source.conversationId && source.conversationId !== target.conversationId) return false;
  if (target.legacyMemoryIds.length && intersects(target.legacyMemoryIds, source.legacyMemoryIds || [])) return true;
  if (exactSummaryMatch) return true;
  return !!(target.segmentIds.length || target.sourceSegmentIds?.length || target.sourceMessageIds?.length)
    && (intersects([...target.segmentIds, ...(target.sourceSegmentIds || [])], source.segmentIds)
      || messageIds(target.sourceMessageIds).some(id => messageIds(source.messageIds).includes(id))
      );
}

function disclosureProofForgetMatch(target, proof) {
  const lineages = Array.isArray(proof.projectionLineages) ? proof.projectionLineages : [];
  if (lineages.length) return lineages.some(lineage => matchesProjectionLineage(target, lineage)) ? true : false;
  if (proof.sourceKind === "LETTER" && target.sourceLetterId && proof.sourceLetterId === target.sourceLetterId
    && Number(proof.recipientId) === Number(target.ownerId)
    && Number(proof.senderId) === Number(target.counterpartId)) return true;
  const targetFragments = [...target.segmentIds, ...(target.sourceSegmentIds || []), ...target.legacyMemoryIds];
  const proofFragments = strings(proof.sourceFragmentIds);
  const targetMessages = messageIds(target.sourceMessageIds);
  const proofMessages = messageIds(proof.sourceMessageIds);
  const fragmentMatches = proofFragments.filter(id => intersects(targetFragments, [id]));
  const messageMatches = proofMessages.filter(id => targetMessages.includes(id));
  const hasExactSource = fragmentMatches.length > 0 || messageMatches.length > 0;
  if (hasExactSource) {
    if (proofFragments.length && targetFragments.length && fragmentMatches.length === proofFragments.length
      || proofMessages.length && targetMessages.length && messageMatches.length === proofMessages.length) return true;
    return null;
  }
  if (targetMessages.length && proofMessages.length) return false;
  if (target.finalizationId && proof.sourceFinalizationId === target.finalizationId
    || target.conversationId && proof.sourceConversationId === target.conversationId) return null;
  return false;
}

function entryForgotten(scope, entryOrRow, forgottenProjections = []) {
  const source = entryOrRow?.source || entryOrRow || {};
  const lineages = Array.isArray(source.projectionLineages) ? source.projectionLineages
    : Array.isArray(entryOrRow?.projectionLineages) ? entryOrRow.projectionLineages : [];
  const counterparts = entryOrRow?.counterpartIds || [];
  const sourceSegments = source.segmentIds || entryOrRow?.segmentIds || [];
  for (const target of forgottenProjections) {
    if (lineages.length) {
      const forgotten = lineages.filter(lineage => matchesProjectionLineage(target, lineage));
      if (!forgotten.length) continue;
      const activeCoversEntry = lineages.some(lineage => !forgottenProjections.some(item => matchesProjectionLineage(item, lineage))
        && sourceSegments.length > 0 && sourceSegments.every(id => intersects([id], lineage.sourceSegmentIds || [])));
      if (!activeCoversEntry) return true;
      continue;
    }
    if (matchesSourceLineage(scope, source, counterparts, target)) return true;
  }
  return false;
}

function snapshotForgottenFragments(snapshot, forgottenProjections = []) {
  const scope = { campaignToken: snapshot?.campaignToken, ownerId: snapshot?.ownerId };
  const targets = forgottenProjections.filter(target => target.campaignToken === scope.campaignToken && target.ownerId === scope.ownerId
    && (!target.finalizationId || target.finalizationId === snapshot.finalizationId)
    && (!target.conversationId || target.conversationId === snapshot.conversationId));
  if (!targets.length) return { snapshot, removedFragmentCount: 0, forgottenProjectionIds: [] };
  const lineages = Array.isArray(snapshot.projectionLineages) ? snapshot.projectionLineages : [];
  const isForgotten = lineage => targets.some(target => matchesProjectionLineage(target, lineage));
  const forgottenLineages = lineages.filter(isForgotten);
  if (!forgottenLineages.length && !snapshot.fragments?.some(fragment => targets.some(target =>
    Number(target.counterpartId) !== scope.ownerId
      && (intersects([...target.segmentIds, ...(target.sourceSegmentIds || [])], [fragment.fragmentId, fragment.segmentId])
        || messageIds(target.sourceMessageIds).some(id => messageIds(fragment.sourceMessageIds || [fragment.messageId]).includes(id))
        || target.legacyMemoryIds.some(id => id === fragment.legacyMemoryId))))) {
    return { snapshot, removedFragmentCount: 0, forgottenProjectionIds: [] };
  }
  const forgottenCounterpartIds = new Set(forgottenLineages.map(lineage => Number(lineage.counterpartId)));
  let pairVisibilityChanged = false;
  const fragments = (snapshot.fragments || []).flatMap(fragment => {
    const fragmentId = fragment.fragmentId || fragment.segmentId;
    const explicit = strings(fragment.projectionIds || []);
    const lineagesForFragment = lineages.filter(lineage => intersects([fragmentId], lineage.sourceSegmentIds || [])
      || lineage.sourceMessageIds?.some(id => messageIds(fragment.sourceMessageIds || [fragment.messageId]).includes(id)));
    const forgottenForFragment = lineagesForFragment.filter(isForgotten);
    const fragmentMessages = messageIds(fragment.sourceMessageIds || [fragment.messageId]);
    const directTargets = targets.filter(target => [...target.segmentIds, ...(target.sourceSegmentIds || [])].length
      && intersects([...target.segmentIds, ...(target.sourceSegmentIds || [])], [fragmentId, fragment.segmentId])
      || messageIds(target.sourceMessageIds).some(id => fragmentMessages.includes(id))
      || target.legacyMemoryIds.includes(String(fragment.legacyMemoryId || "")) && fragment.legacyMemoryId);
    directTargets.forEach(target => forgottenCounterpartIds.add(Number(target.counterpartId)));
    const removedByTombstone = explicit.some(id => forgottenProjections.some(target => target.projectionId === id))
      || forgottenForFragment.length > 0 || directTargets.length > 0;
    if (!removedByTombstone) return [fragment];
    const activeProjectionRemains = lineagesForFragment.some(lineage => !isForgotten(lineage));
    if (!activeProjectionRemains) return [];
    pairVisibilityChanged = true;
    return [fragment];
  });
  const activeLineages = lineages.filter(lineage => !isForgotten(lineage));
  if (fragments.length === (snapshot.fragments || []).length && (forgottenLineages.length || pairVisibilityChanged)) {
    return { snapshot: { ...snapshot, projectionLineages: activeLineages,
      counterpartIds: directCounterpartIds(fragments, scope.ownerId).filter(id => !forgottenCounterpartIds.has(id)) }, removedFragmentCount: 0,
      forgottenProjectionIds: forgottenLineages.map(lineage => lineage.projectionId) };
  }
  if (fragments.length === (snapshot.fragments || []).length) return { snapshot, removedFragmentCount: 0, forgottenProjectionIds: [] };
  const counterpartIds = directCounterpartIds(fragments, scope.ownerId).filter(id => !forgottenCounterpartIds.has(id));
  const keptIds = new Set(fragments.map(fragment => fragment.fragmentId));
  return { snapshot: { ...snapshot, fragments, projectionLineages: activeLineages, counterpartIds,
    presentMessageCount: messageIds(fragments.flatMap(fragment => fragment.sourceMessageIds || [fragment.messageId])).length },
    removedFragmentCount: (snapshot.fragments || []).length - fragments.length,
    forgottenProjectionIds: forgottenLineages.map(lineage => lineage.projectionId), removedFragmentIds: [...(snapshot.fragments || []).filter(fragment => !keptIds.has(fragment.fragmentId)).map(fragment => fragment.fragmentId)] };
}

module.exports = { createProjectionLineage, projectionLineageFromSummary, matchesProjectionLineage,
  disclosureProofForgetMatch, entryForgotten, snapshotForgottenFragments, segmentAliases };
