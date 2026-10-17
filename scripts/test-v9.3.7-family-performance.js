"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const REPO_ROOT = path.resolve(__dirname, "..");
const PAIR_SOURCE_PATHS = [
  "src/app/main/memory-system/pair-memory-source-retrieval.js",
  "src/app/main/memory-system/pair-long-term-ledger.js",
  "src/app/main/memory-system/memory-store.js",
  "src/app/main/memory-system/memory-engine.js",
  "src/app/main/memory-system/owner-target-candidate-directory.js"
];
const FIXTURE_DATE = "1190年5月2日";
const FIXTURE_TOTAL_DAYS = 100;
const FIXTURE_CAMPAIGN = "votc8c-202610170001";
const ORDINARY_QUERY = "继续说下去。";
const RELATED_QUERY = "你兄弟的母亲是谁？";
const STEP_QUERY = "你继父是谁？";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function line(type, rootId, payload = []) {
  return `VOTC:IN/;/${type}/;/${[rootId, ...payload].join("/;/")}`;
}

function characterLine({ id, name, gender, age = "" }) {
  const fields = Array(28).fill("");
  fields[0] = String(id);
  fields[1] = name;
  fields[2] = name;
  fields[3] = "官员";
  fields[4] = gender === "female" ? "she" : gender === "male" ? "he" : "they";
  fields[5] = age === null ? "" : String(age);
  fields[6] = "120";
  fields[7] = "0";
  fields[8] = "unknown";
  fields[9] = "稳重";
  fields[14] = "汉";
  fields[15] = "道教";
  fields[16] = "王氏";
  fields[18] = name;
  return `VOTC:IN/;/character/;/${fields.join("/;/")}`;
}

function makeFamilyFixtureLines({ siblingCount = 1, siblingCharacterAge = 17, siblingRelativeAge = 17, includeStepFamily = false } = {}) {
  const lines = [
    line("init", 1, ["宋氏父", 10, "王承礼", FIXTURE_DATE, "___________talk_scene", "长安", "长安", FIXTURE_TOTAL_DAYS]),
    `VOTC:CAMPAIGN/${FIXTURE_CAMPAIGN}`,
    characterLine({ id: 1, name: "宋氏父", gender: "male", age: 48 }),
    characterLine({ id: 2, name: "王氏妻", gender: "female", age: 44 }),
    characterLine({ id: 3, name: "陈氏妾", gender: "female", age: 39 }),
    characterLine({ id: 10, name: "王承礼", gender: "male", age: 17 }),
    characterLine({ id: 20, name: "赵子明", gender: "male", age: siblingCharacterAge }),
    characterLine({ id: 30, name: "赵氏", gender: "female", age: 37 })
  ];
  for (let index = 0; index < siblingCount; index += 1) {
    const childId = index === 0 ? 20 : 100 + index;
    const motherId = index === 0 ? 3 : 200 + index;
    const name = index === 0 ? "赵子明" : `王氏子${index}`;
    if (index > 0) lines.push(characterLine({ id: childId, name, gender: "male", age: 17 + index % 4 }));
    if (index > 0) lines.push(characterLine({ id: motherId, name: `妾室${index}`, gender: "female", age: 30 + index % 9 }));
    const birthDays = 30 + index * 365;
    const birthDate = index === 0 ? "1172年5月2日" : `${1172 + (index % 8)}年5月2日`;
    const currentAge = index === 0 ? siblingRelativeAge : 14 + index % 8;
    lines.push(line("kids", 1, [childId, name, "he", birthDays, birthDate, currentAge]));
    lines.push(line("kid_other_parent", 1, [childId, motherId, index === 0 ? "陈氏妾" : `妾室${index}`, index === 0 ? "PUBLIC_LEGAL_PARENT" : "UNKNOWN", "she"]));
    lines.push(line("kid_eob", 1, [childId, ""]));
    lines.push(line("siblings", 10, [childId, name, "he", birthDays, birthDate, currentAge]));
    lines.push(line("sibling_other_parent", 10, [childId, motherId, index === 0 ? "陈氏妾" : `妾室${index}`, index === 0 ? "PUBLIC_LEGAL_PARENT" : "UNKNOWN", "she"]));
    lines.push(line("sibling_eob", 10, [childId, ""]));
  }
  lines.push(line("kids", 1, [10, "王承礼", "he", 1, "1172年5月2日", 17]));
  lines.push(line("kid_other_parent", 1, [10, 2, "王氏妻", "PUBLIC_LEGAL_PARENT", "she"]));
  lines.push(line("kid_eob", 1, [10, ""]));
  if (includeStepFamily) {
    lines.push(line("parents", 10, [1, "宋氏父", 0, "1142年5月2日", 48, "he", "PUBLIC_LEGAL_PARENT"]));
    lines.push(line("parents", 10, [2, "王氏妻", 0, "1146年5月2日", 44, "she", "PUBLIC_LEGAL_PARENT"]));
    lines.push(line("parent_spouse", 10, [2, 50, "沈承安", "he", "PUBLIC_LEGAL_MARRIAGE"]));
    lines.push(line("parent_spouse_child", 10, [2, 50, 60, "沈子明", "he", 61, "陆氏", "she", "PUBLIC_LEGAL_PARENT"]));
  }
  return lines;
}

