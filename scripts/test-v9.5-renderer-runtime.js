"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const i18next = require("../resources/app/node_modules/i18next");

const root = path.resolve(__dirname, "..");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

async function loadRuntime() {
  const moduleUrl = pathToFileURL(path.join(root, "src/app/renderer/v95/containers/renderer-runtime.js")).href;
  const { createRendererRuntime } = await import(moduleUrl);
  return createRendererRuntime;
}

async function makeI18n() {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: "zh", fallbackLng: "zh", initImmediate: false, interpolation: { escapeValue: false } });
  return i18n;
}

function context(conversationTag, conversationEpoch = 1) {
  return {
    campaignTag: "campaign-hmac-1",
    ownerTag: "owner-hmac-1",
    conversationTag,
    conversationEpoch,
    isActive: true
  };
}

function makeEventApi() {
  const listeners = { conversation: new Set(), usage: new Set() };
  const unsubscribeCalls = { conversation: 0, usage: 0 };
  return {
    listeners,
    unsubscribeCalls,
    onConversationUpdate(callback) {
      listeners.conversation.add(callback);
      return () => { unsubscribeCalls.conversation += 1; listeners.conversation.delete(callback); };
    },
    onContextUsageUpdate(callback) {
      listeners.usage.add(callback);
      return () => { unsubscribeCalls.usage += 1; listeners.usage.delete(callback); };
    },
    emitConversationUpdate(entries) { for (const callback of [...listeners.conversation]) callback(entries); },
    emitUsage(snapshot) { for (const callback of [...listeners.usage]) callback(snapshot); }
  };
}

async function testLanguageIsolationAndPresentation(createRendererRuntime) {
  let uiLanguage = "en-US";
  let presentationEnabled = false;
  let legacyReads = 0;
  let legacyWrites = 0;
  let settingsReads = 0;
  let languageWrites = 0;
  let languageReads = 0;
  let presentationWrites = 0;
  let delayedLanguageReadback = null;
  const providerAndPromptSettings = {
    activeProvider: "provider-17",
    providerConfig: { model: "local-test-model", endpoint: "configured-provider-placeholder" },
    promptSettings: { mainTemplate: "Prompt bytes stay untouched.\r\nSecond line." }
  };
  const serializedHash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const originalHash = serializedHash(providerAndPromptSettings);
  const api = {
    getLanguage() { legacyReads += 1; return "zh"; },
    saveLanguage() { legacyWrites += 1; return undefined; },
    getAppSettings() { settingsReads += 1; return providerAndPromptSettings; },
    async getLanguagePreferences() {
      return { uiLanguage, promptLanguage: "en", gameLanguage: "unknown", promptLanguageSource: "legacy-action-language" };
    },
    async getUiLanguage() {
      languageReads += 1;
      if (delayedLanguageReadback) {
        const pending = delayedLanguageReadback;
        delayedLanguageReadback = null;
        return pending.promise;
      }
      return uiLanguage;
    },
    async saveUiLanguage(value) { languageWrites += 1; uiLanguage = value; },
    async getUiPresentationEnabled() { return presentationEnabled; },
    async saveUiPresentationEnabled(value) { presentationWrites += 1; presentationEnabled = value; }
  };
  const events = makeEventApi();
  const i18n = await makeI18n();
  const runtime = await createRendererRuntime({ i18n, apis: { llmConfigAPI: api, conversationAPI: { ...events } } });
  const stableTranslator = runtime.t;
  let stateNotifications = 0;
  const unsubscribe = runtime.subscribe(() => { stateNotifications += 1; });

  try {
    assert.equal(runtime.getPreferences().uiLanguage, "en-US");
    assert.equal(runtime.getPreferences().promptLanguage, "en");
    assert.equal(runtime.getPreferences().gameLanguage, "unknown");
    assert.equal(runtime.getPreferences().presentationEnabled, false);
    assert.equal(runtime.t, stableTranslator);
    assert.equal(runtime.t("common.loading"), "Loading…");
    assert.equal(i18n.language, "en", "initial preference selects the packaged English locale");

    const languageReadback = deferred();
    delayedLanguageReadback = languageReadback;
    const languageChange = runtime.setUiLanguage("zh-CN");
    await waitFor(() => languageWrites === 1 && languageReads === 2, "language save should reach its separate readback");
    assert.equal(runtime.getPreferences().uiLanguage, "en-US", "save acknowledgment alone cannot switch the interface");
    assert.equal(i18n.language, "en");
    languageReadback.resolve("zh-CN");
    const languageResult = await languageChange;
    assert.equal(languageResult.success, true);
    assert.equal(languageWrites, 1);
    assert.equal(i18n.language, "zh", "confirmed language change selects the packaged Simplified Chinese locale");
    assert.equal(runtime.getPreferences().uiLanguage, "zh-CN");
    assert.equal(runtime.getPreferences().promptLanguage, "en");
    assert.equal(runtime.getPreferences().gameLanguage, "unknown");
    assert.equal(runtime.t("common.loading"), "正在加载…");
    assert.equal(runtime.t, stableTranslator, "t must remain a stable function as its selected translator changes");
    assert.equal(runtime.t("settings.languageHelp"), "切换界面语言不会改变提示词或游戏语言。");

    const presentationResult = await runtime.setPresentationEnabled(true);
    assert.equal(presentationResult.success, true);
    assert.equal(presentationWrites, 1);
    assert.equal(runtime.getPreferences().presentationEnabled, true);
    assert.equal(runtime.getPreferences().promptLanguage, "en");
    assert.equal(legacyReads, 0, "runtime must never call the legacy getLanguage API");
    assert.equal(legacyWrites, 0, "runtime must never call or write through the legacy saveLanguage API");
    assert.equal(settingsReads, 0, "runtime must not read provider or prompt settings");
    assert.equal(serializedHash(providerAndPromptSettings), originalHash, "provider and serialized Prompt content must remain byte-stable");
    assert(stateNotifications >= 3, "runtime subscribers receive their initial frame and setting updates");

    const notificationCount = stateNotifications;
    unsubscribe();
    await runtime.setPresentationEnabled(false);
    assert.equal(stateNotifications, notificationCount, "unsubscribe stops later UI state notifications");
  } finally {
    runtime.dispose();
  }
}

