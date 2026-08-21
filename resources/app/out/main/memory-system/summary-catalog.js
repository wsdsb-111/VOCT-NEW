"use strict";

function normalizeSearchValue(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function parseFolderIdentity(folderName) {
  const value = String(folderName || "");
  const match = value.match(/^(\d+)_(.+)$/);
  return {
    ownerId: match ? Number(match[1]) : null,
    ownerName: (match ? match[2] : value).trim() || "未知角色"
  };
}

function collectParticipants(summaries) {
  const ids = new Set();
  const names = new Set();
  const profiles = new Map();
  const remember = (idValue, nameValue) => {
    const id = Number(idValue);
    if (Number.isFinite(id)) {
      ids.add(id);
      if (!profiles.has(id)) profiles.set(id, { id, name: null });
      if (nameValue && !profiles.get(id).name) profiles.get(id).name = String(nameValue);
    }
    if (nameValue) names.add(String(nameValue));
  };
  for (const summary of summaries || []) {
    for (const participant of summary?.participants || []) {
      if (participant && typeof participant === "object") {
        const id = Number(participant.id ?? participant.characterId);
        if (Number.isFinite(id)) ids.add(id);
        for (const name of [participant.name, participant.shortName, participant.fullName]) {
          if (name) remember(id, name);
        }
      } else {
        remember(participant, null);
      }
    }
    for (const [idValue, nameValue] of [
      [summary?.playerId, summary?.playerName],
      [summary?.characterId, summary?.characterName]
    ]) {
      remember(idValue, nameValue);
    }
  }
  return { participantIds: [...ids], participantNames: [...names], participantProfiles: [...profiles.values()] };
}

function buildSummaryCatalogEntry({ folderName, conversationFile, filePath, summaries }) {
  const first = summaries?.[0] || {};
  const folderIdentity = parseFolderIdentity(folderName);
  const filenameMatch = String(conversationFile || "").match(/^与(.+)的对话\.json$/);
  const ownerId = folderIdentity.ownerId ?? (Number.isFinite(Number(first.playerId)) ? Number(first.playerId) : first.playerId || folderName);
  const ownerName = folderIdentity.ownerName || first.playerName || String(folderName || "未知角色");
  const firstPlayerId = Number(first.playerId);
  const firstCharacterId = Number(first.characterId);
  let counterpartId = Number.isFinite(firstCharacterId) ? firstCharacterId : first.characterId || null;
  if (Number.isFinite(Number(ownerId)) && Number(ownerId) === firstCharacterId && Number.isFinite(firstPlayerId)) counterpartId = firstPlayerId;
  const counterpartName = filenameMatch?.[1] || first.characterName || "未知角色";
  const participants = collectParticipants(summaries);
  return {
    playerId: ownerId,
    playerName: ownerName,
    characterId: counterpartId || counterpartName,
    characterName: counterpartName,
    ownerId,
    ownerName,
    counterpartId,
    counterpartName,
    folderName: String(folderName || ""),
    folderPath: filePath ? require("path").dirname(filePath) : "",
    conversationFile: String(conversationFile || ""),
    participantIds: participants.participantIds,
    participantNames: participants.participantNames,
    participantProfiles: participants.participantProfiles,
    summaries,
    filePath,
    isNewFormat: true
  };
}

function classifySummaryMatch(metadata, rawQuery) {
  const query = normalizeSearchValue(rawQuery);
  if (!query) return { kind: "all", score: 0 };
  const exact = (value) => normalizeSearchValue(value) === query;
  const includes = (value) => normalizeSearchValue(value).includes(query);
  if (exact(metadata.ownerName) || exact(metadata.ownerId) || exact(metadata.folderName)) return { kind: "owner", score: 100 };
  if (exact(metadata.counterpartName) || exact(metadata.counterpartId)) return { kind: "counterpart", score: 90 };
  if ((metadata.participantNames || []).some(exact) || (metadata.participantIds || []).some(exact)) return { kind: "related", score: 80 };
  if (includes(metadata.ownerName) || includes(metadata.ownerId) || includes(metadata.folderName)) return { kind: "owner", score: 70 };
  if (includes(metadata.counterpartName) || includes(metadata.counterpartId) || includes(metadata.conversationFile)) return { kind: "counterpart", score: 60 };
  if ((metadata.participantNames || []).some(includes) || (metadata.participantIds || []).some(includes)) return { kind: "related", score: 50 };
  if ((metadata.summaries || []).some((summary) => includes(summary?.content) || includes(summary?.date))) return { kind: "related", score: 20 };
  return null;
}

module.exports = { buildSummaryCatalogEntry, classifySummaryMatch, normalizeSearchValue, parseFolderIdentity };
