"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/conversation/conversation.js"), "utf8");
const start = source.indexOf("if (productionWorldlineEnabled)");
const catchIndex = source.indexOf("World recall failed; continuing without world recall", start);
assert(start >= 0 && catchIndex > start, "Worldline production recall must be isolated by a local failure boundary");
const guarded = source.slice(start, catchIndex);
assert(!guarded.includes("getPromptContext("), "production failure may not fall back to legacy world prompt assembly");
console.log("V8.6.1 Worldline Failure Isolation: PASS (failure omits world recall without legacy fallback)");
