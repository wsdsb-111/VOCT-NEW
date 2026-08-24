"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { MemoryEngine, MentionTracker } = require(path.join(root, "resources", "app", "out", "main", "memory-system"));

function writeSummaries(folderRoot, owner, counterpart, summaries) {
  const folder = path.join(folderRoot, `${owner.id}_${owner.name}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `与${counterpart.name}的对话.json`), JSON.stringify(summaries.map((summary) => ({
    date: `1121年1月${summary.totalDays}日`,
    totalDays: summary.totalDays,
    playerId: owner.id,
    playerName: owner.name,
    characterId: counterpart.id,
    characterName: counterpart.name,
    participants: summary.participants || [{ id: owner.id, name: owner.name }, { id: counterpart.id, name: counterpart.name }],
    finalizationId: summary.finalizationId,
    content: summary.content
  })), null, 2), "utf8");
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v72-routing-"));
try {
  const summariesDir = path.join(tempDir, "conversation_summaries");
  const A = { id: 1, name: "玩家甲" };
  const B = { id: 2, name: "乙大人" };
  const C = { id: 3, name: "丙夫人" };
  const X = { id: 9, name: "场外玄德" };
  const Y = { id: 10, name: "场外孟德" };

  writeSummaries(summariesDir, B, A, [
    { totalDays: 40, finalizationId: "ba40", content: "乙最近与玩家甲商定修缮城墙。" },
    { totalDays: 30, finalizationId: "ba30", content: "乙与玩家甲讨论粮草。" },
    { totalDays: 20, finalizationId: "ba20", content: "乙与玩家甲谈论旧日盟约。" },
    { totalDays: 10, finalizationId: "ba10", content: "乙与玩家甲初次见面。" }
  ]);
  writeSummaries(summariesDir, B, C, [
    { totalDays: 35, finalizationId: "bc35", content: "乙最近与丙夫人谈过婚约。" },
    { totalDays: 15, finalizationId: "bc15", content: "乙与丙夫人讨论粮草运输。" }
  ]);
  writeSummaries(summariesDir, B, X, [
    { totalDays: 32, finalizationId: "bx32", content: "乙记得场外玄德曾借兵。" },
    { totalDays: 12, finalizationId: "bx12", content: "场外玄德曾向乙提起粮草。" }
  ]);
  writeSummaries(summariesDir, C, X, [
    { totalDays: 31, finalizationId: "cx31", content: "这是丙夫人自己的玄德记忆，不得注入乙。" }
  ]);

  const engine = new MemoryEngine({
    baseDir: path.join(tempDir, "memory"),
    summaryFoldersDir: summariesDir,
    trace: { record() {} }
  });
  const loadOwnerFolder = engine.store.loadFolderSummariesForCharacter.bind(engine.store);
  let ownerFolderLoads = 0;
  engine.store.loadFolderSummariesForCharacter = (...args) => {
    ownerFolderLoads++;
    return loadOwnerFolder(...args);
  };
  const recalled = engine.retrieveForResponder({
    characterId: B.id,
    directCounterpartIds: [A.id, C.id],
    mentionedEntityIds: [X.id],
    mentionedEntityNames: { [X.id]: [X.name] },
    query: "粮草与玄德的旧事",
    currentTotalDays: 50,
    tokenBudget: 1200,
    estimateTokens: (text) => String(text).length
  });

  assert.strictEqual(recalled.engineVersion, "2.3");
  assert.strictEqual(ownerFolderLoads, 1, "one NPC response must parse the owner folder only once regardless of participant count");
  assert.deepStrictEqual(recalled.routing.directCounterpartIds, [A.id, C.id]);
  assert.deepStrictEqual(recalled.routing.mentionedOutOfSceneIds, [X.id]);
  assert(recalled.direct.some((entry) => entry.routeCharacterIds.includes(A.id)), "B-A exact relationship must be covered");
  assert(recalled.direct.some((entry) => entry.routeCharacterIds.includes(C.id)), "B-C exact relationship must be covered");
  assert(recalled.mentioned.some((entry) => entry.routeCharacterIds.includes(X.id)), "B-X owner-folder memory must be covered");
  assert(recalled.direct.filter((entry) => entry.routeCharacterIds.includes(A.id)).length <= 3, "1v1-style direct route must not exceed 3 selected records per counterpart");
  assert(recalled.mentioned.filter((entry) => entry.routeCharacterIds.includes(X.id)).length <= 2, "mentioned entity route must not exceed 2 selected records");
  const selected = [...recalled.stable, ...recalled.direct, ...recalled.mentioned].map((entry) => entry.memory);
  assert(selected.filter((memory) => memory.type === "folder_summary").every((memory) => memory.provenance.folderOwnerId === B.id), "all folder memories must belong to responder B");
  assert(!selected.some((memory) => memory.content.includes("丙夫人自己的")), "another owner's private folder must never leak");

  const directBA = engine.store.loadDirectPairSummaries(B.id, A.id);
  assert(directBA.length >= 4, "exact B-A file must be independently readable");
  assert(directBA.every((memory) => memory.provenance.counterpartIds.includes(A.id)), "exact route metadata must preserve all counterpart IDs");
  const relatedX = engine.store.searchOwnerFolderForEntity(B.id, X.id, [X.name]);
  assert(relatedX.some((memory) => memory.content.includes("借兵")), "entity search must stay inside B folder and find X");

  const tracker = new MentionTracker();
  const mentionState = tracker.createState();
  const candidates = [A, B, C, X, Y].map((character) => ({ id: character.id, fullName: character.name, shortName: character.name }));
  const first = tracker.update(mentionState, {
    history: [
      { id: 1, role: "user", content: "我想起场外玄德。" },
      { id: 2, role: "assistant", content: "乙大人也听说场外孟德在召集军队。" }
    ],
    candidates,
    excludedIds: [A.id, B.id, C.id]
  });
  assert.deepStrictEqual(first, [X.id, Y.id], "mentions by both player and NPC must be retained");
  const second = tracker.update(mentionState, {
    history: [
      { id: 1, role: "user", content: "我想起场外玄德。" },
      { id: 2, role: "assistant", content: "乙大人也听说场外孟德在召集军队。" },
      { id: 3, role: "assistant", content: "丙夫人不在此处。" }
    ],
    candidates,
    excludedIds: [A.id, B.id, C.id]
  });
  assert.deepStrictEqual(second, [X.id, Y.id], "active participants must not enter the out-of-scene set");
  assert.strictEqual(mentionState.processedThroughIndex, 3, "each conversation message must be processed only once");
  assert(!Object.prototype.hasOwnProperty.call(mentionState, "processedMessageKeys"), "mention state must remain constant-size");

  console.log("VOTC v7.2 memory routing: PASS (exact pairs, owner isolation, fair routes, all-speaker mentions)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
