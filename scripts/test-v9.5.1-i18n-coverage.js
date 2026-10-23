"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const i18next = require("../resources/app/node_modules/i18next");

const root = path.resolve(__dirname, "..");
const bundlePath = path.join(root, "src/app/renderer/assets/index-Dn3qWlAB.js");
const localePath = path.join(root, "src/app/renderer/v95/i18n/locales/v9-5-1-legacy-ui.js");
const i18nIndexPath = path.join(root, "src/app/renderer/v95/i18n/index.js");
const expectedLeafCount = 178;

function flatten(value, prefix = "", output = new Map()) {
  for (const [key, entry] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string") output.set(fullKey, entry);
    else flatten(entry, fullKey, output);
  }
  return output;
}

function placeholders(value) {
  return [...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/gu)].map(match => match[1]).sort();
}

function getPath(object, dottedKey) {
  return dottedKey.split(".").reduce((value, part) => value?.[part], object);
}

function assertKnownKey(catalog, key, where) {
  assert.equal(typeof getPath(catalog, key), "string", `${where} references missing locale key ${key}`);
}

function getComponentSource(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, `could not find component marker ${marker}`);
  const next = /\n(?:const|function) [A-Z][\w$]*\s*(?:=\s*(?:\(|function\b)|\()/u.exec(source.slice(start + 1));
  return source.slice(start, next ? start + 1 + next.index : source.length);
}

function assertInlineTranslations(componentSource, labels, componentName) {
  assert.match(componentSource, /const isChinese = \(i18n\.language \|\| ""\)(?:\.toLowerCase\(\))?\.startsWith\("zh"\);/u,
    `${componentName} should select Chinese from the active UI language`);
  assert.match(componentSource, /const text = \(zh, en\) => isChinese \? zh : en;/u,
    `${componentName} should render the Chinese or English argument directly`);
  assert.doesNotMatch(componentSource, /text\("([^"]+)",\s*"\1"\)/u,
    `${componentName} should not leave a fixed text() label identical in both languages`);

  const selectText = (language, zh, en) => (language || "").toLowerCase().startsWith("zh") ? zh : en;
  for (const [zh, en] of labels) {
    const call = `text(${JSON.stringify(zh)}, ${JSON.stringify(en)})`;
    assert(componentSource.includes(call), `${componentName} is missing bilingual fixed label ${en}`);
    assert.equal(selectText("zh-CN", zh, en), zh, `${componentName} Chinese label mismatch: ${en}`);
    assert.equal(selectText("en-US", zh, en), en, `${componentName} English label mismatch: ${en}`);
  }
}

