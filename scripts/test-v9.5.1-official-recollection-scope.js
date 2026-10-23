"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

function createHarness(initialContext = {}) {
  let context = {
    campaignTag: "campaign-a",
    ownerTag: "owner-a",
    conversationTag: "conversation-a",
    conversationEpoch: 1,
    isActive: true,
    ...initialContext
  };
  const contextListeners = new Set();
  const worldlineListeners = new Set();
  const calls = [];
  let writeCalls = 0;
  const runtime = {
    getContext: () => context,
    syncContext: async () => context,
    subscribeContext(listener) {
      contextListeners.add(listener);
      listener(context);
      return () => contextListeners.delete(listener);
    },
    t() { assert.fail("official recollection reader must not translate source text"); }
  };
  const worldlineApi = {
    getOfficialRecollection(responderId) {
      const request = deferred();
      calls.push({ responderId, request });
      return request.promise;
    },
    onUpdated(listener) {
      worldlineListeners.add(listener);
      return () => worldlineListeners.delete(listener);
    },
    setRecallSettings() { writeCalls += 1; },
    mutateCanon() { writeCalls += 1; },
    getWriteCalls: () => writeCalls
  };
  return {
    runtime,
    worldlineApi,
    calls,
    contextListeners,
    worldlineListeners,
    setContext(next) {
      context = next;
      for (const listener of Array.from(contextListeners)) listener(context);
    },
    updateSnapshot(payload) {
      for (const listener of Array.from(worldlineListeners)) listener(payload);
    }
  };
}

function officialResponse(renderedSummary, responderId) {
  return {
    status: "READY",
    ownerCharacterId: responderId,
    sourceType: "CK3_OFFICIAL_RECOLLECTION",
    entries: [{ renderedText: renderedSummary }],
    renderedSummary,
    gameDate: "1171.9.20"
  };
}

