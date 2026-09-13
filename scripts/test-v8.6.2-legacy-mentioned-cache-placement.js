"use strict";
const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("../resources/app/out/main/prompts/prompt-builder"), "utf8");
const history = source.slice(source.lastIndexOf('case "history"'));
const v89 = history.slice(history.indexOf("if (options.v89Layout)"), history.indexOf("} else {", history.indexOf("if (options.v89Layout)")));
assert(v89.indexOf("appendCurrentUser();") < v89.indexOf("appendThirdPartyEvidence();"));
assert(source.includes("subjectiveWorldPolicyActive"));
console.log("V8.6.2 Legacy Mentioned Cache Placement: PASS");
