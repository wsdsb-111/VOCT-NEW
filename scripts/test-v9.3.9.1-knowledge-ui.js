"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const uiSource = fs.readFileSync(path.join(root, "src/app/renderer/character-knowledge-ui.js"), "utf8");
const bundleSource = fs.readFileSync(path.join(root, "src/app/renderer/assets/index-Dn3qWlAB.js"), "utf8");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.className = "";
    this.textContent = "";
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.value = "";
    this.disabled = false;
  }

  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }

  async dispatch(name) {
    const callback = this.listeners[name];
    if (callback) return callback({ target: this });
    return undefined;
  }
}

function descendants(node) {
  return [node, ...node.children.flatMap(descendants)];
}

function textOf(node) {
  return descendants(node).map(child => child.textContent).filter(Boolean).join(" ");
}

function byClass(host, className) {
  return descendants(host).find(node => node.className === className);
}

function byAriaLabel(host, ariaLabel) {
  return descendants(host).find(node => node.tagName === "select" && node.attributes["aria-label"] === ariaLabel);
}

function buttonByText(host, text) {
  return descendants(host).find(node => node.tagName === "button" && node.textContent === text);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message || "Timed out waiting for UI state");
}

const participants = [
  { runtimeId: "A", displayName: "安宁", isPlayer: true },
  { runtimeId: "B", displayName: "绮罗", isPlayer: false },
  { runtimeId: "C", displayName: "绮罗", isPlayer: false }
];

function makeConversation(conversationId = "conversation-1", sourceSnapshotId = "snapshot-1", currentParticipants = participants) {
  return {
    available: true,
    scope: { conversationId, campaignToken: "campaign-1", sourceSnapshotId },
    participants: currentParticipants
  };
}

function makeTargetView(scope, ownerRuntimeId, targetRuntimeId, status = "UNKNOWN") {
  const owner = participants.find(person => person.runtimeId === String(ownerRuntimeId));
  const target = participants.find(person => person.runtimeId === String(targetRuntimeId));
  return {
    available: true,
    scope: { ...scope, ownerRuntimeId: String(ownerRuntimeId), targetRuntimeId: String(targetRuntimeId) },
    owner: { runtimeId: String(ownerRuntimeId), displayName: owner?.displayName || "姓名未载入" },
    target: { runtimeId: String(targetRuntimeId), displayName: target?.displayName || "姓名未载入" },
    checkpointAsOf: "1066.1.1",
    facts: [
      { factType: "NAME", factKey: "name", value: target?.displayName || "绮罗", status: "AUTO_DISCLOSED", effectiveKnown: true, revision: 1, source: "CONVERSATION_DISCLOSURE" },
      { factType: "TITLE", factKey: "title:duke", value: "公爵", status: "AUTO_DISCLOSED", effectiveKnown: true, revision: 1, source: "CONVERSATION_DISCLOSURE" },
      { factType: "NICKNAME", factKey: "nickname_铁腕", value: "铁腕", status: "AUTO_DISCLOSED", effectiveKnown: true, currentDirectObservation: true, source: "PUBLIC_NICKNAME" },
      { factType: "TRAIT", factKey: "trait_strong", value: "强壮", status: "AUTO_DISCLOSED", effectiveKnown: true, currentDirectObservation: true, source: "IN_PERSON_OBSERVATION" },
      { factType: "TRAIT", factKey: "trait:brave", value: "勇敢", status, effectiveKnown: status === "MANUAL_KNOWN", revision: status === "UNKNOWN" ? 0 : 1,
        factSourceSnapshotId: "fact-source-1", source: status === "UNKNOWN" ? "UNDISCLOSED" : "MANUAL" }
    ]
  };
}

