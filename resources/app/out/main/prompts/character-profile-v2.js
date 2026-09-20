"use strict";

const { getCachedKinshipGraph } = require("../worldline/kinship-graph-cache");

const BLOOD_KINSHIP_TYPES = new Set([
  "PARENT_OF",
  "CHILD_OF",
  "SIBLING_OF",
  "GRANDPARENT_OF",
  "AUNT_UNCLE_OF",
  "NIECE_NEPHEW_OF",
  "COUSIN_OF"
]);

const DYNAMIC_TRAIT_PATTERN = /health|disease|illness|sick|wound|injur|pregnan|fatigue|stress|coping|reputation|fame|tyrant|kinslayer|adulter|criminal|drunkard|病|伤|怀孕|疲劳|压力|应激|名声|暴君|弑亲|通奸|罪犯|臭名|酒鬼/i;
const STABLE_TRAIT_PATTERN = /personality|congenital|physique|lifestyle|education|origin|commander|combat|martial|性格|先天|体质|生活方式|教育|出身|指挥|战斗/i;

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeSex(character = {}) {
  if (character.gender === "male" || character.sheHe === "他") return "male";
  if (character.gender === "female" || character.sheHe === "她") return "female";
  return "unknown";
}

function normalizeTrait(trait = {}) {
  return {
    name: textOrNull(trait.name),
    category: textOrNull(trait.category),
    description: textOrNull(trait.desc ?? trait.description)
  };
}

function classifyTraits(traits = []) {
  const stable = {
    personalityTraits: [],
    congenitalTraits: [],
    lifestyleTraits: [],
    originTraits: [],
    combatTraits: []
  };
  const dynamic = { healthTraits: [], reputationTraits: [], stressTraits: [], otherTraits: [] };
  for (const rawTrait of Array.isArray(traits) ? traits : []) {
    const trait = normalizeTrait(rawTrait);
    if (!trait.name) continue;
    const descriptor = `${trait.category || ""} ${trait.name}`;
    if (DYNAMIC_TRAIT_PATTERN.test(descriptor)) {
      if (/stress|coping|drunkard|压力|应激|酒鬼/i.test(descriptor)) dynamic.stressTraits.push(trait);
      else if (/reputation|fame|tyrant|kinslayer|adulter|criminal|名声|暴君|弑亲|通奸|罪犯|臭名/i.test(descriptor)) dynamic.reputationTraits.push(trait);
      else dynamic.healthTraits.push(trait);
      continue;
    }
    if (!STABLE_TRAIT_PATTERN.test(descriptor)) {
      dynamic.otherTraits.push(trait);
      continue;
    }
    if (/personality|性格/i.test(descriptor)) stable.personalityTraits.push(trait);
    else if (/congenital|physique|先天|体质/i.test(descriptor)) stable.congenitalTraits.push(trait);
    else if (/lifestyle|education|生活方式|教育/i.test(descriptor)) stable.lifestyleTraits.push(trait);
    else if (/origin|出身/i.test(descriptor)) stable.originTraits.push(trait);
    else stable.combatTraits.push(trait);
  }
  return { stable, dynamic };
}

function buildStableKinship(character, gameData) {
  if (!character?.id || !gameData) return [];
  const graph = getCachedKinshipGraph(gameData);
  const relations = [];
  for (const edge of graph.relationsTo(character.id)) {
    if (!BLOOD_KINSHIP_TYPES.has(edge.type)) continue;
    const relative = graph.nodes.get(edge.from) || graph.nodes.get(String(edge.from)) || {};
    const resolved = graph.relationBetween(edge.from, character.id)?.relation || edge;
    relations.push({
      runtimeId: numericOrNull(edge.from) ?? String(edge.from),
      name: textOrNull(relative.shortName || relative.firstName) || `#${edge.from}`,
      sex: resolved.sex || normalizeSex(relative),
      kinshipType: resolved.label || edge.type
    });
  }
  return relations.sort((left, right) => String(left.kinshipType).localeCompare(String(right.kinshipType)) || String(left.runtimeId).localeCompare(String(right.runtimeId)));
}

function createStableProfile(character = {}, gameData = null) {
  const classified = classifyTraits(character.traits);
  return {
    id: numericOrNull(character.id) ?? textOrNull(character.id),
    name: textOrNull(character.shortName || character.firstName),
    sex: normalizeSex(character),
    age: numericOrNull(character.age),
    house: textOrNull(character.house),
    origin: character.house ? null : "lowborn",
    culture: textOrNull(character.culture),
    faith: textOrNull(character.faith),
    sexuality: textOrNull(character.sexuality),
    personality: textOrNull(character.personality),
    personalityCore: {
      boldness: numericOrNull(character.boldness),
      compassion: numericOrNull(character.compassion),
      energy: numericOrNull(character.energy),
      greed: numericOrNull(character.greed),
      honor: numericOrNull(character.honor),
      rationality: numericOrNull(character.rationality),
      sociability: numericOrNull(character.sociability),
      vengefulness: numericOrNull(character.vengefulness),
      zeal: numericOrNull(character.zeal)
    },
    ...classified.stable,
    stableKinship: buildStableKinship(character, gameData)
  };
}