function loadRuntime(moduleRoot) {
  const Module = require("node:module");
  const originalResolveFilename = Module._resolveFilename;
  const sourceVersionPath = path.join(moduleRoot, "src", "app", "main", "version.js");
  const packagePath = path.join(moduleRoot, "resources", "app", "package.json");
  // Source modules are authored for resources/app/out/main, where this relative
  // package path exists. Redirect only that package lookup for direct src imports.
  Module._resolveFilename = function resolveSourcePackage(request, parent, ...rest) {
    if (request === "../../package.json" && parent?.filename === sourceVersionPath) return packagePath;
    return originalResolveFilename.call(this, request, parent, ...rest);
  };
  const at = relativePath => require(path.join(moduleRoot, relativePath));
  try {
    const { Character } = at("src/app/main/game-data/character.js");
    const { createLogParser } = at("src/app/main/game-data/log-parser.js");
    const { createGameData } = at("src/app/main/game-data/game-data.js");
    const { buildFamilyFactBlock } = at("src/app/main/worldline/character-family-facts.js");
    const { createTemplateEngine } = at("src/app/main/prompts/template-engine.js");
    const { PromptScriptLoader } = at("src/app/main/prompts/prompt-script-loader.js");
    const { createPromptBuilder } = at("src/app/main/prompts/prompt-builder.js");
    const { estimateTokens } = at("src/app/main/token-estimator.js");
    const TokenCounter = {
      estimateTokens,
      estimateMessageTokens(message) {
        const text = message?.name ? `${message.name}: ${message.content}` : message?.content;
        return estimateTokens(text);
      },
      calculateTotalTokens(messages) {
        return messages.reduce((total, message) => total + this.estimateMessageTokens(message), 0);
      }
    };
    const resourcesRoot = path.join(moduleRoot, "resources", "app");
    const promptsRoot = path.join(resourcesRoot, "default_userdata", "prompts");
    const templatePath = path.join(promptsRoot, "system", "default.hbs");
    const Handlebars = require(require.resolve("handlebars", { paths: [resourcesRoot] }));
    const TemplateEngine = createTemplateEngine({
      Handlebars,
      fs,
      path,
      promptsHelpersDir: path.join(promptsRoot, "helpers"),
      defaultPromptsDir: promptsRoot,
      PromptScriptSandbox: at("src/app/main/prompts/prompt-script-sandbox.js").PromptScriptSandbox
    });
    const mainTemplate = fs.readFileSync(templatePath, "utf8");
    const promptConfigManager = {
      getDefaultMainTemplateContent: () => mainTemplate,
      resolvePath: value => path.resolve(moduleRoot, value)
    };
    const settingsRepository = {
      getPromptSettings: () => ({
        mainTemplate,
        blocks: [
          { id: "main", type: "main", label: "Main Prompt", enabled: true, role: "system" },
          { id: "history", type: "history", label: "Conversation", enabled: true, role: "system" }
        ],
        suffix: { enabled: false, template: "" }
      }),
      getChatPromptV89Settings: () => ({ chatPromptV89Layout: false }),
      getChatPromptV813Layout: () => false,
      getActiveProviderConfig: () => null
    };
    const PromptBuilder = createPromptBuilder({
      TemplateEngine,
      PromptScriptLoader,
      promptConfigManager,
      settingsRepository,
      path,
      TokenCounter,
      createPromptFingerprint: value => sha256(String(value)),
      defaultChatInstruction: "请以当前游戏事实回应。"
    });
    const GameData = createGameData({
      fs,
      path,
      memorySystem: null,
      memoryEngine: null,
      summariesDir: os.tmpdir(),
      getHistoricalReferenceByYear: () => ({ period: "测试年代", context: "以本轮游戏数据为准。", notableEvents: [], notableFigures: [] })
    });
    return { Character, createLogParser, GameData, buildFamilyFactBlock, PromptBuilder, TokenCounter, templatePath, mainTemplate };
  } finally {
    Module._resolveFilename = originalResolveFilename;
  }
}

