"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const i18next = require("../resources/app/node_modules/i18next");
const pairUi = require("../src/app/renderer/pair-long-term-ui.js");

const root = path.resolve(__dirname, "..");
const knowledgeSource = fs.readFileSync(path.join(root, "src/app/renderer/character-knowledge-ui.js"), "utf8");

class MiniElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = "";
    this.value = "";
    this.placeholder = "";
    this.type = "";
    this.disabled = false;
    this.selected = false;
    this.checked = false;
    this.scrollTop = 0;
    this._textContent = "";
    this._open = false;
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/u).filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/u).filter(name => name && !names.includes(name)).join(" "); },
      contains: name => this.className.split(/\s+/u).includes(name)
    };
  }

  get textContent() { return this._textContent + this.children.map(child => child.textContent || "").join(""); }
  set textContent(value) { this._textContent = String(value ?? ""); this.replaceChildren(); }
  get open() { return this._open; }
  set open(value) { this._open = !!value; if (this._open) this.attributes.set("open", ""); else this.attributes.delete("open"); }

  append(...nodes) {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      node.parentElement = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  hasAttribute(name) { return this.attributes.has(String(name)); }
  removeAttribute(name) { this.attributes.delete(String(name)); }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    const results = [...(this.listeners.get(type) || [])].map(listener => listener.call(this, event));
    await Promise.all(results);
    return event;
  }

  focus() { this.ownerDocument.activeElement = this; }

  querySelectorAll(selector) {
    const selectors = selector.split(",").map(value => value.trim().toLowerCase());
    const matches = node => selectors.some(part => {
      if (part === "*") return true;
      if (part.startsWith("[")) return node.hasAttribute(part.slice(1, -1));
      if (part.includes("[")) return node.tagName.toLowerCase() === part.slice(0, part.indexOf("[")).trim();
      return node.tagName.toLowerCase() === part;
    });
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (matches(child)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

class MiniDocument {
  constructor() { this.activeElement = null; }
  createElement(tagName) { return new MiniElement(tagName, this); }
}

function allElements(host) {
  return [host, ...host.querySelectorAll("*")];
}

function findByClass(host, className) {
  return allElements(host).find(node => node.className.split(/\s+/u).includes(className));
}

function findSelect(host, ariaLabel) {
  return host.querySelectorAll("select").find(node => node.getAttribute("aria-label") === ariaLabel);
}

function waitFor(predicate, message) {
  const deadline = Date.now() + 1500;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() >= deadline) return reject(new Error(message));
      setTimeout(check, 5);
    };
    check();
  });
}

async function createTranslators() {
  const moduleUrl = pathToFileURL(path.join(root, "src/app/renderer/v95/i18n/index.js")).href;
  const { createUiTranslator } = await import(moduleUrl);
  const instance = i18next.createInstance();
  await instance.init({ lng: "en-US", fallbackLng: "zh-CN", initImmediate: false, interpolation: { escapeValue: false } });
  return {
    en: createUiTranslator(instance, "en-US"),
    zh: createUiTranslator(instance, "zh-CN")
  };
}

