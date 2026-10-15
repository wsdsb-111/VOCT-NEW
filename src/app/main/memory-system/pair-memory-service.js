"use strict";

const crypto = require("crypto");

function createPairMemoryService({ store, getCurrentConversation }) {
  const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const cleanName = value => typeof value === "string" && value.trim() && !/^\d+$/.test(value.trim()) && !/^(unknown|none)$/i.test(value.trim()) ? value.trim() : null;
  const id = value => {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("PAIR_INDEX_SCOPE_INVALID");
    return value;
  };
  function context(request) {
    const ownerId = id(request.ownerId);
    const counterpartId = request.counterpartId == null ? null : id(request.counterpartId);
    if (ownerId === counterpartId) throw new Error("PAIR_INDEX_SCOPE_INVALID");
    const conversation = getCurrentConversation();
    const gameData = conversation?.gameData;
    const memories = store.loadFolderSummariesForCharacter(ownerId);
    const trusted = memories.filter(memory => memory.provenance?.folderOwnerId === ownerId
      && memory.knownBy.includes(ownerId) && memory.provenance?.campaignBinding?.status !== "unresolved");
    const scopedSources = counterpartId ? trusted.filter(memory =>
      [memory.provenance.counterpartId, ...(memory.provenance.counterpartIds || [])].includes(counterpartId)) : trusted;
    const sourceCampaigns = [...new Set(scopedSources.map(memory => memory.provenance?.campaignToken).filter(value => typeof value === "string" && value.trim()))];
    const campaignToken = typeof gameData?.campaignToken === "string" && gameData.campaignToken.trim()
      || (sourceCampaigns.length === 1 ? sourceCampaigns[0] : null);
    const offlineBackfill = !gameData && sourceCampaigns.length === 1;
    const writable = offlineBackfill || !!(campaignToken && gameData?.campaignToken === campaignToken
      && gameData?.characters instanceof Map && gameData.characters.has(ownerId));
    const authorized = trusted.filter(memory => memory.provenance.campaignToken === campaignToken);
    const counterpartIds = [...new Set(authorized.flatMap(memory => memory.provenance.counterpartIds || [memory.provenance.counterpartId]))]
      .filter(value => Number.isSafeInteger(value) && value > 0 && value !== ownerId);
    const profiles = [...(gameData?.characters?.values?.() || []), ...trusted.flatMap(memory => memory.provenance.participantProfiles || [])];
    const name = characterId => {
      const profile = profiles.find(row => Number(row.id) === characterId);
      return cleanName(profile?.firstName) || cleanName(profile?.name) || cleanName(profile?.shortName) || cleanName(profile?.fullName)
        || (characterId !== ownerId ? cleanName(trusted.find(memory => memory.provenance.counterpartId === characterId)?.provenance.counterpartName) : null)
        || "姓名未载入";
    };
    return { ownerId, counterpartId, counterpartIds, campaignToken, writable, offlineBackfill, conversation, memories,
      scopeIssue: sourceCampaigns.length > 1 ? "CAMPAIGN_BINDING_AMBIGUOUS" : "CAMPAIGN_BINDING_REQUIRED",
      ownerName: name(ownerId), counterpartName: counterpartId ? name(counterpartId) : null, name,
      options: { memories, currentGameDate: gameData?.date, currentTotalDays: gameData?.totalDays, readOnly: true, allowHistoricalPreview: !gameData?.date } };
  }
  function pair(ctx, counterpartId) {
    return { campaignToken: ctx.campaignToken, ownerId: ctx.ownerId, counterpartId };
  }
  function metadata(ctx) {
    return { ownerName: ctx.ownerName, counterpartName: ctx.counterpartName, writable: ctx.writable, offlineBackfill: ctx.offlineBackfill };
  }
  function get(request) {
    const ctx = context(request);
    if (!ctx.counterpartId) throw new Error("PAIR_INDEX_SCOPE_INVALID");
    if (!ctx.campaignToken) return { success: true, ...metadata(ctx), writable: false, items: [], totalCount: 0, page: 0, pageSize: 20, diagnostics: { reason: ctx.scopeIssue } };
    const result = store.pairLedger.get(pair(ctx, ctx.counterpartId), { ...ctx.options,
      page: request.page, pageSize: request.pageSize, sort: request.sort, search: request.search,
      fromDate: request.fromDate, toDate: request.toDate });
    return { success: true, ...result, ...metadata(ctx) };
  }
  function preview(request) {
    const ctx = context(request);
    if (!ctx.campaignToken) return { success: true, ...metadata(ctx), writable: false, pairs: [], counts: {}, previewRevision: digest([ctx.ownerId, null]), diagnostics: { reason: ctx.scopeIssue } };
    const ids = ctx.counterpartId ? [ctx.counterpartId] : ctx.counterpartIds;
    const pairs = ids.map(counterpartId => {
      const result = store.pairLedger.preview(pair(ctx, counterpartId), ctx.options);
      return { ...result, items: result.items || result.pairs?.flatMap(row => row.items || []) || [],
        ownerId: ctx.ownerId, counterpartId, ownerName: ctx.ownerName, counterpartName: ctx.name(counterpartId), writable: ctx.writable };
    });
    const counts = {};
    for (const row of pairs) for (const [key, value] of Object.entries(row.counts || {})) if (typeof value === "number") counts[key] = (counts[key] || 0) + value;
    return { success: true, ...metadata(ctx), pairs, counts, previewRevision: ctx.counterpartId ? pairs[0]?.previewRevision : digest([ctx.campaignToken, ctx.ownerId, pairs.map(row => [row.counterpartId, row.previewRevision])]) };
  }
  function apply(request) {
    const ctx = context(request);
    if (!ctx.writable || !ctx.counterpartId) throw new Error("PAIR_INDEX_READ_ONLY");
    if (getCurrentConversation() !== ctx.conversation) throw new Error("PAIR_INDEX_PREVIEW_STALE");
    const result = store.pairLedger.apply(pair(ctx, ctx.counterpartId), { ...ctx.options, readOnly: false,
      allowHistoricalBackfill: ctx.offlineBackfill, previewRevision: request.previewRevision });
    return { success: true, ...result, ...metadata(ctx), ownerId: ctx.ownerId, counterpartId: ctx.counterpartId };
  }
  function open(request) {
    const ctx = context(request);
    if (!ctx.campaignToken || !ctx.counterpartId) throw new Error("SOURCE_UNAVAILABLE_OR_STALE");
    const result = store.pairLedger.resolveSource(pair(ctx, ctx.counterpartId), {
      sourceSummaryKey: request.sourceSummaryKey, sourceRevision: request.expectedSourceRevision
    }, ctx.options);
    return { ...result, ...result.locator, ...metadata(ctx), ownerId: ctx.ownerId, counterpartId: ctx.counterpartId };
  }
  return { get, preview, apply, open };
}

module.exports = { createPairMemoryService };
