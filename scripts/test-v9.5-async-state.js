const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function importSource(relativePath) {
  return import(pathToFileURL(path.resolve(__dirname, "..", relativePath)).href);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function assertSafeError(error, expectedCode) {
  assert.equal(error.code, expectedCode);
  assert.equal(error.message, expectedCode);
  assert.doesNotMatch(error.message, /C:\\|api.?key|secret/i);
  return true;
}

async function main() {
  const [contextModule, storeModule, controllerModule, ipcModule, subscriptionsModule, errorsModule] = await Promise.all([
    importSource("src/app/renderer/v95/state/context-epoch.js"),
    importSource("src/app/renderer/v95/state/scoped-resource-store.js"),
    importSource("src/app/renderer/v95/state/request-controller.js"),
    importSource("src/app/renderer/v95/ipc/renderer-ipc-client.js"),
    importSource("src/app/renderer/v95/ipc/event-subscriptions.js"),
    importSource("src/app/renderer/v95/contracts/errors.v1.js")
  ]);
  const { createContextEpoch } = contextModule;
  const { createScopedResourceStore } = storeModule;
  const { createRequestController } = controllerModule;
  const { createRendererIpcClient } = ipcModule;
  const { createEventSubscriptions } = subscriptionsModule;
  const { normalizeErrorCode } = errorsModule;

  function createRig() {
    const contextEpoch = createContextEpoch();
    contextEpoch.setContext({ campaignKey: "campaign-a", conversationKey: "conversation-a", viewKey: "owner-a:responder-a" });
    const resourceStore = createScopedResourceStore(contextEpoch);
    resourceStore.activateScope("campaign-a/owner-a/responder-a");
    return { contextEpoch, resourceStore, controller: createRequestController({ contextEpoch, resourceStore }) };
  }

  const scopeTransitions = [
    {
      name: "campaign",
      change: context => context.setContext({ campaignKey: "campaign-b", conversationKey: "conversation-a", viewKey: "owner-a:responder-a" }),
      nextScope: "campaign-b/owner-a/responder-a"
    },
    {
      name: "conversation",
      change: context => context.setContext({ campaignKey: "campaign-a", conversationKey: "conversation-b", viewKey: "owner-a:responder-a" }),
      nextScope: "campaign-a/owner-a/responder-a/conversation-b"
    },
    {
      name: "owner-or-responder-view",
      change: context => context.setContext({ campaignKey: "campaign-a", conversationKey: "conversation-a", viewKey: "owner-b:responder-b" }),
      nextScope: "campaign-a/owner-b/responder-b"
    },
    {
      name: "conversation-reset",
      change: context => context.resetConversation(),
      nextScope: "campaign-a/owner-a/responder-a/reset"
    }
  ];

  for (const transition of scopeTransitions) {
    const { contextEpoch, resourceStore, controller } = createRig();
    let resolveOld;
    const oldRead = controller.read("summary", () => new Promise(resolve => { resolveOld = resolve; }));
    await Promise.resolve();
    transition.change(contextEpoch);
    resourceStore.activateScope(transition.nextScope);
    assert.equal(resourceStore.get("summary"), undefined, `${transition.name}: previous scope data must be cleared`);
    resolveOld({ source: "old-scope" });
    const result = await oldRead;
    assert.deepEqual(result, { committed: false, value: undefined, errorCode: "STALE_CONTEXT" });
    assert.equal(resourceStore.get("summary"), undefined, `${transition.name}: stale completion must not repopulate data`);
    controller.dispose();
  }

  {
    const { contextEpoch, resourceStore, controller } = createRig();
    const firstTicket = resourceStore.beginRead("sequenced");
    const secondTicket = resourceStore.beginRead("sequenced");
    assert.equal(resourceStore.commitRead(secondTicket, "latest"), true);
    assert.equal(resourceStore.commitRead(firstTicket, "stale"), false, "older same-scope sequence must not commit");
    assert.equal(resourceStore.get("sequenced").data, "latest");

    const timedOutRead = deferred();
    const oldRead = controller.read("timed-out", () => timedOutRead.promise);
    await Promise.resolve();
    contextEpoch.advanceView();
    resourceStore.activateScope("campaign-a/owner-a/responder-a/new-view");
    timedOutRead.reject(new Error("C:\\private\\timeout details"));
    assert.deepEqual(await oldRead, { committed: false, value: undefined, errorCode: "STALE_CONTEXT" });
    assert.equal(resourceStore.get("timed-out"), undefined, "late timeout error must not write into the new view");
    controller.dispose();
  }

  {
    const { resourceStore, controller } = createRig();
    const firstDeferred = deferred();
    const secondDeferred = deferred();
    const firstRead = controller.read("history", () => firstDeferred.promise);
    await Promise.resolve();
    const secondRead = controller.read("history", () => secondDeferred.promise);
    await Promise.resolve();
    assert.equal((await firstRead).errorCode, "REQUEST_CANCELLED");
    assert.equal(controller.activeCount(), 1, "late finally from the first read must not remove the second read");
    secondDeferred.resolve({ marker: "newer" });
    assert.deepEqual(await secondRead, { committed: true, value: { marker: "newer" }, errorCode: null });
    firstDeferred.resolve({ marker: "older" });
    await Promise.resolve();
    assert.deepEqual(resourceStore.get("history").data, { marker: "newer" }, "reverse completion must retain the latest same-scope value");
    controller.dispose();
  }

  {
    const { controller } = createRig();
    let operationSignal;
    const pending = controller.read("unmounted", ({ signal }) => {
      operationSignal = signal;
      return new Promise(() => {});
    });
    await Promise.resolve();
    controller.dispose();
    assert.equal(operationSignal.aborted, true, "unmount disposal must abort active reads");
    assert.equal((await pending).errorCode, "REQUEST_CANCELLED");
    assert.equal(controller.activeCount(), 0);
  }

  {
    const timeoutClient = createRendererIpcClient({
      ipcMap: { neverResponds: () => new Promise(() => {}) },
      defaultTimeoutMs: 5
    });
    await assert.rejects(timeoutClient.read("neverResponds", null), error => assertSafeError(error, "IPC_UNAVAILABLE"));

    const rawErrorClient = createRendererIpcClient({
      ipcMap: { throwsRawError: () => { throw new Error("C:\\Users\\private\\provider-key=secret"); } }
    });
    await assert.rejects(rawErrorClient.read("throwsRawError", null), error => assertSafeError(error, "UNKNOWN_ERROR"));
    assert.equal(normalizeErrorCode({ code: "source_changed", message: "C:\\private\\path" }), "SOURCE_REVOKED");
    assert.equal(normalizeErrorCode(new Error("C:\\private\\path")), "UNKNOWN_ERROR");
  }

  {
    const subscriptions = createEventSubscriptions();
    let registerCount = 0;
    let unsubscribeCount = 0;
    let dispatch;
    let firstEvents = 0;
    let secondEvents = 0;
    const register = listener => {
      registerCount += 1;
      dispatch = listener;
      return () => { unsubscribeCount += 1; };
    };
    const unmountFirst = subscriptions.subscribe("campaign-events", register, () => { firstEvents += 1; });
    const unmountSecond = subscriptions.subscribe("campaign-events", register, () => { secondEvents += 1; });
    assert.equal(registerCount, 1, "double mount must share one underlying listener");
    dispatch({ event: "update" });
    assert.equal(firstEvents, 1);
    assert.equal(secondEvents, 1);
    unmountFirst();
    unmountFirst();
    assert.equal(unsubscribeCount, 0, "one remaining subscriber keeps the underlying listener active");
    unmountSecond();
    assert.equal(unsubscribeCount, 1, "last unmount must call the actual unsubscribe");
    subscriptions.dispose();
    assert.equal(unsubscribeCount, 1);
    subscriptions.subscribe("second-event", register, () => {});
    subscriptions.dispose();
    assert.equal(unsubscribeCount, 2, "disposing an active subscription must call the actual unsubscribe");
  }

  {
    const pendingResponse = deferred();
    let writeCalls = 0;
    let handlerArgumentCount = 0;
    const client = createRendererIpcClient({
      ipcMap: {
        write: (...handlerArgs) => {
          handlerArgumentCount = handlerArgs.length;
          writeCalls += 1;
          return pendingResponse.promise;
        }
      }
    });
    const abortController = new AbortController();
    const operationKey = "v95-test-unknown-after-cancel";
    const firstWrite = client.write("write", { value: "one" }, { operationKey, signal: abortController.signal, timeoutMs: 1000 });
    assert.equal(writeCalls, 1);
    assert.equal(handlerArgumentCount, 1, "renderer cancellation signal must not be forwarded to Main IPC");
    await assert.rejects(client.write("write", { value: "duplicate" }, { operationKey }), error => assertSafeError(error, "EFFECT_UNKNOWN"));
    abortController.abort();
    assert.deepEqual(await firstWrite, {
      status: "unknown",
      errorCode: "EFFECT_UNKNOWN",
      readbackRequired: true,
      receipt: { errorCode: "REQUEST_CANCELLED" }
    });
    assert.equal(client.getWriteStatus(operationKey).state, "unknown");
    pendingResponse.resolve({ status: "acknowledged", success: true, receiptId: "receipt-1", error: "C:\\private\\path" });
    await Promise.resolve();
    const lateStatus = client.getWriteStatus(operationKey);
    assert.equal(lateStatus.state, "unknown");
    assert.equal(lateStatus.readbackRequired, true);
    assert.equal(lateStatus.receipt.receiptId, "receipt-1", "late backend receipt must be retained");
    assert.equal(Object.prototype.hasOwnProperty.call(lateStatus.receipt, "error"), false);
    await assert.rejects(client.write("write", {}, { operationKey }), error => assertSafeError(error, "EFFECT_UNKNOWN"));
    assert.equal(writeCalls, 1, "cancelled unknown write must not be reissued");
  }

  {
    const lateResponse = deferred();
    let writeCalls = 0;
    const client = createRendererIpcClient({
      ipcMap: { write: () => { writeCalls += 1; return lateResponse.promise; } }
    });
    const operationKey = "v95-test-unknown-after-timeout";
    const result = await client.write("write", {}, { operationKey, timeoutMs: 5 });
    assert.equal(result.errorCode, "EFFECT_UNKNOWN");
    assert.equal(result.readbackRequired, true);
    lateResponse.resolve({ success: true, receiptId: "timeout-receipt" });
    await Promise.resolve();
    assert.equal(client.getWriteStatus(operationKey).receipt.receiptId, "timeout-receipt");
    await assert.rejects(client.write("write", {}, { operationKey }), error => assertSafeError(error, "EFFECT_UNKNOWN"));
    assert.equal(writeCalls, 1, "timed out unknown write must not be reissued");
  }

  {
    let writeCalls = 0;
    const client = createRendererIpcClient({
      ipcMap: {
        write: () => {
          writeCalls += 1;
          return Promise.resolve({ status: "unknown", receiptId: "receipt-main-1", readbackRequired: true });
        }
      }
    });
    const operationKey = "v95-test-main-requires-readback";
    const result = await client.write("write", {}, { operationKey });
    assert.equal(result.errorCode, "EFFECT_UNKNOWN");
    assert.equal(result.readbackRequired, true);
    assert.equal(client.getWriteStatus(operationKey).receipt.receiptId, "receipt-main-1");
    await assert.rejects(client.write("write", {}, { operationKey }), error => assertSafeError(error, "EFFECT_UNKNOWN"));
    assert.equal(writeCalls, 1, "Main readback-required response must retain its lock and never replay");
  }

  {
    let writeCalls = 0;
    const client = createRendererIpcClient({
      ipcMap: { write: () => { writeCalls += 1; return Promise.resolve({ success: true, receiptId: `receipt-${writeCalls}` }); } }
    });
    const preAborted = new AbortController();
    preAborted.abort();
    await assert.rejects(client.write("write", {}, { operationKey: "v95-test-pre-aborted", signal: preAborted.signal }), error => assertSafeError(error, "REQUEST_CANCELLED"));
    assert.equal(client.getWriteStatus("v95-test-pre-aborted").state, "not_started");

    const oldestKey = "v95-test-completed-oldest";
    await client.write("write", {}, { operationKey: oldestKey });
    await assert.rejects(client.write("write", {}, { operationKey: oldestKey }), error => assertSafeError(error, "VALIDATION_ERROR"));
    for (let index = 0; index < 128; index += 1) {
      await client.write("write", {}, { operationKey: `v95-test-completed-${index}` });
    }
    assert.equal(client.getWriteStatus(oldestKey).state, "not_started", "completed dedupe cache must evict its oldest entry at the bound");
    await client.write("write", {}, { operationKey: oldestKey });
    assert.equal(writeCalls, 130);
  }
  console.log("V9.5 async state: PASS (epochs, latest reads, unsubscribe, bounded receipts, no unknown-effect replay)");
}

main().catch(error => {
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN_ERROR";
  process.stderr.write(`V9.5 async-state regression failed: ${code}\n`);
  process.exitCode = 1;
});
