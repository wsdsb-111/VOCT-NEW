"use strict";

const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { planEvidence, coverageProof, validCoverageProof } = require("../src/app/main/memory-system/memory4-evidence-planner");
const { hash } = require("../src/app/main/memory-system/memory4-contract");

// Human-labelled input priorities; a ranking label never certifies extraction quality.
const important = ["听闻襄阳三日前失守，消息尚未证实。", "十年前曾随父亲逃离汴京，日子不明。",
  "若北伐成功，朕答应恢复你的兵权。", "摸了摸刀柄，昨晚我在城门看到刺客。", "他拔刀刺伤使臣，当场被捕。",
  "没想到是你，旧约已正式取消。", "我的秘密是我曾帮助敌人。", "婚约已经破裂。", "此项承诺尚未履行。",
  "我们决定明年出征。", "我回忆起母亲去世时的情形。", "有人据说他是敌人的盟友。", "任务已经失败。",
  "他改变计划，决定迁居。", "皇帝给了我三百金币。", "他并没有叛变。", "I heard the city fell; this is unconfirmed.",
  "I remember fleeing the capital ten years ago.", "If we win, I promise to restore your command.", "He stabbed the envoy and was arrested.",
  "The marriage was cancelled.", "She revealed a secret.", "I never fulfilled that promise.", "We plan to travel next year.",
  "The mission failed.", "I do not know when my father died.", "据传旧城被攻陷。", "这份婚约作废。",
  "他不是我的父亲。", "当时我已经决定逃离。"];
const noise = ["你好", "你好，今日天气不错。", "您好", "再见", "谢谢", "晚安", "我微笑。", "我点头。", "我挠挠头。", "hello", "goodbye", "hi", "thank you"];
const fragment = (text, i) => ({ fragmentId: `f-${i}`, messageId: i, text, speakerId: 1,
  presentIds: [1, 2], knownBy: [2], entityIds: [1], sourceType: "spoken" });
function snapshot(fragments) { return { ownerId: 2, campaignToken: "fixture", sourceRevision: hash(fragments), completeness: "complete", fragments }; }
let candidates = 0, noiseInPriority = 0;
for (const [i, text] of important.entries()) {
  const plan = planEvidence(snapshot([fragment(text, i)]));
  assert(["P0", "P1"].includes(plan.rows[0].priority), text); candidates++;
}
for (const [i, text] of noise.entries()) {
  const plan = planEvidence(snapshot([fragment(text, i)]));
  assert.equal(plan.rows[0].priority, "NOISE_LIKELY", text);
  if (["P0", "P1"].includes(plan.rows[0].priority)) noiseInPriority++;
}
const comparisons = [];
for (let i = 0; i < 10; i++) {
  const count = 100 + i * 20;
  const fragments = Array.from({ length: count }, (_, n) => fragment(n % 2 ? "你好" : "我点头。", n));
  const marked = [2, Math.floor(count / 2), count - 1];
  marked.forEach((position, n) => { fragments[position].text = important[(i + n) % important.length]; });
  const state = snapshot(fragments), before = hash(state);
  const plan = planEvidence(state);
  assert.equal(hash(state), before, "planner never edits authority");
  assert.equal(new Set(plan.orderedFragmentIds).size, count);
  assert.equal(plan.locallyExcludedSourceCount, 0);
  assert(marked.every(position => plan.orderedFragmentIds.slice(0, 8).includes(`f-${position}`)), "head/middle/tail priority");
  comparisons.push({ count, baselineFirst8Important: marked.filter(position => position < 8).length, plannedFirst8Important: 3 });
  const proof = coverageProof(state, plan.orderedFragmentIds.slice(0, 20), 8);
  const record = { sourceRevision: state.sourceRevision, evaluatedFragmentCount: 20, entryIds: Array(8).fill("test") };
  assert(validCoverageProof(proof, record, state));
  assert.equal(proof.coverageState, "CAPPED");
  const partial = coverageProof(state, plan.orderedFragmentIds.slice(0, 20), 2);
  assert.equal(partial.coverageState, "PARTIAL_SOURCE");
  assert.equal(proof.unmodeledSourceCount, count - 20);
}
const duplicate = snapshot([fragment("婚约已取消", 1), { ...fragment("婚约已取消", 2), speakerId: 3 }]);
assert.equal(planEvidence(duplicate).orderedFragmentIds.length, 2);
const unknown = snapshot([fragment("那座旧居的往事依然鲜明。", 1)]);
assert.equal(planEvidence(unknown).rows[0].priority, "P2");
const huge = snapshot(Array.from({ length: 10000 }, (_, i) => fragment(i % 97 === 0 ? important[0] : "你好", i)));
const coldStart = performance.now(); planEvidence(huge); const coldMs = performance.now() - coldStart;
const warmStart = performance.now(); for (let i = 0; i < 5; i++) planEvidence(huge); const warmMs = (performance.now() - warmStart) / 5;
console.log(JSON.stringify({ smallFixtures: important.length + noise.length, longFixtures: comparisons.length,
  highValueCandidateRecall: candidates / important.length, noisePriorityFalsePositive: noiseInPriority / noise.length,
  comparisons, profiler: { sources: 10000, coldMs, warmMs }, modelRequests: 0 }));
console.log("V9.3.3 evidence planner: PASS");