function createHarness({ initialView = makeConversation(), getOwnerView, getTargetView, setManualStatus } = {}) {
  let activeView = initialView;
  let conversationUpdate = null;
  let unsubscribed = false;
  const calls = { conversation: 0, owners: [], targets: [], writes: [] };
  const api = {
    getConversationView: async () => {
      calls.conversation += 1;
      return activeView;
    },
    getOwnerView: async payload => {
      calls.owners.push(payload);
      if (getOwnerView) return getOwnerView(payload, activeView);
      const owner = activeView.participants.find(person => String(person.runtimeId) === String(payload.ownerRuntimeId));
      return {
        available: true,
        scope: { ...activeView.scope, ownerRuntimeId: String(owner.runtimeId) },
        owner: { runtimeId: String(owner.runtimeId), displayName: owner.displayName },
        targets: activeView.participants.filter(person => String(person.runtimeId) !== String(owner.runtimeId))
      };
    },
    getTargetView: async payload => {
      calls.targets.push(payload);
      if (getTargetView) return getTargetView(payload, activeView);
      return makeTargetView(activeView.scope, payload.ownerRuntimeId, payload.targetRuntimeId);
    },
    setManualStatus: async payload => {
      calls.writes.push(payload);
      if (setManualStatus) return setManualStatus(payload, activeView);
      return makeTargetView(activeView.scope, payload.ownerRuntimeId, payload.targetRuntimeId, payload.status);
    }
  };
  const window = {
    characterKnowledgeAPI: api,
    conversationAPI: {
      onConversationUpdate(callback) {
        conversationUpdate = callback;
        return () => { unsubscribed = true; conversationUpdate = null; };
      }
    }
  };
  const context = {
    window,
    document: { createElement: tagName => new FakeElement(tagName) },
    setTimeout,
    clearTimeout,
    console,
    Promise,
    Error,
    String,
    Array,
    Object,
    JSON,
    Boolean,
    Set
  };
  vm.runInNewContext(uiSource, context, { filename: "character-knowledge-ui.js" });
  const host = new FakeElement("div");
  const cleanup = window.VOTCCharacterKnowledgeUi.mount(host);
  return {
    host,
    calls,
    api,
    setView(view) { activeView = view; },
    emitConversationUpdate() { conversationUpdate?.([]); },
    get unsubscribed() { return unsubscribed; },
    cleanup
  };
}

async function choose(host, ariaLabel, id, awaitChange = true) {
  const select = byAriaLabel(host, ariaLabel);
  assert.ok(select, `missing picker ${ariaLabel}`);
  assert.equal(select.disabled, false, `${ariaLabel} should be enabled`);
  select.value = id;
  const pending = select.dispatch("change");
  if (awaitChange) await pending;
}

async function testEmptyConversation() {
  const harness = createHarness({ initialView: { available: false, participants: [], reason: "character_knowledge_conversation_unavailable" } });
  await waitFor(() => textOf(harness.host).includes("当前没有活动对话"), "empty session guidance should render");
  assert.equal(byAriaLabel(harness.host, "选择谁知道"), undefined);
  assert.equal(byAriaLabel(harness.host, "选择关于谁"), undefined);
  assert.equal(harness.calls.owners.length, 0);
  assert.equal(harness.calls.targets.length, 0);
  harness.cleanup();
}

