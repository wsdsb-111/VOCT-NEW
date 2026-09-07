"use strict";
const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("../resources/app/out/main/prompts/prompt-builder"), "utf8");
const tail = source.slice(source.indexOf("case \"history\""));
assert(tail.indexOf("currentUserMessage") < tail.indexOf("options.thirdPartyEvidenceText"));
assert(tail.indexOf("options.thirdPartyEvidenceText") < tail.indexOf("options.worldTurnRecallText"));
assert(source.includes('type: "third_party_evidence"') && source.includes("stable: false"));
console.log("V8.6.2 Third-party Cache Placement: PASS");
