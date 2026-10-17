"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRunFileManager } = require("../src/app/main/actions/run-file-manager");

const buildRoot = path.resolve(__dirname, "../.build");
fs.mkdirSync(buildRoot, { recursive: true });
const fixtureRoot = fs.mkdtempSync(path.join(buildRoot, "v937-atomic-retry-"));
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
console.log = console.warn = console.error = () => {};

function fixture(name, target, errorCode, failures) {
  const root = path.join(fixtureRoot, name);
  const ck3 = path.join(root, "ck3");
  const data = path.join(root, "data");
  const statePath = path.join(data, "run-command-queue.json");
  const carrier = path.join(ck3, "run/votc.txt");
  const wrappedFs = Object.create(fs);
  const attempts = [];
  let armed = false;
  let remaining = failures;
  let carrierWrites = 0;
  wrappedFs.renameSync = (source, destination) => {
    const bytes = fs.readFileSync(source, "utf8");
    const isDispatchState = destination === statePath && JSON.parse(bytes).pendingCommands?.[0]?.status === "awaiting_ack";
    const isEffectCarrier = destination === carrier && bytes.includes("add_gold = 1");
    if (armed && (target === "state" ? isDispatchState : isEffectCarrier)) {
      attempts.push({ source, destination, bytes });
      if (remaining > 0) {
        remaining -= 1;
        throw Object.assign(new Error("synthetic atomic rename failure"), { code: errorCode });
      }
    }
    if (armed && isEffectCarrier) {
      const persisted = JSON.parse(fs.readFileSync(statePath, "utf8")).pendingCommands[0];
      assert.equal(persisted.status, "awaiting_ack", "dispatch intent is durable before replacing the carrier");
      assert.equal(persisted.writeAttempts, 1);
      assert(bytes.startsWith("\uFEFF"), "carrier keeps UTF-8 BOM");
      carrierWrites += 1;
    }
    return fs.renameSync(source, destination);
  };
  const Manager = createRunFileManager({ fs: wrappedFs, path, dataDir: data,
    settingsRepository: { getCK3UserFolderPath: () => ck3 }, now: () => 1000, random: () => 0.25 });
  const manager = new Manager();
  manager.initializeAfterAckReconciliation();
  armed = true;
  manager.write("add_gold = 1", { commandId: "v937-atomic-fixture" });
  return { manager, attempts, carrier, carrierWrites: () => carrierWrites };
}

try {
  for (const target of ["state", "carrier"]) {
    for (const code of ["EPERM", "EACCES", "EBUSY"]) {
      const result = fixture(`${target}-${code}`, target, code, 2);
      const command = result.manager.getPendingCommands()[0];
      assert.equal(command.status, "awaiting_ack");
      assert.equal(command.writeAttempts, 1, "filesystem retries never increment effect delivery attempts");
      assert.equal(result.carrierWrites(), 1, "replace executable carrier once after successful persistence");
      assert.equal(result.attempts.length, 3);
      assert.equal(new Set(result.attempts.map(item => item.source)).size, 1, "reuse the same prepared temporary file");
      assert.equal(new Set(result.attempts.map(item => item.bytes)).size, 1, "retry only identical bytes");
    }
  }
  const persistFailure = fixture("persistent-state", "state", "EPERM", Infinity);
  assert.equal(persistFailure.attempts.length, 5, "permanent permission failure has a finite retry bound");
  assert.equal(persistFailure.manager.getPendingCommands()[0].status, "blocked");
  assert.equal(persistFailure.manager.getPendingCommands()[0].writeAttempts, 0);
  assert.equal(persistFailure.carrierWrites(), 0);
  assert.doesNotMatch(fs.readFileSync(persistFailure.carrier, "utf8"), /add_gold/);

  for (const [code, expectedAttempts] of [["EBUSY", 5], ["EIO", 1]]) {
    const failure = fixture(`permanent-carrier-${code}`, "carrier", code, Infinity);
    assert.equal(failure.attempts.length, expectedAttempts);
    assert.equal(failure.manager.getPendingCommands()[0].status, "stalled");
    assert.equal(failure.manager.getPendingCommands()[0].writeAttempts, 1);
    failure.manager.writeActiveCommand();
    failure.manager.recoverPendingCommands();
    assert.equal(failure.attempts.length, expectedAttempts, "unknown delivery is never automatically replayed");
    assert.equal(failure.carrierWrites(), 0);
  }
} finally {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  const resolved = path.resolve(fixtureRoot);
  if (path.dirname(resolved).toLowerCase() !== buildRoot.toLowerCase()
    || !path.basename(resolved).startsWith("v937-atomic-retry-")) throw new Error("fixture_cleanup_outside_build");
  fs.rmSync(resolved, { recursive: true, force: true });
}

console.log("V9.3.7 atomic RunFile retry: PASS (same bytes, durable intent, bounded failures, no effect replay)");
