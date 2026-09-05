"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { buildHistoricalDefinitionIndex, lookup, HistoricalDefinitionIndexClient } = require("../resources/app/out/main/worldline/historical-definition-index");
const { analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");
const ui = require("../resources/app/out/renderer/worldline-player-presentation").create("zh-CN");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v851-sol-"));
  const write = (file, value) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };
  try {
    write("history/characters/test.txt", 'han = { # name="错误" {\n name="世忠" dynasty=han_dyn culture=han female=no\n 1090.1.26={ birth=yes effect={name="错名"} }\n}\nother = { name="Chemgura" female=no 1090.1.1={birth=yes} }\n');
    write("common/dynasties/test.txt", 'han_dyn = { name=han_surname }\n');
    write("localization/simp_chinese/test.yml", 'l_simp_chinese:\nhan_surname:0 "韩"\n');
    write("localization/simp_chinese/malformed.yml", 'l_simp_chinese:\nbad:0 "' + "\\".repeat(40) + '\n');
    write("history/characters/unknown-culture.txt", 'unknown = { name="小明" dynasty=han_dyn }\n');
    const index = buildHistoricalDefinitionIndex({ sources: [{ root, sourceId: "fixture" }] });
    assert.equal(lookup(index, "韩世忠").status, "FOUND", "comments and nested effect names cannot change the outer definition");
    assert.equal(lookup(index, "韩错误").status, "NAME_INDEX_MISS");
    assert.equal(lookup(index, "韩小明").status, "NAME_INDEX_MISS", "unknown culture cannot prove surname-first full-name composition");
    assert.equal(lookup(index, "constructor").status, "NAME_INDEX_MISS", "prototype properties are not historical names");
    const snapshot = { gameDate: "1155.1.1", characters: { "1": { firstName: "世忠", birth: "1090.1.26", gender: "male" }, "2": { firstName: "世忠", birth: "900.1.1", gender: "male" }, "3": { firstName: "思昭" } }, definitionToRuntime: { han: "1" }, runtimeToDefinitions: { "1": ["han"], "2": ["han"] }, nameToCharacterIds: { "世忠": ["1"], "赵思昭": ["3"] }, titles: {} };
    const analyze = (query, extra = {}) => analyzeSharedQuery({ snapshot, query, historicalDefinitionLookup: value => lookup(index, value), ...extra });
    assert.equal(analyze("韩世忠").characters.length, 0, "contradictory multi-runtime binding cannot be resolved by picking the better age");
    assert.equal(analyze("韩世忠", { mentionedEntityIds: ["1"] }).characters.length, 0, "memory entity hints cannot bypass a rejected historical identity");
    assert.deepEqual(analyze("韩世忠和赵思昭").characters.map(item => item.id), ["3"], "another explicitly named character survives historical rejection");
    assert.deepEqual(analyze("#1").characters.map(item => item.id), ["1"], "explicit runtime requests remain available");
    assert.equal(ui.actor("Chemgura (#16882983)"), "Chemgura", "annual delta participant IDs stay out of Player View");
    assert.notEqual(ui.historical({ currentCharacterName: "Fei_name11", runtimeId: "1" }).character, "Fei_name11");
    const explanation = ui.historicalExplanation({ historicalCoverage: [{ status: "NAME_INDEX_MISS", reason: "NAME_INDEX_MISS" }], queryAnalysis: {} });
    assert.ok(!explanation.reason.includes("NAME_INDEX_MISS"), "unknown and coverage reasons must be readable");
    const prefixAnalysis = analyze("赵思昭", { historicalDefinitionLookup: value => value === "赵思" ? { status: "FOUND", sourceComplete: true, candidates: [{ definitionId: "han", displayName: "赵思", metadata: {} }] } : { status: "NAME_INDEX_MISS", sourceComplete: true } });
    assert.equal(prefixAnalysis.historicalCoverage[0].alias, "赵思昭", "a shorter historical name cannot replace the complete player query");
    assert.deepEqual(prefixAnalysis.characters.map(item => item.id), ["3"], "a shorter historical name cannot replace the complete player query");

    let analyses = 0;
    const stub = { currentCheckpoint: {}, historicalDefinitionIndex: { prepare: async () => {} }, localizationResolver: { pending: new Map([["lookup", {}]]), settle: async () => stub.localizationResolver.pending.clear() }, getPromptDiagnostics: () => { analyses++; return { promptDiagnostics: {} }; } };
    await WorldlineService.prototype.getPromptDiagnosticsAsync.call(stub, { query: "韩世忠" });
    assert.equal(analyses, 1, "async diagnostic preparation runs the final analyzer only once");
    stub.historicalDefinitionIndex.prepare = async () => { stub.currentCheckpoint = {}; };
    const changed = await WorldlineService.prototype.getPromptDiagnosticsAsync.call(stub, { query: "韩世忠" });
    assert.equal(changed.promptDiagnostics.reason, "CHECKPOINT_CHANGED");
    assert.equal(analyses, 1, "checkpoint changes during preparation cannot produce stale diagnostic facts");

    class FakeWorker extends EventEmitter {
      constructor() { super(); FakeWorker.instances.push(this); this.sent = []; }
      postMessage(value) { this.sent.push(value); }
      unref() {}
      terminate() { return Promise.resolve(); }
    }
    FakeWorker.instances = [];
    const client = new HistoricalDefinitionIndexClient({ getCK3UserFolderPath: () => root, WorkerClass: FakeWorker });
    try {
      client.start();
      const oldWorker = FakeWorker.instances[0];
      oldWorker.emit("message", { type: "built", meta: { state: "READY", revision: "old", sourceComplete: true } });
      client.find("韩世忠");
      client.invalidate();
      client.start();
      const newWorker = FakeWorker.instances[1];
      newWorker.emit("message", { type: "built", meta: { state: "READY", revision: "new", sourceComplete: true } });
      oldWorker.emit("message", { type: "built", meta: { state: "READY", revision: "old", sourceComplete: true } });
      await Promise.resolve();
      assert.equal(client.meta.revision, "new", "late old worker cannot replace the active generation");
      assert.equal(client.cache.size, 0, "cancelled promises cannot refill the next generation cache");
      client.find("韩世忠");
      newWorker.emit("error", new Error("fixture worker failure"));
      await Promise.resolve();
      assert.equal(client.requests.size, 0, "worker failure settles outstanding requests");
      assert.equal(client.status, "FAILED");
    } finally { client.dispose(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log("V8.5.1 Sol Safety: PASS (parser, binding, fallback, UI and worker generation)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