async function testContextLatestWinsResetAndDispose(createRendererRuntime) {
  const events = makeEventApi();
  let contextReader = async () => context("conversation-initial", 1);
  let contextReads = 0;
  const api = {
    async getLanguagePreferences() { return { uiLanguage: "zh-CN", promptLanguage: "en", promptLanguageSource: "legacy-action-language" }; },
    async getUiLanguage() { return "zh-CN"; },
    async getUiPresentationEnabled() { return false; },
    async getUiContext() { contextReads += 1; return contextReader(); }
  };
  events.getUiContext = api.getUiContext;
  const runtime = await createRendererRuntime({ i18n: await makeI18n(), apis: { llmConfigAPI: api, conversationAPI: events } });
  const contextNotifications = [];
  const unsubscribeContext = runtime.subscribeContext(value => contextNotifications.push(value?.conversationTag ?? null));

  try {
    assert.equal(runtime.getContext().conversationTag, "conversation-initial");
    assert.equal(contextNotifications[0], "conversation-initial", "context subscribers receive the initial frame immediately");
    const older = deferred();
    const newer = deferred();
    const queued = [older, newer];
    contextReader = () => queued.shift().promise;
    const firstRead = runtime.syncContext();
    const secondRead = runtime.syncContext();
    newer.resolve(context("conversation-newer", 3));
    await secondRead;
    older.resolve(context("conversation-older", 2));
    await firstRead;
    assert.equal(runtime.getContext().conversationTag, "conversation-newer", "late context reads cannot overwrite the latest request");
    assert(!contextNotifications.includes("conversation-older"));

    contextReader = async () => context("conversation-from-conversation-event", 4);
    events.emitConversationUpdate();
    await waitFor(() => runtime.getContext()?.conversationTag === "conversation-from-conversation-event", "conversation update should sync Main context");

    const afterReset = deferred();
    contextReader = () => afterReset.promise;
    events.emitUsage({ conversationId: null, phase: "reset", responders: [] });
    assert.equal(runtime.getContext(), null, "reset event clears current context synchronously");
    assert.equal(contextNotifications.at(-1), null, "context subscribers see the cleared frame immediately");
    afterReset.resolve(context("conversation-after-reset", 5));
    await waitFor(() => runtime.getContext()?.conversationTag === "conversation-after-reset", "reset should be followed by a Main context readback");
    assert(contextReads >= 5);

    unsubscribeContext();
    const beforeDispose = runtime.getContext();
    runtime.dispose();
    assert.equal(events.unsubscribeCalls.conversation, 1, "dispose must unsubscribe the conversation event");
    assert.equal(events.unsubscribeCalls.usage, 1, "dispose must unsubscribe the context usage event");
    assert.equal(events.listeners.conversation.size, 0);
    assert.equal(events.listeners.usage.size, 0);
    events.emitConversationUpdate();
    events.emitUsage({ conversationId: null, phase: "reset" });
    assert.equal(runtime.getContext(), beforeDispose, "host events after disposal must not mutate runtime context");
  } finally {
    unsubscribeContext();
    runtime.dispose();
  }
}

