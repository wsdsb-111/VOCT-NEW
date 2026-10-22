"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const i18next = require("../resources/app/node_modules/i18next");

(async () => {
  const load = relative => import(pathToFileURL(path.resolve(__dirname, "../src/app/renderer/v95", relative)).href);
  const contract = await load("contracts/view-contract.v1.js");
  const { createViewFixtures, createInvalidViewFixtures } = await load("contracts/view-fixtures.v1.js");
  const { UI_CATALOGS, createUiTranslator } = await load("i18n/index.js");
  function assertNoDuplicateKeys(source) {
    const tokens = source.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|[A-Za-z_$][\w$]*|[{}\[\]:,]/g)
      .filter(token => !token.startsWith("//") && !token.startsWith("/*"));
    const stack = [];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token === "{") stack.push(new Set());
      else if (token === "[") stack.push(null);
      else if (token === "}" || token === "]") stack.pop();
      else if (tokens[index + 1] === ":" && stack.at(-1)) {
        const key = token.startsWith('"') ? JSON.parse(token) : token;
        assert(!stack.at(-1).has(key), `duplicate locale key: ${key}`);
        stack.at(-1).add(key);
      }
    }
  }
  assert.throws(() => assertNoDuplicateKeys('{ "same": 1, same: 2 }'), /duplicate locale key/);
  for (const locale of ["zh-CN", "en-US"]) assertNoDuplicateKeys(fs.readFileSync(
    path.resolve(__dirname, `../src/app/renderer/v95/i18n/locales/${locale}.js`), "utf8"));
  const flatten = (value, prefix = "") => Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return typeof entry === "string" ? [[name, entry]] : Object.entries(flatten(entry, name));
  }));
  const catalogs = Object.fromEntries(Object.entries(UI_CATALOGS).map(([locale, catalog]) => [locale, flatten(catalog)]));
  const keys = Object.keys(catalogs["zh-CN"]).sort();
  assert.deepEqual(keys, Object.keys(catalogs["en-US"]).sort());
  for (const key of keys) {
    const placeholders = value => [...value.matchAll(/{{(\w+)}}/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(catalogs["zh-CN"][key]), placeholders(catalogs["en-US"][key]), key);
  }
  let total = 0;
  const i18n = i18next.createInstance();
  await i18n.init({ lng: "en-US", fallbackLng: "zh-CN", initImmediate: false, interpolation: { escapeValue: false } });
  for (const locale of ["zh-CN", "en-US"]) {
    const t = createUiTranslator(i18n, locale);
    const fixtures = createViewFixtures(locale);
    assert.equal(fixtures.length, 40);
    for (const view of fixtures) {
      assert.equal(contract.validateView(view).valid, true, `${locale} ${view.kind} ${view.state}`);
      const before = JSON.stringify(view);
      assert(keys.includes(view.titleKey) && keys.includes(view.emptyTextKey));
      assert.notEqual(t(view.titleKey), view.titleKey);
      assert.equal(contract.validateIntent({ type: "REQUEST_REFRESH", viewKind: view.kind, scopeTag: view.scopeTag, revisionTag: view.revisionTag }, view), true);
      assert.equal(contract.validateIntent({ type: "EXECUTE_ACTION", viewKind: view.kind, scopeTag: view.scopeTag, revisionTag: view.revisionTag }, view), false);
      assert.equal(contract.validateIntent({ type: "REQUEST_REFRESH", viewKind: view.kind, scopeTag: "wrong-scope", revisionTag: view.revisionTag }, view), false);
      assert.equal(contract.validateIntent({ type: "REQUEST_REFRESH", viewKind: view.kind, scopeTag: view.scopeTag, revisionTag: "old-revision" }, view), false);
      assert.equal(JSON.stringify(view), before, "translation and validation must not change facts");
      total++;
    }
    assert.equal(t("missing.key"), UI_CATALOGS[locale].common.unavailable);
    assert(!t("common.page", { page: 1, total: 3 }).includes("{{"));
    assert.equal(t("common.page"), UI_CATALOGS[locale].common.unavailable);
    const ready = fixtures[0];
    const intent = { type: "OPEN_DETAIL", viewKind: ready.kind, rowId: ready.rows[0].id, scopeTag: ready.scopeTag, revisionTag: ready.revisionTag };
    assert(contract.validateIntent(intent, ready));
    assert(!contract.validateIntent({ ...intent, rowId: ready.rows[1].id }, ready), "disabled row");
    assert(!contract.validateIntent(intent, { ...ready, state: "stale" }), "stale view");
    assert(!contract.validateIntent({ ...intent, api: () => {} }, ready), "no function injection");
    assert(!contract.validateIntent({ ...intent, value: { sourceKey: "hidden" } }, ready), "intent-specific fields");
    assert(!contract.validateIntent({ ...intent, page: "bad" }, ready), "no cross-intent payload");
    assert(!contract.validateView({ ...ready, rows: [{ ...ready.rows[0], icon: "https://example.invalid/icon" }] }).valid, "no icon URLs");
    assert(!contract.validateView({ ...ready, state: "error", rows: [], errorCode: null }).valid, "error state needs safe code");
    assert(contract.validateView({ ...ready, state: "refreshing" }).valid);
    assert(contract.validateView({ ...ready, state: "idle", rows: [], pagination: { page: 1, pageSize: 20, total: 0 } }).valid);
    assert(!contract.validateView({ ...ready, rows: [ready.rows[0], ready.rows[0]] }).valid, "duplicate keys");
    assert(!contract.validateView({ ...ready, rows: [{ ...ready.rows[0], credentials: "secret" }] }).valid, "no raw configuration");
  }
  for (const invalid of createInvalidViewFixtures()) assert.equal(contract.validateView(invalid).valid, false);
  console.log(`V9.5 view contract: PASS (${total} bilingual kind/state fixtures; ${keys.length} matching keys; stale intents and sensitive fields rejected)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
