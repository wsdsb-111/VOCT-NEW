"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { buildMemoryAttemptDiagnostics: build, projectMemoryAttemptDiagnostics: project } = require("../src/app/main/memory-system/player-memory-diagnostics");
const { resolveTemporalFocus } = require("../src/app/main/memory-system/fuzzy-temporal-resolver");
const { createProviderDiagnostics } = require("../src/app/main/analytics/provider-diagnostics");
const { createUsageAnalytics } = require("../src/app/main/analytics/usage-analytics");
const retention = require("../src/app/main/usage-analytics-retention");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const context = { respondingCharacterId: 2, playerAnchorId: 1, conversationId: "synthetic", sourceCampaignToken: "campaign",
  sourceSceneRevision: "scene", sourceGameDate: "1200.1.1", tokenBudget: 4800, sourceFolderRevision: 1,
  sourceForgetFingerprint: "forget", sourceOfficialFingerprint: "official", selectedTokens: 4,
  thirdPersonDecision: { level: "L1", targetCharacterIds: [3], targetEvidence: {}, logicalQueryFingerprint: hash("query") },
  pairMemoryMetrics: { trustedPlayerTurnResolved: true }, direct: [{ memory: { memoryId: "summary-a" }, sourceRevision: 1 }],
  pairMemoryItems: [{ itemId: "item-a", source: { sourceSummaryKey: "key-a", sourceRevision: 1 }, targetCharacterId: 3 }] };
const promptBuild = { blocks: [{ block: { id: "memory-direct-frozen" }, content: "PRIVATE_SENTINEL", tokens: 4 },
  { block: { id: "conversation-history" }, content: "NOT_MEMORY", tokens: 7 }], ageDiagnostics: [{ characterIdHash: hash("3"),
    ageSource: "CK3_CURRENT_AGE", rawAge: 17, calculatedCalendarAge: 18, ageConflict: true, asOfGameDate: "1200.1.1" }] };
const original = build({ memoryContext: context, promptBuild, logicalPlayerMessageId: "player-message", attemptEpoch: 1 });
assert.equal(original.memoryInjectionDigest, hash(JSON.stringify([["memory-direct-frozen", hash("PRIVATE_SENTINEL"), 4]])));
for (let attemptEpoch = 2; attemptEpoch <= 6; attemptEpoch++) assert.equal(build({ memoryContext: context, promptBuild,
  logicalPlayerMessageId: "player-message", attemptEpoch, previous: original }).comparisonStatus, "MATCH");
function changed(patch, expected, prompt = promptBuild) {
  assert.equal(build({ memoryContext: { ...context, ...patch }, promptBuild: prompt, logicalPlayerMessageId: "player-message",
    attemptEpoch: 8, previous: original }).comparisonStatus, expected);
}
changed({ sourceGameDate: "1200.1.2" }, "SNAPSHOT_CHANGED");
changed({ sourceOfficialFingerprint: "changed" }, "SOURCE_CHANGED");
changed({ direct: [{ memory: { memoryId: "different" }, sourceRevision: 1 }] }, "SOURCE_CHANGED");
changed({ thirdPersonDecision: { ...context.thirdPersonDecision, logicalQueryFingerprint: hash("edited") } }, "AUTHORIZATION_CHANGED");
changed({}, "PROMPT_INJECTION_CHANGED", { blocks: [{ block: { id: "memory-direct-frozen" }, content: "changed", tokens: 4 }] });
const safe = project({ ...original, rawSummary: "PRIVATE_SENTINEL", name: "PRIVATE_NAME", filePath: "PRIVATE_PATH" });
assert.equal(safe.ageSourceConflictCount, 1);
assert(!JSON.stringify(safe).includes("PRIVATE_"));
assert.equal(project({ memoryInjectionDigest: "invalid", attemptEpoch: -1 }).memoryInjectionDigest, null);
assert.equal(build().renderedMemoryTokens, 0);
const focus = resolveTemporalFocus("1199年发生过什么？", null, { currentGameDate: "1200.1.1", turnEpoch: 1,
  logicalTurnEpoch: 1, conversationId: "conv", sceneRevision: "scene" }).nextFocus;
assert(focus);
const follow = { currentGameDate: "1200.1.1", turnEpoch: 40, logicalTurnEpoch: 2, conversationId: "conv", sceneRevision: "scene" };
assert.equal(resolveTemporalFocus("那一年呢？", focus, follow).focusReused, true);
assert.equal(resolveTemporalFocus("那一年呢？", focus, { ...follow, logicalTurnEpoch: 5 }).focusReused, false);
const root = fs.mkdtempSync(path.resolve(".build/v9363i-observability-"));
try {
  const Diagnostics = createProviderDiagnostics({ fs, path, dataDir: root });
  const diagnostics = new Diagnostics();
  diagnostics.recordResponse({ provider: "synthetic", model: "offline", requestType: "chat", metadata: { memoryAttemptDiagnostics: { ...safe, rawSummary: "PRIVATE_SENTINEL" } } });
  diagnostics.recordResponse({ provider: "synthetic", model: "offline", requestType: "chat", metadata: { memoryAttemptDiagnostics: build() } });
  const rows = diagnostics.getMemoryAttemptComparisons();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].groundingStatus, "NOT_EVALUATED");
  assert.equal(rows[1].logicalPlayerMessageIdHash, null);
  const exported = JSON.parse(fs.readFileSync(diagnostics.exportRealRequestDiff().path, "utf8"));
  assert.equal(exported.memoryAttemptComparisons.length, 2);
  assert(!JSON.stringify(exported).includes("PRIVATE_"));
  const Analytics = createUsageAnalytics({ fs, dataDir: root, analyticsFile: path.join(root, "usage.json"), retention,
    createPromptFingerprint: () => hash("prompt") });
  const analytics = new Analytics();
  analytics.record({ requestType: "chat", memoryAttemptDiagnostics: { ...safe, rawSummary: "PRIVATE_SENTINEL" } }, { prompt_tokens: 4, completion_tokens: 1 });
  assert.equal(analytics.read().entries[0].memoryAttemptDiagnostics.memoryInjectionDigest, original.memoryInjectionDigest);
  assert(!JSON.stringify(analytics.read()).includes("PRIVATE_"));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log("PASS integrated recall observability: digest comparison, privacy, export, age conflict, logical focus");
