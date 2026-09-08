"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
const formStart = source.indexOf("const renderForm");
const advancedStart = source.indexOf("高级选项（Runtime ID、冲突与调试）", formStart);
const form = source.slice(formStart, advancedStart);
assert.ok(form.includes("selectedEntities"), "basic mode must use character selections");
assert.ok(form.includes("selectedKnownBy"), "basic mode must use known-by selections");
assert.ok(!form.includes("涉及人物 Runtime ID"), "basic mode must not require a Runtime ID field");
assert.match(source, /entities = draft\.selectedEntities\.map/);
assert.match(source, /knownBy = draft\.selectedKnownBy\.map/);
assert.match(source, /scopeEntityId \|\| entities\[0\] \|\| null/);
console.log("V8.7.1 Luna no-runtime-ID-required PASS");
