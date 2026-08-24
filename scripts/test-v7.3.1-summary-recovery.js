"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
const { Conversation } = require(path.join(root, "resources", "app", "out", "main", "action-system", "conversation"));
const {
  MemoryEngine,
  buildDirectedParticipantPairs,
  getCharacterPersonalName,
  resolveSummaryParticipants
} = require(path.join(root, "resources", "app", "out", "main", "memory-system"));

const player = { id: 95829, shortName: "花魁，李师师", fullName: "樊楼花魁，李师师" };
const snapshotParticipants = [
  { id: 95829, name: "李师师", fullName: "樊楼花魁，李师师", primaryTitle: "樊楼" },
  { id: 92558, name: "赵佶", fullName: "宋宣和皇帝，赵佶", primaryTitle: "宋朝" }
];

const resolved = resolveSummaryParticipants({
  playerId: player.id,
  participantIds: snapshotParticipants.map((participant) => participant.id),
  currentCharacters: new Map([[player.id, player]]),
  participantProfiles: snapshotParticipants
});

assert.deepStrictEqual(resolved.map((participant) => participant.id), [95829, 92558], "recovery must retain an NPC absent from the new scene");
assert.strictEqual(resolved[1].shortName, "赵佶", "snapshot name must provide a stable title-free storage name");

const withoutSnapshot = resolveSummaryParticipants({
  playerId: player.id,
  participantIds: snapshotParticipants.map((participant) => participant.id),
  currentCharacters: new Map([[player.id, player]])
});
assert.deepStrictEqual(withoutSnapshot.map((participant) => participant.id), [95829], "unknown participants must still fail closed without a snapshot profile");

let participantPresence = [];
Conversation.configure({ memoryEngine: { ensureConversationState: () => ({ participantPresence }) } });
for (let participantCount = 2; participantCount <= 6; participantCount++) {
  const characters = Array.from({ length: participantCount }, (_, index) => ({
    id: index + 1,
    firstName: `角色${index + 1}`,
    shortName: `官职，角色${index + 1}`,
    fullName: `某地官职，角色${index + 1}`
  }));
  const conversation = Object.create(Conversation.prototype);
  conversation.gameData = {
    playerID: 1,
    characters: new Map(characters.map((character) => [character.id, character])),
    getCharacterPersonalName: (id, fallback) => getCharacterPersonalName(conversation.gameData.characters.get(Number(id)) || {}, fallback)
  };
  conversation.summaryParticipantProfiles = new Map();
  conversation.messages = characters.slice(1).map((character, index) => ({ id: index + 1, role: "assistant", name: character.fullName, content: "已参与对话。" }));
  participantPresence = characters.map((character) => ({ characterId: character.id, joinedAtMessageId: 0, leftAtMessageId: null }));
  conversation.captureSummaryParticipantProfiles(characters);
  conversation.gameData.characters.delete(characters[characters.length - 1].id);
  assert.deepStrictEqual(conversation.getSummaryParticipantIds(), characters.map((character) => character.id), `${participantCount}-person finalization must retain a participant removed before close`);

  const directedPairs = buildDirectedParticipantPairs(characters);
  assert.strictEqual(directedPairs.length, participantCount * (participantCount - 1), `${participantCount}-person finalization must create every directed pair`);
  for (const character of characters) {
    assert.strictEqual(directedPairs.filter((pair) => pair.owner.id === character.id).length, participantCount - 1, `character ${character.id} must own one file for every counterpart`);
  }
}

const recoveryDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v731-group-recovery-"));
try {
  const summaryFoldersDir = path.join(recoveryDir, "summaries");
  fs.mkdirSync(path.join(summaryFoldersDir, "3_角色3"), { recursive: true });
  const recoveryEngine = new MemoryEngine({ baseDir: path.join(recoveryDir, "memory"), summaryFoldersDir, trace: { record() {} } });
  const recoveredProfiles = recoveryEngine.resolveRecoveryParticipantProfiles({
    participants: [{ id: 1, name: "角色1" }, { id: 2, name: "角色2" }],
    participantPresence: [{ characterId: 1 }, { characterId: 2 }, { characterId: 3 }]
  });
  assert.deepStrictEqual(recoveredProfiles.map((profile) => profile.id), [1, 2, 3], "recovery must restore a missing participant from that participant's existing folder");
  assert.strictEqual(recoveredProfiles[2].name, "角色3");
} finally {
  fs.rmSync(recoveryDir, { recursive: true, force: true });
}

const conversationSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "conversation.js"), "utf8");
const profileForwardingCount = conversationSource.match(/participantProfiles:\s*context\.participants/g)?.length || 0;
assert.strictEqual(profileForwardingCount, 2, "live finalization and recovery must both forward participant snapshots");

const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const providerServiceSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "provider-service.js"), "utf8");
assert(mainSource.includes("memorySystem.resolveSummaryParticipants"), "folder persistence must resolve participants independently of the current scene");
assert(mainSource.includes("memorySystem.buildDirectedParticipantPairs"), "runtime folder persistence must use the tested all-participant directed pair builder");
assert(providerServiceSource.includes('isDeepseekStructuredSummary ? { thinking: { type: "enabled" }, max_tokens: 4096'), "DeepSeek final summaries and recovery must use thinking with a bounded structured-output budget");

console.log("VOTC v7.3.1 summary recovery: PASS (2-6 participants, scene-independent profiles, complete directed folders)");