async function testIndependentDirectionsAndManualTrait() {
  let rejectNextWrite = true;
  const harness = createHarness({
    setManualStatus(payload, view) {
      if (rejectNextWrite) {
        rejectNextWrite = false;
        throw new Error("character_knowledge_revision_conflict");
      }
      return makeTargetView(view.scope, payload.ownerRuntimeId, payload.targetRuntimeId, payload.status);
    }
  });
  await waitFor(() => !!byAriaLabel(harness.host, "选择谁知道"), "participant pickers should render");
  const ownerPicker = byAriaLabel(harness.host, "选择谁知道");
  assert.equal(ownerPicker.value, "", "do not choose an owner by default");
  await choose(harness.host, "选择谁知道", "A");
  await waitFor(() => {
    const picker = byAriaLabel(harness.host, "选择关于谁");
    return picker && !picker.disabled && picker.children.some(option => option.value === "C");
  }, "owner view should expose only its in-session target choices");
  assert.equal(harness.calls.targets.length, 0, "choosing an owner must not auto-select a target");
  const targetPicker = byAriaLabel(harness.host, "选择关于谁");
  assert.deepEqual(targetPicker.children.filter(option => option.value).map(option => option.value), ["B", "C"]);
  assert.equal(targetPicker.children.find(option => option.value === "B").textContent, "绮罗");
  assert.equal(targetPicker.children.find(option => option.value === "C").textContent, "绮罗", "same-name people remain distinct by hidden runtime value");

  await choose(harness.host, "选择关于谁", "C");
  await waitFor(() => textOf(harness.host).includes("对安宁而言，关于绮罗的披露记录"), "selected directed pair should render");
  assert.equal(String(harness.calls.targets[0].ownerRuntimeId), "A");
  assert.equal(String(harness.calls.targets[0].targetRuntimeId), "C");
  assert(textOf(harness.host).includes("称号：铁腕"), "the visible-fact allowlist includes NICKNAME cards");
  assert(textOf(harness.host).includes("特质：强壮") && textOf(harness.host).includes("直接可知"), "observable traits render as intrinsic knowledge");
  assert.equal(descendants(harness.host).filter(node => node.className === "character-knowledge-toggle").length, 1,
    "only discretionary TRAIT rows receive a manual control; names, titles, nicknames and intrinsic traits stay read-only");
  const markKnown = buttonByText(harness.host, "标记已知");
  assert.ok(markKnown, "undisclosed candidate trait should have an explicit manual option");
  await markKnown.dispatch("click");
  await waitFor(() => harness.calls.writes.length === 1 && textOf(harness.host).includes("刚刚发生变化"), "revision conflicts should be shown without a success message");
  assert.equal(textOf(harness.host).includes("只影响这个方向"), false);
  await buttonByText(harness.host, "刷新本场").dispatch("click");
  await waitFor(() => !!buttonByText(harness.host, "标记已知"), "refresh should reload the selected pair after a failed save");
  await buttonByText(harness.host, "标记已知").dispatch("click");
  await waitFor(() => harness.calls.writes.length === 2 && textOf(harness.host).includes("只影响这个方向"), "manual write success should be shown after retry");
  const write = harness.calls.writes[0];
  assert.equal(write.conversationId, "conversation-1");
  assert.equal(write.campaignToken, "campaign-1");
  assert.equal(write.sourceSnapshotId, "snapshot-1");
  assert.equal(String(write.ownerRuntimeId), "A");
  assert.equal(String(write.targetRuntimeId), "C");
  assert.equal(write.factType, "TRAIT");
  assert.equal(write.status, "MANUAL_KNOWN");

  const beforeReverse = harness.calls.targets.length;
  await choose(harness.host, "选择谁知道", "C");
  await waitFor(() => {
    const picker = byAriaLabel(harness.host, "选择关于谁");
    return picker && !picker.disabled && picker.children.some(option => option.value === "A");
  }, "the reverse owner should load independently");
  assert.equal(byAriaLabel(harness.host, "选择关于谁").value, "", "reverse direction must require its own target selection");
  assert.equal(harness.calls.targets.length, beforeReverse, "A knowing C must not imply C knows A");
  await choose(harness.host, "选择关于谁", "A");
  await waitFor(() => harness.calls.targets.length === beforeReverse + 1, "reverse pair should be fetched only after its independent selection");
  assert.equal(String(harness.calls.targets.at(-1).ownerRuntimeId), "C");
  assert.equal(String(harness.calls.targets.at(-1).targetRuntimeId), "A");
  harness.cleanup();
}

