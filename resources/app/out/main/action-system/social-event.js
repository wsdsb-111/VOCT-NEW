"use strict";

const SOCIAL_EVENT_TYPES = Object.freeze([
  "physical_affection",
  "romantic_affection",
  "intimate_contact",
  "relationship_warming",
  "relationship_cooling",
  "romantic_proposal",
  "affection_rejection",
  "hostile_social_contact",
  "gratitude",
  "praise",
  "trust",
  "comfort",
  "help",
  "rescue",
  "betrayal_signal",
  "humiliation",
  "threat",
  "hate",
  "revenge",
  "relationship_statement",
  "explicit_emotional_shift",
  "insult",
  "polite_positive"
]);

const RULES = [
  { type: "affection_rejection", pattern: /(?:推开|躲开|避开|挣脱|甩开|拒绝|厌恶|皱眉退开|冷冷避开|不悦地推开)/i, valence: "negative", reaction: "rejected", intensity: "medium" },
  { type: "romantic_proposal", pattern: /(?:(?:可以|能否|可否|愿意|让我).{0,8}(?:亲吻|吻|拥抱|抱抱|牵手)|(?:求你|请你).{0,8}(?:吻|抱|牵手)|(?:示爱|告白).{0,8}(?:吗|么|可好))/i, valence: "positive", reaction: "unclear", intensity: "low" },
  { type: "romantic_affection", pattern: /(?:亲吻|接吻|吻了|吻住|吻上|示爱|告白|调情|含情脉脉)/i, valence: "positive", reaction: "unclear", intensity: "medium" },
  { type: "physical_affection", pattern: /(?:拥抱|抱住|搂住|牵手|握住(?:他|她|你|我)?的?手|依偎|靠在(?:他|她|你|我)?怀里|轻抚|抚摸)/i, valence: "positive", reaction: "unclear", intensity: "low" },
  { type: "intimate_contact", pattern: /(?:爱抚|舔舐|舔弄|吮吸|含住|揉捏|揉搓|顶入|插入|抽送|抽插)/i, valence: "positive", reaction: "unclear", intensity: "high" }
];

const SIGNAL_RULES = [
  { type: "rescue", pattern: /(?:救我性命|救了我(?:一命|性命)|救命之恩|救了(?:我的)?(?:孩子|父亲|母亲|兄弟|姐妹))/i, valence: "positive", intensity: "high", confidence: 0.94 },
  { type: "gratitude", pattern: /(?:多谢|谢谢|感激|感恩|此恩|承蒙|有劳)/i, valence: "positive", intensity: "medium", confidence: 0.93 },
  { type: "praise", pattern: /(?:你真|您真|实在是|堪称).{0,10}(?:勇敢|聪明|仁慈|善良|可靠|了不起|英明|优秀)|(?:佩服|敬佩|钦佩)/i, valence: "positive", intensity: "medium", confidence: 0.9 },
  { type: "comfort", pattern: /(?:别怕|莫怕|不要难过|不必难过|我会陪着你|我陪你|节哀|保重)/i, valence: "positive", intensity: "medium", confidence: 0.88 },
  { type: "help", pattern: /(?:我来帮你|我会帮你|交给我|助你一臂之力|替你解决|为你解围)/i, valence: "positive", intensity: "medium", confidence: 0.86 },
  { type: "trust", pattern: /(?:我信任你|我相信你|可以信赖你|值得信任)/i, valence: "positive", intensity: "medium", confidence: 0.88 },
  { type: "betrayal_signal", pattern: /(?:背叛|出卖|欺骗了我|辜负了我)/i, valence: "negative", intensity: "high", confidence: 0.9 },
  { type: "humiliation", pattern: /(?:当众|众目睽睽).{0,12}(?:羞辱|羞耻|出丑|跪下)|(?:公开羞辱|奇耻大辱)/i, valence: "negative", intensity: "high", confidence: 0.92 },
  { type: "threat", pattern: /(?:我要|我会|定要|必将|迟早要).{0,14}(?:杀了你|杀死你|宰了你|要你命|杀了你父亲|杀了你母亲)|(?:让你|叫你).{0,10}(?:不得好死|付出代价)/i, valence: "negative", intensity: "high", confidence: 0.93 },
  { type: "hate", pattern: /(?:我恨你|我憎恨你|与你不共戴天|永远不会原谅你|不可原谅)/i, valence: "negative", intensity: "high", confidence: 0.94 },
  { type: "revenge", pattern: /(?:我要报仇|定要报仇|为.{0,8}报仇|血债血偿)/i, valence: "negative", intensity: "high", confidence: 0.94 },
  { type: "relationship_statement", pattern: /(?:我们|你我|彼此|两人|二人).{0,12}(?:正式成为|结为|便是|就是|已是).{0,8}(?:朋友|挚友|至交|情人|恋人|灵魂伴侣|仇敌|死敌|宿敌|结义兄弟)|(?:结拜|义结金兰|义结兄弟)/i, valence: "neutral", intensity: "high", confidence: 0.94 },
  { type: "explicit_emotional_shift", pattern: /(?:从今以后|从此).{0,10}(?:信任你|敬重你|厌恶你|憎恨你|不再相信你)/i, valence: "neutral", intensity: "medium", confidence: 0.88 },
  { type: "insult", pattern: /(?:卑鄙|无耻|蠢货|废物|混账|小人|贱人|懦夫)|(?:已经|早就).{0,8}(?:(?:杀了|害死).{0,6}(?:你父亲|你母亲)|(?:你父亲|你母亲).{0,6}(?:杀了|害死))/i, valence: "negative", intensity: "medium", confidence: 0.9 },
  { type: "polite_positive", pattern: /(?:请多关照|幸会|久仰|劳驾)/i, valence: "positive", intensity: "low", confidence: 0.82 }
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

function detectSignals(text, evidence) {
  const source = String(text || "");
  const signals = SIGNAL_RULES.filter((rule) => rule.pattern.test(source)).map((rule, index) => ({
    eventId: `social_signal_${evidence?.start ?? 0}_${rule.type}_${index}`,
    type: rule.type,
    valence: rule.valence,
    intensity: rule.intensity,
    reaction: "unclear",
    evidence,
    confidence: rule.confidence
  }));
  const affection = detect(source, evidence);
  if (affection) signals.push(affection);
  return signals;
}

module.exports = { SOCIAL_EVENT_TYPES, detect, detectSignals };
