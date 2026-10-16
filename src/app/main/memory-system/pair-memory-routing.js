"use strict";

const crypto = require("crypto");

const TARGET_EVIDENCE = new Set(["EXPLICIT_ID", "UNIQUE_ALIAS"]);
const HISTORICAL_PATTERN = /以前|曾经|过去|往事|历史|当年|当时|那年|此前|之前|回忆|回想|旧事|\d{3,6}\s*年/u;
const CURRENT_FUTURE_PATTERN = /现在|今天|当下|眼下|当前|明天|后天|下次|将来|未来|准备|打算|接下来|之后|稍后/u;
const REMINDER_PATTERN = /记得\s*(?:把|将|要|去|给|向|通知|提醒|安排|交|带|告诉|转告|送)/u;
const DETAIL_PATTERN = /具体|究竟|到底|原话|为何|为什么|原因|过程|经过|详细|怎么说|说了什么|如何说|发生了什么|发生过什么|什么争执|哪些争执|哪一年|何时|什么时候|\d{3,6}\s*年/u;
const TIME_PATTERN = /哪一年|何时|什么时候|\d{3,6}\s*年|当年|那年/u;
const RELATIONSHIP_PATTERN = /记得|认识|关系|相处|交情|如何|怎么样|什么样/u;
const ELLIPTICAL_FOLLOWUP_PATTERN = /^(?:(?:那|那么)?(?:(?:他|她|他们|她们|它|这件事|那件事|这个约定)?(?:后来|之后|接下来))|(?:他|她|他们|她们|它)?(?:后来|之后|然后)|这件事|那件事|这个约定)(?:呢|如何|怎么样|怎么了|发生了什么)?[？?。！!…]*$/u;
const ROUTE_SCHEMA_VERSION = "v936-third-person-route-1";

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function resolveFrozenPlayerAnchor({ ownerId, trustedPlayerId } = {}) {
  const owner = validId(ownerId);
  const player = validId(trustedPlayerId);
  if (!owner) return { ok: false, playerAnchorId: null, reasonCode: "OWNER_ID_INVALID" };
  if (!player) return { ok: false, playerAnchorId: null, reasonCode: "PLAYER_ANCHOR_UNAVAILABLE" };
  if (owner === player) return { ok: false, playerAnchorId: null, reasonCode: "PLAYER_ANCHOR_EQUALS_OWNER" };
  return { ok: true, playerAnchorId: player, reasonCode: "TRUSTED_PLAYER_ID" };
}

function normalizeTargets(resolvedTargets = []) {
  if (!Array.isArray(resolvedTargets)) return { ids: [], evidence: "UNRESOLVED", ambiguous: true };
  const ids = new Set();
  const aliasIds = new Map();
  const evidence = new Set();
  let ambiguous = false;
  for (const row of resolvedTargets) {
    const isObject = row && typeof row === "object" && !Array.isArray(row);
    const id = validId(isObject ? row.characterId ?? row.id : row);
    const rowEvidence = isObject ? String(row.evidence || "EXPLICIT_ID") : "EXPLICIT_ID";
    if (isObject && (row.ambiguous === true || row.status === "AMBIGUOUS" || rowEvidence === "AMBIGUOUS_ALIAS")) {
      ambiguous = true;
      continue;
    }
    if (!id || !TARGET_EVIDENCE.has(rowEvidence)) {
      ambiguous = true;
      continue;
    }
    ids.add(id);
    evidence.add(rowEvidence);
    const aliases = isObject
      ? [row.alias, row.matchedAlias, ...(Array.isArray(row.aliases) ? row.aliases : [])]
      : [];
    for (const aliasValue of aliases) {
      const alias = normalizeText(aliasValue);
      if (!alias) continue;
      if (!aliasIds.has(alias)) aliasIds.set(alias, new Set());
      aliasIds.get(alias).add(id);
    }
  }
  if ([...aliasIds.values()].some(aliasCharacters => aliasCharacters.size > 1)) ambiguous = true;
  return {
    ids: ambiguous ? [] : [...ids],
    evidence: ambiguous || !ids.size ? "UNRESOLVED" : evidence.has("UNIQUE_ALIAS") ? "UNIQUE_ALIAS" : "EXPLICIT_ID",
    ambiguous
  };
}

