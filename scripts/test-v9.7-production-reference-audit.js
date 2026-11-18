"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { auditReferences, captureIpc } = require("./v9.7-reference-audit");
const baseline = require("./fixtures/v9.7/ipc-baseline.json");
const { readPayload } = require("./build-runtime");
const root = path.resolve(__dirname, "..");
const audit = auditReferences();
const activeRoutes = new Map(audit.ipc.routes.map(route => [route.exposure, route]));
for (const { exposure, kind, channel } of baseline.routes) {
  assert.deepEqual([activeRoutes.get(exposure)?.kind, activeRoutes.get(exposure)?.channel], [kind, channel], exposure);
}
for (const channel of baseline.handlers) assert(audit.ipc.handlers.includes(channel), channel);
for (const channel of baseline.sendHandlers) assert(audit.ipc.sendHandlers.includes(channel), channel);
for (const method of ["getBackgroundSetting", "saveBackgroundSetting"]) {
  assert.equal(activeRoutes.get(`worldlineAPI.${method}`)?.channel, `worldline:${method}`);
  assert(audit.ipc.handlers.includes(`worldline:${method}`));
}
assert(audit.relativeImports.length > 0);
const registrationSource = fs.readFileSync(path.join(root, "src/app/main/ipc/register-ipc.js"), "utf8");
assert.throws(() => captureIpc({ registrationSource: registrationSource.replace('handle("worldline:mutateCanon"', 'handle("synthetic:removed"') }),
  /audit_missing_handler:worldline:mutateCanon/, "a disconnected production channel fails the audit");
const preloadSource = fs.readFileSync(path.join(root, "src/app/preload/preload.js"), "utf8");
assert.throws(() => captureIpc({ preloadSource: preloadSource.replace('invoke("bridge:getState"', 'invoke("synthetic:missing"') }),
  /audit_missing_handler:synthetic:missing/);

assert(readPayload(root).length > 0, "current build mapping must resolve; build verification owns byte parity");
assert.equal(require("./test-manifest").releaseChecks.some(entry => entry.script === "test-v9.3.4-legacy-forget.js"), true);
console.log(`PASS V9.7 reference audit: ${audit.sourceFiles} source files, ${audit.relativeImports.length} local imports, ${audit.ipc.routes.length} IPC routes; dynamic sites are inventory, not proof of no consumers`);
