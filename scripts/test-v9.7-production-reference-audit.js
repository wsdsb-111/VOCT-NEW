"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { auditReferences, captureIpc } = require("./v9.7-reference-audit");
const baseline = require("./fixtures/v9.7/ipc-baseline.json");
const runtimeBaseline = require("./fixtures/v9.7/runtime-v961.json");
const { readPayload } = require("./build-runtime");
const root = path.resolve(__dirname, "..");
const audit = auditReferences();
assert.deepEqual(audit.ipc, { routes: baseline.routes, handlers: baseline.handlers, sendHandlers: baseline.sendHandlers },
  "sampled Preload routes, handler text references and literal Renderer consumers match the baseline");
assert(audit.relativeImports.length > 0);
const registrationSource = fs.readFileSync(path.join(root, "src/app/main/ipc/register-ipc.js"), "utf8");
assert.throws(() => captureIpc({ registrationSource: registrationSource.replace('handle("worldline:mutateCanon"', 'handle("synthetic:removed"') }),
  /audit_missing_handler:worldline:mutateCanon/, "a disconnected production channel fails the audit");
const preloadSource = fs.readFileSync(path.join(root, "src/app/preload/preload.js"), "utf8");
assert.throws(() => captureIpc({ preloadSource: preloadSource.replace('invoke("bridge:getState"', 'invoke("synthetic:missing"') }),
  /audit_missing_handler:synthetic:missing/);

const payload = readPayload(root);
assert.deepEqual(payload.map(item => item.target), runtimeBaseline.files.map(item => item.path), "no silent mapping deletion or addition");
const approvedChanges = new Set(["package.json", "out/main/version.js", "out/main/bridge/runtime-manifest.json",
  "out/main/providers/provider-result.js", "out/renderer/index.html", "out/renderer/assets/index-Dn3qWlAB.js"]);
for (const item of payload) {
  if (approvedChanges.has(item.target)) continue;
  const original = runtimeBaseline.files.find(entry => entry.path === item.target);
  assert.equal(crypto.createHash("sha256").update(item.bytes).digest("hex"), original.sha256,
    `${item.target}: unapproved Runtime behavior or default-data change`);
}
assert.equal(require("./test-manifest").releaseChecks.some(entry => entry.script === "test-v9.3.4-legacy-forget.js"), true);
console.log(`PASS V9.7 reference audit: ${audit.sourceFiles} source files, ${audit.relativeImports.length} local imports, ${audit.ipc.routes.length} IPC routes; dynamic sites are inventory, not proof of no consumers`);