async function testCharacterKnowledgeLanguageUpdates(translators) {
  const calls = { conversation: 0, owner: 0, target: 0, write: 0 };
  const scope = { conversationId: "conversation-42", campaignToken: "campaign-9", sourceSnapshotId: "snapshot-6" };
  const people = [
    { runtimeId: "owner-1", displayName: "Edda Vane", isPlayer: true },
    { runtimeId: "subject-2", displayName: "Mara Venn", isPlayer: false }
  ];
  const api = {
    async getConversationView() {
      calls.conversation += 1;
      return { available: true, scope, participants: people };
    },
    async getOwnerView(payload) {
      calls.owner += 1;
      return {
        available: true,
        scope: { ...scope, ownerRuntimeId: payload.ownerRuntimeId },
        owner: people[0],
        targets: [people[1]]
      };
    },
    async getTargetView(payload) {
      calls.target += 1;
      return {
        available: true,
        scope: { ...scope, ownerRuntimeId: payload.ownerRuntimeId, targetRuntimeId: payload.targetRuntimeId },
        owner: people[0],
        target: people[1],
        checkpointAsOf: "1090.01.02",
        facts: [{ factType: "NAME", factKey: "name", value: "Mara Venn", status: "AUTO_DISCLOSED", effectiveKnown: true, revision: 2, source: "CONVERSATION_DISCLOSURE" }]
      };
    },
    async setManualStatus() { calls.write += 1; throw new Error("unexpected write"); }
  };
  const document = new MiniDocument();
  const window = {
    characterKnowledgeAPI: api,
    conversationAPI: { onConversationUpdate: () => () => {} }
  };
  const context = { window, document, setTimeout, clearTimeout, console };
  vm.runInNewContext(knowledgeSource, context, { filename: "character-knowledge-ui.js" });
  const host = document.createElement("div");
  const cleanup = window.VOTCCharacterKnowledgeUi.mount(host, { t: translators.en });

  try {
    await waitFor(() => !!findSelect(host, "Choose who knows"), "English character pickers should render");
    const owner = findSelect(host, "Choose who knows");
    owner.value = "owner-1";
    await owner.dispatch("change");
    let target = findSelect(host, "Choose whom the disclosure concerns");
    assert.ok(target, "English target picker should render after choosing its owner");
    target.value = "subject-2";
    await target.dispatch("change");
    await waitFor(() => host.textContent.includes("Original conversation disclosure"), "English facts and source label should render");

    assert.ok(host.textContent.includes("Character knowledge · Current conversation"));
    assert.ok(host.textContent.includes("Mara Venn"), "factual person name must remain source text");
    assert.ok(host.textContent.includes("Records through: 1090.01.02"), "factual date must remain unchanged");
    target = findSelect(host, "Choose whom the disclosure concerns");
    target.focus();
    const before = { ...calls };

    cleanup.updateLanguage(translators.zh);
    assert.ok(host.textContent.includes("人物认知 · 当前对话"));
    assert.ok(host.textContent.includes("原始对话披露记录"));
    assert.ok(host.textContent.includes("Mara Venn"));
    assert.ok(host.textContent.includes("记录截至：1090.01.02"));
    assert.equal(findSelect(host, "选择谁知道").value, "owner-1");
    const zhTarget = findSelect(host, "选择关于谁");
    assert.equal(zhTarget.value, "subject-2");
    assert.equal(document.activeElement, zhTarget, "focused picker should remain focused after rerender");

    cleanup.updateLanguage(translators.en);
    assert.ok(host.textContent.includes("Character knowledge · Current conversation"));
    assert.ok(host.textContent.includes("Original conversation disclosure"));
    assert.equal(findSelect(host, "Choose who knows").value, "owner-1");
    assert.equal(document.activeElement, findSelect(host, "Choose whom the disclosure concerns"));
    assert.deepEqual(calls, before, "language updates must not repeat conversation or fact IPCs or write data");
  } finally {
    cleanup();
  }
}

async function testCharacterUnknownErrorIsSafe(translators) {
  const secret = "C:\\private\\api-token.json";
  const calls = { conversation: 0, owner: 0, target: 0 };
  const scope = { conversationId: "conversation-error", campaignToken: "campaign-9", sourceSnapshotId: "snapshot-7" };
  const people = [{ runtimeId: "owner", displayName: "Edda" }, { runtimeId: "target", displayName: "Mara" }];
  const document = new MiniDocument();
  const window = {
    characterKnowledgeAPI: {
      async getConversationView() { calls.conversation += 1; return { available: true, scope, participants: people }; },
      async getOwnerView(payload) { calls.owner += 1; return { available: true, scope: { ...scope, ownerRuntimeId: payload.ownerRuntimeId }, owner: people[0], targets: [people[1]] }; },
      async getTargetView() { calls.target += 1; throw new Error(`UNKNOWN_ERROR ${secret}`); }
    }
  };
  vm.runInNewContext(knowledgeSource, { window, document, setTimeout, clearTimeout, console }, { filename: "character-knowledge-ui.js" });
  const host = document.createElement("div");
  const cleanup = window.VOTCCharacterKnowledgeUi.mount(host, { t: translators.en });
  try {
    await waitFor(() => !!findSelect(host, "Choose who knows"), "English character picker should render for error case");
    const owner = findSelect(host, "Choose who knows");
    owner.value = "owner";
    await owner.dispatch("change");
    const target = findSelect(host, "Choose whom the disclosure concerns");
    target.value = "target";
    await target.dispatch("change");
    await waitFor(() => !!findByClass(host, "character-knowledge-error"), "unknown backend error should produce safe visible copy");
    assert.ok(host.textContent.includes(translators.en("legacyKnowledge.errors.generic")));
    assert.ok(!host.textContent.includes(secret), "unknown backend details and paths must not reach the UI");
    const before = { ...calls };
    cleanup.updateLanguage(translators.zh);
    assert.ok(host.textContent.includes(translators.zh("legacyKnowledge.errors.generic")));
    assert.ok(!host.textContent.includes(secret));
    assert.deepEqual(calls, before, "changing the error language must not repeat IPC calls");
  } finally {
    cleanup();
  }
}

async function withPairGlobals(api, callback) {
  const keys = ["document", "conversationAPI", "addEventListener", "removeEventListener"];
  const saved = new Map(keys.map(key => [key, { hadOwn: Object.hasOwn(globalThis, key), value: globalThis[key] }]));
  globalThis.document = new MiniDocument();
  globalThis.conversationAPI = api;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  try {
    return await callback(globalThis.document);
  } finally {
    for (const [key, value] of saved) {
      if (value.hadOwn) globalThis[key] = value.value;
      else delete globalThis[key];
    }
  }
}

