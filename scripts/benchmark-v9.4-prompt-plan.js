"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { BASELINE_COMMIT, CASES, createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_MAIN_DIR = path.join(ROOT, ".build", "v9.4-construction", "baseline-source-2330", "src", "app", "main");
const CURRENT_MAIN_DIR = path.join(ROOT, "src", "app", "main");
const OUTPUT_PATH = path.join(ROOT, ".build", "v9.4-construction", "performance.json");
const EXPECTED_BASELINE_PROMPT_BUILDER_BLOB = "e33f7c7ef17b56fd31c0adfa3cd0b8e25f99f785";
const WARMUP_COUNT = 10;
const SAMPLE_COUNT = 100;

function gitBlobSha1(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const nearestRank = percentile => sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
  const roundMs = value => Number(value.toFixed(3));
  return {
    sampleCount: samples.length,
    p50Ms: roundMs(nearestRank(0.5)),
    p95Ms: roundMs(nearestRank(0.95))
  };
}

function measure(samples, action) {
  const start = performance.now();
  action();
  samples.push(performance.now() - start);
}

function buildFunction(runtime, fixture, mode) {
  return () => runtime.PromptBuilder.buildMessagesWithTokenCount(
    fixture.history,
    fixture.responder,
    fixture.gameData,
    fixture.currentSessionSummary,
    fixture.memoryContext,
    fixture.definition.providerConfig,
    ...(mode ? [{ promptPlanMode: mode }] : [])
  );
}

function makeCase(definition, modules) {
  const baselineFixture = createFixture(definition.id);
  const currentFixture = createFixture(definition.id);
  const baselineRuntime = createPromptRuntime(BASELINE_MAIN_DIR, baselineFixture);
  const currentRuntime = createPromptRuntime(CURRENT_MAIN_DIR, currentFixture);
  return {
    id: definition.id,
    baselineBuild: buildFunction(baselineRuntime, baselineFixture, null),
    currentBuild: buildFunction(currentRuntime, currentFixture, "v9"),
    modules,
    lastCurrent: null
  };
}

function makePreflight(caseState, modules) {
  const built = caseState.lastCurrent;
  assert(built?.promptPlan && built?.serialized, `${caseState.id}: current builder must produce a serialized Plan`);
  const plan = built.promptPlan;
  const messages = built.serialized.messages;
  const snapshot = modules.createEffectiveRequestSnapshot({
    requestType: plan.requestType,
    providerType: plan.providerRoute.providerType,
    protocol: "openai_chat_completions",
    endpoint: "https://fixture.invalid/v1/chat/completions",
    stream: false,
    payload: { model: plan.providerRoute.modelId, messages, stream: false, max_tokens: 128 },
    adapterInputMessagesFingerprint: modules.fingerprintMessages(messages),
    planStatus: "PROMPT_PLAN_V9",
    ownerEvidence: "PRESENT"
  });
  const proof = { plan, serialized: built.serialized, ownerEvidence: true };
  let sourceVerifierCalls = 0;
  return {
    action: () => modules.preflightPromptPlan({
      snapshot,
      proof,
      budget: { safe: true },
      expectedScope: plan.scope,
      proofVerifier: () => { sourceVerifierCalls++; return true; }
    }),
    verifierCallCount: () => sourceVerifierCalls
  };
}

