"use strict";

const assert = require("assert");
const fs = require("fs");

const { source: renderer, assertMappedCopy } = require("./world-memory-i18n-test-helper");
const service = fs.readFileSync("resources/app/out/main/worldline/worldline-service.js", "utf8");
const preload = fs.readFileSync("resources/app/out/preload/preload.js", "utf8");
const ipc = fs.readFileSync("resources/app/out/main/ipc/register-ipc.js", "utf8");
assertMappedCopy("NPC 暂时不会读取世界记忆。", "recall.disabled", "NPC 暂时不会读取世界记忆。", "NPCs are not reading world memories yet.");
assert.match(renderer, /Worldline Prompt Integration = ON/);
assert.match(renderer, /Subjective World Mode = PRODUCTION/);
assertMappedCopy("一键开启推荐设置", "recall.enableRecommended", "一键开启推荐设置", "Enable recommended settings");
assertMappedCopy("只会改变世界书召回设置，不会改变模型，也不会修改 CK3 存档。", "recall.stepsHelp", "只会改变世界书召回设置，不会改变模型，也不会修改 CK3 存档。", "This changes only world-memory recall settings. It does not change the model or CK3 save.");
assert.match(renderer, /setRecallSettings\(\{ promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION" \}\)/);
assert.match(service, /setRecallSettings\(input = \{\}\)/);
assert.match(service, /worldline_prompt_integration_invalid/);
assert.match(service, /worldline_recall_settings_empty/);
assert.match(ipc, /worldline:setRecallSettings/);
assert.match(preload, /setRecallSettings: \(settings\)/);
console.log("V8.7.1 Luna recall guidance PASS");