function resolveCurrentQueryContext({ history = [], ownerId, trustedPlayerId, activeParticipantIds = [] } = {}) {
  const owner = validId(ownerId);
  const player = validId(trustedPlayerId);
  const active = new Set((Array.isArray(activeParticipantIds) ? activeParticipantIds : [])
    .map(validId).filter(id => id && id !== owner));
  if (!Array.isArray(history)) return { querySpeakerId: null, query: "", addressedIds: [], directnessEvidence: "UNDETERMINED" };

  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (!message || !["user", "assistant"].includes(message.role)
      || typeof message.content !== "string" || !message.content.trim() || message.isStreaming === true) continue;
    const speakerId = validId(message.speakerCharacterId ?? (message.role === "user" ? player : null));
    if (!speakerId || !active.has(speakerId)) continue;
    const targetValues = [message.addresseeId, message.targetCharacterId,
      ...(Array.isArray(message.recipientIds) ? message.recipientIds : [])];
    const addressedIds = [...new Set(targetValues.map(validId).filter(Boolean))];
    if (addressedIds.length && !addressedIds.includes(owner)) continue;
    return {
      querySpeakerId: speakerId,
      query: message.content,
      addressedIds,
      directnessEvidence: addressedIds.length === 1 && addressedIds[0] === owner
        ? "DIRECT_PAIR" : active.size > 1 ? "GROUP_WITNESSED" : "DIRECT_PAIR",
      speakerMessageId: message.id ?? null,
      speakerHistoryIndex: index
    };
  }
  return { querySpeakerId: null, query: "", addressedIds: [], directnessEvidence: "UNDETERMINED" };
}

function resolveTrustedPlayerTurn({ history = [], playerAnchorId, currentPlayerMessageId, turnEpoch,
  conversationId = null, sceneRevision = null } = {}) {
  const player = validId(playerAnchorId);
  if (!player || currentPlayerMessageId == null || !Number.isSafeInteger(turnEpoch) || turnEpoch < 0
    || !Array.isArray(history)) return null;
  const matchingIndices = [];
  let latestUserIndex = -1;
  for (let index = 0; index < history.length; index++) {
    const message = history[index];
    if (message?.role === "user") latestUserIndex = index;
    if (message && message.id === currentPlayerMessageId) matchingIndices.push(index);
  }
  if (matchingIndices.length !== 1 || matchingIndices[0] !== latestUserIndex) return null;
  const turnIndex = matchingIndices[0];
  const message = history[turnIndex];
  if (message?.role !== "user" || message.isStreaming === true || typeof message.content !== "string" || !message.content.trim()) return null;
  const speakerId = validId(message.speakerCharacterId ?? player);
  if (speakerId !== player) return null;
  return {
    trusted: true,
    isCurrent: true,
    role: "user",
    messageId: message.id,
    speakerCharacterId: speakerId,
    turnIndex,
    turnEpoch,
    conversationId: conversationId ?? null,
    sceneRevision: sceneRevision ?? null,
    content: message.content
  };
}

function isDenialOrCurrentOnly(text) {
  return /(?:别|不要|不必|不用|无需|不想|暂时不).{0,12}(?:回忆|回想|提起|谈|讲|说|查|翻|问|了解).{0,14}(?:以前|过去|往事|历史|当年|旧事)?/u.test(text)
    || /(?:只|仅)(?:谈|说|讨论|看).{0,6}(?:今天|现在|当下|眼下|当前)/u.test(text);
}

function removeQuotedText(text) {
  return text.replace(/[“「『][\s\S]*?[”」』]|‘[\s\S]*?’|"[\s\S]*?"|'[^']*'/gu, " ").trim();
}

