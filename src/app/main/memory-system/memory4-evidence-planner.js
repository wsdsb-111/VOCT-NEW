"use strict";

const { hash, ids } = require("./memory4-contract");

const PLANNER_VERSION = "9.3.3-ranking-1";
const MAJOR = /承诺|答应|条件|兑现|履行|取消|废除|婚约|婚姻|成婚|离婚|死亡|去世|刺伤|杀死|被捕|失守|攻陷|兵权|秘密|背叛|promise|pledge|condition|fulfill|cancel|marri|divorc|died|death|stab|arrest|fell|captur|secret|betray/i;
const EVIDENCE = /听闻|据说|传闻|谣言|回忆|记得|曾|年前|昨晚|决定|计划|任务|战事|出征|逃离|迁居|关系|盟友|敌人|身份|金币|金钱|不|没|未|但|\d|heard|rumou?r|recall|remember|ago|last night|decid|plan|mission|war|fled|travel|ally|enemy|identity|gold|not|never|but/i;
const GREETING = /^(?:你好[，,\s]*(?:今日天气不错)?|您好|再见|谢谢|晚安|hello|hi|goodbye|thank you|good night)[。.!！\s]*$/i;
const GESTURE = /^(?:我|他|她)?[（(]?(?:点头|微笑|挠挠?头|转身|端起茶杯|摸了摸[刀剑]柄|nods?|smiles?|scratches? (?:his |her |my )?head)[）)。.!！\s]*$/i;

// This is input priority, never a fact classifier or a permission grant.
function planEvidence(snapshot, fragments = snapshot.fragments) {
  const changedEntities = new Set(ids(snapshot.relationshipChangeEntityIds));
  const bucketCount = Math.min(6, Math.max(1, Math.ceil(fragments.length / 32)));
  const repeated = new Set();
  const rows = fragments.map((fragment, originalIndex) => {
    const text = String(fragment.text || "");
    const relationshipChange = (fragment.entityIds || []).some(id => changedEntities.has(id));
    const standaloneNoise = GREETING.test(text.trim()) || GESTURE.test(text.trim());
    let priority = relationshipChange || MAJOR.test(text) ? "P0"
      : standaloneNoise && !fragment.eventDate && !["game_fact", "witnessed", "reported", "rumor"].includes(fragment.sourceType) ? "NOISE_LIKELY"
      : EVIDENCE.test(text) || ["reported", "rumor", "game_fact", "witnessed"].includes(fragment.sourceType)
        || fragment.eventDate ? "P1"
      : "P2";
    // Preserve every source identity, including repeated text from other dates/speakers.
    const duplicateText = repeated.has(text);
    repeated.add(text);
    if (duplicateText && priority === "P2") priority = "NOISE_LIKELY";
    return { fragmentId: fragment.fragmentId, originalIndex,
      bucket: Math.min(bucketCount - 1, Math.floor(originalIndex * bucketCount / Math.max(1, fragments.length))),
      priority, uncertain: priority === "P2", duplicateText };
  });
  const ordered = [];
  for (const priority of ["P0", "P1", "P2", "NOISE_LIKELY"]) {
    const buckets = Array.from({ length: bucketCount }, () => []);
    for (const row of rows) if (row.priority === priority) buckets[row.bucket].push(row);
    for (let position = 0; buckets.some(bucket => position < bucket.length); position++) {
      for (const bucket of buckets) if (position < bucket.length) ordered.push(bucket[position]);
    }
  }
  const originalOrder = rows.map(row => row.fragmentId);
  const orderedFragmentIds = ordered.map(row => row.fragmentId);
  const sourceDigest = hash(fragments);
  const plan = { version: PLANNER_VERSION, sourceDigest, originalOrder, orderedFragmentIds, rows,
    authorizedSourceCount: fragments.length, screenedSourceCount: fragments.length,
    plannedSourceCount: fragments.length, locallyExcludedSourceCount: 0,
    noiseLikelySourceCount: rows.filter(row => row.priority === "NOISE_LIKELY").length,
    uncertainSourceCount: rows.filter(row => row.uncertain).length, bucketCount };
  return { ...plan, checksum: hash(plan) };
}

