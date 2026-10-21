"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { validateGenerationOutcome } = require("../resources/app/out/main/providers/generation-outcome");

const root = path.resolve(__dirname, "..");
const snapshotRoot = path.join(root, ".build", "v923-glm-native-usage-baselines");
const sourceVersionPath = path.join(root, "src", "app", "main", "version.js");
const sourcePackagePath = path.join(root, "src", "app", "package.json");
const commits = [
  { id: "v9.2.1", sha: "edb389623ba34e8a668779b74509d8f1b2bf78cb" },
  { id: "v9.2.2", sha: "071f62b73d27cf4bd37309e5e836335f914c174d" }
];
const files = [
  "src/app/main/providers/index.js",
  "resources/app/out/main/providers/index.js",
  "resources/app/out/main/providers/usage-normalization.js",
  "resources/app/out/main/version.js",
  "resources/app/package.json"
];
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const normalizeEol = value => Buffer.from(value.toString("utf8").replace(/\r\n?/g, "\n"), "utf8");

function readGitFile(commit, relativePath) {
  return execFileSync("git", ["show", `${commit.sha}:${relativePath}`], { cwd: root, encoding: "buffer", maxBuffer: 4 * 1024 * 1024 });
}

function writeExact(filePath, bytes) {
  const resolved = path.resolve(filePath);
  assert(resolved.startsWith(`${snapshotRoot}${path.sep}`), "baseline_snapshot_must_stay_under_build_directory");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  if (fs.existsSync(resolved)) {
    assert(fs.readFileSync(resolved).equals(bytes), `locked_baseline_mismatch:${path.relative(snapshotRoot, resolved)}`);
    return;
  }
  fs.writeFileSync(resolved, bytes, { flag: "wx" });
  assert(fs.readFileSync(resolved).equals(bytes), `baseline_copy_not_byte_exact:${path.relative(snapshotRoot, resolved)}`);
}

function materializeBaselines() {
  for (const commit of commits) {
    assert.strictEqual(execFileSync("git", ["rev-parse", commit.sha], { cwd: root, encoding: "utf8" }).trim(), commit.sha,
      `${commit.id}_commit_identity_changed`);
    for (const relativePath of files) writeExact(path.join(snapshotRoot, commit.id, relativePath), readGitFile(commit, relativePath));
    assert(normalizeEol(readGitFile(commit, "src/app/main/providers/index.js"))
      .equals(normalizeEol(readGitFile(commit, "resources/app/out/main/providers/index.js"))),
    `${commit.id}_provider_source_differs_from_deployed_beyond_eol`);
  }
}

function loadProvider(commitId) {
  if (commitId === "candidate-src") {
    const modulePath = path.join(root, "src", "app", "main", "providers", "index.js");
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath).ZhipuProvider;
  }
  const modulePath = path.join(snapshotRoot, commitId, "resources/app/out/main/providers/index.js");
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath).ZhipuProvider;
}

