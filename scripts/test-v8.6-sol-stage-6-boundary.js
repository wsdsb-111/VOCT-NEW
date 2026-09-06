"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v86-sol6-"));
const autosavePath = path.join(root, "autosave.ck3");
fs.writeFileSync(autosavePath, "fixture");
const settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: false, subjectiveWorldMode: "DIAGNOSTIC", lastValidationStatus: "VALID" };

try {
  let characterReads = 0;
  const characters = {};
  for (let id = 1; id <= 5000; id += 1) {
    Object.defineProperty(characters, String(id), {
      enumerable: true,
      get() {
        characterReads += 1;
        return { id: String(id), firstName: id === 4999 ? "目标人物" : `人物${id}` };
      }
    });
  }
  const service = new WorldlineService({
    dataDir: root,
    settingsRepository: {
      getWorldlineSettings: () => settings,
      saveWorldlineSettings: (next) => Object.assign(settings, next),
      getCK3UserFolderPath: () => null,
      getCK3DebugLogPath: () => null
    }
  });
  service.currentCheckpoint = { id: "checkpoint-sol-6", snapshot: { playerId: "1", gameDate: "1170.6.6", characters } };
  const initial = service.getSubjectiveResponderOptions();
  assert.equal(initial.responders.length, 50, "empty responder list is capped before crossing IPC");
  assert.equal(initial.responders[0].responderId, "1", "current player remains the deterministic first responder");
  assert.equal(initial.total, 5000, "bounded display selection still reports the exact character total");
  assert(characterReads <= 100, `empty responder load must not materialize every character (${characterReads} reads)`);
  const filtered = service.getSubjectiveResponderOptions({ query: "目标人物" });
  assert.deepEqual(filtered.responders.map((item) => item.responderId), ["4999"], "explicit responder search remains complete");
  service.dispose();
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const serviceSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/worldline/worldline-service.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/assets/index-Dn3qWlAB.js"), "utf8");
const conversation = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/conversation/conversation.js"), "utf8");
const settingsSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/config/settings-repository.js"), "utf8");

const responderMethod = serviceSource.slice(serviceSource.indexOf("getSubjectiveResponderOptions"), serviceSource.indexOf("getAnnualDelta", serviceSource.indexOf("getSubjectiveResponderOptions")));
assert(!responderMethod.includes("Object.entries") && !responderMethod.includes(".sort("), "responder picker does not allocate and sort the full snapshot");
assert(renderer.includes('if (activeTab !== "diagnostics") return;'), "responder inventory is not loaded merely by opening Worldline");
assert(renderer.includes("subjectiveResponderRequestRef.current"), "stale responder searches cannot overwrite a newer result");
assert(renderer.includes('SECRET: text("已授权私密信息"') && renderer.includes('SECRET_KNOWN: text("角色已获授权知晓"'), "authorized Secret state is player-readable without exposing content");
assert(renderer.includes("subjectiveSourceLabel(fact.sourceTier)") && renderer.includes('text("共享检索缓存", "Shared retrieval cache")'), "source tier and cache layers are visible in diagnostics");
assert(renderer.includes("children: display(item.reason)"), "collapsed developer diagnostics retain the opaque policy reason code");
assert(renderer.includes("statusLabel(diagnostics?.parserState)") && renderer.includes("statusLabel(diagnostics?.catalogStatus)"), "Worker recovery states use readable labels");
assert.equal((conversation.match(/getPromptContext\?\.\(/g) || []).length, 1, "production conversation has one legacy world-context entry");
assert(!conversation.includes("getSubjectiveWorldView?.("), "diagnostic Subjective DTO is not accidentally double-injected into production Prompt");
assert(settingsSource.includes('subjectiveWorldMode: "DIAGNOSTIC"'), "Phase A remains fail-closed until a reviewed production integration exists");

console.log("V8.6 Sol Stage 6 Boundary Gate: PASS (bounded responder picker, race isolation, readable diagnostics and single legacy Prompt entry)");
