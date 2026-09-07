"use strict";

const { resolveCharacterAge } = require("./character-age-service");
const { normalizeSpouseRecords } = require("./canonical-spouse-record");
const { getCachedKinshipGraph } = require("./kinship-graph-cache");
const { formatDeathFact } = require("./character-temporal-facts");
const { resolveKinshipLabel } = require("./kinship-label-resolver");
const { resolveCharacterSex } = require("./character-demographic-normalizer");

const DISPLAY_TYPES = new Set(["PARENT_OF", "CHILD_OF", "SIBLING_OF", "GRANDPARENT_OF", "AUNT_UNCLE_OF", "NIECE_NEPHEW_OF", "COUSIN_OF", "SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"]);

function characterName(character, id) {
  return character?.fullName || character?.shortName || character?.firstName || character?.name || `#${id}`;
}

function formatStructuredCharacter(character = {}, current = null, characters = null) {
  const temporal = current && typeof current === "object" ? current : { currentGameDate: current };
  const id = String(character.id ?? "");
  const name = characterName(character, id);
  const sex = resolveCharacterSex({ snapshot: character });
  const age = resolveCharacterAge(character, temporal);
  const death = formatDeathFact(character, { ...temporal, characters });
  const parts = [`${name} (#${id || "未知"})`, `性别：${sex.sex === "male" ? "男性" : sex.sex === "female" ? "女性" : "未知"}`];
  if (age.age !== null) parts.push(`${age.label === "ageAtDeath" ? "去世年龄" : "年龄"}：${age.age}岁`);
  if (death) parts.push(death.text);
  else if (character.alive === true) parts.push("在世");
  if (character.location) parts.push(`当前位置：${character.location}`);
  return { text: parts.join("；"), diagnostics: { sexSource: sex.source, ageSource: age.source, ageConflict: age.conflict, death: death?.fact || null } };
}

function buildFamilyFactBlock(character, gameData) {
  if (!character?.id || !gameData) return null;
  const graph = getCachedKinshipGraph(gameData);
  const temporal = { currentGameDate: gameData.date, currentTotalDays: gameData.totalDays };
  const relations = graph.relationsTo(character.id).filter((edge) => DISPLAY_TYPES.has(edge.type));
  const seen = new Set();
  const lines = [];
  for (const edge of relations) {
    const key = `${edge.from}:${edge.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const relative = graph.nodes.get(edge.from) || {};
    const resolution = graph.relationBetween(edge.from, character.id);
    if (!resolution.relation) continue;
    const sex = resolveCharacterSex({ snapshot: relative });
    const label = resolveKinshipLabel({ type: edge.type, sex: sex.sex, branch: edge.branch });
    const death = formatDeathFact(relative, { ...temporal, characters: graph.nodes });
    const age = resolveCharacterAge(relative, temporal);
    const details = [];
    if (death) details.push(death.text);
    else if (relative.alive === true) details.push("在世");
    if (!death && age.age !== null) details.push(`${age.age}岁`);
    lines.push(`- ${label}：${characterName(relative, edge.from)}${details.length ? `（${details.join("；")}）` : ""}`);
  }
  for (const spouse of normalizeSpouseRecords(character).filter((record) => record.runtimeId === null && record.name)) {
    lines.push(`- 配偶/伴侣（未绑定角色）：${spouse.name}`);
  }
  if (!lines.length) return null;
  return `=== 当前结构化家庭事实（本轮 CK3 数据） ===\n${lines.join("\n")}\n权威规则：亲属身份、性别、是否已故、死亡日期、致死者与年龄只能服从本块结构化结果；相对时间只能使用系统给出的结果。Memory 只可补充过去经历与主观感受，不得覆盖这些事实。`;
}

module.exports = { buildFamilyFactBlock, formatStructuredCharacter };
