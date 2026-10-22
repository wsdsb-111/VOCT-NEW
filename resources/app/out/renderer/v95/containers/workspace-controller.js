import { createContractError, normalizeErrorCode } from "../contracts/errors.v1.js";
import { createReadBoundary } from "../state/read-boundary.js";

const SUPPORTED_KINDS = new Set([
  "conversation-feed", "memory-list", "knowledge-facts", "worldline-timeline", "letter-list",
  "action-activity", "provider-diagnostics", "settings-section"
]);
const DOMAIN_STATUSES = new Set([
  "IDLE", "LOADING", "REFRESHING", "READY", "EMPTY", "ERROR", "STALE", "QUEUED",
  "DISPATCHED", "ACKNOWLEDGED", "CONFIRMED", "UNCONFIRMED", "UNKNOWN", "SOURCE_BOUND",
  "BLOCKED", "STALLED"
]);
const LETTER_STATUSES = Object.freeze({
  generating: "LOADING",
  generated: "READY",
  generation_failed: "ERROR",
  pending_delivery: "QUEUED",
  effect_file_written: "DISPATCHED",
  sent: "ACKNOWLEDGED",
  send_failed: "ERROR",
  payload_invalid: "BLOCKED",
  legacy_invalid_pending: "STALLED",
  cancelled: "UNKNOWN"
});
const ACTION_STATUSES = Object.freeze({
  SELECTED: "IDLE",
  PENDING_APPROVAL: "QUEUED",
  VALIDATED: "READY",
  DISPATCHED: "DISPATCHED",
  QUEUED: "QUEUED",
  QUEUE_BLOCKED: "BLOCKED",
  BINDING_FAILED: "BLOCKED",
  INSUFFICIENT_GOLD: "BLOCKED",
  QUEUE_EXPIRED: "BLOCKED",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  CONFIRMED: "CONFIRMED",
  NO_EFFECT: "UNCONFIRMED",
  VALIDATION_FAILED: "BLOCKED",
  DISPATCH_FAILED: "BLOCKED",
  UNCONFIRMED: "UNCONFIRMED",
  STATE_MISMATCH: "UNCONFIRMED",
  TIMEOUT: "STALLED"
});
const KNOWLEDGE_KINDS = Object.freeze({
  NAME: "legacyKnowledge.kinds.name",
  NICKNAME: "legacyKnowledge.kinds.nickname",
  TITLE: "legacyKnowledge.kinds.title",
  TRAIT: "legacyKnowledge.kinds.trait"
});
const WORLDLINE_TITLE_KEYS = Object.freeze({
  WAR_STARTED: "workspace.events.warStarted",
  WAR_NO_LONGER_ACTIVE: "workspace.events.warNoLongerActive",
  IMPORTANT_CHARACTER_DIED: "workspace.events.importantCharacterDied",
  TITLE_HOLDER_CHANGED: "workspace.events.titleHolderChanged"
});

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requireRead(api, method, ...args) {
  if (typeof api?.[method] !== "function") throw createContractError("IPC_UNAVAILABLE");
  return api[method](...args);
}

