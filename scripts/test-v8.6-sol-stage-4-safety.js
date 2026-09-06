"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveKnowledgeScope } = require("../resources/app/out/main/worldline/knowledge-scope-resolver");
const { createSharedCandidatePool } = require("../resources/app/out/main/worldline/shared-candidate-pool");
const { buildSubjectiveWorldView } = require("../resources/app/out/main/worldline/subjective-world-builder");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

const completeScope = { sameCourt: true, sameRealm: true, asOf: "1170.6.6", verificationMode: "CHECKPOINT", completeness: "COMPLETE" };
const secret = {
  factId: "secret:plan",
  entityId: "9",
  field: "PRIVATE_PLAN",
  value: "只有甲知道的秘密正文",
  title: "秘密标题",
  sourceTier: "PERSONAL_MEMORY",
  knowledgeLevel: "SECRET",
  knownBy: ["1"],
  participantIds: ["1", "9"],
  participantNames: ["甲", "秘密对象"],
  authorizationComplete: true,
  temporalSafe: true
};

const ownerView = buildSubjectiveWorldView({ responder: { id: "1" }, candidates: [secret], scope: completeScope, checkpointId: "checkpoint" });
const otherView = buildSubjectiveWorldView({ responder: { id: "2" }, candidates: [secret], scope: completeScope, checkpointId: "checkpoint" });
assert(ownerView.allowedFacts.some((fact) => fact.value === secret.value), "authorized responder may receive the known fact");
assert.equal(ownerView.allowedFacts[0].knownBy, undefined, "normal DTO excludes ACL metadata");
assert.equal(ownerView.allowedFacts[0].participantIds, undefined, "normal DTO excludes participant metadata");
assert(!JSON.stringify(otherView).includes(secret.value));
assert(!JSON.stringify(otherView).includes(secret.title));
assert(!JSON.stringify(otherView).includes("秘密对象"));

const currentSelf = buildSubjectiveWorldView({
  responder: { id: "1" },
  candidates: [
    { factId: "old:name", entityId: "1", field: "NAME", value: "旧名", sourceTier: "PERSONAL_MEMORY", knowledgeLevel: "PERSONAL_MEMORY", ownerId: "1" },
    { factId: "self:name", entityId: "1", field: "NAME", value: "现名", sourceTier: "GAME_TRUTH", knowledgeLevel: "SELF", selfKnowledgeVerified: true }
  ],
  scope: completeScope
});
assert.deepEqual(currentSelf.allowedFacts.map((fact) => fact.value), ["现名"], "Current Self wins over old personal state");

const selfAboveUnknownSecret = buildSubjectiveWorldView({
  responder: { id: "1" },
  candidates: [
    { ...secret, factId: "secret:self-name", entityId: "1", field: "NAME", knownBy: ["2"] },
    { factId: "self:name", entityId: "1", field: "NAME", value: "现名", sourceTier: "GAME_TRUTH", knowledgeLevel: "SELF", selfKnowledgeVerified: true }
  ],
  scope: completeScope
});
assert.deepEqual(selfAboveUnknownSecret.allowedFacts.map((fact) => fact.value), ["现名"], "an unavailable secret cannot suppress higher-authority Current Self");

const scopedView = buildSubjectiveWorldView({
  responder: { id: "1" },
  candidates: [
    { factId: "court:inside", entityId: "2", field: "PUBLIC_ROLE", value: "同宫廷职务", sourceTier: "GAME_TRUTH", knowledgeLevel: "COURT_PUBLIC", public: true },
    { factId: "court:outside", entityId: "9", field: "PUBLIC_ROLE", value: "外宫廷职务", sourceTier: "GAME_TRUTH", knowledgeLevel: "COURT_PUBLIC", public: true }
  ],
  scope: completeScope,
  scopeResolver: (fact) => ({ ...completeScope, sameCourt: fact.entityId === "2" })
});
assert(scopedView.allowedFacts.some((fact) => fact.value === "同宫廷职务"));
assert(!JSON.stringify(scopedView).includes("外宫廷职务"), "scope is resolved per fact rather than borrowed from the first entity");

const temporal = buildSubjectiveWorldView({
  responder: { id: "1" },
  candidates: [{ factId: "future", entityId: "world", field: "EVENT", value: "未来事件正文", sourceTier: "HISTORICAL_BASELINE", knowledgeLevel: "PUBLIC_WORLD", public: true, temporalSafe: false }],
  scope: completeScope
});
assert(!JSON.stringify(temporal).includes("未来事件正文"), "temporally unsafe text is redacted from the DTO");

