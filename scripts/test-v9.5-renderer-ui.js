"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
function mockPreloadSource({ presentationEnabled = false } = {}) {
  return `(() => {
    const state = {
      uiLanguage: "zh-CN",
      presentationEnabled: ${JSON.stringify(presentationEnabled)},
      legacyLanguage: "en",
      effectApiCalls: [],
      providerConfigWrites: [],
      promptWrites: [],
      legacyLanguageCalls: [],
      providerSelectionCalls: [],
      uiPreferenceWrites: [],
      readCalls: [],
      eventSubscriptions: [],
      unexpectedCalls: [],
      blockedNetwork: [],
      alerts: [],
      appSettings: {
        llmSettings: {
          activeProviderInstanceId: "player2",
          providers: [{
            instanceId: "player2",
            providerType: "player2",
            customName: "",
            apiKey: "",
            baseUrl: "",
            defaultModel: "fixture-model",
            defaultParameters: { temperature: 0.7, max_tokens: 256 }
          }],
          presets: []
        },
        ck3UserFolderPath: null,
        modLocationPath: null,
        globalStreamEnabled: true,
        pauseOnRegeneration: false,
        generateFollowingMessages: true,
        messageFontSize: 1.1,
        showSettingsOnStartup: true,
        chatPromptV89Settings: {},
        allowPrerelease: false,
        actionSettings: { disabledActions: [], validation: {} },
        actionApprovalSettings: { approvalMode: "none", pauseOnApproval: true },
        summaryPromptSettings: { rollingPrompt: "", finalPrompt: "", letterSummaryPrompt: "", finalSummaryMaxTokens: 4096 },
        worldlineSettings: {
          autosavePath: null, baseGamePath: null, subjectiveWorldMode: "DIAGNOSTIC",
          autoWatchEnabled: false, promptIntegrationEnabled: false, lastValidatedAt: null,
          lastValidationStatus: "UNCONFIGURED"
        },
        language: "en"
      },
      promptSettings: {
        mainTemplate: "SAFE TEST PROMPT ONLY",
        defaultMainTemplatePath: "system/default.hbs",
        blocks: [],
        suffix: { enabled: false, template: "", label: "Suffix" }
      },
      letterPromptSettings: {
        mainTemplate: "SAFE TEST LETTER PROMPT ONLY",
        defaultMainTemplatePath: "system/letter.hbs",
        blocks: [],
        suffix: { enabled: false, template: "", label: "Suffix" }
      }
    };
    const clone = value => JSON.parse(JSON.stringify(value));
    const read = (api, method) => state.readCalls.push(api + "." + method);
    const subscribe = (api, method) => callback => {
      state.eventSubscriptions.push(api + "." + method);
      return () => {};
    };
    const effects = {
      conversationAPI: new Set([
        "sendMessage", "reset", "cancelStream", "pauseConversation", "resumeConversation",
        "joinWaitingCharacter", "leavePresentCharacter", "temporarilyLeaveCharacter", "returnTemporaryCharacter",
        "regenerateMessage", "editUserMessage", "regenerateError", "clearSummaries", "approveActions",
        "declineActions", "retryFailedSummaries", "applyPairMemoryBackfill", "bindLegacySummaryCampaign",
        "bindLegacyConversationCampaign", "bindLegacyOwnerCampaign", "regenerateSummary", "updateSummary",
        "deleteSummary", "deleteCharacterSummaries"
      ]),
      lettersAPI: new Set([
        "runEffectDiagnostic", "resyncGameDate", "retryBlockedRunCommand", "cancelBlockedRunCommand",
        "retryStalledRunCommand", "cancelStalledRunCommand", "confirmEffectDiagnostic", "retryFailed",
        "retryPayload", "clearPending", "clearOldStatuses"
      ]),
      actionsAPI: new Set(["execute"]),
      worldlineAPI: new Set([
        "setRecallSettings", "setAutosavePath", "validateAutosavePath", "selectAutosaveFile",
        "rebuildCheckpoint", "temporalArchive", "mutateCanon", "migrateLegacySupplemental",
        "confirmCanonBranch", "forkCanonBranch", "resumeCanonBranch", "createSupplemental",
        "updateSupplemental", "deleteSupplemental", "testCanonRecall"
      ]),
      characterKnowledgeAPI: new Set(["setManualStatus"])
    };
    const configWriteMethods = new Set([
      "saveProviderConfig", "deletePreset", "saveGlobalStreamSetting", "savePauseOnRegenerationSetting",
      "saveGenerateFollowingMessagesSetting", "saveMessageFontSize", "saveShowSettingsOnStartupSetting",
      "saveAllowPrerelease", "setActionsProviderId", "setSummaryProviderId", "saveActionApprovalSettings",
      "saveSummaryPromptSettings", "setCK3Folder", "setModLocationPath", "setCustomContextLength",
      "clearCustomContextLength"
    ]);
    const promptWriteMethods = new Set([
      "saveSettings", "saveLetterSettings", "saveFile", "savePreset", "deletePreset", "exportZip"
    ]);
    function api(name, handlers) {
      return new Proxy(handlers, {
        get(target, key, receiver) {
          if (typeof key !== "string") return Reflect.get(target, key, receiver);
          if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
          if (key.startsWith("on")) return subscribe(name, key);
          return (...args) => {
            const label = name + "." + key;
            if (effects[name]?.has(key)) state.effectApiCalls.push(label);
            else if (name === "llmConfigAPI" && configWriteMethods.has(key)) state.providerConfigWrites.push(label);
            else if (name === "promptsAPI" && promptWriteMethods.has(key)) state.promptWrites.push(label);
            else if (name === "llmConfigAPI" && ["getLanguage", "saveLanguage"].includes(key)) state.legacyLanguageCalls.push(label);
            else state.unexpectedCalls.push(label);
            return Promise.resolve({ success: false, errorCode: "MOCK_WRITE_BLOCKED" });
          };
        }
      });
    }
    const context = {
      campaignTag: "mock-campaign-tag",
      ownerTag: "mock-owner-tag",
      conversationTag: "mock-conversation-tag",
      conversationEpoch: 1,
      isActive: true
    };
    const entries = [
      { type: "message", role: "npc", name: "Mock courtier", content: "A harmless local conversation fixture.", datetime: "867-01-01T00:00:00.000Z" },
      { type: "action-approval", action: { actionTitle: "Mock action", targetCharacterName: "Mock target" },
        lifecycle: { status: "ACKNOWLEDGED", effectState: "UNKNOWN" }, datetime: "867-01-01T00:00:00.000Z" }
    ];
    const scope = { conversationId: "fixture-conversation", campaignToken: "fixture-campaign", sourceSnapshotId: "fixture-snapshot" };
    const llmConfigAPI = api("llmConfigAPI", {
      getAppSettings: async () => { read("llmConfigAPI", "getAppSettings"); return clone(state.appSettings); },
      getActionsProviderId: async () => { read("llmConfigAPI", "getActionsProviderId"); return "player2"; },
      getSummaryProviderId: async () => { read("llmConfigAPI", "getSummaryProviderId"); return "player2"; },
      getActionApprovalSettings: async () => { read("llmConfigAPI", "getActionApprovalSettings"); return clone(state.appSettings.actionApprovalSettings); },
      listModels: async () => { read("llmConfigAPI", "listModels"); return []; },
      getSummaryPromptSettings: async () => {
        read("llmConfigAPI", "getSummaryPromptSettings");
        return { rollingPrompt: "Anonymous rolling prompt fixture", finalPrompt: "Anonymous final prompt fixture", letterSummaryPrompt: "Anonymous letter prompt fixture", finalSummaryMaxTokens: 4096 };
      },
      setActiveProvider: async instanceId => {
        state.providerSelectionCalls.push(instanceId);
        state.appSettings.llmSettings.activeProviderInstanceId = instanceId;
        return { success: true };
      },
      checkPlayer2Health: async () => { read("llmConfigAPI", "checkPlayer2Health"); return { success: false, code: "MOCK_OFFLINE" }; },
      getLanguage: async () => { state.legacyLanguageCalls.push("llmConfigAPI.getLanguage"); return state.legacyLanguage; },
      saveLanguage: async () => { state.legacyLanguageCalls.push("llmConfigAPI.saveLanguage"); return { success: false, errorCode: "MOCK_WRITE_BLOCKED" }; },
      getLanguagePreferences: async () => {
        read("llmConfigAPI", "getLanguagePreferences");
        return { uiLanguage: state.uiLanguage, promptLanguage: "en", gameLanguage: "unknown", promptLanguageSource: "legacy-action-language" };
      },
      getUiLanguage: async () => { read("llmConfigAPI", "getUiLanguage"); return state.uiLanguage; },
      getUiPresentationEnabled: async () => { read("llmConfigAPI", "getUiPresentationEnabled"); return state.presentationEnabled; },
      saveUiLanguage: async value => {
        state.uiPreferenceWrites.push({ method: "saveUiLanguage", value });
        state.uiLanguage = value;
        return { success: true, status: "completed" };
      },
      saveUiPresentationEnabled: async value => {
        state.uiPreferenceWrites.push({ method: "saveUiPresentationEnabled", value });
        state.presentationEnabled = value;
        return { success: true, status: "completed" };
      }
    });
    const promptsAPI = api("promptsAPI", {
      getSettings: async () => { read("promptsAPI", "getSettings"); return clone(state.promptSettings); },
      getLetterSettings: async () => { read("promptsAPI", "getLetterSettings"); return clone(state.letterPromptSettings); },
      listFiles: async () => { read("promptsAPI", "listFiles"); return []; },
      listPresets: async () => { read("promptsAPI", "listPresets"); return []; }
    });
    const conversationAPI = api("conversationAPI", {
      getUiContext: async () => { read("conversationAPI", "getUiContext"); return clone(context); },
      getConversationEntries: async () => { read("conversationAPI", "getConversationEntries"); return clone(entries); },
      getActiveConversationData: async () => { read("conversationAPI", "getActiveConversationData"); return null; },
      getSummariesDashboardData: async () => {
        read("conversationAPI", "getSummariesDashboardData");
        return { summaries: [{ ownerName: "Mock player", counterpartName: "Mock courtier", summaries: [
          { title: "Mock memory", content: "A harmless local Legacy Summary fixture.", date: "867-01-01" }
        ] }] };
      },
      onConversationUpdate: subscribe("conversationAPI", "onConversationUpdate"),
      onContextUsageUpdate: subscribe("conversationAPI", "onContextUsageUpdate")
    });
    const lettersAPI = api("lettersAPI", {
      getStatuses: async () => {
        read("lettersAPI", "getStatuses");
        return { letters: [{ characterName: "Mock recipient", responseStatus: "sent", responseContent: "Fixture letter text.",
          createdAt: "867-01-01", deliveryStatus: "DELIVERED" }] };
      }
    });
    const worldlineAPI = api("worldlineAPI", {
      getSettings: async () => { read("worldlineAPI", "getSettings"); return { settings: { autosavePath: null, lastValidationStatus: "UNCONFIGURED" } }; },
      getCheckpointStatus: async () => { read("worldlineAPI", "getCheckpointStatus"); return { checkpoint: { status: "UNCONFIGURED" } }; },
      getOverview: async () => { read("worldlineAPI", "getOverview"); return { overview: { importantWars: 0, deltaPending: 0 } }; },
      getAnnualDelta: async () => {
        read("worldlineAPI", "getAnnualDelta");
        return { annualDelta: [{ detail: "A harmless local timeline fixture.", date: "867.1.1", actors: [{ displayName: "Mock actor" }], confidence: "PARTIAL" }] };
      },
      getWorldKnowledge: async () => {
        read("worldlineAPI", "getWorldKnowledge");
        return { worldKnowledge: [{ id: "fixture-worldbook", title: "Fixture worldbook entry", value: "Read-only fixture", source: "GAME_TRUTH", visibility: "PUBLIC_WORLD" }] };
      },
      onUpdated: subscribe("worldlineAPI", "onUpdated")
    });
    const characterKnowledgeAPI = api("characterKnowledgeAPI", {
      getConversationView: async () => {
        read("characterKnowledgeAPI", "getConversationView");
        return { available: true, scope: clone(scope), participants: [
          { runtimeId: 1, displayName: "Mock owner", isPlayer: false },
          { runtimeId: 2, displayName: "Mock target", isPlayer: false }
        ] };
      },
      getOwnerView: async () => {
        read("characterKnowledgeAPI", "getOwnerView");
        return { available: true, scope: { ...clone(scope), ownerRuntimeId: "1" },
          owner: { runtimeId: "1", displayName: "Mock owner" }, targets: [{ runtimeId: 2, displayName: "Mock target" }] };
      },
      getTargetView: async () => {
        read("characterKnowledgeAPI", "getTargetView");
        return { available: true, scope: { ...clone(scope), ownerRuntimeId: "1", targetRuntimeId: "2" },
          owner: { runtimeId: "1", displayName: "Mock owner" }, target: { runtimeId: "2", displayName: "Mock target" },
          facts: [{ factKey: "known-name", factType: "NAME", value: "Mock disclosed name", status: "AUTO_DISCLOSED" }] };
      }
    });
    const usageAPI = api("usageAPI", {
      getReport: async () => {
        read("usageAPI", "getReport");
        return { recent: [], byRequest: [{ key: "action | deepseek | fixture-model", requests: 2, promptTokens: 100, totalTokens: 110, cacheHitRate: 0.5 }],
          criticalActionRecall: { requests: 2, byAction: [{ actionId: "isInjured", available: 2, observations: 2 }], recent: [] } };
      }
    });
    const electronAPI = api("electronAPI", {
      getAppVersion: async () => "V9.5 UI fixture",
      setIgnoreMouseEvents: () => {},
      onChatReset: subscribe("electronAPI", "onChatReset"),
      onToggleSettings: subscribe("electronAPI", "onToggleSettings"),
      onHideChat: subscribe("electronAPI", "onHideChat"),
      onOverlayVisibilityChange: subscribe("electronAPI", "onOverlayVisibilityChange")
    });
    const performanceDiagnosticsAPI = api("performanceDiagnosticsAPI", {
      getState: async () => ({ enabled: false }),
      recordRendererMetrics: async () => ({ success: true }),
      exportReport: async () => ({ exported: false, reason: "MOCK" })
    });
    window.electronAPI = electronAPI;
    window.llmConfigAPI = llmConfigAPI;
    window.promptsAPI = promptsAPI;
    window.conversationAPI = conversationAPI;
    window.lettersAPI = lettersAPI;
    window.actionsAPI = api("actionsAPI", {
      getSettings: async () => { read("actionsAPI", "getSettings"); return { disabledActions: [] }; },
      getAll: async () => {
        read("actionsAPI", "getAll");
        return [{ id: "fixture-action", title: "只读夹具动作", localizedTitles: { "zh-CN": "只读夹具动作", "en-US": "Read-only fixture action" }, scope: "local", filePath: "fixture/read-only.action",
          validation: { valid: true, message: "" }, disabled: false, isDestructive: false, hasDestructiveOverride: false }];
      }
    });
    window.worldlineAPI = worldlineAPI;
    window.characterKnowledgeAPI = characterKnowledgeAPI;
    window.usageAPI = usageAPI;
    window.providerDiagnosticsAPI = api("providerDiagnosticsAPI", {
      getStatus: async () => { read("providerDiagnosticsAPI", "getStatus"); return { status: "READY" }; },
      getRealRequestDiff: async () => { read("providerDiagnosticsAPI", "getRealRequestDiff"); return { summary: { conclusion: "insufficient_data" }, entries: [] }; },
      getV89Settings: async () => { read("providerDiagnosticsAPI", "getV89Settings"); return { chatPromptV89Layout: true, chatPromptV89OutboundDiagnostics: true, chatPromptV89RuntimeProfileSplit: true, chatPromptV810ProviderAdapter: true }; }
    });
    window.performanceDiagnosticsAPI = performanceDiagnosticsAPI;
    state.protectedSnapshot = () => JSON.stringify({
      providerSettings: state.appSettings.llmSettings,
      promptSettings: state.promptSettings,
      letterPromptSettings: state.letterPromptSettings,
      legacyLanguage: state.legacyLanguage
    });
    window.__v95RendererUiFixture = state;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.origin !== location.origin) {
        state.blockedNetwork.push(url.origin);
        return Promise.reject(new Error("External network blocked by renderer UI fixture"));
      }
      return nativeFetch(input, init);
    };
    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function(...args) {
      const xhr = new OriginalXHR(...args);
      const open = xhr.open.bind(xhr);
      xhr.open = (method, target, ...rest) => {
        const url = new URL(target, location.href);
        if (url.origin !== location.origin) {
          state.blockedNetwork.push(url.origin);
          throw new Error("External network blocked by renderer UI fixture");
        }
        return open(method, target, ...rest);
      };
      return xhr;
    };
    window.XMLHttpRequest.prototype = OriginalXHR.prototype;
    window.alert = message => state.alerts.push(String(message));
    window.confirm = () => false;
  })();`;
}

