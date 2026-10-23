"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

class FakeNode {
  constructor(tagName, nodeType = 1, nodeValue = "") {
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = nodeType;
    this.nodeValue = nodeValue;
    this.childNodes = [];
    this.parentNode = null;
    this._attributes = new Map();
    this.attributes = [];
    this.listeners = new Map();
    this.classList = {
      add: name => {
        const classes = new Set((this.getAttribute("class") || "").split(/\s+/).filter(Boolean));
        classes.add(name);
        this.setAttribute("class", Array.from(classes).join(" "));
      }
    };
    this.dataset = new Proxy({}, {
      set: (target, name, value) => {
        target[name] = String(value);
        const attr = `data-${String(name).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
        this.setAttribute(attr, value);
        return true;
      }
    });
  }

  setAttribute(name, value) {
    const key = String(name);
    const text = String(value);
    this._attributes.set(key, text);
    this.attributes = Array.from(this._attributes, ([attributeName, attributeValue]) => ({ name: attributeName, value: attributeValue }));
  }

  getAttribute(name) {
    return this._attributes.get(String(name)) ?? null;
  }

  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  insertBefore(node, reference) {
    if (!reference) return this.appendChild(node);
    const index = this.childNodes.indexOf(reference);
    assert.notEqual(index, -1, "reference child belongs to its parent");
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.splice(index, 0, node);
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  contains(target) {
    return this === target || this.childNodes.some(child => child.contains?.(target));
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get textContent() {
    if (this.nodeType === 3) return this.nodeValue;
    return this.childNodes.map(child => child.textContent).join("");
  }

  set textContent(value) {
    this.childNodes = [];
    const text = String(value);
    if (text) this.appendChild(new FakeNode("#text", 3, text));
  }
}

global.document = {
  createElement: tag => new FakeNode(tag),
  createElementNS: (_namespace, tag) => new FakeNode(tag),
  createTextNode: text => new FakeNode("#text", 3, String(text))
};

function jsx(type, props, key = null) {
  return { type, props, key };
}

function descendants(node, predicate, found = []) {
  if (!node || typeof node !== "object") return found;
  if (predicate(node)) found.push(node);
  const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
  for (const child of children) descendants(child, predicate, found);
  return found;
}

function assertPattern(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const { createReactVisuals } = await import(pathToFileURL(path.join(root, "src/app/renderer/v95/integration/react-visuals.js")));
  const { defaultIconRegistry } = await import(pathToFileURL(path.join(root, "src/app/renderer/v95/icons/icon-registry.js")));
  const visuals = createReactVisuals({ jsxRuntime: { jsx, jsxs: jsx }, iconRegistry: defaultIconRegistry });

  const providerIcon = visuals.Icon({ name: "provider", size: 14 });
  assert.equal(providerIcon.type, "svg");
  assert.equal(providerIcon.props["data-icon"], "provider");
  assert.equal(providerIcon.props.strokeWidth, "1.7");
  assert.equal(providerIcon.props["aria-hidden"], "true");

  const status = visuals.StatusBadge({ code: "CONFIRMED", label: "Already confirmed" });
  assert.equal(status.type, "span");
  assert.equal(status.props["data-status"], "CONFIRMED");
  assert.equal(status.props.className.includes("v95-page-status"), true);
  assert.equal(descendants(status, node => node.type === "span" && node.props.className === "v95-status-label")[0].props.children, "Already confirmed");
  const unsupportedStatus = visuals.StatusBadge({ code: "legacy_custom_state", label: "Original custom state" });
  assert.equal(unsupportedStatus.props["data-status"], "UNKNOWN");
  assert.equal(unsupportedStatus.props["data-status-fallback"], "true");
  assert.equal(visuals.StatusBadge({ code: "ERROR", label: "" }), null);

  const row = new FakeNode("article");
  const title = new FakeNode("p");
  title.textContent = "Original ledger item";
  row.appendChild(title);
  const clickHandler = () => {};
  row.addEventListener("click", clickHandler);
  const icon = visuals.decorateLegacyRow(row, { target: title, icon: "memory" });
  assert.equal(icon.getAttribute("data-icon"), "memory");
  assert.equal(title.firstChild, icon);
  assert.equal(title.textContent, "Original ledger item");
  assert.deepEqual(row.listeners.get("click"), [clickHandler]);
  assert.equal(visuals.decorateLegacyRow(row, { target: title, icon: "memory" }), null);
  assert.equal(title.childNodes.length, 2);
  assert.equal(visuals.decorateLegacyRow(new FakeNode("article"), { target: title, icon: "memory" }), null);

  const bundle = fs.readFileSync(path.join(root, "src/app/renderer/assets/index-Dn3qWlAB.js"), "utf8");
  const runtimeInputs = JSON.parse(fs.readFileSync(path.join(root, "build/runtime-inputs.json"), "utf8"));
  assert.ok(runtimeInputs.files.some(entry => entry.source === "renderer/v95/integration/react-visuals.js"
    && entry.target === "out/renderer/v95/integration/react-visuals.js"), "shared adapter must be in the runtime copy map");

  const initAt = bundle.indexOf("var jsxRuntimeExports = requireJsxRuntime();");
  const visualsInitAt = bundle.indexOf("const V95PageVisuals = createReactVisuals({");
  const rootRenderAt = bundle.indexOf("root.render(", visualsInitAt);
  assert.ok(bundle.includes('import { createReactVisuals } from "../v95/integration/react-visuals.js";'));
  assert.ok(initAt >= 0 && visualsInitAt > initAt && rootRenderAt > visualsInitAt,
    "shared React components must initialize after the JSX runtime and before rendering the app");
  assert.ok(bundle.includes("window.VOTCV95PageVisuals = V95PageVisuals;"),
    "legacy row callers require the shared adapter to be exposed before the app renders");

  const settingsStart = bundle.indexOf("function V95UiSettings()");
  const settingsEnd = bundle.indexOf("const VOTC_FEATURE_VERSION", settingsStart);
  const settingsSource = bundle.slice(settingsStart, settingsEnd);
  assertPattern(bundle, /className: "provider-list", children: baseProviderTypes\.map\(\(type\) => \{[\s\S]{0,1600}onClick: \(\) => onSelectProviderType\(type\)[\s\S]{0,700}V95PageVisuals\.Icon, \{ name: "provider" \}\)[\s\S]{0,180}getProviderDisplayName\(type\)/,
    "provider icon must be a child of the selectable provider row");
  assertPattern(settingsSource, /className: "v95-language-settings"[\s\S]{0,220}V95PageVisuals\.Icon, \{ name: "settings" \}\), v95Runtime\.t\("settings\.uiLanguage"\)[\s\S]{0,100}preferences\.uiLanguage/,
    "settings icon must be next to the actual uiLanguage display value");
  assert.ok(settingsSource.includes("v95Runtime.setPresentationEnabled(enabled)"));
  assert.ok(settingsSource.includes("onChange: event => update(event.target.checked)"),
    "the existing presentation control must retain its handler");
  assertPattern(bundle, /htmlFor: "globalStreamEnabled", children: \[jsxRuntimeExports\.jsx\(V95PageVisuals\.Icon, \{ name: "settings" \}\),[\s\S]{0,220}t\("settings\.enableStreamingGlobally"\)/,
    "the actual global streaming settings label must render the shared icon");
  const streamLabelAt = bundle.indexOf('htmlFor: "globalStreamEnabled"');
  const streamLabelSource = bundle.slice(streamLabelAt, streamLabelAt + 1200);
  assert.ok(streamLabelAt >= 0 && streamLabelSource.includes('id: "globalStreamEnabled"')
    && streamLabelSource.includes('name: "globalStreamEnabled"')
    && streamLabelSource.includes("checked: appSettings.globalStreamEnabled ?? true")
    && streamLabelSource.includes("onChange: handleGlobalStreamToggle"),
  "the shared icon must leave the existing global streaming control bound to its original setting and handler");

  assertPattern(bundle, /className: "action-title-group", children: \[jsxRuntimeExports\.jsx\(V95PageVisuals\.Icon, \{ name: "action" \}\),[\s\S]{0,900}copyValidationMessage\(a\.validation\.message\)[\s\S]{0,400}children: a\.title/,
    "action icon must stay beside the title and preserve validation-copy behavior");
  assertPattern(bundle, /lifecycleLabel && (?:\/\* @__PURE__ \*\/ )?jsxRuntimeExports\.jsx\("span", \{ className: "action-feedback-status", children: (?:\/\* @__PURE__ \*\/ )?jsxRuntimeExports\.jsx\(V95PageVisuals\.StatusBadge, \{ code: lifecycleStatus, label: lifecycleLabel \}\) \}\)/,
    "action feedback badge must receive the current lifecycle code and caller-owned label");
  assert.ok(bundle.includes('className: "action-feedback-message", children: feedback.message'),
    "the shared status badge must not replace the action feedback message");

  assert.ok(bundle.includes('V95PageVisuals.Icon, { name: "edit" }), t("prompts.mainPrompt")'),
    "the main Prompt heading must render its shared icon");
  const mainPromptCardAt = bundle.indexOf('className: "main-prompt-card"');
  const mainPromptTitleAt = bundle.indexOf('t("prompts.mainPrompt")', mainPromptCardAt);
  const resetMainAt = bundle.indexOf("onClick: handleResetMain", mainPromptTitleAt);
  assert.ok(mainPromptCardAt >= 0 && mainPromptTitleAt - mainPromptCardAt < 1000
    && resetMainAt > mainPromptTitleAt && resetMainAt - mainPromptTitleAt < 500,
  "main Prompt icon must preserve the existing reset control in its card");
  const previewBlocksAt = bundle.indexOf("previewData.blocks.map((block, index) =>");
  const previewBlocksSource = bundle.slice(previewBlocksAt, previewBlocksAt + 2200);
  assert.ok(previewBlocksAt >= 0 && previewBlocksSource.includes('className: "block-title"')
    && previewBlocksSource.includes('V95PageVisuals.Icon, { name: "edit" }')
    && previewBlocksSource.includes("block.block.label")
    && previewBlocksSource.includes("onClick: () => toggleBlockExpanded(index)"),
  "each actual Prompt Preview block title must render the shared icon and preserve its label and expansion action");
  assertPattern(bundle, /className: "summary-date", children: \[jsxRuntimeExports\.jsx\(V95PageVisuals\.Icon, \{ name: "memory" \}\),[\s\S]{0,300}summary\.sourceType === "CK3_OFFICIAL_RECOLLECTION"[\s\S]{0,200}summary\.date/,
    "summary icon must be a real date/source row child and retain its source/date values");

  const optimizationMetricsAt = bundle.indexOf('className: "optimization-metrics", children: metrics.map(([label, value, tone])');
  const optimizationMetricsSource = bundle.slice(optimizationMetricsAt, optimizationMetricsAt + 900);
  assert.ok(optimizationMetricsAt >= 0 && optimizationMetricsSource.includes('className: `optimization-metric ${tone}`')
    && optimizationMetricsSource.includes('V95PageVisuals.Icon, { name: "optimization" }')
    && optimizationMetricsSource.includes("children: label") && optimizationMetricsSource.includes("children: value"),
  "the actual main optimization metrics.map rows must render the shared icon with the existing metric values");
  assertPattern(bundle, /const metric = \(label, value\) => (?:\/\* @__PURE__ \*\/ )?jsxRuntimeExports\.jsxs\("div", \{ className: "optimization-metric", children: \[jsxRuntimeExports\.jsx\(V95PageVisuals\.Icon, \{ name: "optimization" \}\)/,
    "the shared metric helper must render the icon for its actual callers");
  assertPattern(bundle, /className: `worldline-status worldline-status-\$\{String\(pipelineStatus \|\| loadState\)\.toLowerCase\(\)\}`, children: jsxRuntimeExports\.jsx\(V95PageVisuals\.StatusBadge, \{ code: apiReady \? pipelineStatus : "UNKNOWN", label: apiReady \? player\.status\(pipelineStatus\) : text\("暂不可用", "Unavailable"\) \}\)/,
    "worldline status badge must consume only the existing pipeline state and localized label");
  assertPattern(bundle, /facts\.map\(\(fact, index\) => (?:\/\* @__PURE__ \*\/ )?jsxRuntimeExports\.jsxs\("article", \{ className: "worldline-row", children: \[jsxRuntimeExports\.jsx\(V95PageVisuals\.Icon, \{ name: "worldbook" \}\)/,
    "worldline icon must be present on an actual fact list row");
  for (const [listStart, label] of [
    ["diagnosticsRows.length ? diagnosticsRows.map", "diagnostic rows"],
    ["worldKnowledge.map((item, index)", "world knowledge rows"]
  ]) {
    const listAt = bundle.indexOf(listStart);
    const listSource = bundle.slice(listAt, listAt + 900);
    assert.ok(listAt >= 0 && listSource.includes('V95PageVisuals.Icon, { name: "worldbook" }'),
      `shared worldline icon must be inside the actual ${label} list`);
  }

  assertPattern(bundle, /className: "letter-header", onClick: onToggle, children: \[jsxRuntimeExports\.jsx\(V95PageVisuals\.Icon, \{ name: "letter" \}\),/,
    "letter icon must preserve the existing collapsible header");
  assert.ok(bundle.includes("getStatusIcon(letter.responseStatus)"));
  assert.ok(bundle.includes("getStatusText(letter.responseStatus, letter.payloadErrorCode)"),
    "legacy letter delivery states must keep their original icon and text renderer");

  const knowledgeSource = fs.readFileSync(path.join(root, "src/app/renderer/character-knowledge-ui.js"), "utf8");
  const pairSource = fs.readFileSync(path.join(root, "src/app/renderer/pair-long-term-ui.js"), "utf8");
  assert.ok(knowledgeSource.includes('window.VOTCV95PageVisuals?.decorateLegacyRow(row, { target: title, icon: "knowledge" });'));
  assert.ok(pairSource.includes('root.VOTCV95PageVisuals?.decorateLegacyRow(row, { target: itemText, icon: "memory" });'));
  const worldMemorySource = fs.readFileSync(path.join(root, "src/app/renderer/world-memory-editor.js"), "utf8");
  assertPattern(worldMemorySource, /window\.VOTCV95PageVisuals\?\.Icon \? h\(window\.VOTCV95PageVisuals\.Icon, \{ name: "worldbook" \}\) : null, record\.title/,
    "World Memory Editor must keep its record title while conditionally adding the shared icon");
  assert.ok(worldMemorySource.includes('className: `world-memory-status-tag status-${String(record.status).toLowerCase()}`'),
    "World Memory Editor must retain the existing record status tag");

  for (const iconId of ["provider", "settings", "action", "edit", "memory", "optimization", "worldbook", "letter", "knowledge"]) {
    const rendered = defaultIconRegistry.renderIcon(iconId, { decorative: true });
    assert.equal(rendered?.getAttribute("data-icon"), iconId, `shared production call uses a registered icon: ${iconId}`);
  }

  const integrationSource = fs.readFileSync(path.join(root, "src/app/renderer/v95/integration/react-visuals.js"), "utf8");
  assert.ok(!integrationSource.includes("MutationObserver"));
  assert.ok(!integrationSource.includes("querySelectorAll"));
  assert.ok(!integrationSource.includes("ipcRenderer"));
  assert.ok(!integrationSource.includes("fetch("));
  console.log("PASS: shared page visuals have live production call patterns, preserve supplied state/text/handlers, and keep legacy rows explicit.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
