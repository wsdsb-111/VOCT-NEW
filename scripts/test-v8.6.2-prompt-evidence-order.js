"use strict";
const assert = require("assert");
const fs = require("fs");
const fullSource = fs.readFileSync(require.resolve("../resources/app/out/main/prompts/prompt-builder"), "utf8");
const source = fullSource.slice(fullSource.lastIndexOf('case "history"'));
assert(source.indexOf("appendPriorHistory();") < source.indexOf("if (currentUserMessage)"));
assert(source.indexOf("if (currentUserMessage)") < source.indexOf("if (options.thirdPartyEvidenceText)"));
assert(source.indexOf("if (options.thirdPartyEvidenceText)") < source.indexOf("if (options.worldTurnRecallText)"));
console.log("V8.6.2 Prompt Evidence Order: PASS");
