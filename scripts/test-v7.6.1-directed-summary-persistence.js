"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const memorySystem = require(path.join(root, "resources", "app", "out", "main", "memory-system"));
const {
  buildDirectedParticipantPairs,
  getCharacterPersonalName,
  getCharacterStorageDirectoryName,
  verifyDirectedSummaryPersistence
} = memorySystem;
const { createGameData } = require(path.join(root, "resources", "app", "out", "main", "game-data", "game-data"));
const { MEMORY_ENGINE_VERSION } = require(path.join(root, "resources", "app", "out", "main", "version"));

function summaryPath(summaryRoot, owner, counterpart) {
  return path.join(
    summaryRoot,
    getCharacterStorageDirectoryName(owner, owner.shortName),
    `与${getCharacterPersonalName(counterpart, counterpart.shortName)}的对话.json`
  );
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v761-directed-summaries-"));
try {
  for (const participantCount of [2, 3, 4, 5, 6, 7, 8, 12]) {
    const summaryRoot = path.join(temporaryRoot, String(participantCount));
    const participants = Array.from({ length: participantCount }, (_, index) => ({
      id: index + 1,
      firstName: `角色${index + 1}`,
      shortName: `头衔，角色${index + 1}`
    }));
    const finalizationId = `fin_v761_${participantCount}`;
    const directedPairs = buildDirectedParticipantPairs(participants);
    assert.strictEqual(directedPairs.length, participantCount * (participantCount - 1), `${participantCount}-person conversation must create every directed pair`);

    for (const { owner, counterpart } of directedPairs) {
      const filePath = summaryPath(summaryRoot, owner, counterpart);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify([{ finalizationId, playerId: owner.id, characterId: counterpart.id }]), "utf8");
    }

    const verification = verifyDirectedSummaryPersistence({
      directedPairs,
      finalizationId,
      getFilePath: (owner, counterpart) => summaryPath(summaryRoot, owner, counterpart),
      readSummaries: (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"))
    });
    assert.strictEqual(verification.success, true, `${participantCount}-person conversation must verify every owner folder`);
    assert.strictEqual(fs.readdirSync(summaryRoot).length, participantCount, `${participantCount}-person conversation must create every participant folder`);
    for (const participant of participants) {
      const folder = path.join(summaryRoot, getCharacterStorageDirectoryName(participant, participant.shortName));
      assert.strictEqual(fs.readdirSync(folder).length, participantCount - 1, `${participantCount}-person conversation must save one counterpart file in ${participant.id}'s folder`);
    }
  }

  const participants = [{ id: 1, shortName: "玩家" }, { id: 2, shortName: "甲" }, { id: 3, shortName: "乙" }];
  const directedPairs = buildDirectedParticipantPairs(participants);
  const summaryRoot = path.join(temporaryRoot, "incomplete");
  const finalizationId = "fin_v761_incomplete";
  for (const { owner, counterpart } of directedPairs) {
    const filePath = summaryPath(summaryRoot, owner, counterpart);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify([{ finalizationId }]), "utf8");
  }
  fs.unlinkSync(summaryPath(summaryRoot, participants[2], participants[0]));
  const incomplete = verifyDirectedSummaryPersistence({
    directedPairs,
    finalizationId,
    getFilePath: (owner, counterpart) => summaryPath(summaryRoot, owner, counterpart),
    readSummaries: (filePath) => fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null
  });
  assert.strictEqual(incomplete.success, false, "a missing owner file must fail finalization instead of reporting success");
  assert.deepStrictEqual(incomplete.missingPairs.map((pair) => [pair.ownerId, pair.counterpartId]), [[3, 1]]);

  const runtimeSummaryRoot = path.join(temporaryRoot, "runtime-persistence");
  const GameData = createGameData({
    fs,
    path,
    memorySystem,
    memoryEngine: {},
    summariesDir: runtimeSummaryRoot,
    getHistoricalReferenceByYear: () => ({ period: "测试", context: "", notableEvents: [], notableFigures: [] })
  });
  const runtimeGameData = new GameData(["1", "玩家", "2", "甲", "1000年1月1日", "scene_type_court", "测试地", "玩家", "100"]);
  const runtimeParticipants = [
    { id: 1, firstName: "玩家", shortName: "玩家", fullName: "玩家" },
    { id: 2, firstName: "甲", shortName: "甲", fullName: "甲" },
    { id: 3, firstName: "乙", shortName: "乙", fullName: "乙" }
  ];
  runtimeGameData.characters = new Map(runtimeParticipants.map((participant) => [participant.id, participant]));
  const runtimeFinalizationId = "fin_v782_runtime_persistence";
  const runtimeProjections = new Map(buildDirectedParticipantPairs(runtimeParticipants).map(({ owner, counterpart }) => {
    const key = `${owner.id}->${counterpart.id}`;
    return [key, {
      ownerId: owner.id,
      counterpartId: counterpart.id,
      content: `投影 ${key}`,
      memoryIds: [],
      summarySegmentIds: [],
      projectionHash: `hash_${key}`
    }];
  }));
  const runtimeResult = runtimeGameData.saveCharactersSummaries("回退摘要", runtimeParticipants.map((participant) => participant.id), {
    participantProfiles: runtimeParticipants,
    finalizationId: runtimeFinalizationId,
    directedSummaries: runtimeProjections
  });
  assert.deepStrictEqual(runtimeResult, { success: true, participantCount: 3, directedFilesWritten: 6 }, "生产 GameData 路径必须完成三人有向摘要落盘");
  for (const { owner, counterpart } of buildDirectedParticipantPairs(runtimeParticipants)) {
    const records = JSON.parse(fs.readFileSync(summaryPath(runtimeSummaryRoot, owner, counterpart), "utf8"));
    assert.strictEqual(records[0].finalizationId, runtimeFinalizationId);
    assert.strictEqual(records[0].engineVersion, MEMORY_ENGINE_VERSION, "人物目录投影必须写入当前 Memory Engine 版本");
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const gameDataSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "game-data", "game-data.js"), "utf8");
const summariesSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "summaries", "summaries-manager.js"), "utf8");
assert(gameDataSource.includes("verifyDirectedSummaryPersistence"), "runtime must verify every directed folder after saving");
const updateSummarySource = summariesSource.slice(summariesSource.indexOf("static async updateSummary"), summariesSource.indexOf("static async deleteSummary"));
const deleteSummarySource = summariesSource.slice(summariesSource.indexOf("static async deleteSummary"), summariesSource.indexOf("static async deleteCharacterSummaries"));
const deleteConversationSource = summariesSource.slice(summariesSource.indexOf("static async deleteCharacterSummaries"), summariesSource.indexOf("static async getCharacterNameFromFile"));
assert(!updateSummarySource.includes("characterPerspectivePath"), "editing one owner folder must not update the counterpart folder");
assert(!deleteSummarySource.includes("characterPerspectivePath"), "deleting one owner summary must not delete the counterpart folder");
assert(!deleteConversationSource.includes("characterPerspectivePath"), "deleting one owner conversation must not delete the counterpart folder");

console.log("VOTC v7.6.1 directed summary persistence: PASS (2-12 participants, every owner folder, incomplete-write recovery, owner-only edits)");
