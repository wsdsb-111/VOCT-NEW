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
assert(source.includes('id: "worldline-turn-recall",\n        type: "worldline_turn_recall"'), "Worldline recall must use an explicit diagnostic block id");
assert(source.includes('label: "Worldline Turn Recall", enabled: true, role: "system", stable: false'), "Worldline recall must remain dynamic");
console.log("V8.6.1 Prompt Order: PASS (current user -> Memory Turn Recall -> Worldline Turn Recall)");
