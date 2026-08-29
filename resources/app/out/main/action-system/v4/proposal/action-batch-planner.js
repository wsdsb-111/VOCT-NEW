"use strict";

const FRIENDLY = new Set(["becomeFriendsWith", "becomeBestFriendsWith", "becomeLoversWith", "becomeSoulmatesWith", "becomeBloodBrothersWith"]);
const HOSTILE = new Set(["becomeRivalsWith", "becomeNemesisWith"]);

function pairKey(item) {
  const ids = [Number(item.proposal.sourceCharacterId), Number(item.proposal.targetCharacterId)].sort((a, b) => a - b);
  return `${ids[0]}:${ids[1]}`;
}

function conflict(left, right) {
  if (pairKey(left) !== pairKey(right)) return false;
  return (FRIENDLY.has(left.proposal.actionId) && HOSTILE.has(right.proposal.actionId)) || (HOSTILE.has(left.proposal.actionId) && FRIENDLY.has(right.proposal.actionId));
}

function plan(validated) {
  const unique = [];
  const rejected = [];
  const keys = new Set();
  for (const item of validated.slice(0, 3)) {
    const key = `${item.proposal.actionId}:${item.proposal.sourceCharacterId}:${item.proposal.targetCharacterId ?? "none"}:${JSON.stringify(item.proposal.arguments || {})}`;
    if (keys.has(key)) {
      rejected.push({ item, reason: "duplicate_suppressed" });
      continue;
    }
    keys.add(key);
    unique.push(item);
  }
  const conflicted = new Set();
  for (let left = 0; left < unique.length; left++) {
    for (let right = left + 1; right < unique.length; right++) {
      if (conflict(unique[left], unique[right])) {
        conflicted.add(left);
        conflicted.add(right);
      }
    }
  }
  const executable = unique.filter((item, index) => {
    if (!conflicted.has(index)) return true;
    rejected.push({ item, reason: "conflict_suppressed" });
    return false;
  });
  const ordered = [];
  const remaining = [...executable];
  while (remaining.length > 0) {
    const readyIndex = remaining.findIndex((item) => item.entry.metadata.dependencies.every((dependency) => ordered.some((parent) => parent.proposal.actionId === dependency) || !remaining.some((candidate) => candidate.proposal.actionId === dependency)));
    ordered.push(...remaining.splice(readyIndex >= 0 ? readyIndex : 0, 1));
  }
  return { executable: ordered, rejected };
}

module.exports = { FRIENDLY, HOSTILE, pairKey, conflict, plan };