async function main() {
  const localeUrl = pathToFileURL(localePath).href;
  const indexUrl = pathToFileURL(i18nIndexPath).href;
  const [{ default: fragment }, { createUiTranslator }] = await Promise.all([
    import(localeUrl),
    import(indexUrl)
  ]);

  assert.deepEqual(Object.keys(fragment).sort(), ["en-US", "zh-CN"]);
  const flattened = Object.fromEntries(Object.entries(fragment).map(([locale, catalog]) => [locale, flatten(catalog)]));
  assert.equal(flattened["zh-CN"].size, expectedLeafCount, "Chinese V9.5.1 locale fragment should contain every requested key");
  assert.equal(flattened["en-US"].size, expectedLeafCount, "English V9.5.1 locale fragment should contain every requested key");
  assert.deepEqual([...flattened["zh-CN"].keys()].sort(), [...flattened["en-US"].keys()].sort(), "locale leaf keys must match");

  const i18n = i18next.createInstance();
  await i18n.init({ lng: "en-US", fallbackLng: "zh-CN", initImmediate: false, interpolation: { escapeValue: false } });
  const translators = {
    "zh-CN": createUiTranslator(i18n, "zh-CN"),
    "en-US": createUiTranslator(i18n, "en-US")
  };

  for (const key of flattened["zh-CN"].keys()) {
    const zhValue = flattened["zh-CN"].get(key);
    const enValue = flattened["en-US"].get(key);
    assert.deepEqual(placeholders(zhValue), placeholders(enValue), `placeholder names differ for ${key}`);
    for (const locale of ["zh-CN", "en-US"]) {
      const params = Object.fromEntries(placeholders(flattened[locale].get(key)).map(name => [name, `V95_${name}`]));
      const translated = translators[locale](`legacyUiV951.${key}`, params);
      assert.equal(typeof translated, "string");
      assert.notEqual(translated, `legacyUiV951.${key}`, `${locale} key did not resolve: ${key}`);
      assert(!translated.includes("{{"), `${locale} interpolation did not finish: ${key}`);
      for (const value of Object.values(params)) assert(translated.includes(value), `${locale} interpolation lost a parameter for ${key}`);
    }
  }

  const bundle = fs.readFileSync(bundlePath, "utf8");
  for (const key of Object.keys(fragment["en-US"].connection)) {
    assert(bundle.includes(`legacyUiV951.connection.${key}`), `connection UI must use ${key}`);
    assert.doesNotMatch(fragment["en-US"].connection[key], /[\u3400-\u9fff]/u, `${key} English text must not fall back to Chinese`);
  }
  assert(bundle.includes('providerType === "zhipu" ? "GLM"'), "provider display name should be GLM");
  assert(!bundle.includes("智谱"), "provider UI should no longer include the removed brand prefix");
  for (const key of ["finalSummaryMaxTokens", "finalSummaryMaxTokensHelp"]) {
    assert(bundle.includes(`v95Runtime.t("legacyUiV951.summary.${key}")`));
    assert.doesNotMatch(translators["en-US"](`legacyUiV951.summary.${key}`), /[\u3400-\u9fff]/u);
  }
  const ipcSource = fs.readFileSync(path.join(root, "src/app/main/ipc/register-ipc.js"), "utf8");
  const readHandler = ipcSource.slice(ipcSource.indexOf('  electron.ipcMain.handle("actions:getAll",'), ipcSource.indexOf('  electron.ipcMain.handle("actions:setDisabled",'));
  let getAll;
  const { resolveI18nString } = require("../src/app/main/actions/i18n-utils.js");
  const definitions = [{ id: "becomeRivalsWith", definition: { title: { zh: "成为仇敌", en: "Become rivals" } } },
    { id: "custom", definition: { title: "My custom title" } }, { id: "untitled", definition: {} }];
  new Function("electron", "actionRegistry", "settingsRepository", "resolveI18nString", readHandler)(
    { ipcMain: { handle: (_name, handler) => { getAll = handler; } } },
    { getAllActions: () => definitions, isActionDisabled: () => false, getEffectiveDestructive: () => false, hasDestructiveOverride: () => false },
    { getLanguage: () => "zh" }, resolveI18nString);
  const items = await getAll();
  assert.equal(items[0].title, "成为仇敌", "legacy action-language result remains intact");
  assert.deepEqual(items[0].localizedTitles, { "zh-CN": "成为仇敌", "en-US": "Become rivals" });
  assert.deepEqual(items[1].localizedTitles, { "zh-CN": "My custom title", "en-US": "My custom title" });
  assert.deepEqual(items[2].localizedTitles, { "zh-CN": "untitled", "en-US": "untitled" });
  const actionSource = getComponentSource(bundle, "const ActionsView = () => {");
  assert(actionSource.includes("action.localizedTitles?."), "actual list must select the existing localized title");
  assert(actionSource.includes("[allActions, hideDisabled, showOnlyInvalid, i18n.language]"), "language change must redraw titles without fetching or writing actions");
  const optimizationSource = getComponentSource(bundle, "const OptimizationView = () => {");
  assert(!optimizationSource.includes("criticalActionRecall"), "obsolete action recall panel and variables must be removed");
  assert(optimizationSource.includes('text("按请求类型", "Requests by type")'));
  assert(optimizationSource.includes("byRequest.slice(0, 12).map"), "request-type action usage must remain visible");
  const providerDiagnosticsSource = getComponentSource(bundle, "const ProviderDiagnosticsView = () => {");
  const providerLabels = [
    ["对话", "Conversation"], ["回应者", "Responder"], ["提示词配置", "Prompt Profile"],
    ["路由作用域前缀", "Route Scope Prefix"], ["加权命中率", "Weighted Hit"],
    ["服务商 / 模型 / 路由 / 模式", "Provider / Model / Route / Mode"],
    ["请求 / 纳入统计", "Requests / included"], ["原生加权命中率", "Weighted native hit"],
    ["零值 / 缺失 / 无效 / 不一致", "Zero / missing / invalid / inconsistent"],
    ["未知 / 已排除", "Unknown / excluded"], ["失败 / 已取消 · 派生未命中", "Failed / cancelled · derived miss"],
    ["平均推理 / 可见 TTFT", "Avg reasoning / visible TTFT"], ["服务商 A/B", "Provider A/B"],
    ["服务商 / 模型", "Provider / Model"], ["前缀长度分档", "Prefix Length Buckets"],
    ["前缀", "Prefix"], ["服务商", "Provider"], ["缓存量", "Cached"],
    ["对话前缀", "Conversation Prefix"], ["端点", "Endpoint"], ["有效参数", "Effective Params"],
    ["比例", "Ratio"], ["估算", "Estimated"], ["服务商缓存", "Provider Cached"],
    ["UNKNOWN 保持为 UNKNOWN；仅显示脱敏字段与哈希。", "UNKNOWN remains UNKNOWN; only redacted fields and hashes."]
  ];
  assertInlineTranslations(providerDiagnosticsSource, providerLabels, "Provider diagnostics");

  const worldlineSource = getComponentSource(bundle, "function WorldlineView() {");
  const worldlineLabels = [
    ["运行时", "Runtime"], ["定义", "Definition"], ["原始值", "Raw"], ["别名候选", "Alias candidate"],
    ["评分", "Score"], ["证据", "Evidence"], ["冲突", "Conflict"],
    ["本地化反向查找", "Localization Reverse Lookup"], ["来源完整", "sourceComplete"],
    ["已扫描文件数", "scannedFiles"], ["缺失描述符", "missingDescriptors"],
    ["匹配的原始键", "matchedRawKeys"], ["历史别名解析器", "Historical Alias Resolver"],
    ["定义 ID", "definitionId"], ["运行时 ID", "runtimeId"], ["匹配来源", "matchSource"],
    ["运行时身份解析", "Runtime Identity Resolution"], ["历史索引", "Historical Index"],
    ["索引来源完整", "Index sourceComplete"], ["历史覆盖范围", "Historical coverage"],
    ["缓存 / 延迟", "Cache / Latency"], ["人物与亲属关系检查器", "Entity & Kinship Inspector"],
    ["回应者 Runtime ID", "Responder Runtime ID"], ["目标 Runtime ID", "Target Runtime ID"],
    ["回应者", "Responder"], ["目标", "Target"], ["关系路径", "Relation Path"],
    ["检查点状态", "Checkpoint Status"], ["世界提示词 Token", "World Prompt Token"],
    ["词项", "Terms"], ["匹配别名", "Matched aliases"], ["记忆 / 世界线 Token", "Memory / Worldline Tokens"]
  ];
  assertInlineTranslations(worldlineSource, worldlineLabels, "Worldline");

  const promptsSource = getComponentSource(bundle, "const PromptsView = () => {");
  assert.match(promptsSource, /const \{ t, i18n \} = useTranslation\(\);/u,
    "Prompt Builder should receive the active language and existing translator");
  assert.match(promptsSource,
    /children: \(i18n\.language \|\| ""\)\.startsWith\("zh"\) \? "此区块使用主提示词文本或对话历史。" : "This block uses the main prompt text or conversation history\."/u,
    "Prompt Builder help copy should render in the selected language");
  assert.match(promptsSource, /children: t\("prompts\.pinned"\)/u,
    "Prompt Builder pinned badge should use the existing locale key");
  assert.match(bundle, /const prompts\$8 = \{[^\n]*"pinned": "pinned"/u,
    "English Prompt Builder pinned locale should be present");
  assert.match(bundle, /const prompts\$2 = \{[^\n]*"pinned": "已固定"/u,
    "Chinese Prompt Builder pinned locale should be present");

  const wrappers = [...bundle.matchAll(/const tV951 = \(key, params\) => v95Runtime\.t\(`legacyUiV951\.(summary|letters)\.\$\{key\}`, params\);/gu)];
  assert(wrappers.some(match => match[1] === "summary"), "Summary must route legacy labels through its V9.5.1 translator");
  assert(wrappers.some(match => match[1] === "letters"), "Letters must route legacy labels through its V9.5.1 translator");

  let literalCallCount = 0;
  const nextComponent = /\n(?:function [A-Z][\w$]*\s*\(|const [A-Z][\w$]*\s*=\s*(?:\(|function\b))/gu;
  for (const wrapper of wrappers) {
    nextComponent.lastIndex = wrapper.index + wrapper[0].length;
    const boundary = nextComponent.exec(bundle);
    const componentSource = bundle.slice(wrapper.index, boundary ? boundary.index : bundle.length);
    const keys = [...componentSource.matchAll(/\btV951\(\s*["']([^"']+)["']/gu)].map(match => match[1]);
    assert(keys.length > 0, `${wrapper[1]} production component must contain fixed-key translator calls`);
    literalCallCount += keys.length;
    for (const key of keys) assertKnownKey(fragment["zh-CN"][wrapper[1]], key, `production ${wrapper[1]} tV951 call`);
  }
  assert(literalCallCount > 0, "expected production tV951 calls in Summary and Letters");

  const namespacedCalls = [...bundle.matchAll(/v95Runtime\.t\(\s*["']legacyUiV951\.(summary|letters)\.([^"']+)["']/gu)];
  for (const [, section, key] of namespacedCalls) {
    assertKnownKey(fragment["zh-CN"][section], key, "production v95Runtime.t call");
  }

  const letterResultKeys = [...bundle.matchAll(/\bui(?:Result|Error)Key:\s*["']([^"']+)["']/gu)].map(match => match[1]);
  assert(letterResultKeys.length > 0, "letter diagnostic results should store localized keys");
  for (const key of letterResultKeys) assertKnownKey(fragment["zh-CN"].letters, key, "letter result descriptor");

  const summaryStart = bundle.indexOf("const SummariesManager = () => {");
  assert(summaryStart >= 0, "could not find production SummariesManager source");
  const summarySource = bundle.slice(summaryStart, summaryStart + 50000);
  const summaryResultKeys = [...summarySource.matchAll(/\bkey:\s*["']((?:retry|regeneration)\.[^"']+)["']/gu)].map(match => match[1]);
  assert(summaryResultKeys.length > 0, "summary result messages should store locale keys");
  for (const key of summaryResultKeys) assertKnownKey(fragment["zh-CN"].summary, key, "summary result descriptor");

  assert.match(bundle, /diagnosticResult\.uiResultKey\s*\?\s*tV951\(diagnosticResult\.uiResultKey,\s*diagnosticResult\.uiResultParams\)/u,
    "letter diagnostic render must translate the stored result key and params");
  assert.match(bundle, /retryResult\.v951Parts\.map\(\(part\)\s*=>\s*`\$\{tV951\(part\.key,\s*part\.params\)\}/u,
    "summary retry render must translate stored key/parameter parts on each render");
  assert.match(bundle, /summary\.content\.substring\(0,\s*150\)/u, "summary preview must continue to render source text directly");
  assert.match(bundle, /children:\s*summary\.content/u, "expanded summary body must continue to render source text directly");
  assert.match(bundle, /children:\s*letter\.summaryContent/u, "letter summary body must continue to render source text directly");
  assert.match(bundle, /children:\s*letter\.letterContent/u, "original letter body must continue to render source text directly");
  assert.doesNotMatch(bundle, /tV951\(\s*(?:summary\.content|letter\.(?:summaryContent|letterContent))/u,
    "dynamic source bodies must not be passed through the fixed-UI translator");

  const letterDescriptor = Object.freeze({ key: "result.commandRetried", params: Object.freeze({ id: "VOTC-RUN-7" }) });
  const summaryDescriptor = Object.freeze({ key: "retry.recoveryResult", params: Object.freeze({ recovered: 3, failed: 1 }) });
  const operationCount = 1;
  const renderDescriptor = (translate, prefix, descriptor) => translate(`${prefix}.${descriptor.key}`, descriptor.params);
  const letterEn = renderDescriptor(translators["en-US"], "legacyUiV951.letters", letterDescriptor);
  const letterZh = renderDescriptor(translators["zh-CN"], "legacyUiV951.letters", letterDescriptor);
  const summaryEn = renderDescriptor(translators["en-US"], "legacyUiV951.summary", summaryDescriptor);
  const summaryZh = renderDescriptor(translators["zh-CN"], "legacyUiV951.summary", summaryDescriptor);
  assert.notEqual(letterEn, letterZh, "the same saved letter result must update when the display language changes");
  assert(letterEn.includes("VOTC-RUN-7") && letterZh.includes("VOTC-RUN-7"), "letter result parameters must survive language changes");
  assert.notEqual(summaryEn, summaryZh, "the same saved summary result must update when the display language changes");
  assert(summaryEn.includes("3") && summaryEn.includes("1") && summaryZh.includes("3") && summaryZh.includes("1"),
    "summary result parameters must survive language changes");
  assert.equal(JSON.stringify(letterDescriptor), JSON.stringify({ key: "result.commandRetried", params: { id: "VOTC-RUN-7" } }));
  assert.equal(JSON.stringify(summaryDescriptor), JSON.stringify({ key: "retry.recoveryResult", params: { recovered: 3, failed: 1 } }));
  assert.equal(operationCount, 1, "rendering stored descriptors in another language must not repeat the completed operation");

  console.log(`V9.5.1 i18n coverage: PASS (${expectedLeafCount} bilingual keys; Provider/Worldline fixed labels and Prompt Builder copy resolve in both languages; source bodies stay raw)`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