function coverageProof(snapshot, evaluatedSourceIds, committedEntryCount) {
  const plan = planEvidence(snapshot);
  const evaluated = [...new Set(evaluatedSourceIds)];
  const capReached = committedEntryCount === 8 && evaluated.length < plan.authorizedSourceCount;
  const proof = { version: 1, plannerVersion: PLANNER_VERSION, policyVersion: "9.3.3",
    ownerId: snapshot.ownerId, campaignToken: snapshot.campaignToken, conversationId: snapshot.conversationId,
    finalizationId: snapshot.finalizationId,
    sourceRevision: snapshot.sourceRevision, sourceDigest: plan.sourceDigest, planChecksum: plan.checksum,
    authorizedSourceCount: plan.authorizedSourceCount, screenedSourceCount: plan.screenedSourceCount,
    plannedSourceCount: plan.plannedSourceCount, modelEvaluatedSourceCount: evaluated.length,
    unmodeledSourceCount: plan.authorizedSourceCount - evaluated.length,
    locallyExcludedSourceCount: 0, noiseLikelySourceCount: plan.noiseLikelySourceCount,
    uncertainSourceCount: plan.uncertainSourceCount, committedEntryCount, capReached,
    evaluatedSourceIds: evaluated,
    coverageState: evaluated.length < plan.authorizedSourceCount ? capReached ? "CAPPED" : "PARTIAL_SOURCE"
      : snapshot.completeness !== "complete" ? "PARTIAL_SOURCE"
      : committedEntryCount ? "FULL_MODEL_EVALUATED" : "NO_DURABLE_CONTENT_VERIFIED" };
  return { ...proof, checksum: hash(proof) };
}

function validCoverageProof(proof, record, snapshot = null) {
  if (!proof || proof.version !== 1 || proof.plannerVersion !== PLANNER_VERSION || proof.policyVersion !== "9.3.3") return false;
  const { checksum, ...body } = proof;
  const counters = [proof.authorizedSourceCount, proof.screenedSourceCount, proof.plannedSourceCount,
    proof.modelEvaluatedSourceCount, proof.unmodeledSourceCount, proof.locallyExcludedSourceCount,
    proof.noiseLikelySourceCount, proof.uncertainSourceCount, proof.committedEntryCount];
  const capped = proof.committedEntryCount === 8 && proof.unmodeledSourceCount > 0;
  const states = proof.unmodeledSourceCount > 0 ? [capped ? "CAPPED" : "PARTIAL_SOURCE"]
    : record.completeness !== "complete" ? ["PARTIAL_SOURCE"]
    : [proof.committedEntryCount ? "FULL_MODEL_EVALUATED" : "NO_DURABLE_CONTENT_VERIFIED"];
  if (checksum !== hash(body) || proof.sourceRevision !== record.sourceRevision
    || counters.some(count => !Number.isSafeInteger(count) || count < 0)
    || proof.committedEntryCount > 8 || proof.capReached !== capped || !states.includes(proof.coverageState)
    || proof.noiseLikelySourceCount + proof.uncertainSourceCount > proof.authorizedSourceCount
    || !/^[a-f0-9]{64}$/.test(proof.sourceDigest || "") || !/^[a-f0-9]{64}$/.test(proof.planChecksum || "")
    || proof.modelEvaluatedSourceCount !== record.evaluatedFragmentCount
    || proof.committedEntryCount !== record.entryIds?.length
    || !Array.isArray(proof.evaluatedSourceIds) || proof.evaluatedSourceIds.some(id => typeof id !== "string" || !id)
    || new Set(proof.evaluatedSourceIds).size !== proof.evaluatedSourceIds.length
    || proof.evaluatedSourceIds.length !== proof.modelEvaluatedSourceCount
    || proof.authorizedSourceCount !== proof.screenedSourceCount || proof.authorizedSourceCount !== proof.plannedSourceCount
    || proof.locallyExcludedSourceCount !== 0 || proof.unmodeledSourceCount !== proof.authorizedSourceCount - proof.modelEvaluatedSourceCount
    || proof.modelEvaluatedSourceCount < 0 || proof.unmodeledSourceCount < 0) return false;
  if (!snapshot) return true;
  const expected = coverageProof(snapshot, proof.evaluatedSourceIds, proof.committedEntryCount);
  const authorized = new Set(snapshot.fragments.map(fragment => fragment.fragmentId));
  return hash(expected) === hash(proof) && proof.evaluatedSourceIds.every(id => authorized.has(id));
}

module.exports = { PLANNER_VERSION, planEvidence, coverageProof, validCoverageProof };
