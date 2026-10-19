"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/app/renderer/assets/index-Dn3qWlAB.js"), "utf8");
const start = source.indexOf("const StreamingMarkdown = (");
const end = source.indexOf("const actionLifecycleLabel =", start);
assert(start >= 0 && end > start, "load the actual shipped Markdown lifecycle component");
const container = { textContent: "", resets: 0, replaceChildren() { this.textContent = ""; this.resets += 1; } };
const refs = [];
const parsers = [];
let cursor = 0;
let effects = [];
const context = vm.createContext({
  reactExports: {
    useRef(initial) { const index = cursor++; return refs[index] || (refs[index] = { current: initial }); },
    useEffect(effect, dependencies) { if (dependencies.length) effects.push(effect); }
  },
  jsxRuntimeExports: { jsx(_tag, props) { props.ref.current = container; return props; } },
  default_renderer: target => target,
  parser(target) { const instance = { target, writes: [], ended: false }; parsers.push(instance); return instance; },
  parser_write(instance, text) { instance.writes.push(text); instance.target.textContent += text; },
  parser_end(instance) { instance.ended = true; }
});
vm.runInContext(`${source.slice(start, end)}\nglobalThis.component = StreamingMarkdown;`, context);
function render(content, isAnimating) {
  cursor = 0;
  effects = [];
  context.component({ content, isAnimating });
  effects.forEach(effect => effect());
  assert.equal(container.textContent, content, "rendered text must match the current message, including same-ID replacements");
}

render("原", true);
render("原台词", true);
render("原台词", false);
assert.equal(container.resets, 0, "normal streamed growth must retain the incremental parser");
render("新台词", false); // Same length: the append-only implementation leaves the old reply on screen.
render("短", false);
render("短台词延长", false);
render("", false);
render("下一条", true);
render("下一条流式回复", true);
render("下一条流式回复", false);
render("改写", true);
render("改写完成", false);

render("已结束的旧回复", true);
render("已结束的旧回复", false);
assert.equal(parsers.at(-1).ended, true, "a settled response ends its parser");
render("已结束的旧回复", true); // Regeneration can set isAnimating before its first content chunk arrives.
const resumedParser = parsers.at(-1);
render("已结束的旧回复后续", true);
assert.equal(resumedParser.writes.join(""), "已结束的旧回复后续",
  "a fresh parser after a settled response must receive the full source, even when animation resumes before content changes");
console.log("V9.3.9.3 Markdown replacement: PASS (actual component lifecycle, replacements, incremental streaming, and ended-parser resume)");
