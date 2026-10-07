"use strict";

// Visual acceptance for the packaged renderer. Uses a disposable profile and
// never configures a Provider, CK3 path, or user runtime data directory.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { createMemoryUiFixture } = require("./v8.14-memory-ui-fixture");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const themes = [
  { key: "parchment", label: "游牧风格" },
  { key: "knight", label: "骑士纹章风格" },
  { key: "ink", label: "水墨画卷风格" }
];
const viewports = [
  { name: "desktop", width: 1280, height: 960 },
  { name: "narrow", width: 540, height: 900 }
];

async function connect(url, errors) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map();
  const events = new Map();
  const waits = new Map();
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const remote = /^https?:/.test(request.url);
      send(remote ? "Fetch.failRequest" : "Fetch.continueRequest", remote
        ? { requestId, errorReason: "BlockedByClient" } : { requestId }).catch(error => errors.push(error.message));
    }
    if (message.method === "Debugger.paused") {
      const waiter = waits.get(message.method);
      if (waiter) { waits.delete(message.method); clearTimeout(waiter.timer); waiter.resolve(message.params); }
      else events.set(message.method, message.params);
    }
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`));
    else request.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = method => {
    if (events.has(method)) { const value = events.get(method); events.delete(method); return Promise.resolve(value); }
    return new Promise((resolve, reject) => {
      waits.set(method, { resolve, timer: setTimeout(() => { waits.delete(method); reject(new Error(`CDP event timeout: ${method}`)); }, 20000) });
    });
  };
  return { socket, send, evaluate, wait };
}

async function waitFor(evaluate, expression, label) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function clickPoint(renderer, point) {
  await renderer.ensureVisible();
  assert(point, "click target is not visible");
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await renderer.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  await delay(220);
}

const visibleRectSource = `element => {
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
  for (let ancestor = element.parentElement; ancestor && (right > left && bottom > top); ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.overflowX !== 'visible') {
      const box = ancestor.getBoundingClientRect(), clipLeft = box.left + ancestor.clientLeft;
      left = Math.max(left, clipLeft);
      right = Math.min(right, clipLeft + ancestor.clientWidth);
    }
    if (style.overflowY !== 'visible') {
      const box = ancestor.getBoundingClientRect(), clipTop = box.top + ancestor.clientTop;
      top = Math.max(top, clipTop);
      bottom = Math.min(bottom, clipTop + ancestor.clientHeight);
    }
  }
  if (right - left <= 0.5 || bottom - top <= 0.5) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}`;

async function clickAt(renderer, selector, labels, description) {
  await renderer.ensureVisible();
  const point = await renderer.evaluate(`(() => {
    const visibleRect = ${visibleRectSource};
    const labels = ${JSON.stringify(labels)};
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item =>
      labels.includes(item.textContent.trim()) && item.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && visibleRect(item));
    if (!element) return null;
    const rect = visibleRect(element);
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert(point, `missing visible ${description}: ${labels.join(" / ")}`);
  await clickPoint(renderer, point);
}

