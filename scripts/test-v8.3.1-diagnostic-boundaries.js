"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

const prompt = read("resources", "app", "default_userdata", "prompts", "system", "default.hbs").replace(/\r\n/g, "\n");
assert.strictEqual(hash(prompt), "de9fb902bfe148048a5b7049545001add79ee42dd7beb618db2e3b60cf69eea2");
const promptBuilder = read("resources", "app", "out", "main", "prompts", "prompt-builder.js");
assert(promptBuilder.includes('stable: ["stable_global", "stable_history_rp", "character_base"].includes(segment.id)'));
const worldlineStore = read("resources", "app", "out", "main", "historical-system", "worldline-store.js");
assert(!worldlineStore.includes("figureBindings") && !worldlineStore.includes("figureResolution"));

const diagnostics = [
  read("resources", "app", "out", "main", "historical-system", "historical-figure-diagnostics.js"),
  read("resources", "app", "out", "main", "historical-system", "historical-ground-truth-store.js"),
  read("resources", "app", "out", "main", "historical-system", "historical-diagnostics-ipc.js")
].join("\n");
for (const forbidden of ["ActionEngine", "letterManager", "memoryEngine", "runFileManager", "PromptBuilder", "activeConversation"]) assert(!diagnostics.includes(forbidden), `diagnostics must not depend on ${forbidden}`);
assert(diagnostics.includes("diagnostics") && diagnostics.includes("historical-figure-ground-truth"));
assert(!diagnostics.includes("dynamic_history"));

const version = require(path.join(root, "resources", "app", "out", "main", "version"));
assert.strictEqual(version.VOTC_CORE_VERSION, "8.3.1");

console.log("VOTC v8.3.1 Diagnostic Boundaries: PASS (Prompt/cache/worldline frozen; zero Action/Letter/Memory production dependency)");