const largeView = buildSubjectiveWorldView({
  responder: { id: "1" },
  candidates: Array.from({ length: 24 }, (_, index) => ({ factId: `large:${index}`, entityId: `e${index}`, field: "PUBLIC_NOTE", value: "长".repeat(20000), sourceTier: "PLAYER_SUPPLEMENTAL", knowledgeLevel: "PUBLIC_WORLD", public: true, temporalSafe: true })),
  scope: completeScope
});
assert(Buffer.byteLength(JSON.stringify(largeView), "utf8") <= 100 * 1024, "normal DTO stays within the 100KB target");

const connectedScope = resolveKnowledgeScope({
  snapshot: { gameDate: "1170.6.6", characters: { "1": { id: "1", courtEmployer: "10", liege: "20" }, "2": { id: "2", courtEmployer: "10", liege: "20" } } },
  responderId: "1",
  subjectId: "2",
  live: { connected: true, gameDate: "1170.7.1" }
});
assert.equal(connectedScope.verificationMode, "CHECKPOINT", "a connected date probe is not Live scope evidence");

const sharedCache = new Map();
const protectedCandidate = { factId: "hidden", knowledgeLevel: "PUBLIC_WORLD", hidden: true, title: "隐藏标题", body: "隐藏正文", knownBy: ["1"] };
const firstShared = createSharedCandidatePool({ cache: sharedCache, key: "k", build: () => [protectedCandidate] });
assert(!JSON.stringify(firstShared).includes("隐藏标题"));
assert(!JSON.stringify(firstShared).includes("隐藏正文"));
firstShared.candidates[0].knownBy.push("2");
const secondShared = createSharedCandidatePool({ cache: sharedCache, key: "k", build: () => { throw new Error("cache miss"); } });
assert.deepEqual(secondShared.candidates[0].knownBy, ["1"], "cache hits return isolated candidate copies");
const directShared = createSharedCandidatePool({ cache: new Map(), key: "direct", build: () => [{ ...secret, knowledgeLevel: "DIRECT_OBSERVATION" }] });
assert(!JSON.stringify(directShared).includes(secret.value), "responder-bound direct observations never carry content in the shared cache");

const conversationSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/conversation/conversation.js"), "utf8");
const ipcSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/ipc/register-ipc.js"), "utf8");
assert(conversationSource.includes("getPromptContext?.("), "Phase A retains the legacy Prompt path");
assert(!conversationSource.includes("getSubjectiveWorldView?.("), "Phase A does not inject the diagnostic view into production Prompt");
const subjectiveHandlerStart = ipcSource.indexOf('electron.ipcMain.handle("worldline:getSubjectiveWorldView"');
const subjectiveHandlerEnd = ipcSource.indexOf('electron.ipcMain.handle("worldline:listSupplemental"', subjectiveHandlerStart);
const subjectiveHandler = ipcSource.slice(subjectiveHandlerStart, subjectiveHandlerEnd);
assert(subjectiveHandlerStart >= 0 && subjectiveHandlerEnd > subjectiveHandlerStart, "Luna Stage 5 Subjective IPC is present");
assert(subjectiveHandler.includes("responderId") && subjectiveHandler.includes("query"), "Subjective IPC is limited to target and query");
assert(!subjectiveHandler.includes("knownBy") && !subjectiveHandler.includes("directObservationFactIds") && !subjectiveHandler.includes("presenceRevision"), "Subjective IPC cannot accept client authorization or presence evidence");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v86-sol4-"));
const settings = { autosavePath: path.join(root, "autosave.ck3"), autoWatchEnabled: false, promptIntegrationEnabled: true, subjectiveWorldMode: "DIAGNOSTIC", lastValidatedAt: "fixture", lastValidationStatus: "VALID" };
fs.writeFileSync(settings.autosavePath, "fixture");
try {
  const service = new WorldlineService({
    dataDir: root,
    memoryEngine: (() => {
      const state = { known: [{ memoryId: "memory-secret" }] };
      state.store = {
        getCharacterKnowledge: (id) => Number(id) === 1 ? state.known : [],
        getMemory: (id) => id === "memory-secret" ? { memoryId: id, visibility: "private", type: "secret", participants: [1], eventDate: "1170.6.6" } : null
      };
      return state;
    })(),
    settingsRepository: {
      getWorldlineSettings: () => settings,
      saveWorldlineSettings: (next) => Object.assign(settings, next),
      getCK3UserFolderPath: () => null,
      getCK3DebugLogPath: () => null
    }
  });
  service.currentCheckpoint = {
    id: "checkpoint",
    source: { path: settings.autosavePath },
    snapshot: {
      gameDate: "1170.6.6",
      playerId: "1",
      diagnostics: { characterCount: 3, activeWarCount: 0 },
      characters: {
        "1": { id: "1", firstName: "甲", courtEmployer: "10", liege: "20" },
        "2": { id: "2", firstName: "乙", courtEmployer: "10", liege: "20" },
        "9": { id: "9", firstName: "丙", courtEmployer: "99", liege: "99" }
      },
      nameToCharacterIds: {}, definitionToRuntime: {}, runtimeToDefinitions: {}, titles: {}
    }
  };
  service.buildState = "ACTIVE";
  service.getLiveState = () => ({ connected: false, gameDate: null, totalDays: null, characters: [] });

  let retrievalCalls = 0;
  service.getPromptContext = ({ assistContext, mentionedEntityIds }) => {
    retrievalCalls += 1;
    const id = `${assistContext || "none"}:${(mentionedEntityIds || []).join(",") || "none"}`;
    return {
      queryFingerprint: "same-query",
      queryPlan: { entities: { characters: ["2"] } },
      retrieval: {
        supplementalRevision: "same-revision",
        selected: { gameTruth: [], delta: [], supplemental: [{ id: `supplemental:${id}`, sourceTier: "PLAYER_SUPPLEMENTAL", visibility: "PUBLIC_WORLD", hidden: false, gameDate: "1170.6.6", payload: { id } }] }
      }
    };
  };
  const sharedA = service.getSharedCandidatePool({ query: "同一问题", assistContext: "甲", mentionedEntityIds: ["2"] });
  const sharedAHit = service.getSharedCandidatePool({ query: "同一问题", assistContext: "甲", mentionedEntityIds: ["2"] });
  const sharedB = service.getSharedCandidatePool({ query: "同一问题", assistContext: "乙", mentionedEntityIds: ["9"] });
  assert.equal(retrievalCalls, 2, "identical safe context retrieves once while different assist/entity context misses");
  assert.equal(sharedAHit.cacheHit, true);
  assert.notDeepEqual(sharedA.candidates, sharedB.candidates);
  assert.equal(Object.hasOwn(sharedA, "context"), false, "shared pool does not expose the legacy Prompt context");

  const observedCandidate = { factId: "observed:secret", entityId: "9", field: "PRIVATE_PLAN", value: "直接观察秘密", sourceTier: "GAME_TRUTH", knowledgeLevel: "DIRECT_OBSERVATION", observationEvidenceComplete: true };
  service.getSharedCandidatePool = () => ({ key: "shared", candidates: [observedCandidate], cacheHit: true, subjectId: "9", checkpointId: "checkpoint", queryFingerprint: "q" });
  const observed = service.getSubjectiveWorldView({ responderId: "1", query: "q", conversationId: "c", turnEpoch: 1, sceneRevision: 1, presenceRevision: 1, directObservationFactIds: ["observed:secret"] });
  const unobserved = service.getSubjectiveWorldView({ responderId: "1", query: "q", conversationId: "c", turnEpoch: 1, sceneRevision: 1, presenceRevision: 1, directObservationFactIds: [] });
  assert(observed.allowedFacts.some((fact) => fact.value === "直接观察秘密"));
  assert.equal(unobserved.cacheHit, false, "direct-observation authorization is part of the cache key");
  assert(!JSON.stringify(unobserved).includes("直接观察秘密"));
  assert.equal(service.getSubjectiveWorldView({ responderId: "999", query: "q" }), null, "unknown responders are rejected before memory lookup");

  const memoryOwner = service.getSubjectiveWorldView({ responderId: "1", query: "q", conversationId: "memory", turnEpoch: 20 });
  assert(memoryOwner.allowedFacts.some((fact) => fact.contentRef === "memory-secret"));
  service.memoryEngine.known = [];
  const memoryRevoked = service.getSubjectiveWorldView({ responderId: "1", query: "q", conversationId: "memory", turnEpoch: 20 });
  assert.equal(memoryRevoked.cacheHit, false, "knownBy withdrawal invalidates the responder cache");
  assert(!JSON.stringify(memoryRevoked).includes("memory-secret"));

  for (let turnEpoch = 2; turnEpoch <= 10; turnEpoch++) service.getSubjectiveWorldView({ responderId: "1", query: "q", conversationId: "c", turnEpoch, sceneRevision: turnEpoch, presenceRevision: turnEpoch });
  const responderEntries = [...service.worldKnowledgeState.subjectiveViewCache.values()].filter((entry) => entry.responderId === "1");
  assert(responderEntries.length <= 8, "subjective cache is capped at eight entries per responder");
  service.dispose();
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("V8.6 Sol Stage 4 Safety: PASS (secret, temporal, scope, cache, DTO and Phase A boundaries)");
