"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ConversationReferenceContext, ReferenceResolver, ParticipantResolver } = require(path.join(root, "resources", "app", "out", "main", "action-system"));

const player = { id: 1, fullName: "玩家", shortName: "玩家", gender: "male" };
const longName = { id: 2, fullName: "阿史那·拔野古·某某", shortName: "阿史那·拔野古·某某", gender: "male" };
const separatedName = { id: 3, fullName: "巴托尔·赛音", shortName: "巴托尔·赛音", gender: "male" };
const gameData = { characters: new Map([[1, player], [2, longName], [3, separatedName]]) };
const injury = { semantic: { evidencePatterns: [/刺伤|划了.{0,4}(?:刀|剑)/], participantRoles: { source: "actor", target: "patient" }, riskLevel: "high" } };

function resolve({ text, context, messageId, characters = gameData.characters }) {
  const localGameData = { characters };
  const message = { id: messageId, content: text };
  context.observeMessage({ message, speaker: player, characters: characters.values() });
  const event = { eventId: `evt_${messageId}`, evidence: { text, start: 0, end: text.length } };
  const references = ReferenceResolver.resolveEventReferences({ message, event, speaker: player, gameData: localGameData, referenceContext: context, actionDefinition: injury });
  const result = ParticipantResolver.resolve({ event, message, speaker: player, gameData: localGameData, actionDefinition: injury, actionId: "isInjured", references, activeParticipantIds: context.activeParticipantIds });
  return { references, result };
}

let context = new ConversationReferenceContext({ activeParticipantIds: [1, 2] });
context.observeMessage({ message: { id: 1, content: "阿史那·拔野古·某某拔出了剑。" }, speaker: longName, characters: gameData.characters.values() });
let outcome = resolve({ text: "我在他的手臂上划了一剑。", context, messageId: 2 });
const pronoun = outcome.references.find((reference) => reference.surface === "他");
assert.deepStrictEqual({ start: pronoun.start, end: pronoun.end }, { start: 2, end: 3 }, "resolved pronoun must preserve offsets in original evidence text");
assert.strictEqual(outcome.result.mode, "resolved", "long-name pronoun must resolve without rewriting evidence coordinates");
assert.strictEqual(outcome.result.targetCharacter.id, longName.id, "long-name pronoun must bind to the original character");

context = new ConversationReferenceContext({ activeParticipantIds: [1, 3] });
outcome = resolve({ text: "我刺伤了赛音巴托尔。", context, messageId: 3 });
assert.strictEqual(outcome.result.mode, "resolved", "unique reverse no-separator alias must resolve");
assert.strictEqual(outcome.result.targetCharacter.id, separatedName.id, "derived alias must bind to its unique owner");

const collisionA = { id: 4, fullName: "阿·史", shortName: "阿·史", gender: "male" };
const collisionB = { id: 5, fullName: "史·阿", shortName: "史·阿", gender: "male" };
const collisionCharacters = new Map([[1, player], [4, collisionA], [5, collisionB]]);
context = new ConversationReferenceContext({ activeParticipantIds: [1, 4, 5] });
outcome = resolve({ text: "我刺伤了阿史。", context, messageId: 4, characters: collisionCharacters });
assert.strictEqual(outcome.result.mode, "unresolved", "colliding derived aliases must fail closed");
assert(outcome.references.some((reference) => reference.mode === "unresolved" && reference.surface === "阿史"), "alias collision must remain observable as unresolved");

console.log("VOTC v6.8.3 reference offsets: PASS (original coordinates, unique aliases and collision fail-closed)");
