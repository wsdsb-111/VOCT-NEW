"use strict";

const assert = require("assert");

const { source, assertMappedCopy } = require("./world-memory-i18n-test-helper");
assert.match(source, /api\.confirmCanonBranch\(data\.branch\.token\)/);
assert.match(source, /api\.forkCanonBranch\(data\.branch\.token\)/);
assert.match(source, /canConfirm && button\(loadBoundary \?/);
assertMappedCopy("继续当前分支", "branch.continueCurrent", "继续当前分支", "Continue current branch");
assertMappedCopy("确认延续当前分支", "branch.confirmContinuity", "确认延续当前分支", "Confirm continuing the current branch");
assert.match(source, /loadBoundary \|\| !data\.branch\.branchId/);
assert.match(source, /const writable = .*branchNeedsAction/);
console.log("V8.7.2 load-boundary resume-or-fork UI PASS");
