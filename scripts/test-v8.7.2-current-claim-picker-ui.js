"use strict";

const assert = require("assert");

const { source, assertMappedCopy, assertCopy, assertCatalogValue } = require("./world-memory-i18n-test-helper");
assertMappedCopy("读取 CK3 当前事实", "form.readCurrentTruth", "读取 CK3 当前事实", "Read current CK3 fact");
assertCopy('copy("form.truthPreview", "当前事实只读预览"', "form.truthPreview", "当前事实只读预览", "Read-only current fact preview");
assertCopy('copy("form.truthHelp", "保存时由服务端再次核验；不会接受手动填写的当前值。"', "form.truthHelp", "保存时由服务端再次核验；不会接受手动填写的当前值。", "The service checks this again when saving; manually entered current values are not accepted.");
assert.match(source, /getCanonCurrentTruth/);
assert.match(source, /Object\.entries\(CURRENT_CLAIM_FIELDS\)\.map/);
assert.match(source, /enumLabel\("claimFields", value, CURRENT_CLAIM_FIELDS, "未知"\)/);
for (const [field, zhText, enText] of [
  ["location", "所在地", "Location"],
  ["alive", "是否在世", "Alive"],
  ["faith", "信仰", "Faith"],
  ["culture", "文化", "Culture"],
  ["liege", "直属领主", "Liege"],
  ["courtEmployer", "所在宫廷", "Court"]
]) assertCatalogValue(`claimFields.${field}`, zhText, enText);
assert.doesNotMatch(source, /primaryTitle|imprisoned/, "unsupported current truth fields must not be player-selectable");
console.log("V8.7.2 Current Claim picker UI PASS");
