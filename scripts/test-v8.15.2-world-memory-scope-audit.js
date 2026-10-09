"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildRuntimeNameIndex } = require("../resources/app/out/main/worldline/runtime-name-index");
const { CanonService } = require("../resources/app/out/main/worldline/canon-service");
const { BranchRegistry } = require("../resources/app/out/main/worldline/branch-registry");
const { normalizeCanonPayload } = require("../resources/app/out/main/worldline/canon-contract");
const { readLiveProbe, WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

function createRenderer(WorldMemoryEditor) {
  const state = [];
  const refs = [];
  const effects = new Set();
  let cursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return refs[index] ||= { current: initial }; },
    useEffect(callback) { const index = cursor++; if (!effects.has(index)) { effects.add(index); callback(); } }
  };
  return { render() { cursor = 0; return WorldMemoryEditor({ react }); } };
}

function findNodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => findNodes(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...findNodes(node.children || [], predicate)];
}

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? textOf(node.children || []) : "";
}

function findControl(tree, labelText, controlType) {
  const label = findNodes(tree, node => node.type === "label" && textOf(node).includes(labelText))[0];
  assert(label, `missing field label: ${labelText}`);
  const control = findNodes(label, node => node.type === controlType)[0];
  assert(control, `missing ${controlType} for ${labelText}`);
  return control;
}

function makeService({ checkpointPlayerId, checkpointDate, runtimePlayerId, runtimeDate, runtimeCharacters }) {
  const snapshot = {
    playerId: checkpointPlayerId,
    gameDate: checkpointDate,
    characters: {
      "1": { firstName: "Checkpoint Given Name", alive: true },
      "2": { firstName: "Live Given Name", alive: true }
    },
    nameToCharacterIds: { "Checkpoint Given Name": ["1"], "Live Given Name": ["2"] }
  };
  const runtimeNames = { playerId: runtimePlayerId, gameDate: runtimeDate, characters: runtimeCharacters };
  snapshot.indexes = buildRuntimeNameIndex(snapshot, { live: runtimeNames });
  const service = Object.create(WorldlineService.prototype);
  service.currentCheckpoint = { id: "synthetic-checkpoint", snapshot };
  service.getRuntimeNames = () => runtimeNames;
  service.getLiveState = () => ({ playerId: runtimePlayerId, gameDate: runtimeDate, characters: runtimeCharacters.map(character => ({ runtimeId: character.id })) });
  return service;
}

function testCanonicalFullNameSearchAndCurrentPlayer() {
  const aligned = makeService({
    checkpointPlayerId: "1",
    checkpointDate: "1172.2.3",
    runtimePlayerId: "1",
    runtimeDate: "1172/2/3",
    runtimeCharacters: [
      { id: "1", firstName: "Checkpoint Given Name", fullName: "Synthetic Checkpoint Fullname" },
      { id: "2", firstName: "Live Given Name", fullName: "Synthetic Live NPC" }
    ]
  });
  const exact = aligned.listCanonCharacterOptions({ query: "Synthetic Checkpoint Fullname" });
  assert.equal(exact.total, 1, "verified full-name alias should find the matching runtime character");
  assert.equal(exact.options[0].runtimeId, "1");
  assert.equal(exact.currentPlayer?.runtimeId, "1", "the API returns the current player option separately");

  const mismatched = makeService({
    checkpointPlayerId: "1",
    checkpointDate: "1172.2.3",
    runtimePlayerId: "2",
    runtimeDate: "1172.2.4",
    runtimeCharacters: [
      { id: "1", firstName: "Checkpoint Given Name", fullName: "Synthetic Checkpoint Fullname" },
      { id: "2", firstName: "Live Given Name", fullName: "Synthetic Live Player Fullname" }
    ]
  });
  const staleAlias = mismatched.listCanonCharacterOptions({ query: "Synthetic Checkpoint Fullname" });
  assert.equal(staleAlias.total, 0, "a full name from a different live player/date scope must not attach to checkpoint characters");
  const current = mismatched.listCanonCharacterOptions({});
  assert.equal(current.currentPlayer?.runtimeId, "1", "the picker never silently switches the bound checkpoint player to a mismatched live player");
  assert.equal(current.currentPlayer?.displayName, "Checkpoint Given Name");
}

