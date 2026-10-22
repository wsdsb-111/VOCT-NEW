"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "resources/app/out/renderer/world-memory-editor.js"), "utf8");
const zh = fs.readFileSync(path.join(root, "src/app/renderer/v95/i18n/locales/zh-CN.js"), "utf8");
const en = fs.readFileSync(path.join(root, "src/app/renderer/v95/i18n/locales/en-US.js"), "utf8");

function assertCatalogValue(key, zhValue, enValue) {
  const property = key.split(".").at(-1);
  assert.ok(zh.includes(`${property}: ${JSON.stringify(zhValue)}`), `missing zh-CN translation for worldMemoryEditor.${key}`);
  assert.ok(en.includes(`${property}: ${JSON.stringify(enValue)}`), `missing en-US translation for worldMemoryEditor.${key}`);
}

function assertCopy(sourceNeedle, key, zhValue, enValue) {
  assert.ok(source.includes(sourceNeedle), `missing WorldMemoryEditor translation wiring: ${sourceNeedle}`);
  assertCatalogValue(key, zhValue, enValue);
}

function assertMappedCopy(fallback, key, zhValue, enValue) {
  assertCopy(`"${fallback}": "${key}"`, key, zhValue, enValue);
}

module.exports = { source, zh, en, assertCatalogValue, assertCopy, assertMappedCopy };
