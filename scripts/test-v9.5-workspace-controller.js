"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function importSource(relativePath) {
  return import(pathToFileURL(path.resolve(__dirname, "..", relativePath)).href);
}

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function makeContext(id = "a", epoch = 1) {
  return {
    campaignTag: `campaign-${id}`,
    ownerTag: `owner-${id}`,
    conversationTag: `conversation-${id}`,
    conversationEpoch: epoch,
    isActive: true
  };
}

function makeRuntime() {
  let context = makeContext();
  const listeners = new Set();
  let language = "en-US";
  return {
    getContext: () => context,
    syncContext: async () => context,
    subscribeContext(listener) {
      listeners.add(listener);
      listener(context);
      return () => listeners.delete(listener);
    },
    setContext(value) {
      context = value;
      for (const listener of Array.from(listeners)) listener(context);
    },
    setLanguage(value) { language = value; },
    getPreferences: () => ({ uiLanguage: "en-US", promptLanguage: "zh-CN", gameLanguage: "unknown" }),
    t: (key, params = {}) => {
      const labels = language === "en-US" ? {
        "legacyKnowledge.kinds.trait": "Trait",
        "workspace.knowledgeDirection": `${params.owner} → ${params.target}`,
        "workspace.events.warStarted": "War started"
      } : {
        "legacyKnowledge.kinds.trait": "特质",
        "workspace.knowledgeDirection": `${params.owner} → ${params.target}`,
        "workspace.events.warStarted": "战争开始"
      };
      return labels[key] || key;
    }
  };
}

