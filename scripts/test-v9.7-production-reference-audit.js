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
const expectedIpc = structuredClone({ routes: baseline.routes, handlers: baseline.handlers, sendHandlers: baseline.sendHandlers });
// V9.7.1 adds exactly two explicit routes and one new listener consumer.
for (const method of ["getBackgroundSetting", "saveBackgroundSetting"]) {
  expectedIpc.routes.push({ exposure: `worldlineAPI.${method}`, kind: "invoke", channel: `worldline:${method}`,
    handlerOwner: "main/ipc/register-ipc.js", serviceCalls: [`worldlineService.${method}`], rendererConsumers: [],
    possibleAliasConsumers: ["src/app/renderer/campaign-background-editor.js"] });
  expectedIpc.handlers.push(`worldline:${method}`);
}
expectedIpc.handlers.sort();
expectedIpc.routes.sort((a, b) => a.exposure.localeCompare(b.exposure, "en"));
expectedIpc.routes.find(row => row.exposure === "worldlineAPI.onUpdated").possibleAliasConsumers.splice(1, 0, "src/app/renderer/campaign-background-editor.js");
assert.deepEqual(audit.ipc, expectedIpc,
  "sampled Preload routes, handler text references and literal Renderer consumers match the baseline");
assert(audit.relativeImports.length > 0);
const registrationSource = fs.readFileSync(path.join(root, "src/app/main/ipc/register-ipc.js"), "utf8");
assert.throws(() => captureIpc({ registrationSource: registrationSource.replace('handle("worldline:mutateCanon"', 'handle("synthetic:removed"') }),
  /audit_missing_handler:worldline:mutateCanon/, "a disconnected production channel fails the audit");
const preloadSource = fs.readFileSync(path.join(root, "src/app/preload/preload.js"), "utf8");
assert.throws(() => captureIpc({ preloadSource: preloadSource.replace('invoke("bridge:getState"', 'invoke("synthetic:missing"') }),
  /audit_missing_handler:synthetic:missing/);

const payload = readPayload(root);
const additions = ["out/main/worldline/campaign-background.js", "out/renderer/campaign-background-editor.js"];
assert.deepEqual(payload.map(item => item.target), [...runtimeBaseline.files.map(item => item.path), ...additions].sort(), "only reviewed V9.7.1 mapping additions");
const approvedChanges = new Set(["package.json", "out/main/version.js", "out/main/bridge/runtime-manifest.json",
  "out/main/providers/provider-result.js", "out/renderer/index.html", "out/renderer/assets/index-Dn3qWlAB.js", "out/renderer/bridge-diagnostics.js"]);
for (const file of [...additions, "out/main/worldline/worldline-service.js", "out/main/conversation/conversation.js", "out/main/prompts/prompt-builder.js",
  "out/main/ipc/register-ipc.js", "out/preload/preload.js", "out/renderer/v95/i18n/locales/zh-CN.js", "out/renderer/v95/i18n/locales/en-US.js"]) approvedChanges.add(file);
for (const item of payload) {
  if (approvedChanges.has(item.target)) continue;
  const original = runtimeBaseline.files.find(entry => entry.path === item.target);
  assert.equal(crypto.createHash("sha256").update(item.bytes).digest("hex"), original.sha256,
    `${item.target}: unapproved Runtime behavior or default-data change`);
}
assert.equal(require("./test-manifest").releaseChecks.some(entry => entry.script === "test-v9.3.4-legacy-forget.js"), true);
console.log(`PASS V9.7 reference audit: ${audit.sourceFiles} source files, ${audit.relativeImports.length} local imports, ${audit.ipc.routes.length} IPC routes; dynamic sites are inventory, not proof of no consumers`);
