"use strict";

const assert = require("assert");

const { source, assertCopy, assertMappedCopy, assertCatalogValue } = require("./world-memory-i18n-test-helper");
assertMappedCopy("这是人物当前状态，需要用 CK3 核对", "form.currentState", "这是人物当前状态，需要用 CK3 核对", "This is a character's current state and must be checked against CK3");
assertCopy('copy("form.claimPerson", "要核对哪个人物？"', "form.claimPerson", "要核对哪个人物？", "Which character should be checked?");
assertCopy('copy("form.claimField", "要核对哪项状态？"', "form.claimField", "要核对哪项状态？", "Which state should be checked?");
assertCopy('copy("test.claimValues", "CK3 当前状态：{{current}} · 世界记忆：{{memory}}"', "test.claimValues", "CK3 当前状态：{{current}} · 世界记忆：{{memory}}", "Current CK3 state: {{current}} · World memory: {{memory}}");
assertMappedCopy("改为过去事件", "test.convertToPast", "改为过去事件", "Change to past event");
assertMappedCopy("取消当前状态声明", "test.cancelCurrentClaim", "取消当前状态声明", "Remove current-state claim");
assertMappedCopy("隐藏此记录", "test.hideRecord", "隐藏此记录", "Hide this record");
assertMappedCopy("确定永久删除“{{title}}”吗？这会移除这条记忆及其修订记录；如果只是暂时不召回，请使用“隐藏”。", "ui.confirmDelete", "确定永久删除“{{title}}”吗？这会移除这条记忆及其修订记录；如果只是暂时不召回，请使用“隐藏”。", "Permanently delete “{{title}}”? This removes the memory and its revision history. To stop recalling it temporarily, use “Hide”.");
assertMappedCopy("删除", "ui.delete", "删除", "Delete");
assert.ok(source.includes('operation: "delete"'));
assert.ok(source.includes("world-memory-danger-button"));
assert.match(source, /temporalSemantics: draft\.currentStateEnabled \? "CURRENT_STRUCTURED_CLAIM" : null/);
assert.match(source, /currentClaim,/);
assert.match(source, /RECALL_DISABLED:/);
assertCatalogValue("recallReasons.RECALL_DISABLED", "当前对话召回尚未开启", "Recall is disabled for this conversation");
console.log("V8.7.1 Current Truth UI PASS");
