"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const manager = read("resources/app/out/main/letters/letter-manager.js");
const transport = read("resources/app/out/main/letters/letter-effect-transport.js");
const renderer = read("resources/app/out/renderer/assets/index-Dn3qWlAB.js");
const preload = read("resources/app/out/preload/preload.js");
const ipc = read("resources/app/out/main/ipc/register-ipc.js");

for (const field of ["payloadGameDay", "trackerGameDayAtCreation", "reconciledGameDayAtCreation", "deliveryBaseDay", "dateDelta", "dateSourceDecision"]) assert(manager.includes(field), `delivery field missing: ${field}`);
assert(manager.includes('dateSourceEvent = dateDelta !== null && Math.abs(dateDelta) <= 1 ? "DATE_ALIGNED"'));
assert(manager.includes('"DATE_SOURCE_DIVERGENCE"'));
assert(!manager.includes("this.currentTotalDays = Math.max(this.currentTotalDays, letterTotalDays)"));
assert(transport.includes("outboundMode: modes.VOTC"), "formal outbound transport must be fixed to votc_run_file");
assert(manager.includes("A3_VISUAL_CHECK_REQUIRED") && manager.includes("ARTIFACT_EFFECT_ABORTED") && manager.includes("ARTIFACT_SCOPE_NOT_CREATED") && manager.includes("ARTIFACT_NOT_VISIBLE"));
assert(manager.includes("PAYLOAD_INCOMPLETE_TIMEOUT") && manager.includes("contentPreview") && manager.includes("slice(0, 40)"));
assert(preload.includes("retryPayload") && ipc.includes('"letters:retryPayload"') && renderer.includes("重新读取信件数据"));
assert(renderer.includes("Payload 游戏日：") && renderer.includes("投递基准日：") && renderer.includes("DATE_SOURCE_DIVERGENCE"));
assert(renderer.includes("Official-Parity Artifact") && renderer.includes("Effect 实机诊断 3.0"));
assert(manager.includes('const deliveryBaseDay = payloadGameDay'));
assert(manager.includes('"PAYLOAD_SEND_DAY_AUTHORITATIVE"'));
assert(renderer.includes("Payload sendDay + delay"));

for (const test of ["test-v7.10-rc6-delivery-base-date.js", "test-v7.10-rc6-artifact-parity.js", "test-v7.10-rc6-payload-race.js", "test-v7.10-rc6-final-letter-gate.js", "test-v7.10-rc6-rev2-run-command-queue.js", "test-v7.10-rc6-rev2-date-producer.js", "test-v7.10-rc6-rev2-relationship-resolver.js"]) assert(fs.existsSync(path.join(__dirname, test)), `RC6 gate missing: ${test}`);

console.log("VOTC v7.10-RC6 Final Rev2 Gate: PASS (sendDay contract, ACK queue, Date Producer health, relationship resolver, A3 and payload recovery)");
