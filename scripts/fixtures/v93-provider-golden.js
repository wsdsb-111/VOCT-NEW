"use strict";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const Module = require("module");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const BASELINE_SHA = "e1c3c37c89d8001f995593bc1c287a9c0d63a31f";
const BASELINE_FILE = path.join(__dirname, "v93-provider-golden-baseline.json");
const PROVIDER_TYPES = ["player2", "openrouter", "openai-compatible", "ollama", "deepseek", "gemini", "zhipu"];
const PROVIDER_EXPORTS = {
  openrouter: "OpenRouterProvider",
  "openai-compatible": "OpenAICompatibleProvider",
  zhipu: "ZhipuProvider",
  ollama: "OllamaProvider",
  player2: "Player2Provider",
  deepseek: "DeepseekProvider",
  gemini: "GeminiProvider"
};
const SDK_PROVIDERS = new Set(["openrouter", "openai-compatible", "zhipu", "player2", "deepseek"]);
const SAFE_HEADER_NAMES = new Set(["accept", "content-type", "http-referer", "user-agent", "x-title"]);

function makeMessages(variant) {
  if (variant === "multi-system-history") {
    return [
      { role: "system", content: "[synthetic fixture] stable system block" },
      { role: "system", content: "[synthetic fixture] second system block" },
      { role: "user", content: "[synthetic fixture] earlier user turn" },
      { role: "assistant", content: "[synthetic fixture] earlier assistant turn" },
      { role: "user", content: "[synthetic fixture] current user turn" }
    ];
  }
  return [
    { role: "system", content: "[synthetic fixture] system block" },
    { role: "user", content: "[synthetic fixture] current user turn" }
  ];
}

const ACTION_SCHEMA = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          actionId: { type: "string", enum: ["fixture_noop"] },
          characterId: { type: "string" }
        },
        required: ["actionId"]
      }
    }
  },
  required: ["actions"]
};

function makeConfig(providerType, overrides = {}) {
  const config = {
    providerType,
    instanceId: `fixture-${providerType}`,
    customName: `Synthetic ${providerType}`,
    apiKey: "v93-fixture-only-redacted",
    defaultModel: "fixture-model",
    defaultParameters: {},
    actionSchemaDeliveryMode: providerType === "deepseek" ? "optimized_local_validation" : "official_full_injected",
    glmReasoningEffort: "low",
    glmClearThinking: true
  };
  if (providerType === "openai-compatible") config.baseUrl = "https://compatible.fixture.invalid/v1";
  if (providerType === "ollama") config.baseUrl = "https://ollama.fixture.invalid";
  return { ...config, ...overrides };
}

function makeRequest(providerType, route, options = {}) {
  const stream = options.stream === true;
  const request = {
    model: "fixture-model",
    messages: makeMessages(options.messageVariant || "multi-system-history"),
    stream,
    temperature: 0.6,
    max_tokens: 256,
    top_p: 0.9
  };
  if (route === "CHAT" && providerType === "deepseek") {
    request.thinking = { type: "enabled" };
    request.max_tokens = 4096;
  }
  if (route === "ACTION") {
    request.stream = false;
    request.max_tokens = 1024;
    request.response_format = {
      type: "json_schema",
      json_schema: { name: "votc_actions", schema: ACTION_SCHEMA, strict: true }
    };
  }
  if (route === "ACTION" && options.actionSchemaDeliveryMode === "optimized_local_validation" && providerType === "openai-compatible") {
    request.response_format = { type: "json_object" };
  }
  if (route === "SUMMARY" || route === "SUMMARY_DURABLE") {
    request.stream = false;
    request.max_tokens = 1024;
    request.response_format = { type: "json_object" };
    if (providerType === "deepseek") request.thinking = { type: "disabled" };
  }
  return request;
}

function makeScenarios() {
  const scenarios = [];
  for (const providerType of PROVIDER_TYPES) {
    scenarios.push({
      id: `${providerType}.chat.stream.multi-system-history`,
      providerType,
      route: "CHAT",
      stream: true,
      messageVariant: "multi-system-history",
      control: "none"
    });
    scenarios.push({
      id: `${providerType}.chat.no-stream.single-turn`,
      providerType,
      route: "CHAT",
      stream: false,
      messageVariant: "single-turn",
      control: "none"
    });
    scenarios.push({
      id: `${providerType}.action.schema.multi-system-history`,
      providerType,
      route: "ACTION",
      stream: false,
      messageVariant: "multi-system-history",
      control: "none"
    });
    scenarios.push({
      id: `${providerType}.summary.json-object.multi-system-history`,
      providerType,
      route: "SUMMARY",
      stream: false,
      messageVariant: "multi-system-history",
      control: "none"
    });
    scenarios.push({
      id: `${providerType}.summary-durable.before-send-guard`,
      providerType,
      route: "SUMMARY_DURABLE",
      stream: false,
      messageVariant: "multi-system-history",
      control: "durable-before-send"
    });
  }
  for (const providerType of ["openai-compatible", "deepseek"]) {
    scenarios.push({
      id: `${providerType}.action.schema.optimized-local-validation`,
      providerType,
      route: "ACTION",
      stream: false,
      messageVariant: "multi-system-history",
      control: "none",
      actionSchemaDeliveryMode: "optimized_local_validation"
    });
    scenarios.push({
      id: `${providerType}.action.schema.official-full-injected`,
      providerType,
      route: "ACTION",
      stream: false,
      messageVariant: "multi-system-history",
      control: "none",
      actionSchemaDeliveryMode: "official_full_injected"
    });
  }
  return scenarios;
}