function safeDisplayName(value) {
  if (typeof value !== "string") return "";
  const name = value.replace(/\s*\(#\d+\)\s*$/u, "");
  if (!name.trim() || /^(?:#?\d+|id\s*[:：]?\s*\d+)$/iu.test(name.trim())
    || ["unknown", "未知", "未知角色", "姓名未载入"].includes(name.trim().toLocaleLowerCase())) return "";
  return name;
}

function text(value) {
  return typeof value === "string" ? value : "";
}

function dateText(value) {
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "";
  try { return new Date(value).toISOString(); } catch (_ignored) { return ""; }
}

function safeStatus(value, fallback = "UNKNOWN") {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  return DOMAIN_STATUSES.has(normalized) ? normalized : fallback;
}

function sameScope(left, right) {
  return Boolean(left && right && left.conversationId === right.conversationId
    && left.campaignToken === right.campaignToken && left.sourceSnapshotId === right.sourceSnapshotId);
}

function sameContext(left, right) {
  return Boolean(left && right && left.campaignTag === right.campaignTag && left.ownerTag === right.ownerTag
    && left.conversationTag === right.conversationTag && left.conversationEpoch === right.conversationEpoch
    && left.isActive === right.isActive);
}

function validScope(scope) {
  return isObject(scope) && typeof scope.conversationId === "string" && scope.conversationId.length > 0
    && typeof scope.campaignToken === "string" && scope.campaignToken.length > 0
    && typeof scope.sourceSnapshotId === "string" && scope.sourceSnapshotId.length > 0;
}

function runtimeId(value) {
  if (typeof value === "string" && /^[1-9]\d{0,19}$/u.test(value)) return value;
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

function languageValue(value) {
  return typeof value === "string" && value.length <= 32 ? value : "unknown";
}

function identityPart(value) {
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^[A-Za-z0-9:_.-]{1,120}$/u.test(value)) return value;
  return null;
}

function privateRecordId(prefix, parts, index) {
  const identities = parts.map(identityPart);
  if (identities.length && identities.every(Boolean)) {
    const id = `${prefix}-${identities.join("-")}`;
    if (id.length <= 160) return id;
  }
  return `${prefix}-index-${index}`;
}

export function createWorkspaceController({ runtime, apis = {} } = {}) {
  if (!runtime || typeof runtime.getContext !== "function" || typeof runtime.subscribeContext !== "function"
    || typeof runtime.syncContext !== "function" || typeof runtime.t !== "function"
    || !isObject(apis)) throw createContractError("VALIDATION_ERROR");

  const boundary = createReadBoundary(runtime, "workspace");
  const conversationApi = apis.conversationAPI;
  const knowledgeApi = apis.characterKnowledgeAPI;
  const lettersApi = apis.lettersAPI;
  const worldlineApi = apis.worldlineAPI;
  const usageApi = apis.usageAPI;
  let disposed = false;

  function translate(key, fallback, params = {}) {
    try {
      const value = runtime.t(key, params);
      return typeof value === "string" && value && value !== key ? value : fallback;
    } catch (_ignored) {
      return fallback;
    }
  }

  function projectConversation(entries) {
    if (!Array.isArray(entries)) throw createContractError("VALIDATION_ERROR");
    return entries.map((entry, index) => {
      if (!isObject(entry) || !["message", "error"].includes(entry.type)) return null;
      const errorEntry = entry.type === "error";
      const role = ["player", "user"].includes(text(entry.role).toLowerCase()) ? "player"
        : entry.role === "system" ? "system" : "npc";
      const name = safeDisplayName(entry.name);
      const titleKey = errorEntry ? "common.error" : name ? null
        : role === "player" ? "conversation.player"
          : role === "system" ? "conversation.system" : "conversation.npc";
      return {
        id: privateRecordId("conversation", [entry.id], index),
        ...(titleKey ? { uiTitleKey: titleKey } : {}),
        displayName: titleKey ? translate(titleKey, errorEntry ? "Unable to load this view." : role === "player" ? "Player"
          : role === "system" ? "System" : "Character") : name,
        role,
        text: errorEntry ? translate("common.error", "Unable to load this view.") : text(entry.content),
        dateText: dateText(entry.datetime),
        status: errorEntry ? "ERROR" : entry.isStreaming === true ? "LOADING" : safeStatus(entry.streamStatus, "READY"),
        streaming: !errorEntry && entry.isStreaming === true
      };
    }).filter(Boolean);
  }

  function projectSummaries(data) {
    if (!isObject(data) || !Array.isArray(data.summaries)) throw createContractError("VALIDATION_ERROR");
    const records = [];
    for (const catalog of data.summaries) {
      if (!isObject(catalog) || !Array.isArray(catalog.summaries)) continue;
      const owner = safeDisplayName(catalog.ownerName || catalog.playerName);
      const counterpart = safeDisplayName(catalog.counterpartName || catalog.characterName);
      const title = [owner, counterpart].filter(Boolean).join(" ↔ ");
      for (const summary of catalog.summaries) {
        if (!isObject(summary)) continue;
        const content = text(summary.content);
        const summaryTitle = safeDisplayName(summary.title || summary.label);
        if (!content && !summaryTitle) continue;
        const index = records.length;
        const ownerId = catalog.ownerId ?? catalog.playerId;
        const counterpartId = catalog.counterpartId ?? catalog.characterId;
        const summaryIdentity = summary.legacyBindingId ?? summary.summaryId ?? summary.id ?? summary.finalizationId
          ?? summary.memoryId ?? summary.letterId ?? summary.sourceLetterId;
        const uiTitleKey = summaryTitle || title ? null : "common.unknown";
        records.push({
          id: privateRecordId("memory", [ownerId, counterpartId, summaryIdentity], index),
          ...(uiTitleKey ? { uiTitleKey } : {}),
          title: summaryTitle || title || translate("common.unknown", "Unknown"),
          summary: content,
          dateText: dateText(summary.date || summary.createdAt),
          status: "READY"
        });
      }
    }
    return records;
  }

  async function readKnowledge() {
    const conversation = await requireRead(knowledgeApi, "getConversationView");
    if (!isObject(conversation) || conversation.available !== true || !validScope(conversation.scope)
      || !Array.isArray(conversation.participants)) throw createContractError("CONVERSATION_CHANGED");

    const owner = conversation.participants.find(person => isObject(person) && person.isPlayer === false);
    const ownerId = runtimeId(owner?.runtimeId);
    if (!ownerId) return [];

    const ownerView = await requireRead(knowledgeApi, "getOwnerView", {
      conversationId: conversation.scope.conversationId,
      campaignToken: conversation.scope.campaignToken,
      sourceSnapshotId: conversation.scope.sourceSnapshotId,
      ownerRuntimeId: ownerId
    });
    if (!isObject(ownerView) || ownerView.available !== true || !sameScope(conversation.scope, ownerView.scope)
      || ownerView.scope.ownerRuntimeId !== ownerId || runtimeId(ownerView.owner?.runtimeId) !== ownerId
      || !Array.isArray(ownerView.targets)) throw createContractError("CONVERSATION_CHANGED");

    const target = ownerView.targets.find(person => isObject(person) && runtimeId(person.runtimeId)
      && runtimeId(person.runtimeId) !== ownerId);
    const targetId = runtimeId(target?.runtimeId);
    if (!targetId) return [];

    const targetView = await requireRead(knowledgeApi, "getTargetView", {
      conversationId: ownerView.scope.conversationId,
      campaignToken: ownerView.scope.campaignToken,
      sourceSnapshotId: ownerView.scope.sourceSnapshotId,
      ownerRuntimeId: ownerId,
      targetRuntimeId: targetId
    });
    if (!isObject(targetView) || targetView.available !== true || !sameScope(conversation.scope, targetView.scope)
      || targetView.scope.ownerRuntimeId !== ownerId || targetView.scope.targetRuntimeId !== targetId
      || runtimeId(targetView.owner?.runtimeId) !== ownerId || runtimeId(targetView.target?.runtimeId) !== targetId
      || !Array.isArray(targetView.facts)) throw createContractError("CONVERSATION_CHANGED");

    const ownerName = safeDisplayName(ownerView.owner?.displayName || targetView.owner?.displayName || owner?.displayName);
    const targetName = safeDisplayName(targetView.target?.displayName || target?.displayName);
    const uiTitleParams = { owner: ownerName || null, target: targetName || null };
    const titleParams = {
      owner: ownerName || translate("legacyKnowledge.common.unknownName", "Name unavailable"),
      target: targetName || translate("legacyKnowledge.common.unknownName", "Name unavailable")
    };
    const uiTitleKey = "workspace.knowledgeDirection";
    return targetView.facts.flatMap((fact, index) => {
      if (!isObject(fact) || !Object.hasOwn(KNOWLEDGE_KINDS, fact.factType) || typeof fact.value !== "string") return [];
      const uiFactKindKey = KNOWLEDGE_KINDS[fact.factType];
      const factName = translate(uiFactKindKey, "Unknown");
      const status = fact.status === "AUTO_DISCLOSED" || fact.status === "MANUAL_KNOWN" ? "SOURCE_BOUND"
        : fact.status === "MANUAL_HIDDEN" ? "UNCONFIRMED" : "UNKNOWN";
      return [{
        id: privateRecordId("knowledge", [ownerId, targetId, fact.factKey], index),
        uiTitleKey,
        uiTitleParams,
        title: translate(uiTitleKey, `${titleParams.owner} → ${titleParams.target}`, titleParams),
        ...(ownerName ? { subjectName: ownerName } : {}),
        ...(targetName ? { targetName } : {}),
        uiFactKindKey,
        factName,
        factText: `${factName}: ${fact.value}`,
        factValue: fact.value,
        dateText: dateText(fact.firstAcquiredDate),
        status
      }];
    });
  }

  function projectWorldline(data) {
    const entries = Array.isArray(data?.annualDelta) ? data.annualDelta : null;
    if (!entries) throw createContractError("VALIDATION_ERROR");
    return entries.filter(isObject).map((entry, index) => {
      const actors = Array.isArray(entry.actors) ? entry.actors.map(actor => safeDisplayName(actor?.displayName)).filter(Boolean) : [];
      const confirmed = entry.reconciliationStatus === "CONFIRMED_BY_GAMESTATE";
      const uiTitleKey = Object.hasOwn(WORLDLINE_TITLE_KEYS, entry.type)
        ? WORLDLINE_TITLE_KEYS[entry.type] : "workspace.worldlineEvent";
      return {
        id: privateRecordId("worldline", [entry.id], index),
        uiTitleKey,
        title: translate(uiTitleKey, "Worldline event"),
        description: text(entry.detail) || actors.join(" · "),
        dateText: dateText(entry.date),
        status: confirmed ? "CONFIRMED" : entry.confidence === "PARTIAL" ? "UNCONFIRMED" : "UNKNOWN"
      };
    });
  }

  function projectLetters(data) {
    if (!isObject(data) || !Array.isArray(data.letters)) throw createContractError("VALIDATION_ERROR");
    return data.letters.filter(isObject).map((letter, index) => {
      const name = safeDisplayName(letter.characterName);
      const rawStatus = text(letter.responseStatus).toLowerCase();
      const status = Object.hasOwn(LETTER_STATUSES, rawStatus) ? LETTER_STATUSES[rawStatus] : "UNKNOWN";
      const content = text(letter.responseContent) || text(letter.letterContent);
      return {
        id: privateRecordId("letter", [letter.letterId], index),
        ...(!name ? { uiTitleKey: "letters.title" } : {}),
        title: name || translate("letters.title", "Letters"),
        ...(content ? { preview: content } : {}),
        dateText: dateText(letter.createdAt),
        stage: status,
        status,
        effectState: letter.deliveryStatus === "DELIVERED" ? "ACKNOWLEDGED" : "UNKNOWN"
      };
    });
  }

  function projectActions(entries) {
    if (!Array.isArray(entries)) throw createContractError("VALIDATION_ERROR");
    const records = [];
    for (const entry of entries) {
      if (!isObject(entry)) continue;
      if (entry.type === "action-approval") {
        const actionName = safeDisplayName(entry.action?.actionTitle);
        const targetName = safeDisplayName(entry.action?.targetCharacterName);
        const lifecycleStatus = text(entry.lifecycle?.status || entry.lifecycle?.state).toUpperCase();
        const status = Object.hasOwn(ACTION_STATUSES, lifecycleStatus) ? ACTION_STATUSES[lifecycleStatus] : "UNKNOWN";
        const actionIdentity = [entry.id, entry.action?.actionId].filter(value => identityPart(value) !== null);
        records.push({
          id: privateRecordId("action", actionIdentity, records.length),
          ...(!actionName ? { uiTitleKey: "actions.title" } : {}),
          title: actionName || translate("actions.title", "Action activity"),
          ...(actionName ? { actionName } : {}),
          ...(targetName ? { targetName } : {}),
          dateText: dateText(entry.datetime),
          stage: status,
          status,
          effectState: Object.hasOwn(ACTION_STATUSES, text(entry.lifecycle?.effectState).toUpperCase())
            ? ACTION_STATUSES[text(entry.lifecycle?.effectState).toUpperCase()] : "UNKNOWN"
        });
      } else if (entry.type === "action-feedback" && Array.isArray(entry.feedbacks)) {
        for (const [feedbackIndex, feedback] of entry.feedbacks.entries()) {
          if (!isObject(feedback)) continue;
          const lifecycleStatus = text(feedback.lifecycle?.status || feedback.lifecycle?.state).toUpperCase();
          const status = Object.hasOwn(ACTION_STATUSES, lifecycleStatus) ? ACTION_STATUSES[lifecycleStatus] : "UNKNOWN";
          const feedbackIdentity = [entry.id, feedback.actionId].filter(value => identityPart(value) !== null);
          if (identityPart(feedback.actionId) === null) feedbackIdentity.push(`feedback-${feedbackIndex}`);
          records.push({
            id: privateRecordId("action", feedbackIdentity, records.length),
            uiTitleKey: "actions.title",
            title: translate("actions.title", "Action activity"),
            dateText: dateText(entry.datetime),
            stage: status,
            status,
            effectState: Object.hasOwn(ACTION_STATUSES, text(feedback.lifecycle?.effectState).toUpperCase())
              ? ACTION_STATUSES[text(feedback.lifecycle?.effectState).toUpperCase()] : "UNKNOWN"
          });
        }
      }
    }
    return records;
  }

  async function projectDiagnostics() {
    if (typeof usageApi?.getReport !== "function") {
      return [{ id: "provider-usage-unknown", metricKey: "unknown", value: null, unit: "tokens", estimateKind: "unknown" }];
    }
    const report = await requireRead(usageApi, "getReport");
    const latest = Array.isArray(report?.recent) ? report.recent[0] : null;
    const usage = latest?.providerUsage;
    const provenance = usage?.provenance;
    const hasReportedSource = provenance?.providerUsageShape === "gemini_metadata"
      ? provenance?.fieldSources?.totalTokens === "PROVIDER_REPORTED"
      : provenance?.providerUsageShape === undefined;
    const totalTokens = usage?.native?.totalTokens;
    const reported = latest?.isUsageRecord === true && latest?.usageEstimated !== true
      && ["REPORTED", "PARTIAL"].includes(provenance?.status) && hasReportedSource
      && Number.isSafeInteger(totalTokens) && totalTokens >= 0;
    if (!reported) return [{ id: "provider-usage-unknown", metricKey: "unknown", value: null, unit: "tokens", estimateKind: "unknown" }];
    return [{ id: "provider-native-total", metricKey: "native", value: totalTokens, unit: "tokens", estimateKind: "native" }];
  }

  function projectSettings() {
    const preferences = runtime.getPreferences?.();
    if (!isObject(preferences)) throw createContractError("IPC_UNAVAILABLE");
    return [
      { id: "settings-ui-language", settingKey: "uiLanguage", value: languageValue(preferences.uiLanguage) },
      { id: "settings-prompt-language", settingKey: "promptLanguage", value: languageValue(preferences.promptLanguage) },
      { id: "settings-game-language", settingKey: "gameLanguage", value: languageValue(preferences.gameLanguage) }
    ];
  }

  async function readKind(kind) {
    switch (kind) {
      case "conversation-feed":
        return projectConversation(await requireRead(conversationApi, "getConversationEntries"));
      case "memory-list":
        return projectSummaries(await requireRead(conversationApi, "getSummariesDashboardData"));
      case "knowledge-facts":
        return readKnowledge();
      case "worldline-timeline":
        return projectWorldline(await requireRead(worldlineApi, "getAnnualDelta"));
      case "letter-list":
        return projectLetters(await requireRead(lettersApi, "getStatuses"));
      case "action-activity":
        return projectActions(await requireRead(conversationApi, "getConversationEntries"));
      case "provider-diagnostics":
        return projectDiagnostics();
      case "settings-section":
        return projectSettings();
      default:
        throw createContractError("VALIDATION_ERROR");
    }
  }

  async function load(kind) {
    const empty = { committed: false, records: [], errorCode: "REQUEST_CANCELLED", isCurrent: () => false };
    if (disposed) return empty;
    if (!SUPPORTED_KINDS.has(kind)) return { ...empty, errorCode: "VALIDATION_ERROR" };
    try {
      await runtime.syncContext();
      const contextBefore = runtime.getContext();
      const result = await boundary.run(kind, () => readKind(kind));
      await runtime.syncContext();
      const current = result.isCurrent() && sameContext(contextBefore, runtime.getContext());
      const committed = Boolean(result.committed && current);
      return {
        committed,
        records: committed && !result.errorCode && Array.isArray(result.value) ? result.value : [],
        errorCode: current ? result.errorCode : "STALE_CONTEXT",
        isCurrent: () => !disposed && current && result.isCurrent()
      };
    } catch (error) {
      return { committed: false, records: [], errorCode: normalizeErrorCode(error), isCurrent: () => false };
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    boundary.dispose();
  }

  return Object.freeze({ load, dispose });
}
