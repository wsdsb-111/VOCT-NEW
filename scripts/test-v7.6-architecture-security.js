"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const mainLines = mainSource.split(/\r?\n/).length;
const registrySource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "action-registry.js"), "utf8");
const sandboxSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "script-sandbox.js"), "utf8");
const { SecureProviderSecrets } = require(path.join(root, "resources", "app", "out", "main", "secure-provider-secrets.js"));
const memorySchema = require(path.join(root, "resources", "app", "out", "main", "memory-system", "memory-schema.js"));

assert(mainLines <= 9550, `V7.6 main-process health budget exceeded: ${mainLines} lines`);
assert(mainSource.includes('require("./script-sandbox")'));
assert(mainSource.includes('require("./window-manager")'));
assert(mainSource.includes('require("./secure-provider-secrets")'));
assert(!mainSource.includes('require("vm")') && !mainSource.includes("vm__namespace"), "main.js must not carry a private VM allowlist");
assert(registrySource.includes('require("../script-sandbox")'));
assert(!registrySource.includes('require("vm")'), "action registry must use the shared sandbox factory");
for (const blocked of ["require", "process", "globalThis", "eval", "Function", "Buffer"]) {
  assert(sandboxSource.includes(`${blocked}: undefined`), `shared sandbox must block ${blocked}`);
}
assert(sandboxSource.includes("codeGeneration: { strings: false, wasm: false }"));

class FakeStore {
  constructor(initial = {}) { this.values = { ...initial }; }
  get(key, fallback) { return this.values[key] ?? fallback; }
  set(key, value) { this.values[key] = value; }
}
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, "")
};
const secretStore = new FakeStore();
const secrets = new SecureProviderSecrets({ safeStorage, store: secretStore, logger: { error() {} } });
const plaintextSettings = {
  providers: [{ instanceId: "deepseek", apiKey: "sk-sensitive", providerType: "deepseek" }],
  presets: [{ instanceId: "preset-1", apiKey: "preset-secret", providerType: "openrouter" }]
};
const migrated = secrets.migratePlaintextSettings(plaintextSettings);
assert.strictEqual(migrated.migrated, true);
assert(migrated.settings.providers.every((config) => config.apiKey === ""));
assert(!JSON.stringify(migrated.settings).includes("sk-sensitive"));
assert(!JSON.stringify(secretStore.values).includes("sk-sensitive"), "secret store must contain ciphertext only");
const hydrated = secrets.hydrateSettings(migrated.settings);
assert.strictEqual(hydrated.providers[0].apiKey, "sk-sensitive");
assert.strictEqual(hydrated.presets[0].apiKey, "preset-secret");
const unavailable = new SecureProviderSecrets({ safeStorage: { isEncryptionAvailable: () => false }, store: new FakeStore() });
const deferred = unavailable.migratePlaintextSettings(plaintextSettings);
assert.strictEqual(deferred.deferred, true);
assert.strictEqual(deferred.settings.providers[0].apiKey, "sk-sensitive", "unavailable encryption must defer without deleting the only copy");

assert.strictEqual(memorySchema.CURRENT_MEMORY_SCHEMA_VERSION, 2);
assert.strictEqual(memorySchema.MIN_READABLE_MEMORY_SCHEMA_VERSION, 1);
assert.strictEqual(memorySchema.upgradeMemoryRecord({ schemaVersion: 1, memoryId: "old" }).schemaVersion, 2);
assert.strictEqual(memorySchema.normalizeSummaryRecord({ content: "old summary" }).schemaVersion, 2);
assert.throws(() => memorySchema.upgradeMemoryRecord({ schemaVersion: 99 }), /unsupported_schema/);
assert(mainSource.includes("schemaVersion: memorySystem.CURRENT_SUMMARY_SCHEMA_VERSION"));

console.log(`VOTC v7.6 architecture/security: PASS (main ${mainLines} lines, shared sandbox, encrypted provider keys, schema contract)`);
