"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { HistoricalDefinitionIndexClient, HistoricalIndexLifecycle, buildHistoricalDefinitionIndex } = require("../resources/app/out/main/worldline/historical-definition-index");
const { probeHistoricalSources } = require("../resources/app/out/main/worldline/historical-source-probe");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v852-lifecycle-"));
  const base = path.join(root, "steamapps/common/Crusader Kings III/game");
  const mod = path.join(root, "steamapps/workshop/content/1158310/fixture");
  const user = path.join(root, "user");
  const file = path.join(base, "history/characters/names.txt");
  const write = (target, text) => { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  fs.mkdirSync(mod, { recursive: true });
  write(file, 'han={ name="韩世忠" female=no 1090.1.1={birth=yes} }');
  write(path.join(user, "mod/fixture.mod"), `path="${mod.replace(/\\/g, "/")}"`);
  write(path.join(user, "dlc_load.json"), JSON.stringify({ enabled_mods: ["mod/fixture.mod"] }));
  let updates = 0, queries = 0;
  const client = new HistoricalDefinitionIndexClient({ getCK3UserFolderPath: () => user, onUpdated: () => updates++, onQueryReady: () => queries++ });
  try {
    await client.prepare(["韩世忠"], 5000);
    const initial = { generation: client.generation, builds: client.meta.buildCount, revision: client.meta.revision, updates };
    const cached = client.find("韩世忠");
    const originalRead = fs.readFileSync;
    try {
      fs.readFileSync = (target, ...args) => {
        assert(!String(target).endsWith(".txt") && !String(target).endsWith(".yml"), "lightweight probe cannot read source bodies");
        return originalRead(target, ...args);
      };
      const probe = probeHistoricalSources({ userFolder: user });
      assert.equal(probe.fileCount, 1);
    } finally { fs.readFileSync = originalRead; }
    for (let i = 0; i < 20; i++) await client.refresh({}, 5000);
    assert.equal(client.meta.buildCount, initial.builds, "twenty unchanged probe cycles build zero extra indexes");
    assert.equal(client.generation, initial.generation);
    assert.equal(updates, initial.updates, "probes and lookup completion cannot invalidate world caches");
    assert.strictEqual(client.find("韩世忠"), cached);
    const touched = new Date(Date.now() + 2000);
    fs.utimesSync(file, touched, touched);
    await client.refresh({}, 5000);
    assert.equal(client.meta.buildCount, initial.builds + 1);
    assert.equal(client.meta.revision, initial.revision);
    assert.equal(client.generation, initial.generation, "same content after touch keeps the generation");
    assert.equal(updates, initial.updates);
    assert.strictEqual(client.find("韩世忠"), cached);
    await client.prepareQuery("韩世忠在哪里", 5000);
    assert.equal(client.scan("韩世忠在哪里").matches[0].value, "韩世忠");
    assert.equal(updates, initial.updates);
    assert(queries >= 2);
    write(file, 'han={ name="欧阳修" female=no 1007.1.1={birth=yes} }');
    await client.refresh({}, 5000);
    assert.notEqual(client.meta.revision, initial.revision);
    assert.equal(client.generation, initial.generation + 1);
    assert.equal(updates, initial.updates + 1);
    assert.equal(client.cache.size, 0);
    assert.equal(client.scanCache.size, 0);
    await client.prepare(["韩世忠", "欧阳修"], 5000);
    assert.equal(client.find("韩世忠").status, "NAME_INDEX_MISS");
    assert.equal(client.find("欧阳修").status, "FOUND");
    const afterChange = client.generation;
    await client.refresh({ force: true }, 5000);
    assert.equal(client.generation, afterChange, "explicit reread with identical content preserves semantic generation");
    write(path.join(mod, "descriptor.mod"), 'version="updated"');
    await client.refresh({}, 5000);
    assert.equal(client.generation, afterChange + 1, "in-mod descriptor changes are source dependencies too");
    write(path.join(base, "history/characters/added.txt"), 'sima={name="司马光"}');
    await client.refresh({}, 5000);
    await client.prepare(["司马光"], 5000);
    assert.equal(client.find("司马光").status, "FOUND", "source-set additions are discovered");
    fs.renameSync(path.join(base, "history/characters/added.txt"), path.join(base, "history/characters/removed.bak"));
    await client.refresh({}, 5000);
    await client.prepare(["司马光"], 5000);
    assert.equal(client.find("司马光").status, "NAME_INDEX_MISS", "removals invalidate positive results");
    write(path.join(user, "dlc_load.json"), JSON.stringify({ enabled_mods: ["mod/missing.mod"] }));
    await client.refresh({}, 5000);
    assert.equal(client.status, "PARTIAL");
    assert.equal(client.meta.sourceComplete, false);

    write(path.join(user, "dlc_load.json"), JSON.stringify({ enabled_mods: ["mod/fixture.mod"] }));
    const lifecycle = new HistoricalIndexLifecycle({ userFolder: user, build: options => {
      const result = buildHistoricalDefinitionIndex(options);
      write(path.join(user, "mod/fixture.mod"), `path="${mod.replace(/\\/g, "/")}"\n# changed during build`);
      return result;
    } });
    assert.throws(() => lifecycle.check(), /SOURCE_CHANGED_DURING_BUILD/);
    assert.equal(lifecycle.index, null, "a candidate built across descriptor versions is discarded");

    const settings = { autosavePath: path.join(root, "autosave.ck3"), autoWatchEnabled: false };
    const service = new WorldlineService({ dataDir: path.join(root, "data"), settingsRepository: { getWorldlineSettings: () => settings, saveWorldlineSettings: value => Object.assign(settings, value) } });
    try {
      let invalidations = 0;
      service.historicalDefinitionIndex.invalidate = () => { invalidations++; };
      service.setAutosavePath(path.join(root, "other/autosave.ck3"));
      await service.rebuildCheckpoint();
      assert.equal(invalidations, 0, "checkpoint source changes and rebuilds cannot invalidate static history");
      service.worldKnowledgeState.topicPatchCache.set("topic", 1);
      service.worldKnowledgeState.summaryCache.set("summary", 1);
      service.historicalDefinitionIndex.onQueryReady();
      assert.equal(service.worldKnowledgeState.topicPatchCache.size, 1);
      assert.equal(service.worldKnowledgeState.summaryCache.size, 1);
      service.historicalDefinitionIndex.onUpdated();
      assert.equal(service.worldKnowledgeState.topicPatchCache.size, 0);
      assert.equal(service.worldKnowledgeState.summaryCache.size, 0);
    } finally { service.dispose(); }

    class FakeWorker extends EventEmitter { postMessage(value) { this.last = value; } unref() {} terminate() {} }
    const fake = new HistoricalDefinitionIndexClient({ getCK3UserFolderPath: () => user, WorkerClass: FakeWorker });
    try {
      fake.start();
      const worker = fake.worker;
      worker.emit("message", { type: "built", meta: { revision: "one", state: "READY", sourceComplete: true } });
      const late = fake._request("韩世忠");
      const requestId = worker.last.requestId;
      worker.emit("message", { type: "checking" });
      assert.equal(fake.find("韩世忠").sourceComplete, false, "build in progress cannot serve an old complete result");
      worker.emit("message", { type: "built", meta: { revision: "two", state: "READY", sourceComplete: true } });
      worker.emit("message", { type: "lookup", requestId, result: { revision: "one", status: "FOUND", sourceComplete: true, candidates: [] } });
      assert.equal((await late).sourceComplete, false, "late same-worker old-revision replies must also fail closed");
      assert.equal(fake.cache.size, 0);
      const cancelled = fake._request("韩世忠", "scan");
      worker.emit("error", new Error("fixture"));
      assert.equal((await cancelled).sourceComplete, false);
      assert.equal(fake.requests.size, 0);
      assert.equal(fake.status, "FAILED");
    } finally { fake.dispose(); }
    console.log("V8.5.2 historical lifecycle: PASS (20 no-op cycles, touch, edits, source set, atomic discard, cache authority, checkpoint isolation and stale replies)");
  } finally { client.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
