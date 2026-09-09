"use strict";

// Optional packaged-app smoke with an isolated profile, no provider requests.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v88-startup-"));
  const child = spawn(path.resolve(__dirname, "../VOTC.exe"), [`--user-data-dir=${profile}`, "--remote-debugging-port=0"], {
    windowsHide: true, env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile }, stdio: ["ignore", "pipe", "pipe"]
  });
  let ws;
  const errors = [];
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
    await send("Runtime.enable");
    await evaluate("localStorage.setItem('votc-developer-mode','true')");
    await send("Page.reload", { ignoreCache: true });
    await new Promise(resolve => setTimeout(resolve, 2500));
    console.log("STARTUP", await evaluate("JSON.stringify({length:document.body.innerText.length,text:document.body.innerText.slice(0,400)})"));
    assert(await evaluate("document.body.innerText.length > 30"), "startup rendered an empty body");
    if (process.argv[2]) {
      const save = path.resolve(process.argv[2]);
      assert(fs.existsSync(save), "save missing");
      console.log("Loading read-only save into isolated profile");
      const loaded = await evaluate(`(async () => { await worldlineAPI.setAutosavePath(${JSON.stringify(save)}); await worldlineAPI.validateAutosavePath(); await worldlineAPI.rebuildCheckpoint(); return worldlineAPI.getCheckpointStatus(); })()`);
      console.log("CHECKPOINT", JSON.stringify(loaded));
      assert.equal(loaded.checkpoint.status, "ACTIVE");
    }
    console.log("BUTTONS", await evaluate("[...document.querySelectorAll('button')].map(e=>e.textContent.trim()).slice(0,30)"));
    const clicked = await evaluate("(() => { const e=[...document.querySelectorAll('button')].find(e=>['世界线','Worldline'].includes(e.textContent.trim())); if(e)e.click();return !!e; })()");
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
    }
    assert.deepEqual(errors, [], "renderer exceptions");
    console.log("V8.8 isolated Electron startup/navigation: PASS");
  } finally {
    console.log("RENDERER_ERRORS", JSON.stringify(errors));
    ws?.close();
    child.kill();
    console.log("Isolated test profile retained:", profile);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