function main() {
  assert.equal(BASELINE_COMMIT, "2330bbcb6c068a4e42c19b26eba82f4034e6db63");
  const baselinePromptBuilderPath = path.join(BASELINE_MAIN_DIR, "prompts", "prompt-builder.js");
  assert(fs.existsSync(baselinePromptBuilderPath), "the extracted pinned baseline source snapshot must exist");
  const baselineBytes = fs.readFileSync(baselinePromptBuilderPath);
  assert.equal(gitBlobSha1(baselineBytes), EXPECTED_BASELINE_PROMPT_BUILDER_BLOB,
    "the baseline PromptBuilder file must match the pinned Git blob");

  const planFiles = [
    "prompts/prompt-builder.js",
    "prompts/prompt-plan-builder.js",
    "prompts/prompt-plan-compat.js",
    "prompts/prompt-plan-contract.js",
    "prompts/prompt-plan-layouts.js",
    "prompts/prompt-plan-prefix.js",
    "prompts/prompt-plan-serializer.js",
    "providers/effective-request.js"
  ];
  const currentSourceFingerprint = sha256(Buffer.from(planFiles.map(file => {
    const bytes = fs.readFileSync(path.join(CURRENT_MAIN_DIR, file));
    return `${file}\0${sha256(bytes)}\n`;
  }).join(""), "utf8"));

  const modules = {
    serializePromptPlan: require(path.join(CURRENT_MAIN_DIR, "prompts", "prompt-plan-serializer.js")).serializePromptPlan,
    preflightPromptPlan: require(path.join(CURRENT_MAIN_DIR, "prompts", "prompt-plan-compat.js")).preflightPromptPlan,
    ...require(path.join(CURRENT_MAIN_DIR, "providers", "effective-request.js"))
  };
  const prepared = CASES.map(definition => makeCase(definition, modules));

  // Warm the pinned baseline first, then the current Plan path, before paired samples.
  for (const item of prepared) for (let index = 0; index < WARMUP_COUNT; index++) item.baselineBuild();
  for (const item of prepared) {
    for (let index = 0; index < WARMUP_COUNT; index++) item.lastCurrent = item.currentBuild();
    item.preflight = makePreflight(item, modules);
    for (let index = 0; index < WARMUP_COUNT; index++) {
      modules.serializePromptPlan(item.lastCurrent.promptPlan, {
        layoutId: item.lastCurrent.promptPlan.layoutId,
        profileId: item.lastCurrent.promptPlan.promptProfileId
      });
      item.preflight.action();
    }
  }

  const samples = new Map(prepared.map(item => [item.id, {
    baselineBuild: [], currentBuild: [], serializer: [], preflight: []
  }]));
  for (let iteration = 0; iteration < SAMPLE_COUNT; iteration++) {
    for (const item of prepared) {
      const sample = samples.get(item.id);
      measure(sample.baselineBuild, item.baselineBuild);
      measure(sample.currentBuild, () => { item.lastCurrent = item.currentBuild(); });
      measure(sample.serializer, () => modules.serializePromptPlan(item.lastCurrent.promptPlan, {
        layoutId: item.lastCurrent.promptPlan.layoutId,
        profileId: item.lastCurrent.promptPlan.promptProfileId
      }));
      measure(sample.preflight, item.preflight.action);
    }
  }

  const cases = prepared.map(item => {
    const sample = samples.get(item.id);
    const baselineBuild = summarize(sample.baselineBuild);
    const currentBuild = summarize(sample.currentBuild);
    return {
      id: item.id,
      build: {
        baseline: baselineBuild,
        currentV9: currentBuild,
        absoluteDeltaMs: {
          p50: Number((currentBuild.p50Ms - baselineBuild.p50Ms).toFixed(3)),
          p95: Number((currentBuild.p95Ms - baselineBuild.p95Ms).toFixed(3))
        }
      },
      currentV9Stages: {
        pureSerializer: summarize(sample.serializer),
        mockSourceVerifierPreflight: summarize(sample.preflight),
        mockSourceVerifierCalls: item.preflight.verifierCallCount()
      }
    };
  });

  const report = {
    schemaVersion: "v9.4_prompt_plan_offline_performance_v1",
    baselineCommit: BASELINE_COMMIT,
    baselinePromptBuilderBlob: EXPECTED_BASELINE_PROMPT_BUILDER_BLOB,
    currentPromptPlanSourceFingerprint: currentSourceFingerprint,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    measurement: {
      caseCount: CASES.length,
      warmupRunsPerBuilderAndCase: WARMUP_COUNT,
      pairedBuildSamplesPerVersionAndCase: SAMPLE_COUNT,
      pairingOrder: "baseline_then_current_v9",
      clock: "performance.now",
      outputUnit: "milliseconds",
      percentile: "nearest_rank",
      participantCountInFixtures: 2,
      contextWindowScenarios: "not_measured"
    },
    stageDefinitions: {
      build: "PromptBuilder.buildMessagesWithTokenCount; baseline is the pinned legacy PromptBuilder, current uses promptPlanMode=v9 and includes its normal plan serialization",
      pureSerializer: "Current V9 serializePromptPlan on an already-built Plan; baseline has no equivalent serializer, so no cross-version delta is computed",
      mockSourceVerifierPreflight: "Current V9 preflightPromptPlan with a verifier callback that returns true; includes Plan validation and serialization checks, performs no source-file reads and no Provider transport",
      providerBudget: "preflight budget is a literal safe fixture; 128K, 192K and low-window effective-budget planning are not benchmarked",
      cacheEvidence: "not measured; these timings do not establish provider cache hits or a cache PASS"
    },
    cases
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote scrubbed offline benchmark: ${path.relative(ROOT, OUTPUT_PATH)} (${cases.length} cases, ${SAMPLE_COUNT} paired samples per version)\n`);
}

main();
