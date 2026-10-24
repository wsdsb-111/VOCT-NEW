"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");

function importSource(relativePath) {
  return import(pathToFileURL(path.resolve(root, relativePath)).href);
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

function sameDependencies(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));
}

function createHookHarness(createComponent, initialProps) {
  const hooks = [];
  let cursor = 0;
  let pendingEffects = [];
  let props = initialProps;
  let disposed = false;
  let postUnmountUpdates = 0;
  let tree;

  const React = {
    useState(initialValue) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { kind: "state", value: typeof initialValue === "function" ? initialValue() : initialValue };
      const hook = hooks[index];
      return [hook.value, nextValue => {
        if (disposed) {
          postUnmountUpdates++;
          return;
        }
        hook.value = typeof nextValue === "function" ? nextValue(hook.value) : nextValue;
      }];
    },
    useRef(initialValue) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { kind: "ref", current: initialValue };
      return hooks[index];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { kind: "effect", dependencies: null, cleanup: null };
      const hook = hooks[index];
      if (!sameDependencies(hook.dependencies, dependencies)) pendingEffects.push({ index, effect, dependencies });
    }
  };
  const jsxRuntime = {
    jsx: (type, elementProps) => ({ type, props: elementProps || {} }),
    jsxs: (type, elementProps) => ({ type, props: elementProps || {} })
  };
  const Component = createComponent(React, jsxRuntime);

  function render(nextProps = props) {
    assert.equal(disposed, false, "cannot render an unmounted component");
    props = nextProps;
    cursor = 0;
    pendingEffects = [];
    tree = Component(props);
    const effects = pendingEffects;
    pendingEffects = [];
    for (const item of effects) {
      const hook = hooks[item.index];
      hook.cleanup?.();
      hook.dependencies = item.dependencies;
      hook.cleanup = item.effect() || null;
    }
    return tree;
  }

  function unmount() {
    if (disposed) return;
    disposed = true;
    for (const hook of hooks) if (hook?.kind === "effect") hook.cleanup?.();
  }

  return { React, jsxRuntime, render, unmount, get postUnmountUpdates() { return postUnmountUpdates; } };
}

function nodeText(node) {
  if (node === null || node === undefined || node === false) return "";
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node.props ? nodeText(node.props.children) : "";
}

function findNode(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  return findNode(node.props?.children, predicate);
}

function findButton(tree, label) {
  const button = findNode(tree, node => node.type === "button" && nodeText(node).includes(label));
  assert.ok(button, `expected button containing ${label}`);
  return button;
}

function fixture(overrides = {}) {
  return {
    status: "DEGRADED",
    reasonCode: "OPTIONAL_CAPABILITY_MISSING",
    runtimeVersion: "9.6.0",
    modBaseVersion: "2.0.5",
    upstreamBaseVersion: "2.0.4",
    voctBridgeRevision: "r1",
    bridgeProtocol: { major: 1, minor: 0 },
    capabilities: {
      character_export: { revision: 1, supported: true },
      run_ack: { revision: 2, supported: false },
      action_readback: { revision: 1, supported: false },
      official_recollection_export: { revision: 1, supported: true }
    },
    features: {
      actions: { allowed: false, reasonCode: "OPTIONAL_CAPABILITY_MISSING", missing: ["run_ack", "C:\\private\\path"] },
      actionConfirmation: { allowed: false, reasonCode: "REQUIRED_CAPABILITY_MISSING", missing: ["action_readback"] },
      traits: { allowed: true, reasonCode: "FEATURE_CAPABILITIES_SUPPORTED", missing: [] },
      officialRecollection: { allowed: true, reasonCode: "FEATURE_CAPABILITIES_SUPPORTED", missing: [] }
    },
    sessionEvidence: {
      loadSessionSeen: true,
      helloSeen: true,
      helloBoundToCurrentSession: true,
      logIdentityKnown: true,
      generation: "private-session-generation"
    },
    channels: {
      debugLog: "UNKNOWN",
      clipboard: "OBSERVED",
      runFileAck: "OBSERVED",
      actionReadback: "UNKNOWN",
      letterReceipt: "UNAVAILABLE"
    },
    updatedAt: "2026-10-24T03:04:05.000Z",
    debugLogPath: "C:\\private\\debug.log",
    prompt: "private prompt text",
    errorStack: "private stack text",
    ...overrides
  };
}

