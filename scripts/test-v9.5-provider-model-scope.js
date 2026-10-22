"use strict";

const assert = require("node:assert/strict");
const { LLMManager } = require("../src/app/main/provider-service");
const { validateOptionalProviderInstanceId } = require("../src/app/main/ipc/register-ipc");

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function main() {
  const configs = {
    a: { instanceId: "provider-a", providerType: "fixture", baseUrl: "https://a.example.test", defaultParameters: { temperature: 0.1 } },
    b: { instanceId: "provider-b", providerType: "fixture", baseUrl: "https://b.example.test", defaultParameters: { temperature: 0.2 } },
    active: { instanceId: "provider-active", providerType: "fixture", baseUrl: "https://active.example.test", defaultParameters: { temperature: 0.3 } }
  };
  const pending = new Map(Object.values(configs).map(config => [config.instanceId, deferred()]));
  const received = [];
  let activeReads = 0;
  const settingsRepository = {
    getProviderConfigById: instanceId => Object.values(configs).find(config => config.instanceId === instanceId) || null,
    getActiveProviderConfig: () => { activeReads += 1; return configs.active; }
  };
  const manager = new LLMManager({ settingsRepository, providerRegistry: {}, usageAnalytics: null });
  manager.getProviderInstance = () => ({
    listModels: config => {
      received.push(config);
      return pending.get(config.instanceId).promise;
    }
  });

  const readA = manager.listModelsForProvider(undefined, { instanceId: "provider-a" });
  const readB = manager.listModelsForProvider(undefined, { instanceId: "provider-b" });
  assert.equal(activeReads, 0, "explicit instance ids must not read or fall back to the active provider");
  assert.equal(received[0].instanceId, "provider-a");
  assert.equal(received[1].instanceId, "provider-b");
  assert.notEqual(received[0], configs.a, "explicit provider config must be a snapshot");
  assert.notEqual(received[0].defaultParameters, configs.a.defaultParameters, "nested provider config must also be cloned");
  configs.a.defaultParameters.temperature = 0.9;
  assert.equal(received[0].defaultParameters.temperature, 0.1, "in-flight model lookup must retain its request-time config");

  pending.get("provider-b").resolve([{ id: "model-b" }]);
  pending.get("provider-a").resolve([{ id: "model-a" }]);
  assert.deepEqual(await readA, [{ id: "model-a" }]);
  assert.deepEqual(await readB, [{ id: "model-b" }], "out-of-order completion must remain bound to each requested provider");

  const legacyRead = manager.listModelsForProvider();
  assert.equal(activeReads, 1, "no-argument callers must keep using the active provider");
  assert.equal(received[2], configs.active, "no-argument callers retain the legacy config path");
  pending.get("provider-active").resolve([{ id: "active-model" }]);
  assert.deepEqual(await legacyRead, [{ id: "active-model" }]);

  const callsBeforeUnknown = received.length;
  await assert.rejects(manager.listModelsForProvider(undefined, { instanceId: "provider-missing" }), error => {
    assert.equal(error.code, "provider_instance_unavailable");
    assert.equal(error.message, "provider_instance_unavailable");
    return true;
  });
  assert.equal(received.length, callsBeforeUnknown, "unknown ids must fail before provider creation");
  assert.equal(activeReads, 1, "unknown ids must not fall back to the active provider");

  assert.equal(validateOptionalProviderInstanceId(undefined), undefined);
  assert.equal(validateOptionalProviderInstanceId("provider-a"), "provider-a");
  assert.throws(() => validateOptionalProviderInstanceId("  "), error => error.code === "invalid_provider_instance_id");
  assert.throws(() => validateOptionalProviderInstanceId(null), error => error.code === "invalid_provider_instance_id");
  assert.throws(() => validateOptionalProviderInstanceId("x".repeat(257)), error => error.code === "invalid_provider_instance_id");

  console.log("V9.5 provider model scope: PASS (concurrent binding, config snapshots, legacy active lookup and fail-closed ids)");
}

main().catch(error => {
  console.error("V9.5 provider model scope: FAIL", error);
  process.exitCode = 1;
});
