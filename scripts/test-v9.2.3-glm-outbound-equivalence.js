"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const snapshotRoot = path.join(root, ".build", "v923-glm-outbound-baselines");
const sourceVersionPath = path.join(root, "src", "app", "main", "version.js");
const sourcePackagePath = path.join(root, "src", "app", "package.json");
const commits = [
  { id: "v9.2.1", sha: "edb389623ba34e8a668779b74509d8f1b2bf78cb" },
  { id: "v9.2.2", sha: "071f62b73d27cf4bd37309e5e836335f914c174d" }
];
const files = [
  "src/app/main/provider-service.js",
  "src/app/main/providers/index.js",
  "resources/app/out/main/provider-service.js",
  "resources/app/out/main/providers/index.js",
  "resources/app/out/main/token-estimator.js",
  "resources/app/out/main/providers/request-budget.js",
  "resources/app/out/main/providers/usage-normalization.js",
  "resources/app/out/main/actions/action-prompt-compatibility-overlay.js",
  "resources/app/out/main/version.js",
  "resources/app/package.json"
];
const comparedRuntimeFiles = [
  ["src/app/main/provider-service.js", "resources/app/out/main/provider-service.js"],
  ["src/app/main/providers/index.js", "resources/app/out/main/providers/index.js"]
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
  const inventory = [];
  for (const commit of commits) {
    const resolvedSha = execFileSync("git", ["rev-parse", commit.sha], { cwd: root, encoding: "utf8" }).trim();
    assert.strictEqual(resolvedSha, commit.sha, `${commit.id}_commit_identity_changed`);
    for (const relativePath of files) {
      const bytes = readGitFile(commit, relativePath);
      writeExact(path.join(snapshotRoot, commit.id, relativePath), bytes);
      inventory.push({ commit: commit.id, path: relativePath, bytes: bytes.length, sha256: sha256(bytes) });
    }
    for (const [sourcePath, deployedPath] of comparedRuntimeFiles) {
      assert(normalizeEol(readGitFile(commit, sourcePath)).equals(normalizeEol(readGitFile(commit, deployedPath))),
        `${commit.id}_${sourcePath}_differs_from_deployed_beyond_eol`);
    }
  }
  const manifest = `${JSON.stringify({ schemaVersion: 1, commits, files: inventory }, null, 2)}\n`;
  writeExact(path.join(snapshotRoot, "manifest.json"), Buffer.from(manifest, "utf8"));
}

