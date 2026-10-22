"use strict";

const assert = require("assert");

const { source, assertCopy } = require("./world-memory-i18n-test-helper");
assert.match(source, /api\.listSupplemental\(\)/);
assertCopy('copy("legacy.found", "发现 {{count}} 条旧版补充知识（只读）"', "legacy.found", "发现 {{count}} 条旧版补充知识（只读）", "{{count}} read-only legacy supplemental records found");
assertCopy('copy("legacy.help", "这些是旧版本留下的兼容记录，只能查看；迁移为 Canon 前不会修改原文，也不会自动覆盖当前 CK3 事实。"', "legacy.help", "这些是旧版本留下的兼容记录，只能查看；迁移为 Canon 前不会修改原文，也不会自动覆盖当前 CK3 事实。", "These compatibility records are read-only. Migration to Canon will not change their original text or automatically overwrite current CK3 facts.");
assert.doesNotMatch(source, /当前检查点没有旧版 Supplemental/);
assert.doesNotMatch(source, /api\.(createSupplemental|updateSupplemental|deleteSupplemental)/);
console.log("V8.7.2 legacy Supplemental read-only UI PASS");
