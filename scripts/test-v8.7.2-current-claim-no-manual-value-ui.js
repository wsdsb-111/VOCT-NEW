"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
const form = source.slice(source.indexOf("const renderForm"), source.indexOf("const renderBranchStatus"));
assert.doesNotMatch(form, /currentClaimValue|世界记忆中的状态值/);
assert.doesNotMatch(form, /当前Claim|手动填写.*input/i);
assert.match(form, /currentClaimEntityId: event\.target\.value/);
assert.match(form, /currentClaimField: event\.target\.value/);
console.log("V8.7.2 Current Claim no manual value UI PASS");