function withQuietLogs(callback) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  const restore = () => {
    console.log = originalLog;
    console.warn = originalWarn;
  };
  try {
    const result = callback();
    if (result && typeof result.then === "function") return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

async function parseFixture(runtime, lines) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v937-family-"));
  const fixturePath = path.join(fixtureRoot, "debug.log");
  fs.writeFileSync(fixturePath, `${lines.join(os.EOL)}${os.EOL}`, "utf8");
  const parseLog = runtime.createLogParser({ GameData: runtime.GameData, Character: runtime.Character });
  try {
    return await withQuietLogs(() => parseLog(fixturePath));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function makeMemoryContext() {
  return {
    subjectiveWorldPolicyActive: true,
    playerCenteredRecallEnabled: true,
    activeParticipantIds: [1, 10],
    campaignToken: FIXTURE_CAMPAIGN,
    historicalReferenceInfo: { period: "测试年代", context: "只使用当前数据。", notableEvents: [], notableFigures: [] },
    directStableText: "获准的玩家与回应者记忆范围。"
  };
}

function render(runtime, gameData, query, memoryContext = makeMemoryContext()) {
  const responder = gameData.characters.get(10);
  assert.ok(responder, "fixture responder must be present in parsed GameData");
  const result = withQuietLogs(() => runtime.PromptBuilder.buildMessagesWithTokenCount(
    [{ role: "user", content: query }], responder, gameData, null, memoryContext
  ));
  const familyBlock = result.blocks.find(entry => entry?.block?.id === "responder-family-facts");
  return {
    result,
    text: result.messages.map(message => message.content).join("\n"),
    familyText: familyBlock?.content || "",
    familyTokens: familyBlock?.tokens || 0,
    promptTokens: result.totalTokens
  };
}

function percentile(values, p) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function nodeMajor(version) {
  const match = String(version).match(/^v?(\d+)/);
  return match ? Number(match[1]) : NaN;
}

function loadPairBaselineReference(moduleRoot) {
  return {
    selectedRootSourceHashes: Object.fromEntries(PAIR_SOURCE_PATHS.map(file => [file, sha256File(path.join(moduleRoot, file))])),
    scope: "Core Pair source parity only; current-version retrieval timing is measured separately."
  };
}

async function runArm({ moduleRoot, warmupCount, sampleCount, requireNode22 = true, requirePairBaseline = true }) {
  if (requireNode22) assert.equal(Number(process.versions.node.split(".")[0]), 22, "formal performance runs require Node 22");
  const runtime = loadRuntime(moduleRoot);
  const lines = makeFamilyFixtureLines({ includeStepFamily: true });
  const fixtureHash = sha256(lines.join("\n"));
  const gameData = await parseFixture(runtime, lines);
  const responder = gameData.characters.get(10);
  assert.ok(responder);
  const ordinarySamples = [];
  const relatedSamples = [];
  const stepSamples = [];
  const measure = (query, samples) => {
    const familyStart = performance.now();
    withQuietLogs(() => runtime.buildFamilyFactBlock(responder, gameData, { query }));
    const familyBuildMs = performance.now() - familyStart;
    const promptStart = performance.now();
    const prompt = render(runtime, gameData, query);
    const promptBuildMs = performance.now() - promptStart;
    samples.push({
      familyBuildMs,
      promptBuildMs,
      familyTokens: prompt.familyTokens,
      familyTextSha256: sha256(prompt.familyText),
      promptTokens: prompt.promptTokens,
      familyNodeVisits: prompt.result.familyDiagnostics?.[0]?.nodeVisits ?? null,
      familyEdgeVisits: prompt.result.familyDiagnostics?.[0]?.edgeVisits ?? null
    });
  };
  for (let index = 0; index < warmupCount; index += 1) {
    measure(ORDINARY_QUERY, []);
    measure(RELATED_QUERY, []);
    measure(STEP_QUERY, []);
  }
  for (let index = 0; index < sampleCount; index += 1) {
    if (index % 2 === 0) {
      measure(ORDINARY_QUERY, ordinarySamples);
      measure(RELATED_QUERY, relatedSamples);
      measure(STEP_QUERY, stepSamples);
    } else {
      measure(STEP_QUERY, stepSamples);
      measure(RELATED_QUERY, relatedSamples);
      measure(ORDINARY_QUERY, ordinarySamples);
    }
  }
  const pairBaseline = requirePairBaseline ? loadPairBaselineReference(moduleRoot) : null;
  const mainTemplateHash = sha256(runtime.mainTemplate);
  const simplify = samples => ({
    sampleCount: samples.length,
    familyBuildP50Ms: median(samples.map(sample => sample.familyBuildMs)),
    familyBuildP95Ms: percentile(samples.map(sample => sample.familyBuildMs), 0.95),
    promptBuildP50Ms: median(samples.map(sample => sample.promptBuildMs)),
    promptBuildP95Ms: percentile(samples.map(sample => sample.promptBuildMs), 0.95),
    familyTokenMedian: median(samples.map(sample => sample.familyTokens)),
    promptTokenMedian: median(samples.map(sample => sample.promptTokens)),
    promptTokenP95: percentile(samples.map(sample => sample.promptTokens), 0.95),
    familyTextSha256: samples[0]?.familyTextSha256 || null,
    rawSamples: samples
  });
  return {
    schemaVersion: 1,
    runMode: sampleCount >= 20 ? "formal-performance-arm" : "DIAGNOSTIC_ONLY_NO_GATE",
    generatedAt: new Date().toISOString(),
    moduleRoot,
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model?.trim() || null,
      logicalCpuCount: os.cpus().length
    },
    measurementPlan: {
      fixture: "synthetic CK3 log parsed by production LogParser into production GameData and Character; actual family graph and PromptBuilder are measured",
      ordinaryQuery: ORDINARY_QUERY,
      relatedQuery: RELATED_QUERY,
      stepQuery: STEP_QUERY,
      warmupCount,
      measuredSamplesPerCase: sampleCount,
      casesRunSequentially: true,
      pairRetrievalBenchmark: requirePairBaseline
        ? "core source parity checked; current-version retrieval timing is measured separately"
        : "not measured during diagnostic smoke; formal run checks core source parity"
    },
    fixtureHash,
    mainTemplateHash,
    ordinary: simplify(ordinarySamples),
    related: simplify(relatedSamples),
    stepRelated: simplify(stepSamples),
    pairRetrievalBaseline: pairBaseline
  };
}

function compareArms(baseline, candidate) {
  assert.equal(baseline.fixtureHash, candidate.fixtureHash, "baseline and candidate must use identical synthetic log bytes");
  assert.equal(baseline.mainTemplateHash, candidate.mainTemplateHash, "baseline and candidate must use the same default prompt template");
  assert.equal(baseline.runtime.node, candidate.runtime.node, "Node versions must match");
  assert.equal(nodeMajor(baseline.runtime.node), 22, "formal comparison requires Node 22");
  assert.equal(baseline.runtime.platform, candidate.runtime.platform, "platforms must match");
  assert.equal(baseline.runtime.arch, candidate.runtime.arch, "architectures must match");
  assert.ok(baseline.ordinary.sampleCount >= 20 && candidate.ordinary.sampleCount >= 20, "formal comparison requires at least 20 measured samples per arm");
  assert.deepEqual(baseline.pairRetrievalBaseline?.selectedRootSourceHashes,
    candidate.pairRetrievalBaseline?.selectedRootSourceHashes, "Core Pair retrieval source files must match the selected baseline");

  const familyP95Regression = baseline.ordinary.familyBuildP95Ms === 0 ? 0
    : candidate.ordinary.familyBuildP95Ms / baseline.ordinary.familyBuildP95Ms - 1;
  const promptTokenRegression = baseline.ordinary.promptTokenMedian === 0 ? 0
    : candidate.ordinary.promptTokenMedian / baseline.ordinary.promptTokenMedian - 1;
  const familyTokenDelta = candidate.ordinary.familyTokenMedian - baseline.ordinary.familyTokenMedian;
  const ordinaryPromptDelta = candidate.ordinary.promptTokenMedian - baseline.ordinary.promptTokenMedian;
  const relatedFamilyTokenDelta = candidate.related.familyTokenMedian - baseline.related.familyTokenMedian;
  const relatedPromptDelta = candidate.related.promptTokenMedian - baseline.related.promptTokenMedian;
  const stepFamilyTokenDelta = candidate.stepRelated.familyTokenMedian - baseline.stepRelated.familyTokenMedian;
  const stepPromptDelta = candidate.stepRelated.promptTokenMedian - baseline.stepRelated.promptTokenMedian;
  const ordinaryGrowthMatchesFacts = Math.abs(ordinaryPromptDelta - familyTokenDelta) <= 4;
  const relatedGrowthMatchesFacts = Math.abs(relatedPromptDelta - relatedFamilyTokenDelta) <= 4;
  const stepGrowthMatchesFacts = Math.abs(stepPromptDelta - stepFamilyTokenDelta) <= 4;
  const failures = [];
  if (familyP95Regression > 0.10) failures.push("ordinary family-build P95 regression exceeds 10%");
  if (promptTokenRegression > 0.05) failures.push("ordinary prompt-token median regression exceeds 5%");
  if (!ordinaryGrowthMatchesFacts) failures.push("ordinary prompt-token delta does not track the added family facts");
  if (!relatedGrowthMatchesFacts) failures.push("related-query prompt-token delta does not track the added family facts");
  if (!stepGrowthMatchesFacts) failures.push("step-query prompt-token delta does not track the added family facts");
  return {
    schemaVersion: 1,
    runMode: "formal-performance-comparison",
    baseline: { moduleRoot: baseline.moduleRoot, ordinary: baseline.ordinary, related: baseline.related, stepRelated: baseline.stepRelated },
    candidate: { moduleRoot: candidate.moduleRoot, ordinary: candidate.ordinary, related: candidate.related, stepRelated: candidate.stepRelated },
    metrics: {
      ordinaryFamilyBuildP95RegressionPercent: familyP95Regression * 100,
      ordinaryPromptTokenMedianRegressionPercent: promptTokenRegression * 100,
      ordinaryPromptTokenDelta: ordinaryPromptDelta,
      ordinaryFamilyTokenDelta: familyTokenDelta,
      relatedPromptTokenDelta: relatedPromptDelta,
      relatedFamilyTokenDelta,
      stepPromptTokenDelta: stepPromptDelta,
      stepFamilyTokenDelta,
      stepGrowthMatchesAddedFacts: stepGrowthMatchesFacts,
      ordinaryGrowthMatchesAddedFacts: ordinaryGrowthMatchesFacts,
      relatedGrowthMatchesAddedFacts: relatedGrowthMatchesFacts,
      requiredThresholds: { familyBuildP95RegressionPercent: 10, ordinaryPromptTokenMedianRegressionPercent: 5, tokenDeltaTolerance: 4 }
    },
    retainedPairRetrievalBaseline: candidate.pairRetrievalBaseline,
    pass: failures.length === 0,
    failures
  };
}

function parseArguments(argv) {
  const options = { smoke: true, formal: false, output: null, compare: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--smoke") options.smoke = true;
    else if (argv[index] === "--formal") { options.formal = true; options.smoke = false; }
    else if (argv[index] === "--output") options.output = argv[++index];
    else if (argv[index] === "--compare") options.compare = [argv[++index], argv[++index]];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.compare) {
    const [baselinePath, candidatePath] = options.compare.map(value => path.resolve(value));
    const report = compareArms(JSON.parse(fs.readFileSync(baselinePath, "utf8")), JSON.parse(fs.readFileSync(candidatePath, "utf8")));
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) fs.writeFileSync(path.resolve(options.output), serialized, "utf8");
    process.stdout.write(serialized);
    if (!report.pass) process.exitCode = 1;
    return;
  }
  const moduleRoot = path.resolve(process.env.V937_MODULE_ROOT || REPO_ROOT);
  const warmupCount = options.smoke ? 2 : 20;
  const sampleCount = options.smoke ? 3 : 30;
  const report = await runArm({ moduleRoot, warmupCount, sampleCount,
    requireNode22: options.formal, requirePairBaseline: options.formal });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) fs.writeFileSync(path.resolve(options.output), serialized, "utf8");
  process.stdout.write(serialized);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  makeFamilyFixtureLines,
  loadRuntime,
  parseFixture,
  makeMemoryContext,
  render,
  line,
  characterLine,
  FIXTURE_DATE,
  FIXTURE_TOTAL_DAYS,
  FIXTURE_CAMPAIGN
};
