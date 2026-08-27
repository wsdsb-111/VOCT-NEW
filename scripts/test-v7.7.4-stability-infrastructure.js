"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { TokenCounter } = require("../resources/app/out/main/provider-service");
const { validateExternalHttpUrl, validateActionFilePath, requireInteger } = require("../resources/app/out/main/ipc/register-ipc");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");
const { VOTC_CORE_VERSION, MEMORY_ENGINE_VERSION } = require("../resources/app/out/main/version");

function writeOwnerSummary(summaryRoot, content) {
  const ownerDir = path.join(summaryRoot, "2_乙");
  fs.mkdirSync(ownerDir, { recursive: true });
  fs.writeFileSync(path.join(ownerDir, "与甲的对话.json"), JSON.stringify([{ engineVersion: MEMORY_ENGINE_VERSION, playerId: 2, playerName: "乙", characterId: 1, characterName: "甲", participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }], content }]), "utf8");
}

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v774-"));
  try {
    assert.strictEqual(VOTC_CORE_VERSION, "7.9.1");
    assert.strictEqual(MEMORY_ENGINE_VERSION, "2.5");
    assert.strictEqual(TokenCounter.estimateTokens("你好世界"), 4, "CJK text must not use the old four-characters-per-token estimate");
    assert.strictEqual(TokenCounter.estimateTokens("abcdefgh"), 2);
    assert.strictEqual(TokenCounter.estimateTokens("你好abcd"), 3);

    assert.strictEqual(validateExternalHttpUrl("https://example.com/path"), "https://example.com/path");
    for (const unsafeUrl of ["file:///C:/secret", "javascript:alert(1)", "data:text/plain,test", "player2://"]) assert.throws(() => validateExternalHttpUrl(unsafeUrl));
    const actionsRoot = path.join(tempRoot, "actions");
    assert.strictEqual(validateActionFilePath(path.join(actionsRoot, "standard", "example.js"), actionsRoot), path.join(actionsRoot, "standard", "example.js"));
    assert.throws(() => validateActionFilePath(path.join(actionsRoot, "..", "outside.js"), actionsRoot));
    assert.throws(() => requireInteger(1.5, "message_id"));

    const summaryRoot = path.join(tempRoot, "summaries");
    writeOwnerSummary(summaryRoot, "初始缓存内容");
    const engine = new MemoryEngine({ baseDir: path.join(tempRoot, "memory"), summaryFoldersDir: summaryRoot, trace: { record() {} } });
    const first = engine.loadOwnerFolderMemories(2);
    first[0].content = "不得污染缓存";
    assert.strictEqual(engine.loadOwnerFolderMemories(2)[0].content, "初始缓存内容", "callers must not mutate cached folder records");
    assert.deepStrictEqual(engine.store.getFolderSummaryCacheMetrics(), { hits: 1, misses: 1, invalidations: 0, entries: 1 });
    engine.invalidateSummaryFolderCache([2]);
    writeOwnerSummary(summaryRoot, "刷新后的磁盘内容");
    assert.strictEqual(engine.loadOwnerFolderMemories(2)[0].content, "刷新后的磁盘内容", "refresh invalidation must force a new folder scan");

    engine.store.saveMemory({ memoryId: "private_pair", type: "secret", participants: [1, 2], subjects: [], content: "仅乙知道", canonicalText: "仅乙知道", visibility: "private" });
    engine.store.markKnownBy(2, "private_pair");
    const originalGetKnowledge = engine.store.getCharacterKnowledge.bind(engine.store);
    let knowledgeReads = 0;
    engine.store.getCharacterKnowledge = (...args) => { knowledgeReads++; return originalGetKnowledge(...args); };
    assert.strictEqual(engine.store.getPairMemories(1, 2, { characterId: 2 }).length, 1);
    assert.strictEqual(knowledgeReads, 1, "pair lookup must load character knowledge only once");
    engine.store.getCharacterKnowledge = originalGetKnowledge;

    const context = { participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }], messages: [{ id: 10, content: "甲说明计划" }, { id: 12, content: "乙同意" }] };
    const valid = { summarySegments: [{ provenance: { messageIds: [10, 12], speakerIds: [1, 2] } }], memories: [{ provenance: { messageIds: [12], speakerIds: [2] } }] };
    assert.strictEqual(engine.validateExtractionMessageIds(context, valid).success, true);
    for (const invalidIds of [["12"], [NaN], [-1], [10, 10], [12, 10]]) assert.strictEqual(engine.validateExtractionMessageIds(context, { ...valid, memories: [{ provenance: { messageIds: invalidIds } }] }).success, false, `malformed source IDs must fail: ${invalidIds}`);
    assert.strictEqual(engine.validateExtractionMessageIds(context, { ...valid, summarySegments: [{ provenance: { messageIds: [10], speakerIds: [99] } }] }).success, false, "non-participant speaker IDs must fail");

    const root = path.resolve(__dirname, "..");
    const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "regression.yml"), "utf8");
    const ipcSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
    assert(/uses: actions\/checkout@v4\s+with:\s+lfs: true/.test(workflow), "CI checkout must materialize Git LFS assets");
    assert(ipcSource.includes("options?.refresh === true") && ipcSource.includes("memoryEngine.invalidateSummaryFolderCache()"), "summary dashboard refresh must invalidate the Memory Engine cache");
    assert(ipcSource.includes("validateExternalHttpUrl") && ipcSource.includes("validateActionFilePath"), "high-risk IPC inputs must be constrained in the main process");
    console.log("VOTC v7.7.4: PASS (token estimator, cache observability, source trust, single-read knowledge, refresh and IPC safety)");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
