"use strict";

const assert = require("node:assert/strict");
const { buildRuntimeNameIndex } = require("../resources/app/out/main/worldline/runtime-name-index");
const { normalizeCanonPayload } = require("../resources/app/out/main/worldline/canon-contract");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

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
  await testSaveFailureIsAttachedToSubmitControl();
  console.log("V8.15.2 world-memory scope audit PASS");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
