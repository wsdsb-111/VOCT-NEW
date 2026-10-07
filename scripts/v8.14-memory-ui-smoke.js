"use strict";

// Optional real packaged UI smoke. The inspector fixture replaces only the
// manager's current-conversation callback in this disposable app process.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { createMemoryUiFixture } = require("./v8.14-memory-ui-fixture");
const { disclosureFactId } = require("../resources/app/out/main/memory-system/memory4-disclosure");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");
const { createProjectionLineage } = require("../resources/app/out/main/memory-system/memory4-forget");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function hashDirectory(directory) {
  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(current, entry.name);
      assert(!entry.isSymbolicLink(), `unexpected fixture symlink: ${file}`);
      if (entry.isDirectory()) visit(file);
      else files.push(`${path.relative(directory, file)}:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`);
    }
  };
  visit(directory);
  return crypto.createHash("sha256").update(files.join("\n")).digest("hex");
}

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
  const orphanScope = { campaignToken: fixture.scope.campaignToken, ownerId: 1 };
  const orphanText = "乙曾告知甲一个仅用于隔离审计的旧事实。";
  const orphanContext = { ...orphanScope, conversationId: "ui-orphan-conversation", finalizationId: "ui-orphan-finalization",
    episodeId: "ui-orphan-episode", date: "1164.1.1", totalDays: 425000, participants: [1, 2].map(id => ({ id })),
    participantPresence: [1, 2].map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })),
    messages: [{ id: 94, role: "assistant", speakerCharacterId: 2, content: orphanText,
      memory4Fragments: [{ start: 0, end: orphanText.length, visibility: "participants", sourceType: "spoken", recipientIds: [1], entityIds: [1, 2] }] }] };
  const orphanProjection = projectVisibleTranscript(orphanContext, orphanScope.ownerId);
  const orphanLineage = createProjectionLineage({ ...orphanScope, counterpartId: 2,
    conversationId: orphanContext.conversationId, finalizationId: orphanContext.finalizationId,
    segmentIds: ["ui-orphan-summary"], sourceSegmentIds: orphanProjection.fragments.map(fragment => fragment.fragmentId), sourceMessageIds: [94] });
  fixture.engine.memory4.store.commitOwner({ ...orphanContext, ...orphanProjection, summaryIds: [],
    counterpartIds: [2], projectionLineages: [orphanLineage] }, { status: "STORE", entries: [{
    memoryType: "DURABLE_KNOWLEDGE", text: orphanText, fragmentIds: orphanProjection.fragments.map(fragment => fragment.fragmentId),
    entityIds: [2], participantIds: [1, 2], topics: ["审计"], eventTime: { status: "unknown" }
  }] });
  const targetCharacter = fixture.characters.find(character => character.id === 1);
  Object.assign(targetCharacter, { primaryTitle: "明王", nickname: "北地之虎", age: 14,
    traits: [{ id: "bastard", name: "私生子" }, { traitId: "beauty_good_3", name: "倾国倾城" }] });
  fixture.conversation.gameData.characters.set(targetCharacter.id, targetCharacter);
  const disclosureText = "甲现在是明王。";
  const disclosureContext = { ...fixture.scope, conversationId: "isolated-ui-conversation", finalizationId: "ui-smoke-disclosure-finalization",
    episodeId: "ui-smoke-disclosure-episode", date: "1164.1.1", totalDays: 425000,
    participants: [1, 2].map(id => ({ id })), participantPresence: [1, 2].map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })),
    messages: [{ id: 93, role: "assistant", speakerCharacterId: 1, content: disclosureText,
      memory4Fragments: [{ start: 0, end: disclosureText.length, visibility: "participants", sourceType: "spoken", recipientIds: [2], entityIds: [1, 2] }] }] };
  const disclosureProjection = projectVisibleTranscript(disclosureContext, fixture.scope.ownerId);
  fixture.engine.memory4.store.recordKnownEvidence({ ...disclosureContext, ...disclosureProjection, ownerId: fixture.scope.ownerId });
  const disclosureSnapshot = { ...disclosureContext, ...disclosureProjection, ownerId: fixture.scope.ownerId,
    sourceKind: "CONVERSATION", disclosureCharacters: fixture.characters };
  const seededDisclosure = fixture.engine.memory4.store.recordDisclosures(disclosureSnapshot, [{
    factId: disclosureFactId(fixture.scope, targetCharacter.id, "TITLE", "title_明王"), entityId: targetCharacter.id,
    factType: "TITLE", factKey: "title_明王", value: "明王", evidence: {
      sourceMessageIds: disclosureProjection.fragments.map(fragment => fragment.messageId),
      sourceFragmentIds: disclosureProjection.fragments.map(fragment => fragment.fragmentId),
      visibilityEvidence: disclosureProjection.fragments.map(fragment => fragment.visibilityEvidence),
      sourceTextHashes: disclosureProjection.fragments.map(fragment => crypto.createHash("sha256").update(fragment.text).digest("hex"))
    }
  }]);
  assert.equal(seededDisclosure.changed, true, "isolated fixture should seed one source-backed public fact");
  const ageCharacters = fixture.characters.map(character => character.id === 1 ? { ...character, age: 13 } : character);
  const ageContext = { campaignToken: fixture.scope.campaignToken, conversationId: "ui-listener-age-source",
    finalizationId: "ui-listener-age-finalization", episodeId: "ui-listener-age-episode", date: "1163.1.1",
    participants: ageCharacters, disclosureCharacters: ageCharacters,
    participantPresence: ageCharacters.map(character => ({ characterId: character.id, joinedAtMessageId: 0, leftAtMessageId: null })),
    messages: [[95, 3, "甲，你今年多少岁？"], [96, 1, "今年13岁。"]].map(([id, speakerCharacterId, content]) => ({
      id, role: "assistant", speakerCharacterId, content, memory4Fragments: [{ start: 0, end: content.length,
        visibility: "participants", sourceType: "spoken", entityIds: [1, 2, 3] }] })) };
  const ageSnapshot = fixture.engine.memory4.buildOwnerSnapshot(ageContext, fixture.scope.ownerId);
  fixture.engine.memory4.store.recordKnownEvidence(ageSnapshot);
  assert.equal(fixture.engine.memory4.recordDisclosures(ageSnapshot, { campaignToken: fixture.scope.campaignToken,
    date: ageContext.date, characters: new Map(ageCharacters.map(character => [character.id, character])) }).status, "RECORDED",
  "the UI age is produced by a real three-person listener Q&A, not a manually seeded AGE proof");
  const listenerAge = fixture.engine.memory4.store.getDisclosedFacts(fixture.scope, 1).find(fact => fact.factType === "AGE");
  const listenerProof = Object.values(listenerAge.evidenceBySource).find(proof => proof.sourceKind === "CONVERSATION");
  assert.deepEqual(listenerProof.sourceMessageIds, [95, 96]);
  assert.deepEqual(listenerProof.knownBy, [2], "the bystander's proof remains Owner-scoped");
  const directObservationContext = { conversationId: fixture.conversation.id, campaignToken: fixture.scope.campaignToken,
    gameDate: fixture.conversation.gameData.date, messageBoundary: 94, participantPresence: disclosureContext.participantPresence };
  fixture.conversation.gameData.directObservationContext = directObservationContext;
  fixture.engine.memory4.observeVisibleTraits({ ...directObservationContext, observerId: 2, targetId: 1,
    gameData: fixture.conversation.gameData });
  fixture.engine.memory4.store.updateManualDisclosure({ campaignToken: fixture.archive.campaignToken, ownerId: fixture.archive.ownerId }, 1,
    { factType: "TITLE", factKey: "title_明王", value: "明王" }, "MANUAL_KNOWN", "1160.6.1", 0);
  const archiveHashBefore = hashDirectory(fixture.archive.directory);
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
    const blockerSetup = await main.send("Runtime.evaluate", { expression: "globalThis.__m4BlockedFetches=[];globalThis.fetch=async input=>{const url=String(input?.url||input);globalThis.__m4BlockedFetches.push(url);throw new Error('isolated_ui_network_blocked')};'network-blocker-installed'", returnByValue: true });
    assert(!blockerSetup.exceptionDetails, JSON.stringify(blockerSetup.exceptionDetails));
    assert.equal(blockerSetup.result?.value, "network-blocker-installed");
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
    await main.evaluate(`globalThis.__m4SmokeConversation.gameData.directObservationContext=${JSON.stringify(directObservationContext)};`);
    const source = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/summaries/summaries-manager.js"), "utf8").split(/\r?\n/);
    const start = source.findIndex(line => line.includes("static async getMemory4ReadContext"));
    const lineNumber = source.findIndex((line, index) => index > start && line.includes("const conversation = getCurrentMemory4ReadConversation();"));
    assert(lineNumber > start);
    const managerSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/conversation/conversation-manager.js"), "utf8").split(/\r?\n/);
    const managerLineNumber = managerSource.findIndex(line => line.includes("return this.currentConversation || this.lastMemory4ReadContext;"));
    assert(managerLineNumber > 0);
    const readContextBreakpoint = await main.send("Debugger.setBreakpointByUrl", { urlRegex: "summaries-manager\\.js$", lineNumber });
    const managerBreakpoint = await main.send("Debugger.setBreakpointByUrl", { urlRegex: "conversation-manager\\.js$", lineNumber: managerLineNumber });
    const ownerRequest = evaluate("conversationAPI.getMemory4OwnerData({ownerId:2})");
    const paused = await main.wait("Debugger.paused");
    const prepared = await main.send("Debugger.evaluateOnCallFrame", { callFrameId: paused.callFrames[0].callFrameId,
      expression: "globalThis.__m4SmokeConversation.memoryState=memoryEngine.createConversationState('isolated-ui-conversation');memoryEngine.memory4.configureDerived({isCampaignCurrent:token=>token===globalThis.__m4SmokeConversation.gameData.campaignToken,requestCompression:async()=>{globalThis.__m4ProviderCalls++;throw new Error('fixture_provider_forbidden');},requestExtraction:async()=>{globalThis.__m4ProviderCalls++;throw new Error('fixture_provider_forbidden');}});'fixture-prepared'", returnByValue: true });
    assert(!prepared.exceptionDetails, JSON.stringify(prepared.exceptionDetails));
    await main.send("Debugger.removeBreakpoint", { breakpointId: readContextBreakpoint.breakpointId });
    await main.send("Debugger.resume");
    const managerPaused = await main.wait("Debugger.paused");
    const activeInjected = await main.send("Debugger.evaluateOnCallFrame", { callFrameId: managerPaused.callFrames[0].callFrameId,
      expression: "this.currentConversation=globalThis.__m4SmokeConversation;this.lastMemory4ReadContext=null;'fixture-active-context'", returnByValue: true });
    assert(!activeInjected.exceptionDetails, JSON.stringify(activeInjected.exceptionDetails));
    await main.send("Debugger.removeBreakpoint", { breakpointId: managerBreakpoint.breakpointId });
    await main.send("Debugger.resume");
    const data = await ownerRequest;
    assert.equal(data.success, true);
    assert.equal(data.detail.total, 2);
    console.log("Isolated real preload/IPC fixture ready");
    assert.equal((await evaluate("conversationAPI.getMemory4OwnerData({ownerId:2,expectedCampaignToken:'wrong-campaign'})")).success, false);
    const orphanRequest = { ownerId: 2, expectedCampaignToken: fixture.scope.campaignToken, expectedContextId: "isolated-ui-conversation" };
    const auditHashBefore = hashDirectory(fixture.summariesDir);
    const orphanAudit = await evaluate(`conversationAPI.auditMemory4Orphans(${JSON.stringify(orphanRequest)})`);
    assert.equal(orphanAudit.success, true, JSON.stringify(orphanAudit));
    assert(/^[a-f0-9]{64}$/.test(orphanAudit.auditToken));
    assert.equal((await evaluate("conversationAPI.auditMemory4Orphans({ownerId:2,expectedCampaignToken:'wrong-campaign'})")).success, false);
    const unconfirmedForget = await evaluate(`conversationAPI.forgetMemory4Orphan(${JSON.stringify({ ...orphanRequest,
      expectedAuditToken: orphanAudit.auditToken, projectionId: orphanAudit.items[0]?.projectionId, confirmed: false })})`);
    assert.equal(unconfirmedForget.success, false);
    assert.equal(unconfirmedForget.error, "memory4_orphan_confirmation_required");
    assert.equal(hashDirectory(fixture.summariesDir), auditHashBefore, "orphan audit and rejected confirmation leave sidecars unchanged");
    const ghostRequest = { ...orphanRequest, ownerId: orphanScope.ownerId };
    const ghostAudit = await evaluate(`conversationAPI.auditMemory4Orphans(${JSON.stringify(ghostRequest)})`);
    assert.equal(ghostAudit.success, true, JSON.stringify(ghostAudit));
    assert.equal(ghostAudit.items.find(item => item.projectionId === orphanLineage.projectionId)?.status, "ORPHANED_PRE_V815_PROJECTION");
    const acceptedForget = await evaluate(`conversationAPI.forgetMemory4Orphan(${JSON.stringify({ ...ghostRequest,
      projectionId: orphanLineage.projectionId, expectedAuditToken: ghostAudit.auditToken, confirmed: true })})`);
    assert.equal(acceptedForget.success, true, JSON.stringify(acceptedForget));
    assert.equal(acceptedForget.result.status, "FORGOTTEN");
    const afterGhostForget = await evaluate(`conversationAPI.auditMemory4Orphans(${JSON.stringify(ghostRequest)})`);
    assert.equal(afterGhostForget.items.find(item => item.projectionId === orphanLineage.projectionId)?.status, "FORGOTTEN");
    await evaluate("localStorage.setItem('votc-developer-mode','true');localStorage.setItem('config-panel-state',JSON.stringify({position:{x:40,y:30},size:{width:1000,height:840}}))");
    await renderer.send("Page.reload", { ignoreCache: true });
    await waitFor("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Summaries')");
    await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Summaries').click()");
    await waitFor("document.querySelectorAll('.player-summary-group').length>=3");
    await evaluate("[...document.querySelectorAll('.player-header')].find(e=>e.querySelector('.player-name')?.textContent.startsWith('乙')).click()");
    await waitFor("document.querySelector('.memory4-manager .memory4-entity')");
    console.log("Memory4 owner view ready");
    await waitFor("document.querySelector('.memory4-manager .memory4-disclosures')");
    const disclosureView = await evaluate("document.querySelector('.memory4-manager').textContent");
    assert(disclosureView.includes("明王") && disclosureView.includes("对话公开") && disclosureView.includes("1164.1.1"),
      "current profile should show the exact disclosed title, source and acquired date");
    assert(disclosureView.includes("北地之虎") && disclosureView.includes("默认可见"), "nickname must stay visible without disclosure");
    const managerFor = ownerName => ownerName
      ? `([...document.querySelectorAll('.player-summary-group')].find(group=>group.querySelector('.player-name')?.textContent.startsWith(${JSON.stringify(ownerName)}))?.querySelector('.memory4-manager'))`
      : `document.querySelector('.memory4-manager')`;
    const clickTab = async (label, ownerName = null) => {
      const manager = managerFor(ownerName);
      assert(await evaluate(`(()=>{const root=${manager};const e=root&&[...root.querySelectorAll('[role=tab]')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(e)e.click();return !!e})()`));
      await delay(120);
    };
    const clickButton = async (label, ownerName = null) => {
      const manager = managerFor(ownerName);
      assert(await evaluate(`(()=>{const root=${manager};const e=root&&[...root.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled);if(e)e.click();return !!e})()`), `missing enabled button: ${label}`);
      await delay(120);
    };
    const setViewport = async (width, height) => {
      await renderer.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      const size = await evaluate("(()=>{const e=document.querySelector('.config-panel-container'),r=e.getBoundingClientRect();e.querySelector('.resize-se').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.right-2,clientY:r.bottom-2}));return{x:r.right-2,y:r.bottom-2,width:r.width,height:r.height};})()");
      await delay(40);
      await evaluate(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:${size.x + Math.min(1000, width - 60) - size.width},clientY:${size.y + height - 60 - size.height}}));document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))`);
      await delay(80);
    };
    const screenshot = async (name, manager = "document.querySelector('.memory4-manager')", scrollToStart = true) => {
      if (scrollToStart) await evaluate(`${manager}?.scrollIntoView({block:'start'})`);
      const bounds = await evaluate(`(()=>{const e=${manager};if(!e)return{x:0,y:0,width:0,height:0};const r=e.getBoundingClientRect();return{x:Math.max(0,r.x),y:Math.max(0,r.y),width:Math.min(r.width,innerWidth-Math.max(0,r.x)),height:Math.min(r.height,innerHeight-Math.max(0,r.y))}})()`);
      assert(bounds.width > 200 && bounds.height > 80, "Memory UI must have a visible viewport");
      const result = await renderer.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(result.data, "base64"));
      screenshots.push(name);
      const collisions = await evaluate(`(()=>{const modal=document.querySelector('.memory4-modal'),manager=${manager};const root=modal||manager;if(!root)return [['missing memory view']];const b=[...root.querySelectorAll('button')].filter(e=>e.checkVisibility()).map(e=>({e,r:e.getBoundingClientRect()})).filter(x=>x.r.width&&x.r.height&&x.r.y>=0&&x.r.bottom<=innerHeight);const bad=[];for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){if(b[i].e.contains(b[j].e)||b[j].e.contains(b[i].e))continue;const a=b[i].r,c=b[j].r;if(Math.min(a.right,c.right)-Math.max(a.left,c.left)>1&&Math.min(a.bottom,c.bottom)-Math.max(a.top,c.top)>1)bad.push([b[i].e.textContent,b[j].e.textContent]);}return bad})()`);
      assert.deepStrictEqual(collisions, [], `overlapping buttons in ${name}`);
      assert(await evaluate(`(()=>{const e=document.querySelector('.memory4-modal')||${manager};return !!e&&e.scrollWidth<=e.clientWidth+2})()`), `horizontal overflow in ${name}`);
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
    const observedFact = await evaluate("conversationAPI.getMemory4OwnerData({ownerId:2}).then(data=>data.known.items.find(item=>item.entityId===1)?.disclosedFacts.find(fact=>fact.factKey==='trait_beauty_good_3'))");
    assert.equal(observedFact.sourceKind, "DIRECT_OBSERVATION");
    assert.equal(observedFact.currentDirectObservation, true);
    assert(await evaluate("(()=>{const row=[...document.querySelectorAll('.memory4-disclosure-row')].find(row=>row.textContent.includes('倾国倾城'));return !!row&&row.textContent.includes('直接观察')&&!row.querySelector('button:not([disabled])')})()"), "current observed trait shows direct source and cannot be hidden");
    const rejectedObservationHide = await evaluate(`conversationAPI.mutateMemory4(${JSON.stringify({ ownerId: 2,
      operation: "setManualDisclosure", entityId: 1, status: "MANUAL_HIDDEN", expectedRevision: observedFact.revision,
      factRef: { factType: "TRAIT", factKey: observedFact.factKey, value: observedFact.value, factEpoch: observedFact.factEpoch } })})`);
    assert.equal(rejectedObservationHide.success, false);
    await screenshot("ink-desktop-direct-observation");
    await setViewport(540, 900);
    await screenshot("ink-narrow-direct-observation");
    await setViewport(1280, 1000);
    await waitFor("document.querySelector('.memory4-manager').textContent.includes('披露时年龄：13岁')");
    const ageProfile = await evaluate("conversationAPI.getMemory4OwnerData({ownerId:2}).then(data=>data.known.items.find(item=>item.entityId===1)?.disclosedFacts.find(fact=>fact.factType==='AGE'))");
    assert.equal(ageProfile.value, "13");
    assert.equal(ageProfile.current, false, "disclosed age is a historical observation, never current age truth");
    assert.equal(ageProfile.firstAcquiredDate, "1163.1.1");
    assert.equal(ageProfile.currentKnownAge, 14, "a listener's disclosed age authorizes current CK3 age projection without rewriting the historical value");
    assert.equal(ageProfile.currentAgeReadDate, "1164.1.1");
    assert(await evaluate("document.querySelector('.memory4-manager').textContent.includes('当前年龄：14岁')"), "authorized current age must be rendered separately from disclosure history");
    assert(await evaluate("(()=>{const row=[...document.querySelectorAll('.memory4-disclosure-row')].find(row=>row.textContent.includes('披露时年龄'));return !!row&&row.textContent.includes('历史披露记录')&&!row.querySelector('button')})()"), "historical age must show date and no current/manual mutation control");
    await screenshot("ink-desktop-disclosed-age-history");
    await setViewport(540, 900);
    await evaluate("[...document.querySelectorAll('.memory4-disclosure-row')].find(row=>row.textContent.includes('披露时年龄'))?.scrollIntoView({block:'center',behavior:'instant'})");
    await delay(250);
    assert(await evaluate("(()=>{const row=[...document.querySelectorAll('.memory4-disclosure-row')].find(row=>row.textContent.includes('披露时年龄'));const rect=row?.getBoundingClientRect();return !!rect&&rect.top>=0&&rect.bottom<=innerHeight})()"), "historical age row must be visible in the narrow screenshot");
    await screenshot("ink-narrow-disclosed-age-history", undefined, false);
    await setViewport(1280, 1000);
    const titleHide = clickButton("设为未知");
    await renderer.wait("Page.javascriptDialogOpening");
    await renderer.send("Page.handleJavaScriptDialog", { accept: false });
    await titleHide;
    const afterCancelledHide = await evaluate(`conversationAPI.getMemory4OwnerData({ownerId:2}).then(data=>data.known.items.find(item=>item.entityId===1)?.disclosedFacts.find(fact=>fact.value==='明王'))`);
    assert.equal(afterCancelledHide.status, "AUTO_DISCLOSED", "cancelled hide must leave the source-backed title untouched");
    const openedTraitCandidates = await evaluate("(()=>{const e=[...document.querySelectorAll('.memory4-disclosures details')].find(node=>node.querySelector('summary')?.textContent.includes('当前特质候选'));e?.querySelector('summary').click();return !!e})()");
    assert(openedTraitCandidates, "current trait candidates should be expandable");
    await screenshot("ink-desktop-disclosure-source");
    await setViewport(540, 900);
    await screenshot("ink-narrow-disclosure-source");
    await setViewport(1280, 1000);
    await clickButton("设为已知");
    await waitFor("document.querySelector('.memory4-manager').textContent.includes('手动标记')");
    const manualFact = await evaluate(`conversationAPI.getMemory4OwnerData({ownerId:2}).then(data=>data.known.items.find(item=>item.entityId===1)?.disclosedFacts.find(fact=>fact.value==='私生子'))`);
    assert.equal(manualFact.status, "MANUAL_KNOWN", "manual UI write should persist an owner-scoped known mark");
    await screenshot("ink-desktop-disclosure-manual");
    await setViewport(540, 900);
    await screenshot("ink-narrow-disclosure-manual");
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
    const archiveManager = managerFor("丁");
    assert.equal(await main.evaluate("globalThis.__m4SmokeConversation.gameData.characters.has(4)"), false, "archive owner must remain outside loaded roster");
    const archiveData = await evaluate(`conversationAPI.getMemory4OwnerData({ownerId:${fixture.archive.ownerId},expectedCampaignToken:${JSON.stringify(fixture.archive.campaignToken)},expectedContextId:'isolated-ui-conversation'})`);
    assert.equal(archiveData.success, true, JSON.stringify(archiveData));
    assert.equal(archiveData.readOnlyArchive, true);
    assert.equal(archiveData.readOnlyReason, "owner_not_in_current_roster");
    assert.equal(archiveData.campaignToken, fixture.scope.campaignToken);
    assert(archiveData.detail.total > 0, "matching archive sidecar must remain readable");
    assert.equal(archiveData.generation.lastStatus, "STORE");
    const archiveGroupOpened = await evaluate(`(()=>{const group=[...document.querySelectorAll('.player-summary-group')].find(group=>group.querySelector('.player-name')?.textContent.startsWith('丁'));if(!group)return false;group.querySelector('.player-header')?.click();return true})()`);
    assert(archiveGroupOpened, "archive owner summary group should be available");
    await waitFor(`!!${archiveManager}`);
    await waitFor(`${archiveManager}?.textContent.includes('已加载战役')&&(/只读|仅供查阅/.test(${archiveManager}.textContent))`);
    const archiveBanner = await evaluate(`${archiveManager}.textContent`);
    assert(archiveBanner.includes("已加载战役") && /只读|仅供查阅/.test(archiveBanner), "archive view must identify the loaded campaign and read-only state");
    const refreshEnabled = await evaluate(`${archiveManager}.querySelector('[aria-label="刷新人物记忆"]')?.disabled===false`);
    assert(refreshEnabled, "archive refresh remains available");
    assert.equal(await evaluate(`${archiveManager}.querySelectorAll('[role=tab]:not([disabled])').length`), 6, "archive tabs remain available");
    await clickTab("人物认知", "丁");
    await waitFor(`${archiveManager}?.textContent.includes('归档披露记录')`);
    const archiveDisclosureView = await evaluate(`(()=>{const root=${archiveManager};return{text:root?.textContent||'',writeControls:root?.querySelectorAll('.memory4-disclosure-row button').length||0}})()`);
    assert(archiveDisclosureView.text.includes("明王") && archiveDisclosureView.text.includes("当前状态未回读"), "archive disclosure should be visible without claiming current truth");
    assert.equal(archiveDisclosureView.writeControls, 0, "archive disclosures must not expose mutation controls");
    await evaluate("document.documentElement.setAttribute('data-votc-theme','ink')");
    await setViewport(1280, 1000);
    await screenshot("ink-desktop-archive-readonly", archiveManager);
    await setViewport(540, 900);
    await screenshot("ink-narrow-archive-readonly", archiveManager);
    await setViewport(1280, 1000);
    const refreshed = await evaluate(`(()=>{const button=${archiveManager}.querySelector('[aria-label="刷新人物记忆"]');button?.click();return !!button})()`);
    assert(refreshed, "archive refresh button exists");
    await waitFor(`${archiveManager}?.querySelector('[aria-label="刷新人物记忆"]')?.disabled===false`);
    await clickTab("年度记忆", "丁");
    const yearWrites = await evaluate(`${archiveManager}?[...${archiveManager}.querySelectorAll('button')].filter(button=>['从长期记忆生成年度与人生记忆','从 Detail 重新生成','从来源重新生成','重新生成并覆盖','保留手工版本'].includes(button.textContent.trim())).map(button=>({label:button.textContent.trim(),disabled:button.disabled})):[]`);
    assert(yearWrites.length > 0 && yearWrites.every(button => button.disabled), "archive year mutations must be disabled");
    await clickTab("人生记忆", "丁");
    const lifeWrites = await evaluate(`${archiveManager}?[...${archiveManager}.querySelectorAll('button')].filter(button=>['从年度记忆生成人生记忆','重新生成当前阶段','编辑','停止任务'].includes(button.textContent.trim())).map(button=>({label:button.textContent.trim(),disabled:button.disabled})):[]`);
    assert(lifeWrites.length > 0 && lifeWrites.every(button => button.disabled), "archive life mutations must be disabled");
    await clickTab("详细长期记忆", "丁");
    await waitFor(`${archiveManager}?.querySelector('.memory4-detail summary')`);
    await evaluate(`(()=>{${archiveManager}?.querySelector('.memory4-detail summary')?.click()})()`);
    await waitFor(`${archiveManager}?.querySelector('.memory4-detail[open] .memory4-text')`);
    const detailWrites = await evaluate(`${archiveManager}?[...${archiveManager}.querySelectorAll('button')].filter(button=>['编辑','删除'].includes(button.textContent.trim())).map(button=>({label:button.textContent.trim(),disabled:button.disabled})):[]`);
    assert(detailWrites.length >= 2 && detailWrites.every(button => button.disabled), "archive detail edit/delete must be disabled");
    const sourceEnabled = await evaluate(`${archiveManager}&&[...${archiveManager}.querySelectorAll('button')].some(button=>button.textContent.trim()==='查看来源'&&!button.disabled)`);
    assert(sourceEnabled, "archive source lookup remains available");
    const managerBreakpointAfterDetach = await main.send("Debugger.setBreakpointByUrl", { urlRegex: "conversation-manager\\.js$", lineNumber: managerLineNumber });
    const endedArchiveRequest = evaluate(`conversationAPI.getMemory4OwnerData({ownerId:${fixture.archive.ownerId},expectedCampaignToken:${JSON.stringify(fixture.archive.campaignToken)},expectedContextId:'isolated-ui-conversation'})`);
    const detachPaused = await main.wait("Debugger.paused");
    const detachedStateResult = await main.send("Debugger.evaluateOnCallFrame", { callFrameId: detachPaused.callFrames[0].callFrameId,
      expression: "this.lastMemory4ReadContext=this.createMemory4ReadSnapshot(globalThis.__m4SmokeConversation);this.currentConversation=null;JSON.stringify({strictCurrentIsNull:this.getCurrentConversation()===null,snapshotInactive:this.lastMemory4ReadContext?.isActive===false})", returnByValue: true });
    assert(!detachedStateResult.exceptionDetails, JSON.stringify(detachedStateResult.exceptionDetails));
    const detachedState = JSON.parse(detachedStateResult.result.value);
    assert.deepStrictEqual(detachedState, { strictCurrentIsNull: true, snapshotInactive: true }, "detached snapshot must remain separate from strict current conversation");
    await main.send("Debugger.removeBreakpoint", { breakpointId: managerBreakpointAfterDetach.breakpointId });
    await main.send("Debugger.resume");
    const endedArchiveData = await endedArchiveRequest;
    assert.equal(endedArchiveData.success, true, JSON.stringify(endedArchiveData));
    assert.equal(endedArchiveData.readOnlyArchive, true);
    assert.equal(endedArchiveData.readOnlyReason, "conversation_ended");
    const refreshedAfterDetach = await evaluate(`(()=>{const button=${archiveManager}?.querySelector('[aria-label="刷新人物记忆"]');button?.click();return !!button&&!button.disabled})()`);
    assert(refreshedAfterDetach, "detached archive refresh remains available");
    await waitFor(`${archiveManager}?.querySelector('.memory4-archive-notice')?.textContent.includes('已结束对话所属战役')`);
    await waitFor(`${archiveManager}?.querySelector('.memory4-detail summary')`);
    await evaluate(`(()=>{${archiveManager}?.querySelector('.memory4-detail summary')?.click()})()`);
    await waitFor(`${archiveManager}?.querySelector('.memory4-detail[open] .memory4-text')`);
    const endedDetailWrites = await evaluate(`${archiveManager}?[...${archiveManager}.querySelectorAll('button')].filter(button=>['编辑','删除'].includes(button.textContent.trim())).map(button=>({label:button.textContent.trim(),disabled:button.disabled})):[]`);
    assert(endedDetailWrites.length >= 2 && endedDetailWrites.every(button => button.disabled), "ended archive detail edit/delete must remain disabled");
    assert(await evaluate(`${archiveManager}&&[...${archiveManager}.querySelectorAll('button')].some(button=>button.textContent.trim()==='查看来源'&&!button.disabled)`), "ended archive source lookup remains available");
    const archiveWritePayload = { ownerId: fixture.archive.ownerId, expectedCampaignToken: fixture.archive.campaignToken,
      expectedContextId: "isolated-ui-conversation", operation: "updateDetail", entryId: archiveData.detail.items[0].entryId,
      text: "ARCHIVE_WRITE_MUST_BE_REJECTED", expectedRevision: archiveData.detail.items[0].revision };
    const archiveWriteRequest = await evaluate(`(async()=>{try{return await conversationAPI.mutateMemory4(${JSON.stringify(archiveWritePayload)})}catch(error){return {success:false,error:String(error?.message||error)}}})()`);
    assert.equal(archiveWriteRequest.success, false, "strict mutation gate must reject writes after manager detach");
    await clickButton("查看来源", "丁");
    await waitFor(`${archiveManager}?.querySelector('.memory4-source')`);
    await screenshot("ink-desktop-archive-source", archiveManager);
    const archiveHashAfter = hashDirectory(fixture.archive.directory);
    assert.equal(archiveHashAfter, archiveHashBefore, "archive read/source/rejected mutation must not change persisted sidecar");
    await evaluate("document.querySelector('[aria-label=关闭来源]').click()");
    await clickTab("Legacy 对话摘要", "丁");
    await evaluate(`(()=>{${archiveManager}.querySelector('.character-header').click()})()`);
    await waitFor(`${archiveManager}?.querySelector('.summary-item')`);
    const legacyButtons = await evaluate(`${archiveManager}?[...${archiveManager}.querySelectorAll('.summary-actions button')].map(button=>({label:button.textContent.trim(),disabled:button.disabled})):[]`);
    await screenshot("ink-desktop-ended-legacy-editable", archiveManager);
    assert(legacyButtons.some(button => ["编辑", "Edit"].includes(button.label) && !button.disabled), `ordinary Legacy edit must remain available after conversation detach: ${JSON.stringify(legacyButtons)}`);
    assert(legacyButtons.some(button => ["删除", "Delete"].includes(button.label) && !button.disabled), "ordinary Legacy delete must remain available after conversation detach");
    await evaluate(`(()=>{[...${archiveManager}.querySelectorAll('.summary-actions button')].find(button=>['编辑','Edit'].includes(button.textContent.trim())).click()})()`);
    await waitFor("!!document.querySelector('.summary-edit-modal textarea')");
    await screenshot("ink-desktop-ended-legacy-edit-dialog", "document.querySelector('.summary-edit-modal')");
    const editedLegacyText = "丁保留与甲交谈的旧摘要；隔离窗口手工编辑保存成功。";
    await evaluate(`(()=>{const e=document.querySelector('.summary-edit-modal textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(editedLegacyText)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate("(()=>{[...document.querySelectorAll('.summary-edit-modal button')].find(button=>['保存','Save'].includes(button.textContent.trim())).click()})()");
    await waitFor("!document.querySelector('.summary-edit-modal')");
    const editedLegacy = JSON.parse(fs.readFileSync(path.join(fixture.summariesDir, "4_丁", "与甲的对话.json"), "utf8"));
    assert.equal(editedLegacy[0].content, editedLegacyText, "ordinary Legacy edit must persist through real preload/IPC while detached");
    assert.equal(await main.evaluate("globalThis.__m4ProviderCalls"), 0, "archive UI and source lookup must not call a model");
    assert.equal(await main.evaluate("globalThis.__m4ProviderCalls"), 0, "packaged UI smoke must not call a model");
    const blockedFetchUrls = await main.evaluate("globalThis.__m4BlockedFetches");
    assert(blockedFetchUrls.every(url => url === "http://127.0.0.1:4315/v1/health"), `unexpected network request was blocked: ${JSON.stringify(blockedFetchUrls)}`);
    assert.deepStrictEqual(errors, [], "renderer/main exceptions");
    assert.equal(screenshots.length, 40, "original 38 screens and two direct observation screens");
    fs.writeFileSync(path.join(evidence, "result.json"), JSON.stringify({ passed: true, themes: ["parchment", "knight", "ink"], desktop: [1280, 1000], narrow: [540, 900], baseScreenshotCount: 27,
      disclosureScreenshotCount: 4,
      archiveScreenshotCount: 3, legacyEditScreenshotCount: 2, ageDisclosureScreenshotCount: 2, directObservationScreenshotCount: 2, screenshotCount: screenshots.length, screenshots, providerRequests: 0, blockedNetworkFetches: blockedFetchUrls.length,
      blockedNetworkUrls: blockedFetchUrls, realCK3Gate: false, profile,
      archive: { ownerId: fixture.archive.ownerId, campaignToken: fixture.archive.campaignToken, readOnlyReasons: [archiveData.readOnlyReason, endedArchiveData.readOnlyReason],
        strictCurrentIsNullAfterDetach: detachedState.strictCurrentIsNull, sidecarHashBefore: archiveHashBefore, sidecarHashAfter: archiveHashAfter, rejectedWriteError: archiveWriteRequest.error || null },
      checks: ["missing Campaign", "wrong Campaign", "strict owner data", "orphan audit real IPC read-only", "orphan forget requires explicit confirmation", "confirmed orphan forget through real preload/IPC", "six views", "readonly Official", "disclosure source/date/nickname", "manual disclosure write", "disclosure hide cancellation", "archive disclosure readonly", "source modal", "manual conflict preservation", "manual edit", "delete cancellation",
        "accepted Detail deletion", "existing binding preview cancellation", "nonoverlapping tool buttons", "no horizontal overflow", "same-campaign archive outside loaded roster", "loaded-campaign readonly banner",
        "archive refresh/tabs/source remain available", "archive year/life/detail mutation controls disabled", "manager detach leaves strict current null and read snapshot available",
        "archive IPC mutation rejected after manager detach", "archive sidecar hash unchanged", "ended-conversation banner, detail and source remain available", "ordinary Legacy edit/delete enabled after detach", "ordinary Legacy manual edit persisted through real preload/IPC after detach", "three-person listener Q&A persisted and reloaded through real preload/IPC: current CK3 age 14, historical age 13 and source date retained without mutation controls",
        "all main-process fetch blocked before I/O; only fixed localhost health check may be attempted"] }, null, 2));
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
