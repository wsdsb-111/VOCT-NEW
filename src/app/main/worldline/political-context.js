"use strict";

function normalizedId(value) {
  if (value === null || value === undefined || value === "" || String(value) === "0") return null;
  return String(value);
}

function fallbackLocalization(rawKey) {
  return {
    localizedValue: rawKey,
    rawKey,
    language: null,
    sourceFile: null,
    sourceMod: null,
    confidence: "RAW_KEY"
  };
}

function localizedReference(localize, type, rawKey) {
  if (!rawKey) return fallbackLocalization(null);
  try {
    const localization = localize?.(type, rawKey);
    return localization && typeof localization === "object" ? localization : fallbackLocalization(rawKey);
  } catch (_error) {
    return fallbackLocalization(rawKey);
  }
}

function titleReference(title, localize) {
  if (!title) return null;
  const rawKey = title.key || null;
  const localization = localizedReference(localize, "title", rawKey);
  return {
    id: String(title.id),
    rawKey,
    displayName: localization.localizedValue,
    holderId: normalizedId(title.holder),
    localization
  };
}

function characterReference(snapshot, id, localize) {
  const normalized = normalizedId(id);
  if (!normalized) return null;
  const character = snapshot.characters?.[normalized] || null;
  if (!character) return null;
  const rawKey = character.firstName || `#${normalized}`;
  const localization = localizedReference(localize, "character", rawKey);
  return {
    id: normalized,
    rawKey,
    displayName: localization.localizedValue,
    localization
  };
}

function unknownContext(playerId, reason, evidence = []) {
  return {
    playerId,
    primaryTitle: null,
    directLiege: null,
    topRealmTitle: null,
    topRealmRuler: null,
    confidence: {
      primaryTitle: "UNKNOWN",
      directLiege: "UNKNOWN",
      topRealmTitle: "UNKNOWN",
      topRealmRuler: "UNKNOWN"
    },
    reason,
    evidence
  };
}

function resolveHighestOwnedTitle(snapshot, playerId, initialTitle) {
  const titles = snapshot.titles || {};
  const visited = new Set();
  const chain = [];
  let current = initialTitle;
  while (current) {
    const currentId = String(current.id);
    if (visited.has(currentId)) return { complete: false, reason: "DE_FACTO_LIEGE_CYCLE", chain };
    visited.add(currentId);
    chain.push(currentId);
    const parentId = normalizedId(current.deFactoLiege);
    if (!parentId) return { complete: true, highestOwned: current, directLiegeTitle: null, chain };
    const parent = titles[parentId] || null;
    if (!parent) return { complete: false, highestOwned: current, reason: "DE_FACTO_LIEGE_MISSING", chain, missingTitleId: parentId };
    if (normalizedId(parent.holder) !== playerId) return { complete: true, highestOwned: current, directLiegeTitle: parent, chain };
    current = parent;
  }
  return { complete: false, reason: "PRIMARY_TITLE_UNRESOLVED", chain };
}

function resolveTopRealm(snapshot, initialTitle) {
  const titles = snapshot.titles || {};
  const visited = new Set();
  const chain = [];
  let current = initialTitle;
  while (current) {
    const currentId = String(current.id);
    if (visited.has(currentId)) return { complete: false, reason: "TOP_REALM_CYCLE", chain };
    visited.add(currentId);
    chain.push(currentId);
    const parentId = normalizedId(current.deFactoLiege);
    if (!parentId) return { complete: true, title: current, chain };
    const parent = titles[parentId] || null;
    if (!parent) return { complete: false, reason: "TOP_REALM_LIEGE_MISSING", chain, missingTitleId: parentId };
    current = parent;
  }
  return { complete: false, reason: "TOP_REALM_UNRESOLVED", chain };
}

function resolvePlayerPoliticalContext(snapshot, { localize = null } = {}) {
  const playerId = normalizedId(snapshot?.playerId);
  if (!playerId) return unknownContext(null, "PLAYER_ID_UNAVAILABLE");
  const player = snapshot.characters?.[playerId] || null;
  if (!player) return unknownContext(playerId, "PLAYER_RECORD_UNAVAILABLE");
  const titles = snapshot.titles || {};
  const domainIds = [...new Set((player.domainTitles || []).map(normalizedId).filter(Boolean))];
  if (domainIds.length === 0) return unknownContext(playerId, "PLAYER_DOMAIN_TITLE_UNAVAILABLE", [{ kind: "player_domain_titles", ids: [] }]);
  const missingDomainIds = domainIds.filter((id) => !titles[id]);
  if (missingDomainIds.length > 0) return unknownContext(playerId, "PLAYER_DOMAIN_TITLE_MISSING", [{ kind: "player_domain_titles", ids: domainIds, missingIds: missingDomainIds }]);
  const mismatchedDomainIds = domainIds.filter((id) => normalizedId(titles[id].holder) !== playerId);
  if (mismatchedDomainIds.length > 0) return unknownContext(playerId, "PLAYER_DOMAIN_TITLE_HOLDER_MISMATCH", [{ kind: "player_domain_titles", ids: domainIds, mismatchedIds: mismatchedDomainIds }]);
  const heldDomainTitles = domainIds.map((id) => titles[id]);

  const paths = heldDomainTitles.map((title) => resolveHighestOwnedTitle(snapshot, playerId, title));
  const incomplete = paths.find((path) => !path.complete);
  if (incomplete) return unknownContext(playerId, incomplete.reason, [{ kind: "player_domain_title_path", chain: incomplete.chain, missingTitleId: incomplete.missingTitleId || null }]);
  const highestIds = [...new Set(paths.map((path) => String(path.highestOwned.id)))];
  if (highestIds.length !== 1) return unknownContext(playerId, "MULTIPLE_PLAYER_TOP_TITLES", [{ kind: "player_top_title_candidates", ids: highestIds }]);

  const primaryPath = paths.find((path) => String(path.highestOwned.id) === highestIds[0]);
  const primaryTitle = primaryPath.highestOwned;
  const topRealm = resolveTopRealm(snapshot, primaryTitle);
  const directLiegeTitle = primaryPath.directLiegeTitle;
  const directLiegeRuler = characterReference(snapshot, directLiegeTitle?.holder, localize);
  const topRealmTitle = topRealm.complete ? topRealm.title : null;
  const topRealmRuler = characterReference(snapshot, topRealmTitle?.holder, localize);
  const evidence = [
    { kind: "player_domain_titles", ids: domainIds },
    { kind: "primary_title_chain", ids: primaryPath.chain },
    { kind: "top_realm_chain", ids: topRealm.chain }
  ];
  if (!topRealm.complete) evidence.push({ kind: "top_realm_incomplete", reason: topRealm.reason, missingTitleId: topRealm.missingTitleId || null });

  return {
    playerId,
    primaryTitle: titleReference(primaryTitle, localize),
    directLiege: directLiegeTitle ? { title: titleReference(directLiegeTitle, localize), ruler: directLiegeRuler } : null,
    topRealmTitle: titleReference(topRealmTitle, localize),
    topRealmRuler,
    confidence: {
      primaryTitle: "CONFIRMED",
      directLiege: directLiegeTitle ? directLiegeRuler ? "CONFIRMED" : "PARTIAL" : "INDEPENDENT",
      topRealmTitle: topRealm.complete ? "CONFIRMED" : "UNKNOWN",
      topRealmRuler: topRealmTitle ? topRealmRuler ? "CONFIRMED" : "PARTIAL" : "UNKNOWN"
    },
    reason: topRealm.complete ? null : topRealm.reason,
    evidence
  };
}

module.exports = { resolvePlayerPoliticalContext };