async function testPairLanguageUpdatesPreserveFactsAndDraft(translators) {
  const calls = { index: 0, preview: 0, apply: 0, source: 0 };
  const secret = "C:\\private\\summary-source.json";
  const api = {
    async getPairMemoryIndex(payload) {
      calls.index += 1;
      return {
        success: true,
        ...payload,
        totalCount: 1,
        page: 0,
        pageSize: 20,
        items: [{
          text: "The winter treaty was signed.",
          conversationDate: "1090.01.02",
          interactionEvidence: "DIRECT_PAIR",
          source: { sourceSummaryKey: "legacy-summary-7", sourceRevision: "r3", sourcePath: secret }
        }]
      };
    },
    async previewPairMemoryBackfill() { calls.preview += 1; return { success: true }; },
    async applyPairMemoryBackfill() { calls.apply += 1; return { success: true }; },
    async getVerifiedPairMemorySource() { calls.source += 1; return { success: true }; }
  };

  await withPairGlobals(api, async document => {
    const host = document.createElement("div");
    const cleanup = pairUi.mount(host, { mode: "pair", ownerId: 501, counterpartId: 502, ownerName: "Aldric Vane", counterpartName: "Mara Venn", t: translators.en });
    try {
      await waitFor(() => host.textContent.includes("The winter treaty was signed."), "English Pair ledger item should render");
      assert.ok(host.textContent.includes("long-term matters"), "Pair controls should use English translations");
      assert.ok(host.textContent.includes("Aldric Vane") && host.textContent.includes("Mara Venn"), "factual person names must remain source text");
      assert.ok(host.textContent.includes("1090.01.02"), "factual conversation date must remain unchanged");
      assert.ok(host.textContent.includes("legacy-summary-7"), "source summary identity must remain unchanged in diagnostics");
      assert.ok(!host.textContent.includes(secret), "source paths must not be rendered in diagnostics");

      let search = host.querySelectorAll("input").find(node => node.getAttribute("aria-label") === "Search long-term matters");
      assert.ok(search, "translated search control should render");
      search.value = "draft filter text";
      search.focus();
      const before = { ...calls };

      cleanup.updateLanguage(translators.zh);
      assert.ok(host.textContent.includes("长期事项"));
      assert.ok(host.textContent.includes("Aldric Vane") && host.textContent.includes("Mara Venn"));
      assert.ok(host.textContent.includes("The winter treaty was signed."), "summary fact must not be translated");
      assert.ok(host.textContent.includes("legacy-summary-7"), "source identity must not be translated");
      assert.ok(host.textContent.includes("1090.01.02"));
      search = host.querySelectorAll("input").find(node => node.getAttribute("aria-label") === "搜索长期事项");
      assert.equal(search.value, "draft filter text", "unsubmitted search draft should survive language change");
      assert.equal(document.activeElement, search, "focused search field should remain focused after rerender");

      cleanup.updateLanguage(translators.en);
      assert.ok(host.textContent.includes("long-term matters"));
      assert.ok(host.textContent.includes("The winter treaty was signed."));
      search = host.querySelectorAll("input").find(node => node.getAttribute("aria-label") === "Search long-term matters");
      assert.equal(search.value, "draft filter text");
      assert.equal(document.activeElement, search);
      assert.deepEqual(calls, before, "language changes must not refetch, verify a source, preview, or write");
    } finally {
      cleanup();
    }
  });
}

async function testPairUnknownErrorIsSafe(translators) {
  const secret = "C:\\private\\provider-key.json";
  const calls = { index: 0 };
  await withPairGlobals({
    async getPairMemoryIndex() { calls.index += 1; return { success: false, error: `UNKNOWN_ERROR ${secret}` }; }
  }, async document => {
    const host = document.createElement("div");
    const cleanup = pairUi.mount(host, { mode: "pair", ownerId: 601, counterpartId: 602, ownerName: "Aldric", counterpartName: "Mara", t: translators.en });
    try {
      await waitFor(() => !!findByClass(host, "pair-ledger-error"), "unknown Pair error should render a safe message");
      assert.ok(host.textContent.includes(translators.en("legacyPair.errors.generic")));
      assert.ok(!host.textContent.includes(secret), "unknown backend errors and paths must not reach the UI");
      const reads = calls.index;
      cleanup.updateLanguage(translators.zh);
      assert.ok(host.textContent.includes(translators.zh("legacyPair.errors.generic")));
      assert.ok(!host.textContent.includes(secret));
      assert.equal(calls.index, reads, "translating a retained error must not repeat the read");
    } finally {
      cleanup();
    }
  });
}

async function main() {
  const translators = await createTranslators();
  await testCharacterKnowledgeLanguageUpdates(translators);
  await testCharacterUnknownErrorIsSafe(translators);
  await testPairLanguageUpdatesPreserveFactsAndDraft(translators);
  await testPairUnknownErrorIsSafe(translators);
  process.stdout.write("V9.5 legacy DOM i18n behavior: PASS\n");
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
