"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { mockPreloadSource } = require("./test-v9.5-renderer-ui.js");

const root = path.resolve(__dirname, "..");
const PAGES = [
  { id: "connection", labels: ["连接", "Connection"], selector: ".provider-config-panel" },
  { id: "settings", labels: ["设置", "Settings"], selector: ".settings-view" },
  { id: "actions", labels: ["操作", "Actions"], selector: ".actions-view" },
  { id: "prompts", labels: ["提示词", "Prompts"], selector: ".prompts-view" },
  { id: "summaries", labels: ["摘要", "Summaries"], selector: ".prompts-view #finalSummaryMaxTokens" },
  { id: "optimization", labels: ["优化", "Optimization"], selector: ".optimization-view:not(.provider-diagnostics-view)" },
  { id: "worldline", labels: ["世界书", "Worldline"], selector: ".worldline-view" },
  { id: "diagnostics", labels: ["诊断", "Diagnostics"], selector: ".provider-diagnostics-view" }
];

function prepareHeadRendererSnapshot() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.match(head, /^[0-9a-f]{40}$/i, "capture baseline requires a concrete HEAD revision");
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--",
    "src/app/renderer", "src/app/shared/pair-important-matters.js"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/).filter(Boolean);
  assert(paths.includes("src/app/renderer/index.html"), "HEAD baseline must include the renderer entry");
  assert(paths.includes("src/app/shared/pair-important-matters.js"), "HEAD baseline must include the shared parser used by index.html");

  const snapshotRoot = path.join(root, ".build", "v951baseline", head);
  for (const sourcePath of paths) {
    const relativePath = sourcePath === "src/app/shared/pair-important-matters.js"
      ? "shared/pair-important-matters.js"
      : path.posix.join("renderer", sourcePath.slice("src/app/renderer/".length));
    const destination = path.resolve(snapshotRoot, ...relativePath.split("/"));
    assert(destination.startsWith(`${snapshotRoot}${path.sep}`), "HEAD snapshot output must remain under .build/v951baseline");
    mkdirSync(path.dirname(destination), { recursive: true });
    const bytes = execFileSync("git", ["show", `HEAD:${sourcePath}`], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024
    });
    writeFileSync(destination, bytes);
  }
  return { head, snapshotRoot, indexPath: `/.build/v951baseline/${head}/renderer/index.html` };
}