function classifyTemporalIntent(unquotedText) {
  const text = String(unquotedText || "").trim();
  if (ELLIPTICAL_FOLLOWUP_PATTERN.test(text)) return { kind: "FOLLOWUP", historicalText: "" };
  // A separate historical question may follow a present/future instruction. Within
  // an ambiguous mixed clause, current/future wording cannot grant history access.
  const historicalClauses = text.split(/[，,。；;！？!?\n]/u).filter(clause => {
    if (CURRENT_FUTURE_PATTERN.test(clause) || REMINDER_PATTERN.test(clause)) return false;
    return HISTORICAL_PATTERN.test(clause)
      || /(?:你|您)(?:还|是否|可否|可)?记得/u.test(clause)
      || /记得.+(?:吗|么)$/u.test(clause);
  });
  if (historicalClauses.length) return { kind: "PAST_HISTORY", historicalText: historicalClauses.join("，") };
  return { kind: CURRENT_FUTURE_PATTERN.test(text) || REMINDER_PATTERN.test(text)
    ? "CURRENT_FUTURE" : "NONE", historicalText: "" };
}

function isValidBinding(binding, { ownerId, playerAnchorId, trustedPlayerTurn }) {
  if (!binding || typeof binding !== "object") return false;
  const targetIds = normalizeTargets(binding.targetCharacterIds);
  const owner = validId(binding.responderId ?? binding.ownerId);
  const player = validId(binding.playerAnchorId);
  const authorizedEpoch = Number(binding.authorizedTurnEpoch ?? binding.turnEpoch);
  const expiresAfterTurnEpoch = Number(binding.expiresAfterTurnEpoch ?? authorizedEpoch + 1);
  const currentEpoch = trustedPlayerTurn.turnEpoch;
  if (targetIds.ambiguous || !targetIds.ids.length || owner !== ownerId || player !== playerAnchorId
    || !Number.isSafeInteger(authorizedEpoch) || currentEpoch !== authorizedEpoch + 1
    || currentEpoch > expiresAfterTurnEpoch) return false;
  if (!binding.conversationId || binding.conversationId !== trustedPlayerTurn.conversationId) return false;
  if (!binding.sceneRevision || binding.sceneRevision !== trustedPlayerTurn.sceneRevision) return false;
  return true;
}