function createView(module, props) {
  return createHookHarness((React, jsxRuntime) => module.createBridgeDiagnostics({ React, jsxRuntime }), props);
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

async function main() {
  const module = await importSource("src/app/renderer/bridge-diagnostics.js");
  assert.equal(module.default, module.createBridgeDiagnostics, "factory is available as named and default export");

  const serviceReasonCodes = [
    "BRIDGE_COMPATIBLE", "BRIDGE_NOT_VERIFIED", "CAPABILITY_NOT_DECLARED", "CAPABILITY_REVISION_UNSUPPORTED",
    "CAPABILITY_SUPPORTED", "FEATURE_CAPABILITIES_SUPPORTED", "HELLO_NOT_RECEIVED", "HELLO_NOT_VERIFIED",
    "HELLO_TIMEOUT", "HELLO_WAITING", "HELLO_LOAD_SESSION_MISMATCH", "LEGACY_UNVERIFIED", "LOAD_SESSION_INVALID",
    "LOG_ATTACHED", "LOG_CHANGED_DURING_READ", "LOG_IDENTITY_CHANGED", "LOG_IDENTITY_UNKNOWN", "LOG_LINE_TOO_LONG",
    "LOG_MISSING", "LOG_PATH_CHANGED", "LOG_PATH_UNAVAILABLE", "LOG_READ_FAILED", "LOG_REWRITTEN", "LOG_ROTATED",
    "LOG_TRUNCATED", "OPTIONAL_CAPABILITY_MISSING", "REQUIRED_CAPABILITY_MISSING", "REQUIRED_CAPABILITY_REVISION_UNSUPPORTED",
    "RUNTIME_MANIFEST_UNAVAILABLE", "SERVICE_STOPPED", "UNKNOWN_OPTIONAL_CAPABILITY_IGNORED", "UNKNOWN_REQUIRED_CAPABILITY",
    "UNSUPPORTED_PROTOCOL_OR_SCHEMA", "HELLO_TOO_LONG", "HELLO_DUPLICATE_MARKER", "HELLO_SEPARATOR_INVALID",
    "HELLO_FIELD_INVALID", "HELLO_FIELD_DUPLICATE", "HELLO_FIELD_ORDER_INVALID", "HELLO_FIELD_MISSING",
    "HELLO_UNKNOWN_REQUIRED_FIELD", "HELLO_UNKNOWN_FIELD", "HELLO_OPTIONAL_FIELD_INVALID", "HELLO_SCHEMA_INVALID",
    "HELLO_PROTOCOL_INVALID", "HELLO_MOD_VERSION_INVALID", "HELLO_UPSTREAM_VERSION_INVALID", "HELLO_BRIDGE_REVISION_INVALID",
    "HELLO_LOAD_TOKEN_INVALID", "HELLO_CAPABILITIES_INVALID"
  ];
  for (const reasonCode of serviceReasonCodes) {
    assert.ok(module.BRIDGE_DIAGNOSTIC_REASON_CODES.includes(reasonCode), `${reasonCode} is whitelisted`);
  }
  for (const reasonCode of module.BRIDGE_DIAGNOSTIC_REASON_CODES) {
    for (const language of ["zh-CN", "en-US"]) {
      const phrase = module.bridgeReasonText(reasonCode, language);
      assert.equal(typeof phrase, "string", `${reasonCode} has ${language} copy`);
      if (reasonCode !== "UNKNOWN_REASON") {
        assert.notEqual(phrase, module.bridgeReasonText("UNKNOWN_REASON", language), `${reasonCode} has a specific ${language} phrase`);
      }
    }
  }
  assert.equal(module.bridgeReasonText("C:\\private\\stack", "en-US"), module.bridgeReasonText("UNKNOWN_REASON", "en-US"), "unknown codes use safe fallback copy");

  const originalWindow = globalThis.window;
  try {
    {
      const summary = module.buildDiagnosticSummary(fixture(), "en-US");
      assert.match(summary, /Runtime: V9\.6\.0/);
      assert.match(summary, /VOCT maintained local Mod base: 2\.0\.5/);
      assert.match(summary, /Official upstream base: 2\.0\.4/);
      assert.match(summary, /Capability character_export: revision=1; supported=true/);
      assert.match(summary, /Channel clipboard: OBSERVED/);
      assert.match(summary, /Hello bound to current session: true/);
      assert.doesNotMatch(summary, /C:\\private|private prompt|private stack|generation/);
      assert.doesNotMatch(summary, /C:\\private\\path/);

      const unboundSummary = module.buildDiagnosticSummary(fixture({ sessionEvidence: {
        loadSessionSeen: true,
        helloSeen: true,
        helloBoundToCurrentSession: false,
        logIdentityKnown: true,
        generation: "private-generation",
        loadToken: "private-load-token"
      } }), "en-US");
      assert.match(unboundSummary, /Hello bound to current session: false/);
      assert.doesNotMatch(unboundSummary, /private-generation|private-load-token/);
      const unknownBindingSummary = module.buildDiagnosticSummary(fixture({ sessionEvidence: {
        loadSessionSeen: true, helloSeen: true, logIdentityKnown: true
      } }), "en-US");
      assert.match(unknownBindingSummary, /Hello bound to current session: unknown/);
    }

    {
      let copied = "";
      let copyCalls = 0;
      let readCalls = 0;
      let redetectCalls = 0;
      globalThis.window = {
        bridgeAPI: {
          getState: async () => { readCalls++; return fixture(); },
          redetect: async () => { redetectCalls++; return fixture({ status: "PENDING", reasonCode: "HELLO_NOT_RECEIVED" }); }
        },
        navigator: { clipboard: { writeText: async value => { copyCalls++; copied = value; } } },
        open: () => assert.fail("compatibility guide must not open automatic URLs")
      };
      const rig = createView(module, { uiLanguage: "en-US" });
      let tree = rig.render();
      await flushMicrotasks();
      tree = rig.render();
      const content = nodeText(tree);
      assert.match(content, /V9\.6\.0/);
      assert.match(content, /VOCT maintained local Mod base 2\.0\.5/);
      assert.match(content, /Official upstream base 2\.0\.4/);
      assert.match(content, /Unknown \/ unverified/);
      assert.match(content, /Observed/);
      assert.match(content, /Declared revision: 1/);
      assert.match(content, /Declared support: Yes/);
      assert.match(content, /Declared support: No/);
      assert.match(content, /Hello bound to current session Yes/);
      assert.match(content, /Action confirmation/);
      assert.match(content, /Traits/);
      assert.match(content, /Official recollection/);
      assert.match(content, /Observed/);
      assert.doesNotMatch(content, /C:\\private|private prompt|private stack|private-session-generation/);

      assert.equal(copyCalls, 0, "diagnostics are not copied automatically");
      findButton(tree, "Copy diagnostic summary").props.onClick();
      await flushMicrotasks();
      tree = rig.render();
      assert.equal(copyCalls, 1);
      assert.match(copied, /Reason code: OPTIONAL_CAPABILITY_MISSING/);
      assert.doesNotMatch(copied, /C:\\private|private prompt|private stack|private-session-generation/);
      assert.match(nodeText(tree), /Diagnostic summary copied/);

      findButton(tree, "View compatibility guide").props.onClick();
      tree = rig.render();
      assert.match(nodeText(tree), /Runtime and Workshop Mod are separate artifacts/);
      assert.match(nodeText(tree), /Older Mods may not emit a Bridge Hello/);
      assert.equal(findNode(tree, node => node.type === "a"), null, "guide contains no automatic download links");

      findButton(tree, "Re-detect current session").props.onClick();
      await flushMicrotasks();
      tree = rig.render();
      assert.equal(redetectCalls, 1);
      assert.equal(readCalls, 1, "manual redetection uses only the read-only Bridge API");
      assert.match(nodeText(tree), /Waiting for verification/);
      rig.unmount();
    }

    {
      globalThis.window = { bridgeAPI: { getState: async () => fixture({ reasonCode: "LEGACY_UNVERIFIED", status: "SUPPORTED" }) } };
      const rig = createView(module, { uiLanguage: "zh-CN" });
      let tree = rig.render();
      await flushMicrotasks();
      tree = rig.render();
      const content = nodeText(tree);
      assert.match(content, /旧版／未验证/);
      assert.match(content, /当前 Mod 未声明可验证的 Bridge Hello/);
      assert.match(content, /动作确认/);
      assert.match(content, /特质/);
      assert.match(content, /官方追忆/);
      assert.doesNotMatch(content, /协议声明兼容/);
      assert.match(module.buildDiagnosticSummary(fixture({ reasonCode: "LEGACY_UNVERIFIED", status: "SUPPORTED" }), "zh-CN"), /兼容状态：LEGACY_UNVERIFIED/);
      findButton(tree, "查看兼容说明").props.onClick();
      tree = rig.render();
      assert.match(nodeText(tree), /Runtime 与 Workshop Mod 是独立工件/);
      rig.unmount();
    }

    {
      const bindingScenarios = [
        { status: "PENDING", reasonCode: "HELLO_LOAD_SESSION_MISMATCH", bound: false, label: "No" },
        { status: "INCOMPATIBLE", reasonCode: "HELLO_SCHEMA_INVALID", bound: false, label: "No" },
        { status: "INCOMPATIBLE", reasonCode: "UNSUPPORTED_PROTOCOL_OR_SCHEMA", bound: true, label: "Yes" },
        { status: "UNKNOWN", reasonCode: "SERVICE_STOPPED", bound: undefined, label: "Not confirmed" }
      ];
      for (const scenario of bindingScenarios) {
        const sessionEvidence = { loadSessionSeen: true, helloSeen: true, logIdentityKnown: true, generation: "private-generation" };
        if (scenario.bound !== undefined) sessionEvidence.helloBoundToCurrentSession = scenario.bound;
        globalThis.window = { bridgeAPI: { getState: async () => fixture({
          status: scenario.status,
          reasonCode: scenario.reasonCode,
          sessionEvidence
        }) } };
        const rig = createView(module, { uiLanguage: "en-US" });
        rig.render();
        await flushMicrotasks();
        const tree = rig.render();
        assert.match(nodeText(tree), new RegExp(`Hello bound to current session ${scenario.label}`), scenario.reasonCode);
        assert.doesNotMatch(nodeText(tree), /private-generation/);
        rig.unmount();
      }
    }

    {
      globalThis.window = { bridgeAPI: undefined, navigator: { clipboard: { writeText: async () => {} } } };
      const rig = createView(module, { uiLanguage: "en-US" });
      let tree = rig.render();
      await flushMicrotasks();
      tree = rig.render();
      assert.match(nodeText(tree), /Bridge diagnostics are currently unavailable/);
      assert.match(nodeText(tree), /Unknown \/ unverified/);
      assert.equal(findButton(tree, "Refresh status").props.disabled, true);
      rig.unmount();
    }

    {
      globalThis.window = { bridgeAPI: { getState: async () => { throw new Error("C:\\private\\provider-key=secret"); } } };
      const rig = createView(module, { uiLanguage: "en-US" });
      let tree = rig.render();
      await flushMicrotasks();
      tree = rig.render();
      assert.match(nodeText(tree), /Bridge diagnostics are currently unavailable/);
      assert.doesNotMatch(nodeText(tree), /C:\\private|provider-key|secret/);
      rig.unmount();
    }

    {
      const oldRead = deferred();
      let firstResolved = false;
      const calls = [];
      const oldApi = { getState: () => { calls.push("old-start"); return oldRead.promise; } };
      const newApi = { getState: async () => { calls.push(firstResolved ? "new-after-old" : "new-overlap"); return fixture({ voctBridgeRevision: "new-revision" }); } };
      globalThis.window = { bridgeAPI: oldApi };
      const rig = createView(module, { uiLanguage: "en-US" });
      rig.render();
      globalThis.window.bridgeAPI = newApi;
      rig.render({ uiLanguage: "en-US" });
      assert.deepEqual(calls, ["old-start"], "new context read waits for the active read instead of overlapping it");
      firstResolved = true;
      oldRead.resolve(fixture({ voctBridgeRevision: "stale-revision" }));
      await flushMicrotasks();
      let tree = rig.render();
      await flushMicrotasks();
      tree = rig.render();
      assert.deepEqual(calls, ["old-start", "new-after-old"]);
      assert.match(nodeText(tree), /new-revision/);
      assert.doesNotMatch(nodeText(tree), /stale-revision/);
      rig.unmount();
    }

    {
      const newRead = deferred();
      const oldApi = { getState: async () => fixture({ voctBridgeRevision: "old-known-revision" }) };
      let newCalls = 0;
      const newApi = { getState: () => { newCalls++; return newRead.promise; } };
      globalThis.window = { bridgeAPI: oldApi };
      const rig = createView(module, { uiLanguage: "en-US" });
      rig.render();
      await flushMicrotasks();
      let tree = rig.render();
      assert.match(nodeText(tree), /old-known-revision/);

      globalThis.window.bridgeAPI = newApi;
      tree = rig.render();
      assert.equal(newCalls, 1);
      assert.doesNotMatch(nodeText(tree), /old-known-revision/, "a known snapshot is hidden as soon as its API context changes");
      newRead.resolve(fixture({ voctBridgeRevision: "new-known-revision" }));
      await flushMicrotasks();
      tree = rig.render();
      assert.match(nodeText(tree), /new-known-revision/);
      rig.unmount();
    }

    {
      const pending = deferred();
      globalThis.window = { bridgeAPI: { getState: () => pending.promise } };
      const rig = createView(module, { uiLanguage: "en-US" });
      rig.render();
      rig.unmount();
      pending.resolve(fixture());
      await flushMicrotasks();
      assert.equal(rig.postUnmountUpdates, 0, "late read completion after unmount does not update component state");
    }

    {
      const originalSetTimeout = globalThis.setTimeout;
      const originalClearTimeout = globalThis.clearTimeout;
      let nextTimerId = 1;
      const timers = new Map();
      let calls = 0;
      globalThis.setTimeout = (callback, delay) => {
        const id = nextTimerId++;
        timers.set(id, { callback, delay });
        return id;
      };
      globalThis.clearTimeout = id => timers.delete(id);
      try {
        globalThis.window = { bridgeAPI: { getState: async () => { calls++; return fixture({ status: "PENDING", reasonCode: "HELLO_NOT_RECEIVED" }); } } };
        const rig = createView(module, { uiLanguage: "en-US" });
        rig.render();
        await flushMicrotasks();
        rig.render();
        assert.equal(timers.size, 1);
        assert.equal(timers.values().next().value.delay, module.BRIDGE_DIAGNOSTICS_POLL_INTERVAL_MS);
        for (let index = 0; index < module.BRIDGE_DIAGNOSTICS_MAX_PENDING_POLLS; index++) {
          const [id, timer] = timers.entries().next().value;
          timers.delete(id);
          timer.callback();
          await flushMicrotasks();
          rig.render();
        }
        assert.equal(calls, module.BRIDGE_DIAGNOSTICS_MAX_PENDING_POLLS + 1);
        assert.equal(timers.size, 0, "pending polling stops at its fixed maximum");
        rig.unmount();
      } finally {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
      }
    }
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }

  process.stdout.write("V9.6 Bridge diagnostics UI checks passed\n");
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
