import { createUiTranslator, normalizeUiLanguage } from "../i18n/index.js";
import { createContractError } from "../contracts/errors.v1.js";
import { createEventSubscriptions } from "../ipc/event-subscriptions.js";
import { createRendererIpcClient } from "../ipc/renderer-ipc-client.js";

const LANGUAGE_VALUES = new Set(["zh-CN", "en-US"]);
const writeLocksByApi = new WeakMap();

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validTag(value) {
  return value === null || typeof value === "string" && value.length > 0 && value.length <= 160;
}

function normalizeContext(value) {
  if (!isObject(value)
    || !validTag(value.campaignTag) || !validTag(value.ownerTag) || !validTag(value.conversationTag)
    || !Number.isSafeInteger(value.conversationEpoch) || value.conversationEpoch < 0
    || typeof value.isActive !== "boolean") return null;
  return Object.freeze({
    campaignTag: value.campaignTag,
    ownerTag: value.ownerTag,
    conversationTag: value.conversationTag,
    conversationEpoch: value.conversationEpoch,
    isActive: value.isActive
  });
}

function sameContext(left, right) {
  return Boolean(left && right && left.campaignTag === right.campaignTag && left.ownerTag === right.ownerTag
    && left.conversationTag === right.conversationTag && left.conversationEpoch === right.conversationEpoch
    && left.isActive === right.isActive);
}

function writeLockMap(api) {
  if (!isObject(api)) return new Map();
  let locks = writeLocksByApi.get(api);
  if (!locks) {
    locks = new Map();
    writeLocksByApi.set(api, locks);
  }
  return locks;
}

function createOperationKey(field, runtimeId, sequence) {
  return `v95:${field}:${runtimeId}:${sequence}`;
}

function makeWriteHandler(api, method) {
  if (typeof api?.[method] !== "function") return undefined;
  return async value => {
    const result = await api[method](value);
    // The Main handler resolves only after its synchronous settings write has returned.
    return result === undefined ? { success: true } : result;
  };
}

