"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("resources/app/out/renderer/world-memory-editor.js", "utf8");
const preservingReasons = [
  "historical_definition_index_updated",
  "historical_query_ready",
  "localization_updated",
  "runtime_name_index_updated",
  "live_updated"
];

assert.match(source, /const EDITOR_PRESERVING_UPDATE_REASONS = new Set\(\[/);
for (const reason of preservingReasons) assert.match(source, new RegExp(`"${reason}"`), `missing editor-preserving update reason: ${reason}`);

const effectStart = source.indexOf("const unsubscribe = api?.onUpdated?.");
const effectEnd = source.indexOf("return () =>", effectStart);
assert.ok(effectStart >= 0 && effectEnd > effectStart, "world memory update subscription is missing");
const subscription = source.slice(effectStart, effectEnd);
assert.match(subscription, /EDITOR_PRESERVING_UPDATE_REASONS\.has\(payload\?\.reason\)/);
assert.match(subscription, /if \(busyRef\.current\) \{ pendingUpdate\.current = true; return; \}/,
  "worldline updates during a save must not invalidate its result or error");
assert.match(subscription, /setData\(null\)/, "real worldline changes must still invalidate stale editor data");
const runStart = source.indexOf("const run = async action =>");
const runEnd = source.indexOf("const defaultDate =", runStart);
assert.ok(runStart >= 0 && runEnd > runStart, "world-memory action runner is missing");
const actionRunner = source.slice(runStart, runEnd);
assert.match(actionRunner, /busyRef\.current = true/);
assert.match(actionRunner, /while \(mounted\.current && refreshSequence === request\.current && pendingUpdate\.current\)/,
  "queued worldline updates must reload after the active action settles");
assert.match(actionRunner, /await load\(refreshSequence\)/);

console.log("V8.7.2 world-memory input stability PASS");