async function main() {
  const [{ createWorkspaceController }, { projectDomainRecord }] = await Promise.all([
    importSource("src/app/renderer/v95/containers/workspace-controller.js"),
    importSource("src/app/renderer/v95/adapters/domain-adapters.js")
  ]);
  const runtime = makeRuntime();
  const knowledgeScope = { conversationId: "conversation-private", campaignToken: "campaign-private", sourceSnapshotId: "source-private" };
  const entries = [
    { type: "message", id: 10, role: "assistant", name: "甲", content: "对话事实", datetime: "867.1.2", streamStatus: "READY", privatePath: "C:\\private\\file" },
    { type: "action-approval", id: 11, datetime: "867.1.3", action: { actionId: "standard.negotiate", actionTitle: "和议", targetCharacterName: "乙" }, lifecycle: { status: "ACKNOWLEDGED" }, apiKey: "SECRET_PROVIDER_KEY" },
    { type: "action-feedback", id: 12, datetime: "867.1.4", feedbacks: [{ actionId: "standard.give_gold", lifecycle: { status: "CONFIRMED" } }] }
  ];
  const summaryData = { summaries: [{ ownerId: 21, counterpartId: 22, ownerName: "玩家", characterName: "甲", summaries: [
    { legacyBindingId: "legacy-summary:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", title: "旧摘要", content: "保留的摘要正文", createdAt: "867.1.1", privatePath: "C:\\private" }
  ] }, { ownerId: 23, counterpartId: 24, ownerName: "另一位玩家", characterName: "乙", summaries: [
    { legacyBindingId: "legacy-summary:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", content: "另一Pair的摘要" }
  ] }] };
  let knowledgeFacts = [{ factKey: "trait_brave", factType: "TRAIT", value: "公开特质", status: "AUTO_DISCLOSED", rawPath: "C:\\private" }];
  const worldlineData = { annualDelta: [{ id: "war-start:17:867.1.1", type: "WAR_STARTED", detail: "已记录的世界事实", date: "867.1.1", actors: [{ displayName: "乙" }], reconciliationStatus: "CONFIRMED_BY_GAMESTATE" }] };
  const letterData = { letters: [{ letterId: "letter-one", characterName: "甲", responseStatus: "sent", responseContent: "信件内容", createdAt: "867.1.2", deliveryStatus: "DELIVERED" }] };
  let writeCalls = 0;
  let apiReadCalls = 0;
  let diagnosticsStatusReads = 0;
  let usageReport = {
    filePath: "C:\\private\\usage-analytics.json",
    total: { totalTokens: 999999, estimatedPromptTokens: 888888 },
    recent: [{
      isUsageRecord: true,
      usageEstimated: false,
      providerUsage: {
        native: { inputTokens: 21, outputTokens: 8, totalTokens: 29 },
        estimated: { inputTokens: 999, outputTokens: 888 },
        provenance: { status: "REPORTED", cacheStatus: "REPORTED_POSITIVE" }
      },
      actualStablePrefixTokens: 777777,
      apiKey: "SECRET_PROVIDER_KEY"
    }]
  };
  let nextEntryRead = null;
  const apis = {
    conversationAPI: {
      getConversationEntries: () => {
        apiReadCalls++;
        if (!nextEntryRead) return Promise.resolve(entries);
        const pending = nextEntryRead;
        nextEntryRead = null;
        pending.started();
        return pending.read.promise;
      },
      getSummariesDashboardData: async () => { apiReadCalls++; return summaryData; },
      approveActions: async () => { writeCalls++; }
    },
    characterKnowledgeAPI: {
      getConversationView: async () => {
        apiReadCalls++;
        return { available: true, scope: knowledgeScope,
          participants: [{ isPlayer: true, runtimeId: "1" }, { isPlayer: false, runtimeId: "2", displayName: "甲" }] };
      },
      getOwnerView: async () => { apiReadCalls++; return { available: true,
        scope: { ...knowledgeScope, ownerRuntimeId: "2" }, owner: { runtimeId: "2", displayName: "甲·Owner" },
        targets: [{ runtimeId: "3", displayName: "乙" }] }; },
      getTargetView: async () => { apiReadCalls++; return { available: true,
        scope: { ...knowledgeScope, ownerRuntimeId: "2", targetRuntimeId: "3" },
        owner: { runtimeId: "2", displayName: "错误Owner" },
        target: { runtimeId: "3", displayName: "乙·Target" }, facts: knowledgeFacts }; },
      setManualStatus: async () => { writeCalls++; }
    },
    worldlineAPI: {
      getAnnualDelta: async () => { apiReadCalls++; return worldlineData; },
      mutateCanon: async () => { writeCalls++; }
    },
    lettersAPI: {
      getStatuses: async () => { apiReadCalls++; return letterData; },
      clearPending: async () => { writeCalls++; }
    },
    usageAPI: {
      getReport: async () => { apiReadCalls++; return usageReport; },
      clear: async () => { writeCalls++; }
    },
    providerDiagnosticsAPI: {
      getStatus: async () => { diagnosticsStatusReads++; return { success: true, actualStablePrefixTokens: 777777 }; }
    }
  };
  const controller = createWorkspaceController({ runtime, apis });
  assert.deepEqual(Object.keys(controller).sort(), ["dispose", "load"], "controller exposes only read lifecycle methods");

  const kinds = ["conversation-feed", "memory-list", "knowledge-facts", "worldline-timeline", "letter-list", "action-activity", "provider-diagnostics", "settings-section"];
  const projected = {};
  for (const kind of kinds) {
    const result = await controller.load(kind);
    assert.equal(result.committed, true, `${kind} read commits in the current context`);
    assert.equal(result.errorCode, null, `${kind} read has no error`);
    assert.ok(Array.isArray(result.records), `${kind} returns projected records`);
    assert.ok(result.records.length > 0, `${kind} fixture is present`);
    projected[kind] = result.records;
    for (const record of result.records) {
      assert.ok(projectDomainRecord(kind, record, { id: record.id, t: runtime.t }), `${kind} record passes its domain adapter`);
    }
  }
  assert.equal(projected["conversation-feed"][0].text, "对话事实", "conversation text remains source data");
  assert.equal(projected["memory-list"][0].summary, "保留的摘要正文", "summary text remains source data");
  assert.notEqual(projected["memory-list"][0].id, projected["memory-list"][1].id, "the same legacy binding key stays isolated by owner and counterpart pair");
  assert.notEqual(projected["memory-list"][1].title, "23", "numeric character IDs are never presented as summary titles");
  assert.equal(projected["knowledge-facts"][0].factText, "Trait: 公开特质", "knowledge values retain their authorized fact text");
  assert.equal(projected["knowledge-facts"][0].factValue, "公开特质", "the raw authorized fact value remains available for language re-projection");
  assert.equal(projected["knowledge-facts"][0].uiFactKindKey, "legacyKnowledge.kinds.trait", "knowledge fact kind remains a semantic translation key");
  assert.equal(projected["knowledge-facts"][0].title, "甲·Owner → 乙·Target", "knowledge title uses authorized owner-to-target names");
  assert.deepEqual(projected["knowledge-facts"][0].uiTitleParams, { owner: "甲·Owner", target: "乙·Target" }, "knowledge translation metadata preserves the directional names");
  assert.equal(projected["worldline-timeline"][0].description, "已记录的世界事实", "worldline fact text is retained");
  assert.equal(projected["worldline-timeline"][0].uiTitleKey, "workspace.events.warStarted", "worldline title maps a recognized event type");
  assert.equal(projected["worldline-timeline"][0].title, "War started", "worldline label is translated without translating event detail");
  assert.equal(projected["letter-list"][0].preview, "信件内容", "letter body is projected as source data");
  assert.equal(projected["action-activity"].length, 2, "action approval and feedback states are projected");
  assert.deepEqual(projected["provider-diagnostics"], [
    { id: "provider-native-total", metricKey: "native", value: 29, unit: "tokens", estimateKind: "native" }
  ], "only the canonical provider-reported total token field is labeled native");
  assert.equal(projected["settings-section"].length, 3, "language settings stay read-only records");
  assert.equal(diagnosticsStatusReads, 0, "local stable-prefix diagnostics are never read as provider usage");
  assert.equal(writeCalls, 0, "read-only workspace loads never invoke supplied write APIs");
  const safeJson = JSON.stringify(projected);
  assert.ok(!safeJson.includes("SECRET_PROVIDER_KEY"), "provider secrets are not projected");
  assert.ok(!safeJson.includes("C:\\\\private"), "local paths are not projected");
  assert.ok(!safeJson.includes("777777"), "local stable-prefix token counts are not projected");
  assert.ok(!safeJson.includes("999999"), "aggregated report totals are not mistaken for a current native report");

  const identityOf = (records, predicate) => records.find(predicate)?.id;
  const stableIds = {
    conversation: identityOf(projected["conversation-feed"], record => record.text === "对话事实"),
    memory: identityOf(projected["memory-list"], record => record.summary === "保留的摘要正文"),
    knowledge: identityOf(projected["knowledge-facts"], record => record.factValue === "公开特质"),
    worldline: identityOf(projected["worldline-timeline"], record => record.description === "已记录的世界事实"),
    letter: identityOf(projected["letter-list"], record => record.preview === "信件内容"),
    approval: identityOf(projected["action-activity"], record => record.actionName === "和议"),
    feedback: identityOf(projected["action-activity"], record => record.status === "CONFIRMED")
  };
  entries.unshift({ type: "message", id: 9, role: "system", content: "前置消息", datetime: "867.1.0" });
  entries.unshift({ type: "action-feedback", id: 8, datetime: "867.1.0", feedbacks: [{ actionId: "standard.earlier", lifecycle: { status: "ACKNOWLEDGED" } }] });
  summaryData.summaries[0].summaries.unshift({
    legacyBindingId: "legacy-summary:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", content: "新摘要"
  });
  knowledgeFacts.unshift({ factKey: "trait_generous", factType: "TRAIT", value: "新事实", status: "UNKNOWN" });
  worldlineData.annualDelta.unshift({ id: "war-start:18:867.1.2", type: "WAR_STARTED", detail: "新世界事实", date: "867.1.2", actors: [] });
  worldlineData.annualDelta.push({ id: "future:19:867.1.3", type: "toString", detail: "未知世界事实", date: "867.1.3", actors: [] });
  letterData.letters.unshift({ letterId: "letter-two", characterName: "乙", responseStatus: "sent", responseContent: "新信件", createdAt: "867.1.3" });
  const reloaded = {};
  for (const kind of kinds) reloaded[kind] = (await controller.load(kind)).records;
  assert.equal(identityOf(reloaded["conversation-feed"], record => record.text === "对话事实"), stableIds.conversation, "message IDs remain tied to source entry IDs after prepends");
  assert.equal(identityOf(reloaded["memory-list"], record => record.summary === "保留的摘要正文"), stableIds.memory, "summary IDs remain tied to pair and legacy binding ID after prepends");
  assert.equal(identityOf(reloaded["knowledge-facts"], record => record.factValue === "公开特质"), stableIds.knowledge, "knowledge IDs remain tied to owner, target, and fact key after prepends");
  assert.equal(identityOf(reloaded["worldline-timeline"], record => record.description === "已记录的世界事实"), stableIds.worldline, "worldline IDs remain tied to source event IDs after prepends");
  assert.equal(reloaded["worldline-timeline"].find(record => record.description === "未知世界事实")?.uiTitleKey, "workspace.worldlineEvent", "unrecognized event types use the generic key rather than inherited object properties");
  assert.equal(identityOf(reloaded["letter-list"], record => record.preview === "信件内容"), stableIds.letter, "letter IDs remain tied to source letter IDs after prepends");
  assert.equal(identityOf(reloaded["action-activity"], record => record.actionName === "和议"), stableIds.approval, "approval IDs remain tied to entry and action IDs after prepends");
  assert.equal(identityOf(reloaded["action-activity"], record => record.status === "CONFIRMED"), stableIds.feedback, "feedback IDs remain tied to entry and action IDs after prepends");
  const readsBeforeLanguageProjection = apiReadCalls;
  runtime.setLanguage("zh-CN");
  const localizedKnowledge = projectDomainRecord("knowledge-facts", projected["knowledge-facts"][0], {
    id: projected["knowledge-facts"][0].id, t: runtime.t
  });
  const localizedWorldline = projectDomainRecord("worldline-timeline", projected["worldline-timeline"][0], {
    id: projected["worldline-timeline"][0].id, t: runtime.t
  });
  assert.equal(localizedKnowledge.title, "甲·Owner → 乙·Target", "knowledge direction is re-projected from its local semantic key");
  assert.equal(localizedKnowledge.text, "特质: 公开特质", "only the fixed fact-kind label changes; the authorized fact value remains verbatim");
  assert.equal(localizedWorldline.title, "战争开始", "worldline title is re-projected from its local event key");
  assert.equal(localizedWorldline.text, "已记录的世界事实", "event detail remains verbatim during language re-projection");
  assert.equal(apiReadCalls, readsBeforeLanguageProjection, "language re-projection uses cached records without another IPC read");

  usageReport = { recent: [{
    isUsageRecord: true,
    usageEstimated: false,
    providerUsage: {
      native: { totalTokens: 700 },
      provenance: { status: "PARTIAL", providerUsageShape: "gemini_metadata", fieldSources: { totalTokens: "DERIVED" } }
    }
  }] };
  const unknown = await controller.load("provider-diagnostics");
  assert.deepEqual(unknown.records, [
    { id: "provider-usage-unknown", metricKey: "unknown", value: null, unit: "tokens", estimateKind: "unknown" }
  ], "derived native-looking usage remains unknown instead of becoming zero or native");

  const read = deferred();
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  nextEntryRead = { read, started: startedResolve };
  const staleLoad = controller.load("conversation-feed");
  await started;
  runtime.setContext(makeContext("b", 2));
  read.resolve(entries);
  const staleResult = await staleLoad;
  assert.equal(staleResult.committed, false, "a read from the prior context cannot commit after a scope change");
  assert.deepEqual(staleResult.records, [], "stale records are discarded");
  assert.equal(staleResult.isCurrent(), false, "the old read is marked out of scope");
  assert.equal(writeCalls, 0, "scope changes do not trigger a business write");

  controller.dispose();
  assert.equal((await controller.load("conversation-feed")).committed, false, "disposed controller rejects subsequent reads");
  console.log("V9.5 workspace controller projection: PASS (8 projections, stable source identities, semantic UI keys, native usage provenance, context cancellation, no writes)");
}

main().catch(error => {
  console.error("V9.5 workspace controller projection: FAIL", error);
  process.exitCode = 1;
});
