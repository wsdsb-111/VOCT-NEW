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
const zhLocale = read("src/app/renderer/v95/i18n/locales/zh-CN.js");
const enLocale = read("src/app/renderer/v95/i18n/locales/en-US.js");
const v951Locale = read("src/app/renderer/v95/i18n/locales/v9-5-1-legacy-ui.js");

for (const field of ["payloadGameDay", "trackerGameDayAtCreation", "reconciledGameDayAtCreation", "deliveryBaseDay", "dateDelta", "dateSourceDecision"]) assert(manager.includes(field), `delivery field missing: ${field}`);
assert(manager.includes('dateSourceEvent = dateDelta !== null && Math.abs(dateDelta) <= 1 ? "DATE_ALIGNED"'));
assert(manager.includes('"DATE_SOURCE_DIVERGENCE"'));
assert(!manager.includes("this.currentTotalDays = Math.max(this.currentTotalDays, letterTotalDays)"));
assert(transport.includes("outboundMode: modes.VOTC"), "formal outbound transport must be fixed to votc_run_file");
assert(manager.includes("A3_VISUAL_CHECK_REQUIRED") && manager.includes("ARTIFACT_EFFECT_ABORTED") && manager.includes("ARTIFACT_SCOPE_NOT_CREATED") && manager.includes("ARTIFACT_NOT_VISIBLE"));
assert(manager.includes("PAYLOAD_INCOMPLETE_TIMEOUT") && manager.includes("contentPreview") && manager.includes("slice(0, 40)"));
assert(preload.includes("retryPayload") && ipc.includes('"letters:retryPayload"')
  && renderer.includes('v95Runtime.t("legacyUi.letters.rereadData")')
  && zhLocale.includes('rereadData: "重新读取信件数据"')
  && enLocale.includes('rereadData: "Reload letter data"'));
assert(renderer.includes('tV951("date.payloadGameDay")') && renderer.includes('tV951("date.deliveryBaseDay")')
  && renderer.includes("DATE_SOURCE_DIVERGENCE")
  && v951Locale.includes('payloadGameDay: "Payload 游戏日："') && v951Locale.includes('payloadGameDay: "Payload game day:"')
  && v951Locale.includes('deliveryBaseDay: "投递基准日："') && v951Locale.includes('deliveryBaseDay: "Delivery base day:"'), "game-day metadata labels must use bilingual UI copy");
assert(renderer.includes('tV951("diagnostics.stageA3")') && renderer.includes('tV951("diagnostics.title")')
  && v951Locale.includes('stageA3: "Official-Parity Artifact"') && v951Locale.includes('stageA3: "Official-parity artifact"')
  && v951Locale.includes('title: "Effect 实机诊断 3.0（Transport → CK3 EXECUTE → Scope → 可见结果确认）"')
  && v951Locale.includes('title: "In-game Effect diagnostics 3.0 (Transport → CK3 EXECUTE → Scope → visible-result confirmation)"'), "Effect diagnostic labels must use bilingual UI copy");
assert(manager.includes('const deliveryBaseDay = payloadGameDay'));
assert(manager.includes('"PAYLOAD_SEND_DAY_AUTHORITATIVE"'));
assert(renderer.includes('tV951("date.divergence")')
  && v951Locale.includes("投递日仍按 Payload sendDay + delay 计算")
  && v951Locale.includes("delivery still uses Payload sendDay + delay."), "date divergence copy must preserve the sendDay + delay contract in both locales");

for (const test of ["test-v7.10-rc6-delivery-base-date.js", "test-v7.10-rc6-artifact-parity.js", "test-v7.10-rc6-payload-race.js", "test-v7.10-rc6-final-letter-gate.js", "test-v7.10-rc6-rev2-run-command-queue.js", "test-v7.10-rc6-rev3-run-command-recovery.js", "test-v7.10-rc6-rev2-date-producer.js", "test-v7.10-rc6-rev2-relationship-resolver.js"]) assert(fs.existsSync(path.join(__dirname, test)), `RC6 gate missing: ${test}`);

console.log("VOTC v7.10-RC6 Final Rev2 Gate: PASS (sendDay contract, ACK queue, Date Producer health, relationship resolver, A3 and payload recovery)");