function createLiveProfile(character = {}, gameData = null, activeParticipantIds = []) {
  const classified = classifyTraits(character.traits);
  return {
    fullName: textOrNull(character.fullName),
    gold: numericOrNull(character.gold),
    prestige: character.prestige ?? null,
    piety: character.piety ?? null,
    stress: character.stress ?? null,
    health: character.health ?? null,
    titles: [character.primaryTitle, character.titleRankConcept].map(textOrNull).filter(Boolean),
    positions: textOrNull(character.heldCourtAndCouncilPositions),
    modifiers: Array.isArray(character.modifiers) ? character.modifiers : [],
    ...classified.dynamic,
    relationships: {
      opinionOfPlayer: numericOrNull(character.opinionOfPlayer),
      relationsToPlayer: Array.isArray(character.relationsToPlayer) ? character.relationsToPlayer : [],
      relationsToCharacters: Array.isArray(character.relationsToCharacters) ? character.relationsToCharacters : [],
      liege: textOrNull(character.liege),
      consort: textOrNull(character.consort)
    },
    location: textOrNull(character.location || gameData?.location),
    scene: textOrNull(gameData?.scene),
    presence: [...new Set((activeParticipantIds || []).map(Number).filter(Number.isFinite))]
  };
}

function formatTraitNames(traits = []) {
  return traits.map((trait) => trait.name).filter(Boolean).join("、") || "无";
}

function formatStableProfile(profile) {
  const core = Object.entries(profile.personalityCore || {}).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join("；") || "无";
  return `=== Responder Frozen Profile v2 ===
- Runtime ID：${profile.id ?? "未知"}
- 姓名：${profile.name || "未知"}
- 性别：${profile.sex === "male" ? "男性" : profile.sex === "female" ? "女性" : "未知"}
- 年龄：${profile.age ?? "未知"}
- 家族／出身：${profile.house || profile.origin || "未知"}
- 文化：${profile.culture || "未知"}
- 信仰：${profile.faith || "未知"}
- 性取向：${profile.sexuality || "未知"}
- 性格：${profile.personality || "未知"}
- 性格核心：${core}
- 性格特质：${formatTraitNames(profile.personalityTraits)}
- 先天／体质特质：${formatTraitNames(profile.congenitalTraits)}
- 生活方式特质：${formatTraitNames(profile.lifestyleTraits)}
- 出身特质：${formatTraitNames(profile.originTraits)}
- 战斗特质：${formatTraitNames(profile.combatTraits)}`;
}

function formatStableKinship(profile) {
  const kinship = profile.stableKinship.length > 0
    ? profile.stableKinship.map((relative) => `- ${relative.kinshipType}：${relative.name}（Runtime ID：${relative.runtimeId}；性别：${relative.sex === "male" ? "男性" : relative.sex === "female" ? "女性" : "未知"}）`).join("\n")
    : "- 无已绑定的稳定血亲资料";
  return `=== Responder Stable Blood Kinship ===\n${kinship}`;
}

function formatLiveProfile(profile) {
  return `=== Live Character State v2（本轮 CK3 数据） ===
- 当前全名／称号：${profile.fullName || "未知"}
- 财富：${profile.gold ?? "未知"}
- 威望：${profile.prestige ?? "未知"}
- 虔诚：${profile.piety ?? "未知"}
- 压力：${profile.stress == null ? "未知" : JSON.stringify(profile.stress)}
- 健康：${profile.health ?? "未知"}
- 头衔：${profile.titles.join("、") || "无"}
- 职位：${profile.positions || "无"}
- 健康特质：${formatTraitNames(profile.healthTraits)}
- 名声特质：${formatTraitNames(profile.reputationTraits)}
- 压力特质：${formatTraitNames(profile.stressTraits)}
- 其他动态特质：${formatTraitNames(profile.otherTraits)}
- 对玩家好感：${profile.relationships.opinionOfPlayer ?? "未知"}
- 领主：${profile.relationships.liege || "无"}
- 配偶／伴侣：${profile.relationships.consort || "无"}
- 地点：${profile.location || "未知"}
- 场景：${profile.scene || "未知"}
- 在场 Runtime ID：${profile.presence.join("、") || "无"}`;
}

module.exports = {
  BLOOD_KINSHIP_TYPES,
  classifyTraits,
  buildStableKinship,
  createStableProfile,
  createLiveProfile,
  formatStableProfile,
  formatStableKinship,
  formatLiveProfile
};
