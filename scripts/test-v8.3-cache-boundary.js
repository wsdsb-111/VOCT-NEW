"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const promptPath = path.join(root, "resources", "app", "default_userdata", "prompts", "system", "default.hbs");
const promptBuilderPath = path.join(root, "resources", "app", "out", "main", "prompts", "prompt-builder.js");
const worldlineStorePath = path.join(root, "resources", "app", "out", "main", "historical-system", "worldline-store.js");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");

const prompt = fs.readFileSync(promptPath, "utf8").replace(/\r\n/g, "\n");
assert.strictEqual(hash(prompt), "de9fb902bfe148048a5b7049545001add79ee42dd7beb618db2e3b60cf69eea2");
const promptBuilder = fs.readFileSync(promptBuilderPath, "utf8");
assert(promptBuilder.includes('stable: ["stable_global", "stable_history_rp", "character_base"].includes(segment.id)'));
assert(promptBuilder.includes('segment.id === "world_context" || segment.id === "character_state"'));
const worldlineStore = fs.readFileSync(worldlineStorePath, "utf8");
assert(!worldlineStore.includes("figureBindings") && !worldlineStore.includes("figureResolution"));
const mainSource = fs.readFileSync(mainPath, "utf8");
assert(mainSource.includes("historicalFigureResolver"), "V8.3 resolver must be wired only through DynamicHistoryService");

console.log("VOTC v8.3 Cache Boundary: PASS (prompt hash/order unchanged, zero figure persistence contract)");
