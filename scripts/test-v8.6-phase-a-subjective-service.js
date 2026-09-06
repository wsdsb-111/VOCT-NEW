"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v86-phase-a-"));
const autosavePath = path.join(root, "autosave.ck3");
fs.writeFileSync(autosavePath, "fixture");
const settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: true, subjectiveWorldMode: "DIAGNOSTIC", lastValidatedAt: "fixture", lastValidationStatus: "VALID" };
const memoryEngine = { store: {
  getCharacterKnowledge: (id) => String(id) === "1" ? [{ memoryId: "secret-1" }] : [],
  getMemory: (id) => id === "secret-1" ? { memoryId: id, visibility: "private", type: "secret", participants: [1], eventDate: "1170.6.6", content: "绝不能发送给其他人" } : null
} };

try {
  const service = new WorldlineService({ dataDir: root, memoryEngine, settingsRepository: { getWorldlineSettings: () => settings, saveWorldlineSettings: (next) => Object.assign(settings, next), getCK3UserFolderPath: () => null, getCK3DebugLogPath: () => null } });
  service.currentCheckpoint = { id: "checkpoint", source: { path: autosavePath }, snapshot: {
    gameDate: "1170.6.6", playerId: "1", diagnostics: { characterCount: 2, activeWarCount: 0 },
    characters: { "1": { id: "1", firstName: "甲", courtEmployer: "10", liege: "20" }, "2": { id: "2", firstName: "乙", courtEmployer: "10", liege: "20" } },
    nameToCharacterIds: { "甲": ["1"], "乙": ["2"] }, definitionToRuntime: {}, runtimeToDefinitions: {}, titles: {}
  } };
  service.buildState = "ACTIVE";
  service.getLiveState = () => ({ connected: true, gameDate: "1170年6月6日", totalDays: 1, characters: [] });

  const legacy = service.getPromptContext({ query: "#2在哪里" });
  assert.equal(Object.hasOwn(legacy, "subjectiveWorldView"), false, "Phase A leaves the existing Prompt DTO unchanged");
  const owner = service.getSubjectiveWorldView({ responderId: "1", query: "#2在哪里", conversationId: "c", turnEpoch: 1 });
  const other = service.getSubjectiveWorldView({ responderId: "2", query: "#2在哪里", conversationId: "c", turnEpoch: 1 });
  assert(owner.allowedFacts.some((fact) => fact.contentRef === "secret-1"), "owner may retain an opaque personal-memory reference");
  assert(!JSON.stringify(other).includes("secret-1"), "another responder receives neither secret content nor its reference");
  assert.equal(service.getSubjectiveWorldView({ responderId: "1", query: "#2在哪里", conversationId: "c", turnEpoch: 1 }).cacheHit, true, "responder view cache is scoped and reusable");
  service.dispose();
  console.log("V8.6 Phase A Subjective Service: PASS (shared retrieval, per-responder memory and legacy Prompt isolation)");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
