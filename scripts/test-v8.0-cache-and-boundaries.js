"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const historicalRoot = path.join(root, "resources", "app", "out", "main", "historical-system");
const defaultPromptPath = path.join(root, "resources", "app", "default_userdata", "prompts", "system", "default.hbs");
const promptBuilderPath = path.join(root, "resources", "app", "out", "main", "prompts", "prompt-builder.js");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

const prompt = fs.readFileSync(defaultPromptPath, "utf8").replace(/\r\n/g, "\n");
assert.strictEqual(hash(prompt), "de9fb902bfe148048a5b7049545001add79ee42dd7beb618db2e3b60cf69eea2", "default.hbs changed during v8.0");
const markers = [...prompt.matchAll(/\{\{! VOTC_SEGMENT:([a-z_]+) \}\}/g)];
assert.deepStrictEqual(markers.map((match) => match[1]), ["stable_global", "stable_history_rp", "world_context", "character_base", "character_state"]);
const segments = {};
markers.forEach((match, index) => {
  segments[match[1]] = prompt.slice(match.index, markers[index + 1]?.index ?? prompt.length);
});
const stableSource = ["stable_global", "stable_history_rp", "character_base"].map((key) => segments[key]).join("\n");
assert.strictEqual(hash(stableSource), "01a275fbee655adff3e7df7306099d74c46003e0e8ec760cae926a495a7019c0", "stable prompt source changed during v8.0");

const promptBuilder = fs.readFileSync(promptBuilderPath, "utf8");
assert(promptBuilder.includes('stable: ["stable_global", "stable_history_rp", "character_base"].includes(segment.id)'), "stable segment classification changed");
assert(promptBuilder.includes('segment.id === "world_context" || segment.id === "character_state"'), "dynamic segment deferral changed");

const queue = [historicalRoot];
while (queue.length > 0) {
  const directory = queue.pop();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) queue.push(filePath);
    else if (entry.name.endsWith(".js")) {
      const source = fs.readFileSync(filePath, "utf8");
      assert(!/require\([^)]*(?:actions|letters|conversation|memory-system|run-file-manager|relationship-resolver)/.test(source), `historical-system dependency crossed a frozen boundary: ${filePath}`);
    }
  }
}

for (const forbidden of ["game-state-snapshot.js", "divergence-engine.js", "historical-context-projector.js"]) {
  assert.strictEqual(fs.existsSync(path.join(historicalRoot, forbidden)), false, `${forbidden} belongs to a later V8 phase`);
}

console.log("VOTC v8.0 cache/dependency contract: PASS (prompt hashes, block roles, frozen boundaries)");
