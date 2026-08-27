"use strict";

const SOCIAL_EVENT_TYPES = Object.freeze([
  "physical_affection",
  "romantic_affection",
  "intimate_contact",
  "relationship_warming",
  "relationship_cooling",
  "romantic_proposal",
  "affection_rejection",
  "hostile_social_contact"
]);

const RULES = [
  { type: "affection_rejection", pattern: /(?:推开|躲开|避开|挣脱|甩开|拒绝|厌恶|皱眉退开|冷冷避开|不悦地推开)/i, valence: "negative", reaction: "rejected", intensity: "medium" },
  { type: "romantic_proposal", pattern: /(?:(?:可以|能否|可否|愿意|让我).{0,8}(?:亲吻|吻|拥抱|抱抱|牵手)|(?:求你|请你).{0,8}(?:吻|抱|牵手)|(?:示爱|告白).{0,8}(?:吗|么|可好))/i, valence: "positive", reaction: "unclear", intensity: "low" },
  { type: "romantic_affection", pattern: /(?:亲吻|接吻|吻了|吻住|吻上|示爱|告白|调情|含情脉脉)/i, valence: "positive", reaction: "unclear", intensity: "medium" },
  { type: "physical_affection", pattern: /(?:拥抱|抱住|搂住|牵手|握住(?:他|她|你|我)?的?手|依偎|靠在(?:他|她|你|我)?怀里|轻抚|抚摸)/i, valence: "positive", reaction: "unclear", intensity: "low" },
  { type: "intimate_contact", pattern: /(?:爱抚|舔舐|舔弄|吮吸|含住|揉捏|揉搓|顶入|插入|抽送|抽插)/i, valence: "positive", reaction: "unclear", intensity: "high" }
];

function detect(text, evidence) {
  const source = String(text || "");
  const matched = RULES.find((rule) => rule.pattern.test(source));
  if (!matched) return null;
  const accepted = /(?:笑着回应|欣然回应|主动回应|回吻|回抱|紧紧抱住|也握住|靠得更近)/.test(source);
  return {
    eventId: `social_${evidence?.start ?? 0}_${matched.type}`,
    type: matched.type,
    actorCharacterId: null,
    patientCharacterId: null,
    evidence,
    occurrence: matched.type === "romantic_proposal" ? "proposal" : "completed_action",
    valence: matched.valence,
    intensity: matched.intensity,
    reaction: matched.reaction === "rejected" ? "rejected" : accepted ? "accepted" : matched.reaction,
    confidence: accepted || matched.type === "affection_rejection" ? 0.95 : 0.88,
    candidateActionIds: []
  };
}

module.exports = { SOCIAL_EVENT_TYPES, detect };
