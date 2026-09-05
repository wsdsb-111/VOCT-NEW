"use strict";

// Packaged Electron + actual preload/IPC, isolated profile, read-only real save.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

async function main() {
  const save = process.argv[2];
  assert(save && fs.existsSync(save));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "votc-astra-electron-"));
  const child = spawn(path.resolve(__dirname, "../VOTC.exe"), [`--user-data-dir=${profile}`, "--remote-debugging-port=0"], { windowsHide: true, env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile }, stdio: ["ignore", "pipe", "pipe"] });
  let ws;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("debug endpoint timeout")), 30000);
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.stderr.on("data", chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      child.stdout.resume();
    });
    const origin = new URL(endpoint).origin.replace("ws:", "http:");
    let target;
    for (let i = 0; i < 80 && !target; i++) {
      target = (await (await fetch(`${origin}/json/list`)).json()).find(item => item.type === "page");
      if (!target) await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(target, "renderer target required");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 0;
    const requests = new Map();
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!requests.has(message.id)) return;
      const { resolve, reject, timer } = requests.get(message.id);
      requests.delete(message.id); clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { requests.delete(id); reject(new Error(`timeout: ${method}`)); }, 120000);
      requests.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      ready = await evaluate("!!window.worldlineAPI && !!document.body");
      if (!ready) await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(ready);
    console.log(JSON.stringify({ phase: "launched", profile, target: target.url }));
    const state = await evaluate(`(async () => { await worldlineAPI.setAutosavePath(${JSON.stringify(save)}); await worldlineAPI.validateAutosavePath(${JSON.stringify(save)}); await worldlineAPI.rebuildCheckpoint(); return worldlineAPI.getCheckpointStatus(); })()`);
    assert.equal(state.checkpoint.status, "ACTIVE");
    const body = await evaluate("document.body.innerText");
    console.log(JSON.stringify({ phase: "uiSnapshot", text: body.slice(0, 1200) }));
    const clicked = await evaluate("(() => { const e = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === '世界线'); if (e) e.click(); return !!e; })()");
    await new Promise(resolve => setTimeout(resolve, 500));
    const result = await evaluate(`(async () => {
      const entry = (await worldlineAPI.createSupplemental({ title: 'Astra lantern audit', body: 'lantern public festival', entities: ['lantern'], visibility: 'PUBLIC_WORLD' })).supplemental;
      const before = (await worldlineAPI.getPromptDiagnostics({ query: 'lantern' })).promptDiagnostics;
      await worldlineAPI.updateSupplemental(entry.id, { ...entry, hidden: true });
      const after = (await worldlineAPI.getPromptDiagnostics({ query: 'lantern' })).promptDiagnostics;
      await worldlineAPI.deleteSupplemental(entry.id);
      return { recalled: before.supplemental.some(e => e.id === entry.id), hidden: !after.supplemental.some(e => e.id === entry.id), deleted: !(await worldlineAPI.listSupplemental()).supplemental.some(e => e.id === entry.id) };
    })()`);
    assert(result.recalled && result.hidden && result.deleted);
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    const output = path.resolve(__dirname, "../output/playwright");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "v8.5.2-astra-electron.png"), Buffer.from(screenshot.data, "base64"));
    console.log(JSON.stringify({ status: "IPC_PASS", visualAcceptance: "MANUAL_REQUIRED", packagedElectron: true, gameDate: state.checkpoint.gameDate, worldlineClicked: clicked, supplemental: result, profile }));
  } finally { if (ws) ws.close(); if (child.exitCode === null) child.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
