"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { createUsageAnalytics } = require(path.join(root, "resources", "app", "out", "main", "analytics", "usage-analytics.js"));
const retention = require(path.join(root, "resources", "app", "out", "main", "usage-analytics-retention.js"));
let stored = null;
const memoryFs = {
  existsSync: () => stored !== null,
  readFileSync: () => stored,
  mkdirSync() {},
  writeFileSync: (_file, content) => { stored = content; }
};
const UsageAnalytics = createUsageAnalytics({
  fs: memoryFs,
  dataDir: "memory",
  analyticsFile: "memory/usage.json",
  retention,
  createPromptFingerprint: (value) => String(value || "").length.toString(16)
});
const analytics = new UsageAnalytics();

analytics.record({ requestType: "action", actionStage: "stage_b", actionSystemMode: "precision" }, { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 });
analytics.record({ requestType: "action", actionStage: "social_consequence_judge", actionSystemMode: "precision" }, { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 });
for (const [metric, metricValue] of Object.entries({
  dialogueEvidence: 2,
  confirmedWorldEventEvidence: 1,
  memoryEvidence: 3,
  knowledgeGateRejected: 1,
  unconfirmedClaimRejected: 2,
  localConsequences: 4,
  precisionSocialJudgeCalls: 1,
  opinionActions: 3,
  relationshipTransitions: 1,
  observerEffects: 2,
  cooldownSuppressed: 1,
  diminishingReturnSuppressed: 2,
  validatorRejected: 3,
  socialContextBuildTimeMs: 7
})) {
  analytics.record({ requestType: "social_consequence_metric", actionSystemMode: "precision", metric, metricValue }, null);
}

const report = analytics.getReport();
assert.strictEqual(report.actionEngine3.actionApiCalls, 2, "diagnostic social metrics must not count as Action API calls");
assert.deepStrictEqual(report.actionEngine3.socialConsequence, {
  dialogueEvidence: 2,
  confirmedWorldEventEvidence: 1,
  memoryEvidence: 3,
  knowledgeGateRejected: 1,
  unconfirmedClaimRejected: 2,
  localConsequences: 4,
  precisionSocialJudgeCalls: 1,
  opinionActions: 3,
  relationshipTransitions: 1,
  observerEffects: 2,
  cooldownSuppressed: 1,
  diminishingReturnSuppressed: 2,
  validatorRejected: 3,
  socialContextBuildTimeMs: 7
});
assert.deepStrictEqual(
  {
    requests: report.actionEngine3.modeTokenUsage.precision.stages.socialJudge.requests,
    totalTokens: report.actionEngine3.modeTokenUsage.precision.stages.socialJudge.totalTokens
  },
  { requests: 1, totalTokens: 50 },
  "Social Judge usage must be attributed to the Precision mode and its own stage"
);

const renderer = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
const functionStart = renderer.indexOf("const buildSocialConsequenceRows =");
const functionEnd = renderer.indexOf("const OptimizationView =", functionStart);
assert(functionStart >= 0 && functionEnd > functionStart, "renderer must expose the pure Social Consequence row builder used by the UI");
const declaration = renderer.slice(functionStart, functionEnd).trim().replace(/^const buildSocialConsequenceRows\s*=\s*/, "").replace(/;$/, "");
const buildRows = Function(`return (${declaration});`)();
const rows = buildRows(report.actionEngine3.socialConsequence, (_zh, en) => en, (value) => String(value ?? 0));
assert.strictEqual(rows.length, 6, "collapsed Social Consequence panel must keep six compact primary rows");
assert(rows.some((row) => row[0].includes("Evidence") && row[1] === "2 / 1 / 3"));
assert(rows.some((row) => row[0].includes("Precision Social Judge") && row[1] === "1"));
assert(renderer.includes('jsxRuntimeExports.jsxs("details", { className: "optimization-capability-details social-consequence-details"'), "Social Consequence must use a native details element");
assert(renderer.includes('jsxRuntimeExports.jsx("summary", { children: "SOCIAL CONSEQUENCE" }'), "collapsed panel must use the requested title");
assert(!renderer.includes('className: "optimization-capability-details social-consequence-details", open:'), "Social Consequence details must be closed by default");

console.log("VOTC v7.9.2 Social Consequence analytics and folded UI: PASS");
