"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(url, errors) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map(), events = new Map(), waits = new Map(), scriptUrls = [];
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Debugger.scriptParsed") scriptUrls.push(message.params.url);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method) {
      const wait = waits.get(message.method);
      if (wait) { waits.delete(message.method); clearTimeout(wait.timer); wait.resolve(message.params); }
      else events.set(message.method, message.params);
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`)); else request.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 25000);
    pending.set(id, { resolve, reject, timer, method }); socket.send(JSON.stringify({ id, method, params }));
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
  return { send, evaluate, wait, socket, scriptUrls };
}

async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "votc-world-memory-current-date-"));
  const evidenceDir = path.join(profile, "ui-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const errors = [];
  const child = spawn(path.resolve(__dirname, "../VOTC.exe"), [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--inspect=127.0.0.1:0"], {
    windowsHide: true,
    env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let main, renderer, stderrTail = "";
  child.stderr.on("data", chunk => { stderrTail = (stderrTail + String(chunk)).slice(-8000); });
  try {
    const endpoints = await new Promise((resolve, reject) => {
      const found = {};
      const timer = setTimeout(() => reject(new Error("isolated app debug endpoints timeout")), 20000);
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.stderr.on("data", chunk => {
        const text = String(chunk);
        const browser = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        const inspector = text.match(/Debugger listening on (ws:\/\/[^\s]+)/);
        if (browser) found.browser = browser[1];
        if (inspector) found.main = inspector[1];
        if (found.browser && found.main) { clearTimeout(timer); resolve(found); }
      });
    });
    main = await connect(endpoints.main, errors);
    await main.send("Runtime.enable");
    await main.send("Debugger.enable");
    await main.evaluate("globalThis.__worldMemoryBlockedFetches=[];globalThis.fetch=async input=>{const url=String(input?.url||input);globalThis.__worldMemoryBlockedFetches.push(url);throw new Error('isolated_ui_network_blocked')};'network-blocker-installed'");
    await delay(300);
    console.log(`Worldline service script: ${main.scriptUrls.find(url => url.endsWith("/worldline-service.js")) || "not parsed"}`);

    const origin = new URL(endpoints.browser).origin.replace("ws:", "http:");
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      target = (await (await fetch(`${origin}/json/list`)).json()).find(item => item.type === "page");
      if (!target) await delay(100);
    }
    assert(target, "isolated renderer target missing");
    renderer = await connect(target.webSocketDebuggerUrl, errors);
    await renderer.send("Runtime.enable");
    await renderer.send("Page.enable");
    const evaluate = renderer.evaluate;
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(`!!(${expression})`)) return; await delay(100); }
      throw new Error(`UI condition timeout: ${expression}`);
    };
    const waitMainFor = async expression => {
      for (let i = 0; i < 100; i++) { if (await main.evaluate(`!!(${expression})`)) return; await delay(25); }
      throw new Error(`Main-process condition timeout: ${expression}`);
    };
    const captureEvidence = async (filename, scrollSelector, recordTitle = null) => {
      await evaluate(`document.querySelector(${JSON.stringify(scrollSelector)})?.scrollIntoView({block:'start'})`);
      await delay(180);
      const layout = await evaluate(`(()=>{const root=document.querySelector('.worldline-editor-v87'),actions=document.querySelector('.world-memory-form-actions'),alert=root?.querySelector('[role=alert]'),record=${recordTitle ? `([...document.querySelectorAll('.world-memory-record')].find(item=>item.textContent.includes(${JSON.stringify(recordTitle)})))` : "null"},empty=root?.querySelector('.worldline-empty');const box=element=>{if(!element)return null;const r=element.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),visible:r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight}};return{viewport:{width:innerWidth,height:innerHeight},editor:{width:root?.clientWidth||0,scrollWidth:root?.scrollWidth||0,horizontalOverflow:!!root&&root.scrollWidth>root.clientWidth+2},pageHorizontalOverflow:document.documentElement.scrollWidth>innerWidth+2,actions:box(actions),alert:box(alert),record:box(record),emptyText:empty?.textContent.trim()||null}})()`);
      const screenshot = await renderer.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const file = path.join(evidenceDir, filename);
      fs.writeFileSync(file, Buffer.from(screenshot.data, "base64"));
      return { file, layout };
    };
    await waitFor("typeof window.worldlineAPI?.listCanon === 'function'");
    await waitFor("[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='世界书')");

    const serviceSource = fs.readFileSync(path.resolve(__dirname, "../resources/app/out/main/worldline/worldline-service.js"), "utf8").split(/\r?\n/);
    const lineNumber = serviceSource.findIndex(line => line.includes("return { ...await this.canon.list(options)"));
    assert(lineNumber >= 0, "WorldlineService.listCanon executable breakpoint not found");
    const serviceUrl = main.scriptUrls.find(url => url.endsWith("/worldline-service.js"));
    assert(serviceUrl, "WorldlineService script URL not found");
    const breakpoint = await main.send("Debugger.setBreakpointByUrl", { url: serviceUrl, lineNumber });
    console.log(`Worldline breakpoint: ${JSON.stringify(breakpoint)}`);
    const seedRequest = evaluate("window.worldlineAPI.listCanon({})");
    const paused = await main.wait("Debugger.paused");
    const frame = paused.callFrames.find(item => item.url.endsWith("worldline-service.js")) || paused.callFrames[0];
    const synthetic = {
      checkpoint: {
        id: "isolated-current-date-checkpoint",
        source: { path: path.join(profile, "synthetic-autosave.ck3"), fingerprint: crypto.createHash("sha256").update("synthetic autosave only").digest("hex") },
        snapshot: { playthroughId: "isolated-current-date-playthrough", gameDate: "1082.1.1", totalDays: 100, loadSessionId: "synthetic-session-1082", characters: {} }
      },
      live: { connected: true, gameDate: "1082.1.1", totalDays: 100, loadSessionId: "synthetic-session-1082", characters: [] }
    };
    const injected = await main.send("Debugger.evaluateOnCallFrame", {
      callFrameId: frame.callFrameId,
      expression: `globalThis.__worldMemorySynthetic=${JSON.stringify(synthetic)};this.currentCheckpoint=globalThis.__worldMemorySynthetic.checkpoint;this.getLiveState=()=>globalThis.__worldMemorySynthetic.live;globalThis.__worldMemoryService=this;'synthetic checkpoint injected'`,
      returnByValue: true
    });
    assert(!injected.exceptionDetails, JSON.stringify(injected.exceptionDetails));
    await main.send("Debugger.removeBreakpoint", { breakpointId: breakpoint.breakpointId });
    await main.send("Debugger.resume");
    const seededPage = await seedRequest;
    assert.equal(seededPage.defaultGameDate, "1082.1.1");

    const navClicked = await evaluate("(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='世界书');button?.click();return !!button})()");
    assert.equal(navClicked, true, "Worldline navigation button missing");
    await waitFor("document.querySelector('.worldline-editor-v87')");
    await evaluate("document.querySelector('.worldline-editor-v87 .world-memory-refresh')?.click()");
    await waitFor("document.querySelector('.world-memory-date-note')?.textContent.includes('1082年1月1日')");
    assert.equal(await evaluate("document.querySelector('.world-memory-check input[type=checkbox]')?.checked"), false,
      "the ordinary plot fact must not enable current-claim verification");
    assert.equal(await evaluate("[...document.querySelectorAll('.world-memory-form select')].some(select=>select.value==='CURRENT_DATE')"), true,
      "the form must start in CURRENT_DATE mode");

    const wrapped = await main.evaluate(`(()=>{const service=globalThis.__worldMemoryService;globalThis.__worldMemoryOriginalMutate=service.mutateCanon.bind(service);globalThis.__worldMemoryMutationCount=0;service.mutateCanon=async payload=>{globalThis.__worldMemoryMutationCount++;const spoofed={...payload,payload:{...payload.payload,gameDate:'1199.1.1',totalDays:999}};const result=await globalThis.__worldMemoryOriginalMutate(spoofed);globalThis.__worldMemorySavedRecord=result;globalThis.__worldMemoryMutationNotified=true;service._notifyStateChanged('checkpoint_active');await new Promise(resolve=>setTimeout(resolve,350));return result};return true})()`);
    assert.equal(wrapped, true);
    const fillForm = (title, content) => evaluate(`(()=>{const fields=[...document.querySelectorAll('.world-memory-form .world-memory-field')];const title=fields.find(field=>field.querySelector('span')?.textContent==='标题')?.querySelector('input');const content=fields.find(field=>field.querySelector('span')?.textContent==='希望世界长期记住的内容')?.querySelector('textarea');if(!title||!content)return false;const set=(element,value)=>{const prototype=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))};set(title,${JSON.stringify(title)});set(content,${JSON.stringify(content)});return true})()`);
    assert.equal(await fillForm("隔离当前日期保存复现", "两位人物在宫廷宴会上订下共同出征的约定。"), true,
      "current-date form fields should be available");
    await evaluate("[...document.querySelectorAll('.world-memory-form-actions button')].find(button=>button.textContent.trim()==='确认新增'&&!button.disabled)?.click()");
    await waitMainFor("globalThis.__worldMemoryMutationNotified === true");
    await waitFor("document.querySelector('.world-memory-feedback[role=status]')?.textContent.includes('正在处理')");
    assert.equal(await evaluate("[...document.querySelectorAll('.world-memory-form-actions button')].find(button=>button.textContent.trim()==='确认新增')?.disabled"), true,
      "the form must remain busy while the queued checkpoint refresh is pending");
    await waitFor("[...document.querySelectorAll('.world-memory-record')].some(item=>item.textContent.includes('隔离当前日期保存复现'))");
    const persisted = await evaluate("worldlineAPI.listCanon({})");
    assert.equal(persisted.defaultGameDate, "1082.1.1");
    const record = persisted.records.find(item => item.title === "隔离当前日期保存复现");
    const uiRecordVisible = await evaluate("[...document.querySelectorAll('.world-memory-record')].some(item=>item.textContent.includes('隔离当前日期保存复现'))");
    const uiError = await evaluate("document.querySelector('[role=alert]')?.textContent||''");
    assert(record, "the real Canon worker should persist the current-date record");
    assert.equal(record.gameDate, "1082.1.1", "CURRENT_DATE must use the synthetic server date");
    assert.equal(record.totalDays, 100, "CURRENT_DATE must ignore renderer-supplied totalDays");
    assert.equal(await main.evaluate("globalThis.__worldMemoryMutationCount"), 1, "checkpoint refresh must not retry the save");
    const savedScreenshot = await captureEvidence("current_date_saved.png", ".world-memory-form-actions", "隔离当前日期保存复现");
    assert.equal(savedScreenshot.layout.actions?.visible, true, "save action controls must appear in the evidence view");
    assert.equal(savedScreenshot.layout.record?.visible, true, "the persisted current-date row must appear in the evidence view");
    assert.equal(savedScreenshot.layout.editor.horizontalOverflow, false, "the world-memory editor must not overflow horizontally");
    assert.equal(savedScreenshot.layout.pageHorizontalOverflow, false, "the renderer page must not overflow horizontally");
    assert(uiRecordVisible, "the editor must show the saved row after checkpoint update");
    assert.equal(uiError, "", "a successful background refresh must not show a stale error");

    const nextSynthetic = {
      checkpoint: {
        id: "isolated-next-campaign-checkpoint",
        source: { path: path.join(profile, "synthetic-next-autosave.ck3"), fingerprint: crypto.createHash("sha256").update("synthetic second campaign only").digest("hex") },
        snapshot: { playthroughId: "isolated-next-playthrough", gameDate: "1082.1.1", totalDays: 100, loadSessionId: "synthetic-session-next", characters: {} }
      },
      live: { connected: true, gameDate: "1082.1.1", totalDays: 100, loadSessionId: "synthetic-session-next", characters: [] }
    };
    await main.evaluate(`globalThis.__worldMemoryNextSynthetic=${JSON.stringify(nextSynthetic)};globalThis.__worldMemoryCrossBranchNotified=false;globalThis.__worldMemoryService.mutateCanon=async payload=>{const service=globalThis.__worldMemoryService;globalThis.__worldMemoryMutationCount++;service.currentCheckpoint=globalThis.__worldMemoryNextSynthetic.checkpoint;globalThis.__worldMemorySynthetic=globalThis.__worldMemoryNextSynthetic;globalThis.__worldMemoryCrossBranchNotified=true;service._notifyStateChanged('checkpoint_building');service._notifyStateChanged('source_changed');await new Promise(resolve=>setTimeout(resolve,200));return globalThis.__worldMemoryOriginalMutate(payload)};`);
    assert.equal(await fillForm("旧分支草稿不得写入新战役", "两位人物在宫廷宴会上订下共同守城的约定。"), true);
    await evaluate("[...document.querySelectorAll('.world-memory-form-actions button')].find(button=>button.textContent.trim()==='确认新增'&&!button.disabled)?.click()");
    await waitMainFor("globalThis.__worldMemoryCrossBranchNotified === true");
    await waitFor("document.querySelector('[role=alert]')?.textContent.includes('branch_write_blocked_reload_editor')");
    await waitFor("document.querySelector('.world-memory-list-heading')?.textContent.includes('0 / 0')");
    const nextPage = await evaluate("worldlineAPI.listCanon({})");
    assert.notEqual(nextPage.branch.branchId, persisted.branch.branchId, "the source change must bind the UI to a separate branch");
    assert.equal(await main.evaluate("globalThis.__worldMemoryMutationCount"), 2, "a rejected stale token must not trigger a retry");
    assert.equal(nextPage.total, 0, "the old branch draft must not be written to the new campaign");
    assert.equal(await evaluate("[...document.querySelectorAll('.world-memory-record')].some(item=>item.textContent.includes('旧分支草稿不得写入新战役'))"), false);
    const rejectedScreenshot = await captureEvidence("cross_branch_rejected.png", ".worldline-editor-v87 [role=alert]");
    const emptyBranchScreenshot = await captureEvidence("cross_branch_empty_branch.png", ".world-memory-form-actions");
    assert.equal(rejectedScreenshot.layout.alert?.visible, true, "the stale-token error must appear in the evidence view");
    assert.equal(emptyBranchScreenshot.layout.emptyText, "当前存档还没有长期记忆。", "the new branch must appear empty in the evidence view");
    assert.equal(emptyBranchScreenshot.layout.editor.horizontalOverflow, false, "the new-branch view must not overflow horizontally");
    assert.equal(emptyBranchScreenshot.layout.pageHorizontalOverflow, false, "the renderer page must not overflow horizontally");
    const result = {
      passed: true,
      profile,
      currentDateSave: { title: record.title, gameDate: record.gameDate, totalDays: record.totalDays, rendererSpoof: { gameDate: "1199.1.1", totalDays: 999 }, visible: uiRecordVisible, mutationCount: 1, screenshot: savedScreenshot },
      crossBranchReject: { error: "branch_write_blocked_reload_editor", visible: true, newBranchId: nextPage.branch.branchId, newBranchRecordCount: nextPage.total, mutationCount: 2, screenshots: [rejectedScreenshot, emptyBranchScreenshot] },
      rendererErrors: errors,
      realCK3Gate: false
    };
    console.log(JSON.stringify({ profile, persisted: !!record, persistedDate: record?.gameDate || null, uiRecordVisible, uiError,
      crossBranchError: await evaluate("document.querySelector('[role=alert]')?.textContent||''"), newBranchRecordCount: nextPage.total, rendererErrors: errors }, null, 2));
    assert.deepStrictEqual(errors, [], "renderer/main exceptions");
    fs.writeFileSync(path.join(evidenceDir, "result.json"), JSON.stringify(result, null, 2));
    console.log(`V8.15 isolated packaged current-date UI: PASS; evidence ${evidenceDir}`);
  } catch (error) {
    console.error("Isolated Electron diagnostics:", stderrTail);
    console.error(`Isolated UI profile retained: ${profile}`);
    throw error;
  } finally {
    renderer?.socket.close(); main?.socket.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(5000)]);
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
