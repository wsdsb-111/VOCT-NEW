"use strict";
const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("../resources/app/out/main/prompts/prompt-builder"), "utf8");
const history = source.slice(source.lastIndexOf('case "history"'));
assert(history.indexOf("if (currentUserMessage)") < history.indexOf("if (options.thirdPartyEvidenceText)"));
assert(source.includes("subjectiveWorldPolicyActive"));
console.log("V8.6.2 Legacy Mentioned Cache Placement: PASS");
