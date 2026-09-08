"use strict";

const assert = require("assert");
const fs = require("fs");

const renderer = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
const service = fs.readFileSync("resources/app/out/main/worldline/worldline-service.js", "utf8");
const preload = fs.readFileSync("resources/app/out/preload/preload.js", "utf8");
const ipc = fs.readFileSync("resources/app/out/main/ipc/register-ipc.js", "utf8");
assert.match(renderer, /NPC 暂时不会读取世界记忆/);
assert.match(renderer, /Worldline Prompt Integration = ON/);
assert.match(renderer, /Subjective World Mode = PRODUCTION/);
assert.match(renderer, /一键开启推荐设置/);
assert.match(renderer, /不会改变模型，也不会修改 CK3 存档/);
assert.match(renderer, /setRecallSettings\(\{ promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION" \}\)/);
assert.match(service, /setRecallSettings\(input = \{\}\)/);
assert.match(service, /worldline_prompt_integration_invalid/);
assert.match(service, /worldline_recall_settings_empty/);
assert.match(ipc, /worldline:setRecallSettings/);
assert.match(preload, /setRecallSettings: \(settings\)/);
console.log("V8.7.1 Luna recall guidance PASS");
