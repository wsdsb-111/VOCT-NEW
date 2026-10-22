"use strict";

const assert = require("assert");

const { source } = require("./world-memory-i18n-test-helper");
const formStart = source.indexOf("const renderForm");
const advancedStart = source.indexOf('developerMode && h("div", { className: "world-memory-developer-fields"', formStart);
const form = source.slice(formStart, advancedStart);
assert.ok(form.includes("selectedEntities"), "basic mode must use character selections");
assert.ok(form.includes("selectedKnownBy"), "basic mode must use known-by selections");
assert.ok(!form.includes("developer.entitiesRuntimeId"), "basic mode must not expose the developer-only Runtime ID field");
assert.match(source, /developerMode && h\("div", \{ className: "world-memory-developer-fields"/,
  "Runtime ID diagnostics must remain behind developer mode");
assert.match(source, /entities = draft\.selectedEntities\.map/);
assert.match(source, /knownBy = draft\.selectedKnownBy\.map/);
assert.match(source, /scopeEntityId \|\| entities\[0\] \|\| null/);
console.log("V8.7.1 Luna no-runtime-ID-required PASS");
