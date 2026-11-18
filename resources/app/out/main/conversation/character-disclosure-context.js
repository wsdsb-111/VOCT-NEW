"use strict";

const crypto = require("node:crypto");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { normalizeTraitKey } = require("../prompts/trait-visibility-policy");
const { getTraitsForKnownProfile, getPerceptionForKnownProfile } = require("../prompts/trait-profile-selector");
const { isSupernaturalIdentity } = require("../prompts/social-recognition-policy");

function buildCharacterDisclosureContext({ service, gameData, responderId, targetIds = [], audienceIds = [] } = {}) {
  const disclosureProfiles = new Map();
  if (typeof service?.getDisclosureProfile !== "function") {
    return { disclosureProfiles, characterKnowledgeRevision: null, disclosureTargetIds: [] };
  }
  const ownerId = Number(responderId);
  const ids = [...new Set(targetIds.map(Number))].filter(id => Number.isSafeInteger(id) && id > 0 && id !== ownerId).sort((a, b) => a - b);
  if (typeof service.getDisclosureProfiles === "function") {
    const pairs = [...ids.map(targetRuntimeId => ({ ownerRuntimeId: ownerId, targetRuntimeId })),
      ...[...new Set(audienceIds.map(Number))].filter(id => id > 0 && id !== ownerId)
        .map(ownerRuntimeId => ({ ownerRuntimeId, targetRuntimeId: ownerId }))];
    const profiles = service.getDisclosureProfiles(pairs.map(pair => ({ ...pair, campaignToken: gameData?.campaignToken })));
    const byPair = new Map(profiles.filter(profile => profile?.status === "READY").map(profile => [
      JSON.stringify([Number(profile.scope?.ownerRuntimeId), Number(profile.scope?.targetRuntimeId)]), profile]));
    // This facade exists for one synchronous build only. The pre-send build reads again.
    service = { getDisclosureProfile: pair => byPair.get(JSON.stringify([Number(pair.ownerRuntimeId), Number(pair.targetRuntimeId)])) };
  }
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
    const facts = (profile.facts || []).filter(fact => ["NAME", "NICKNAME", "TRAIT", "TITLE", "PERCEPTION"].includes(fact.factType)
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
  const audienceKnowledge = new Map();
  for (const listenerId of [...new Set(audienceIds.map(Number))].filter(id => id > 0 && id !== ownerId)) {
    const inverse = buildCharacterDisclosureContext({ service, gameData, responderId: listenerId, targetIds: [ownerId] });
    audienceKnowledge.set(listenerId, inverse);
    manifest.push(["AUDIENCE", listenerId, inverse.characterKnowledgeRevision]);
  }
  return { disclosureProfiles, disclosureTargetIds: ids, audienceKnowledge,
    characterKnowledgeRevision: crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex") };
}

function formatSelfConcealment(memoryContext, gameData, responderId, audienceIds = []) {
  const self = gameData?.characters?.get(Number(responderId));
  if (!self) return "";
  const identities = (self.traits || []).filter(isSupernaturalIdentity);
  const rows = [];
  for (const listenerId of [...new Set(audienceIds.map(Number))].filter(id => id !== Number(responderId))) {
    const listener = gameData.characters.get(listenerId);
    if (!listener) continue;
    const inverse = memoryContext?.audienceKnowledge?.get(listenerId);
    const knowledge = { ...inverse, gameData, campaignToken: gameData.campaignToken, currentGameDate: gameData.date,
      activeParticipantIds: memoryContext?.activeParticipantIds || [] };
    const knownTraits = inverse ? getTraitsForKnownProfile(listener, self, knowledge) : [];
    const known = new Set(knownTraits.map(normalizeTraitKey));
    const perception = getPerceptionForKnownProfile(listener, self, knowledge);
    const labels = traits => traits.map(trait => trait.name || trait.localizedName || normalizeTraitKey(trait)).join("、");
    const hidden = identities.filter(trait => !known.has(normalizeTraitKey(trait)));
    const disclosed = knownTraits.filter(isSupernaturalIdentity);
    rows.push(`- 听众 Runtime ID ${listenerId}：已获知你的身份=${labels(disclosed) || "无确认项目"}；未获知你的身份=${labels(hidden) || "无列明项目"}。`
      + (perception.level === "SUPERNATURAL" && !disclosed.length ? `此人只能感到非凡气息，不能确认具体种族；${perception.cue}笼统异常不等于真身已公开。` : ""));
  }
  return "=== 自身性格与身份的扮演边界 ===\n你自己的完整特质应影响思考、动机、措辞与行事风格，即使尚未披露也保持这些内在影响。自身资料不等于听众知情。对不知真身者，所有超自然身份都应伪装，以符合表面身份的言行表达内在动机；避免无意直呼、暗示或在可听见的台词中暴露真身。只感到非凡气息的听众仍不知具体种族，可描写已获准的感知大类，不可用种族专属线索揭底。识别种族不表示知道氏族、血脉、亚种或职分；这些细分特质仍按各自披露规则。除非主动明确披露，不把内心知识当作公开信息。已知真身的听众不必假装不知；多人交谈仍须顾及不知情者。普通性格、巫师、私生子等保持各自原有知情规则。\n" + rows.join("\n");
}

function currentKnownCharacterFacts(memoryContext, gameData, responderId) {
  const ownerId = Number(responderId);
  const campaignToken = gameData?.campaignToken;
  const currentDate = normalizeGameDate(gameData?.date);
  const profiles = memoryContext?.disclosureProfiles;
  if (!Number.isSafeInteger(ownerId) || ownerId < 1 || typeof campaignToken !== "string" || !campaignToken.trim()
    || !currentDate || !(profiles instanceof Map) || !/^[a-f0-9]{64}$/.test(memoryContext.characterKnowledgeRevision || "")
    || !Array.isArray(memoryContext.disclosureTargetIds)) return [];
  const targetIds = new Set(memoryContext.disclosureTargetIds.map(Number));
  const result = [];
  for (const [rawTargetId, facts] of profiles) {
    const targetId = Number(rawTargetId);
    if (!Number.isSafeInteger(targetId) || targetId < 1 || targetId === ownerId || !targetIds.has(targetId) || !Array.isArray(facts)) continue;
    for (const fact of facts) {
      const acquiredDate = normalizeGameDate(fact?.firstAcquiredDate);
      const value = typeof fact?.value === "string" ? fact.value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim() : "";
      if (!["NAME", "TITLE", "TRAIT", "PERCEPTION"].includes(fact?.factType) || fact.ownerId !== ownerId || fact.entityId !== targetId
        || fact.campaignToken !== campaignToken || fact.current !== true || fact.effectiveKnown !== true
        || !["AUTO_DISCLOSED", "MANUAL_KNOWN"].includes(fact.status) || fact.sourceStatus !== "CURRENT"
        || !/^[a-f0-9]{64}$/.test(fact.sourceSnapshotId || "") || !/^fact:[a-f0-9]{64}$/.test(fact.factSourceSnapshotId || "")
        || !acquiredDate || acquiredDate.serial > currentDate.serial || !value || value.length > 120) continue;
      const disclosurePhase = ["NAME", "TRAIT"].includes(fact.factType) && fact.hasDisclosureRecord === true
        && ["prior", "current"].includes(fact.disclosurePhase) ? fact.disclosurePhase : null;
      result.push({ targetId, factType: fact.factType, value, disclosurePhase });
    }
  }
  return result;
}

function formatNames(facts) {
  const namesByTarget = new Map();
  for (const fact of facts) {
    if (fact.factType !== "NAME") continue;
    if (!namesByTarget.has(fact.targetId)) namesByTarget.set(fact.targetId, new Set());
    namesByTarget.get(fact.targetId).add(fact.value);
  }
  if (!namesByTarget.size) return "";
  const lines = [...namesByTarget].sort(([left], [right]) => left - right)
    .flatMap(([targetId, names]) => [...names].sort().map(value => `- Target Runtime ID ${targetId}: ${value}`));
  return `=== 本角色已获知的姓名 ===\n${lines.join("\n")}\n以上事实只表示本角色已获知所列目标的具体姓名；不得声称尚未获知该姓名。仅知道姓名不证明已有交情、认得面孔或其他经历，也不证明头衔、特质或秘密。`;
}

function formatKnownNameFacts(memoryContext, gameData, responderId) {
  return formatNames(currentKnownCharacterFacts(memoryContext, gameData, responderId));
}

function formatFacts(knownFacts) {
  const names = formatNames(knownFacts);
  const labels = { TITLE: "头衔／官职", TRAIT: "特质／身份", PERCEPTION: "气息感知" };
  const rows = knownFacts
    .filter(fact => fact.factType !== "NAME")
    .map(fact => `- Target Runtime ID ${fact.targetId}，${labels[fact.factType]}：${fact.value}`);
  const facts = rows.length ? "=== 本回应角色已获知的特质与身份 ===\n" + [...new Set(rows)].sort().join("\n")
    + "\n以上逐项事实已经由本回应角色获知，包括有效的对话披露和手动认知；不得再声称尚未知晓这些事实。只知道列明的项目，不得推断其它特质、身份、秘密或经历。" : "";
  const perceptionRule = rows.some(row => row.includes("气息感知"))
    ? "气息感知只授权列明的大类，不能据此猜测具体种族、氏族、血统、姓名或头衔，也不能用某一种族的专属征象代替大类感受。" : "";
  return [names, facts, perceptionRule].filter(Boolean).join("\n\n");
}

function formatKnownCharacterFacts(memoryContext, gameData, responderId) {
  return formatFacts(currentKnownCharacterFacts(memoryContext, gameData, responderId));
}

function formatCharacterDisclosureBlocks(memoryContext, gameData, responderId) {
  const facts = currentKnownCharacterFacts(memoryContext, gameData, responderId);
  return {
    frozen: formatFacts(facts.filter(fact => fact.disclosurePhase === "prior")),
    current: formatFacts(facts.filter(fact => fact.disclosurePhase === "current")),
    other: formatFacts(facts.filter(fact => fact.disclosurePhase === null))
  };
}

module.exports = { buildCharacterDisclosureContext, formatKnownNameFacts, formatKnownCharacterFacts, formatCharacterDisclosureBlocks, formatSelfConcealment };
