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

function formatKnownNameFacts(memoryContext, gameData, responderId) {
  const ownerId = Number(responderId);
  const campaignToken = gameData?.campaignToken;
  const currentDate = normalizeGameDate(gameData?.date);
  const profiles = memoryContext?.disclosureProfiles;
  if (!Number.isSafeInteger(ownerId) || ownerId < 1 || typeof campaignToken !== "string" || !campaignToken.trim()
    || !currentDate || !(profiles instanceof Map) || !/^[a-f0-9]{64}$/.test(memoryContext.characterKnowledgeRevision || "")
    || !Array.isArray(memoryContext.disclosureTargetIds)) return "";
  const targetIds = new Set(memoryContext.disclosureTargetIds.map(Number));
  const namesByTarget = new Map();
  for (const [rawTargetId, facts] of profiles) {
    const targetId = Number(rawTargetId);
    if (!Number.isSafeInteger(targetId) || targetId < 1 || targetId === ownerId || !targetIds.has(targetId) || !Array.isArray(facts)) continue;
    for (const fact of facts) {
      const acquiredDate = normalizeGameDate(fact?.firstAcquiredDate);
      const value = typeof fact?.value === "string" ? fact.value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim() : "";
      if (fact?.factType !== "NAME" || fact.ownerId !== ownerId || fact.entityId !== targetId
        || fact.campaignToken !== campaignToken || fact.current !== true || fact.effectiveKnown !== true
        || !["AUTO_DISCLOSED", "MANUAL_KNOWN"].includes(fact.status) || fact.sourceStatus !== "CURRENT"
        || !/^[a-f0-9]{64}$/.test(fact.sourceSnapshotId || "") || !/^fact:[a-f0-9]{64}$/.test(fact.factSourceSnapshotId || "")
        || !acquiredDate || acquiredDate.serial > currentDate.serial || !value || value.length > 120) continue;
      if (!namesByTarget.has(targetId)) namesByTarget.set(targetId, new Set());
      namesByTarget.get(targetId).add(value);
    }
  }
  if (!namesByTarget.size) return "";
  const lines = [...namesByTarget].sort(([left], [right]) => left - right)
    .flatMap(([targetId, names]) => [...names].sort().map(value => `- Target Runtime ID ${targetId}: ${value}`));
  return `=== 本角色已获知的姓名 ===\n${lines.join("\n")}\n以上事实只表示本角色已获知所列目标的具体姓名；不得声称尚未获知该姓名。仅知道姓名不证明已有交情、认得面孔或其他经历，也不证明头衔、特质或秘密。`;
}

module.exports = { buildCharacterDisclosureContext, formatKnownNameFacts };
