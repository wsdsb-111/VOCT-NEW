"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
assert.match(source, /希望世界长期记住的内容/);
assert.match(source, /这件事从什么时候成立？/);
assert.match(source, /谁可以知道？/);
assert.match(source, /涉及人物（可选）/);
assert.match(source, /这是人物当前状态，需要用 CK3 核对/);
assert.match(source, /要核对哪项状态？/);
assert.match(source, /记忆类型/);
assert.match(source, /从模板开始/);
assert.match(source, /world-memory-advanced/);
assert.match(source, /对话提醒/);
assert.match(source, /developerMode && h\("div", \{ className: "world-memory-developer-fields"/);
console.log("V8.7.1 Luna basic mode UI PASS");