async function testEmptyConversationUpdateInvalidatesOfficialRecollection(createRendererRuntime) {
  const events = makeEventApi();
  const conversationA = context("conversation-ready-a", 6);
  let contextReader = async () => conversationA;
  let contextReads = 0;
  const api = {
    async getLanguagePreferences() { return { uiLanguage: "zh-CN", promptLanguage: "en", promptLanguageSource: "legacy-action-language" }; },
    async getUiLanguage() { return "zh-CN"; },
    async getUiPresentationEnabled() { return false; },
    getUiContext() { contextReads += 1; return contextReader(); }
  };
  events.getUiContext = api.getUiContext;
  const runtime = await createRendererRuntime({ i18n: await makeI18n(), apis: { llmConfigAPI: api, conversationAPI: events } });
  const { createOfficialRecollectionReader } = await import(pathToFileURL(path.join(root,
    "src/app/renderer/v95/state/official-recollection-reader.js")).href);
  const recollection = {
    status: "READY",
    ownerCharacterId: "42",
    sourceType: "CK3_OFFICIAL_RECOLLECTION",
    entries: [{ renderedText: "Anonymous official recollection fixture." }],
    renderedSummary: "Anonymous official recollection fixture.",
    gameDate: "1171.9.20"
  };
  const reader = createOfficialRecollectionReader({
    runtime,
    worldlineApi: {
      async getOfficialRecollection() { return recollection; },
      onUpdated() { return () => {}; }
    },
    timeoutMs: 1000
  });

  try {
    const ready = await reader.refresh("42");
    assert.equal(ready.status, "ready", "the fixture starts with a valid A-context recollection");
    assert.strictEqual(ready.value, recollection);
    assert.notEqual(ready.contextVersion, null);

    events.emitConversationUpdate([{ type: "message", content: "streaming update" }]);
    assert.equal(runtime.getContext()?.conversationTag, conversationA.conversationTag,
      "a non-empty conversation update must not clear context during normal streaming");

    const deferredContextB = deferred();
    contextReader = () => deferredContextB.promise;
    const readsBeforeEnd = contextReads;
    events.emitConversationUpdate([]);
    assert.equal(runtime.getContext(), null, "the explicit empty entries event invalidates context synchronously");
    assert.equal(reader.getStateFor("42", ready.contextVersion).value, null,
      "render-time official recollection projection is null before the deferred B context read resolves");
    await waitFor(() => contextReads > readsBeforeEnd, "empty entries should start a Main context readback");

    events.emitUsage({ conversationId: null, phase: "reset", responders: [] });
    assert.equal(runtime.getContext(), null, "the subsequent usage reset leaves context invalidated");
    assert.equal(reader.getStateFor("42", ready.contextVersion).value, null,
      "official recollection remains hidden after reset while Main context is unresolved");
    await waitFor(() => contextReads > readsBeforeEnd + 1, "usage reset should supersede the earlier context read");

    deferredContextB.resolve(context("conversation-b", 7));
    await waitFor(() => runtime.getContext()?.conversationTag === "conversation-b",
      "the latest deferred Main context read should eventually commit");
    assert.equal(reader.getStateFor("42", ready.contextVersion).value, null,
      "the A recollection remains hidden after the B context read completes");
    assert.equal(reader.getState().value, null);
  } finally {
    reader.dispose();
    runtime.dispose();
  }
}

