"use strict";

// Optional packaged-app smoke for rich DATE ingestion and same-path tail restart.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(url, diagnostics) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") diagnostics.runtimeExceptions++;
    if (message.method === "Network.requestWillBeSent") diagnostics.rendererNetworkRequests++;
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
  const evaluate = async (expression, awaitPromise = true) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`CDP evaluation failed: ${result.exceptionDetails.text || "exception"}`);
    return result.result.value;
  };
  return { send, evaluate, socket };
}

function summarize(status) {
  const tracker = status?.dateTracker || {};
  return {
    currentTotalDays: status?.currentTotalDays ?? null,
    tailState: tracker.tailState || null,
    debugLogPath: tracker.debugLogPath || null,
    lastDateMarkerSource: tracker.lastDateMarkerSource || null,
    lastObservedDateValue: tracker.lastObservedDateValue ?? null,
    lastProgressDateValue: tracker.lastProgressDateValue ?? null,
    dateSourceState: tracker.dateSourceState || null,
    dateProducerState: tracker.dateProducerState || null,
    tailStartedAt: tracker.tailStartedAt || null
  };
}

function classifyBlockedOrigins(origins) {
  if (!origins?.length) return "none";
  const loopbackOnly = origins.every(origin => {
    try {
      return ["localhost", "127.0.0.1", "::1"].includes(new URL(origin).hostname);
    } catch (_error) {
      return false;
    }
  });
  return loopbackOnly ? "local_loopback_probe" : "blocked_non_loopback_fetch";
}

