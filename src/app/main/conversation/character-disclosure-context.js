"use strict";

const crypto = require("node:crypto");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { normalizeTraitKey } = require("../prompts/trait-visibility-policy");

function buildCharacterDisclosureContext({ service, gameData, responderId, targetIds = [] } = {}) {
  const disclosureProfiles = new Map();
  if (typeof service?.getDisclosureProfile !== "function") {
    return { disclosureProfiles, characterKnowledgeRevision: null, disclosureTargetIds: [] };
  }
  const ownerId = Number(responderId);
  const ids = [...new Set(targetIds.map(Number))].filter(id => Number.isSafeInteger(id) && id > 0 && id !== ownerId).sort((a, b) => a - b);
  const currentDate = normalizeGameDate(gameData?.date)?.canonical;
  const manifest = [gameData?.campaignToken || null, ownerId, currentDate || null];
  for (const targetId of ids) {
    const profile = service.getDisclosureProfile({ campaignToken: gameData?.campaignToken,
      ownerRuntimeId: ownerId, targetRuntimeId: targetId });
    const scope = profile?.scope;
    const valid = profile?.status === "READY" && scope?.campaignToken === gameData?.campaignToken
      && Number(scope?.ownerRuntimeId) === ownerId && Number(scope?.targetRuntimeId) === targetId
      && typeof scope?.sourceSnapshotId === "string" && !!scope.sourceSnapshotId
      && !!currentDate && normalizeGameDate(profile.checkpointAsOf)?.canonical === currentDate;
    if (!valid) {
      manifest.push([targetId, "BLOCKED"]);
      continue;
    }
    const evidencePrefix = gameData.campaignToken + "|" + currentDate + "/" + gameData.totalDays + "|";
    const facts = (profile.facts || []).filter(fact => ["NAME", "NICKNAME", "TRAIT", "TITLE"].includes(fact.factType)
      && ["KNOWN", "AUTO_DISCLOSED", "MANUAL_KNOWN", "MANUAL_HIDDEN"].includes(fact.status)
      && (fact.evidenceSourceSnapshotId
        ? fact.evidenceSourceSnapshotId.startsWith(evidencePrefix)
          && /^[a-f0-9]{16}$/.test(fact.evidenceSourceSnapshotId.slice(evidencePrefix.length))
          && fact.sourceSnapshotId === scope.sourceSnapshotId + "|" + fact.evidenceSourceSnapshotId
        : fact.sourceSnapshotId === scope.sourceSnapshotId)).map(fact => ({
      ...fact,
      factKey: fact.factType === "TRAIT" ? "trait_" + normalizeTraitKey(fact.factKey) : fact.factKey,
      ownerId, entityId: targetId, campaignToken: scope.campaignToken,
      status: fact.status === "KNOWN" ? "AUTO_DISCLOSED" : fact.status,
      current: true,
      effectiveKnown: fact.status !== "MANUAL_HIDDEN" && fact.effectiveKnown !== false,
      firstAcquiredDate: fact.firstAcquiredDate || profile.checkpointAsOf
    }));
    disclosureProfiles.set(targetId, facts);
    manifest.push([targetId, scope, facts]);
  }
  return { disclosureProfiles, disclosureTargetIds: ids,
    characterKnowledgeRevision: crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex") };
}

module.exports = { buildCharacterDisclosureContext };