(async () => {
  const { createOfficialRecollectionReader } = await import(pathToFileURL(path.resolve(
    __dirname, "../src/app/renderer/v95/state/official-recollection-reader.js")));

  // CK3-localized source text remains byte-for-byte identical under either UI language.
  for (const uiLanguage of ["zh-CN", "en-US"]) {
    for (const sourceText of [
      "【CK3 官方人物追忆】\n1171年秋，阿梅莉亚在宫廷中听见此事。\n原话：‘不可忘却。’",
      "【CK3 Character Memories】\nIn autumn 1171, Amelia heard the account at court.\nOriginal words: ‘Do not forget.’"
    ]) {
      const harness = createHarness();
      harness.runtime.uiLanguage = uiLanguage;
      const reader = createOfficialRecollectionReader(harness);
      const response = officialResponse(sourceText, "42");
      const pending = reader.refresh("42");
      await waitFor(() => harness.calls.length === 1, "official recollection read should start");
      harness.runtime.uiLanguage = uiLanguage === "zh-CN" ? "en-US" : "zh-CN";
      harness.calls[0].request.resolve(response);
      await pending;
      assert.equal(reader.getState().status, "ready");
      assert.strictEqual(reader.getState().value, response, "the original Main response is passed through unchanged");
      assert.equal(reader.getState().value.renderedSummary, sourceText, `source text stays unchanged with ${uiLanguage}`);
      assert.equal(reader.getState().contextVersion, JSON.stringify(harness.runtime.getContext()));
      assert.equal(harness.worldlineApi.getWriteCalls(), 0, "diagnostic reads must not perform writes");
      reader.dispose();
    }
  }

  // A responder switch supersedes the earlier request even when both share one conversation.
  {
    const harness = createHarness();
    const reader = createOfficialRecollectionReader(harness);
    const observedValues = [];
    reader.subscribe(state => observedValues.push(state.value?.renderedSummary || null));
    const oldRead = reader.refresh("101");
    await waitFor(() => harness.calls.length === 1, "responder A read should start");
    const newRead = reader.refresh("202");
    await waitFor(() => harness.calls.length === 2, "responder B read should start");
    const responseB = officialResponse("B responder text", "202");
    harness.calls[1].request.resolve(responseB);
    await newRead;
    harness.calls[0].request.resolve(officialResponse("A responder stale text", "101"));
    await oldRead;
    assert.strictEqual(reader.getState().value, responseB);
    assert.equal(observedValues.includes("A responder stale text"), false);
    assert.equal(reader.getStateFor("101", reader.getState().contextVersion).value, null,
      "render projection hides a previous responder before its effect runs");
    assert.equal(reader.getStateFor("202", "different-context-version").value, null,
      "render projection rejects state captured under a different context version");
    reader.setResponder("101");
    assert.equal(reader.getState().value, null, "setResponder synchronously clears the previous result");
    reader.dispose();
  }

  // Repeated refreshes of the same resource are latest-wins.
  {
    const harness = createHarness();
    const reader = createOfficialRecollectionReader(harness);
    const oldRead = reader.refresh("42");
    await waitFor(() => harness.calls.length === 1, "first refresh should start");
    const latestRead = reader.refresh("42");
    await waitFor(() => harness.calls.length === 2, "second refresh should start");
    const latestResponse = officialResponse("latest refresh", "42");
    harness.calls[1].request.resolve(latestResponse);
    await latestRead;
    harness.calls[0].request.resolve(officialResponse("late refresh", "42"));
    await oldRead;
    assert.strictEqual(reader.getState().value, latestResponse);
    reader.dispose();
  }

  // Every authoritative Main context dimension invalidates an in-flight result.
  for (const [field, nextValue] of [
    ["campaignTag", "campaign-b"],
    ["ownerTag", "owner-b"],
    ["conversationTag", "conversation-b"],
    ["conversationEpoch", 2],
    ["isActive", false]
  ]) {
    const harness = createHarness();
    const reader = createOfficialRecollectionReader(harness);
    const pending = reader.refresh("42");
    await waitFor(() => harness.calls.length === 1, `${field} read should start`);
    harness.setContext({ ...harness.runtime.getContext(), [field]: nextValue });
    await pending;
    harness.calls[0].request.resolve(officialResponse(`${field} stale text`, "42"));
    await Promise.resolve();
    assert.equal(reader.getState().value, null, `${field} change must clear old response text`);
    assert.equal(reader.getState().status, "stale");
    reader.dispose();
  }

  // A completed response is also cleared as soon as its Main context changes.
  {
    const harness = createHarness();
    const reader = createOfficialRecollectionReader(harness);
    const pending = reader.refresh("42");
    await waitFor(() => harness.calls.length === 1, "completed-scope read should start");
    harness.calls[0].request.resolve(officialResponse("previous conversation text", "42"));
    await pending;
    assert.notEqual(reader.getState().value, null);
    harness.setContext({ ...harness.runtime.getContext(), conversationTag: "conversation-b" });
    assert.equal(reader.getState().value, null, "completed text is cleared before the next scope renders");
    assert.equal(reader.getState().status, "stale");
    reader.dispose();
  }

  // A Main context change discovered by the post-read refresh drops the returned body.
  {
    const harness = createHarness();
    let syncCount = 0;
    harness.runtime.syncContext = async () => {
      syncCount += 1;
      return syncCount === 1 ? harness.runtime.getContext() : null;
    };
    const reader = createOfficialRecollectionReader(harness);
    const pending = reader.refresh("42");
    await waitFor(() => harness.calls.length === 1, "post-validated read should start");
    harness.calls[0].request.resolve(officialResponse("stale by fresh Main context", "42"));
    await pending;
    assert.equal(syncCount, 2, "Main context is freshly read before and after the body request");
    assert.equal(reader.getState().value, null);
    assert.equal(reader.getState().status, "stale");
    reader.dispose();
  }

  // Main's existing worldline update event invalidates the current checkpoint snapshot.
  {
    const harness = createHarness();
    const reader = createOfficialRecollectionReader(harness);
    const pending = reader.refresh("42");
    await waitFor(() => harness.calls.length === 1, "snapshot-bound read should start");
    harness.updateSnapshot({ checkpointId: "checkpoint-b", reason: "checkpoint_active" });
    await pending;
    harness.calls[0].request.resolve(officialResponse("old checkpoint text", "42"));
    await Promise.resolve();
    assert.equal(reader.getState().value, null);
    assert.equal(reader.getState().status, "stale");
    reader.dispose();
    assert.equal(harness.worldlineListeners.size, 0, "snapshot event subscription is removed on dispose");
  }

  // An inactive/unknown context never starts a read; absent snapshot events fail closed.
  {
    const harness = createHarness({ isActive: false });
    const reader = createOfficialRecollectionReader(harness);
    await reader.refresh("42");
    assert.equal(harness.calls.length, 0);
    assert.equal(reader.getState().value, null);
    reader.dispose();
  }
  {
    const harness = createHarness();
    harness.runtime.syncContext = async () => null;
    const reader = createOfficialRecollectionReader(harness);
    await reader.refresh("42");
    assert.equal(harness.calls.length, 0, "an unknown freshly-read Main context cannot authorize a read");
    assert.equal(reader.getState().value, null);
    assert.equal(reader.getState().status, "stale");
    reader.dispose();
  }
  {
    const harness = createHarness();
    delete harness.worldlineApi.onUpdated;
    const reader = createOfficialRecollectionReader(harness);
    await reader.refresh("42");
    assert.equal(harness.calls.length, 0, "unknown snapshot invalidation cannot be treated as safe");
    assert.equal(reader.getState().errorCode, "IPC_UNAVAILABLE");
    reader.dispose();
  }

  // The explicit timeout drops the body and does not retry the read.
  {
    const harness = createHarness();
    const reader = createOfficialRecollectionReader({ ...harness, timeoutMs: 1 });
    const initialRead = reader.refresh("42");
    await waitFor(() => harness.calls.length === 1, "initial timed-read fixture should start");
    harness.calls[0].request.resolve(officialResponse("previous ready text", "42"));
    await initialRead;
    assert.notEqual(reader.getState().value, null);
    const pending = reader.refresh("42");
    await waitFor(() => harness.calls.length === 2, "timed read should start");
    assert.equal(reader.getState().value, null, "refresh clears old text before waiting");
    await pending;
    assert.equal(reader.getState().status, "error");
    assert.equal(reader.getState().errorCode, "IPC_UNAVAILABLE");
    assert.equal(reader.getState().timedOut, true, "timeout is distinguishable without inventing an error code");
    assert.equal(reader.getState().value, null);
    harness.calls[1].request.resolve(officialResponse("late text after timeout", "42"));
    await Promise.resolve();
    assert.equal(harness.calls.length, 2, "timeout must never replay the Main read");
    assert.equal(reader.getState().value, null, "late timed-out content is discarded");
    reader.dispose();
  }

  // IPC rejection exposes only a safe code and never retains an older body.
  {
    const harness = createHarness();
    const reader = createOfficialRecollectionReader(harness);
    const initialRead = reader.refresh("42");
    await waitFor(() => harness.calls.length === 1, "initial rejection fixture should start");
    harness.calls[0].request.resolve(officialResponse("previous ready text", "42"));
    await initialRead;
    const pending = reader.refresh("42");
    await waitFor(() => harness.calls.length === 2, "rejected read should start");
    assert.equal(reader.getState().value, null, "failed refresh cannot retain prior body text");
    harness.calls[1].request.reject(new Error("secret payload details"));
    await pending;
    assert.equal(reader.getState().status, "error");
    assert.equal(reader.getState().errorCode, "UNKNOWN_ERROR");
    assert.equal(reader.getState().value, null);
    assert.equal(JSON.stringify(reader.getState()).includes("secret payload details"), false);
    reader.dispose();
  }

  // Explicit cancellation and unmount both prevent late results and release subscriptions.
  {
    const harness = createHarness();
    const reader = createOfficialRecollectionReader(harness);
    let notifications = 0;
    reader.subscribe(() => { notifications += 1; });
    const pending = reader.refresh("42");
    await waitFor(() => harness.calls.length === 1, "cancelled read should start");
    reader.cancel();
    await pending;
    assert.equal(reader.getState().value, null);
    reader.dispose();
    const notificationCount = notifications;
    harness.calls[0].request.resolve(officialResponse("cancelled text", "42"));
    await Promise.resolve();
    assert.equal(notifications, notificationCount, "disposed readers never notify an unmounted view");
    assert.equal(harness.contextListeners.size, 0, "context subscription is removed on dispose");
    assert.equal(harness.worldlineListeners.size, 0, "snapshot subscription is removed on dispose");
  }

  console.log("V9.5.1 official recollection scope: PASS (fresh Main context, timeout, four source/UI language combinations, responder projection, context/checkpoint races, latest-wins, rejection, cancellation and disposal)");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