async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8152-letter-clock-"));
  const syntheticCk3Folder = path.join(profile, "synthetic-ck3-user");
  const debugLogPath = path.join(syntheticCk3Folder, "logs", "debug.log");
  const reportPath = path.join(profile, "letter-clock-smoke-result.json");
  const screenshotPath = path.join(profile, "letter-clock-after-restart.png");
  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.writeFileSync(debugLogPath, "", "utf8");

  const diagnostics = { runtimeExceptions: 0, rendererNetworkRequests: 0 };
  const report = {
    startedAt: new Date().toISOString(),
    profile,
    syntheticCk3Folder,
    debugLogPath,
    reportPath,
    screenshotPath,
    childPid: null,
    cleanup: { appQuitRequested: false, normalExit: false, terminationRequested: false, taskkillExitCode: null, fallbackKillUsed: false },
    providerRequestsIssuedBySmoke: 0,
    progress: "spawned",
    cdpInitializationRetries: 0,
    networkIsolation: { rendererBlockedByCdp: false, mainFetchBlocked: false, blockedMainFetchCount: null, blockedMainFetchOrigins: [], blockedMainFetchClassification: "none" },
    phases: [],
    nativeBridgeGamePassed: false,
    note: "Real packaged renderer/preload/IPC/tail reader; only synthetic log markers. No Provider call, CK3 execution, carrier write, or real user data."
  };
  const child = spawn(path.resolve(__dirname, "../VOTC.exe"), [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--inspect=127.0.0.1:0"], {
    windowsHide: true,
    env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let main = null;
  let renderer = null;
  let stdoutTail = "";
  let stderrTail = "";
  let appExit = null;
  report.childPid = child.pid || null;
  child.stdout.on("data", chunk => { stdoutTail = (stdoutTail + String(chunk)).slice(-4000); });
  child.stderr.on("data", chunk => { stderrTail = (stderrTail + String(chunk)).slice(-4000); });
  child.on("exit", (code, signal) => { appExit = { code, signal }; });

  try {
    const endpoints = await new Promise((resolve, reject) => {
      const found = {};
      const timer = setTimeout(() => reject(new Error(`isolated VOTC debug endpoints timeout; exit=${JSON.stringify(appExit)}`)), 30000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", (code, signal) => {
        if (!found.browser || !found.main) {
          clearTimeout(timer);
          reject(new Error(`isolated VOTC exited before debug endpoints; code=${code}; signal=${signal}`));
        }
      });
      const inspectEndpoints = chunk => {
        const text = String(chunk);
        const browser = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        const inspector = text.match(/Debugger listening on (ws:\/\/[^\s]+)/);
        if (browser) found.browser = browser[1];
        if (inspector) found.main = inspector[1];
        if (found.browser && found.main) { clearTimeout(timer); resolve(found); }
      };
      child.stderr.on("data", inspectEndpoints);
      child.stdout.on("data", inspectEndpoints);
    });

    main = await connect(endpoints.main, diagnostics);
    await main.send("Runtime.enable");
    report.progress = "main_inspector_ready";
    const mainNetworkBlockExpression = `(()=>{
      globalThis.__letterClockBlockedOrigins=[];
      globalThis.fetch=async input=>{
        let origin='unknown';
        try { origin=new URL(String(input?.url||input)).origin; } catch (_error) {}
        globalThis.__letterClockBlockedOrigins.push(origin);
        throw new Error('isolated_letter_clock_network_blocked');
      };
      return 'blocked';
    })()`;
    let mainNetworkBlock;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        mainNetworkBlock = await main.evaluate(mainNetworkBlockExpression, false);
        break;
      } catch (error) {
        if (!String(error?.message || error).includes("Promise was collected") || attempt === 2) throw error;
        report.cdpInitializationRetries++;
        await delay(100);
      }
    }
    assert.equal(mainNetworkBlock, "blocked");
    report.networkIsolation.mainFetchBlocked = true;
    report.progress = "main_network_blocked";

    const browserOrigin = new URL(endpoints.browser).origin.replace("ws:", "http:");
    let target = null;
    let rendererTargets = [];
    for (let attempt = 0; attempt < 100 && !target; attempt++) {
      rendererTargets = (await (await fetch(`${browserOrigin}/json/list`)).json()).filter(item => item.type === "page");
      target = rendererTargets.find(item => item.url.startsWith("file:")) || rendererTargets[0] || null;
      if (!target) await delay(100);
    }
    assert(target, "isolated renderer target missing");
    report.rendererTarget = { title: target.title, url: target.url };
    report.progress = "renderer_target_selected";
    renderer = await connect(target.webSocketDebuggerUrl, diagnostics);
    report.progress = "renderer_debugger_connected";
    await renderer.send("Runtime.enable");
    await renderer.send("Page.enable");
    await renderer.send("Page.bringToFront");
    await renderer.send("Network.enable");
    await renderer.send("Network.setBlockedURLs", { urls: ["http://*/*", "https://*/*"] });
    report.networkIsolation.rendererBlockedByCdp = true;
    report.progress = "renderer_network_blocked";

    const evaluate = renderer.evaluate;
    const waitFor = async (predicate, label, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await delay(100);
      }
      throw new Error(`Timed out waiting for ${label}`);
    };
    const readStatuses = () => evaluate("lettersAPI.getStatuses()");
    const waitForDate = expected => waitFor(async () => {
      const status = await readStatuses();
      return status?.dateTracker?.lastObservedDateValue === expected && status.dateTracker.lastDateMarkerSource === "tail" ? status : null;
    }, `fresh DATE ${expected}`);
    const setCk3Folder = async phase => {
      const result = await evaluate(`llmConfigAPI.setCK3Folder(${JSON.stringify(syntheticCk3Folder)})`);
      assert.equal(result?.success, true, `${phase} same folder IPC: ${JSON.stringify(result)}`);
      const status = await waitFor(async () => {
        const current = await readStatuses();
        return current?.dateTracker?.tailState === "ACTIVE" && current.dateTracker.debugLogPath === debugLogPath ? current : null;
      }, `${phase} tail ACTIVE`);
      return status;
    };
    const appendDate = (totalDays, dateText, session = false) => {
      const lines = [];
      if (session) lines.push("VOTC:LOAD_SESSION/;/votc-load-letter-clock-smoke-0001");
      lines.push(`VOTC:DATE/;/${totalDays}/;/${dateText}`);
      fs.appendFileSync(debugLogPath, `${lines.join("\n")}\n`, "utf8");
    };

    await waitFor(async () => evaluate("typeof llmConfigAPI?.setCK3Folder === 'function' && typeof lettersAPI?.getStatuses === 'function'"), "preload APIs");
    await waitFor(async () => evaluate("!!document.body?.innerText?.trim()"), "renderer UI content");
    report.progress = "renderer_preload_and_ui_ready";
    await setCk3Folder("initial");

    appendDate(420001, "1170.1.1", true);
    const first = await waitForDate(420001);
    assert.equal(first.dateTracker.tailState, "ACTIVE");
    assert.equal(first.currentTotalDays, 420001);
    report.phases.push({ name: "first_fresh_rich_DATE", status: summarize(first) });

    appendDate(420002, "1170.1.2");
    const advancing = await waitForDate(420002);
    assert.equal(advancing.currentTotalDays, 420002);
    report.phases.push({ name: "advancing_rich_DATE", status: summarize(advancing) });

    await delay(20);
    const beforeRestart = summarize(await readStatuses());
    const restarted = await setCk3Folder("same-path-restart");
    assert(restarted.dateTracker.tailStartedAt > beforeRestart.tailStartedAt, "same-path setCK3Folder must replace the live tail instance");
    assert.equal(restarted.dateTracker.lastObservedDateValue, 420002, "restart must not replay or regress the prior date");
    report.phases.push({ name: "same_path_renderer_IPC_restart", status: summarize(restarted) });

    appendDate(420003, "1170.1.3");
    const afterRestart = await waitForDate(420003);
    assert.equal(afterRestart.currentTotalDays, 420003);
    assert.equal(afterRestart.dateTracker.debugLogPath, debugLogPath);
    report.phases.push({ name: "fresh_DATE_after_restart", status: summarize(afterRestart) });

    const rendererDom = await renderer.evaluate(`({
      readyState:document.readyState,
      bodyTextLength:document.body?.innerText?.length||0,
      bodyTextStart:document.body?.innerText?.slice(0,160)||"",
      controls:[...document.querySelectorAll('button,[role="button"],[role="tab"],a')]
        .map(item=>item.textContent.trim().replace(/\\s+/g,' ')).filter(Boolean).slice(0,40)
    })`);
    const uiControls = rendererDom.controls;
    report.rendererDom = rendererDom;
    report.rendererUiControls = uiControls;
    const openedSettings = await renderer.evaluate(`(()=>{
      const target=[...document.querySelectorAll('body *')].find(item=>item.children.length===0&&/^(settings|设置)$/i.test(item.textContent.trim()));
      if(!target)return false;
      target.click();
      return true;
    })()`);
    assert.equal(openedSettings, true, `renderer Settings tab must be available; controls=${JSON.stringify(uiControls)}`);
    await waitFor(() => renderer.evaluate("document.querySelector('.letters-status-modal')||[...document.querySelectorAll('body *')].some(item=>item.children.length===0&&/view letters status|查看信件状态/i.test(item.textContent.trim()))"), "letters status button");
    const openedLettersStatus = await renderer.evaluate(`(()=>{
      const target=[...document.querySelectorAll('body *')].find(item=>item.children.length===0&&/view letters status|查看信件状态/i.test(item.textContent.trim()));
      if(document.querySelector('.letters-status-modal'))return true;
      if(!target)return false;
      target.click();
      return true;
    })()`);
    assert.equal(openedLettersStatus, true, "renderer letters status modal must open");
    const visibleUiStatus = await waitFor(async () => {
      const text = await renderer.evaluate("document.body.innerText");
      if (!text.includes("Tail Consumer: ACTIVE") || !text.includes("Last Date Marker: 420003")) return null;
      return { activeVisible: true, markerVisible: true, healthyVisible: text.includes("Overall: HEALTHY") };
    }, "letters status UI shows active tail and fresh DATE");
    assert.equal(visibleUiStatus.healthyVisible, true, "letters status UI should display healthy date source after fresh DATE");
    report.rendererLetterStatus = visibleUiStatus;
    const diagnosticControls = await renderer.evaluate(`(()=>{
      const buttons=[...document.querySelectorAll('.letters-status-modal button')];
      const a1=buttons.find(button=>button.textContent.includes('A1 letters.txt'));
      const a2=buttons.find(button=>button.textContent.includes('A2 votc.txt'));
      return {a1Disabled:a1?.disabled===true,a2Enabled:a2?.disabled===false,
        nativeSequenceVisible:document.body.innerText.includes('A2 → A3 → B → C → D')};
    })()`);
    assert.equal(diagnosticControls.a1Disabled, true, "retired A1 must be disabled in the packaged window");
    assert.equal(diagnosticControls.a2Enabled, true, "A2 must not wait for retired A1");
    assert.equal(diagnosticControls.nativeSequenceVisible, true);
    report.diagnosticControls = diagnosticControls;
    report.progress = "renderer_status_ui_verified";

    const screenshot = await renderer.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    report.networkIsolation.blockedMainFetchCount = await main.evaluate("globalThis.__letterClockBlockedOrigins.length");
    report.networkIsolation.blockedMainFetchOrigins = await main.evaluate("Array.from(new Set(globalThis.__letterClockBlockedOrigins))");
    report.networkIsolation.blockedMainFetchClassification = classifyBlockedOrigins(report.networkIsolation.blockedMainFetchOrigins);
    report.rendererNetworkRequests = diagnostics.rendererNetworkRequests;
    report.runtimeExceptionCount = diagnostics.runtimeExceptions;
    report.passed = true;
    report.progress = "passed";
  } catch (error) {
    report.passed = false;
    report.failure = error instanceof Error ? error.message : String(error);
    report.runtimeExceptionCount = diagnostics.runtimeExceptions;
    report.rendererNetworkRequests = diagnostics.rendererNetworkRequests;
    report.appExit = appExit;
    console.error(`Letter clock smoke failed: ${report.failure}`);
  } finally {
    try {
      if (renderer && !fs.existsSync(screenshotPath)) {
        const screenshot = await renderer.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
      }
    } catch (_error) {}
    if (main && child.exitCode === null) {
      try {
        report.networkIsolation.blockedMainFetchCount = await main.evaluate("globalThis.__letterClockBlockedOrigins.length");
        report.networkIsolation.blockedMainFetchOrigins = await main.evaluate("Array.from(new Set(globalThis.__letterClockBlockedOrigins))");
        report.networkIsolation.blockedMainFetchClassification = classifyBlockedOrigins(report.networkIsolation.blockedMainFetchOrigins);
      } catch (_error) {}
      try {
        report.cleanup.appQuitRequested = await main.evaluate(`(()=>{
          const app=process.mainModule?.require?.('electron')?.app;
          if(typeof app?.quit!=='function')return false;
          setTimeout(()=>app.quit(),50);
          return true;
        })()`);
      } catch (_error) {}
    }
    renderer?.socket.close();
    main?.socket.close();
    if (child.exitCode === null && report.cleanup.appQuitRequested) {
      report.cleanup.normalExit = await Promise.race([
        new Promise(resolve => child.once("exit", () => resolve(true))),
        delay(20000).then(() => false)
      ]);
    } else {
      report.cleanup.normalExit = child.exitCode !== null;
    }
    if (child.exitCode === null && !report.cleanup.normalExit && child.pid) {
      report.cleanup.terminationRequested = true;
      report.cleanup.taskkillExitCode = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).status;
      if (report.cleanup.taskkillExitCode !== 0) {
        report.cleanup.fallbackKillUsed = true;
        child.kill();
      }
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(5000)]);
      if (child.exitCode === null && !report.cleanup.fallbackKillUsed) {
        report.cleanup.fallbackKillUsed = true;
        child.kill();
        await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(5000)]);
      }
    }
    report.appExit = appExit;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({ passed: report.passed === true, profile, reportPath, screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null,
      phases: report.phases, providerRequestsIssuedBySmoke: 0, rendererNetworkBlocked: report.networkIsolation.rendererBlockedByCdp,
      mainFetchBlocked: report.networkIsolation.mainFetchBlocked, blockedMainFetchCount: report.networkIsolation.blockedMainFetchCount,
      blockedMainFetchOrigins: report.networkIsolation.blockedMainFetchOrigins,
      blockedMainFetchClassification: report.networkIsolation.blockedMainFetchClassification,
      rendererLetterStatus: report.rendererLetterStatus,
      cleanup: report.cleanup, appExit }));
    console.log(`Isolated letter-clock profile retained: ${profile}`);
  }
  if (!report.passed) process.exitCode = 1;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
