"use strict";

// Optional real packaged UI smoke. The inspector fixture replaces only the
// manager's current-conversation callback in this disposable app process.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { createMemoryUiFixture } = require("./v8.14-memory-ui-fixture");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(url, errors) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map(), events = new Map(), waits = new Map();
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
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
    let result;
    try { result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); }
    catch (error) { throw new Error(`${error.message}; expression: ${expression.slice(0, 160)}`); }
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = method => {
    if (events.has(method)) { const value = events.get(method); events.delete(method); return Promise.resolve(value); }
    return new Promise((resolve, reject) => {
      waits.set(method, { resolve, timer: setTimeout(() => { waits.delete(method); reject(new Error(`CDP event timeout: ${method}`)); }, 20000) });
    });
  };
  return { send, evaluate, wait, socket };
}

async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "votc-e-packaged-ui-"));
  const fixture = await createMemoryUiFixture(profile);
  const evidence = path.join(profile, "ui-evidence");
  fs.mkdirSync(evidence);
  const screenshots = [];
  const errors = [];
  const child = spawn(path.resolve(__dirname, "../VOTC.exe"), [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--inspect=127.0.0.1:0"], {
    windowsHide: true, env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile }, stdio: ["ignore", "pipe", "pipe"]
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
      child.stdout.resume();
    });
    main = await connect(endpoints.main, errors);
    await main.send("Runtime.enable");
    await main.send("Debugger.enable");
    console.log("Isolated main inspector ready");
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
    console.log("Isolated renderer inspector ready");
    const evaluate = renderer.evaluate;
    const waitFor = async expression => {
      for (let i = 0; i < 80; i++) { if (await evaluate(`!!(${expression})`)) return; await delay(100); }
      throw new Error(`UI condition timeout: ${expression}`);
    };
    await waitFor("typeof conversationAPI?.getMemory4OwnerData === 'function'");
    const unavailable = await evaluate("conversationAPI.getMemory4OwnerData({ownerId:2})");
    assert.equal(unavailable.success, false, "absence of current Campaign must remain explicit");
    await main.evaluate(`globalThis.__m4SmokeConversation={id:'isolated-ui-conversation',isActive:true,gameData:{campaignToken:${JSON.stringify(fixture.scope.campaignToken)},date:'1164.1.1',playerID:1,characters:new Map(${JSON.stringify(fixture.characters)}.map(c=>[c.id,c]))},dynamicRecallHistory:new Map()};globalThis.__m4ProviderCalls=0;`);
    const source = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/summaries/summaries-manager.js"), "utf8").split(/\r?\n/);
    const start = source.findIndex(line => line.includes("static async getLegacyBulkBindingContext"));
    const lineNumber = source.findIndex((line, index) => index > start && line.includes("const conversation = getCurrentConversation();"));
    assert(lineNumber > start);
    const breakpoint = await main.send("Debugger.setBreakpointByUrl", { urlRegex: "summaries-manager\\.js$", lineNumber });
    const ownerRequest = evaluate("conversationAPI.getMemory4OwnerData({ownerId:2})");
    const paused = await main.wait("Debugger.paused");
    const injected = await main.send("Debugger.evaluateOnCallFrame", { callFrameId: paused.callFrames[0].callFrameId,
      expression: "getCurrentConversation=()=>globalThis.__m4SmokeConversation;globalThis.__m4SmokeConversation.memoryState=memoryEngine.createConversationState('isolated-ui-conversation');memoryEngine.memory4.configureDerived({isCampaignCurrent:token=>token===globalThis.__m4SmokeConversation.gameData.campaignToken,requestCompression:async()=>{globalThis.__m4ProviderCalls++;throw new Error('fixture_provider_forbidden');},requestExtraction:async()=>{globalThis.__m4ProviderCalls++;throw new Error('fixture_provider_forbidden');}});'fixture-injected'", returnByValue: true });
    assert(!injected.exceptionDetails, JSON.stringify(injected.exceptionDetails));
    await main.send("Debugger.removeBreakpoint", { breakpointId: breakpoint.breakpointId });
    await main.send("Debugger.resume");
    const data = await ownerRequest;
    assert.equal(data.success, true);
    assert.equal(data.detail.total, 2);
    console.log("Isolated real preload/IPC fixture ready");
    assert.equal((await evaluate("conversationAPI.getMemory4OwnerData({ownerId:2,expectedCampaignToken:'wrong-campaign'})")).success, false);
    await evaluate("localStorage.setItem('votc-developer-mode','true');localStorage.setItem('config-panel-state',JSON.stringify({position:{x:40,y:30},size:{width:1000,height:840}}))");
    await renderer.send("Page.reload", { ignoreCache: true });
    await waitFor("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Summaries')");
    await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Summaries').click()");
    await waitFor("document.querySelectorAll('.player-summary-group').length>=2");
    await evaluate("[...document.querySelectorAll('.player-header')].find(e=>e.querySelector('.player-name')?.textContent.startsWith('乙')).click()");
    await waitFor("document.querySelector('.memory4-manager .memory4-entity')");
    console.log("Memory4 owner view ready");
    const clickTab = async label => {
      assert(await evaluate(`(()=>{const e=[...document.querySelectorAll('.memory4-manager [role=tab]')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(e)e.click();return !!e})()`));
      await delay(120);
    };
    const clickButton = async label => {
      assert(await evaluate(`(()=>{const e=[...document.querySelectorAll('.memory4-manager button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled);if(e)e.click();return !!e})()`), `missing enabled button: ${label}`);
      await delay(120);
    };
    const setViewport = async (width, height) => {
      await renderer.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      const size = await evaluate("(()=>{const e=document.querySelector('.config-panel-container'),r=e.getBoundingClientRect();e.querySelector('.resize-se').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.right-2,clientY:r.bottom-2}));return{x:r.right-2,y:r.bottom-2,width:r.width,height:r.height};})()");
      await delay(40);
      await evaluate(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:${size.x + Math.min(1000, width - 60) - size.width},clientY:${size.y + height - 60 - size.height}}));document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))`);
      await delay(80);
    };
    const screenshot = async name => {
      await evaluate("document.querySelector('.memory4-manager').scrollIntoView({block:'start'})");
      const bounds = await evaluate("(()=>{const e=document.querySelector('.memory4-manager');const r=e.getBoundingClientRect();return{x:Math.max(0,r.x),y:Math.max(0,r.y),width:Math.min(r.width,innerWidth-Math.max(0,r.x)),height:Math.min(r.height,innerHeight-Math.max(0,r.y))}})()");
      assert(bounds.width > 200 && bounds.height > 80, "Memory UI must have a visible viewport");
      const result = await renderer.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(result.data, "base64"));
      screenshots.push(name);
      const collisions = await evaluate("(()=>{const modal=document.querySelector('.memory4-modal');const b=[...(modal||document.querySelector('.memory4-manager')).querySelectorAll('button')].map(e=>({e,r:e.getBoundingClientRect()})).filter(x=>x.r.width&&x.r.height&&x.r.y>=0&&x.r.bottom<=innerHeight);const bad=[];for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){if(b[i].e.contains(b[j].e)||b[j].e.contains(b[i].e))continue;const a=b[i].r,c=b[j].r;if(Math.min(a.right,c.right)-Math.max(a.left,c.left)>1&&Math.min(a.bottom,c.bottom)-Math.max(a.top,c.top)>1)bad.push([b[i].e.textContent,b[j].e.textContent]);}return bad})()");
      assert.deepStrictEqual(collisions, [], `overlapping buttons in ${name}`);
      assert(await evaluate("(()=>{const e=document.querySelector('.memory4-modal')||document.querySelector('.memory4-manager');return e.scrollWidth<=e.clientWidth+2})()"), `horizontal overflow in ${name}`);
    };
    for (const theme of ["parchment", "knight", "ink"]) {
      await evaluate(`document.documentElement.setAttribute('data-votc-theme',${JSON.stringify(theme)})`);
      await setViewport(1280, 1000);
      for (const [label, slug] of [["人物认知", "known"], ["官方追忆", "official"], ["人生记忆", "life"], ["年度记忆", "year"], ["详细长期记忆", "detail"], ["Legacy 对话摘要", "legacy"]]) {
        await clickTab(label);
        if (["人生记忆", "年度记忆", "详细长期记忆"].includes(label)) await evaluate("(()=>{const e=document.querySelector('.memory4-panel details');if(e&&!e.open)e.querySelector('summary').click();})()");
        if (label === "详细长期记忆") await waitFor("document.querySelector('.memory4-detail[open] .memory4-text')");
        if (label === "官方追忆") assert.equal(await evaluate("document.querySelector('.memory4-panel button')===null"), true, "Official view must be read-only");
        await screenshot(`${theme}-desktop-${slug}`);
      }
      await clickTab("人物认知");
      await setViewport(540, 900);
      await screenshot(`${theme}-narrow-known`);
    }
    await setViewport(1280, 1000);
    await clickTab("年度记忆");
    await evaluate("(()=>{const e=document.querySelector('.memory4-derived');if(!e.open)e.querySelector('summary').click();})()");
    const beforeKeep = (await evaluate("conversationAPI.getMemory4OwnerData({ownerId:2})")).derived.years[0];
    assert(beforeKeep.dirty && beforeKeep.generationMode === "manual_override");
    await screenshot("ink-desktop-manual-conflict");
    await setViewport(540, 900);
    await screenshot("ink-narrow-manual-conflict");
    await setViewport(1280, 1000);
    await clickButton("保留手工版本");
    await waitFor("document.querySelector('.memory4-manager').textContent.includes('已保留手工文本')");
    const kept = (await evaluate("conversationAPI.getMemory4OwnerData({ownerId:2})")).derived.years[0];
    assert.equal(kept.items[0].text, beforeKeep.items[0].text);
    assert.equal(kept.dirty, true, "keepManual must not mark stale sources fresh");
    const changedSource = await evaluate(`conversationAPI.getMemory4Sources({ownerId:2,expectedCampaignToken:${JSON.stringify(fixture.scope.campaignToken)},kind:'year',eventYear:${beforeKeep.eventYear}})`);
    assert.equal(changedSource.sources.changed, true);
    await evaluate("(()=>{const e=document.querySelector('.memory4-derived');if(!e.open)e.querySelector('summary').click();})()");
    await clickButton("查看来源");
    await waitFor("document.querySelector('.memory4-source')");
    await screenshot("ink-desktop-source-dialog");
    await setViewport(540, 900);
    await screenshot("ink-narrow-source-dialog");
    await setViewport(1280, 1000);
    await evaluate("document.querySelector('[aria-label=关闭来源]').click()");
    await clickButton("编辑");
    await screenshot("ink-desktop-edit-dialog");
    await setViewport(540, 900);
    await screenshot("ink-narrow-edit-dialog");
    await setViewport(1280, 1000);
    await evaluate("(()=>{const e=document.querySelector('.memory4-modal textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'用户确认仍按约定分两次送粮。');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await clickButton("保存");
    await waitFor("!document.querySelector('.memory4-modal textarea')");
    const edited = await evaluate("conversationAPI.getMemory4OwnerData({ownerId:2})");
    assert.equal(edited.derived.years[0].items[0].text, "用户确认仍按约定分两次送粮。");
    await clickTab("详细长期记忆");
    await evaluate("document.querySelector('.memory4-detail summary').click()");
    await waitFor("document.querySelector('.memory4-detail[open] .memory4-text')");
    const deletion = clickButton("删除");
    await renderer.wait("Page.javascriptDialogOpening");
    await renderer.send("Page.handleJavaScriptDialog", { accept: false });
    await deletion;
    assert.equal((await evaluate("conversationAPI.getMemory4OwnerData({ownerId:2})")).detail.total, 2);
    const acceptedDeletion = clickButton("删除");
    await renderer.wait("Page.javascriptDialogOpening");
    await renderer.send("Page.handleJavaScriptDialog", { accept: true });
    await acceptedDeletion;
    await waitFor("document.querySelector('.memory4-manager').textContent.includes('已删除长期记忆')");
    assert.equal((await evaluate("conversationAPI.getMemory4OwnerData({ownerId:2})")).detail.total, 1);
    await clickTab("Legacy 对话摘要");
    const bind = await evaluate("(()=>{const e=[...document.querySelectorAll('.player-header button')].find(e=>e.textContent.includes('绑定此人物全部旧摘要'));if(e)e.click();return !!e})()");
    assert(bind, "existing Owner Preview/Commit entry must remain available");
    await renderer.wait("Page.javascriptDialogOpening");
    await renderer.send("Page.handleJavaScriptDialog", { accept: false });
    await delay(100);
    assert.equal(await main.evaluate("globalThis.__m4ProviderCalls"), 0, "packaged UI smoke must not call a model");
    assert.deepStrictEqual(errors, [], "renderer/main exceptions");
    fs.writeFileSync(path.join(evidence, "result.json"), JSON.stringify({ passed: true, themes: ["parchment", "knight", "ink"], desktop: [1280, 1000], narrow: [540, 900], screenshotCount: screenshots.length, screenshots,
      providerRequests: 0, realCK3Gate: false, profile, checks: ["missing Campaign", "wrong Campaign", "strict owner data", "six views", "readonly Official", "source modal", "manual conflict preservation", "manual edit", "delete cancellation", "accepted Detail deletion", "existing binding preview cancellation", "nonoverlapping tool buttons", "no horizontal overflow"] }, null, 2));
    console.log(`V8.14 E isolated packaged UI: PASS; evidence ${evidence}`);
  } catch (error) {
    console.error("Isolated Electron diagnostics:", stderrTail);
    throw error;
  } finally {
    renderer?.socket.close(); main?.socket.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(5000)]);
    }
    console.log(`Isolated UI profile retained: ${profile}`);
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