async function testUnknownWriteDoesNotRetry(createRendererRuntime) {
  const pendingSave = deferred();
  let saveCalls = 0;
  let languageReads = 0;
  const api = {
    async getLanguagePreferences() { return { uiLanguage: "zh-CN", promptLanguage: "en", promptLanguageSource: "legacy-action-language" }; },
    async getUiLanguage() { languageReads += 1; return "zh-CN"; },
    async saveUiLanguage() { saveCalls += 1; return pendingSave.promise; },
    async getUiPresentationEnabled() { return false; }
  };
  const runtime = await createRendererRuntime({ i18n: await makeI18n(), apis: { llmConfigAPI: api, conversationAPI: {} } });
  const abortController = new AbortController();
  try {
    const changing = runtime.setUiLanguage("en-US", { signal: abortController.signal });
    assert.equal(saveCalls, 1, "one user intent starts exactly one backend save");
    abortController.abort();
    const result = await changing;
    assert.equal(result.errorCode, "EFFECT_UNKNOWN");
    assert.equal(result.readbackRequired, true);
    assert.equal(runtime.getPreferences().uiLanguage, "zh-CN", "an unconfirmed write cannot update the interface language");
    await assert.rejects(runtime.setUiLanguage("en-US"), error => error.code === "EFFECT_UNKNOWN");
    assert.equal(saveCalls, 1, "unknown effect remains locked and is not automatically replayed");
    assert.equal(languageReads, 1, "cancelled write does not perform an automatic readback or retry");
    pendingSave.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(saveCalls, 1);
    runtime.dispose();
    const remounted = await createRendererRuntime({ i18n: await makeI18n(), apis: { llmConfigAPI: api, conversationAPI: {} } });
    try {
      await assert.rejects(remounted.setUiLanguage("en-US"), error => error.code === "EFFECT_UNKNOWN");
      assert.equal(saveCalls, 1, "remount cannot clear an unknown write lock and replay its semantic operation");
    } finally {
      remounted.dispose();
    }
  } finally {
    runtime.dispose();
  }
}

async function testMissingApisFailClosed(createRendererRuntime) {
  const runtime = await createRendererRuntime({ i18n: await makeI18n(), apis: {} });
  try {
    assert.deepEqual(runtime.getPreferences(), {
      uiLanguage: "zh-CN",
      presentationEnabled: false,
      promptLanguage: "unknown",
      gameLanguage: "unknown",
      promptLanguageSource: "unknown"
    });
    assert.equal(runtime.getContext(), null);
    assert.equal(runtime.t("common.loading"), "正在加载…");
    await assert.rejects(runtime.setUiLanguage("en-US"), error => error.code === "IPC_UNAVAILABLE");
    await assert.rejects(runtime.setPresentationEnabled(true), error => error.code === "IPC_UNAVAILABLE");
  } finally {
    runtime.dispose();
  }

  let writesWithoutReadback = 0;
  const partialRuntime = await createRendererRuntime({
    i18n: await makeI18n(),
    apis: { llmConfigAPI: {
      async getLanguagePreferences() { return { uiLanguage: "zh-CN" }; },
      async saveUiLanguage() { writesWithoutReadback += 1; },
      async saveUiPresentationEnabled() { writesWithoutReadback += 1; }
    } }
  });
  try {
    await assert.rejects(partialRuntime.setUiLanguage("en-US"), error => error.code === "IPC_UNAVAILABLE");
    await assert.rejects(partialRuntime.setPresentationEnabled(true), error => error.code === "IPC_UNAVAILABLE");
    assert.equal(writesWithoutReadback, 0, "a setting without its readback API is never written");
  } finally {
    partialRuntime.dispose();
  }
}

async function main() {
  const createRendererRuntime = await loadRuntime();
  await testLanguageIsolationAndPresentation(createRendererRuntime);
  await testContextLatestWinsResetAndDispose(createRendererRuntime);
  await testEmptyConversationUpdateInvalidatesOfficialRecollection(createRendererRuntime);
  await testUnknownWriteDoesNotRetry(createRendererRuntime);
  await testMissingApisFailClosed(createRendererRuntime);
  process.stdout.write("V9.5 renderer runtime: PASS\n");
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
