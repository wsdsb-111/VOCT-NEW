"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { KnowledgeService } = require("../resources/app/out/main/memory-system/knowledge-service");

const PLAYER_ID = 1;
const NPC_A_ID = 2;
const NPC_D_ID = 4;
const NPC_E_ID = 5;
const pairKey = "1_4.json";

function makeMemory(memoryId, visibility, knownBy) {
  return {
    memoryId,
    type: visibility === "private" ? "secret" : "information",
    visibility,
    knownBy: [...knownBy],
    participants: [PLAYER_ID, NPC_D_ID],
    subjects: [PLAYER_ID, NPC_D_ID],
    content: `${memoryId}_CONTENT`
  };
}

function makeStore() {
  const records = new Map([
    ["private-stale", makeMemory("private-stale", "private", [PLAYER_ID, NPC_A_ID])],
    ["public-stale", makeMemory("public-stale", "public", [PLAYER_ID, NPC_A_ID])],
    ["world-stale", makeMemory("world-stale", "world", [PLAYER_ID, NPC_A_ID])],
    ["missing-acl", makeMemory("missing-acl", "known_group", [])],
    ["explicit-transfer", makeMemory("explicit-transfer", "private", [NPC_A_ID])],
    ["missing-owner-row", makeMemory("missing-owner-row", "known_group", [NPC_D_ID])]
  ]);
  const knowledge = new Map([
    [PLAYER_ID, [{ memoryId: "private-stale" }, { memoryId: "public-stale" }, { memoryId: "world-stale" }]],
    [NPC_A_ID, [{ memoryId: "explicit-transfer" }]],
    [NPC_D_ID, [
      { memoryId: "private-stale" },
      { memoryId: "public-stale" },
      { memoryId: "world-stale" },
      { memoryId: "missing-acl" }
    ]]
  ]);
  const pairIndexes = new Map([[pairKey, [...records.keys()]]]);
  const store = Object.create(MemoryStore.prototype);
  store.index = { memories: Object.fromEntries([...records.keys()].map((id) => [id, {}])) };
  store.paths = { pairs: path.join("fixture", "pairs") };
  store.getMemory = (memoryId) => records.get(memoryId) || null;
  store.getCharacterKnowledge = (characterId) => knowledge.get(Number(characterId)) || [];
  store.readJson = (filePath, fallback) => pairIndexes.get(path.basename(filePath)) || fallback;
  store.loadFolderSummariesForCharacter = () => [];
  store.markKnownBy = (characterId, memoryId, details = {}) => {
    const numericId = Number(characterId);
    const entries = knowledge.get(numericId) || [];
    if (!entries.some((entry) => entry.memoryId === memoryId)) entries.push({ characterId: numericId, memoryId, ...details });
    knowledge.set(numericId, entries);
  };
  store.updateMemory = (memoryId, updates) => {
    const current = records.get(memoryId);
    const patch = typeof updates === "function" ? updates(current) : updates;
    const next = { ...current, ...patch };
    records.set(memoryId, next);
    return next;
  };
  store.removeKnowledgeForMemory = (memoryId, keepCharacterIds = []) => {
    const keep = new Set(keepCharacterIds.map(Number));
    for (const [characterId, entries] of knowledge) {
      if (!keep.has(characterId)) knowledge.set(characterId, entries.filter((entry) => entry.memoryId !== memoryId));
    }
  };
  return store;
}

function ids(memories) {
  return memories.map((memory) => memory.memoryId).sort();
}

const store = makeStore();
const knowledge = new KnowledgeService({ store });
assert.equal(knowledge.transferKnowledge("private-stale", {
  fromCharacterId: NPC_D_ID,
  toCharacterId: NPC_E_ID,
  acquiredAt: 100,
  awareness: "told"
}), false, "a stale source index without canonical knownBy must not authorize transfer");
assert.deepEqual(store.getMemory("private-stale").knownBy, [PLAYER_ID, NPC_A_ID],
  "a rejected transfer must not broaden the canonical ACL");
assert.deepEqual(store.getCharacterKnowledge(NPC_E_ID), [],
  "a rejected transfer must not create target knowledge");

assert.equal(knowledge.transferKnowledge("explicit-transfer", {
  fromCharacterId: NPC_A_ID,
  toCharacterId: NPC_D_ID,
  acquiredAt: 100,
  awareness: "told"
}), true);

const expectedBeforeRevocation = ["explicit-transfer"];
assert.deepEqual(ids(store.queryMemories({ characterId: NPC_D_ID })), expectedBeforeRevocation,
  "stale private/public/world and index-only rows must not bypass canonical knownBy");
assert.deepEqual(ids(store.getPairMemories(PLAYER_ID, NPC_D_ID, { characterId: NPC_D_ID })), expectedBeforeRevocation,
  "pair reads must apply the same canonical ACL intersection");

store.updateMemory("explicit-transfer", { knownBy: [NPC_A_ID] });
assert.deepEqual(ids(store.queryMemories({ characterId: NPC_D_ID })), [],
  "a stale owner row must stop granting access after canonical knownBy revocation");
assert.deepEqual(ids(store.getPairMemories(PLAYER_ID, NPC_D_ID, { characterId: NPC_D_ID })), [],
  "pair reads must reject stale owner rows after canonical knownBy revocation");

store.removeKnowledgeForMemory("explicit-transfer", [NPC_A_ID]);
assert.deepEqual(ids(store.queryMemories({ characterId: NPC_D_ID })), [],
  "removing the owner index must continue to deny memory retrieval");
console.log("Canonical Memory ACL checks passed.");
