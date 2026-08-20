const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ParticipantResolver } = require(path.join(root, "resources", "app", "out", "main", "action-system"));

const player = { id: 1, fullName: "玩家", shortName: "玩家" };
const zhangSan = { id: 2, fullName: "张三", shortName: "张三" };
const liSi = { id: 3, fullName: "李四", shortName: "李四" };
const king = { id: 4, fullName: "国王", shortName: "国王" };
const gameData = { characters: new Map([[1, player], [2, zhangSan], [3, liSi], [4, king]]) };
const injury = { semantic: { evidencePatterns: [/刺伤/], participantRoles: { source: "actor", target: "patient" } } };
const kill = { semantic: { evidencePatterns: [/杀死|杀了/], participantRoles: { source: "patient", target: "actor" } } };

const resolve = (text, actionDefinition) => ParticipantResolver.resolve({
  event: { eventId: "evt_1", evidence: { text, start: 0, end: text.length } },
  message: { id: 1, content: text },
  speaker: player,
  gameData,
  actionDefinition
});

for (const [text, definition, sourceId, targetId] of [
  ["我刺伤张三。", injury, 1, 2],
  ["我被张三刺伤。", injury, 2, 1],
  ["张三刺伤李四。", injury, 2, 3],
  ["我杀死张三。", kill, 2, 1],
  ["我被张三杀死。", kill, 1, 2]
]) {
  const result = resolve(text, definition);
  assert.strictEqual(result.mode, "resolved", `${text}: must preserve v6.6.1 resolution`);
  assert.strictEqual(result.sourceCharacter.id, sourceId, `${text}: source mismatch`);
  assert.strictEqual(result.targetCharacter.id, targetId, `${text}: target mismatch`);
}

for (const [text, definition, reason] of [
  ["我让张三刺伤李四。", injury, "unsupported_causative"],
  ["我刺伤你。", injury, "ambiguous_participant_direction"],
  ["张三杀死李四，国王在旁观看。", kill, "multiple_possible_targets"]
]) {
  const result = resolve(text, definition);
  assert.strictEqual(result.mode, "unresolved", `${text}: must remain fail-closed`);
  assert.strictEqual(result.reason, reason, `${text}: unexpected fail-closed reason`);
}

console.log("VOTC v6.7 baseline: PASS (v6.6.1 participant contract preserved)");