async function clickSelector(browser, selector) {
  const result = await browser.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    node.click();
    return true;
  })()`);
  assert.equal(result, true, `expected a visible control matching ${selector}`);
}

async function clickHeaderButton(browser, labels) {
  const result = await browser.evaluate(`(() => {
    const labels = ${JSON.stringify(labels)};
    const button = Array.from(document.querySelectorAll(".config-header > button"))
      .find(candidate => labels.some(label => candidate.textContent.trim().includes(label)));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(result, true, `expected a header tab matching ${labels.join("/")}`);
}

async function selectLanguage(browser, code) {
  await clickSelector(browser, ".language-selector > button");
  await browser.waitFor("document.querySelector('.language-dropdown .language-option')");
  const result = await browser.evaluate(`(() => {
    const code = ${JSON.stringify(code)};
    const option = Array.from(document.querySelectorAll(".language-option"))
      .find(candidate => candidate.querySelector(".lang-code")?.textContent.trim() === code);
    if (!option) return false;
    option.click();
    return true;
  })()`);
  assert.equal(result, true, `expected language option ${code}`);
  const language = code === "EN" ? "en-US" : "zh-CN";
  await browser.waitFor(`window.__v95RendererUiFixture.uiLanguage === ${JSON.stringify(language)} && !document.querySelector('.language-dropdown')`);
}

async function selectTheme(browser, theme) {
  const result = await browser.evaluate(`(() => {
    const button = document.querySelector('button.court-theme-button img[src*="theme-${theme}-v1.png"]')?.closest("button");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(result, true, `expected ${theme} theme control`);
  await browser.waitFor(`document.documentElement.getAttribute('data-votc-theme') === ${JSON.stringify(theme)}`);
}

async function assertNoHorizontalOverflow(browser, label) {
  const metrics = await browser.evaluate(`(() => {
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth
    };
  })()`);
  assert(metrics.document <= metrics.viewport, `${label}: document overflows horizontally (${JSON.stringify(metrics)})`);
  assert(metrics.body <= metrics.viewport, `${label}: body overflows horizontally (${JSON.stringify(metrics)})`);
}

async function main() {
  const [{ startServer }, { launchBrowser }] = await Promise.all([
    import(pathToFileURL(path.join(root, "review", "v95-deepseek", "serve.mjs")).href),
    import(pathToFileURL(path.join(root, "review", "v95-deepseek", "tests", "browser.mjs")).href)
  ]);
  const server = await startServer({ port: 0 });
  let browser = null;
  try {
    // The shared helper requires a readiness marker; use an inert data page, never the showcase.
    // Install the preload mock, then navigate the same Chrome tab to the real renderer entry.
    const bootstrapUrl = "data:text/html,%3C!doctype%20html%3E%3Chtml%20data-demo-ready%3D%22true%22%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E";
    browser = await launchBrowser({ url: bootstrapUrl, width: 1024, height: 900 });
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: mockPreloadSource() });
    browser.errors.length = 0;
    browser.consoleErrors.length = 0;
    browser.failedRequests.length = 0;
    browser.requests.length = 0;
    const origin = new URL(server.url).origin;
    const productionUrl = `${origin}/src/app/renderer/index.html`;
    await browser.send("Page.navigate", { url: productionUrl });
    await browser.waitFor("Boolean(document.querySelector('.config-panel-container .provider-config-panel') && document.querySelector('.language-selector'))", { timeout: 25000 });

    assert.equal(await browser.evaluate("document.querySelector('.config-panel-container') !== null"), true,
      "Main mock showSettingsOnStartup=true should open the production settings panel");
    assert.equal(await browser.evaluate("window.__v95RendererUiFixture.appSettings.showSettingsOnStartup"), true);

    const protectedBefore = await browser.evaluate("window.__v95RendererUiFixture.protectedSnapshot()");
    await clickHeaderButton(browser, ["设置", "Settings"]);
    await browser.waitFor("document.querySelector('.v95-language-settings input[type=checkbox]')");
    const focusedBefore = await browser.evaluate(`(() => {
      const input = document.querySelector('.v95-language-settings input[type="checkbox"]');
      input.focus();
      return document.activeElement === input;
    })()`);
    assert.equal(focusedBefore, true, "the production UI language input should accept focus");
    await clickSelector(browser, ".v95-language-settings input[type=checkbox]");
    await browser.waitFor("document.documentElement.getAttribute('data-v95-presentation') === 'true'");
    await browser.evaluate(`document.querySelector('.v95-language-settings input[type="checkbox"]').focus()`);
    await selectLanguage(browser, "EN");
    assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('.v95-language-settings input[type="checkbox"]')`), true,
      "UI language rerender should preserve focus on the settings input");
    await selectLanguage(browser, "ZH");
    assert.equal(await browser.evaluate("window.__v95RendererUiFixture.presentationEnabled"), true);

    assert.equal(await browser.evaluate("document.querySelector('.v95-workspace') !== null"), false, "no duplicate workspace is added");
    assert.equal(await browser.evaluate("document.querySelector('.config-header').innerText.includes('V9.5 工作区')"), false);
    await selectTheme(browser, "knight");
    await browser.evaluate("new Promise(resolve => setTimeout(resolve, 220))");
    await browser.screenshot(path.join(root, ".build", "v9.5-construction", "visual", "knight-zh.png"));
    await selectLanguage(browser, "EN");
    await browser.waitFor("document.querySelector('.v95-language-settings')?.innerText.includes('Interface language')");
    await assertNoHorizontalOverflow(browser, "1024px original settings");
    await selectTheme(browser, "parchment");
    await browser.evaluate("new Promise(resolve => setTimeout(resolve, 220))");
    await browser.screenshot(path.join(root, ".build", "v9.5-construction", "visual", "parchment-en.png"));
    await selectTheme(browser, "ink");
    await selectTheme(browser, "knight");
    await selectLanguage(browser, "ZH");
    await browser.waitFor("document.querySelector('.v95-language-settings')?.innerText.includes('界面语言')");
    await assertNoHorizontalOverflow(browser, "Chinese original settings");
    const panelStyle = await browser.evaluate(`(() => {
      const style = getComputedStyle(document.querySelector('.config-main-content'));
      return { background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow };
    })()`);
    assert.equal(panelStyle.background, "rgba(0, 0, 0, 0)", "the large panel should have no opaque base color");
    assert.equal(panelStyle.shadow, "none", "the large panel should have no added shadow frame");
    assert(panelStyle.image.includes("url("), "the existing theme artwork should remain visible behind the light veil");
    assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.config-header')).backgroundImage"), "none",
      "the header should not retain the old opaque gradient above its transparent color");
    await selectTheme(browser, "ink");
    await browser.evaluate("new Promise(resolve => setTimeout(resolve, 220))");
    await browser.screenshot(path.join(root, ".build", "v9.5-construction", "visual", "ink-zh.png"));
    const fixtureState = await browser.evaluate(`(() => ({
      effects: window.__v95RendererUiFixture.effectApiCalls,
      providerWrites: window.__v95RendererUiFixture.providerConfigWrites,
      promptWrites: window.__v95RendererUiFixture.promptWrites,
      legacyCalls: window.__v95RendererUiFixture.legacyLanguageCalls,
      reads: window.__v95RendererUiFixture.readCalls,
      uiWrites: window.__v95RendererUiFixture.uiPreferenceWrites,
      unexpected: window.__v95RendererUiFixture.unexpectedCalls,
      blockedNetwork: window.__v95RendererUiFixture.blockedNetwork,
      protectedSnapshot: window.__v95RendererUiFixture.protectedSnapshot(),
      providerSelections: window.__v95RendererUiFixture.providerSelectionCalls
    }))()`);
    assert.deepEqual(fixtureState.effects, [], "theme and settings browsing must not call game/action/letter effect APIs");
    assert.deepEqual(fixtureState.providerWrites, [], "UI language changes must not save provider configuration");
    assert.deepEqual(fixtureState.promptWrites, [], "UI language changes must not write prompt settings");
    assert.deepEqual(fixtureState.legacyCalls, [], "the new UI language control must not call the legacy language API");
    assert(fixtureState.uiWrites.some(write => write.method === "saveUiPresentationEnabled" && write.value === true),
      "the presentation preference should use its dedicated setting API");
    assert(fixtureState.uiWrites.some(write => write.method === "saveUiLanguage" && write.value === "en-US")
      && fixtureState.uiWrites.some(write => write.method === "saveUiLanguage" && write.value === "zh-CN"),
    "both UI locales should use the isolated UI-language setting API");
    assert.deepEqual(fixtureState.unexpected, [], "every API used by the production entry should have an explicit safe mock");
    assert.deepEqual(fixtureState.blockedNetwork, [], "the production entry must not attempt external requests");
    assert.equal(fixtureState.protectedSnapshot, protectedBefore, "provider, prompt and legacy-language configuration stays unchanged");
    assert(fixtureState.providerSelections.length > 0 && fixtureState.providerSelections.every(value => value === "player2"),
      "startup provider selection remains its initial mock default");
    assert(browser.requests.every(url => new URL(url).origin === origin || url.startsWith("data:image/")), "the production page should load only local static assets or bundled inline images");
    assert.deepEqual(browser.errors, [], "the production bundle should boot without runtime exceptions");
    assert.deepEqual(browser.consoleErrors, [], "the production renderer should not log console errors");
    assert.deepEqual(browser.failedRequests, [], "the production entry should load all local assets successfully");
    process.stdout.write("V9.5 production renderer UI: PASS (one Chrome, anonymous preload mocks)\n");
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { mockPreloadSource };
