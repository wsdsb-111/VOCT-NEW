"use strict";

// Optional actual Electron smoke in a disposable profile; no CK3 or Provider fixture.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map();
  const contexts = new Map();
  let contextId;
  let nextId = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.executionContextCreated") contexts.set(message.params.context.id, message.params.context);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return { socket, send, evaluate, contexts, selectContext: id => { contextId = id; } };
}

async function launch(enabled, evidenceRoot) {
  const profile = path.join(evidenceRoot, enabled ? "enabled" : "disabled");
  fs.mkdirSync(profile);
  const args = [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--inspect=127.0.0.1:0"];
  if (enabled) args.push("--diagnostics");
  const child = spawn(path.resolve(__dirname, "../VOTC.exe"), args, {
    windowsHide: true,
    env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile, VOTC_DIAGNOSTICS: "0" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.resume();
  let stderr = "", main, renderer;
  child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-16000); });
  const exited = new Promise(resolve => child.once("exit", resolve));
  try {
    let mainUrl, browserUrl;
    for (let i = 0; i < 200 && !(mainUrl && browserUrl); i++) {
      mainUrl = stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];
      browserUrl = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
      await delay(100);
    }
    assert(mainUrl && browserUrl, "isolated Electron inspector endpoints missing");
    main = await connect(mainUrl);
    await main.send("Runtime.enable");
    for (const context of main.contexts.values()) {
      const candidate = await main.send("Runtime.evaluate", { expression: "typeof process==='object' && !!process.versions.electron && !!process.mainModule", contextId: context.id, returnByValue: true });
      if (candidate.result?.value === true) { main.selectContext(context.id); break; }
    }
    await main.evaluate("globalThis.fetch=async()=>{throw new Error('isolated_smoke_network_blocked')};true");
    const origin = new URL(browserUrl).origin.replace("ws:", "http:");
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      page = (await (await fetch(`${origin}/json/list`)).json()).find(item => item.type === "page");
      if (!page) await delay(100);
    }
    assert(page, "isolated Electron Renderer missing");
    renderer = await connect(page.webSocketDebuggerUrl);
    await renderer.send("Page.enable");
    await main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().forEach(w=>w.show());true");
    for (let i = 0; i < 100; i++) {
      if (await renderer.evaluate("document.readyState === 'complete' && !!window.performanceDiagnosticsAPI")) break;
      await delay(100);
    }
    assert.equal((await renderer.evaluate("performanceDiagnosticsAPI.getState()")).enabled, enabled);
    await delay(1500);
    const version = await renderer.evaluate("(async()=>({app:await window.electronAPI.getAppVersion(),title:document.title,footer:document.querySelector('.app-version')?.textContent,tooltip:document.querySelector('.app-version')?.title}))()");
    assert.deepEqual(version, { app: "9.0.0", title: "VOTC V9.0", footer: "V9.0 · Mod v2.0.5", tooltip: "VOTC App 9.0.0" });
    console.log(`Packaged version: ${JSON.stringify(version)}`);
    if (!enabled) {
      const screenshot = await renderer.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(profile, "version-window.png"), Buffer.from(screenshot.data, "base64"));
    }
    const buttonCount = await renderer.evaluate("[...document.querySelectorAll('button')].filter(b=>b.textContent==='导出性能诊断').length");
    assert.equal(buttonCount, enabled ? 1 : 0);
    let disabledReport = await renderer.evaluate("performanceDiagnosticsAPI.snapshot()");
    if (!enabled) {
      assert.deepEqual(disabledReport.events, []);
      assert.equal((await renderer.evaluate("performanceDiagnosticsAPI.exportReport()")).reason, "DIAGNOSTICS_DISABLED");
    } else {
      for (let i = 0; i < 100 && !disabledReport.events.some(event => event.step === "renderer.firstReady"); i++) {
        await delay(100);
        disabledReport = await renderer.evaluate("performanceDiagnosticsAPI.snapshot()");
      }
      assert(disabledReport.events.some(event => event.step === "renderer.firstReady"));
      assert.equal(await renderer.evaluate("performanceDiagnosticsAPI.recordRendererMetrics({step:'renderer.longTask',wallMs:1,path:'PRIVATE_SENTINEL'})"), false);
      // Exercise a real Renderer long task; this is synthetic, not CK3 performance evidence.
      await renderer.evaluate("(()=>{const start=performance.now();while(performance.now()-start<100){};document.dispatchEvent(new Event('pointerdown'));return true})()");
      await delay(1500);
      await main.evaluate("process.mainModule.require('electron').dialog.showSaveDialog=async()=>({canceled:true});true");
      assert.equal((await renderer.evaluate("performanceDiagnosticsAPI.exportReport()")).reason, "CANCELLED");
      const reportPath = path.join(profile, "diagnostics.json");
      await main.evaluate(`process.mainModule.require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(reportPath)}});true`);
      await renderer.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='导出性能诊断').click();true");
      for (let i = 0; i < 100 && !fs.existsSync(reportPath); i++) await delay(100);
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      assert.equal(report.enabled, true);
      assert(report.events.some(event => event.step === "renderer.longTask"));
      assert(report.events.some(event => event.step === "renderer.inputToFrame"));
      assert(report.events.length <= 2048);
      assert(!JSON.stringify(report).includes("PRIVATE_SENTINEL"));
      assert(report.aggregates.every(row => row.sampledWindow === true));
      await delay(200);
      const screenshot = await renderer.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(profile, "diagnostics-window.png"), Buffer.from(screenshot.data, "base64"));
      fs.writeFileSync(path.join(profile, "smoke-evidence.json"), JSON.stringify({ enabled, version, exported: true, syntheticLongTask: true, eventCount: report.events.length, steps: [...new Set(report.events.map(event => event.step))] }, null, 2));
    }
    console.log(`Packaged diagnostics ${enabled ? "enabled" : "disabled"}: PASS`);
  } finally {
    if (renderer) renderer.socket.close();
    if (main) {
      try { await main.evaluate("process.mainModule.require('electron').app.quit();true"); } catch (_error) {}
      main.socket.close();
    }
    const stopped = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
    if (!stopped) { child.kill(); await exited; }
  }
}

(async () => {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v9-performance-smoke-"));
  console.log(`Disposable smoke evidence: ${evidenceRoot}`);
  await launch(false, evidenceRoot);
  await launch(true, evidenceRoot);
})().catch(error => { console.error(error); process.exitCode = 1; });
