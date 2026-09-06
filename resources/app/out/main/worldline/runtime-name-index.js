"use strict";

const indexes = new WeakMap();

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function canonicalDate(value) {
  const dotted = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) return `${Number(dotted[1])}.${Number(dotted[2])}.${Number(dotted[3])}`;
  const chinese = String(value || "").trim().match(/^(\d+)年(\d+)月(\d+)日$/);
  return chinese ? `${Number(chinese[1])}.${Number(chinese[2])}.${Number(chinese[3])}` : null;
}

function add(index, name, runtimeId) {
  const key = String(name || "").trim();
  const id = String(runtimeId || "").trim();
  if (!key || !id) return;
  if (!index[key]) index[key] = [];
  if (!index[key].includes(id)) index[key].push(id);
}

function buildRuntimeNameIndex(snapshot, { live = null } = {}) {
  const givenNameToRuntimeIds = Object.create(null);
  const verifiedFullNameToRuntimeIds = Object.create(null);
  const fullNameProvenanceByRuntime = Object.create(null);
  for (const [name, ids] of Object.entries(snapshot?.nameToCharacterIds || {})) for (const id of Array.isArray(ids) ? ids : []) add(givenNameToRuntimeIds, name, id);
  const snapshotDate = canonicalDate(snapshot?.gameDate);
  const liveDate = canonicalDate(live?.gameDate);
  const sameScope = snapshotDate && snapshotDate === liveDate && String(snapshot?.playerId || "") === String(live?.playerId || "");
  if (!sameScope) return { givenNameToRuntimeIds, verifiedFullNameToRuntimeIds, fullNameProvenanceByRuntime };
  for (const candidate of Array.isArray(live?.characters) ? live.characters : []) {
    const id = String(candidate?.id || "");
    const character = snapshot?.characters?.[id];
    const fullName = String(candidate?.fullName || "").trim();
    if (!character || !fullName || normalize(character.firstName) !== normalize(candidate?.firstName)) continue;
    add(verifiedFullNameToRuntimeIds, fullName, id);
    fullNameProvenanceByRuntime[id] = { kind: "LIVE_FULL_NAME", gameDate: snapshotDate, playerId: String(snapshot.playerId) };
  }
  return { givenNameToRuntimeIds, verifiedFullNameToRuntimeIds, fullNameProvenanceByRuntime };
}

function getRuntimeNameIndex(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return buildRuntimeNameIndex(null);
  if (!indexes.has(snapshot)) indexes.set(snapshot, buildRuntimeNameIndex(snapshot));
  return indexes.get(snapshot);
}

function attachRuntimeNameIndex(snapshot, options) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  return { ...snapshot, indexes: { ...(snapshot.indexes || {}), ...buildRuntimeNameIndex(snapshot, options) } };
}

module.exports = { attachRuntimeNameIndex, buildRuntimeNameIndex, canonicalDate, getRuntimeNameIndex };
