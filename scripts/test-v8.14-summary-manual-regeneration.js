"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-summary-regenerate-"));
  try {
    const summariesDir = path.join(root, "summaries");
    const ownerDir = path.join(summariesDir, "2_乙");
    const filePath = path.join(ownerDir, "与丙的对话.json");
    fs.mkdirSync(ownerDir, { recursive: true });
    const raw = "乙：我会在秋收后送来粮食。\n丙：请先送一半，余下的等河水退后再运。\n乙：好，我答应分两次送达。";
    const official = { sourceType: "CK3_OFFICIAL_RECOLLECTION", content: "官方追忆正文", playerId: 2, characterId: 3 };
    const records = [
      { playerId: 2, characterId: 3, playerName: "乙", characterName: "丙", date: "740年春", totalDays: 100, campaignToken: "campaign-a", campaignBinding: { status: "bound", source: "native", version: 1 }, conversationType: "pair", participants: [{ id: 2, name: "乙" }, { id: 3, name: "丙" }], finalizationId: "old-finalization", content: raw },
      official
    ];
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");
    const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
    let requestHandler = async () => ({ content: "乙答应分两次运送粮食：先在秋收后送来一半，余下待河水退后再送达。", finish_reason: "stop" });
    let lastPrompt;
    let lastOptions;
    const manager = createSummariesManager({
      fs,
      path,
      summariesDir,
      memoryEngine: engine,
      memorySystem: {},
      getSummaryOutputLimit: () => 8192,
      requestSummary: async (prompt, options) => {
        lastPrompt = prompt;
        lastOptions = options;
        return requestHandler(prompt, options);
      }
    });

    const rejectedOfficial = await manager.regenerateSummary(2, 3, 1, official.content);
    assert.deepStrictEqual(rejectedOfficial, { success: false, error: "official_recollection_is_not_regenerable" });
    assert.strictEqual(lastPrompt, undefined, "official CK3 recollections must not be sent to a model");
    const staleBeforeRequest = await manager.regenerateSummary(2, 3, 0, "stale source");
    assert.strictEqual(staleBeforeRequest.error, "summary_regeneration_stale");
    assert.strictEqual(lastPrompt, undefined, "stale UI content must not trigger a paid request");

    const regenerated = await manager.regenerateSummary(2, 3, 0, raw);
    assert.strictEqual(regenerated.success, false, "without a trusted Campaign context, the rewrite must not claim linked memory rebuilt");
    assert.strictEqual(regenerated.summaryUpdated, true);
    assert.strictEqual(regenerated.partial, true);
    assert.strictEqual(regenerated.memoryRebuild.derived.status, "SKIPPED");
    assert.strictEqual(lastOptions.maxTokens, 8192, "manual regeneration must use the configured summary output budget");
    assert.strictEqual(lastOptions.requestType, "summary_rewrite", "manual rewriting must use a plain-text request type, not structured JSON extraction");
    assert(lastPrompt[1].content.includes(raw), "the selected saved summary is the only regeneration source");
    assert(lastPrompt[0].content.includes("不推断其他角色是否在场或知情"), "manual rewriting must not infer visibility evidence");
    let saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.strictEqual(saved[0].content, regenerated.content);
    assert.strictEqual(saved[0].campaignToken, "campaign-a", "Campaign binding must survive rewriting");
    assert.deepStrictEqual(saved[0].campaignBinding, records[0].campaignBinding);
    assert.strictEqual(saved[0].date, records[0].date);
    assert.strictEqual(saved[1].content, official.content, "only the selected summary may change");
    const projection = engine.store.listAllMemories().find(memory => memory.provenance?.folderOwnerId === 2);
    assert(projection, "regeneration must update the canonical owner memory projection");
    assert.deepStrictEqual(projection.knownBy, [2], "the rewritten projection remains limited to its owner");
    assert.strictEqual(projection.provenance.campaignToken, "campaign-a");

    const currentContent = saved[0].content;
    requestHandler = async () => ({ content: currentContent, finish_reason: "stop" });
    const unchanged = await manager.regenerateSummary(2, 3, 0, currentContent);
    assert.strictEqual(unchanged.error, "summary_regeneration_no_change");
    assert.strictEqual(JSON.parse(fs.readFileSync(filePath, "utf8"))[0].content, currentContent, "a verbatim model response must not overwrite the saved summary");

    requestHandler = async () => ({ content: "模型截断的半句", finish_reason: "length" });
    const truncated = await manager.regenerateSummary(2, 3, 0, currentContent);
    assert.strictEqual(truncated.error, "summary_regeneration_output_truncated");
    assert.strictEqual(JSON.parse(fs.readFileSync(filePath, "utf8"))[0].content, currentContent, "truncated model output must never be persisted");

    requestHandler = async () => { throw new Error("provider_unavailable"); };
    const failed = await manager.regenerateSummary(2, 3, 0, currentContent);
    assert.strictEqual(failed.success, false);
    assert.strictEqual(JSON.parse(fs.readFileSync(filePath, "utf8"))[0].content, currentContent, "provider failure must leave the original intact");

    requestHandler = async () => {
      const latest = JSON.parse(fs.readFileSync(filePath, "utf8"));
      latest[0].content = "用户在模型生成期间手工修改了摘要";
      fs.writeFileSync(filePath, JSON.stringify(latest, null, 2), "utf8");
      return { content: "模型整理出的另一个摘要", finish_reason: "stop" };
    };
    const staleDuringRequest = await manager.regenerateSummary(2, 3, 0, currentContent);
    assert.strictEqual(staleDuringRequest.error, "summary_regeneration_stale");
    assert.strictEqual(JSON.parse(fs.readFileSync(filePath, "utf8"))[0].content, "用户在模型生成期间手工修改了摘要", "concurrent user edits must not be overwritten");

    let enterRequest;
    const requestEntered = new Promise(resolve => { enterRequest = resolve; });
    let finishRequest;
    const pendingRequest = new Promise(resolve => { finishRequest = resolve; });
    requestHandler = async () => {
      enterRequest();
      return pendingRequest;
    };
    const raceContent = JSON.parse(fs.readFileSync(filePath, "utf8"))[0].content;
    const first = manager.regenerateSummary(2, 3, 0, raceContent);
    await requestEntered;
    const competing = await manager.regenerateSummary(2, 3, 0, raceContent);
    assert.strictEqual(competing.error, "summary_regeneration_in_progress", "only one manual regeneration may run at a time");
    finishRequest({ content: "乙确认继续按两次运送粮食，第二次待河水退后完成。", finish_reason: "stop" });
    assert.strictEqual((await first).summaryUpdated, true);

    const renderer = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
    const preload = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "preload", "preload.js"), "utf8");
    const ipc = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
    assert(renderer.includes("通过当前摘要模型重新整理本篇摘要"), "each normal saved summary must expose a model rewrite action");
    assert(preload.includes("regenerateSummary:"), "preload must expose the scoped regeneration API");
    assert(ipc.includes('"conversation:regenerateSummary"'), "main IPC must expose the regeneration endpoint");
    console.log("V8.14 Manual Summary Regeneration: PASS (single-record rewrite, Campaign metadata, owner-only projection, stale/no-op/failure/concurrency and official-recollection guard)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
