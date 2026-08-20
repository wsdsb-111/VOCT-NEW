const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const start = source.indexOf("class ActionEngine {");
const end = source.indexOf("\nclass Conversation {", start);
assert(start >= 0 && end > start, "Cannot extract ActionEngine from main.js");
globalThis.actionRegistry = { getAllActions: () => [] };
eval(`${source.slice(start, end)}\nglobalThis.__ParticipantActionEngine = ActionEngine;`);
const ActionEngine = globalThis.__ParticipantActionEngine;

const player = { id: 1, fullName: "玩家", shortName: "玩家" };
const zhangSan = { id: 2, fullName: "张三", shortName: "张三" };
const liSi = { id: 3, fullName: "李四", shortName: "李四" };
const king = { id: 4, fullName: "国王", shortName: "国王" };
const gameData = {
  playerID: player.id,
  playerName: player.fullName,
  characters: new Map([[player.id, player], [zhangSan.id, zhangSan], [liSi.id, liSi], [king.id, king]])
};
const oneInterlocutorGameData = {
  playerID: player.id,
  playerName: player.fullName,
  characters: new Map([[player.id, player], [zhangSan.id, zhangSan]])
};
const definitions = {
  killed: { semantic: { evidencePatterns: [/(?:杀死|杀了)/], participantRoles: { source: "patient", target: "actor" } } },
  imprisoned: { semantic: { evidencePatterns: [/(?:关进|关押|囚禁)/], participantRoles: { source: "patient", target: "actor" } } },
  knight: { semantic: { evidencePatterns: [/(?:任命.{0,16}(?:骑士|侍从)|骑士)/], participantRoles: { source: "patient", target: "actor" } } },
  injured: { semantic: { evidencePatterns: [/(?:刺伤|砍伤|打伤)/], participantRoles: { source: "actor", target: "patient" } } }
};

const resolve = (text, definition, data = gameData) => ActionEngine.resolveEventParticipants({
  event: { evidence: { text, start: 0, end: text.length } },
  speaker: player,
  gameData: data,
  actionDefinition: definition
});
const resolvedCases = [
  ["我刺伤张三。", definitions.injured, 1, 2, 1, 2],
  ["我被张三刺伤。", definitions.injured, 2, 1, 2, 1],
  ["我杀死张三。", definitions.killed, 1, 2, 2, 1],
  ["我被张三杀死。", definitions.killed, 2, 1, 1, 2],
  ["我关押张三。", definitions.imprisoned, 1, 2, 2, 1],
  ["我被张三关进地牢。", definitions.imprisoned, 2, 1, 1, 2],
  ["我任命张三为骑士。", definitions.knight, 1, 2, 2, 1],
  ["我被国王任命为骑士。", definitions.knight, 4, 1, 1, 4],
  ["我遭张三刺伤。", definitions.injured, 2, 1, 2, 1],
  ["我为张三所伤。", definitions.injured, 2, 1, 2, 1],
  ["张三杀死李四。", definitions.killed, 2, 3, 3, 2],
  ["张三把李四关进地牢。", definitions.imprisoned, 2, 3, 3, 2],
  ["张三刺伤李四。", definitions.injured, 2, 3, 2, 3],
  ["国王任命张三为骑士。", definitions.knight, 4, 2, 2, 4],
  ["我杀了你。", definitions.killed, 1, 2, 2, 1, oneInterlocutorGameData],
  ["我被你刺伤。", definitions.injured, 2, 1, 2, 1, oneInterlocutorGameData]
];
for (const [text, definition, actorId, patientId, sourceId, targetId, data] of resolvedCases) {
  const result = resolve(text, definition, data);
  assert.strictEqual(result.mode, "resolved", `${text}: should resolve`);
  assert.strictEqual(result.actor.id, actorId, `${text}: actor mismatch`);
  assert.strictEqual(result.patient.id, patientId, `${text}: patient mismatch`);
  assert.strictEqual(result.sourceCharacter.id, sourceId, `${text}: source mismatch`);
  assert.strictEqual(result.targetCharacter.id, targetId, `${text}: target mismatch`);
}

const unresolvedCases = [
  ["我杀了他。", definitions.killed, "ambiguous_pronoun"],
  ["我让张三刺伤李四。", definitions.injured, "unsupported_causative"],
  ["我刺伤你。", definitions.injured, "ambiguous_pronoun"],
  ["我和张三都谈到刺伤。", definitions.injured, "ambiguous_participant_direction"],
  ["张三杀死李四，国王在旁观看。", definitions.killed, "multiple_possible_targets"]
];
for (const [text, definition, reason] of unresolvedCases) {
  const result = resolve(text, definition);
  assert.strictEqual(result.mode, "unresolved", `${text}: must fail closed`);
  assert.strictEqual(result.reason, reason, `${text}: unexpected diagnostic reason`);
}

console.log("VOTC v6.6.1 participant tests: PASS (active, passive, pronouns, multi-character, and fail-closed cases)");
