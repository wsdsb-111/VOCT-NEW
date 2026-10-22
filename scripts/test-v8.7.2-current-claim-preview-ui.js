"use strict";

const assert = require("assert");

const { source, assertCatalogValue } = require("./world-memory-i18n-test-helper");
assert.match(source, /draft\.currentTruth\?\.available/);
assert.match(source, /draft\.currentTruth\.displayValue/);
assert.match(source, /currentClaim = \{ entityId: truth\.entityId, field: truth\.field, value: truth\.rawValue \}/);
assert.ok(source.includes('"请先读取并确认 CK3 当前事实；当前值不允许手动填写。": "currentTruthMustBeRead"'), "manual-value rejection must resolve through the safe translation key");
assertCatalogValue("errors.currentTruthMustBeRead", "请先读取并确认 CK3 当前事实；当前值不允许手动填写。", "Read and confirm the current CK3 fact first. Current values cannot be entered manually.");
console.log("V8.7.2 Current Claim read-only preview UI PASS");