export async function createRendererRuntime({ i18n, apis = {} } = {}) {
  if (!i18n || typeof i18n.addResourceBundle !== "function" || typeof i18n.getFixedT !== "function"
    || typeof i18n.changeLanguage !== "function") throw createContractError("VALIDATION_ERROR");

  const configApi = isObject(apis.llmConfigAPI) ? apis.llmConfigAPI : {};
  const conversationApi = isObject(apis.conversationAPI) ? apis.conversationAPI : {};
  const ipcMap = {
    "llm:getLanguagePreferences": typeof configApi.getLanguagePreferences === "function" ? () => configApi.getLanguagePreferences() : undefined,
    "llm:getUiLanguage": typeof configApi.getUiLanguage === "function" ? () => configApi.getUiLanguage() : undefined,
    "llm:getUiPresentationEnabled": typeof configApi.getUiPresentationEnabled === "function" ? () => configApi.getUiPresentationEnabled() : undefined,
    "llm:saveUiLanguage": makeWriteHandler(configApi, "saveUiLanguage"),
    "llm:saveUiPresentationEnabled": makeWriteHandler(configApi, "saveUiPresentationEnabled"),
    "conversation:getUiContext": typeof conversationApi.getUiContext === "function" ? () => conversationApi.getUiContext() : undefined
  };
  const ipcClient = createRendererIpcClient({ ipcMap });
  const subscriptions = createEventSubscriptions();
  const locks = writeLockMap(apis.llmConfigAPI);
  const runtimeId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const translators = {
    "zh-CN": createUiTranslator(i18n, "zh-CN"),
    "en-US": createUiTranslator(i18n, "en-US")
  };
  const listeners = new Set();
  const contextListeners = new Set();
  let uiLanguage = "zh-CN";
  let presentationEnabled = false;
  let promptLanguage = "unknown";
  let promptLanguageSource = "unknown";
  let currentContext = null;
  let currentTranslator = translators[uiLanguage];
  let writeSequence = 0;
  let contextSequence = 0;
  let contextController = null;
  let disposed = false;

  const stableT = (key, params = {}) => currentTranslator(key, params);

  function getPreferences() {
    return Object.freeze({
      uiLanguage,
      presentationEnabled,
      promptLanguage,
      gameLanguage: "unknown",
      promptLanguageSource
    });
  }

  function getState() {
    return Object.freeze({ preferences: getPreferences(), context: currentContext });
  }

  function notifyRuntime() {
    if (disposed) return;
    const state = getState();
    for (const listener of Array.from(listeners)) {
      try { listener(state); } catch (_ignored) { }
    }
  }

  function notifyContext() {
    if (disposed) return;
    for (const listener of Array.from(contextListeners)) {
      try { listener(currentContext); } catch (_ignored) { }
    }
    notifyRuntime();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw createContractError("VALIDATION_ERROR");
    if (disposed) return () => {};
    listeners.add(listener);
    try { listener(getState()); } catch (_ignored) { }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  function subscribeContext(listener) {
    if (typeof listener !== "function") throw createContractError("VALIDATION_ERROR");
    if (disposed) return () => {};
    contextListeners.add(listener);
    try { listener(currentContext); } catch (_ignored) { }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      contextListeners.delete(listener);
    };
  }

  function getContext() {
    return currentContext;
  }

  async function syncContext() {
    if (disposed) return currentContext;
    const sequence = ++contextSequence;
    contextController?.abort();
    const controller = new AbortController();
    contextController = controller;
    let nextContext = null;
    try {
      nextContext = normalizeContext(await ipcClient.read("conversation:getUiContext", null, { signal: controller.signal }));
    } catch (_ignored) {
      nextContext = null;
    }
    if (disposed || sequence !== contextSequence) return currentContext;
    contextController = null;
    const contextChanged = currentContext === null
      ? nextContext !== null
      : nextContext === null || !sameContext(currentContext, nextContext);
    if (contextChanged) {
      currentContext = nextContext;
      notifyContext();
    }
    return currentContext;
  }

  function clearContextForReset() {
    contextSequence += 1;
    contextController?.abort();
    contextController = null;
    if (currentContext !== null) {
      currentContext = null;
      notifyContext();
    }
    void syncContext();
  }

  function subscribeHostEvent(key, register, listener) {
    if (typeof register !== "function") return;
    try {
      subscriptions.subscribe(key, callback => register.call(conversationApi, callback), listener);
    } catch (_ignored) {
      // Optional preload events fail closed; callers can still use explicit readback.
    }
  }

  subscribeHostEvent("conversation:updated", conversationApi.onConversationUpdate, entries => {
    // Main emits an empty entries array when clearing the active conversation.
    if (Array.isArray(entries) && entries.length === 0) {
      clearContextForReset();
      return;
    }
    void syncContext();
  });
  subscribeHostEvent("conversation:context-usage-updated", conversationApi.onContextUsageUpdate, snapshot => {
    if (!snapshot || snapshot.conversationId === null || snapshot.conversationId === undefined
      || String(snapshot.phase || "").toLowerCase() === "reset") clearContextForReset();
  });

  async function read(method, fallback, options = {}) {
    try { return await ipcClient.read(method, null, options); } catch (_ignored) { return fallback; }
  }

  async function initialize() {
    const [rawPreferences, rawLanguage, rawPresentation] = await Promise.all([
      read("llm:getLanguagePreferences", null),
      read("llm:getUiLanguage", undefined),
      read("llm:getUiPresentationEnabled", undefined)
    ]);
    const preferences = isObject(rawPreferences) ? rawPreferences : {};
    const resolvedLanguage = LANGUAGE_VALUES.has(rawLanguage) ? rawLanguage
      : rawLanguage === undefined && LANGUAGE_VALUES.has(preferences.uiLanguage) ? preferences.uiLanguage : normalizeUiLanguage(rawLanguage);
    uiLanguage = resolvedLanguage;
    currentTranslator = translators[uiLanguage];
    presentationEnabled = typeof rawPresentation === "boolean" ? rawPresentation : false;
    promptLanguage = typeof preferences.promptLanguage === "string" && preferences.promptLanguage.length <= 32
      ? preferences.promptLanguage : "unknown";
    promptLanguageSource = typeof preferences.promptLanguageSource === "string" && preferences.promptLanguageSource.length <= 64
      ? preferences.promptLanguageSource : (promptLanguage === "unknown" ? "unknown" : "legacy-action-language");
    try { await i18n.changeLanguage(uiLanguage === "zh-CN" ? "zh" : "en"); } catch (_ignored) { }
    await syncContext();
  }

  function startWrite(field, method, value, signal, timeoutMs) {
    if (disposed) throw createContractError("IPC_UNAVAILABLE");
    if (signal?.aborted) throw createContractError("REQUEST_CANCELLED");
    if (locks.has(field)) throw createContractError("EFFECT_UNKNOWN");
    if (typeof ipcMap[method] !== "function") throw createContractError("IPC_UNAVAILABLE");
    const operationKey = createOperationKey(field, runtimeId, ++writeSequence);
    const lock = { operationKey, state: "pending" };
    locks.set(field, lock);
    return { lock, writeOptions: { operationKey, ...(signal ? { signal } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) } };
  }

  function markUnknown(lock, result) {
    lock.state = "unknown";
    return Object.freeze({
      success: false,
      status: "unknown",
      errorCode: "EFFECT_UNKNOWN",
      readbackRequired: true,
      receipt: result?.receipt || null
    });
  }

  function isConfirmedWrite(result) {
    return Boolean(result && result.status !== "unknown" && result.readbackRequired !== true
      && (result.status === "completed" || result.success === true || result.ok === true));
  }

  async function confirmWrite(field, method, value, readbackMethod, expectedReadback, options = {}) {
    const { signal, timeoutMs } = options;
    if (typeof ipcMap[method] !== "function" || typeof ipcMap[readbackMethod] !== "function") {
      throw createContractError("IPC_UNAVAILABLE");
    }
    const { lock, writeOptions } = startWrite(field, method, value, signal, timeoutMs);
    try {
      const result = await ipcClient.write(method, value, writeOptions);
      if (!isConfirmedWrite(result)) return markUnknown(lock, result);
      lock.state = "readback";
      const readback = await ipcClient.read(readbackMethod, null, {
        ...(signal ? { signal } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {})
      });
      if (!Object.is(readback, expectedReadback)) return markUnknown(lock, result);
      if (field === "uiLanguage") {
        await i18n.changeLanguage(value === "zh-CN" ? "zh" : "en");
        uiLanguage = value;
        currentTranslator = translators[value];
      } else {
        presentationEnabled = value;
      }
      if (locks.get(field) === lock) locks.delete(field);
      notifyRuntime();
      return Object.freeze({ success: true, [field]: value, receipt: result.receipt || null });
    } catch (_ignored) {
      return markUnknown(lock, { receipt: null });
    }
  }

  async function setUiLanguage(language, options = {}) {
    if (!LANGUAGE_VALUES.has(language)) throw createContractError("VALIDATION_ERROR");
    if (locks.has("uiLanguage")) throw createContractError("EFFECT_UNKNOWN");
    if (language === uiLanguage) return Object.freeze({ success: true, uiLanguage, unchanged: true });
    return confirmWrite("uiLanguage", "llm:saveUiLanguage", language, "llm:getUiLanguage", language, options);
  }

  async function setPresentationEnabled(enabled, options = {}) {
    if (typeof enabled !== "boolean") throw createContractError("VALIDATION_ERROR");
    if (locks.has("presentationEnabled")) throw createContractError("EFFECT_UNKNOWN");
    if (enabled === presentationEnabled) return Object.freeze({ success: true, presentationEnabled, unchanged: true });
    return confirmWrite("presentationEnabled", "llm:saveUiPresentationEnabled", enabled,
      "llm:getUiPresentationEnabled", enabled, options);
  }

  await initialize();

  function dispose() {
    if (disposed) return;
    disposed = true;
    contextSequence += 1;
    contextController?.abort();
    contextController = null;
    subscriptions.dispose();
    listeners.clear();
    contextListeners.clear();
  }

  return Object.freeze({
    getPreferences,
    getState,
    t: stableT,
    subscribe,
    setUiLanguage,
    setPresentationEnabled,
    getContext,
    subscribeContext,
    syncContext,
    dispose
  });
}
