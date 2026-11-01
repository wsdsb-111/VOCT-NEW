"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const fixture = { payloadSha256: "a".repeat(64), files: [{ path: "out/main/main.js", sha256:
  crypto.createHash("sha256").update("synthetic baseline").digest("hex") }] };
const fixturePath = require.resolve("./fixtures/v9.7/runtime-v961.json");
const previous = require.cache[fixturePath];
require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: fixture };
const { seedCiRuntimeBaseline } = require("./seed-ci-runtime-baseline");
if (previous) require.cache[fixturePath] = previous;
else delete require.cache[fixturePath];
const { statePaths } = require("./deploy-runtime-build");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v97-ci-baseline-"));
try {
  const target = path.join(root, "resources/app/out/main/main.js");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "synthetic baseline");
  for (const environment of [{}, { GITHUB_ACTIONS: "true" }, { GITHUB_ACTIONS: "false", GITHUB_WORKSPACE: root },
    { GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: path.dirname(root) }]) {
    assert.throws(() => seedCiRuntimeBaseline({ rootDir: root, environment }), /ci_baseline_isolated_checkout_required/);
    assert(!fs.existsSync(statePaths(root).receiptPath));
  }
  const environment = { GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: root };
  fs.writeFileSync(target, "unrecognized user modification");
  assert.throws(() => seedCiRuntimeBaseline({ rootDir: root, environment }), /build_deploy_target_mismatch/);
  assert(!fs.existsSync(statePaths(root).receiptPath));
  fs.writeFileSync(target, "synthetic baseline");
  assert.deepEqual(seedCiRuntimeBaseline({ rootDir: root, environment }), { files: 1, payloadSha256: fixture.payloadSha256 });
  const receipt = fs.readFileSync(statePaths(root).receiptPath);
  assert.throws(() => seedCiRuntimeBaseline({ rootDir: root, environment }), /ci_baseline_existing_receipt_rejected/);
  assert.deepEqual(fs.readFileSync(statePaths(root).receiptPath), receipt);
  assert.equal(fs.readFileSync(target, "utf8"), "synthetic baseline");
  console.log("PASS V9.7 CI baseline: isolated workspace gate, unknown bytes refusal, exact hash adoption, no target write or receipt replacement");
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("votc-v97-ci-baseline-"));
  fs.rmSync(root, { recursive: true, force: true });
}