function installMockSdk() {
  const originalLoad = Module._load;
  let capture = null;
  class MockOpenAI {
    constructor(options) {
      assert(capture, "SDK_client_created_without_an_active_fixture");
      capture.clientJson = JSON.stringify(options);
      this.chat = {
        completions: {
          create: async request => {
            assert(capture, "SDK_create_called_without_an_active_fixture");
            capture.bodyJson = JSON.stringify(request);
            capture.body = JSON.parse(capture.bodyJson);
            capture.calls++;
            assert.strictEqual(request.stream, true, "stream_tail_fixture_must_use_streaming_transport");
            return (async function* () {
              yield { id: "synthetic-usage-stream", choices: [{ delta: { role: "assistant", content: "Synthetic reply." }, finish_reason: null }] };
              yield {
                id: "synthetic-usage-stream",
                choices: [],
                usage: {
                  prompt_tokens: 100,
                  completion_tokens: 5,
                  total_tokens: 105,
                  prompt_tokens_details: { cached_tokens: 0 },
                  completion_tokens_details: { reasoning_tokens: 2 }
                }
              };
            })();
          }
        }
      };
    }
  }
  MockOpenAI.APIError = class APIError extends Error {};
  Module._load = function(request, parent, isMain) {
    if (request === "openai") return MockOpenAI;
    // Resolve the source version module's deployment-mapped package metadata without editing source.
    if (request === "../../package.json" && path.resolve(parent?.filename || "") === sourceVersionPath) {
      return JSON.parse(fs.readFileSync(sourcePackagePath, "utf8"));
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return {
    begin() {
      assert.strictEqual(capture, null, "mock_sdk_fixture_must_not_overlap");
      capture = { calls: 0 };
      return capture;
    },
    end() {
      const result = capture;
      capture = null;
      return result;
    },
    restore() {
      Module._load = originalLoad;
      capture = null;
    }
  };
}

async function collectFinal(stream) {
  const iterator = stream[Symbol.asyncIterator]();
  const chunks = [];
  while (true) {
    const step = await iterator.next();
    if (step.done) return { chunks, final: step.value };
    chunks.push(step.value);
  }
}

async function checkCommit(commit, mockSdk) {
  const ZhipuProvider = loadProvider(commit.id);
  const provider = new ZhipuProvider();
  const zero = provider.normalizeUsage({
    prompt_tokens: 100,
    completion_tokens: 10,
    total_tokens: 110,
    prompt_tokens_details: { cached_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 4 }
  });
  assert.strictEqual(zero.prompt_cache_hit_tokens, 0, `${commit.id}:reported_zero_is_not_unknown`);
  assert.strictEqual(zero.prompt_cache_miss_tokens, 100, `${commit.id}:zero_hit_miss_normalization`);
  assert.strictEqual(zero.cache_reporting_status, "reported", `${commit.id}:zero_has_native_reporting`);
  assert.strictEqual(zero.reasoning_tokens, 4, `${commit.id}:reasoning_from_completion_details`);
  assert.strictEqual(zero.visible_completion_tokens, 6, `${commit.id}:visible_completion_excludes_reasoning_once`);

  const unknown = provider.normalizeUsage({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 });
  assert.strictEqual(unknown.prompt_cache_hit_tokens, null, `${commit.id}:missing_native_cache_is_unknown`);
  assert.strictEqual(unknown.prompt_cache_miss_tokens, null, `${commit.id}:unknown_cache_does_not_infer_miss`);
  assert.strictEqual(unknown.cache_reporting_status, "not_reported", `${commit.id}:missing_cache_is_not_reported`);
  assert.strictEqual(unknown.reasoning_tokens, 0, `${commit.id}:missing_reasoning_is_zero_only_for_reasoning_field`);

  const emptyUnknown = provider.normalizeUsage({
    prompt_tokens: 100,
    completion_tokens: 10,
    total_tokens: 110,
    prompt_tokens_details: { cached_tokens: "" },
    completion_tokens_details: { reasoning_tokens: "" }
  });
  assert.strictEqual(emptyUnknown.prompt_cache_hit_tokens, null, `${commit.id}:empty_native_count_is_unknown`);
  assert.strictEqual(emptyUnknown.cache_reporting_status, "not_reported", `${commit.id}:empty_native_count_status`);
  assert.strictEqual(emptyUnknown.reasoning_tokens, 0, `${commit.id}:empty_reasoning_normalization`);

  const config = {
    providerType: "zhipu",
    apiKey: "synthetic-fixture-key",
    baseUrl: "https://example.invalid/api/paas/v4",
    defaultModel: "glm-5.3-flash",
    glmReasoningEffort: "low",
    glmClearThinking: true
  };
  const request = {
    model: "glm-5.3-flash",
    messages: [
      { role: "system", content: "Synthetic public fixture; do not infer private facts." },
      { role: "user", name: "synthetic_context", content: "Synthetic usage-tail fixture." }
    ],
    stream: true,
    temperature: 0.7,
    top_p: 0.9,
    presence_penalty: 0,
    frequency_penalty: 0,
    max_tokens: 128
  };
  const capture = mockSdk.begin();
  let result;
  try {
    result = await collectFinal(provider.chatCompletion(request, config));
  } finally {
    mockSdk.end();
  }
  assert.strictEqual(capture.calls, 1, `${commit.id}:single_mock_sdk_call`);
  assert(capture.clientJson, `${commit.id}:real_adapter_constructed_sdk_client`);
  assert(capture.bodyJson, `${commit.id}:real_adapter_called_sdk_create`);
  assert.strictEqual(capture.body.stream_options.include_usage, true, `${commit.id}:usage_tail_requested_on_stream`);
  assert.strictEqual(capture.body.max_tokens, 128, `${commit.id}:stream_wire_max_tokens`);
  const contentChunks = result.chunks.filter(chunk => chunk.delta?.content);
  const usageOnlyChunks = result.chunks.filter(chunk => !chunk.delta?.content && chunk.usage !== void 0);
  assert.strictEqual(contentChunks.length, 1, `${commit.id}:single_content_chunk_survives`);
  assert.strictEqual(result.chunks.length, commit.id === "candidate-src" ? 2 : 1, `${commit.id}:legacy_or_candidate_stream_event_count`);
  assert.strictEqual(usageOnlyChunks.length, commit.id === "candidate-src" ? 1 : 0, `${commit.id}:usage_only_is_an_independent_candidate_event`);
  assert.strictEqual(contentChunks[0].delta.content, "Synthetic reply.", `${commit.id}:content_chunk_survives`);
  assert.strictEqual(contentChunks[0].finish_reason, null, `${commit.id}:legacy_stream_keeps_missing_terminal_fixture`);
  assert.strictEqual(result.final.content, "Synthetic reply.", `${commit.id}:stream_final_content`);
  assert.strictEqual(result.final.finish_reason, null, `${commit.id}:stream_final_keeps_missing_terminal_fixture`);
  if (commit.id === "candidate-src") {
    assert.strictEqual(validateGenerationOutcome(result.final, { providerType: "zhipu" }).status, "UNKNOWN",
      `${commit.id}:missing_finish_remains_strictly_unknown`);
    assert.strictEqual(usageOnlyChunks[0].finish_reason, null, `${commit.id}:usage_only_is_not_terminal`);
    assert.strictEqual(usageOnlyChunks[0].usage.prompt_tokens, 100, `${commit.id}:usage_only_contains_native_usage`);
  }
  assert(result.final.usage, `${commit.id}:usage_only_tail_survives_stream_adapter`);
  assert.strictEqual(result.final.usage.prompt_cache_hit_tokens, 0, `${commit.id}:tail_zero_cache_hit`);
  assert.strictEqual(result.final.usage.prompt_cache_miss_tokens, 100, `${commit.id}:tail_cache_miss`);
  assert.strictEqual(result.final.usage.cache_reporting_status, "reported", `${commit.id}:tail_cache_status`);
  assert.strictEqual(result.final.usage.reasoning_tokens, 2, `${commit.id}:tail_reasoning_tokens`);
  assert.strictEqual(result.final.usage.visible_completion_tokens, 3, `${commit.id}:tail_visible_completion_tokens`);
  assert.strictEqual(result.final.usage_debug.raw_usage.prompt_tokens_details.cached_tokens, 0, `${commit.id}:tail_raw_zero_retained`);
  assert.strictEqual(result.final.usage_debug.raw_usage.completion_tokens_details.reasoning_tokens, 2, `${commit.id}:tail_raw_reasoning_retained`);

  return {
    zero,
    unknown,
    emptyUnknown,
    streamTail: {
      clientJson: capture.clientJson,
      bodyJson: capture.bodyJson,
      chunks: result.chunks,
      final: result.final
    }
  };
}

async function main() {
  materializeBaselines();
  const mockSdk = installMockSdk();
  const originalLog = console.log;
  console.log = () => {};
  try {
    const targets = [...commits, { id: "candidate-src" }];
    const results = [];
    for (const target of targets) results.push({ target, result: await checkCommit(target, mockSdk) });
    const referenceBytes = Buffer.from(JSON.stringify(results[0].result), "utf8");
    const legacyBytes = Buffer.from(JSON.stringify(results[1].result), "utf8");
    assert(referenceBytes.equals(legacyBytes), "v9.2.1_and_v9.2.2_native_usage_fixtures_must_remain_byte_for_byte_frozen");
    const canonical = result => {
      const final = { ...result.streamTail.final };
      if (final.usage_debug && typeof final.usage_debug === "object") {
        const legacyUsageDebug = { ...final.usage_debug };
        delete legacyUsageDebug.native_usage_evidence;
        final.usage_debug = legacyUsageDebug;
      }
      return {
        zero: result.zero,
        unknown: result.unknown,
        emptyUnknown: result.emptyUnknown,
        streamTail: { bodyJson: result.streamTail.bodyJson, final }
      };
    };
    for (const { target, result } of results.slice(2)) {
      assert.deepEqual(canonical(result), canonical(results[0].result), `${target.id}:canonical_native_usage_has_no_synthetic_counts`);
      assert.deepEqual(result.streamTail.final.usage_debug?.native_usage_evidence, {
        prompt_tokens: { present: true, value: 100 },
        completion_tokens: { present: true, value: 5 },
        total_tokens: { present: true, value: 105 },
        prompt_tokens_details: { cached_tokens: { present: true, value: 0 } },
        completion_tokens_details: { reasoning_tokens: { present: true, value: 2 } }
      }, `${target.id}:native_usage_evidence_matches_the_raw_provider_fixture`);
      assert.strictEqual(JSON.parse(result.streamTail.clientJson).maxRetries, 0, `${target.id}:sdk_hidden_retries_disabled`);
    }
    const digest = sha256(referenceBytes);
    originalLog(`V9.2.3 GLM native usage PASS: runtimeTargets=${results.length}, targets=v9.2.1/v9.2.2/candidate-src, fixturesPerTarget=4, streamTail=retained, reportedZero=0, missingCache=UNKNOWN, reasoning=normalized, resultSHA256=${digest}, sdk=mock, network=0`);
  } finally {
    console.log = originalLog;
    mockSdk.restore();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
