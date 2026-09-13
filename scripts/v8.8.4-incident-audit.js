"use strict";

// Read explicitly supplied incident inputs; run migration only in a disposable copy.
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { Character } = require("../resources/app/out/main/game-data/character");
const { createLogParser } = require("../resources/app/out/main/game-data/log-parser");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");

async function run() {
  const [logFile, queueFile, descriptionFile, characterId] = process.argv.slice(2);
  if (!logFile || !queueFile || !descriptionFile || !Number(characterId)) throw new Error("Usage: node scripts/v8.8.4-incident-audit.js <debug.log> <queue.json> <description.js> <runtimeId>");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v884-audit-"));
  const log = console.log;
  const warn = console.warn;
  try {
    console.log = console.warn = () => {};
    const GameData = createGameData({ fs: {}, path: {}, memorySystem: {}, memoryEngine: {}, summariesDir: "", getHistoricalReferenceByYear: () => ({}) });
    const gameData = await createLogParser({ GameData, Character })(logFile);
    const npc = gameData.characters.get(Number(characterId));
    assert(npc, "Requested character is absent from current log");
    const description = PromptScriptSandbox.executeDescription(descriptionFile, { gameData, currentCharacterId: npc.id });
    const family = buildFamilyFactBlock(npc, gameData, { query: "我们有几个孩子？" });
    const counts = { male: 0, female: 0, unknown: 0 };
    for (const child of npc.children) {
      counts[child.gender || "unknown"]++;
      const label = child.gender === "male" ? "儿子" : child.gender === "female" ? "女儿" : "子女";
      assert(family.includes(label + "：" + child.name), "Structured family label mismatch");
      const start = description.indexOf(child.name);
      assert(start >= 0, "Child missing from actual description");
      const expected = child.gender === "male" ? "son" : child.gender === "female" ? "daughter" : "child";
      assert(description.slice(start, start + 140).includes(expected), "Installed description label mismatch");
    }
    const original = fs.readFileSync(queueFile);
    const queue = JSON.parse(original);
    fs.mkdirSync(path.join(temp, "ck3", "run"), { recursive: true });
    fs.writeFileSync(path.join(temp, "ck3", "run", "votc.txt"), "");
    fs.writeFileSync(path.join(temp, "run-command-queue.json"), original);
    const Manager = createRunFileManager({ settingsRepository: { getCK3UserFolderPath: () => path.join(temp, "ck3") }, path, fs, dataDir: temp });
    const manager = new Manager();
    manager.initializeAfterAckReconciliation();
    assert(fs.readFileSync(queueFile).equals(original), "Live queue changed during read-only audit");
    log(JSON.stringify({ pass: true, children: counts, installedDescription: "verified", structuredFamily: "verified", originalPending: queue.pendingCommands.length, isolatedPendingAfterRecovery: manager.getPendingCommands().length, remainingKinds: manager.getPendingCommands().map(command => ({ kind: command.kind, status: command.status, writeAttempts: command.writeAttempts })), originalQueueModified: false, actualGameExecution: "NOT_TESTED" }));
  } finally {
    console.log = log;
    console.warn = warn;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
