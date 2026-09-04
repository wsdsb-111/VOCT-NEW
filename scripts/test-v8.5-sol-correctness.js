"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");
const { buildWorldQueryPlan } = require("../resources/app/out/main/worldline/world-query-planner");
const { rankWorldCandidates } = require("../resources/app/out/main/worldline/world-ranker");
const { buildWorldCandidates } = require("../resources/app/out/main/worldline/world-retriever");
const presentation = require("../resources/app/out/renderer/worldline-player-presentation");
const { createPlayerOverview } = require("../resources/app/out/main/worldline/world-presentation");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v85-sol-"));
const failures = [];
function check(name, run) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}
try {
  const savePath = path.join(root, "autosave.ck3");
  const service = new WorldlineService({ dataDir: root, settingsRepository: {
    getWorldlineSettings: () => ({ autosavePath: savePath, lastValidationStatus: "VALID", promptIntegrationEnabled: true, autoWatchEnabled: false }),
    saveWorldlineSettings: () => {}
  }});
  const snapshot = { gameDate: "1169.1.1", playerId: "121091", playthroughId: "sol-a", diagnostics: { characterCount: 1 },
    characters: { "121091": { id: "121091", firstName: "思昭", alive: true } },
    nameToCharacterIds: { "思昭": ["121091"] }, titles: {}, wars: {}, definitionToRuntime: {}, runtimeToDefinitions: {} };
  service.currentCheckpoint = { id: "sol-checkpoint", source: { path: savePath }, snapshot };
  service.buildState = "ACTIVE";
  service.getLiveState = () => ({ connected: true, gameDate: "1169.1.1", characters: [] });
  service.annualDelta = Array.from({ length: 42312 }, (_, i) => ({ id: `delta-${i}`, campaignId: "sol-a", type: "WAR_NO_LONGER_ACTIVE", date: "1168.1.1", source: "DERIVED_GAMESTATE", actors: [{ runtimeId: "999" }] }));
  check("42312 Delta diagnostics have bounded IPC pages and all records remain reachable", () => {
    const first = service.getPromptDiagnostics({ query: "赵思昭" }).promptDiagnostics;
    assert.equal(first.trimmedTotal, 42312);
    assert.equal(first.trimmedItems.length, 50);
    assert.ok(JSON.stringify(first).length < 40000);
    const second = service.getPromptDiagnostics({ query: "赵思昭", trimmedPage: 1 }).promptDiagnostics;
    assert.notEqual(second.trimmedItems[0].id, first.trimmedItems[0].id);
    const last = service.getPromptDiagnostics({ query: "赵思昭", trimmedPage: 99999 }).promptDiagnostics;
    assert.equal(last.trimmedItems.length, 12);
    assert.equal(last.trimmedPage, 846);
  });
  check("numeric identity tokens are not dates", () => {
    for (const query of ["#96896", "121091", "nansong_yue_085", "han_12371", "title_1168"]) {
      assert.equal(buildWorldQueryPlan({ query }).time.mode, "UNSPECIFIED", query);
    }
    assert.equal(buildWorldQueryPlan({ query: "1168 年某人物发生了什么" }).time.mode, "AS_OF");
    assert.equal(buildWorldQueryPlan({ query: "1168.2.31" }).time.mode, "INVALID");
  });
  const analysis = { resolvedCharacters: [{ id: "121091", displayName: "思昭", aliases: ["思昭", "121091"] }], entityAnchoredTerms: ["思昭"] };
  check("entity events never enable unrelated broad-world Delta", () => {
    assert.equal(buildWorldQueryPlan({ query: "思昭最近发生了什么", analysis }).broadWorldIntent, false);
  });
  check("future and date-range Supplemental never leak into present", () => {
    const candidates = buildWorldCandidates({ snapshot, analysis, supplemental: [
      { id: "future", title: "思昭", body: "future", entities: ["思昭"], visibility: "PUBLIC_WORLD", gameDate: "1200.1.1" },
      { id: "range", title: "思昭", body: "future range", entities: ["思昭"], visibility: "PUBLIC_WORLD", dateRange: "1200-1201" }
    ] });
    const result = rankWorldCandidates(candidates, { plan: buildWorldQueryPlan({ query: "思昭现在如何", analysis }), checkpointDate: snapshot.gameDate });
    assert.equal(result.selected.supplemental.length, 0);
  });
  check("Supplemental ranking inputs invalidate relevant caches", () => {
    service.annualDelta = [];
    service.supplemental = Array.from({length: 4}, (_, i) => ({ id: `note-${i}`, checkpointId: "sol-checkpoint", title: "思昭", body: "note", entities: ["思昭"], visibility: "PUBLIC_WORLD", importance: "NORMAL" }));
    service.getPromptContext({ query: "思昭" });
    service.supplemental[3].importance = "HIGH";
    const changed = service.getPromptContext({ query: "思昭" });
    assert.equal(changed.cacheHit, false);
    assert.ok(changed.retrieval.selected.supplemental.some(item => item.payload.id === "note-3"));
  });
  check("128 visibility, time, hidden and query combinations remain fail-closed", () => {
    let cases = 0;
    for (const visibility of ["PUBLIC_WORLD", "PERSONAL", "SECRET", undefined]) for (const hidden of [false, true]) {
      for (const gameDate of ["1168.1.1", "1200.1.1", "1168.2.31", null]) for (const query of ["思昭现在如何", "思昭最近如何", "思昭1200年如何", "思昭1167年如何"]) {
        const candidates = buildWorldCandidates({ snapshot, analysis, supplemental: [{ id: "matrix", title: "思昭", body: "fixture", entities: ["思昭"], visibility, hidden, gameDate }] });
        const result = rankWorldCandidates(candidates, { plan: buildWorldQueryPlan({ query, analysis }), checkpointDate: snapshot.gameDate });
        if (visibility !== "PUBLIC_WORLD" || hidden || gameDate === "1200.1.1" || gameDate === "1168.2.31" || query.includes("1167年")) assert.equal(result.selected.supplemental.length, 0, JSON.stringify({visibility, hidden, gameDate, query}));
        else if (gameDate || !query.includes("1200年")) assert.equal(result.selected.supplemental.length, 1);
        cases++;
      }
    }
    assert.equal(cases, 128);
  });
  check("cache capacity, campaign isolation and hard token cap", () => {
    service.supplemental = [];
    service.annualDelta = [{ id: "foreign", campaignId: "sol-b", type: "WAR_STARTED", date: "1168.1.1" }];
    for (let i = 0; i < 80; i++) {
      const result = service.getPromptContext({ query: `思昭 最近 ${i}` });
      assert.equal(result.retrieval.selected.delta.length, 0);
      assert.ok(result.retrieval.worldPromptTokens <= 1200);
    }
    assert.ok(service.worldKnowledgeState.topicPatchCache.size <= 8);
    assert.ok(service.worldKnowledgeState.summaryCache.size <= 64);
    service.currentCheckpoint = { ...service.currentCheckpoint, id: "long-player", snapshot: { ...snapshot, characters: { "121091": { id: "121091", firstName: "超长名字".repeat(5000), alive: true } } } };
    assert.equal(service.getPromptContext({query:"#121091"}), null, "untrimmable fixed context must not exceed hard cap");
    service.currentCheckpoint = { id: "sol-checkpoint", source: {path: savePath}, snapshot };
  });
  check("missing political evidence never means independence", () => {
    assert.equal(createPlayerOverview({ snapshot }).directLiege, "尚未确认");
    assert.equal(createPlayerOverview({ snapshot, politicalContext: {confidence:{directLiege:"INDEPENDENT"}} }).directLiege, "无直接领主");
  });
  check("legacy oversized diagnostics do not create unbounded renderer nodes", () => {
    const source = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/assets/index-Dn3qWlAB.js"), "utf8");
    const component = source.slice(source.indexOf("function WorldlineView()"), source.indexOf("function ConfigPanel", source.indexOf("function WorldlineView()")));
    const diagnostic = { available: true, query: "岳飞", queryAnalysis: {}, trimmedItems: Array.from({length: 42313}, (_, i) => ({id: String(i), reason: "UNRELATED_DELTA"})), tokenBreakdown: [] };
    let nodes = 0, state = 0;
    const react = { useState: initial => { const index = state++; return [index === 12 ? diagnostic : index === 15 ? "diagnostics" : initial, () => {}]; }, useRef: current => ({current}), useEffect: () => {} };
    const jsx = { jsx: () => { nodes++; return null; }, jsxs: () => { nodes++; return null; } };
    const render = new Function("reactExports", "jsxRuntimeExports", "useTranslation", "window", "navigator", `${component}; return WorldlineView;`)(react, jsx, () => ({i18n:{language:"zh-CN"}}), { VOTCWorldlinePlayerPresentation: presentation }, {});
    render();
    assert.ok(nodes < 1500, `created ${nodes} nodes`);
  });
  service.dispose();
} finally { fs.rmSync(root, { recursive: true, force: true }); }
assert.deepEqual(failures, [], "Sol correctness findings must all be repaired");
console.log("V8.5 Sol Correctness: PASS");
