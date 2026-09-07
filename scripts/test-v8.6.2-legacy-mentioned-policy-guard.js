"use strict";
const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("../resources/app/out/main/prompts/prompt-builder"), "utf8");
assert(source.includes("memoryContext?.subjectiveWorldPolicyActive ? null : this.buildMentionedCharactersContext"));
assert(source.includes("ThirdPartyEvidencePatch"));
console.log("V8.6.2 Legacy Mentioned Policy Guard: PASS");
