"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const file = (...parts) => path.join(root, ...parts);

for (const parts of [
  ["resources", "app", "out", "main", "historical-system", "historical-figure-resolver.js"],
  ["resources", "app", "out", "main", "historical-system", "historical-figure-input.js"],
  ["resources", "app", "out", "main", "historical-system", "figure-name-index.js"],
  ["resources", "app", "out", "main", "historical-system", "historical-figure-diagnostics.js"],
  ["resources", "app", "out", "main", "historical-system", "historical-diagnostics-ipc.js"],
  ["resources", "app", "out", "main", "historical-system", "historical-ground-truth-store.js"],
  ["resources", "app", "out", "renderer", "historical-dashboard-helpers.js"]
]) assert.equal(fs.existsSync(file(...parts)), false, `retired V8.3 path must be absent: ${parts.at(-1)}`);

const main = fs.readFileSync(file("resources", "app", "out", "main", "main.js"), "utf8");
const preload = fs.readFileSync(file("resources", "app", "out", "preload", "preload.js"), "utf8");
const renderer = fs.readFileSync(file("resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
const dynamicHistory = fs.readFileSync(file("resources", "app", "out", "main", "historical-system", "dynamic-history-service.js"), "utf8");
for (const source of [main, preload, renderer, dynamicHistory]) {
  assert(!source.includes("historicalFigureResolver"));
  assert(!source.includes("historicalAPI"));
  assert(!source.includes("figureResolution"));
}
assert(main.includes("DynamicHistoryService"), "campaign/worldline boundary must remain active");
assert(fs.readFileSync(file("resources", "app", "out", "main", "worldline", "historical-identity-resolver.js"), "utf8").includes("DEFINITION_RUNTIME_BINDING"), "V8.8 Definition-ID binding must remain the active historical identity path");
console.log("VOTC v8.8 Retired V8.3 Shadow Chain: PASS (legacy diagnostics removed, current binding retained)");