const SCENARIOS = makeScenarios();

function getBodyString(input, init) {
  if (init?.body != null) {
    if (typeof init.body === "string") return init.body;
    if (Buffer.isBuffer(init.body)) return init.body.toString("utf8");
    if (input instanceof Request) return input.clone().text();
    return String(init.body);
  }
  if (input instanceof Request) return input.clone().text();
  return null;
}

async function captureRequest(input, init, scenario) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  const safeHeaders = {};
  headers.forEach((value, name) => {
    const normalizedName = name.toLowerCase();
    if (/authorization|api[-_]?key|game[-_]?key|token|secret/i.test(normalizedName)) {
      safeHeaders[normalizedName] = "[REDACTED]";
    } else if (SAFE_HEADER_NAMES.has(normalizedName)) {
      safeHeaders[normalizedName] = value;
    }
  });
  const body = await getBodyString(input, init);
  const safeUrl = `${url.origin}${url.pathname}`;
  return {
    method: (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase(),
    url: safeUrl,
    headers: safeHeaders,
    body,
    bodyBytes: body == null ? 0 : Buffer.byteLength(body, "utf8"),
    bodySha256: body == null ? null : crypto.createHash("sha256").update(body, "utf8").digest("hex")
  };
}

function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers }
  });
}

function openAIResponse(stream) {
  if (!stream) {
    return jsonResponse({
      id: "fixture-response-id",
      model: "fixture-model",
      choices: [{ index: 0, message: { role: "assistant", content: "[synthetic fixture response]" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 }
    });
  }
  const frames = [
    { id: "fixture-stream-id", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
    { id: "fixture-stream-id", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta: { content: "[synthetic fixture response]" }, finish_reason: "stop" }] },
    { id: "fixture-stream-id", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } }
  ];
  const body = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function geminiResponse(stream) {
  const result = {
    responseId: "fixture-gemini-response",
    candidates: [{ content: { parts: [{ text: "[synthetic fixture response]" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 }
  };
  if (!stream) return jsonResponse(result);
  return new Response(`data: ${JSON.stringify(result)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

function ollamaResponse(stream) {
  if (!stream) {
    return jsonResponse({
      model: "fixture-model",
      created_at: "1970-01-01T00:00:00Z",
      message: { role: "assistant", content: "[synthetic fixture response]" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 8,
      eval_count: 3
    });
  }
  const frames = [
    { model: "fixture-model", created_at: "1970-01-01T00:00:00Z", message: { role: "assistant", content: "[synthetic fixture response]" }, done: false },
    { model: "fixture-model", created_at: "1970-01-01T00:00:00Z", message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 8, eval_count: 3 }
  ];
  return new Response(`${frames.map((frame) => `${JSON.stringify(frame)}\n`).join("")}`, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" }
  });
}

function makeResponse(scenario, input, init) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const bodyText = init?.body == null ? "" : String(init.body);
  const body = bodyText ? JSON.parse(bodyText) : {};
  if (scenario.providerType === "gemini") return geminiResponse(url.pathname.includes(":streamGenerateContent"));
  if (scenario.providerType === "ollama") return ollamaResponse(body.stream === true);
  return openAIResponse(body.stream === true);
}

function clientRetryPolicy(scenario) {
  if (!SDK_PROVIDERS.has(scenario.providerType)) return { transport: "fetch", sdkMaxRetries: null };
  const usesControl = scenario.control === "durable-before-send";
  const sdkMaxRetries = ["openrouter", "player2"].includes(scenario.providerType) && !usesControl ? 2 : 0;
  const outerMaxRetries = scenario.stream ? 7 : 3;
  return { transport: "openai@4.104.0", sdkMaxRetries, outerMaxRetries };
}

async function runCaptureWorker() {
  const captures = [];
  let activeScenario = null;
  const calls = [];
  const recordingFetch = async (input, init = {}) => {
    const request = await captureRequest(input, init, activeScenario);
    calls.push(request);
    return makeResponse(activeScenario, input, init);
  };
  const savedConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  };
  const originalFetch = globalThis.fetch;
  const originalModuleLoad = Module._load;
  const packageJson = require(path.join(ROOT, "resources/app/package.json"));
  const versionFile = path.resolve(ROOT, "src/app/main/version.js");
  const providerFile = path.resolve(ROOT, "src/app/main/providers/index.js");
  const openAiNodeRuntimeFile = path.resolve(ROOT, "resources/app/node_modules/openai/_shims/node-runtime.js");
  const dependenciesPath = path.join(ROOT, "resources/app/node_modules");
  const nodeFetchMock = {
    __esModule: true,
    default: recordingFetch,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers
  };

  process.env.NODE_PATH = [dependenciesPath, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  Module._initPaths();
  globalThis.fetch = recordingFetch;
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  Module._load = function loadWithSourceVersion(request, parent, isMain) {
    if (request === "../../package.json" && parent?.filename && path.resolve(parent.filename) === versionFile) return packageJson;
    if (request === "node-fetch" && parent?.filename && path.resolve(parent.filename) === openAiNodeRuntimeFile) return nodeFetchMock;
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const providerClasses = require(providerFile);
    for (const scenario of SCENARIOS) {
      activeScenario = scenario;
      calls.length = 0;
      const config = makeConfig(scenario.providerType, scenario.actionSchemaDeliveryMode ? { actionSchemaDeliveryMode: scenario.actionSchemaDeliveryMode } : {});
      const provider = new providerClasses[PROVIDER_EXPORTS[scenario.providerType]]();
      const request = makeRequest(scenario.providerType, scenario.route, scenario);
      let beforeSendGuardCalls = 0;
      const controller = new AbortController();
      if (scenario.control === "durable-before-send") request.signal = controller.signal;
      const control = scenario.control === "durable-before-send"
        ? { signal: controller.signal, beforeSend: () => { beforeSendGuardCalls++; } }
        : null;
      try {
        const result = provider.chatCompletion(request, config, control);
        if (result && typeof result[Symbol.asyncIterator] === "function") {
          const iterator = result[Symbol.asyncIterator]();
          while (true) {
            const step = await iterator.next();
            if (step.done) break;
          }
        } else {
          await result;
        }
      } catch (error) {
        throw new Error(`${scenario.id} failed after ${calls.length} mocked request(s): ${error.message || error}`);
      }
      if (calls.length === 0) throw new Error(`${scenario.id} did not reach the mocked HTTP transport`);
      captures.push({
        id: scenario.id,
        providerType: scenario.providerType,
        route: scenario.route,
        stream: scenario.stream,
        messageVariant: scenario.messageVariant,
        control: scenario.control,
        actionSchemaDeliveryMode: scenario.actionSchemaDeliveryMode || config.actionSchemaDeliveryMode,
        clientRetryPolicy: clientRetryPolicy(scenario),
        attemptCount: calls.length,
        bytesSent: calls.reduce((total, call) => total + call.bodyBytes, 0),
        beforeSendGuardCalls,
        terminalState: "CAPTURED_WITH_SYNTHETIC_RESPONSE",
        usageStatus: "SYNTHETIC_RESPONSE_USAGE_PRESENT",
        requests: [...calls]
      });
    }
  } finally {
    Module._load = originalModuleLoad;
    globalThis.fetch = originalFetch;
    Object.assign(console, savedConsole);
  }

  return {
    schemaVersion: 1,
    captureKind: "offline synthetic HTTP capture",
    baseline: {
      gitSha: BASELINE_SHA,
      coreVersion: "9.2",
      appVersion: packageJson.version,
      openaiSdkVersion: "4.104.0"
    },
    privacy: {
      messages: "synthetic only",
      credentials: "omitted or redacted",
      urls: "origin and pathname only; all query strings removed"
    },
    captures
  };
}

function captureAll() {
  const result = childProcess.spawnSync(process.execPath, [__filename, "--capture-worker"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`Golden capture worker failed: ${result.stderr || result.error?.message || result.status}`);
  }
  return JSON.parse(result.stdout);
}

function assertBaselineSource() {
  const sha = childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (sha !== BASELINE_SHA) throw new Error(`Refusing to write the frozen baseline from ${sha}; expected ${BASELINE_SHA}.`);
  const status = childProcess.execFileSync("git", ["status", "--porcelain", "--", "src/app/main/providers/index.js", "src/app/main/version.js", "resources/app/package.json"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (status) throw new Error("Refusing to write the frozen baseline while its source/runtime inputs are modified.");
}

if (require.main === module) {
  if (process.argv[2] === "--capture-worker") {
    runCaptureWorker().then((result) => process.stdout.write(JSON.stringify(result, null, 2)), (error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
  } else if (process.argv[2] === "--write-baseline") {
    try {
      assertBaselineSource();
      const result = captureAll();
      fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      process.stdout.write(`Wrote ${path.relative(ROOT, BASELINE_FILE)} (${result.captures.length} synthetic captures).\n`);
    } catch (error) {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    }
  } else {
    process.stderr.write("Usage: node scripts/fixtures/v93-provider-golden.js --capture-worker | --write-baseline\n");
    process.exitCode = 2;
  }
}

module.exports = { BASELINE_SHA, SCENARIOS, captureAll };
