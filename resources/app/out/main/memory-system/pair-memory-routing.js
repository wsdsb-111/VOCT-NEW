"use strict";

const crypto = require("crypto");

const TARGET_EVIDENCE = new Set(["EXPLICIT_ID", "UNIQUE_ALIAS", "KINSHIP_UNIQUE"]);
const HISTORICAL_PATTERN = /以前|曾经|过去|往事|历史|当年|当时|那年|此前|之前|后来|回忆|回想|旧事|\d{3,6}\s*年/u;
const PAST_TIME_PATTERN = /去年|前年|[零〇一二两三四五六七八九十百\d]+\s*(?:年|个月|月|天|日)前|前些年|前些日子|往年|早年|从前|很久以前|早先|当初/u;
const PAST_QUERY_PATTERN = /谈|说|争论|见|关系|相处|记得|经历|发生|约定|往来|如何|什么|怎样/u;
const CURRENT_FUTURE_PATTERN = /现在|今天|当下|眼下|当前|明天|后天|下次|将来|未来|接下来|稍后/u;
const FUTURE_PLAN_PATTERN = /(?:之后|以后)(?:还要|要不要|计划|会不会)|(?:还要|要不要|计划|会不会).{0,8}(?:之后|以后)|(?:只|仅)(?:谈|说|讨论|看).{0,6}(?:今天|现在|当下|眼下|当前)/u;
const FUTURE_DEPENDENCY_PATTERN = /(?:等|待|如果|假如|若).{0,20}(?:以后|之后|过后)|(?:以后|之后|过后).{0,10}(?:还要|要不要|计划|会不会|准备|打算|将|要)|(?:记得|提醒|记住).{0,24}(?:以后|之后|过后).{0,10}(?:把|将|要|交|给|通知|安排|送|带|告诉)/u;
const PLAN_ACTION_PATTERN = /(?:准备|打算)(?:去|要|安排|如何|怎么|做|处理|见|接见)/u;
const NEGATION_PATTERN = /别|不要|不必|不用|无需|不想|暂时不/u;
const DENIAL_ACTION_PATTERN = /回忆|回想|提起|谈|讲|说|查|翻|问|了解/u;
const DENIAL_HISTORY_PATTERN = /以前|过去|往事|历史|当年|旧事|从前|经历|关系|记忆/u;
const DIRECT_RECALL_ACTION_PATTERN = /回忆|回想|查|翻/u;
const REMINDER_PATTERN = /记得\s*(?:把|将|要|去|给|向|通知|提醒|安排|交|带|告诉|转告|送)/u;
const DETAIL_PATTERN = /具体|究竟|到底|原话|为何|为什么|原因|过程|经过|详细|怎么说|说了什么|如何说|怎么处理|如何处理|发生了什么|发生过什么|什么争执|哪些争执|哪一年|何时|什么时候|\d{3,6}\s*年/u;
const EVENT_AFTER_RECALL_PATTERN = /(?:发生了?什么|发生过什么|怎么样了|关系(?:如何|怎么样|怎么变化)|关系.{0,4}(?:有什么|有何)变化|(?:关系.{0,4})?发生过变化|(?:关系.{0,4})?有过变化|结果如何|有何影响|有什么影响|有没有.{0,8}过|有没有再(?:见面|会面|往来)|是否.{0,8}过|如何相处|怎么相处|经历过什么|当时如何)/u;
const COMPLETED_ASPECT_PATTERN = /(?:发生|见|遇到|经历|改变|变化|处理|相处)(?:了|过)|(?:已经|曾经).{0,8}(?:发生|见|经历|改变|变化|处理|相处)/u;
const TIME_PATTERN = /哪一年|何时|什么时候|\d{3,6}\s*年|当年|那年/u;
const RELATIONSHIP_PATTERN = /记得|认识|关系|相处|交情|如何|怎么样|什么样/u;
const ELLIPTICAL_FOLLOWUP_PATTERN = /^(?:(?:那|那么)?(?:(?:他|她|他们|她们|它|这件事|那件事|这个约定)?(?:后来|之后|接下来))|(?:他|她|他们|她们|它)?(?:后来|之后|然后)|这件事|那件事|这个约定)(?:呢|如何|怎么样|怎么了|发生了什么)?[？?。！!…]*$/u;
const ROUTE_SCHEMA_VERSION = "v9363-third-person-route-3";

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
    evidence: ambiguous || !ids.size ? "UNRESOLVED" : evidence.has("UNIQUE_ALIAS") ? "UNIQUE_ALIAS"
      : evidence.has("KINSHIP_UNIQUE") ? "KINSHIP_UNIQUE" : "EXPLICIT_ID",
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

