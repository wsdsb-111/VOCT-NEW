"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const sourceVersionPath = require.resolve("../src/app/main/version");
const runtimeVersion = require("../resources/app/out/main/version");
require.cache[sourceVersionPath] = {
  id: sourceVersionPath,
  filename: sourceVersionPath,
  loaded: true,
  exports: { ...runtimeVersion, MEMORY_ENGINE_VERSION: "3.0" }
};
const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const memorySystem = require("../src/app/main/memory-system");
const { createGameData } = require("../src/app/main/game-data/game-data");
const { LetterSummaryFinalization } = require("../src/app/main/memory-system/letter-summary-finalization");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const contains = (source, pattern, message) => assert.ok(pattern.test(source), message);

async function testLegacyLetterFinalization() {
  const temporaryRoot = fs.mkdtempSync(path.join(root, ".test-v9.3.4-legacy-letter-"));
  const summariesDir = path.join(temporaryRoot, "summaries");
  const campaignToken = "fixture-campaign";
  const memoryEngine = new MemoryEngine({
    baseDir: path.join(temporaryRoot, "memory"),
    summaryFoldersDir: summariesDir,
    trace: { record() {} }
  });
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine, summariesDir, getHistoricalReferenceByYear: () => null });
  let summaryRequests = 0;
  const service = new LetterSummaryFinalization({
    memoryEngine,
    getSummarySettings: () => ({ letterSummaryPrompt: "" }),
    requestSummary: async () => {
      summaryRequests++;
      return { content: "双方通过信件确认玉印留存在内库。", finish_reason: "stop" };
    },
    persistSummary: (summary, context) => GameData.saveRecoveredSummary(summary, context),
    isCampaignCurrent: token => token === campaignToken
  });
  const acceptedLetter = {
    campaignToken,
    letterId: "fixture-letter-1",
    senderId: 1,
    recipientId: 2,
    sourceDate: "1038.4.1",
    acceptedDate: "1038.4.4",
    sourceTotalDays: 100,
    acceptedTotalDays: 103,
    text: "我把玉印留在内库，请你收好。",
    reply: "玉印已经妥善收存。",
    participantProfiles: [
      { id: 1, shortName: "赵祯", fullName: "宋仁宗赵祯" },
      { id: 2, shortName: "李师师", fullName: "东京名伎李师师" }
    ],
    mentionedEntities: [],
    relationshipEvidence: []
  };

  try {
    assert.equal(memoryEngine.memory4, undefined, "the synthetic fixture has no Memory4 coordinator");
    const job = service.captureAccepted(acceptedLetter);
    assert.match(job.recoveryPath, /recovery[\\/]letter-summary[\\/]letter_[a-f0-9]{64}\.json$/);
    assert.equal(summaryRequests, 0, "accepted work is persisted before the summary provider runs");
    const result = await service.finalize(job);
    assert.equal(result.status, "COMPLETE", JSON.stringify(result));
    assert.equal(summaryRequests, 1);
    assert.equal(memoryEngine.store.listAllMemories().length, 1, "the accepted letter is saved through the Legacy MemoryStore");
    const [episode] = memoryEngine.store.listAllEpisodes();
    assert(episode?.commitMarker, "the Legacy episode commit marker is retained");
    assert.equal(episode.letterId, acceptedLetter.letterId);
    assert.equal(episode.campaignToken, campaignToken);
    assert.deepEqual(episode.participants.map(person => person.id).sort(), [1, 2]);
    for (const [owner, counterpart] of [[acceptedLetter.participantProfiles[0], acceptedLetter.participantProfiles[1]],
      [acceptedLetter.participantProfiles[1], acceptedLetter.participantProfiles[0]]]) {
      const folder = path.join(summariesDir, memorySystem.getCharacterStorageDirectoryName(owner, owner.shortName));
      const summaryFile = path.join(folder, `与${memorySystem.getCharacterPersonalName(counterpart, counterpart.shortName)}的对话.json`);
      const rows = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
      const saved = rows.find(row => row.finalizationId === `letter_${job.jobId}`);
      assert(saved, `the accepted exchange is persisted in owner ${owner.id}'s Legacy summary folder`);
      assert.equal(saved.date, acceptedLetter.acceptedDate);
      assert.equal(saved.content, "双方通过信件确认玉印留存在内库。");
    }
    assert.deepEqual(await service.retryPending({ activeCampaignToken: campaignToken, manual: true }), [],
      "completed Legacy letter finalization is not replayed");
    assert.equal(summaryRequests, 1);
  } finally {
    const target = path.resolve(temporaryRoot);
    assert(target.startsWith(`${root}${path.sep}`), "fixture cleanup stays inside the temporary workspace directory");
    fs.rmSync(target, { recursive: true, force: true });
  }
}

