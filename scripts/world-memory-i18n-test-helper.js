"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "resources/app/out/renderer/world-memory-editor.js"), "utf8");
const zh = fs.readFileSync(path.join(root, "src/app/renderer/v95/i18n/locales/zh-CN.js"), "utf8");
const en = fs.readFileSync(path.join(root, "src/app/renderer/v95/i18n/locales/en-US.js"), "utf8");
const catalogs = ["src/app/renderer", "resources/app/out/renderer"].flatMap(directory =>
  ["zh-CN", "en-US"].map(locale => {
    const file = path.join(root, directory, "v95/i18n/locales", `${locale}.js`);
    const expression = fs.readFileSync(file, "utf8").replace(/^export default\s*/, "").replace(/;\s*$/, "");
    return { file, locale, value: vm.runInNewContext(`(${expression})`, {}, { timeout: 1000 }) };
  }));

function assertCatalogValue(key, zhValue, enValue) {
  for (const catalog of catalogs) {
    const value = key.split(".").reduce((part, property) => part?.[property], catalog.value.worldMemoryEditor);
    assert.strictEqual(value, catalog.locale === "zh-CN" ? zhValue : enValue,
      `incorrect worldMemoryEditor.${key} translation in ${catalog.file}`);
  }
}

function assertCopy(sourceNeedle, key, zhValue, enValue) {
  assert.ok(source.includes(sourceNeedle), `missing WorldMemoryEditor translation wiring: ${sourceNeedle}`);
  assertCatalogValue(key, zhValue, enValue);
}

function assertMappedCopy(fallback, key, zhValue, enValue) {
  assertCopy(`"${fallback}": "${key}"`, key, zhValue, enValue);
}

module.exports = { source, zh, en, assertCatalogValue, assertCopy, assertMappedCopy };
