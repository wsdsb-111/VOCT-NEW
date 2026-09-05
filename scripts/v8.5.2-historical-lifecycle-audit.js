"use strict";

// Read-only source audit. Optional wait verifies the actual 60-second timer;
// it is not part of the deterministic release fixtures or the final soak gate.
const assert = require("assert");
const { performance } = require("perf_hooks");
const { HistoricalDefinitionIndexClient } = require("../resources/app/out/main/worldline/historical-definition-index");
const { HISTORICAL_ALIAS_CATALOG } = require("../resources/app/out/main/worldline/historical-alias-catalog");

async function main() {
  const [userFolder, waitArgument = "65000"] = process.argv.slice(2);
  if (!userFolder) throw new Error("usage: node scripts/v8.5.2-historical-lifecycle-audit.js <CK3 user folder> [wait ms]");
  const waitMs = Number(waitArgument);
  if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 180000) throw new Error("wait_ms_out_of_range");
  let updates = 0;
  const client = new HistoricalDefinitionIndexClient({ getCK3UserFolderPath: () => userFolder, aliases: HISTORICAL_ALIAS_CATALOG, onUpdated: () => updates++ });
  try {
    const startedAt = performance.now();
    await client.ready(120000);
    assert(client.meta, "source build must finish");
    const query = "司马光、欧阳修、耶律阿保机、完颜阿骨打、岳飞、韩世忠在哪里？";
    await client.prepareQuery(query, 10000);
    const result = client.scan(query);
    const baseline = { revision: client.meta.revision, generation: client.generation, buildCount: client.meta.buildCount, updates };
    console.log(JSON.stringify({ phase: "built", durationMs: Math.round(performance.now() - startedAt), state: client.status, diagnostics: client.meta.diagnostics, matches: result.matches.map(item => ({ name: item.value, definitions: item.result.candidateTotal, complete: item.result.candidateSetComplete })), ...baseline }));
    const probes = [];
    for (let i = 0; i < 3; i++) { const start = performance.now(); await client.refresh({}, 120000); probes.push(Math.round(performance.now() - start)); }
    assert.equal(client.meta.buildCount, baseline.buildCount);
    assert.equal(client.generation, baseline.generation);
    assert.equal(updates, baseline.updates);
    assert.strictEqual(client.scan(query), result);
    const timings = [];
    for (let i = 0; i < 200; i++) { const start = performance.now(); client.scan(query); timings.push(performance.now() - start); }
    timings.sort((a, b) => a - b);
    const previousProbe = client.meta.probeCount;
    console.log(JSON.stringify({ phase: "no_op", probesMs: probes, newBuilds: client.meta.buildCount - baseline.buildCount, cacheInvalidations: updates - baseline.updates, warmClientScan: { medianMs: timings[100], p95Ms: timings[190], maxMs: timings.at(-1) }, waitingForTimerMs: waitMs }));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    if (waitMs >= 65000) assert(client.meta.probeCount > previousProbe, "the periodic source probe must actually run");
    assert.equal(client.meta.buildCount, baseline.buildCount);
    assert.equal(client.generation, baseline.generation);
    assert.equal(updates, baseline.updates);
    assert.strictEqual(client.scan(query), result);
    console.log(JSON.stringify({ phase: "PASS", periodicProbes: client.meta.probeCount - previousProbe, newBuilds: 0, cacheInvalidations: 0, revision: client.meta.revision }));
  } finally { client.dispose(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