async function testLateOwnerResponseAndScopeChange() {
  const ownerA = deferred();
  const delayedTarget = deferred();
  const harness = createHarness({
    getOwnerView(payload, view) {
      const owner = view.participants.find(person => String(person.runtimeId) === String(payload.ownerRuntimeId));
      const result = {
        available: true,
        scope: { ...view.scope, ownerRuntimeId: String(owner.runtimeId) },
        owner: { runtimeId: String(owner.runtimeId), displayName: owner.displayName },
        targets: view.participants.filter(person => String(person.runtimeId) !== String(owner.runtimeId))
      };
      return String(payload.ownerRuntimeId) === "A" ? ownerA.promise : Promise.resolve(result);
    },
    getTargetView(payload) {
      return delayedTarget.promise.then(() => makeTargetView(makeConversation().scope, payload.ownerRuntimeId, payload.targetRuntimeId));
    }
  });
  await waitFor(() => !!byAriaLabel(harness.host, "选择谁知道"), "pickers should render for race test");
  await choose(harness.host, "选择谁知道", "A", false);
  await waitFor(() => harness.calls.owners.length === 1, "first owner request should be pending");
  await choose(harness.host, "选择谁知道", "C");
  await waitFor(() => {
    const picker = byAriaLabel(harness.host, "选择关于谁");
    return picker && !picker.disabled && picker.children.some(option => option.value === "A");
  }, "the newer owner response should win");
  ownerA.resolve({
    available: true,
    scope: { ...makeConversation().scope, ownerRuntimeId: "A" },
    owner: { runtimeId: "A", displayName: "安宁" },
    targets: participants.filter(person => person.runtimeId !== "A")
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(byAriaLabel(harness.host, "选择谁知道").value, "C", "late owner response must not replace the current selection");

  await choose(harness.host, "选择关于谁", "A", false);
  await waitFor(() => harness.calls.targets.length === 1, "target request should be pending");
  harness.setView(makeConversation("conversation-1", "snapshot-2", participants));
  harness.emitConversationUpdate();
  harness.emitConversationUpdate();
  harness.emitConversationUpdate();
  await waitFor(() => harness.calls.conversation === 2, "conversation updates should debounce into a scope check");
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(harness.calls.conversation, 2, "burst events should produce one scope read");
  assert.equal(byAriaLabel(harness.host, "选择谁知道").value, "", "a new source snapshot must clear prior selections");
  assert.equal(textOf(harness.host).includes("勇敢"), false, "old pair facts must disappear when the conversation/snapshot changes");
  delayedTarget.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(textOf(harness.host).includes("勇敢"), false, "late old-session target response must be discarded");

  harness.setView(makeConversation("conversation-2", "snapshot-3", participants.slice(0, 2)));
  harness.emitConversationUpdate();
  await waitFor(() => harness.calls.conversation === 3, "new conversation should trigger another scope check");
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(byAriaLabel(harness.host, "选择谁知道").value, "", "a new conversation must also start with no selected pair");
  harness.cleanup();
}

async function testManagerMountPoint() {
  const managerStart = bundleSource.indexOf("const SummariesManager = () => {");
  assert.notEqual(managerStart, -1, "SummariesManager should be present in renderer bundle");
  const managerEnd = bundleSource.indexOf("const SummarySettings", managerStart);
  const manager = bundleSource.slice(managerStart, managerEnd === -1 ? managerStart + 100000 : managerEnd);
  const mount = manager.indexOf("jsxRuntimeExports.jsx(CharacterKnowledgeUiMount, {})");
  const emptyList = manager.indexOf("summaryGroups.length === 0 ?");
  assert.ok(mount >= 0 && mount < emptyList, "knowledge panel should mount at manager level before the empty/list branch");
  assert.equal((bundleSource.match(/CharacterKnowledgeUiMount/g) || []).length, 2,
    "the component should have one definition and one manager-level mount, with no owner-group mount");
  assert.match(bundleSource, /return mount\(hostRef\.current\);\s*\}, \[\]\);/,
    "the manager-level mount should not depend on summary owner props");
}

async function testNewDisclosureRefreshesSelectedPair() {
  let disclosed = false;
  const harness = createHarness({ getTargetView(payload, view) {
    return makeTargetView(view.scope, payload.ownerRuntimeId, payload.targetRuntimeId, disclosed ? "MANUAL_KNOWN" : "UNKNOWN");
  } });
  await waitFor(() => !!byAriaLabel(harness.host, "选择谁知道"), "conversation should load");
  await choose(harness.host, "选择谁知道", "A");
  await choose(harness.host, "选择关于谁", "C");
  assert(buttonByText(harness.host, "标记已知"));
  const reads = harness.calls.targets.length;
  disclosed = true;
  harness.emitConversationUpdate();
  await waitFor(() => harness.calls.targets.length > reads && textOf(harness.host).includes("人工标记已知"),
    "same-scene dialogue updates must refresh the selected pair's newly recorded facts");
  assert.equal(byAriaLabel(harness.host, "选择谁知道").value, "A");
  assert.equal(byAriaLabel(harness.host, "选择关于谁").value, "C");
  harness.cleanup();
}

async function main() {
  await testEmptyConversation();
  await testIndependentDirectionsAndManualTrait();
  await testLateOwnerResponseAndScopeChange();
  await testManagerMountPoint();
  await testNewDisclosureRefreshesSelectedPair();
  console.log("V9.3.9.1 Character Knowledge UI checks passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