async function clickHeaderButton(browser, labels) {
  const clicked = await browser.evaluate(`(() => {
    const labels = ${JSON.stringify(labels)};
    const button = Array.from(document.querySelectorAll(".config-header > button"))
      .find(candidate => labels.some(label => candidate.textContent.trim().includes(label)));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `expected navigation button ${labels.join("/")}`);
}

async function selectLanguage(browser, code) {
  const opened = await browser.evaluate(`(() => {
    const button = document.querySelector(".language-selector > button");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(opened, true, "expected the production language selector");
  await browser.waitFor("document.querySelector('.language-dropdown .language-option')");
  const selected = await browser.evaluate(`(() => {
    const option = Array.from(document.querySelectorAll(".language-option"))
      .find(candidate => candidate.querySelector(".lang-code")?.textContent.trim() === ${JSON.stringify(code)});
    if (!option) return false;
    option.click();
    return true;
  })()`);
  assert.equal(selected, true, `expected language option ${code}`);
  const language = code === "EN" ? "en-US" : "zh-CN";
  await browser.waitFor(`window.__v95RendererUiFixture.uiLanguage === ${JSON.stringify(language)} && !document.querySelector('.language-dropdown')`);
}

async function selectTheme(browser, theme) {
  const selected = await browser.evaluate(`(() => {
    const image = document.querySelector('button.court-theme-button img[src*="theme-${theme}-v1.png"]');
    if (!image) return false;
    image.closest("button").click();
    return true;
  })()`);
  assert.equal(selected, true, `expected production theme button ${theme}`);
  await browser.waitFor(`document.documentElement.getAttribute('data-votc-theme') === ${JSON.stringify(theme)}`);
}

async function assertNoOverflowAndFocus(browser, label) {
  const result = await browser.evaluate(`(() => {
    const input = document.querySelector('.v95-language-settings input[type="checkbox"]');
    const closeButton = document.querySelector('.config-panel-container .config-header .config-close-button');
    if (!input || !closeButton) return null;
    const closeRect = closeButton.getBoundingClientRect();
    const closeStyle = getComputedStyle(closeButton);
    const panel = document.querySelector('.config-panel-container');
    const panelRect = panel.getBoundingClientRect();
    closeButton.focus();
    const closeFocused = document.activeElement === closeButton;
    input.focus();
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      panel: {
        left: Math.round(panelRect.left),
        top: Math.round(panelRect.top),
        width: Math.round(panelRect.width),
        height: Math.round(panelRect.height),
        inlineLeft: panel.style.left,
        inlineWidth: panel.style.width
      },
      scrolling: {
        element: document.scrollingElement?.tagName.toLowerCase() || "",
        htmlClient: document.documentElement.clientWidth,
        htmlScroll: document.documentElement.scrollWidth,
        bodyClient: document.body.clientWidth,
        bodyScroll: document.body.scrollWidth
      },
      app: (() => {
        const node = document.querySelector(".App");
        const rect = node?.getBoundingClientRect();
        const style = node ? getComputedStyle(node) : null;
        return node ? {
          left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width),
          position: style.position, transform: style.transform, overflowX: style.overflowX,
          scrollWidth: node.scrollWidth, clientWidth: node.clientWidth
        } : null;
      })(),
      focused: document.activeElement === input,
      closeButton: {
        left: Math.round(closeRect.left),
        top: Math.round(closeRect.top),
        right: Math.round(closeRect.right),
        bottom: Math.round(closeRect.bottom),
        display: closeStyle.display,
        visibility: closeStyle.visibility,
        opacity: closeStyle.opacity,
        disabled: closeButton.disabled,
        focused: closeFocused
      },
      scale: window.devicePixelRatio,
      overflowNodes: Array.from(document.querySelectorAll("body *"))
        .map(node => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            tag: node.tagName.toLowerCase(),
            className: typeof node.className === "string" ? node.className : "",
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            position: style.position,
            minWidth: style.minWidth,
            overflowX: style.overflowX,
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            parent: node.parentElement?.className || node.parentElement?.tagName.toLowerCase() || ""
          };
        })
        .filter(node => node.width > 0 && (node.left < 0 || node.right > window.innerWidth + 1 || node.scrollWidth > node.clientWidth + 1))
        .sort((left, right) => Math.max(right.right, right.scrollWidth) - Math.max(left.right, left.scrollWidth))
        .slice(0, 12)
    };
  })()`);
  assert(result, `${label}: settings input and panel close button should be present`);
  assert(result.documentWidth <= result.viewport && result.bodyWidth <= result.viewport,
    `${label}: production page should not overflow horizontally (${JSON.stringify(result)})`);
  assert(result.closeButton.left >= 0 && result.closeButton.right <= result.viewport,
    `${label}: panel close button should remain reachable onscreen (${JSON.stringify(result.closeButton)})`);
  assert(result.closeButton.top >= 0 && result.closeButton.bottom > result.closeButton.top,
    `${label}: panel close button should remain vertically visible (${JSON.stringify(result.closeButton)})`);
  assert.equal(result.closeButton.display === "none" || result.closeButton.visibility === "hidden" || Number(result.closeButton.opacity) === 0, false,
    `${label}: panel close button should remain visible (${JSON.stringify(result.closeButton)})`);
  assert.equal(result.closeButton.disabled, false, `${label}: panel close button should remain enabled`);
  assert.equal(result.closeButton.focused, true, `${label}: panel close button should accept focus`);
  assert.equal(result.focused, true, `${label}: settings input should accept focus`);
  return result;
}

async function assertNavIcon(browser, labels, iconName) {
  await browser.waitFor(`(() => {
    const labels = ${JSON.stringify(labels)};
    const button = Array.from(document.querySelectorAll(".config-header > button"))
      .find(candidate => labels.some(label => candidate.textContent.trim().includes(label)));
    return Boolean(button?.querySelector('.v95-tab-icon svg[data-icon="${iconName}"] path'));
  })()`);
  const detail = await browser.evaluate(`(() => {
    const labels = ${JSON.stringify(labels)};
    const button = Array.from(document.querySelectorAll(".config-header > button"))
      .find(candidate => labels.some(label => candidate.textContent.trim().includes(label)));
    const svg = button?.querySelector(".v95-tab-icon svg");
    return { name: svg?.dataset.icon, shapes: svg?.childElementCount || 0 };
  })()`);
  assert.equal(detail.name, iconName, `${labels.join("/")} should use the reviewed shared icon`);
  assert(detail.shapes > 0, `${iconName} should have actual SVG geometry`);
}

async function openAllOriginalPages(browser, localeIndex, { verifyPresentation = true, screenshotDir = null } = {}) {
  for (const page of PAGES) {
    const labels = page.labels;
    await clickHeaderButton(browser, labels);
    try {
      await browser.waitFor(`document.querySelector(${JSON.stringify(page.selector)})`, { timeout: 5000 });
    } catch (error) {
      const debug = await browser.evaluate(`(() => ({
        active: document.querySelector(".config-header > button.active")?.textContent.trim() || "",
        headerButtons: Array.from(document.querySelectorAll(".config-header > button")).map(button => button.textContent.trim()),
        content: document.querySelector(".config-main-content")?.innerText.slice(0, 600) || "",
        children: Array.from(document.querySelector(".config-main-content")?.children || []).map(node => node.className || node.tagName),
        errors: window.__v95TestRuntimeErrors || []
      }))()`);
      throw new Error(`${labels.join("/")} did not render ${page.selector}: ${JSON.stringify({ debug, runtimeErrors: browser.errors, consoleErrors: browser.consoleErrors })}; ${error.message}`);
    }
    const state = await browser.evaluate(`(() => {
      const active = document.querySelector(".config-header > button.active");
      const main = document.querySelector(".config-main-content");
      return { label: active?.textContent.trim() || "", contentChildren: main?.children.length || 0 };
    })()`);
    assert(labels.some(label => state.label.includes(label)), `navigation should activate ${labels[localeIndex]}`);
    assert(state.contentChildren > 0, `${labels[localeIndex]} should render its original production page`);

    if (verifyPresentation && page.labels[0] === "优化") await assertNavIcon(browser, labels, "optimization");
    if (verifyPresentation && page.labels[0] === "世界书") await assertNavIcon(browser, labels, "worldbook");
    if (verifyPresentation && page.labels[0] === "连接" && localeIndex === 1) {
      for (const [provider, selector] of [["Openai-compatible", "#actionSchemaDeliveryMode"], ["Deepseek", "#deepseekActionStablePrefixOptimization"], ["GLM", "#glmReasoningEffort"], ["Player2", ".open-player2-button"]]) {
        assert.equal(await browser.evaluate(`(() => {
          const item = Array.from(document.querySelectorAll('.provider-list li')).find(node => node.textContent.trim() === ${JSON.stringify(provider)});
          if (!item) return false;
          item.click();
          return true;
        })()`), true, `${provider} remains selectable`);
        await browser.waitFor(`document.querySelector(${JSON.stringify(selector)})`);
        if (provider === "Player2") continue;
        const copy = await browser.evaluate(`(() => {
          const card = document.querySelector(${JSON.stringify(selector)}).closest('.form-group');
          return card.innerText;
        })()`);
        assert(!/[\u3400-\u9fff]/u.test(copy), `${provider} fixed configuration labels must be English`);
        if (provider === "Openai-compatible") {
          assert(copy.includes("Standard: send Schema through response_format (recommended)"));
          assert(copy.includes("json_object"));
        }
        if (provider === "GLM") {
          assert(copy.includes("Reasoning effort"));
          assert.equal(await browser.evaluate("document.querySelector('.provider-list').innerText.includes('智谱')"), false);
        }
      }
    }
    if (verifyPresentation && page.labels[0] === "操作") {
      await browser.waitFor(`document.querySelector('.actions-view .action-item .action-title-group svg.v95-page-row-icon[data-icon="action"] path')`);
      assert.equal(await browser.evaluate("document.querySelector('.actions-view .action-title').textContent"),
        localeIndex === 0 ? "只读夹具动作" : "Read-only fixture action", "original action titles should follow UI language");
    }
    if (verifyPresentation && page.labels[0] === "摘要") {
      const card = await browser.evaluate("document.querySelector('#finalSummaryMaxTokens').closest('.form-group').textContent");
      assert(card.includes(localeIndex === 0 ? "最终摘要最大输出 Token" : "Final summary maximum output tokens"), `summary locale mismatch: ${JSON.stringify({ localeIndex, card })}`);
      if (localeIndex === 1) assert(!/[\u3400-\u9fff]/u.test(card), "summary token settings must not show a Chinese fallback");
    }
    if (verifyPresentation && page.labels[0] === "优化") {
      await browser.waitFor(`document.querySelector('.optimization-view:not(.provider-diagnostics-view) .optimization-metric svg.v95-page-row-icon[data-icon="optimization"] path')`);
      await browser.waitFor(`document.querySelector('.optimization-view').innerText.includes('action | deepseek | fixture-model')`);
      const body = await browser.evaluate("document.querySelector('.optimization-view').innerText");
      assert(!body.includes("Critical Action Recall") && !body.includes("关键动作召回"), "obsolete recall statistics should be absent even with old data");
    }
    if (page.labels[0] === "世界书") {
      if (verifyPresentation) {
        await browser.waitFor(`document.querySelector('.worldline-header .v95-page-status[data-status] svg[data-icon] path')`);
        const status = await browser.evaluate(`(() => {
          const badge = document.querySelector(".worldline-header .v95-page-status");
          const icon = badge?.querySelector("svg[data-icon]");
          return { status: badge?.dataset.status, icon: icon?.dataset.icon, shapes: icon?.childElementCount || 0 };
        })()`);
        assert.equal(status.status, "UNKNOWN", "unconfigured anonymous worldline fixture should remain UNKNOWN");
        assert.equal(status.icon, "unknown", "the live production status badge should use the neutral unknown icon");
        assert(status.shapes > 0, "the status badge icon should contain rendered SVG geometry");
      }
      const tabLabels = localeIndex === 0 ? ["世界知识"] : ["World Knowledge"];
      if (verifyPresentation || screenshotDir) {
        const opened = await browser.evaluate(`(() => {
          const labels = ${JSON.stringify(tabLabels)};
          const tab = Array.from(document.querySelectorAll('.worldline-tabs [role="tab"]'))
            .find(candidate => labels.some(label => candidate.textContent.trim().includes(label)));
          if (!tab) return false;
          tab.click();
          return true;
        })()`);
        assert.equal(opened, true, `expected the ${tabLabels[0]} worldline subtab`);
        if (verifyPresentation) {
          await browser.waitFor(`document.querySelector('.worldline-view .worldline-list .worldline-row svg.v95-page-row-icon[data-icon="worldbook"] path')`);
        } else {
          await browser.waitFor(`(() => {
            const labels = ${JSON.stringify(tabLabels)};
            return Array.from(document.querySelectorAll('.worldline-tabs [role="tab"]'))
              .some(tab => labels.some(label => tab.textContent.trim().includes(label)) && tab.getAttribute('aria-selected') === 'true');
          })()`);
        }
      }
    }
    if (screenshotDir) {
      await browser.evaluate("new Promise(resolve => setTimeout(resolve, 220))");
      await browser.screenshot(path.join(screenshotDir, `${page.id}.png`));
    }
  }
}

async function main() {
  const capturePageSnapshots = process.argv.includes("--capture-page-snapshots");
  const [{ startServer }, { launchBrowser }] = await Promise.all([
    import(pathToFileURL(path.join(root, "review", "v95-deepseek", "serve.mjs")).href),
    import(pathToFileURL(path.join(root, "review", "v95-deepseek", "tests", "browser.mjs")).href)
  ]);
  const server = await startServer({ port: 0 });
  let browser = null;
  try {
    const bootstrapUrl = "data:text/html,%3C!doctype%20html%3E%3Chtml%20data-demo-ready%3D%22true%22%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E";
    browser = await launchBrowser({ url: bootstrapUrl, width: 1280, height: 720 });
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: mockPreloadSource({ presentationEnabled: true }) });
    browser.errors.length = 0;
    browser.consoleErrors.length = 0;
    browser.failedRequests.length = 0;
    browser.requests.length = 0;
    const origin = new URL(server.url).origin;
    const pageCapture = capturePageSnapshots ? {
      beforeDir: path.join(root, ".build", "v9.5.1", "visual", "pages-before"),
      afterDir: path.join(root, ".build", "v9.5.1", "visual", "pages-after")
    } : null;
    let baseline = null;
    let beforeScreenshots = 0;
    if (capturePageSnapshots) {
      baseline = prepareHeadRendererSnapshot();
      const baselineRequestsStart = browser.requests.length;
      await browser.send("Page.navigate", { url: `${origin}${baseline.indexPath}` });
      await browser.waitFor("document.querySelector('.config-panel-container .provider-config-panel') && document.querySelector('.language-selector')", { timeout: 25000 });
      await selectLanguage(browser, "ZH");
      await selectTheme(browser, "parchment");
      await openAllOriginalPages(browser, 0, { verifyPresentation: false, screenshotDir: pageCapture.beforeDir });
      beforeScreenshots = PAGES.length;
      const baselineRequests = browser.requests.slice(baselineRequestsStart);
      assert(baselineRequests.every(url => new URL(url).origin === origin || url.startsWith("data:image/")),
        "HEAD baseline capture must load only local assets and inline data images");
      browser.errors.length = 0;
      browser.consoleErrors.length = 0;
      browser.failedRequests.length = 0;
      browser.requests.length = 0;
    }
    await browser.send("Page.navigate", { url: `${origin}/src/app/renderer/index.html` });
    await browser.waitFor("document.querySelector('.config-panel-container .provider-config-panel') && document.querySelector('.language-selector')", { timeout: 25000 });
    assert.equal(await browser.evaluate("window.__v95RendererUiFixture.appSettings.showSettingsOnStartup"), true);

    const protectedBefore = await browser.evaluate("window.__v95RendererUiFixture.protectedSnapshot()");
    if (capturePageSnapshots) {
      await selectLanguage(browser, "ZH");
      await selectTheme(browser, "parchment");
    }
    await openAllOriginalPages(browser, 0, capturePageSnapshots
      ? { screenshotDir: pageCapture.afterDir }
      : undefined);
    await selectLanguage(browser, "EN");
    await browser.waitFor("document.querySelector('.config-header').innerText.includes('Optimization')");
    await openAllOriginalPages(browser, 1);

    // Capture the actual production settings panel in each theme/locale pairing.
    await clickHeaderButton(browser, ["Settings"]);
    await browser.waitFor("document.querySelector('.settings-view .v95-language-settings input[type=checkbox]')");
    const screenshotDir = path.join(root, ".build", "v9.5.1", "visual");
    for (const [theme, code, suffix] of [
      ["parchment", "ZH", "zh"], ["parchment", "EN", "en"],
      ["knight", "ZH", "zh"], ["knight", "EN", "en"],
      ["ink", "ZH", "zh"], ["ink", "EN", "en"]
    ]) {
      await selectLanguage(browser, code);
      await selectTheme(browser, theme);
      await browser.setViewport(1280, 720);
      await assertNoOverflowAndFocus(browser, `${theme}/${suffix}/1280x720`);
      await browser.evaluate("new Promise(resolve => setTimeout(resolve, 220))");
      await browser.screenshot(path.join(screenshotDir, `${theme}-${suffix}-1280x720.png`));
    }

    const responsiveEvidence = [];
    for (const [width, height, label] of [[1280, 720, "100%"], [1024, 576, "125% equivalent"], [853, 480, "150% equivalent"]]) {
      await browser.setViewport(width, height);
      await browser.waitFor(`(() => {
        const panel = document.querySelector('.config-panel-container');
        if (window.innerWidth !== ${width} || !panel) return false;
        const rect = panel.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth + 1;
      })()`, { timeout: 5000 });
      const result = await assertNoOverflowAndFocus(browser, `${label} settings viewport`);
      responsiveEvidence.push({ viewport: result.viewport, panel: result.panel, closeButton: result.closeButton });
    }

    const fixtureState = await browser.evaluate(`(() => ({
      effects: window.__v95RendererUiFixture.effectApiCalls,
      providerWrites: window.__v95RendererUiFixture.providerConfigWrites,
      promptWrites: window.__v95RendererUiFixture.promptWrites,
      legacyCalls: window.__v95RendererUiFixture.legacyLanguageCalls,
      unexpected: window.__v95RendererUiFixture.unexpectedCalls,
      blockedNetwork: window.__v95RendererUiFixture.blockedNetwork,
      protectedSnapshot: window.__v95RendererUiFixture.protectedSnapshot(),
      reads: window.__v95RendererUiFixture.readCalls
    }))()`);
    assert.deepEqual(fixtureState.effects, [], "opening read-only production pages must not call game/action/letter effect APIs");
    assert.deepEqual(fixtureState.providerWrites, [], "navigation and language selection must not write provider configuration");
    assert.deepEqual(fixtureState.promptWrites, [], "navigation must not write prompt configuration");
    assert.deepEqual(fixtureState.legacyCalls, [], "the UI locale control must not call the legacy prompt-language API");
    assert(fixtureState.reads.includes("worldlineAPI.getWorldKnowledge"), "the worldbook row must come from the explicit safe mock read");
    assert(fixtureState.reads.includes("providerDiagnosticsAPI.getRealRequestDiff"), "the diagnostics page must use its explicit safe read mock");
    assert.deepEqual(fixtureState.unexpected, [], "all production page IPC reads should have explicit anonymous mock handlers");
    assert.deepEqual(fixtureState.blockedNetwork, [], "production UI must not attempt external network access");
    assert.equal(fixtureState.protectedSnapshot, protectedBefore, "provider, prompt and legacy-language config must remain unchanged");
    assert(browser.requests.every(url => new URL(url).origin === origin || url.startsWith("data:image/")),
      "the production entry should load only local assets and inline data images");
    assert.deepEqual(browser.errors, [], "the production bundle should boot and navigate without runtime exceptions");
    assert.deepEqual(browser.consoleErrors, [], "the production renderer should not log console errors");
    assert.deepEqual(browser.failedRequests, [], "all local production assets should load successfully");
    const pageCaptureSummary = capturePageSnapshots
      ? `; pageSnapshots={head:${baseline.head},before:${beforeScreenshots},after:${PAGES.length},root:${path.relative(root, pageCapture.afterDir)}}`
      : "";
    process.stdout.write(`V9.5.1 production navigation/icons: PASS (8 pages, two locales, three themes, anonymous read-only fixtures; responsive=${JSON.stringify(responsiveEvidence)}${pageCaptureSummary})\n`);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
