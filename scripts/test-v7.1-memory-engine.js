"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { MemoryEngine } = require(path.join(root, "resources", "app", "out", "main", "memory-system"));

function writeSummary(folderRoot, owner, counterpart, summary) {
  const folder = path.join(folderRoot, `${owner.id}_${owner.name}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `与${counterpart.name}的对话.json`), JSON.stringify([{
    date: "1121年1月1日",
    totalDays: 100,
    playerId: owner.id,
    playerName: owner.name,
    characterId: counterpart.id,
    characterName: counterpart.name,
    participants: summary.participants,
    finalizationId: summary.finalizationId,
    content: summary.content
  }]), "utf8");
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v71-memory-"));
try {
  const summaryFoldersDir = path.join(tempDir, "conversation_summaries");
  const E = { id: 50, name: "戊" };
  const speakers = [
    { id: 10, name: "甲" },
    { id: 20, name: "乙" },
    { id: 30, name: "丙" },
    { id: 40, name: "丁" }
  ];
  const groupParticipants = [...speakers, E].map((character) => ({ id: character.id, name: character.name }));
  for (const speaker of speakers) {
    writeSummary(summaryFoldersDir, speaker, E, {
      finalizationId: `fin_${speaker.id}_E`,
      participants: groupParticipants,
      content: `${speaker.name}只在自己的人物目录中记得戊交代的往事。`
    });
  }
  writeSummary(summaryFoldersDir, { id: 60, name: "己" }, E, {
    finalizationId: "fin_private_other_owner",
    participants: [{ id: 60, name: "己" }, E],
    content: "这是己的私人目录内容，甲乙丙丁都不应读取。"
  });

  // A group session is mirrored into several counterpart files in one owner
  // folder. Engine 2.1 must inject it once, not once per pair file.
  writeSummary(summaryFoldersDir, speakers[0], speakers[1], {
    finalizationId: "fin_group_dedup",
    participants: groupParticipants,
    content: "甲乙丙丁与戊共同讨论同一件事。"
  });
  writeSummary(summaryFoldersDir, speakers[0], speakers[2], {
    finalizationId: "fin_group_dedup",
    participants: groupParticipants,
    content: "甲乙丙丁与戊共同讨论同一件事。"
  });

  const engine = new MemoryEngine({
    baseDir: path.join(tempDir, "memory"),
    summaryFoldersDir,
    trace: { record() {} }
  });

  for (const speaker of speakers) {
    const recalled = engine.retrieveForCharacter({
      characterId: speaker.id,
      query: "刚才提到戊，你还记得什么？",
      entityIds: [E.id],
      entityNames: [E.name],
      participantIds: speakers.filter((entry) => entry.id !== speaker.id).map((entry) => entry.id),
      currentTotalDays: 120,
      tokenBudget: 2e3,
      estimateTokens: (text) => String(text).length
    });
    const selected = [...recalled.stable, ...recalled.relevant].map((entry) => entry.memory);
    assert.strictEqual(recalled.engineVersion, "2.3");
    assert(selected.some((memory) => memory.content.includes(`${speaker.name}只在自己的`)), `${speaker.name} must recall E from ${speaker.name}'s own folder`);
    assert(selected.filter((memory) => memory.type === "folder_summary").every((memory) => memory.provenance.folderOwnerId === speaker.id), `${speaker.name} must never read another owner's folder`);
    assert(!selected.some((memory) => memory.content.includes("己的私人目录")), "another character's private folder must not leak");
  }

  const ownerAMemories = engine.store.loadFolderSummariesForCharacter(speakers[0].id);
  assert.strictEqual(ownerAMemories.filter((memory) => memory.provenance.finalizationId === "fin_group_dedup").length, 1, "one group finalization mirrored across pair files must be deduplicated within the owner folder");

  const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
  const conversationSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "conversation.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
  const mentionedFinder = mainSource.slice(mainSource.indexOf("findMentionedCharacterIdsInHistory("), mainSource.indexOf("findFamilyEntry(", mainSource.indexOf("findMentionedCharacterIdsInHistory(")));
  const mentionedContext = mainSource.slice(mainSource.indexOf("static buildMentionedCharactersContext("), mainSource.indexOf("static buildFinalSummary(", mainSource.indexOf("static buildMentionedCharactersContext(")));
  assert(!mentionedFinder.includes("mentioned.size >= 2"), "third-party detection must have no two-character cap");
  assert(!mentionedContext.includes("loadDynamicMemoriesFromHistory"), "the old dynamic-summary prompt path must be disconnected");
  assert(conversationSource.includes("mentionedEntityNames"), "Engine 2.2 retrieval must receive mentioned-person names for owner-folder matching");
  assert(mainSource.includes('memoryContext?.engineVersion?.startsWith("2.")'), "past_summaries must be suppressed when Memory Engine 2.x is active");
  assert(rendererSource.includes("Memory Engine 2.3"), "summary UI must identify the current Memory Engine 2.3 runtime");
  assert(!rendererSource.includes('className: "memory-character-coverage"'), "summary UI must not render the duplicate structured-memory coverage tree");
  assert(!rendererSource.includes("可访问的结构化记忆（可编辑）"), "summary UI must expose one folder-based editing surface");
  assert(rendererSource.includes("handleEditSummary"), "folder summary content must remain player-editable");

  console.log("VOTC v7.1 Memory Engine: PASS (owner-scoped folders, unlimited responders, deduplication, unified UI)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
