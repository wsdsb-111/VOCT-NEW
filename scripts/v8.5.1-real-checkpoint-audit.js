"use strict";

// Read-only local integration audit; deliberately excluded from portable release fixtures.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { performance } = require("perf_hooks");
const { readSaveContainer } = require("../resources/app/out/main/worldline/save-container");
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");
const { HistoricalDefinitionIndexClient } = require("../resources/app/out/main/worldline/historical-definition-index");
const { HISTORICAL_ALIAS_CATALOG } = require("../resources/app/out/main/worldline/historical-alias-catalog");
const { analyzeSharedQuery, collectTerms } = require("../resources/app/out/main/worldline/shared-query-analyzer");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");
const ui = require("../resources/app/out/renderer/worldline-player-presentation").create("zh-CN");

async function main() {
  const [savePath, userFolder] = process.argv.slice(2);
  if (!savePath || !userFolder) throw new Error("usage: node scripts/v8.5.1-real-checkpoint-audit.js <save> <CK3 user folder>");
  const names = ["岳飞", "韩世忠", "秦桧", "赵构", "吴玠", "宗泽", "张浚", "张俊", "李纲", "辛弃疾", "范仲淹", "王安石", "苏轼", "文天祥", "赵匡胤", "赵思昭"];
  const client = new HistoricalDefinitionIndexClient({ getCK3UserFolderPath: () => userFolder, aliases: HISTORICAL_ALIAS_CATALOG });
  const started = performance.now();
  client.start();
  const container = readSaveContainer(savePath);
  if (!container.gamestate) throw new Error(container.containerKind);
  const snapshot = parseGameState(container.gamestate);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v851-audit-"));
  const service = new WorldlineService({ dataDir: root, settingsRepository: { getWorldlineSettings: () => ({}), saveWorldlineSettings: () => {} } });
  service.historicalDefinitionIndex.dispose();
  service.historicalDefinitionIndex = client;
  service.currentCheckpoint = { snapshot };
  try {
    await client.ready(120000);
    for (const query of names) await client.prepare(collectTerms(query), 5000);
    console.log(JSON.stringify({ sourceState: client.status, source: client.meta, gameDate: snapshot.gameDate, characters: snapshot.diagnostics.characterCount, buildAndParseMs: Math.round(performance.now() - started) }));
    for (const query of names) {
      const start = performance.now();
      const analysis = analyzeSharedQuery({ snapshot, query, historicalDefinitionLookup: value => client.find(value) });
      const found = client.find(query);
      const explanation = ui.historicalExplanation({ queryAnalysis: analysis, historicalIndex: client.meta });
      const mapping = service.getHistoricalBindings({ query });
      console.log(JSON.stringify({ query, lookup: found.status, definitionIds: (found.candidates || []).map(item => item.definitionId), runtimeCandidates: (analysis.identityResolution.candidates || []).map(item => ({ id: item.runtimeId, score: item.score })), status: analysis.historicalCoverage, factIds: analysis.characters.map(item => item.id), explanation: explanation.statusLabel, mappingCount: mapping.total, latencyMs: +(performance.now() - start).toFixed(3) }));
    }
    const durations = [];
    for (let i = 0; i < 160; i += 1) { const t = performance.now(); client.find(names[i % names.length]); durations.push(performance.now() - t); }
    durations.sort((a, b) => a - b);
    console.log(JSON.stringify({ warmLookup: { samples: durations.length, medianMs: durations[80], p95Ms: durations[152], maxMs: durations.at(-1) } }));
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