function classifyThirdPersonHistoryRequest({ trustedPlayerTurn = null, ownerId, playerAnchorId,
  resolvedTargets = [], conversationBinding = null } = {}) {
  const owner = validId(ownerId);
  const player = validId(playerAnchorId);
  const turn = trustedPlayerTurn;
  const validTurn = turn && turn.trusted === true && turn.isCurrent === true && turn.role === "user"
    && validId(turn.speakerCharacterId) === player && Number.isSafeInteger(turn.turnEpoch) && turn.turnEpoch >= 0
    && Number.isSafeInteger(turn.turnIndex) && turn.turnIndex >= 0 && turn.messageId != null
    && typeof turn.content === "string" && turn.content.trim();
  const query = validTurn ? turn.content : "";
  const normalizedQuery = normalizeText(query);
  const queryFingerprint = validTurn ? crypto.createHash("sha256")
    .update(JSON.stringify([ROUTE_SCHEMA_VERSION, owner, player, turn.messageId, turn.turnEpoch, normalizedQuery]))
    .digest("hex") : "";
  const decision = {
    level: "L0",
    responderId: owner,
    playerAnchorId: player,
    targetCharacterIds: [],
    targetEvidence: "UNRESOLVED",
    historyIntent: "NONE",
    explicitSourceDetailRequested: false,
    denialDetected: false,
    reasonCode: "NO_HISTORICAL_INTENT",
    queryFingerprint,
    authorizationTurnIndex: validTurn ? turn.turnIndex : null,
    authorizationTurnEpoch: validTurn ? turn.turnEpoch : null,
    authorizationMessageId: validTurn ? turn.messageId : null
  };
  if (!owner) {
    decision.reasonCode = "RESPONDER_ID_INVALID";
    return decision;
  }
  if (!player || owner === player) {
    decision.reasonCode = "PLAYER_ANCHOR_UNAVAILABLE";
    return decision;
  }
  if (!validTurn) {
    decision.reasonCode = turn ? "PLAYER_TURN_INVALID" : "NO_TRUSTED_PLAYER_TURN";
    return decision;
  }

  const unquotedQuery = removeQuotedText(query);
  const denialDetected = isDenialOrCurrentOnly(unquotedQuery);
  decision.denialDetected = denialDetected;
  if (denialDetected) {
    decision.reasonCode = "DENIAL_OR_CURRENT_ONLY";
    return decision;
  }

  const temporalIntent = classifyTemporalIntent(unquotedQuery);
  const quotedOnlyHistory = /记得/u.test(query) || HISTORICAL_PATTERN.test(query);
  if (quotedOnlyHistory && !/记得/u.test(unquotedQuery) && !HISTORICAL_PATTERN.test(unquotedQuery)) {
    decision.reasonCode = "QUOTED_HISTORY_ONLY";
    return decision;
  }

  let targetResolution = normalizeTargets(resolvedTargets);
  let targetEvidence = targetResolution.evidence;
  const validFollowup = temporalIntent.kind === "FOLLOWUP"
    && isValidBinding(conversationBinding, { ownerId: owner, playerAnchorId: player, trustedPlayerTurn: turn });
  if (validFollowup && !targetResolution.ambiguous) {
    targetResolution = normalizeTargets(conversationBinding.targetCharacterIds);
    targetEvidence = "BOUND_FOLLOWUP";
  }
  const hasHistoricalIntent = temporalIntent.kind === "PAST_HISTORY" || validFollowup;
  const detailRequested = temporalIntent.kind === "PAST_HISTORY" && DETAIL_PATTERN.test(temporalIntent.historicalText);
  const timeFocused = detailRequested && TIME_PATTERN.test(temporalIntent.historicalText);
  const relationshipIntent = RELATIONSHIP_PATTERN.test(temporalIntent.historicalText);
  if (!hasHistoricalIntent) {
    decision.reasonCode = temporalIntent.kind === "FOLLOWUP" ? "FOLLOWUP_BINDING_EXPIRED" : "NO_HISTORICAL_INTENT";
    decision.targetEvidence = targetEvidence;
    return decision;
  }
  if (targetResolution.ambiguous) {
    decision.reasonCode = "IDENTITY_AMBIGUOUS";
    return decision;
  }
  if (!targetResolution.ids.length) {
    decision.reasonCode = ELLIPTICAL_FOLLOWUP_PATTERN.test(unquotedQuery) ? "FOLLOWUP_BINDING_EXPIRED" : "HISTORY_TARGET_UNRESOLVED";
    return decision;
  }

  decision.level = detailRequested ? "L2" : "L1";
  decision.targetCharacterIds = targetResolution.ids;
  decision.targetEvidence = targetEvidence;
  decision.explicitSourceDetailRequested = detailRequested;
  decision.historyIntent = timeFocused ? "TIME_FOCUSED"
    : detailRequested ? "DETAIL" : relationshipIntent ? "RELATIONSHIP" : "PAST_EVENT";
  decision.reasonCode = detailRequested ? "EXPLICIT_HISTORY_DETAIL" : "EXPLICIT_HISTORY_REQUEST";
  return decision;
}

function resolveActiveMemoryPairs({ ownerId, history = [], activeParticipantIds = [], playerId = null,
  trustedPlayerId = playerId, currentPlayerMessageId = null, turnEpoch = null,
  conversationId = null, sceneRevision = null } = {}) {
  const anchor = resolveFrozenPlayerAnchor({ ownerId, trustedPlayerId });
  const queryContext = resolveCurrentQueryContext({ history, ownerId, trustedPlayerId, activeParticipantIds });
  const trustedPlayerTurn = anchor.ok ? resolveTrustedPlayerTurn({ history, playerAnchorId: anchor.playerAnchorId,
    currentPlayerMessageId, turnEpoch, conversationId, sceneRevision }) : null;
  return {
    counterpartIds: anchor.ok ? [anchor.playerAnchorId] : [],
    playerAnchorId: anchor.playerAnchorId,
    playerAnchorTrusted: anchor.ok,
    anchorReasonCode: anchor.reasonCode,
    querySpeakerId: queryContext.querySpeakerId,
    query: queryContext.query,
    addressedIds: queryContext.addressedIds,
    directnessEvidence: queryContext.directnessEvidence,
    evidence: queryContext.directnessEvidence,
    speakerMessageId: queryContext.speakerMessageId ?? null,
    trustedPlayerTurn
  };
}

module.exports = {
  classifyTemporalIntent,
  classifyThirdPersonHistoryRequest,
  removeQuotedText,
  resolveActiveMemoryPairs,
  resolveCurrentQueryContext,
  resolveFrozenPlayerAnchor,
  resolveTrustedPlayerTurn
};