function resolveTrustedPlayerTurn({ history = [], playerAnchorId, currentPlayerMessageId, turnEpoch, logicalTurnEpoch = null,
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
  const speakerId = validId(message.speakerCharacterId);
  if (speakerId !== player) return null;
  return {
    trusted: true,
    isCurrent: true,
    role: "user",
    messageId: message.id,
    speakerCharacterId: speakerId,
    turnIndex,
    turnEpoch,
    logicalTurnEpoch: Number.isSafeInteger(logicalTurnEpoch) && logicalTurnEpoch >= 0 ? logicalTurnEpoch : null,
    conversationId: conversationId ?? null,
    sceneRevision: sceneRevision ?? null,
    content: message.content
  };
}

function removeQuotedText(text) {
  const endings = new Map([["“", "”"], ["「", "」"], ["『", "』"], ["‘", "’"], ["\"", "\""], ["'", "'"]]);
  const stack = [];
  const visible = [];
  for (const character of String(text || "")) {
    if (stack.length) {
      if (character === stack[stack.length - 1]) {
        stack.pop();
      }
      else if (endings.has(character)) stack.push(endings.get(character));
      continue;
    }
    if (endings.has(character)) {
      stack.push(endings.get(character));
      visible.push(" ");
    }
    else visible.push(character);
  }
  return visible.join("").trim();
}

function splitIntentClauses(text) {
  const normalized = String(text || "").replace(/((?:以后|之后|过后))[，,]\s*/gu, "$1 ");
  return normalized.split(/[，,。；;！？!?\n]+|(?<!不)(?=(?:不过|但是|但|可是|然而))/u)
    .map(clause => clause.trim()).filter(Boolean);
}

function hasEventAfterRecall(text) {
  const connectors = /(?:以后|之后|过后)/gu;
  for (const match of text.matchAll(connectors)) {
    const event = text.slice(Math.max(0, match.index - 24), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 40);
    if ([...event.matchAll(/\p{Script=Han}/gu)].length < 2) continue;
    if (EVENT_AFTER_RECALL_PATTERN.test(after)) return { matched: true, completed: COMPLETED_ASPECT_PATTERN.test(after) };
  }
  return { matched: false, completed: false };
}

function isHistoricalDenialClause(text) {
  const negation = NEGATION_PATTERN.exec(text);
  if (!negation) return false;
  const remainder = text.slice(negation.index + negation[0].length);
  const action = DENIAL_ACTION_PATTERN.exec(remainder);
  if (!action || action.index > 12) return false;
  const deniedTopic = remainder.slice(action.index + action[0].length);
  return DIRECT_RECALL_ACTION_PATTERN.test(action[0]) || DENIAL_HISTORY_PATTERN.test(deniedTopic);
}

function classifyIntentClause(text) {
  const denialScope = isHistoricalDenialClause(text);
  const explicitHistoryQuestion = /(?:你|您)(?:还|是否|可否|可)?记得/u.test(text)
    || /记得.+(?:吗|么)$/u.test(text);
  const historicalEvidence = [];
  if (HISTORICAL_PATTERN.test(text)) historicalEvidence.push("PAST_ANCHOR");
  if (PAST_TIME_PATTERN.test(text) && PAST_QUERY_PATTERN.test(text)) historicalEvidence.push("PAST_TIME_QUERY");
  const eventAfterRecall = hasEventAfterRecall(text);
  if (eventAfterRecall.matched) historicalEvidence.push("EVENT_AFTER_RECALL");
  if (eventAfterRecall.completed) historicalEvidence.push("COMPLETED_ASPECT");
  if (explicitHistoryQuestion) historicalEvidence.push("HISTORY_QUESTION");
  const futureEvidence = [];
  if (FUTURE_DEPENDENCY_PATTERN.test(text)) futureEvidence.push("FUTURE_DEPENDENCY");
  if (CURRENT_FUTURE_PATTERN.test(text) || FUTURE_PLAN_PATTERN.test(text) || REMINDER_PATTERN.test(text)
    || !historicalEvidence.length && PLAN_ACTION_PATTERN.test(text)) {
    if (!futureEvidence.includes("FUTURE_DEPENDENCY")) futureEvidence.push("CURRENT_OR_PLAN_ANCHOR");
  }
  const mayRequestSourceDetail = historicalEvidence.length > 0 && !futureEvidence.length && DETAIL_PATTERN.test(text);
  if (denialScope) return { text, kind: "DENIAL", historicalEvidence, futureEvidence, denialScope, explicitHistoryQuestion, mayRequestSourceDetail: false };
  if (historicalEvidence.length && !futureEvidence.length) {
    return { text, kind: "PAST_HISTORY", historicalEvidence, futureEvidence, denialScope, explicitHistoryQuestion,
      mayRequestSourceDetail };
  }
  if (historicalEvidence.length && futureEvidence.length) {
    return { text, kind: "AMBIGUOUS", historicalEvidence, futureEvidence, denialScope, explicitHistoryQuestion,
      mayRequestSourceDetail: false };
  }
  if (futureEvidence.length || CURRENT_FUTURE_PATTERN.test(text) || REMINDER_PATTERN.test(text)) {
    return { text, kind: "CURRENT_FUTURE", historicalEvidence, futureEvidence, denialScope, explicitHistoryQuestion,
      mayRequestSourceDetail: false };
  }
  return { text, kind: "NEUTRAL", historicalEvidence, futureEvidence, denialScope, explicitHistoryQuestion,
    mayRequestSourceDetail: false };
}

function classifyTemporalIntent(unquotedText) {
  const text = String(unquotedText || "").trim();
  if (ELLIPTICAL_FOLLOWUP_PATTERN.test(text)) return { kind: "FOLLOWUP", historicalText: "", clauses: [], denialScopes: [], ambiguous: false };
  const clauses = splitIntentClauses(text).map(classifyIntentClause);
  const historicalClauses = clauses.filter(clause => clause.kind === "PAST_HISTORY");
  const denialScopes = clauses.filter(clause => clause.denialScope);
  if (historicalClauses.length) return { kind: "PAST_HISTORY", historicalText: historicalClauses.map(clause => clause.text).join("，"),
    clauses, denialScopes, ambiguous: clauses.some(clause => clause.kind === "AMBIGUOUS") };
  if (denialScopes.length) return { kind: "DENIAL", historicalText: "", clauses, denialScopes, ambiguous: false };
  if (clauses.some(clause => clause.kind === "AMBIGUOUS")) {
    return { kind: "AMBIGUOUS", historicalText: "", clauses, denialScopes, ambiguous: true };
  }
  return { kind: clauses.some(clause => clause.kind === "CURRENT_FUTURE") ? "CURRENT_FUTURE" : "NONE",
    historicalText: "", clauses, denialScopes, ambiguous: false };
}

function isValidBinding(binding, { ownerId, playerAnchorId, trustedPlayerTurn }) {
  if (!binding || typeof binding !== "object") return false;
  if (binding.routeSchemaVersion != null && binding.routeSchemaVersion !== ROUTE_SCHEMA_VERSION) return false;
  const targetIds = normalizeTargets(binding.targetCharacterIds);
  const owner = validId(binding.responderId ?? binding.ownerId);
  const player = validId(binding.playerAnchorId);
  const logical = binding.authorizedLogicalTurnEpoch != null;
  const authorizedEpoch = Number(logical ? binding.authorizedLogicalTurnEpoch : binding.authorizedTurnEpoch ?? binding.turnEpoch);
  const expiresAfterTurnEpoch = logical ? authorizedEpoch + 1 : Number(binding.expiresAfterTurnEpoch ?? authorizedEpoch + 1);
  const currentEpoch = logical ? trustedPlayerTurn.logicalTurnEpoch : trustedPlayerTurn.turnEpoch;
  if (targetIds.ambiguous || !targetIds.ids.length || owner !== ownerId || player !== playerAnchorId
    || !Number.isSafeInteger(authorizedEpoch) || currentEpoch !== authorizedEpoch + 1
    || currentEpoch > expiresAfterTurnEpoch) return false;
  if (!binding.conversationId || binding.conversationId !== trustedPlayerTurn.conversationId) return false;
  if (!binding.sceneRevision || binding.sceneRevision !== trustedPlayerTurn.sceneRevision) return false;
  return true;
}

function classifyThirdPersonHistoryRequest({ trustedPlayerTurn = null, ownerId, playerAnchorId,
  resolvedTargets = [], deniedTargetCharacterIds = [], denialScopeAmbiguous = false,
  targetScopedDenial = false, conversationBinding = null } = {}) {
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
    logicalQueryFingerprint: validTurn ? crypto.createHash("sha256")
      .update(JSON.stringify([ROUTE_SCHEMA_VERSION, owner, player, turn.messageId, normalizedQuery])).digest("hex") : "",
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
  const temporalIntent = classifyTemporalIntent(unquotedQuery);
  const hasDenialScope = temporalIntent.denialScopes.length > 0 || targetScopedDenial === true;
  const quotedOnlyHistory = /记得/u.test(query) || HISTORICAL_PATTERN.test(query);
  if (quotedOnlyHistory && !/记得/u.test(unquotedQuery) && !HISTORICAL_PATTERN.test(unquotedQuery)) {
    decision.reasonCode = "QUOTED_HISTORY_ONLY";
    return decision;
  }

  let targetResolution = normalizeTargets(resolvedTargets);
  const deniedIds = new Set((Array.isArray(deniedTargetCharacterIds) ? deniedTargetCharacterIds : [])
    .map(validId).filter(Boolean));
  if (targetResolution.ids.length && deniedIds.size) {
    const ids = targetResolution.ids.filter(id => !deniedIds.has(id));
    targetResolution = { ...targetResolution, ids,
      evidence: ids.length ? targetResolution.evidence : "UNRESOLVED" };
  }
  const denialDetected = hasDenialScope && (denialScopeAmbiguous || deniedIds.size === 0 || !targetResolution.ids.length);
  decision.denialDetected = denialDetected;
  let targetEvidence = targetResolution.evidence;
  const validFollowup = temporalIntent.kind === "FOLLOWUP"
    && isValidBinding(conversationBinding, { ownerId: owner, playerAnchorId: player, trustedPlayerTurn: turn });
  if (validFollowup && !targetResolution.ambiguous) {
    targetResolution = normalizeTargets(conversationBinding.targetCharacterIds);
    targetEvidence = "BOUND_FOLLOWUP";
  }
  const hasHistoricalIntent = temporalIntent.kind === "PAST_HISTORY" || validFollowup;
  const detailRequested = temporalIntent.kind === "PAST_HISTORY"
    && temporalIntent.clauses.some(clause => clause.kind === "PAST_HISTORY" && clause.mayRequestSourceDetail);
  const timeFocused = detailRequested && TIME_PATTERN.test(temporalIntent.historicalText);
  const relationshipIntent = RELATIONSHIP_PATTERN.test(temporalIntent.historicalText);
  if (!hasHistoricalIntent) {
    decision.reasonCode = temporalIntent.kind === "FOLLOWUP" ? "FOLLOWUP_BINDING_EXPIRED"
      : denialDetected ? "DENIAL_OR_CURRENT_ONLY"
        : temporalIntent.kind === "AMBIGUOUS" ? "AMBIGUOUS_TEMPORAL_CLAUSE" : "NO_HISTORICAL_INTENT";
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
  conversationId = null, sceneRevision = null, logicalTurnEpoch = null } = {}) {
  const anchor = resolveFrozenPlayerAnchor({ ownerId, trustedPlayerId });
  const queryContext = resolveCurrentQueryContext({ history, ownerId, trustedPlayerId, activeParticipantIds });
  const trustedPlayerTurn = anchor.ok ? resolveTrustedPlayerTurn({ history, playerAnchorId: anchor.playerAnchorId,
    currentPlayerMessageId, turnEpoch, logicalTurnEpoch, conversationId, sceneRevision }) : null;
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
  ROUTE_SCHEMA_VERSION,
  classifyTemporalIntent,
  classifyThirdPersonHistoryRequest,
  removeQuotedText,
  resolveActiveMemoryPairs,
  resolveCurrentQueryContext,
  resolveFrozenPlayerAnchor,
  resolveTrustedPlayerTurn
};
