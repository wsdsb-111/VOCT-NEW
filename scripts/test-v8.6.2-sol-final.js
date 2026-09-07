"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
for (const file of ["third-party-evidence.js", "character-temporal-facts.js", "character-kinship-graph.js", "character-family-facts.js"]) {
  const base = file === "third-party-evidence.js" ? "memory-system" : "worldline";
  assert(fs.existsSync(path.join(root, "resources", "app", "out", "main", base, file)), `${file} must ship`);
}
const prompt = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "prompts", "prompt-builder.js"), "utf8");
assert(prompt.includes("Memory Engine 2.6") === false, "Memory label must not alter prompt or storage authority");
assert(prompt.includes("当前轮召回证据") && prompt.includes("ThirdPartyEvidencePatch"));
console.log("V8.6.2 Sol Final Static Gate: PASS");
