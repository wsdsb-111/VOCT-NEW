"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { WorldlineStore, WORLDLINE_SCHEMA_VERSION } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "worldline-store"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v81-worldline-"));
const identity = Object.freeze({ campaignId: `ck3-${"a".repeat(32)}`, source: "ck3_mod_token", persistenceAllowed: true, tokenFingerprint: "a".repeat(64) });
const otherIdentity = Object.freeze({ campaignId: `ck3-${"b".repeat(32)}`, source: "ck3_mod_token", persistenceAllowed: true, tokenFingerprint: "b".repeat(64) });
const sessionIdentity = Object.freeze({ campaignId: "session-test", source: "session", persistenceAllowed: false, tokenFingerprint: null });

try {
  const sessionRoot = path.join(tempRoot, "session-only");
  const sessionStore = new WorldlineStore({ rootDir: sessionRoot, clock: () => "2026-08-31T00:00:00.000Z" });
  assert.deepStrictEqual(sessionStore.loadOrCreate(sessionIdentity), { status: "persistence_skipped", state: null, path: null });
  assert.strictEqual(fs.existsSync(sessionRoot), false, "session identity must produce zero disk writes");

  const storeRoot = path.join(tempRoot, "dynamic_history");
  const store = new WorldlineStore({ rootDir: storeRoot, clock: () => "2026-08-31T00:00:00.000Z" });
  const created = store.loadOrCreate(identity);
  assert.strictEqual(created.status, "created");
  assert.strictEqual(created.state.schemaVersion, WORLDLINE_SCHEMA_VERSION);
  assert.strictEqual(created.state.campaignId, identity.campaignId);
  assert.strictEqual(created.state.mode, "shadow");
  assert.strictEqual(created.state.identity.tokenFingerprint, identity.tokenFingerprint);
  assert(Object.isFrozen(created.state));
  assert(Object.isFrozen(created.state.identity));
  assert(fs.existsSync(created.path));
  assert(created.path.startsWith(path.join(storeRoot, identity.campaignId)));

  const restarted = new WorldlineStore({ rootDir: storeRoot, clock: () => "2026-09-01T00:00:00.000Z" }).loadOrCreate(identity);
  assert.strictEqual(restarted.status, "loaded");
  assert.deepStrictEqual(restarted.state, created.state, "app restart must load the same worldline state");

  const other = store.loadOrCreate(otherIdentity);
  assert.strictEqual(other.status, "created");
  assert.notStrictEqual(path.dirname(other.path), path.dirname(created.path));

  const updated = { ...created.state, updatedAt: "2026-09-01T00:00:00.000Z" };
  store.save(identity, updated);
  assert.deepStrictEqual(store.load(identity), updated);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(created.path)).filter((name) => name.includes(".tmp-")), [], "atomic temp files must be cleaned");

  const original = fs.readFileSync(created.path, "utf8");
  const unknownSchema = { ...updated, schemaVersion: 99 };
  fs.writeFileSync(created.path, `${JSON.stringify(unknownSchema, null, 2)}\n`, "utf8");
  const unknownRaw = fs.readFileSync(created.path, "utf8");
  assert.throws(() => store.loadOrCreate(identity), /worldline_schema_unsupported/);
  assert.strictEqual(fs.readFileSync(created.path, "utf8"), unknownRaw, "unknown schema must not be overwritten");

  fs.writeFileSync(created.path, "{broken-json", "utf8");
  assert.throws(() => store.loadOrCreate(identity), /worldline_json_invalid/);
  assert.strictEqual(fs.readFileSync(created.path, "utf8"), "{broken-json", "corrupt JSON must not be overwritten");

  fs.writeFileSync(created.path, original, "utf8");
  const fingerprintMismatch = JSON.parse(original);
  fingerprintMismatch.identity.tokenFingerprint = otherIdentity.tokenFingerprint;
  fs.writeFileSync(created.path, `${JSON.stringify(fingerprintMismatch, null, 2)}\n`, "utf8");
  const fingerprintRaw = fs.readFileSync(created.path, "utf8");
  assert.throws(() => store.loadOrCreate(identity), /worldline_token_fingerprint_mismatch/);
  assert.strictEqual(fs.readFileSync(created.path, "utf8"), fingerprintRaw);

  const reversedTime = JSON.parse(original);
  reversedTime.createdAt = "2026-09-02T00:00:00.000Z";
  reversedTime.updatedAt = "2026-09-01T00:00:00.000Z";
  fs.writeFileSync(created.path, `${JSON.stringify(reversedTime, null, 2)}\n`, "utf8");
  assert.throws(() => store.loadOrCreate(identity), /worldline_timestamp_order_invalid/);

  fs.writeFileSync(created.path, original, "utf8");
  const mismatched = JSON.parse(original);
  mismatched.campaignId = otherIdentity.campaignId;
  fs.writeFileSync(created.path, `${JSON.stringify(mismatched, null, 2)}\n`, "utf8");
  assert.throws(() => store.loadOrCreate(identity), /worldline_campaign_mismatch/);
  assert.strictEqual(JSON.parse(fs.readFileSync(created.path, "utf8")).campaignId, otherIdentity.campaignId);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("VOTC v8.1 Worldline Store: PASS (atomic persistence, restart, isolation, schema fail-closed)");
