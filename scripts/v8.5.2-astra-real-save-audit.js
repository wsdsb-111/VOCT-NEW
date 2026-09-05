"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const { readSaveContainer } = require("../resources/app/out/main/worldline/save-container");
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");
const ui = require("../resources/app/out/renderer/worldline-player-presentation").create("zh-CN");

async function main() {
  const [userFolder, ...saves] = process.argv.slice(2);
  assert(userFolder && saves.length);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "votc-astra-save-"));
  // Canonical virtual path lets the unchanged annual-save gate inspect each read-only snapshot.
  const autosavePath = path.join(temp, "autosave.ck3");
  const settings = { autosavePath, promptIntegrationEnabled: false, autoWatchEnabled: false, lastValidationStatus: "VALID" };
  const repository = { getWorldlineSettings: () => settings, saveWorldlineSettings: value => Object.assign(settings, value), getCK3UserFolderPath: () => userFolder };
  const service = new WorldlineService({ dataDir: temp, settingsRepository: repository });
  service.getLiveState = () => ({ connected: false, characters: [] });
  try {
    await service.historicalDefinitionIndex.ready(120000);
    const generation = service.historicalDefinitionIndex.generation;
    for (const save of saves) {
      const started = performance.now();
      const container = readSaveContainer(save);
      assert(container.gamestate);
      const snapshot = parseGameState(container.gamestate);
      service.currentCheckpoint = { id: path.basename(save), source: { path: autosavePath }, snapshot };
      service.buildState = "ACTIVE";
      console.log(JSON.stringify({ save: path.basename(save), gameDate: snapshot.gameDate, characterCount: snapshot.diagnostics.characterCount, parseMs: Math.round(performance.now() - started) }));
      for (const query of ["岳飞", "韩世忠", "李师师", "赵思昭", "司马光", "欧阳修", "耶律阿保机", "完颜阿骨打", "岳飞在1168年在哪里", "岳飞、韩世忠、赵思昭"]) {
        const start = performance.now();
        const result = (await service.getPromptDiagnosticsAsync({ query })).promptDiagnostics;
        assert(result.available, result.reason);
        const entities = result.queryAnalysis.entityResolutions;
        for (const entity of entities.filter(item => item.identityKind === "HISTORICAL" && item.resolutionStatus !== "RESOLVED")) {
          const allowed = new Set(entities.filter(item => item.resolutionStatus === "RESOLVED").flatMap(item => item.runtimeIds));
          assert(!result.gameTruth.characters.some(item => entity.runtimeIds.includes(item.id) && !allowed.has(item.id)), "unresolved historical identity injected");
        }
        if (query.includes("1168年")) assert(!result.gameTruth.characters.some(item => item.id === "1168"));
        assert(Buffer.byteLength(JSON.stringify(result)) < 500000, "oversized single-query DTO");
        console.log(JSON.stringify({ query, ms: Math.round(performance.now() - start), bytes: Buffer.byteLength(JSON.stringify(result)), entities: entities.map(item => ({ name: item.subjectName, kind: item.identityKind, status: item.resolutionStatus, candidates: item.candidateTotal })), factCount: result.gameTruth.characters.length, conclusion: ui.promptSummary(result).conclusion }));
      }
      const item = service.createSupplemental({ title: "Astra lantern", body: "lantern public festival", entities: ["lantern"], visibility: "PUBLIC_WORLD" }).supplemental;
      assert.equal(service.getPromptContext({ query: "lantern" }), null, "default production gate must remain off");
      assert((await service.getPromptDiagnosticsAsync({ query: "lantern" })).promptDiagnostics.supplemental.some(entry => entry.id === item.id));
      service.updateSupplemental(item.id, { ...item, hidden: true });
      assert(!(await service.getPromptDiagnosticsAsync({ query: "lantern" })).promptDiagnostics.supplemental.some(entry => entry.id === item.id));
      service.updateSupplemental(item.id, { ...item, visibility: "SECRET" });
      assert(!(await service.getPromptDiagnosticsAsync({ query: "lantern" })).promptDiagnostics.supplemental.some(entry => entry.id === item.id));
      service.supplemental = [];
      service._loadPersistedState();
      assert(service.listSupplemental().supplemental.some(entry => entry.id === item.id), "persisted entries must reload");
      const checkpoint = service.currentCheckpoint;
      service.currentCheckpoint = { ...checkpoint, id: "other-checkpoint" };
      assert.equal(service.listSupplemental().supplemental.length, 0);
      service.currentCheckpoint = checkpoint;
      service.deleteSupplemental(item.id);
      assert.equal(service.listSupplemental().supplemental.length, 0);
      assert.equal(service.historicalDefinitionIndex.generation, generation, "save changes must not rebuild static index");
      console.log(JSON.stringify({ supplemental: "PASS", save: path.basename(save), persisted: true, publicRecall: true, hiddenAndSecretBlocked: true, checkpointIsolation: true, productionDefaultOff: true }));
    }
    console.log(JSON.stringify({ status: "PASS", saves: saves.length, generation, temporaryEvidence: temp }));
  } finally { service.dispose(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
