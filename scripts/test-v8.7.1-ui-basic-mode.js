"use strict";

const assert = require("assert");

const { source, assertMappedCopy } = require("./world-memory-i18n-test-helper");
assertMappedCopy("希望世界长期记住的内容", "form.content", "希望世界长期记住的内容", "Content the world should remember");
assertMappedCopy("这件事从什么时候成立？", "form.temporalMode", "这件事从什么时候成立？", "When does this take effect?");
assertMappedCopy("谁可以知道？", "form.visibility", "谁可以知道？", "Who can know?");
assertMappedCopy("涉及人物（可选）", "form.entities", "涉及人物（可选）", "Characters involved (optional)");
assertMappedCopy("这是人物当前状态，需要用 CK3 核对", "form.currentState", "这是人物当前状态，需要用 CK3 核对", "This is a character's current state and must be checked against CK3");
assertMappedCopy("要核对哪项状态？", "form.claimField", "要核对哪项状态？", "Which state should be checked?");
assertMappedCopy("记忆类型", "form.type", "记忆类型", "Memory type");
assertMappedCopy("从模板开始", "form.showTemplates", "从模板开始", "Start from a template");
assert.match(source, /world-memory-advanced/);
assertMappedCopy("对话提醒", "form.conversationReminder", "对话提醒", "Conversation reminder");
assert.match(source, /developerMode && h\("div", \{ className: "world-memory-developer-fields"/);
console.log("V8.7.1 Luna basic mode UI PASS");
