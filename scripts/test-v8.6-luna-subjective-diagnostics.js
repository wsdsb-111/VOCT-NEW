"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v86-luna5-"));
const autosavePath = path.join(root, "autosave.ck3");
fs.writeFileSync(autosavePath, "fixture");
const settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: false, subjectiveWorldMode: "DIAGNOSTIC", lastValidationStatus: "VALID" };
try {
  const service = new WorldlineService({
    dataDir: root,
    settingsRepository: {
      getWorldlineSettings: () => settings,
      saveWorldlineSettings: (next) => Object.assign(settings, next),
      getCK3UserFolderPath: () => null,
      getCK3DebugLogPath: () => null
    }
  });
  service.currentCheckpoint = {
    id: "checkpoint-luna-5",
    snapshot: {
      playerId: "1",
      gameDate: "1170.6.6",
      characters: {
        "1": { id: "1", firstName: "甲" },
        "2": { id: "2", firstName: "乙" },
        "3": { id: "3", firstName: "丙" }
      }
    }
  };
  const all = service.getSubjectiveResponderOptions();
  assert.equal(all.currentPlayerId, "1");
  assert.equal(all.responders[0].responderId, "1", "current player is offered first as a safe default");
  const filtered = service.getSubjectiveResponderOptions({ query: "乙" });
  assert.deepEqual(filtered.responders.map((item) => item.responderId), ["2"], "responder search is server-side and bounded");
  service.dispose();
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const ipc = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/ipc/register-ipc.js"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "../resources/app/out/preload/preload.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/assets/index-Dn3qWlAB.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/assets/index-WtJH_nua.css"), "utf8");
const conversation = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/conversation/conversation.js"), "utf8");
const handlerStart = ipc.indexOf('electron.ipcMain.handle("worldline:getSubjectiveWorldView"');
const handlerEnd = ipc.indexOf('electron.ipcMain.handle("worldline:listSupplemental"', handlerStart);
const handler = ipc.slice(handlerStart, handlerEnd);

assert(handlerStart >= 0 && handlerEnd > handlerStart, "subjective IPC handler is registered");
assert(handler.includes("responderId") && handler.includes("query"), "subjective IPC accepts only target and query inputs");
assert(!handler.includes("knownBy") && !handler.includes("directObservationFactIds") && !handler.includes("presenceRevision"), "Renderer cannot submit authorization or presence evidence");
assert(preload.includes("getSubjectiveResponderOptions") && preload.includes("getSubjectiveWorldView"), "preload exposes additive read-only subjective APIs");
assert(renderer.includes("Character Knowledge / Subjective World") && renderer.includes("Developer diagnostics (opaque ID / reason only)"), "Luna renders the knowledge and safe developer layers");
assert(renderer.includes("Some content was withheld because this responder is not authorized to know it."), "Luna renders a count-only Secret notice");
assert(renderer.includes("Prompt / World Recall Diagnostics") && renderer.includes("worldline-prompt-diagnostics"), "existing Prompt / World Recall diagnostics remain available");
assert(css.includes(".worldline-subjective-facts") && css.includes(".worldline-subjective-query"), "Luna subjective diagnostics have bounded responsive styles");
assert(!conversation.includes("getSubjectiveWorldView?.("), "Luna Stage 5 does not switch production Prompt injection");

console.log("V8.6 Luna Stage 5 Subjective Diagnostics: PASS (safe IPC, responder selection, A/B UI and production Prompt isolation)");
