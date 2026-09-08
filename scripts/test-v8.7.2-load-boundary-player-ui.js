"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
assert.match(source, /LOAD_BOUNDARY_CANDIDATE/);
assert.match(source, /检测到新的 CK3 载入会话/);
assert.match(source, /继续当前分支/);
assert.match(source, /不继承旧 Canon 的独立分支/);
assert.match(source, /branchNeedsAction = .*LOAD_BOUNDARY_CANDIDATE/);
console.log("V8.7.2 load-boundary player UI PASS");
