"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/prompts/prompt-builder.js"), "utf8");
const history = source.indexOf('case "history"');
const current = source.indexOf("currentUserMessage", history);
const memory = source.indexOf("memory-turn-recall", history);
const world = source.indexOf("worldline-turn-recall", memory);
assert(history >= 0 && current > history && memory > current && world > memory, "current user, Memory Turn Recall, then Worldline Turn Recall must be serialized in that order");
const worldBlockMatch = source.match(/const\s+subjectiveWorldBlock\s*=\s*\{([\s\S]*?)\};/);
assert(worldBlockMatch, "Worldline recall block must remain defined");
const worldBlock = worldBlockMatch[1];
assert(/id:\s*"worldline-turn-recall"/.test(worldBlock), "Worldline recall must use an explicit diagnostic block id");
assert(/type:\s*"worldline_turn_recall"/.test(worldBlock), "Worldline recall must retain its diagnostic block type");
assert(/label:\s*"Worldline Turn Recall"/.test(worldBlock) && /stable:\s*false/.test(worldBlock), "Worldline recall must remain dynamic");
console.log("V8.6.1 Prompt Order: PASS (current user -> Memory Turn Recall -> Worldline Turn Recall)");