async function main() {
  await testLegacyLetterFinalization();
  const { getLegacySummaryPage, getSummaryImportantMatters } = await import(pathToFileURL(
    path.join(root, "src/app/renderer/summary-date-order.js")
  ).href);
  const summaries = [
    { date: "1066.03.12", content: "初次会面" },
    { date: "1067.01.04", content: "新年" },
    { date: "日期未知", content: "未标日期" },
    { date: "1066.10.01", content: "秋日对话" },
    { date: "1066.07.30", content: "夏末会谈" }
  ];

  const filtered = getLegacySummaryPage(summaries, {
    fromDate: "1066.07.01",
    toDate: "1066.12.31",
    pageSize: 1
  });
  assert.equal(filtered.totalCount, 2, "date filtering is inclusive and excludes unknown dates");
  assert.equal(filtered.pageCount, 2);
  assert.equal(filtered.entries[0].index, 3, "date sorting preserves the source file index");
  const secondPage = getLegacySummaryPage(summaries, {
    fromDate: "1066.07.01",
    toDate: "1066.12.31",
    page: 1,
    pageSize: 1
  });
  assert.equal(secondPage.entries[0].index, 4, "pagination returns the next source record");
  assert.equal(getLegacySummaryPage(summaries, { page: 99, pageSize: 2 }).page, 2, "out-of-range pages clamp to the last page");
  assert.equal(getLegacySummaryPage(summaries, { fromDate: "not-a-date" }).totalCount, 0, "invalid range dates fail closed");
  assert.equal(getLegacySummaryPage(summaries, { fromDate: "1066.03.12", toDate: "1066.03.12" }).entries[0].index, 0,
    "date boundaries include summaries on the boundary");

  const content = "谈判最终达成。\n【需要长期记住的事项】\n- 约定秋收后再会。\n【其他记录】\n不属于重要事项。";
  assert.equal(getSummaryImportantMatters(content), "- 约定秋收后再会。");
  assert.equal(getSummaryImportantMatters("没有重要事项标记"), "");

  const renderer = read("src/app/renderer/assets/index-Dn3qWlAB.js");
  const preload = read("src/app/preload/preload.js");
  const ipc = read("src/app/main/ipc/register-ipc.js");
  const html = read("src/app/renderer/index.html");
  contains(renderer, /getLegacySummaryPage\(metadata\.summaries/, "renderer renders paginated Legacy summary entries");
  contains(renderer, /children: "查看全文"/, "renderer provides full-text expansion");
  contains(renderer, /children: "重要事项"/, "renderer presents important matters separately");
  contains(renderer, /"aria-label": "摘要分页"/, "renderer exposes pagination controls");
  contains(renderer, /window\.conversationAPI\.regenerateSummary\(/, "Legacy summary rewrite remains available");
  contains(renderer, /window\.conversationAPI\.updateSummary|const updateSummary = useConfigStore/, "Legacy summary editing remains available");
  contains(renderer, /window\.conversationAPI\.deleteSummary|const deleteSummary = useConfigStore/, "Legacy summary deletion remains available");
  contains(renderer, /CK3_OFFICIAL_RECOLLECTION/, "CK3 official recollection handling remains available");
  contains(preload, /regenerateSummary: .*conversation:regenerateSummary/, "preload exposes Legacy summary rewrite");
  contains(ipc, /conversation:regenerateSummary/, "main process registers Legacy summary rewrite");
  contains(ipc, /SummariesManager\.regenerateSummary\(/, "rewrite IPC delegates to SummariesManager");
  contains(preload, /updateSummary: .*conversation:updateSummary/, "preload exposes Legacy summary editing");
  contains(preload, /deleteSummary: .*conversation:deleteSummary/, "preload exposes Legacy summary deletion");

  for (const [name, source] of Object.entries({ renderer, preload, ipc, html })) {
    assert.doesNotMatch(source, /Memory4Manager|memory4-manager\.(?:js|css)|memory4:get(?:Coverage|Entry|Sources|OwnerData)|memory4:(?:mutate|audit|forget)/i,
      `${name} has no Memory4 UI or bridge entrypoint`);
  }
  assert.equal(fs.existsSync(path.join(root, "src/app/renderer/memory4-manager.js")), false);
  assert.equal(fs.existsSync(path.join(root, "src/app/renderer/memory4-manager.css")), false);
  assert.doesNotMatch(renderer, /conversation:getMemoryOverview|memory4Only|Durable memories|Memory Engine 4\.0/i);
  assert.doesNotMatch(preload, /conversation:getMemoryOverview|conversation:updateStructuredMemory|memory:updateRecord|memory:deleteRecord/);
  assert.doesNotMatch(ipc, /conversation:getMemoryOverview|conversation:updateStructuredMemory|memory:updateRecord|memory:deleteRecord/);

  console.log("V9.3.4 Legacy Retirement: PASS (synthetic letter finalization and date/pagination helpers; static UI/IPC contracts; no Memory4 bridge)");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
