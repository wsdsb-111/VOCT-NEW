"use strict";

// Optional packaged-app smoke with an isolated profile, no provider requests.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v88-startup-"));
  const screenshotDirectory = path.join(profile, "ui-evidence");
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  fs.writeFileSync(path.join(profile, "votc-llm-config.json"), JSON.stringify({
    llmSettings: { providers: [], presets: [], activeProviderInstanceId: "deepseek" }
  }));
  const child = spawn(path.resolve(__dirname, "../VOTC.exe"), [`--user-data-dir=${profile}`, "--remote-debugging-port=0"], {
    windowsHide: true, env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile }, stdio: ["ignore", "pipe", "pipe"]
  });
  let ws;
  const errors = [];
  const layoutFailures = [];
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("debug endpoint timeout")), 20000);
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.stderr.on("data", chunk => {
        console.error("ELECTRON", String(chunk).trim());
        const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.stdout.resume();
    });
    const origin = new URL(endpoint).origin.replace("ws:", "http:");
    let target;
    for (let attempt = 0; attempt < 50 && !target; attempt++) {
      target = (await (await fetch(`${origin}/json/list`)).json()).find(item => item.type === "page");
      if (!target) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(target, "renderer target missing");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let sequence = 0;
    const requests = new Map();
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      const pending = requests.get(message.id);
      if (!pending) return;
      requests.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { requests.delete(id); reject(new Error(`timeout ${method}`)); }, 60000);
      requests.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const clickButton = async labels => {
      const clicked = await evaluate(`(() => { const labels=${JSON.stringify(labels)}; const button=[...document.querySelectorAll('button')].find(item=>labels.includes(item.textContent.trim())); if(button)button.click(); return !!button; })()`);
      assert(clicked, `missing button: ${labels.join(" / ")}`);
      await new Promise(resolve => setTimeout(resolve, 500));
      await evaluate("(()=>{const content=document.querySelector('.config-main-content');if(content)content.scrollTop=0})()");
    };
    const clickWorldlineTab = async labels => {
      const clicked = await evaluate(`(() => { const labels=${JSON.stringify(labels)}; const tab=[...document.querySelectorAll('[role=tab]')].find(item=>labels.includes(item.textContent.trim())); if(tab)tab.click(); return !!tab; })()`);
      assert(clicked, `missing worldline tab: ${labels.join(" / ")}`);
      await new Promise(resolve => setTimeout(resolve, 450));
      await evaluate("(()=>{const content=document.querySelector('.config-main-content');if(content)content.scrollTop=0})()");
    };
    const captureScreenshot = async name => {
      const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const screenshotPath = path.join(screenshotDirectory, `${name}.png`);
      fs.writeFileSync(screenshotPath, Buffer.from(result.data, "base64"));
      return screenshotPath;
    };
    const assertScreenshotLayout = async context => {
      const layout = await evaluate(`(() => {
        const panel = document.querySelector('.config-panel-container');
        const main = panel?.querySelector('.config-main-content');
        const footer = panel?.querySelector('.app-version');
        if (!panel || !main || !footer) return { missing: true };
        const panelRect = panel.getBoundingClientRect();
        const mainRect = main.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        const buttons = [...panel.querySelectorAll('button')].filter(button => {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }).map(button => {
          let clip = { left: panelRect.left, top: panelRect.top, right: panelRect.right, bottom: panelRect.bottom };
          for (let ancestor = button.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
              const rect = ancestor.getBoundingClientRect();
              clip = { left: Math.max(clip.left, rect.left), top: Math.max(clip.top, rect.top), right: Math.min(clip.right, rect.right), bottom: Math.min(clip.bottom, rect.bottom) };
            }
            if (ancestor === panel) break;
          }
          clip = { left: Math.max(0, clip.left), top: Math.max(0, clip.top), right: Math.min(innerWidth, clip.right), bottom: Math.min(innerHeight, clip.bottom) };
          const buttonRect = button.getBoundingClientRect();
          if (buttonRect.right <= clip.left + 1 || buttonRect.left >= clip.right - 1 || buttonRect.bottom <= clip.top + 1 || buttonRect.top >= clip.bottom - 1) return null;
          const text = button.innerText.trim();
          const textRects = [];
          const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
          for (let node; node = walker.nextNode();) {
            if (!node.nodeValue.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            textRects.push(...[...range.getClientRects()].filter(rect => rect.right > clip.left + 1 && rect.left < clip.right - 1 && rect.bottom > clip.top + 1 && rect.top < clip.bottom - 1).map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })));
          }
          return { text, textRects, overflow: !!text && button.scrollWidth > button.clientWidth + 2 };
        }).filter(Boolean);
        const textOverlaps = [];
        for (let left = 0; left < buttons.length; left++) for (let right = left + 1; right < buttons.length; right++) {
          for (const a of buttons[left].textRects) for (const b of buttons[right].textRects) {
            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) textOverlaps.push([buttons[left].text, buttons[right].text]);
          }
        }
        const footerTextOverlaps = [];
        if (mainRect.bottom > footerRect.top + 1) {
          const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
          for (let node; node = walker.nextNode();) {
            if (!node.nodeValue.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              if (rect.right > footerRect.left + 1 && rect.left < footerRect.right - 1 && rect.bottom > Math.max(mainRect.top, footerRect.top) + 1 && rect.top < Math.min(mainRect.bottom, footerRect.bottom) - 1) {
                footerTextOverlaps.push(node.nodeValue.trim().slice(0, 80));
                break;
              }
            }
          }
        }
        return {
          panelWithinViewport: panelRect.left >= 0 && panelRect.top >= 0 && panelRect.right <= innerWidth && panelRect.bottom <= innerHeight,
          documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
          panelOverflow: panel.scrollWidth > panel.clientWidth + 2 || main.scrollWidth > main.clientWidth + 2,
          footerOverlapsMain: mainRect.bottom > footerRect.top + 1,
          buttonTextOverflow: buttons.filter(button => button.overflow).map(button => button.text),
          buttonTextOverlaps: textOverlaps,
          footerTextOverlaps
        };
      })()`);
      assert(!layout.missing, `${context}: config panel, content, or footer missing`);
      if (layout.buttonTextOverflow.length || layout.buttonTextOverlaps.length || layout.footerOverlapsMain || layout.footerTextOverlaps.length || layout.documentOverflow || layout.panelOverflow) {
        console.log("SCREEN_LAYOUT", context, JSON.stringify(layout));
      }
      if (!layout.panelWithinViewport) layoutFailures.push(`${context}: config panel falls outside the viewport`);
      if (layout.documentOverflow) layoutFailures.push(`${context}: document has horizontal overflow`);
      if (layout.panelOverflow) layoutFailures.push(`${context}: config content has horizontal overflow`);
      if (layout.footerOverlapsMain) layoutFailures.push(`${context}: footer overlaps the content viewport`);
      if (layout.buttonTextOverflow.length) layoutFailures.push(`${context}: button text overflows (${layout.buttonTextOverflow.join(" | ")})`);
      if (layout.buttonTextOverlaps.length) layoutFailures.push(`${context}: button text overlaps (${layout.buttonTextOverlaps.map(pair => pair.join(" / ")).join(" | ")})`);
      if (layout.footerTextOverlaps.length) layoutFailures.push(`${context}: footer overlaps text (${layout.footerTextOverlaps.join(" | ")})`);
    };
    await send("Runtime.enable");
    await send("Page.enable");
    await evaluate("localStorage.setItem('votc-developer-mode','true')");
    await send("Page.reload", { ignoreCache: true });
    await new Promise(resolve => setTimeout(resolve, 2500));
    console.log("STARTUP", await evaluate("JSON.stringify({length:document.body.innerText.length,text:document.body.innerText.slice(0,400)})"));
    assert(await evaluate("document.body.innerText.length > 30"), "startup rendered an empty body");
    assert.equal(await evaluate("llmConfigAPI.getAppSettings().then(settings => settings.llmSettings.activeProviderInstanceId)"), "deepseek", "isolated smoke must use the no-request DeepSeek model list");
    if (process.argv[2]) {
      const save = path.resolve(process.argv[2]);
      assert(fs.existsSync(save), "save missing");
      console.log("Loading read-only save into isolated profile");
      const loaded = await evaluate(`(async () => { await worldlineAPI.setAutosavePath(${JSON.stringify(save)}); await worldlineAPI.validateAutosavePath(); await worldlineAPI.rebuildCheckpoint(); return worldlineAPI.getCheckpointStatus(); })()`);
      console.log("CHECKPOINT", JSON.stringify(loaded));
      assert.equal(loaded.checkpoint.status, "ACTIVE");
    }
    console.log("BUTTONS", await evaluate("[...document.querySelectorAll('button')].map(e=>e.textContent.trim()).slice(0,30)"));
    const clickProvider = async name => {
      const clickedProvider = await evaluate(`(() => { const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()===${JSON.stringify(name)});if(e)e.click();return !!e; })()`);
      assert(clickedProvider, `provider missing: ${name}`);
      await new Promise(resolve => setTimeout(resolve, 300));
    };
    await clickProvider("Openai-compatible");
    assert(await evaluate("!!document.querySelector('#actionSchemaDeliveryMode')"), "OpenAI-compatible Action Schema transport selector missing");
    await clickProvider("Deepseek");
    assert(await evaluate("document.querySelector('#deepseekActionStateTransitionRecallOverlay')?.checked===true"), "DeepSeek state transition overlay must default on");
    assert(await evaluate("document.querySelector('#deepseekActionStablePrefixOptimization')?.checked===true"), "DeepSeek stable prefix must default on");
    await clickProvider("Summaries");
    assert(await evaluate("typeof conversationAPI.retryFailedSummaries === 'function'"), "summary retry preload bridge missing");
    const recoveryStatus = await evaluate("conversationAPI.getSummariesDashboardData().then(data => data.recoveryStatus)");
    for (const key of ["pending", "manual", "balanceBlocked", "narrativePending", "durablePending"]) assert.equal(recoveryStatus[key], 0);
    assert.equal(recoveryStatus.running, false);
    assert(await evaluate("[...document.querySelectorAll('button')].some(button => button.textContent === '重试失败记忆任务' && button.disabled)"), "empty recovery queue must show a disabled retry button");
    assert(await evaluate("['记忆召回诊断（最近实际请求）','摘要恢复诊断','Provider 缓存诊断'].every(label=>[...document.querySelectorAll('summary')].some(e=>e.textContent===label))"), "incident diagnostics panels missing");
    const incidentDiagnostics = await evaluate("conversationAPI.getSummariesDashboardData().then(data=>data.incidentDiagnostics)");
    for (const key of ["recall", "recovery", "providerCache"]) assert(Array.isArray(incidentDiagnostics[key]), `missing read-only diagnostics ${key}`);
    assert.equal((await evaluate("conversationAPI.retryFailedSummaries()")).recovered, 0, "empty queue must not call a provider");
    await clickProvider("诊断");
    assert(await evaluate("!!document.querySelector('.provider-diagnostics-view')"), "provider diagnostics page rendered an empty body");
    console.log("DIAGNOSTICS", await evaluate("document.querySelector('.provider-diagnostics-view')?.innerText.slice(0,600)"));
    assert(await evaluate("['真实请求差异诊断','Real Request Diff Diagnostics'].includes(document.querySelector('.provider-diagnostics-view h3')?.textContent.trim())"), "real request diff diagnostics heading missing");
    assert(await evaluate("['导出 Real Request Diff','Export Real Request Diff'].some(label=>[...document.querySelectorAll('.provider-diagnostics-view button')].some(e=>e.textContent.trim()===label))"), "real request diff export button missing");
    assert(await evaluate("!![...document.querySelectorAll('.provider-diagnostics-view h4')].find(e=>/Prefix Length Buckets/.test(e.textContent))"), "prefix bucket analysis missing");
    assert(await evaluate("![...document.querySelectorAll('.provider-diagnostics-view button')].some(e=>/TTL 探针|测试缓存|运行全部测试|仅测试 Stream|仅测试 Prefix|仅测试多轮/.test(e.textContent.trim()))"), "obsolete synthetic diagnostic controls remain");
    assert(await evaluate("[...document.querySelectorAll('.provider-diagnostics-view h4')].some(e=>['对话 Prompt 兼容开关','Chat Prompt compatibility switches'].includes(e.textContent.trim()))"), "Chat Prompt diagnostics switches missing");
    assert(await evaluate("document.querySelectorAll('.provider-diagnostics-view input[type=checkbox]').length===4"), "V8.10 diagnostics must expose layout, outbound, runtime profile and Provider Adapter switches");
    assert(await evaluate("document.querySelector('.provider-diagnostics-view')?.textContent.includes('Current Prompt Profile') || document.querySelector('.provider-diagnostics-view')?.textContent.includes('当前 Prompt Profile')"), "V8.10 prompt profile diagnostics missing");
    const clicked = await evaluate("(() => { const e=[...document.querySelectorAll('button')].find(e=>['世界书','Worldline'].includes(e.textContent.trim())); if(e)e.click();return !!e; })()");
    assert(clicked, "worldline navigation missing");
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert(await evaluate("!!document.querySelector('.worldline-view')"), "worldline rendered an empty body");
    if (process.argv[2]) {
      console.log("HISTORICAL_QUERY", await evaluate("(async () => { const start=Date.now(); const r=await worldlineAPI.getHistoricalBindings({query:'岳飞'}); return {ms:Date.now()-start,total:r.total,rows:r.bindings?.length}; })()"));
      console.log("INSPECTOR", await evaluate("(async () => { const options=await worldlineAPI.getSubjectiveResponderOptions({}); const id=String(options.currentPlayerId); const start=Date.now();const r=await worldlineAPI.getEntityKinshipInspector({responderId:id,targetId:id});return {ms:Date.now()-start,available:r.available,reason:r.reason,profiling:r.profiling}; })()"));
    }
    console.log("TABS", await evaluate("[...document.querySelectorAll('[role=tab]')].map(e=>e.textContent.trim())"));
    for (const tab of [["历史身份", "Historical Identity"], ["开发者诊断", "Developer Diagnostics"], ["世界概览", "Overview"]]) {
      assert(await evaluate(`(() => { const e=[...document.querySelectorAll('[role=tab]')].find(e=>${JSON.stringify(tab)}.includes(e.textContent.trim()));if(e)e.click();return !!e; })()`), `missing tab ${tab}`);
      await new Promise(resolve => setTimeout(resolve, 400));
      assert(await evaluate("!!document.querySelector('.worldline-view')"), `blank tab ${tab}`);
      if (tab[1] === "Developer Diagnostics") {
        assert(await evaluate("document.querySelector('.worldline-view').textContent.includes('CK3 官方追忆（只读）') || document.querySelector('.worldline-view').textContent.includes('CK3 Official Recollection (read-only)')"), "official recollection read-only panel missing");
        assert(await evaluate("typeof worldlineAPI.getOfficialRecollection === 'function'"), "official recollection read-only preload bridge missing");
        assert(await evaluate("document.querySelector('.worldline-view').textContent.includes('时间归档与历史检索') || document.querySelector('.worldline-view').textContent.includes('Temporal Archive & Historical Retrieval')"), "archive diagnostics missing");
        assert(await evaluate("typeof worldlineAPI.temporalArchive === 'function'"), "archive preload bridge missing");
        assert(await evaluate("!/(V8\\.12 Temporal Archive|Phase A 只读诊断|Phase A read-only diagnostics)/.test(document.querySelector('.worldline-view').textContent)"), "obsolete worldline stage labels remain");
        const flags = await evaluate("(async () => { await worldlineAPI.setRecallSettings({v812TemporalArchiveEnabled:true}); const a=await worldlineAPI.getSettings(); await worldlineAPI.setRecallSettings({v812TemporalArchiveEnabled:false}); return [a.v812TemporalArchiveEnabled,a.v812TemporalArchiveShadowMode,a.v812HistoricalPromptIntegration]; })()");
        assert.deepEqual(flags, [true, true, false]);
        assert.equal((await evaluate("worldlineAPI.temporalArchive({operation:'capture'})")).error, "HISTORY_DISABLED");
      }
    }

    const screenshotPaths = [];
    const themes = ["parchment", "knight", "ink"];
    const viewports = [{ name: "desktop", width: 1280, height: 1000 }, { name: "narrow", width: 540, height: 900 }];
    for (const theme of themes) {
      for (const viewport of viewports) {
        await send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
        const viewName = `${theme}-${viewport.name}`;
        const panelState = {
          position: { x: 20, y: 20 },
          size: { width: Math.max(400, Math.min(1000, viewport.width - 40)), height: Math.min(840, viewport.height - 40) }
        };
        await evaluate(`localStorage.setItem('votc-ui-theme', ${JSON.stringify(theme)});localStorage.setItem('config-panel-state',${JSON.stringify(JSON.stringify(panelState))})`);
        await send("Page.reload", { ignoreCache: true });
        await new Promise(resolve => setTimeout(resolve, 2200));
        assert.equal(await evaluate("localStorage.getItem('votc-ui-theme')"), theme, `theme did not persist: ${theme}`);

        await clickButton(["Summaries", "摘要"]);
        assert(await evaluate("!!document.querySelector('.memory-engine-overview')"), "memory overview page missing");
        assert(await evaluate("document.querySelector('.memory-engine-overview')?.textContent.includes('Memory Engine 4.0')"), "Memory Engine 4.0 overview heading missing");
        assert(await evaluate("/^V8\\.14\\.1\\s*·\\s*App v2\\.0\\.4$/.test(document.querySelector('.app-version')?.textContent.trim() || '')"), "feature and packaged-app versions are not both shown in the footer");
        await evaluate("document.querySelector('.memory-engine-overview')?.scrollIntoView({block:'start'})");
        await assertScreenshotLayout(`${viewName} Memory`);
        screenshotPaths.push(await captureScreenshot(`${viewName}-memory`));

        await clickButton(["优化", "Optimization"]);
        let capabilitiesReady = false;
        for (let attempt = 0; attempt < 40 && !capabilitiesReady; attempt++) {
          capabilitiesReady = await evaluate("!!document.querySelector('.optimization-capability-details')");
          if (!capabilitiesReady) await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert(capabilitiesReady, "optimization capability details did not load with the usage report");
        const capabilitiesExpanded = await evaluate(`(() => {
          const details = document.querySelector('.optimization-capability-details');
          const summary = details?.querySelector('summary');
          if (!details || !summary) return false;
          if (!details.open) summary.click();
          return details.open;
        })()`);
        assert(capabilitiesExpanded, "optimization capability details did not expand");
        const optimizationText = await evaluate("document.querySelector('.optimization-view:not(.provider-diagnostics-view)')?.innerText || ''");
        assert(/当前功能与验收边界|Current capabilities and acceptance boundaries/i.test(optimizationText), "current optimization capabilities heading missing");
        assert(!/查看 V7\.10 适配状态|View V7\.10 integration status/i.test(optimizationText), "obsolete V7.10 capability heading remains");
        assert(optimizationText.includes("V8.14.1") && optimizationText.includes("Memory Engine 4.0"), "optimization overview does not show current feature content");
        assert(/GLM 缓存调优延后至 V8\.14\.2|GLM cache tuning is deferred to V8\.14\.2/i.test(optimizationText), "GLM deferral is missing from optimization overview");
        assert(/完整信件流程尚未完成实机验收|Full letter in-game acceptance is still pending/i.test(optimizationText), "letter in-game acceptance boundary is missing from capabilities");
        await assertScreenshotLayout(`${viewName} Optimization`);
        screenshotPaths.push(await captureScreenshot(`${viewName}-optimization`));
        const letterCapabilityVisible = await evaluate(`(() => {
          const item = [...document.querySelectorAll('.optimization-capability')].find(node => /信件知情与投递|Letter knowledge and delivery/i.test(node.textContent));
          if (item) item.scrollIntoView({ block: 'center' });
          return !!item;
        })()`);
        assert(letterCapabilityVisible, "letter knowledge boundary capability missing");
        await assertScreenshotLayout(`${viewName} Optimization Letter Boundary`);
        screenshotPaths.push(await captureScreenshot(`${viewName}-optimization-letter-boundary`));

        await clickButton(["世界书", "Worldline"]);
        let worldlineText = await evaluate("document.querySelector('.worldline-view')?.innerText || ''");
        assert(worldlineText.includes("V8.14.1") && /CK3 当前事实只读|Current CK3 facts are read-only/i.test(worldlineText), "current worldline heading/read-only statement missing");
        await assertScreenshotLayout(`${viewName} Worldline`);
        screenshotPaths.push(await captureScreenshot(`${viewName}-worldline`));

        await clickWorldlineTab(["开发者诊断", "Developer Diagnostics"]);
        worldlineText = await evaluate("document.querySelector('.worldline-view')?.innerText || ''");
        assert(/CK3 官方追忆（只读）|CK3 Official Recollection \(read-only\)/i.test(worldlineText), "official recollection is not labeled read-only");
        assert(!/(V8\.7 世界书|V8\.12 Temporal Archive|Memory Engine 3\.0 · CK3 Official Recollection|Phase A 只读诊断|Phase A read-only diagnostics)/i.test(worldlineText), "obsolete worldline/recollection stage labels remain");
        const officialPanelVisible = await evaluate(`(() => {
          const heading = [...document.querySelectorAll('.worldline-view h4')].find(item => /CK3 官方追忆（只读）|CK3 Official Recollection \\(read-only\\)/i.test(item.textContent));
          if (heading) heading.scrollIntoView({ block: 'center' });
          return !!heading;
        })()`);
        assert(officialPanelVisible, "official recollection panel missing");
        await assertScreenshotLayout(`${viewName} Worldline Diagnostics`);
        screenshotPaths.push(await captureScreenshot(`${viewName}-worldline-diagnostics`));
        const archivePanelVisible = await evaluate(`(() => {
          const heading = [...document.querySelectorAll('.worldline-view h4')].find(item => /时间归档与历史检索|Temporal Archive & Historical Retrieval/i.test(item.textContent));
          if (heading) heading.scrollIntoView({ block: 'center' });
          return !!heading;
        })()`);
        assert(archivePanelVisible, "temporal archive panel missing");
        await assertScreenshotLayout(`${viewName} Worldline Archive`);
        screenshotPaths.push(await captureScreenshot(`${viewName}-worldline-archive`));
      }
    }
    console.log("UI_EVIDENCE", JSON.stringify({ directory: screenshotDirectory, screenshots: screenshotPaths }));
    assert.deepEqual(layoutFailures, [], `UI layout checks failed: ${layoutFailures.join("; ")}`);
    assert.deepEqual(errors, [], "renderer exceptions");
    console.log("V8.14.1 isolated Electron startup, current-content navigation, and three-theme desktop/narrow-window screenshots: PASS");
  } finally {
    console.log("RENDERER_ERRORS", JSON.stringify(errors));
    ws?.close();
    child.kill();
    console.log("Isolated test profile retained:", profile);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