function loadCommitModule(commitId, relativePath) {
  const modulePath = path.join(snapshotRoot, commitId, relativePath);
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

function buildMessages(TokenCounter, targetTokens, identity) {
  const messages = [
    { role: "system", content: "Synthetic public fixture. Follow the current request and preserve the speaker's identity." },
    { role: "assistant", name: `npc_${identity.npc}`, content: `Synthetic prior history for npc_${identity.npc}.` },
    {
      role: "user",
      name: "synthetic_context",
      content: `campaign=${identity.campaign}; date=${identity.date}; npc=${identity.npc}; synthetic filler=`
    }
  ];
  const baseTokens = TokenCounter.calculateTotalTokens(messages);
  assert(targetTokens > baseTokens, "fixture_target_must_exceed_identity_header");
  messages[2].content += "S".repeat((targetTokens - baseTokens) * 4);
  assert.strictEqual(TokenCounter.calculateTotalTokens(messages), targetTokens, "fixture_size_must_use_runtime_token_estimator");
  return messages;
}

function drainStream(stream) {
  return (async () => {
    const iterator = stream[Symbol.asyncIterator]();
    let yielded = 0;
    while (true) {
      const step = await iterator.next();
      if (step.done) return { final: step.value, yielded };
      yielded++;
    }
  })();
}

function installMockSdk() {
  const originalLoad = Module._load;
  let activeCapture = null;
  class MockOpenAI {
    constructor(options) {
      assert(activeCapture, "SDK_client_created_without_an_active_fixture");
      activeCapture.clientJson = JSON.stringify(options);
      activeCapture.client = JSON.parse(activeCapture.clientJson);
      this.chat = {
        completions: {
          create: async request => {
            assert(activeCapture, "SDK_create_called_without_an_active_fixture");
            const bodyJson = JSON.stringify(request);
            activeCapture.bodyJson = bodyJson;
            activeCapture.body = JSON.parse(bodyJson);
            if (request.stream) {
              return (async function* () {
                yield { id: "synthetic-stream", choices: [{ delta: { role: "assistant", content: "Synthetic reply." }, finish_reason: "stop" }] };
                yield {
                  id: "synthetic-stream",
                  choices: [],
                  usage: {
                    prompt_tokens: 100,
                    completion_tokens: 2,
                    total_tokens: 102,
                    prompt_tokens_details: { cached_tokens: 0 },
                    completion_tokens_details: { reasoning_tokens: 1 }
                  }
                };
              })();
            }
            return {
              id: "synthetic-completion",
              choices: [{ message: { role: "assistant", content: "Synthetic reply." }, finish_reason: "stop" }],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 2,
                total_tokens: 102,
                prompt_tokens_details: { cached_tokens: 0 },
                completion_tokens_details: { reasoning_tokens: 1 }
              }
            };
          }
        }
      };
    }
  }
  MockOpenAI.APIError = class APIError extends Error {};
  Module._load = function(request, parent, isMain) {
    if (request === "openai") return MockOpenAI;
    // The source layout's version module resolves ../../package.json after deployment;
    // inject the mapped app package metadata while loading the exact current source file.
    if (request === "../../package.json" && path.resolve(parent?.filename || "") === sourceVersionPath) {
      return JSON.parse(fs.readFileSync(sourcePackagePath, "utf8"));
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return {
    begin() {
      assert.strictEqual(activeCapture, null, "mock_sdk_fixture_must_not_overlap");
      activeCapture = {};
      return activeCapture;
    },
    end() {
      const result = activeCapture;
      activeCapture = null;
      return result;
    },
    restore() {
      Module._load = originalLoad;
      activeCapture = null;
    }
  };
}

function makeRuntime(commitId, mockSdk) {
  const service = loadCommitModule(commitId, "resources/app/out/main/provider-service.js");
  const providers = loadCommitModule(commitId, "resources/app/out/main/providers/index.js");
  return makeRuntimeFromModules(service, providers, mockSdk);
}

function makeSourceRuntime(mockSdk) {
  const servicePath = path.join(root, "src", "app", "main", "provider-service.js");
  const providersPath = path.join(root, "src", "app", "main", "providers", "index.js");
  delete require.cache[require.resolve(servicePath)];
  delete require.cache[require.resolve(providersPath)];
  return makeRuntimeFromModules(require(servicePath), require(providersPath), mockSdk);
}

function makeRuntimeFromModules(service, providers, mockSdk) {
  const config = {
    providerType: "zhipu",
    customName: "Synthetic GLM fixture",
    instanceId: "synthetic-zhipu-v923",
    apiKey: "synthetic-fixture-key",
    baseUrl: "https://example.invalid/api/paas/v4",
    defaultModel: "glm-5.3-flash",
    customContextLength: 65536,
    customMaxOutputTokens: 8192,
    defaultParameters: {
      temperature: 0.63,
      top_p: 0.91,
      presence_penalty: 0.1,
      frequency_penalty: 0.2,
      max_tokens: 1537
    }
  };
  const settingsRepository = {
    getActiveProviderConfig: () => config,
    getGlobalStreamSetting: () => mockSdk.stream,
    getChatPromptV89Settings: () => ({ chatPromptV89OutboundDiagnostics: false })
  };
  const registry = new service.ProviderRegistry();
  registry.register("zhipu", providers.ZhipuProvider);
  const manager = new service.LLMManager({
    settingsRepository,
    providerRegistry: registry,
    usageAnalytics: { record() {} },
    providerDiagnostics: null,
    performanceTrace: null,
    durableRequestTrace: null,
    TokenCounter: service.TokenCounter,
    PromptBuilder: null
  });
  return { manager, TokenCounter: service.TokenCounter, config };
}

async function captureRequest(runtime, mockSdk, { messages, stream, reasoningEffort, clearThinking, outputMode }) {
  runtime.config.glmReasoningEffort = reasoningEffort;
  runtime.config.glmClearThinking = clearThinking;
  runtime.config.defaultParameters.response_format = outputMode === "json" ? { type: "json_object" } : undefined;
  mockSdk.stream = stream;
  const capture = mockSdk.begin();
  try {
    const result = await runtime.manager.sendChatRequest(messages, undefined, false, { requestType: "chat" });
    if (stream) await drainStream(result);
  } finally {
    mockSdk.end();
  }
  assert(capture.clientJson, "real_Zhipu_adapter_must_construct_mock_SDK_client");
  assert(capture.bodyJson, "real_LLMManager_path_must_reach_SDK_create");
  return {
    body: capture.body,
    bodyJson: capture.bodyJson,
    bodySha256: sha256(Buffer.from(capture.bodyJson, "utf8")),
    client: capture.client,
    clientJson: capture.clientJson,
    clientSha256: sha256(Buffer.from(capture.clientJson, "utf8"))
  };
}

function assertExpectedWire(result, { messages, stream, reasoningEffort, clearThinking, outputMode, label }) {
  const wire = result.body;
  assert.strictEqual(wire.model, "glm-5.3-flash", `${label}:model`);
  assert.deepStrictEqual(wire.messages, messages, `${label}:ordered_role_name_content`);
  assert.strictEqual(wire.stream, stream, `${label}:stream`);
  assert.strictEqual(wire.temperature, 0.63, `${label}:temperature`);
  assert.strictEqual(wire.max_tokens, 1537, `${label}:max_tokens`);
  assert.strictEqual(wire.top_p, 0.91, `${label}:top_p`);
  assert.strictEqual(wire.presence_penalty, 0.1, `${label}:presence_penalty`);
  assert.strictEqual(wire.frequency_penalty, 0.2, `${label}:frequency_penalty`);
  assert.strictEqual(wire.reasoning_effort, reasoningEffort, `${label}:reasoning_effort`);
  assert.deepStrictEqual(wire.thinking, { type: "enabled", clear_thinking: clearThinking }, `${label}:thinking`);
  if (outputMode === "json") assert.deepStrictEqual(wire.response_format, { type: "json_object" }, `${label}:response_format`);
  else assert(!Object.prototype.hasOwnProperty.call(wire, "response_format"), `${label}:text_output_has_no_response_format`);
  if (stream) assert.deepStrictEqual(wire.stream_options, { include_usage: true }, `${label}:stream_options`);
  else assert(!Object.prototype.hasOwnProperty.call(wire, "stream_options"), `${label}:non_stream_has_no_stream_options`);
  assert(!Object.prototype.hasOwnProperty.call(wire, "signal"), `${label}:signal_is_sdk_control_not_wire_json`);
}

function assertPair(reference, result, label) {
  assert.strictEqual(reference.bodyJson, result.bodyJson, `${label}:SDK_create_wire_JSON_bytes`);
  assert.strictEqual(reference.bodySha256, result.bodySha256, `${label}:SDK_create_wire_SHA256`);
  const expectedClient = JSON.parse(reference.clientJson);
  if (expectedClient.defaultHeaders["User-Agent"] === "VOTC/9.2.0"
    && result.client.defaultHeaders["User-Agent"] === "VOTC/9.3.7") {
    expectedClient.defaultHeaders["User-Agent"] = "VOTC/9.3.7";
  }
  const expectedClientJson = JSON.stringify(expectedClient);
  assert.strictEqual(expectedClientJson, result.clientJson, `${label}:SDK_endpoint_client_config_bytes_except_explicit_version`);
  assert.strictEqual(sha256(expectedClientJson), result.clientSha256, `${label}:SDK_endpoint_client_config_SHA256_except_explicit_version`);
}

function assertExpectedClient(result, label) {
  if (label.includes("candidate")) assert.strictEqual(result.client.defaultHeaders["User-Agent"], "VOTC/9.3.7", `${label}:app_version_header`);
  assert.strictEqual(result.client.apiKey, "synthetic-fixture-key", `${label}:synthetic_only_sdk_key`);
  assert.strictEqual(result.client.baseURL, "https://example.invalid/api/paas/v4", `${label}:configured_endpoint`);
  assert.strictEqual(result.client.maxRetries, 0, `${label}:sdk_retries_disabled_for_fixture`);
  assert.strictEqual(result.client.defaultHeaders["Content-Type"], "application/json", `${label}:content_type_header`);
  assert.strictEqual(result.client.defaultHeaders.Authorization, "Bearer synthetic-fixture-key", `${label}:synthetic_authorization`);
}

async function main() {
  materializeBaselines();
  const mockSdk = installMockSdk();
  const originalLog = console.log;
  console.log = () => {};
  const wireHash = crypto.createHash("sha256");
  const clientHash = crypto.createHash("sha256");
  const recordPair = (label, results, runtimes) => {
    for (let index = 0; index < results.length; index++) {
      assertExpectedClient(results[index], `${label}-${runtimes[index].commit?.id || "candidate-src"}`);
      assertPair(results[0], results[index], `${label}:${runtimes[index].commit?.id || "candidate-src"}`);
    }
    wireHash.update(label).update("\0").update(results[0].bodyJson).update("\0");
    clientHash.update(label).update("\0").update(results[0].clientJson).update("\0");
  };
  let pairedScenarios = 0;
  let nonComparableFixtures = 0;
  try {
    const runtimes = [
      ...commits.map(commit => ({ commit, ...makeRuntime(commit.id, mockSdk) })),
      { commit: { id: "candidate-src" }, ...makeSourceRuntime(mockSdk) }
    ];
    const captureAll = async options => {
      const results = [];
      for (const runtime of runtimes) results.push(await captureRequest(runtime, mockSdk, options));
      return results;
    };
    const identity = { campaign: "synthetic-campaign-a", npc: 2, date: "1164.5.20" };
    const lengths = [2048, 15360, 25600, 35840];
    const modes = ["text", "json"];
    const streams = [false, true];
    const reasoningEfforts = ["low", "high", "max"];
    const clearThinkingValues = [true, false];
    for (const targetTokens of lengths) {
      const messages = buildMessages(runtimes[1].TokenCounter, targetTokens, identity);
      for (const stream of streams) {
        for (const outputMode of modes) {
          for (const reasoningEffort of reasoningEfforts) {
            for (const clearThinking of clearThinkingValues) {
              const label = `matrix-${targetTokens}-${stream ? "stream" : "nonstream"}-${outputMode}-${reasoningEffort}-clear-${clearThinking}`;
              const options = { messages, stream, outputMode, reasoningEffort, clearThinking, label };
              const results = await captureAll(options);
              for (let index = 0; index < results.length; index++) {
                assertExpectedWire(results[index], { ...options, label: `${label}-${runtimes[index].commit.id}` });
                assertPair(results[0], results[index], `${label}:${runtimes[index].commit.id}`);
              }
              recordPair(label, results, runtimes);
              pairedScenarios++;
            }
          }
        }
      }
    }

    const businessOptions = { stream: false, outputMode: "text", reasoningEffort: "low", clearThinking: true, label: "business" };
    const baseMessages = buildMessages(runtimes[1].TokenCounter, 2048, identity);
    const baseResults = await captureAll({ ...businessOptions, messages: baseMessages });
    for (let index = 0; index < baseResults.length; index++) {
      assertExpectedWire(baseResults[index], { ...businessOptions, messages: baseMessages, label: `business-base-${runtimes[index].commit.id}` });
      assertPair(baseResults[0], baseResults[index], `business-base:${runtimes[index].commit.id}`);
    }
    recordPair("business-base", baseResults, runtimes);
    pairedScenarios++;

    const appendedMessages = [
      ...baseMessages,
      { role: "assistant", name: "npc_2", content: "Synthetic appended historical reply." },
      { role: "user", name: "synthetic_context", content: "Synthetic appended follow-up." }
    ];
    const appendedResults = await captureAll({ ...businessOptions, messages: appendedMessages });
    for (let index = 0; index < appendedResults.length; index++) {
      const runtimeId = runtimes[index].commit.id;
      assertPair(appendedResults[0], appendedResults[index], `same-owner-history-append:${runtimeId}`);
      assert.deepStrictEqual(appendedResults[index].body.messages.slice(0, baseMessages.length), baseResults[index].body.messages,
        `append_${runtimeId}_history_bytes_stay_in_prefix`);
      assert.deepStrictEqual(appendedResults[index].body.messages.slice(baseMessages.length), appendedMessages.slice(baseMessages.length),
        `append_only_turns_reach_${runtimeId}_sdk_wire`);
      assert.notStrictEqual(appendedResults[index].bodyJson, baseResults[index].bodyJson, `${runtimeId}:append_changes_the_actual_wire_body`);
    }
    recordPair("same-owner-history-append", appendedResults, runtimes);
    pairedScenarios++;

    const variants = [
      { id: "different-npc", identity: { ...identity, npc: 3 }, changed: message => message.name === "npc_3" || message.content.includes("npc=3") },
      { id: "different-date", identity: { ...identity, date: "1164.5.21" }, changed: message => message.content.includes("date=1164.5.21") },
      { id: "different-campaign", identity: { ...identity, campaign: "synthetic-campaign-b" }, changed: message => message.content.includes("campaign=synthetic-campaign-b") }
    ];
    for (const variant of variants) {
      assert.notDeepStrictEqual(variant.identity, identity, `${variant.id}:must_be_business_incomparable`);
      const messages = buildMessages(runtimes[1].TokenCounter, 2048, variant.identity);
      const results = await captureAll({ ...businessOptions, messages });
      for (let index = 0; index < results.length; index++) {
        const runtimeId = runtimes[index].commit.id;
        assertPair(results[0], results[index], `${variant.id}:${runtimeId}`);
        assert.deepStrictEqual(results[index].body.messages[0], baseResults[index].body.messages[0], `${variant.id}:${runtimeId}:stable_system_prefix`);
      }
      assert(messages.some(variant.changed), `${variant.id}:identity_or_date_must_change_in_expected_message`);
      for (let index = 0; index < results.length; index++) {
        const runtimeId = runtimes[index].commit.id;
        assert(results[index].body.messages.some(variant.changed), `${variant.id}:changed_context_reaches_${runtimeId}_sdk_wire`);
        assert.notStrictEqual(results[index].bodyJson, baseResults[index].bodyJson, `${variant.id}:${runtimeId}:cross_identity_is_not_comparable`);
      }
      recordPair(variant.id, results, runtimes);
      pairedScenarios++;
      nonComparableFixtures++;
    }

    assert.strictEqual(pairedScenarios, 101, "expected_matrix_plus_append_and_identity_fixtures");
    assert.strictEqual(nonComparableFixtures, 3, "NPC/date/campaign variants stay in separate fixture cohorts");
    originalLog(`V9.2.3 GLM outbound equivalence PASS: pairedScenarios=${pairedScenarios}, runtimeTargets=${runtimes.length}, targets=v9.2.1/v9.2.2/candidate-src, matrix=${lengths.join("/")}, matrixCases=${lengths.length * streams.length * modes.length * reasoningEfforts.length * clearThinkingValues.length}, businessIncomparableFixtures=${nonComparableFixtures}, orderedWireBytesSHA256=${wireHash.digest("hex")}, orderedClientConfigBytesSHA256=${clientHash.digest("hex")}, sdk=mock, network=0`);
  } finally {
    console.log = originalLog;
    mockSdk.restore();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