function testCurrentDateFormatsAndFailClosedValidation() {
  for (const gameDate of ["1172.2.3", "1172/2/3", "1172-2-3", "1172年2月3日"]) {
    const normalized = normalizeCanonPayload({ title: "Synthetic date", content: "A synthetic past event.", temporalMode: "CURRENT_DATE" }, { gameDate });
    assert.equal(normalized.gameDate, "1172.2.3", `CURRENT_DATE should canonicalize ${gameDate}`);
  }
  assert.throws(
    () => normalizeCanonPayload({ title: "Synthetic date", content: "A synthetic past event.", temporalMode: "CURRENT_DATE" }, { gameDate: "August 24, 1172" }),
    error => error.message === "supplemental_current_date_invalid",
    "an invalid nonempty live date must fail rather than borrow another date"
  );
}

async function testLiveInitFormatsFeedCanonCurrentDate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8152-live-init-canon-"));
  const logPath = path.join(root, "debug.log");
  const canonicalRoot = path.join(root, "canon");
  const checkpoint = {
    id: "synthetic-init-checkpoint",
    source: { path: "C:\\Synthetic\\fixture.ck3", fingerprint: "a".repeat(64) },
    snapshot: {
      playthroughId: "synthetic-init-campaign",
      gameDate: "1086.1.1",
      characters: { "1": { firstName: "Synthetic Player", alive: true } }
    }
  };
  const probe = () => readLiveProbe({ fs, debugLogPath: logPath });
  const canon = new CanonService({ root: canonicalRoot, getCheckpoint: () => checkpoint, getLiveState: probe });
  const initLine = (date, trailingField = null, totalDays = "396511") => {
    const fields = ["VOTC:IN", "init", "1", "Synthetic Player", "2", "TITLE会长，赵子绅", date, "talk_scene_court", "汴京12号", "Synthetic Player", String(totalDays)];
    if (trailingField !== null) fields.push(trailingField);
    return fields.join("/;/");
  };
  const richDateLine = (totalDays, date) => ["VOTC:DATE", String(totalDays), date].join("/;/");
  const numericDateLine = totalDays => ["VOTC:DATE", String(totalDays)].join("/;/");
  const saveCurrentDate = async (lines, date, expectedCanonicalDate, expectedTotalDays, title) => {
    fs.writeFileSync(logPath, lines.join("\n") + "\n", "utf8");
    const init = lines.find(line => line.startsWith("VOTC:IN/;/init/;/"));
    if (init) assert([9, 10].includes(init.split("/;/").slice(2).length), "fixture must contain the actual 9/10-field init payload after the marker/type prefix");
    const live = probe();
    assert.equal(live.connected, true);
    assert.equal(live.gameDate, date, "the latest complete live marker must provide the date, not title or location text");
    assert.equal(live.totalDays, expectedTotalDays, "the live probe must read day count from the date/init marker, not the year or location digits");
    const page = await canon.list();
    assert(page.branch?.branchId && page.branch?.token, `synthetic Canon branch must be writable: ${JSON.stringify(page.branch)}`);
    const saved = await canon.mutate({
      token: page.branch.token,
      operation: "create",
      payload: { title, content: "Synthetic Canon current-date event.", type: "PLAYER_CANON", visibility: "PUBLIC_WORLD", importance: "NORMAL", entities: ["1"], temporalMode: "CURRENT_DATE" }
    });
    assert.equal(saved.gameDate, expectedCanonicalDate, "Canon CURRENT_DATE must persist the parsed latest live marker date");
    assert.equal(saved.totalDays, expectedTotalDays);
    const persisted = (await canon.list()).records.find(record => record.title === title);
    assert(persisted, "the real Canon worker must persist the CURRENT_DATE record");
    assert.equal(persisted.gameDate, expectedCanonicalDate);
    assert.equal(persisted.totalDays, expectedTotalDays);
  };

  try {
    await saveCurrentDate([initLine("1086年5月1日")], "1086年5月1日", "1086.5.1", 396511, "Synthetic 9-field init date");
    await saveCurrentDate([initLine("1086.5.1", "optional-tail")], "1086.5.1", "1086.5.1", 396511, "Synthetic 10-field init date");

    await saveCurrentDate([initLine("1086年5月1日"), numericDateLine(396512)], "1086年5月1日", "1086.5.1", 396511, "Synthetic numeric-only DATE ignored");
    await saveCurrentDate([initLine("1086年5月1日"), richDateLine(396512, "1086年5月2日")], "1086年5月2日", "1086.5.2", 396512, "Synthetic rich DATE after init");
    await saveCurrentDate([initLine("1086年5月1日"), richDateLine(396512, "1086年5月2日"), initLine("1086年5月3日", null, 396513)], "1086年5月3日", "1086.5.3", 396513, "Synthetic later init after rich DATE");

    const invalidDate = "1086年2月30日";
    fs.writeFileSync(logPath, [initLine("1086年5月1日"), richDateLine(396514, invalidDate)].join("\n") + "\n", "utf8");
    assert.equal(probe().gameDate, invalidDate, "a malformed nonempty rich DATE must remain distinguishable from a missing live date");
    const invalidPage = await canon.list();
    await assert.rejects(canon.mutate({
      token: invalidPage.branch.token,
      operation: "create",
      payload: { title: "Synthetic invalid rich DATE", content: "This record must not persist.", type: "PLAYER_CANON", visibility: "PUBLIC_WORLD", importance: "NORMAL", entities: ["1"], temporalMode: "CURRENT_DATE" }
    }), error => error.message === "supplemental_current_date_invalid");
    assert.equal((await canon.list()).records.some(record => record.title === "Synthetic invalid rich DATE"), false);

    fs.writeFileSync(logPath, [
      initLine("1086年5月1日"),
      richDateLine(396512, "1086年5月2日"),
      "VOTC:LOAD_SESSION/;/synthetic-load-session-123456",
      numericDateLine(396515)
    ].join("\n") + "\n", "utf8");
    const afterLoad = probe();
    assert(afterLoad.loadSessionId, "LOAD_SESSION should remain observable after filtering old game markers");
    assert.equal(afterLoad.connected, false, "a prior session init must not make the new load look live before a fresh init");
    assert.equal(afterLoad.gameDate, null, "a new LOAD_SESSION must fence off older init dates");
    assert.equal(afterLoad.totalDays, null, "a new LOAD_SESSION must fence off older init day counts");

    fs.appendFileSync(logPath, richDateLine(396513, "1086年5月3日") + "\n", "utf8");
    const freshAfterLoad = probe();
    assert.equal(freshAfterLoad.connected, true);
    assert.equal(freshAfterLoad.gameDate, "1086年5月3日", "a post-load rich DATE may establish the new session date");
    assert.equal(freshAfterLoad.totalDays, 396513);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testLoadBoundaryDateWaitAndBranchIdentity() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8152-load-date-boundary-"));
  const logPath = path.join(root, "debug.log");
  const checkpoint = {
    id: "synthetic-load-boundary-checkpoint",
    source: { path: "C:\\Synthetic\\same-checkpoint.ck3", fingerprint: "b".repeat(64) },
    snapshot: {
      playthroughId: "synthetic-load-boundary-campaign",
      gameDate: "1086.5.1",
      totalDays: 396511,
      characters: { "1": { firstName: "Synthetic Player", alive: true } }
    }
  };
  const probe = () => readLiveProbe({ fs, debugLogPath: logPath });
  const canon = new CanonService({ root: path.join(root, "canon"), getCheckpoint: () => checkpoint, getLiveState: probe });
  const loadLine = token => `VOTC:LOAD_SESSION/;/${token}`;
  const richDateLine = (totalDays, date) => ["VOTC:DATE", String(totalDays), date].join("/;/");
  const currentDatePayload = title => ({ title, content: "A synthetic event on the current date.", type: "PLAYER_CANON", visibility: "PUBLIC_WORLD", importance: "NORMAL", entities: ["1"], temporalMode: "CURRENT_DATE" });

  try {
    fs.writeFileSync(logPath, [loadLine("synthetic-session-111111"), richDateLine(396511, "1086年5月1日")].join("\n") + "\n", "utf8");
    const originalPage = await canon.list();
    assert.equal(originalPage.defaultGameDate, "1086年5月1日");
    assert.equal(originalPage.branch.state, "NEW_CAMPAIGN");

    fs.writeFileSync(logPath, [
      loadLine("synthetic-session-111111"),
      richDateLine(396511, "1086年5月1日"),
      loadLine("synthetic-session-222222"),
      "VOTC:DATE/;/396512"
    ].join("\n") + "\n", "utf8");
    const waitingPage = await canon.list();
    assert.equal(probe().gameDate, null, "a numeric-only marker after LOAD must not establish Worldline CURRENT_DATE");
    assert.equal(waitingPage.defaultGameDate, null, "a new LOAD without a fresh calendar marker must not display the old checkpoint date as current");
    assert.equal(waitingPage.branch.state, "LOAD_BOUNDARY_CANDIDATE");
    assert.equal(waitingPage.branch.reason, "load_session_changed");
    await assert.rejects(canon.mutate({ token: waitingPage.branch.token, operation: "create", payload: currentDatePayload("Current date before branch confirmation") }), error => error.message === "supplemental_current_date_unavailable");
    assert.equal((await canon.list()).records.some(record => record.title === "Current date before branch confirmation"), false, "the real Canon worker must not persist a stale-checkpoint CURRENT_DATE record");

    await canon.confirm(waitingPage.branch.token);
    const confirmedPage = await canon.list();
    assert.equal(confirmedPage.branch.reason, null, "explicit continuation authorizes the branch without inventing a live date");
    assert.equal(confirmedPage.defaultGameDate, null, "branch confirmation does not restore the stale checkpoint date");
    await assert.rejects(canon.mutate({ token: confirmedPage.branch.token, operation: "create", payload: currentDatePayload("Current date while waiting for marker") }), error => error.message === "supplemental_current_date_unavailable");
    assert.equal((await canon.list()).records.some(record => record.title === "Current date while waiting for marker"), false, "confirmation alone cannot authorize a missing current date");

    const specificDate = await canon.mutate({
      token: confirmedPage.branch.token,
      operation: "create",
      payload: { ...currentDatePayload("Explicit date while waiting for marker"), temporalMode: "SPECIFIC_DATE", gameDate: "1086.5.2" }
    });
    assert.equal(specificDate.gameDate, "1086.5.2", "an explicitly dated record remains available after branch authorization");

    fs.appendFileSync(logPath, richDateLine(396512, "1086年5月2日") + "\n", "utf8");
    const freshPage = await canon.list();
    assert.equal(freshPage.defaultGameDate, "1086年5月2日", "a fresh post-LOAD calendar marker restores the current date");
    const freshDateRecord = await canon.mutate({ token: freshPage.branch.token, operation: "create", payload: currentDatePayload("Current date after fresh marker") });
    assert.equal(freshDateRecord.gameDate, "1086.5.2");
    assert.equal(freshDateRecord.totalDays, 396512);
    const persisted = (await canon.list()).records;
    assert(persisted.some(record => record.title === "Explicit date while waiting for marker"), "the specific-date record should be persisted by the real Canon worker");
    assert(persisted.some(record => record.title === "Current date after fresh marker"), "the fresh-date record should be persisted by the real Canon worker");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8152-same-checkpoint-load-"));
  try {
    const registry = new BranchRegistry({ root: registryRoot });
    const base = { campaignToken: "same-checkpoint-campaign", sourcePath: "C:\\Synthetic\\same-checkpoint.ck3", fingerprint: "c".repeat(64), gameDate: "1086.5.1" };
    const original = registry.observe({ ...base, loadSessionId: "synthetic-session-333333" });
    assert.equal(original.state, "NEW_CAMPAIGN");
    const changedSession = registry.observe({ ...base, loadSessionId: "synthetic-session-444444" });
    assert.equal(changedSession.state, "LOAD_BOUNDARY_CANDIDATE", "same date and fingerprint do not hide a changed load session");
    assert.equal(changedSession.reason, "load_session_changed");
    const missingSession = registry.observe({ ...base, loadSessionId: null });
    assert.equal(missingSession.state, "LOAD_BOUNDARY_CANDIDATE", "same checkpoint with a missing session marker fails closed after a marked session");
    assert.equal(missingSession.reason, "load_session_unavailable");
    const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8152-legacy-no-session-"));
    try {
      const legacy = new BranchRegistry({ root: legacyRoot });
      assert.equal(legacy.observe({ ...base, loadSessionId: null }).state, "NEW_CAMPAIGN");
      assert.equal(legacy.observe({ ...base, loadSessionId: null }).state, "SAME_BRANCH", "both-null legacy sessions preserve compatibility");
    } finally {
      fs.rmSync(legacyRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(registryRoot, { recursive: true, force: true });
  }
}

async function testSaveFailureIsAttachedToSubmitControl() {
  const previousWindow = globalThis.window;
  const page = {
    defaultGameDate: "invalid synthetic live date",
    total: 0,
    offset: 0,
    records: [],
    branch: { branchId: "synthetic-branch", token: "synthetic-token", state: "ACTIVE", gameDate: "1172.2.3", reason: null },
    promptEnabled: true
  };
  let mutationCount = 0;
  try {
    const { WorldMemoryEditor } = await import("../resources/app/out/renderer/world-memory-editor.js");
    globalThis.window = {
      localStorage: { getItem: () => null },
      worldlineAPI: {
        listCanon: async () => page,
        listSupplemental: async () => ({ supplemental: [], readOnly: true, legacyCount: 0 }),
        mutateCanon: async () => { mutationCount++; throw new Error("supplemental_current_date_invalid"); },
        onUpdated: () => () => {}
      }
    };
    const renderer = createRenderer(WorldMemoryEditor);
    let tree = renderer.render();
    await findNodes(tree, node => node.type === "button" && textOf(node) === "打开世界记忆")[0].props.onClick();
    tree = renderer.render();
    findControl(tree, "标题", "input").props.onChange({ target: { value: "Synthetic invalid live date" } });
    tree = renderer.render();
    findControl(tree, "希望世界长期记住的内容", "textarea").props.onChange({ target: { value: "Synthetic event must not persist." } });
    tree = renderer.render();
    await findNodes(tree, node => node.type === "button" && textOf(node) === "确认新增")[0].props.onClick();
    tree = renderer.render();

    assert.equal(mutationCount, 1, "the UI submits the current-date record exactly once");
    const form = findNodes(tree, node => String(node.props?.className || "").includes("world-memory-form"))[0];
    const actions = findNodes(form, node => String(node.props?.className || "").includes("world-memory-form-actions"))[0];
    const feedback = findNodes(form, node => String(node.props?.className || "").includes("world-memory-feedback is-error"))[0];
    assert(form && actions && feedback, "save action row and its local error are rendered within the form");
    assert(textOf(form).includes("无法识别当前游戏日期"), "the save failure remains with its submit control, not only at the editor header");
    assert(findNodes(actions, node => node === feedback).length === 1, "local feedback stays inside the submit action row");
    assert.equal(feedback.props.role, "alert", "the local save feedback is announced accessibly");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

async function run() {
  testCanonicalFullNameSearchAndCurrentPlayer();
  testCurrentDateFormatsAndFailClosedValidation();
  await testLiveInitFormatsFeedCanonCurrentDate();
  await testLoadBoundaryDateWaitAndBranchIdentity();
  await testSaveFailureIsAttachedToSubmitControl();
  console.log("V8.15.2 world-memory scope audit PASS");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