async function clickTheme(renderer, theme) {
  await renderer.ensureVisible();
  const point = await renderer.evaluate(`(() => {
    const button = document.querySelector('.court-theme-button[aria-label=${JSON.stringify(`切换为${theme.label}`)}]');
    if (!button || !button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert(point, `theme control missing: ${theme.label}`);
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await renderer.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  await waitFor(renderer.evaluate, `document.documentElement.getAttribute('data-votc-theme') === ${JSON.stringify(theme.key)}`, `theme ${theme.key}`);
}

const layoutExpression = `(() => {
  const visibleRect = ${visibleRectSource};
  const panel = document.querySelector('.config-panel-container');
  const main = panel?.querySelector('.config-main-content');
  const footer = panel?.querySelector('.app-version');
  if (!panel || !main || !footer) return { missing: true };
  const bounds = element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  const panelRect = bounds(panel), mainRect = bounds(main), footerRect = bounds(footer);
  const buttons = [...panel.querySelectorAll('button')].map(button => {
    if (!button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
    const rect = visibleRect(button);
    if (!rect) return null;
    return { text: (button.innerText || button.getAttribute('aria-label') || button.title || '').trim().slice(0, 80),
      className: String(button.className || '').slice(0, 80), rect, inHeaderToolbar: !!button.closest('.discord-container'),
      textOverflow: !!button.textContent.trim() && button.scrollWidth > button.clientWidth + 2 };
  }).filter(Boolean);
  const toolbar = panel.querySelector('.config-header .discord-container');
  const toolbarControls = toolbar ? [...toolbar.querySelectorAll(':scope > .tooltip-button, :scope > .language-selector > button, :scope > .discord-button')].map(button => {
    const rawRect = bounds(button), cssVisible = button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const rect = cssVisible ? visibleRect(button) : null;
    const fullyVisible = !!rect && ['left', 'top', 'right', 'bottom'].every(edge => Math.abs(rect[edge] - rawRect[edge]) <= 0.75);
    return { kind: button.classList.contains('discord-button') ? 'discord' : button.closest('.language-selector') ? 'language' : 'help',
      className: String(button.className || ''), rect, bounds: rawRect, cssVisible, fullyVisible,
      partiallyClipped: !!rect && !fullyVisible, fullyClipped: cssVisible && !rect,
      visibleFraction: Number((rect ? rect.width * rect.height / Math.max(1, rawRect.width * rawRect.height) : 0).toFixed(3)) };
  }) : [];
  const buttonOverlaps = [];
  for (let left = 0; left < buttons.length; left++) for (let right = left + 1; right < buttons.length; right++) {
    const a = buttons[left].rect, b = buttons[right].rect;
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
      buttonOverlaps.push([buttons[left].text, buttons[right].text]);
    }
  }
  const overflowRegions = [panel, panel.querySelector('.config-header'), main, panel.querySelector('.worldline-view'),
    panel.querySelector('.memory-engine-overview'), panel.querySelector('.optimization-view')].filter(Boolean).map(element => {
    const style = getComputedStyle(element);
    return { selector: element.className || element.tagName, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
      overflowX: style.overflowX, horizontalOverflow: element.scrollWidth > element.clientWidth + 2 };
  });
  return {
    viewport: { width: innerWidth, height: innerHeight },
    panelWithinViewport: panelRect.left >= -1 && panelRect.top >= -1 && panelRect.right <= innerWidth + 1 && panelRect.bottom <= innerHeight + 1,
    documentHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    panelHorizontalOverflow: panel.scrollWidth > panel.clientWidth + 2,
    mainHorizontalOverflow: main.scrollWidth > main.clientWidth + 2,
    footerOverlapsMain: mainRect.bottom > footerRect.top + 1,
    buttonTextOverflow: buttons.filter(button => button.textOverflow).map(button => button.text),
    buttonOverlaps,
    buttons,
    headerToolbar: toolbar ? { containerWidth: Number(bounds(toolbar).width.toFixed(1)), maxWidth: getComputedStyle(toolbar).maxWidth,
      totalControlCount: toolbarControls.length, visibleControlCount: toolbarControls.filter(control => control.rect).length,
      fullyVisibleControlCount: toolbarControls.filter(control => control.fullyVisible).length,
      partiallyClippedControlCount: toolbarControls.filter(control => control.partiallyClipped).length,
      fullyClippedControlCount: toolbarControls.filter(control => control.fullyClipped).length,
      cssHiddenControlCount: toolbarControls.filter(control => !control.cssVisible).length, controls: toolbarControls } : null,
    overflowRegions
  };
})()`;

const typographyExpression = `(() => {
  const visibleRect = ${visibleRectSource};
  const panel = document.querySelector('.config-panel-container');
  if (!panel) return { missing: true };
  const parseColor = value => {
    const match = value.match(/^rgba?\\(([^)]+)\\)$/i);
    if (!match) return null;
    const parts = match[1].replace(/\\//g, ' ').split(/[ ,]+/).filter(Boolean).map(Number);
    return parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)
      ? { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 }
      : null;
  };
  const luminance = color => {
    const channel = value => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const ratio = (foreground, background) => {
    const a = luminance(foreground), b = luminance(background);
    return Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
  };
  const selectors = 'h1,h2,h3,h4,p,label,button,input,select,textarea,[role=tab],small,strong,legend,th,td';
  const elements = [...panel.querySelectorAll(selectors)].filter(element => {
    return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && visibleRect(element);
  });
  const samples = elements.slice(0, 120).map(element => {
    const style = getComputedStyle(element);
    const foreground = parseColor(style.color);
    let background = null, backgroundSelector = null;
    for (let node = element; node && panel.contains(node); node = node.parentElement) {
      const candidate = parseColor(getComputedStyle(node).backgroundColor);
      if (candidate?.a === 1) { background = candidate; backgroundSelector = node.className || node.tagName; break; }
    }
    const fontSize = Number.parseFloat(style.fontSize) || 0;
    const large = fontSize >= 24 || (fontSize >= 18.67 && Number.parseInt(style.fontWeight, 10) >= 700);
    const compositingAncestors = [];
    for (let node = element; node && panel.contains(node); node = node.parentElement) {
      const ancestorStyle = getComputedStyle(node);
      const opacity = Number.parseFloat(ancestorStyle.opacity);
      const backdropFilter = ancestorStyle.backdropFilter || ancestorStyle.webkitBackdropFilter || 'none';
      if (ancestorStyle.filter !== 'none' || backdropFilter !== 'none' || opacity < 0.999 || ancestorStyle.transform !== 'none') {
        compositingAncestors.push({ selector: String(node.className || node.tagName).slice(0, 80), filter: ancestorStyle.filter,
          backdropFilter, opacity: ancestorStyle.opacity, transform: ancestorStyle.transform });
      }
    }
    return { tag: element.tagName.toLowerCase(), className: String(element.className || '').slice(0, 80),
      text: (element.innerText || element.getAttribute('aria-label') || element.placeholder || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      fontFamily: style.fontFamily, fontSize: Number(fontSize.toFixed(1)), fontWeight: style.fontWeight, lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing, textShadow: style.textShadow, filter: style.filter,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none', opacity: style.opacity, transform: style.transform,
      compositingAncestors,
      color: style.color, backgroundColor: style.backgroundColor, nearestOpaqueBackground: backgroundSelector,
      opaqueColorContrastEstimate: foreground?.a === 1 && background ? ratio(foreground, background) : null,
      largeTextThreshold: large ? 3 : 4.5, backgroundImage: style.backgroundImage !== 'none' };
  });
  const sizeCounts = {};
  for (const sample of samples) sizeCounts[sample.fontSize] = (sizeCounts[sample.fontSize] || 0) + 1;
  const rootStyle = getComputedStyle(document.documentElement);
  return { visibleTextElementCount: elements.length, sampledElementCount: samples.length, sizeCounts,
    themeTokens: Object.fromEntries(['--ui-font', '--ui-text', '--ui-muted', '--ui-accent', '--ui-line', '--ui-surface'].map(name => [name, rootStyle.getPropertyValue(name).trim()])),
    below12px: samples.filter(sample => sample.text && sample.fontSize < 12).slice(0, 20), samples,
    contrastNote: 'Opaque-color estimates only; transparent layers and background images require screenshot review.' };
})()`;

async function activateMemoryFixture(renderer, main, fixture) {
  await waitFor(renderer.evaluate, "typeof conversationAPI?.getMemory4OwnerData === 'function'", "Memory4 preload API");
  const unavailable = await renderer.evaluate("conversationAPI.getMemory4OwnerData({ownerId:2})");
  assert.equal(unavailable.success, false, "fixture must start without an active conversation");
  await main.evaluate(`globalThis.__uiComfortConversation={id:'isolated-ui-comfort-conversation',isActive:true,getHistory:()=>[],getPresenceState:()=>({}),gameData:{campaignToken:${JSON.stringify(fixture.scope.campaignToken)},date:'1164.1.1',playerID:1,characters:new Map(${JSON.stringify(fixture.characters)}.map(character=>[character.id,character]))},dynamicRecallHistory:new Map()};globalThis.__uiComfortProviderCalls=0;`);
  const summarySource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/summaries/summaries-manager.js"), "utf8").split(/\r?\n/);
  const contextStart = summarySource.findIndex(line => line.includes("static async getMemory4ReadContext"));
  const contextLine = summarySource.findIndex((line, index) => index > contextStart && line.includes("const conversation = getCurrentMemory4ReadConversation();"));
  assert(contextLine > contextStart, "Memory4 read-context breakpoint source missing");
  const conversationSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/conversation/conversation-manager.js"), "utf8").split(/\r?\n/);
  const conversationLine = conversationSource.findIndex(line => line.includes("return this.currentConversation || this.lastMemory4ReadContext;"));
  assert(conversationLine > 0, "Memory4 current-conversation breakpoint source missing");
  const contextBreakpoint = await main.send("Debugger.setBreakpointByUrl", { urlRegex: "summaries-manager\\.js$", lineNumber: contextLine });
  const conversationBreakpoint = await main.send("Debugger.setBreakpointByUrl", { urlRegex: "conversation-manager\\.js$", lineNumber: conversationLine });
  const ownerRequest = renderer.evaluate("conversationAPI.getMemory4OwnerData({ownerId:2})");
  const contextPaused = await main.wait("Debugger.paused");
  const prepared = await main.send("Debugger.evaluateOnCallFrame", {
    callFrameId: contextPaused.callFrames[0].callFrameId,
    expression: "globalThis.__uiComfortConversation.memoryState=memoryEngine.createConversationState('isolated-ui-comfort-conversation');memoryEngine.memory4.configureDerived({isCampaignCurrent:token=>token===globalThis.__uiComfortConversation.gameData.campaignToken,requestCompression:async()=>{globalThis.__uiComfortProviderCalls++;throw new Error('fixture_provider_forbidden');},requestExtraction:async()=>{globalThis.__uiComfortProviderCalls++;throw new Error('fixture_provider_forbidden');}});'fixture-prepared'",
    returnByValue: true
  });
  assert(!prepared.exceptionDetails, JSON.stringify(prepared.exceptionDetails));
  await main.send("Debugger.removeBreakpoint", { breakpointId: contextBreakpoint.breakpointId });
  await main.send("Debugger.resume");
  const conversationPaused = await main.wait("Debugger.paused");
  const active = await main.send("Debugger.evaluateOnCallFrame", {
    callFrameId: conversationPaused.callFrames[0].callFrameId,
    expression: "this.currentConversation=globalThis.__uiComfortConversation;this.lastMemory4ReadContext=null;'fixture-active-context'",
    returnByValue: true
  });
  assert(!active.exceptionDetails, JSON.stringify(active.exceptionDetails));
  await main.send("Debugger.removeBreakpoint", { breakpointId: conversationBreakpoint.breakpointId });
  await main.send("Debugger.resume");
  const data = await ownerRequest;
  assert.equal(data.success, true, "actual preload/IPC should load the isolated Memory4 fixture");
  assert.equal(data.detail.total, 2, "fixture should include readable detailed memory entries");
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8151-ui-comfort-"));
  const fixture = await createMemoryUiFixture(profile);
  const evidence = path.join(profile, "ui-evidence");
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(profile, "votc-llm-config.json"), JSON.stringify({
    llmSettings: { providers: [], presets: [], activeProviderInstanceId: "deepseek" }
  }));
  const child = spawn(path.resolve(__dirname, "../VOTC.exe"), [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--inspect=127.0.0.1:0"], {
    windowsHide: true, env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile }, stdio: ["ignore", "pipe", "pipe"]
  });
  const errors = [];
  const failures = [];
  const screenshots = [];
  const reports = [];
  let networkBlocked = false;
  let providerCalls = null;
  let processOutput = "";
  let renderer;
  let mainProcess;
  const writeReport = (passed, error = null) => fs.writeFileSync(path.join(evidence, "ui-comfort-report.json"), JSON.stringify({
    passed, profile, screenshots, rendererErrors: errors, layoutFailures: failures, reports,
    providerConfigured: false, providerCalls, networkBlocked, realCK3Gate: false,
    error: error ? { message: error.message, stack: error.stack } : undefined,
    processOutput: passed ? undefined : processOutput,
    visualContrastAcceptance: "Opaque-color estimates only; transparent layers and background images require screenshot review."
  }, null, 2));
  try {
    const endpoints = await new Promise((resolve, reject) => {
      const found = {};
      const timer = setTimeout(() => reject(new Error(`DevTools endpoint timeout: ${processOutput.slice(-3000)}`)), 25000);
      const inspectOutput = chunk => {
        const output = String(chunk);
        processOutput = `${processOutput}${output}`.slice(-6000);
        const browser = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        const inspector = output.match(/Debugger listening on (ws:\/\/[^\s]+)/);
        if (browser) found.browser = browser[1];
        if (inspector) found.main = inspector[1];
        if (found.browser && found.main) { clearTimeout(timer); resolve(found); }
      };
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`VOTC exited before DevTools became ready (code=${code}, signal=${signal}): ${processOutput.slice(-3000)}`));
      });
      child.stderr.on("data", inspectOutput);
      child.stdout.on("data", inspectOutput);
    });
    mainProcess = await connect(endpoints.main, errors);
    await mainProcess.send("Runtime.enable");
    await mainProcess.send("Debugger.enable");
    // Only stop the disposable process's foreground poller; otherwise a user's
    // ordinary app switch races with CDP mouse input and closes the popup.
    const eventPrototype = await mainProcess.send("Runtime.evaluate", { expression: "process.mainModule.require('events').EventEmitter.prototype" });
    const eventInstances = await mainProcess.send("Runtime.queryObjects", { prototypeObjectId: eventPrototype.result.objectId });
    const focusStopped = await mainProcess.send("Runtime.callFunctionOn", {
      objectId: eventInstances.objects.objectId,
      functionDeclaration: "function(){const monitors=this.filter(object=>object.constructor?.name==='FocusMonitor'&&Object.hasOwn(object,'pollingInterval'));for(const monitor of monitors)monitor.stop();return monitors.length}",
      returnByValue: true
    });
    assert.equal(focusStopped.result.value, 1, "isolation should stop exactly one disposable FocusMonitor");
    await mainProcess.send("Runtime.releaseObject", { objectId: eventInstances.objects.objectId });
    await mainProcess.send("Runtime.releaseObject", { objectId: eventPrototype.result.objectId });
    await delay(600);
    await mainProcess.evaluate("globalThis.__uiComfortBlockedFetches=[];globalThis.fetch=async input=>{globalThis.__uiComfortBlockedFetches.push(String(input?.url||input));throw new Error('isolated_ui_network_blocked')};'network-blocker-installed'");
    const origin = new URL(endpoints.browser).origin.replace("ws:", "http:");
    let target;
    for (let attempt = 0; attempt < 80 && !target; attempt++) {
      target = (await (await fetch(`${origin}/json/list`)).json()).find(item => item.type === "page");
      if (!target) await delay(150);
    }
    assert(target, "packaged renderer target missing");
    renderer = await connect(target.webSocketDebuggerUrl, errors);
    // Foreground monitoring can hide the overlay while the user works elsewhere.
    // Exercise the normal visibility IPC in this disposable window, not DOM styles.
    renderer.ensureVisible = async () => {
      await mainProcess.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().filter(window=>!window.isDestroyed()).forEach(window=>{window.webContents.send('overlay-visibility-change',true);window.setIgnoreMouseEvents(false)});true");
      await waitFor(renderer.evaluate, "document.querySelector('.config-panel-container')?.getBoundingClientRect().width > 0", "visible isolated overlay");
    };
    await renderer.send("Runtime.enable");
    await renderer.send("Page.enable");
    await renderer.send("Network.enable");
    // Inspect the URL scheme: wildcard blocking also matches http namespaces
    // embedded inside local data: SVG icons and incorrectly hides those assets.
    await renderer.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    networkBlocked = true;
    await waitFor(renderer.evaluate, "!!window.llmConfigAPI && !!document.body", "VOTC preload and document");
    await activateMemoryFixture(renderer, mainProcess, fixture);

    const pages = [
      { key: "settings", labels: ["设置", "Settings"] },
      { key: "actions", labels: ["操作", "Actions"] },
      { key: "prompts", labels: ["提示词", "Prompts"] },
      { key: "summaries", labels: ["摘要", "Summaries"] },
      { key: "optimization", labels: ["优化", "Optimization"] },
      { key: "diagnostics", labels: ["诊断", "Diagnostics"] },
      { key: "worldline", labels: ["世界书", "Worldline"] }
    ];

    for (const viewport of viewports) {
      await mainProcess.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().filter(window=>!window.isDestroyed()).forEach(window=>window.setContentSize(${viewport.width},${viewport.height}));true`);
      await renderer.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false
      });
      const panelState = {
        position: { x: 20, y: 20 },
        size: { width: Math.max(400, Math.min(1000, viewport.width - 40)), height: Math.min(840, viewport.height - 40) }
      };
      await renderer.evaluate(`localStorage.setItem('votc-developer-mode','true');localStorage.setItem('config-panel-state',${JSON.stringify(JSON.stringify(panelState))})`);
      await renderer.send("Page.reload", { ignoreCache: true });
      await waitFor(renderer.evaluate, "!!document.querySelector('.config-panel-container .config-header')", "configuration panel");
      await delay(900);
      await renderer.ensureVisible();

      for (const theme of themes) {
        await clickTheme(renderer, theme);
        await renderer.evaluate("document.querySelector('.config-main-content')?.scrollTo({top:0,left:0,behavior:'instant'})");

        const capture = async pageKey => {
          await renderer.ensureVisible();
          await delay(250);
          const layout = await renderer.evaluate(layoutExpression);
          const typography = await renderer.evaluate(typographyExpression);
          assert(!layout.missing && !typography.missing, `${pageKey}: main renderer elements missing`);
          assert(layout.buttons.length > 0, `${pageKey}: renderer must not be blank`);
          const context = `${theme.key}/${viewport.name}/${pageKey}`;
          if (!layout.panelWithinViewport) failures.push(`${context}: config panel outside viewport`);
          if (layout.documentHorizontalOverflow) failures.push(`${context}: document horizontal overflow`);
          if (layout.panelHorizontalOverflow) failures.push(`${context}: panel horizontal overflow`);
          if (layout.mainHorizontalOverflow) failures.push(`${context}: main content horizontal overflow`);
          if (layout.footerOverlapsMain) failures.push(`${context}: footer overlaps content`);
          if (layout.buttonTextOverflow.length) failures.push(`${context}: button text overflow (${layout.buttonTextOverflow.join(" | ")})`);
          if (layout.buttonOverlaps.length) failures.push(`${context}: overlapping buttons (${layout.buttonOverlaps.map(pair => pair.join(" / ")).join(" | ")})`);
          const name = `${theme.key}-${viewport.name}-${pageKey}`;
          const image = await renderer.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(image.data, "base64"));
          screenshots.push(`${name}.png`);
          reports.push({ context, screenshot: `${name}.png`, layout, typography });
          return { layout, typography };
        };

        assert.equal(await renderer.evaluate("document.documentElement.getAttribute('data-votc-theme')"), theme.key, `theme did not apply: ${theme.key}`);
        await clickAt(renderer, ".config-header > button", ["连接", "Connection"], "header page connection");
        const connection = await capture("connection");
        const collapsedToolbar = connection.layout.headerToolbar;
        assert(collapsedToolbar, "header help toolbar missing from collapsed-state probe");
        assert.equal(collapsedToolbar.totalControlCount, 4, "toolbar should expose help, language, and two utility controls");
        assert.equal(collapsedToolbar.fullyVisibleControlCount, 1, "only help should be fully visible while the toolbar is collapsed");
        assert.equal(collapsedToolbar.partiallyClippedControlCount, 0, "collapsed utility controls should not leak as partially visible slivers");
        assert.equal(collapsedToolbar.fullyClippedControlCount, 3, "language and utility controls should be clipped by the collapsed ancestor");
        assert(collapsedToolbar.containerWidth <= 31, `collapsed toolbar unexpectedly wide: ${collapsedToolbar.containerWidth}`);
        const hoverPoint = await renderer.evaluate(`(() => {const toolbar=document.querySelector('.config-header .discord-container');const rect=toolbar?.getBoundingClientRect();return rect?{x:rect.left+Math.min(15,rect.width/2),y:rect.top+rect.height/2}:null})()`);
        assert(hoverPoint, "header help toolbar hover target missing");
        await renderer.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: viewport.width - 2, y: viewport.height - 2 });
        await renderer.ensureVisible();
        await renderer.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverPoint });
        await delay(420);
        assert(await renderer.evaluate("document.querySelector('.discord-container').matches(':hover')"), "real mouse hover must reach the toolbar, not the drag overlay");
        assert(await renderer.evaluate("(() => {const rect=document.querySelector('.config-panel-container .panel-drag-handle').getBoundingClientRect();return document.elementFromPoint(rect.left+rect.width/2,rect.top+16)?.classList.contains('panel-drag-handle')})()"), "blank top area below the resize edge must retain the drag handle");
        const expandedCapture = await capture("header-help-expanded");
        const expandedToolbar = expandedCapture.layout.headerToolbar;
        assert.equal(expandedToolbar?.fullyVisibleControlCount, 4, `all toolbar controls should be fully visible after hover expansion: ${JSON.stringify(expandedToolbar?.controls)}`);
        assert.equal(expandedToolbar?.partiallyClippedControlCount, 0, `expanded toolbar should not leave partially clipped controls: ${JSON.stringify(expandedToolbar?.controls)}`);
        assert.equal(expandedToolbar?.fullyClippedControlCount, 0, "expanded toolbar should not clip its controls");
        assert.equal(expandedCapture.layout.buttons.filter(button => button.inHeaderToolbar).length, 4, "expanded controls must enter the normal overlap detector");
        assert(await renderer.evaluate("[...document.querySelectorAll('.config-header img')].every(image=>image.complete&&image.naturalWidth>0)"), "local theme and tool icons must render");
        const languagePoint = await renderer.evaluate("(() => {const rect=document.querySelector('.language-selector .tooltip-button').getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()");
        assert(await renderer.evaluate(`!!document.elementFromPoint(${languagePoint.x},${languagePoint.y})?.closest('.language-selector .tooltip-button')`), "language control must receive real pointer input");
        await clickPoint(renderer, languagePoint);
        await waitFor(renderer.evaluate, "!!document.querySelector('.language-dropdown')", "language menu portal");
        const inspectLanguage = async state => {
          const language = await renderer.evaluate(`(() => {
            const menu = document.querySelector('.language-dropdown');
            const rect = menu.getBoundingClientRect();
            const rgb = value => value.match(/[\\d.]+/g).slice(0,3).map(Number);
            const luminance = value => rgb(value).map(channel => channel/255).map(channel => channel<=0.04045 ? channel/12.92 : ((channel+0.055)/1.055)**2.4).reduce((sum,channel,index)=>sum+channel*[0.2126,0.7152,0.0722][index],0);
            const contrast = (foreground,background) => {const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
            const options = [...menu.querySelectorAll('.language-option')].map(button => {
              const name = button.querySelector('.lang-name'), code = button.querySelector('.lang-code');
              const style=getComputedStyle(button), nameStyle=getComputedStyle(name), codeStyle=getComputedStyle(code);
              const codeBackground=codeStyle.backgroundColor==='rgba(0, 0, 0, 0)'?style.backgroundColor:codeStyle.backgroundColor;
              return {text:name.textContent,active:button.classList.contains('active'),foreground:nameStyle.color,background:style.backgroundColor,
                contrast:contrast(nameStyle.color,style.backgroundColor),codeContrast:contrast(codeStyle.color,codeBackground),fontFamily:nameStyle.fontFamily};
            });
            return {withinViewport:rect.left>=0 && rect.top>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight,
              horizontalOverflow:menu.scrollWidth>menu.clientWidth+2,options};
          })()`);
          assert(language.withinViewport && !language.horizontalOverflow, `${theme.key}/${viewport.name}: language menu outside viewport`);
          assert.equal(language.options.length, 9, "language menu should retain all nine languages");
          assert.equal(language.options.filter(option=>option.active).length, 1, "one language must remain selected");
          for (const option of language.options) {
            assert(option.contrast>=4.5 && option.codeContrast>=4.5, `${theme.key}/${state}: language contrast insufficient: ${JSON.stringify(option)}`);
          }
          const captured=await capture(`language-${state}`);
          reports[reports.length-1].language=language;
          return captured;
        };
        await inspectLanguage("open");
        const optionPoint=await renderer.evaluate("(() => {const rect=document.querySelector('.language-option:not(.active)').getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()");
        await renderer.send("Input.dispatchMouseEvent", {type:"mouseMoved",...optionPoint});
        await delay(200);
        await inspectLanguage("hover");
        const selectedPoint=await renderer.evaluate("(() => {const rect=document.querySelector('.language-option.active').getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()");
        await renderer.send("Input.dispatchMouseEvent", {type:"mouseMoved",...selectedPoint});
        await delay(200);
        await inspectLanguage("selected-hover");
        await clickAt(renderer, ".config-header > button", ["连接", "Connection"], "outside language menu");
        await waitFor(renderer.evaluate, "!document.querySelector('.language-dropdown')", "closed language menu");
        const leaveToolbarPoint = await renderer.evaluate(`(() => {const rect=document.querySelector('.config-main-content')?.getBoundingClientRect();return rect?{x:rect.left+Math.min(80,rect.width/2),y:rect.top+Math.min(80,rect.height/2)}:null})()`);
        await renderer.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...leaveToolbarPoint });
        await delay(360);
        for (const page of pages) {
          await clickAt(renderer, ".config-header > button", page.labels, `header page ${page.key}`);
          await renderer.evaluate("document.querySelector('.config-main-content')?.scrollTo({top:0,left:0,behavior:'instant'})");
          await capture(page.key);
          if (page.key === "worldline") {
            const tabs = await renderer.evaluate("[...document.querySelectorAll('.worldline-view [role=tab]')].map(tab=>tab.textContent.trim()).filter(Boolean)");
            for (let index = 0; index < tabs.length; index++) {
              await clickAt(renderer, ".worldline-view [role=tab]", [tabs[index]], `Worldline tab ${tabs[index]}`);
              await renderer.evaluate("document.querySelector('.config-main-content')?.scrollTo({top:0,left:0,behavior:'instant'})");
              await capture(`worldline-tab-${index + 1}`);
            }
          }
        }
      }
    }

    assert.deepStrictEqual(errors, [], `renderer exceptions: ${errors.join("; ")}`);
    assert.deepStrictEqual(failures, [], `layout failures: ${failures.join("; ")}`);
    providerCalls = await mainProcess.evaluate("globalThis.__uiComfortProviderCalls");
    assert.equal(providerCalls, 0, "isolated visual acceptance must not invoke the Memory Provider");
    writeReport(true);
    console.log(`VOTC isolated UI comfort smoke: PASS; ${screenshots.length} screenshots; evidence ${evidence}`);
  } catch (error) {
    try { writeReport(false, error); } catch (reportError) { console.error("Could not preserve failure report:", reportError.message); }
    console.error("VOTC UI comfort smoke diagnostics:", error.message);
    console.error("Renderer exceptions:", JSON.stringify(errors));
    console.error("Layout failures:", JSON.stringify(failures));
    throw error;
  } finally {
    renderer?.socket.close();
    mainProcess?.socket.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(5000)]);
    }
    console.log(`Isolated UI profile retained: ${profile}`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
