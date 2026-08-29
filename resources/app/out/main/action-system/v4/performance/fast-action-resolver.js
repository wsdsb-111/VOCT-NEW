"use strict";

const LOCATION_PATTERNS = Object.freeze([
  ["throne_room", /(?:来到|进入|抵达|回到)(?:了)?(?:王座厅|御座厅|throne room)/i],
  ["council_chamber", /(?:来到|进入|抵达|回到)(?:了)?(?:议事厅|内阁厅|council chamber)/i],
  ["dungeon", /(?:来到|进入|抵达|回到)(?:了)?(?:地牢|牢房|dungeon)/i],
  ["garden", /(?:来到|进入|抵达|回到)(?:了)?(?:花园|庭园|garden)/i],
  ["bedchamber", /(?:来到|进入|抵达|回到)(?:了)?(?:卧室|寝宫|bedchamber)/i],
  ["tavern", /(?:来到|进入|抵达|回到)(?:了)?(?:酒馆|旅店|tavern)/i],
  ["battlefield", /(?:来到|进入|抵达|回到)(?:了)?(?:战场|battlefield)/i]
]);

const EMOTIONS = Object.freeze([
  ["happy", /(?:微笑|笑了|轻笑)/i],
  ["laugh", /(?:大笑|放声大笑)/i],
  ["crying", /(?:哭泣|流泪|抽泣)/i],
  ["anger", /(?:怒视|怒目而视)/i],
  ["drinking", /(?:饮酒|喝酒|饮茶|喝茶|一饮而尽)/i],
  ["praying", /(?:跪下祈祷|正在祈祷|诵经)/i]
]);
const SELF_REFERENCE = /(?:自己|本人|自身|myself|himself|herself|themselves)/i;

function exactNamedTarget(text, participants) {
  const matches = participants.filter((participant) => [participant.name, participant.shortName, participant.fullName].filter(Boolean).some((name) => String(text).includes(name)));
  return matches.length === 1 ? matches[0].id : null;
}

function catalogEntry(catalog, actionId, sourceId, targetId = null) {
  return catalog.entries.find((entry) => entry.actionId === actionId && Number(entry.sourceCharacterId) === Number(sourceId) && (targetId == null || entry.validTargetCharacterIds.includes(Number(targetId)))) || null;
}

function proposal(actionId, sourceCharacterId, targetCharacterId, argumentsValue, messageId) {
  return {
    type: "action_call",
    actionId,
    sourceCharacterId,
    targetCharacterId,
    arguments: argumentsValue,
    evidenceMessageIds: [messageId],
    confidence: 1
  };
}

function selfTarget(catalog, actionId, sourceId) {
  const entry = catalogEntry(catalog, actionId, sourceId, sourceId);
  return entry && ["self_only", "self_or_other"].includes(entry.targetPolicy) ? sourceId : null;
}

function resolve({ message, speaker, catalog }) {
  const text = String(message.content || "");
  const targetId = SELF_REFERENCE.test(text) ? speaker.id : exactNamedTarget(text, catalog.state.participants);
  const amount = /(?:支付|交给|给了?|付给)\s*(\d{1,7})\s*(?:枚|个)?金币/i.exec(text)?.[1] || /(\d{1,7})\s*(?:枚|个)?金币\s*(?:交给|给了?|付给)/i.exec(text)?.[1];
  if (amount) {
    if (targetId == null) return { status: "MAYBE", reason: "payment_target_not_unique" };
    const actionId = Number(speaker.id) === Number(catalog.state.playerId) ? "playerPaysGoldTo" : "paysGoldTo";
    if (!catalogEntry(catalog, actionId, speaker.id, targetId)) return { status: "MAYBE", reason: "payment_not_available" };
    return { status: "HIT", decision: proposal(actionId, speaker.id, targetId, { amount: Number(amount) }, message.id) };
  }
  const location = LOCATION_PATTERNS.find(([, pattern]) => pattern.test(text));
  if (location && catalogEntry(catalog, "changeLocation", speaker.id)) return { status: "HIT", decision: proposal("changeLocation", speaker.id, null, { location: location[0] }, message.id) };
  const emotion = EMOTIONS.find(([, pattern]) => pattern.test(text));
  if (emotion) {
    const resolvedTargetId = targetId ?? selfTarget(catalog, "setEmotion", speaker.id);
    if (resolvedTargetId == null) return { status: "MAYBE", reason: "pose_target_not_unique" };
    if (catalogEntry(catalog, "setEmotion", speaker.id, resolvedTargetId)) return { status: "HIT", decision: proposal("setEmotion", speaker.id, resolvedTargetId, { emotion: emotion[0] }, message.id) };
  }
  if (/(?:脱下|脱掉|褪下|解衣|宽衣).{0,12}(?:衣|袍|裙|衫|clothes|robe|dress)/i.test(text)) {
    const resolvedTargetId = targetId ?? selfTarget(catalog, "isUndressed", speaker.id);
    if (resolvedTargetId == null) return { status: "MAYBE", reason: "undress_target_not_unique" };
    if (catalogEntry(catalog, "isUndressed", speaker.id, resolvedTargetId)) return { status: "HIT", decision: proposal("isUndressed", speaker.id, resolvedTargetId, {}, message.id) };
  }
  return { status: "NONE", reason: "no_deterministic_match" };
}

module.exports = { LOCATION_PATTERNS, EMOTIONS, SELF_REFERENCE, exactNamedTarget, catalogEntry, selfTarget, proposal, resolve };
