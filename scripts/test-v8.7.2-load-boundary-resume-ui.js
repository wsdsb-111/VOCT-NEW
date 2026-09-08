"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
assert.match(source, /api\.confirmCanonBranch\(data\.branch\.token\)/);
assert.match(source, /api\.forkCanonBranch\(data\.branch\.token\)/);
assert.match(source, /loadBoundary \? "继续当前分支"/);
assert.match(source, /loadBoundary \|\| !data\.branch\.branchId/);
assert.match(source, /const writable = .*branchNeedsAction/);
console.log("V8.7.2 load-boundary resume-or-fork UI PASS");
