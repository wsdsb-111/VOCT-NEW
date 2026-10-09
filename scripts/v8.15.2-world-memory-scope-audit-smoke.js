"use strict";

// Optional isolated packaged-UI reproduction for CURRENT_DATE and scoped Canon saves.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeSave() {
  const metadata = Buffer.from('meta_date=1170.1.1\nversion="fixture"\n', "utf8");
  const header = Buffer.from(`SAV0100RANDOM01${metadata.length.toString(16).padStart(8, "0")}\n`, "ascii");
  const gamestate = Buffer.from(`date=1170.1.1
playthrough_id=v8152_world_memory_scope_fixture
played_character={ character=1 }
living={
  1={ first_name="甲" court_data={ employer=10 } landed_data={ domain={ 500 } } alive_data={ location={ location=500 } } }
  2={ first_name="乙" court_data={ employer=10 } landed_data={ liege=1 } alive_data={ location={ location=500 } } }
  10={ first_name="丙" landed_data={ domain={ 600 } } alive_data={ location={ location=500 } } }
}
`, "utf8");
  return Buffer.concat([header, metadata, gamestate]);
}

async function connect(url, errors) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`));
    else request.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timer, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return { send, evaluate, socket };
}

async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8152-world-memory-scope-"));
  const fixtureDir = path.join(profile, "fixture");
  const autosave = path.join(fixtureDir, "autosave.ck3");
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(autosave, makeSave());

  const child = spawn(path.resolve(__dirname, "../VOTC.exe"), [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--inspect=127.0.0.1:0"], {
    windowsHide: true,
    env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let main, renderer, stderrTail = "", stdoutTail = "", exitInfo = null;
  const errors = [];
  child.stderr.on("data", chunk => { stderrTail = (stderrTail + String(chunk)).slice(-8000); });
  child.stdout.on("data", chunk => { stdoutTail = (stdoutTail + String(chunk)).slice(-8000); });
  child.on("exit", (code, signal) => { exitInfo = { code, signal }; });

  try {
    const endpoints = await new Promise((resolve, reject) => {
      const found = {};
      const timer = setTimeout(() => reject(new Error(`isolated app debug endpoints timeout; exit=${JSON.stringify(exitInfo)}; stdout=${stdoutTail}; stderr=${stderrTail}`)), 30000);
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("exit", (code, signal) => {
        if (!found.browser || !found.main) {
          clearTimeout(timer);
          reject(new Error(`isolated app exited before debug endpoints; code=${code}; signal=${signal}; stdout=${stdoutTail}; stderr=${stderrTail}`));
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

    main = await connect(endpoints.main, errors);
    await main.send("Runtime.enable");
    const blocked = await main.evaluate("globalThis.__worldMemoryBlocked=[];globalThis.fetch=async input=>{const url=String(input?.url||input);globalThis.__worldMemoryBlocked.push(url);throw new Error('isolated_world_memory_network_blocked')};'blocked'");
    assert.equal(blocked, "blocked");

    const origin = new URL(endpoints.browser).origin.replace("ws:", "http:");
    let target;
    for (let i = 0; i < 100 && !target; i++) {
      target = (await (await fetch(`${origin}/json/list`)).json()).find(item => item.type === "page");
      if (!target) await delay(100);
    }
    assert(target, "isolated renderer target missing");
    renderer = await connect(target.webSocketDebuggerUrl, errors);
    await renderer.send("Runtime.enable");
    await renderer.send("Page.enable");
    const evaluate = renderer.evaluate;
    const waitFor = async expression => {
      for (let i = 0; i < 150; i++) { if (await evaluate(`!!(${expression})`)) return; await delay(100); }
      throw new Error(`UI condition timeout: ${expression}`);
    };
    const readCanon = () => evaluate("worldlineAPI.listCanon({offset:0})");
    const waitForCanon = async predicate => {
      for (let i = 0; i < 150; i++) { const result = await readCanon(); if (predicate(result)) return result; await delay(100); }
      throw new Error("Canon condition timeout");
    };

    await waitFor("typeof worldlineAPI?.rebuildCheckpoint === 'function'");
    const configured = await evaluate(`worldlineAPI.setAutosavePath(${JSON.stringify(autosave)})`);
    assert.equal(configured.autosavePath, autosave, JSON.stringify(configured));
    const build = await evaluate("worldlineAPI.rebuildCheckpoint()");
    assert.equal(build.success, true, JSON.stringify(build));
    assert.equal(build.checkpoint.status, "ACTIVE", JSON.stringify(build.checkpoint));
    assert.equal(build.checkpoint.gameDate, "1170.1.1", JSON.stringify(build.checkpoint));

    const optionResult = await evaluate("worldlineAPI.listCanonCharacterOptions({query:''})");
    const playerOption = optionResult.options.find(option => option.runtimeId === "1");
    assert(playerOption, `checkpoint player is not searchable: ${JSON.stringify(optionResult)}`);
    assert.equal(playerOption.displayName, "甲");
    assert.equal(optionResult.currentPlayer?.runtimeId, "1", "the API exposes the bound checkpoint player for the picker shortcut");
    assert.equal(optionResult.currentPlayer?.displayName, "甲");

    await evaluate("localStorage.setItem('config-panel-state',JSON.stringify({position:{x:30,y:20},size:{width:1120,height:900}}))");
    await renderer.send("Page.reload", { ignoreCache: true });
    await waitFor("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='世界书')");
    assert(await evaluate("(()=>{const e=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='世界书');e.click();return true})()"));
    await waitFor("document.querySelector('.worldline-editor button.world-memory-refresh')");
    await evaluate("document.querySelector('.worldline-editor button.world-memory-refresh').click()");
    await waitFor("document.querySelector('.world-memory-form')");

    const initial = await evaluate("worldlineAPI.listCanon({offset:0})");
    if (initial.branch.reason || !initial.branch.branchId) {
      const fork = await evaluate("[...document.querySelectorAll('.worldline-editor button')].find(e=>e.textContent.trim()==='建立独立分支（不继承旧 Canon）')?.click();true");
      assert(fork);
      await waitFor("document.querySelector('.world-memory-form')&&document.querySelector('.world-memory-status-grid')?.textContent.includes('已安全绑定')");
    }

    const setText = async (label, value) => evaluate(`(()=>{const field=[...document.querySelectorAll('.world-memory-form .world-memory-field')].find(e=>e.querySelector('span')?.textContent.trim()===${JSON.stringify(label)});if(!field)return false;const el=field.querySelector('input,textarea');const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    const setSelect = async (label, value) => evaluate(`(()=>{const field=[...document.querySelectorAll('.world-memory-form .world-memory-field')].find(e=>e.querySelector('span')?.textContent.trim()===${JSON.stringify(label)});if(!field)return false;const el=field.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    const addPlayer = async label => {
      const pickerByLabel = ` [...document.querySelectorAll('.world-memory-picker')].find(e=>e.querySelector('.world-memory-picker-heading')?.textContent.includes(${JSON.stringify(label)}))`;
      assert(await evaluate(`!!${pickerByLabel}`), `picker missing: ${label}`);
      const alreadySelected = await evaluate(`${pickerByLabel}?.querySelector('.world-memory-chips')?.textContent.includes('甲')||false`);
      if (alreadySelected) return;
      await waitFor(`${pickerByLabel}&&[...${pickerByLabel}.querySelectorAll('button')].some(e=>e.textContent.trim()==='选择当前玩家'&&!e.disabled)`);
      assert(await evaluate(`(()=>{const picker=${pickerByLabel};const button=[...(picker?.querySelectorAll('button')||[])].find(e=>e.textContent.trim()==='选择当前玩家'&&!e.disabled);if(!button)return false;button.click();return true})()`), `${label} current-player shortcut missing`);
      await waitFor(`${pickerByLabel}?.querySelector('.world-memory-chips')?.textContent.includes('甲')`);
    };

    const saveThroughUi = async ({ title, visibility, expectedScope }) => {
      assert(await setText("标题", title), "title input missing");
      assert(await setText("希望世界长期记住的内容", `${title}：隔离 fixture 中的已发生事实。`), "content input missing");
      assert(await setSelect("谁可以知道？", visibility), `visibility selector missing: ${visibility}`);
      await waitFor(`document.querySelector('.world-memory-form .world-memory-date-note')?.textContent.includes('1170年1月1日')`);
      await addPlayer("涉及人物");
      if (["PERSONAL", "SECRET"].includes(visibility)) await addPlayer("谁明确知道？");
      if (["COURT_PUBLIC", "REALM_PUBLIC"].includes(visibility)) {
        await waitFor("[...document.querySelectorAll('.world-memory-form .world-memory-field')].some(e=>e.querySelector('span')?.textContent.trim()==='范围以谁为准？')");
        assert(await setSelect("范围以谁为准？", "1"));
        assert.equal(await evaluate(`(()=>{const field=[...document.querySelectorAll('.world-memory-form .world-memory-field')].find(e=>e.querySelector('span')?.textContent.trim()==='范围以谁为准？');return field?.querySelector('select')?.value})()`), "1");
      }
      await evaluate("document.querySelector('.world-memory-form').scrollIntoView({block:'center'})");
      const screenshot = await renderer.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(profile, `${visibility.toLowerCase()}-form.png`), Buffer.from(screenshot.data, "base64"));
      await evaluate("[...document.querySelectorAll('.world-memory-form-actions button')].find(e=>e.textContent.trim()==='确认新增').click()");
      await waitFor("document.querySelector('.world-memory-form .world-memory-feedback[role=status]')||document.querySelector('.world-memory-form .world-memory-feedback.is-error')");
      const feedback = await evaluate("document.querySelector('.world-memory-form .world-memory-feedback')?.textContent.trim()||null");
      assert.equal(feedback, "世界记忆已保存。", `${visibility} should report success beside the submit control`);
      const persisted = await evaluate(`worldlineAPI.listCanon({offset:0}).then(result=>result.records.find(record=>record.title===${JSON.stringify(title)})||null)`);
      return { title, visibility, expectedScope, feedback, uiContainsTitle: await evaluate(`[...document.querySelectorAll('.world-memory-record')].some(e=>e.textContent.includes(${JSON.stringify(title)}))`), persisted };
    };

    const publicResult = await saveThroughUi({ title: "隔离世界权限保存", visibility: "PUBLIC_WORLD", expectedScope: null });
    assert(publicResult.persisted, JSON.stringify(publicResult));
    const courtResult = await saveThroughUi({ title: "隔离宫廷权限保存", visibility: "COURT_PUBLIC", expectedScope: "1" });
    const realmResult = await saveThroughUi({ title: "隔离领地权限保存", visibility: "REALM_PUBLIC", expectedScope: "1" });
    const personalResult = await saveThroughUi({ title: "隔离个人记忆授权保存", visibility: "PERSONAL", expectedScope: null });
    const secretResult = await saveThroughUi({ title: "隔离秘密授权保存", visibility: "SECRET", expectedScope: null });
    const results = [publicResult, courtResult, realmResult, personalResult, secretResult];
    for (const result of results) {
      if (result.persisted) {
        assert.equal(result.persisted.temporalMode, "CURRENT_DATE");
        assert.equal(result.persisted.gameDate, "1170.1.1");
        if (result.visibility === "COURT_PUBLIC" || result.visibility === "REALM_PUBLIC") assert.equal(result.persisted.scopeEntityId, result.expectedScope);
        if (result.visibility === "PERSONAL" || result.visibility === "SECRET") assert(result.persisted.knownBy.includes("1"), `${result.visibility} must retain the explicit current-player knowledge grant`);
      }
    }
    assert(publicResult.persisted, "PUBLIC_WORLD control record should save from the real UI");

    const missingGrantTitle = "隔离秘密缺少知情人拒绝";
    assert(await setText("标题", missingGrantTitle), "missing-knownBy title input missing");
    assert(await setText("希望世界长期记住的内容", "合成拒绝用例：未授权知情人不得保存。"), "missing-knownBy content input missing");
    assert(await setSelect("谁可以知道？", "SECRET"), "missing-knownBy visibility selector missing");
    const knownByPicker = ` [...document.querySelectorAll('.world-memory-picker')].find(e=>e.querySelector('.world-memory-picker-heading')?.textContent.includes('谁明确知道？'))`;
    const clearKnownBy = await evaluate(`(()=>{const picker=${knownByPicker};if(!picker)return false;if(!picker.querySelector('.world-memory-chips')?.textContent.includes('甲'))return true;const button=picker.querySelector('.world-memory-chips button[aria-label="移除甲"]');if(!button)return false;button.click();return true})()`);
    assert(clearKnownBy, "the explicit knownBy selection must be empty for the negative scope case");
    await waitFor(`${knownByPicker}&&!${knownByPicker}.querySelector('.world-memory-chips')?.textContent.includes('甲')`);
    await evaluate("document.querySelector('.world-memory-form-actions')?.scrollIntoView({block:'center'})");
    await evaluate("[...document.querySelectorAll('.world-memory-form-actions button')].find(e=>e.textContent.trim()==='确认新增').click()");
    await waitFor("document.querySelector('.world-memory-form-actions .world-memory-feedback.is-error')?.textContent.includes('明确知情')");
    const missingGrantResult = await evaluate(`(async()=>{const actions=document.querySelector('.world-memory-form-actions');const error=actions?.querySelector('.world-memory-feedback.is-error');const rect=error?.getBoundingClientRect()||{top:0,bottom:0};const result=await worldlineAPI.listCanon({offset:0});return {errorText:error?.textContent.trim()||null,errorInsideActions:!!error,visibleInViewport:!!error&&rect.bottom>0&&rect.top<document.documentElement.clientHeight,persisted:result.records.some(record=>record.title===${JSON.stringify(missingGrantTitle)})}})()`);
    assert(missingGrantResult.errorInsideActions, JSON.stringify(missingGrantResult));
    assert(missingGrantResult.visibleInViewport, JSON.stringify(missingGrantResult));
    assert.equal(missingGrantResult.persisted, false, "SECRET without explicit knownBy must not persist");

    const syntheticCk3Folder = path.join(fixtureDir, "synthetic-ck3-user");
    const syntheticDebugLog = path.join(syntheticCk3Folder, "logs", "debug.log");
    fs.mkdirSync(path.dirname(syntheticDebugLog), { recursive: true });
    const setSyntheticDebugDate = async (date, useClock = false) => {
      const initDate = useClock ? "1170年1月1日" : date;
      const clockLine = useClock ? `VOTC:DATE/;/420002/;/${date}\n` : "";
      fs.writeFileSync(syntheticDebugLog, `VOTC:IN/;/init/;/1/;/TITLE Player/;/2/;/TITLE NPC/;/${initDate}/;/talk_scene_court/;/Court 9/;/Controller/;/420001\n${clockLine}`, "utf8");
      const result = await renderer.evaluate(`llmConfigAPI.setCK3Folder(${JSON.stringify(syntheticCk3Folder)})`);
      assert.equal(result.success, true, JSON.stringify(result));
    };
    await setSyntheticDebugDate("1170年1月2日");
    await waitForCanon(result => result.defaultGameDate === "1170年1月2日");
    await evaluate("document.querySelector('.world-memory-form').scrollIntoView({block:'center'})");
    await setText("标题", "live checkpoint 日期优先级 fixture");
    await setText("希望世界长期记住的内容", "合成事件：以 live 日期而不是 checkpoint 日期保存。");
    await setSelect("这件事从什么时候成立？", "CURRENT_DATE");
    await setSelect("谁可以知道？", "PUBLIC_WORLD");
    await addPlayer("涉及人物");
    await evaluate("document.querySelector('.world-memory-form').scrollIntoView({block:'center'})");
    await evaluate("[...document.querySelectorAll('.world-memory-form-actions button')].find(e=>e.textContent.trim()==='确认新增').click()");
    await waitFor("[...document.querySelectorAll('.world-memory-record')].some(e=>e.textContent.includes('live checkpoint 日期优先级 fixture'))||!!document.querySelector('.world-memory-feedback.is-error')");
    const liveDateResult = await readCanon();
    const liveDateRecord = liveDateResult.records.find(record => record.title === "live checkpoint 日期优先级 fixture") || null;
    assert(liveDateRecord, `the valid live-date fixture should save through the UI; feedback=${await evaluate("document.querySelector('.world-memory-form .world-memory-feedback')?.textContent.trim()||null")}`);
    assert.equal(liveDateRecord.gameDate, "1170.1.2", "CURRENT_DATE must use the valid live date even when it differs from checkpoint");

    await setSyntheticDebugDate("1170年1月3日", true);
    await waitForCanon(result => result.defaultGameDate === "1170年1月3日");
    await setText("标题", "rich DATE 当前日期 fixture");
    await setText("希望世界长期记住的内容", "合成事件：持续日期推进后以新日期保存。");
    await setSelect("这件事从什么时候成立？", "CURRENT_DATE");
    await setSelect("谁可以知道？", "PUBLIC_WORLD");
    await addPlayer("涉及人物");
    await evaluate("[...document.querySelectorAll('.world-memory-form-actions button')].find(e=>e.textContent.trim()==='确认新增').click()");
    await waitFor("[...document.querySelectorAll('.world-memory-record')].some(e=>e.textContent.includes('rich DATE 当前日期 fixture'))||!!document.querySelector('.world-memory-feedback.is-error')");
    const richDateRecord = (await readCanon()).records.find(record => record.title === "rich DATE 当前日期 fixture");
    assert(richDateRecord, "the rich DATE fixture should save through the packaged UI");
    assert.equal(richDateRecord.gameDate, "1170.1.3");
    assert.equal(richDateRecord.totalDays, 420002);

    await setSyntheticDebugDate("August 24, 1170");
    await waitForCanon(result => result.defaultGameDate === "August 24, 1170");
    await evaluate("document.querySelector('.world-memory-refresh').click()");
    await waitFor("document.querySelector('.world-memory-date-note')?.textContent.includes('August 24, 1170')");
    assert(await setText("标题", "invalid live date 拒绝反馈 fixture"), "invalid-date title input missing");
    assert(await setText("希望世界长期记住的内容", "合成事件：非法 live 日期应被拒绝。"), "invalid-date content input missing");
    assert(await setSelect("这件事从什么时候成立？", "CURRENT_DATE"), "invalid-date temporal mode selector missing");
    assert(await setSelect("谁可以知道？", "PUBLIC_WORLD"), "invalid-date visibility selector missing");
    await addPlayer("涉及人物");
    await evaluate("document.querySelector('.world-memory-form').scrollIntoView({block:'center'})");
    await evaluate("[...document.querySelectorAll('.world-memory-form-actions button')].find(e=>e.textContent.trim()==='确认新增').click()");
    await waitFor("!!document.querySelector('.world-memory-form .world-memory-feedback.is-error')||[...document.querySelectorAll('.world-memory-record')].some(e=>e.textContent.includes('invalid live date 拒绝反馈 fixture'))");
    await evaluate("document.querySelector('.world-memory-form-actions')?.scrollIntoView({block:'center'})");
    const dateErrorVisibility = await evaluate(`(async()=>{const error=document.querySelector('.world-memory-form .world-memory-feedback.is-error');const rect=error?.getBoundingClientRect()||{top:0,bottom:0};const result=await worldlineAPI.listCanon({offset:0});const persisted=result.records.some(record=>record.title==='invalid live date 拒绝反馈 fixture');return {errorPresent:!!error,errorText:error?.textContent.trim()||null,errorTop:Math.round(rect.top),errorBottom:Math.round(rect.bottom),viewportHeight:document.documentElement.clientHeight,visibleInViewport:!!error&&rect.bottom>0&&rect.top<document.documentElement.clientHeight,persisted};})()`);
    assert(dateErrorVisibility.errorPresent, JSON.stringify(dateErrorVisibility));
    assert(dateErrorVisibility.visibleInViewport, JSON.stringify(dateErrorVisibility));
    assert.equal(dateErrorVisibility.persisted, false, "invalid live date must not persist a Canon record");
    const dateAudit = { liveDateRecord: { gameDate: liveDateRecord.gameDate, temporalMode: liveDateRecord.temporalMode }, richDateRecord: { gameDate: richDateRecord.gameDate, totalDays: richDateRecord.totalDays }, invalidDateErrorVisibility: dateErrorVisibility };

    const blockedUrls = await main.evaluate("globalThis.__worldMemoryBlocked");
    assert(blockedUrls.every(url => url === "http://127.0.0.1:4315/v1/health"), `only the local Player2 health check may be blocked: ${JSON.stringify(blockedUrls)}`);
    assert.deepEqual(errors, [], "packaged renderer/main exceptions");

    const evidence = { passed: results.every(result => result.persisted) && !missingGrantResult.persisted && dateErrorVisibility.visibleInViewport, profile, autosave, playerOption, checkpoint: build.checkpoint,
      results: results.map(result => ({ ...result, error: result.feedback?.startsWith("操作未完成：") ? result.feedback : null })),
      missingGrantResult,
      dateAudit,
      blockedUrls,
      note: "Run used the real packaged renderer, preload, IPC, Canon worker, and a temporary CK3-format save; no remote provider or real user data was used. The app's local Player2 health probe was intercepted before network I/O." };
    fs.writeFileSync(path.join(profile, "world-memory-scope-result.json"), JSON.stringify(evidence, null, 2), "utf8");
    console.log(JSON.stringify(evidence, null, 2));
    assert(results.every(result => result.persisted), `all five supported visibility modes should save through the UI: ${JSON.stringify(evidence.results)}`);
  } catch (error) {
    const entries = fs.readdirSync(profile, { withFileTypes: true }).map(entry => `${entry.isDirectory() ? "dir" : "file"}:${entry.name}`);
    const uiState = renderer ? await renderer.evaluate(`(()=>({error:document.querySelector('.world-memory-feedback.is-error')?.textContent.trim()||null,feedback:document.querySelector('.world-memory-feedback')?.textContent.trim()||null,dateNote:document.querySelector('.world-memory-date-note')?.textContent.trim()||null,branch:document.querySelector('.world-memory-status-grid')?.textContent.trim()||null,warnings:[...document.querySelectorAll('.world-memory-editor .is-warning,.world-memory-editor .is-blocked')].map(e=>e.textContent.trim()),fields:[...document.querySelectorAll('.world-memory-form input,.world-memory-form textarea,.world-memory-form select')].map(e=>({value:e.value,disabled:e.disabled})),buttons:[...document.querySelectorAll('.world-memory-form-actions button')].map(e=>({text:e.textContent.trim(),disabled:e.disabled})),chips:[...document.querySelectorAll('.world-memory-chip')].map(e=>e.textContent.trim()),scrollY:window.scrollY,viewportHeight:document.documentElement.clientHeight}))()`).catch(() => null) : null;
    console.error("Isolated packaged diagnostics:", JSON.stringify({ stdoutTail, stderrTail, entries, uiState, rendererErrors: errors }, null, 2));
    throw error;
  } finally {
    renderer?.socket.close();
    main?.socket.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(5000)]);
    }
    console.log(`Isolated world-memory profile retained: ${profile}`);
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
