"use strict";

// Optional real-browser smoke. Uses installed Playwright, no providers or user data.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.VOTC_PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.VOTC_BROWSER_PATH ? { executablePath: process.env.VOTC_BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, locale: "zh-CN" });
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error("PAGE_ERROR", error.message); });
    await page.route("http://votc-smoke.local/**", route => route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }));
    await page.goto("http://votc-smoke.local/");
    await page.evaluate(() => {
      const rows = Array.from({ length: 42313 }, (_, i) => ({ id: `delta-${i}`, reason: "UNRELATED_DELTA" }));
      window.worldlineAPI = {
        getSettings: async () => ({}), getCheckpointStatus: async () => ({}), getOverview: async () => ({}),
        getAnnualDelta: async () => ({ annualDelta: [{ id: "war", type: "WAR_NO_LONGER_ACTIVE", date: "1169.1.1", actors: ["Chemgura (#16882983)", "Fei_name11"] }] }), getWorldKnowledge: async () => ({ gameTruth: [] }),
        getHistoricalBindings: async () => ({ bindings: [{ definitionId: "tangyin_yue_014", runtimeId: "96895", historicalName: "岳飞", currentCharacterName: "Fei_name11", status: "DIRECT" }], total: 1 }), getDiagnostics: async () => ({}), listSupplemental: async () => ({ supplemental: [] }),
        getPromptDiagnostics: async payload => ({ promptDiagnostics: { available: true, query: payload.query, queryAnalysis: { identityResolution: { status: "AMBIGUOUS", reason: "MULTIPLE_CANDIDATES", candidates: [{ runtimeId: "96895", definitionId: "tangyin_yue_014", rawName: "Fei_name11", score: 0.77, evidence: [{code:"NAME_EXACT"}], conflicts: [] }, { runtimeId: "96896", definitionId: "nansong_yue_085", rawName: "飞", score: 0.77, evidence: [{code:"AGE_MATCH_STRONG"}], conflicts: [] }] }, entityResolutions: [{ subjectName: "岳飞", identityKind: "HISTORICAL", resolutionStatus: "AMBIGUOUS", candidateTotal: 2, sourceComplete: true, worldlineDifferences: [{ code: "AGE_WORLDLINE_SHIFT", expectedBirth: "1103.3.24", currentBirth: "1104.1.1" }] }, { subjectName: "韩世忠", identityKind: "HISTORICAL", resolutionStatus: "RESOLVED", candidateTotal: 1, sourceComplete: true, worldlineDifferences: [] }, { subjectName: "赵思昭", identityKind: "RUNTIME_NATIVE", resolutionStatus: "RESOLVED", candidateTotal: 1, sourceComplete: true, worldlineDifferences: [] }], historicalCoverage: [{status:"AMBIGUOUS", reason:"MULTIPLE_CANDIDATES"}] }, historicalIndex: {status:"READY",sourceComplete:true}, gameTruth: {}, tokenBreakdown: [],
          trimmedItems: window.legacyPayload ? rows : rows.slice(payload.trimmedPage * 50, (payload.trimmedPage + 1) * 50), trimmedPage: payload.trimmedPage, trimmedPageSize: 50, trimmedTotal: rows.length } }),
        onUpdated: () => () => {}
      };
      window.llmConfigAPI = { getLanguage: async () => "zh" };
      window.legacyPayload = true;
    });
    const renderer = path.join(__dirname, "../resources/app/out/renderer");
    await page.addStyleTag({ path: path.join(renderer, "assets/index-WtJH_nua.css") });
    await page.addScriptTag({ path: path.join(renderer, "worldline-player-presentation.js") });
    const original = fs.readFileSync(path.join(renderer, "assets/index-Dn3qWlAB.js"), "utf8");
    const mount = 'jsxRuntimeExports.jsx(App, {})';
    assert.ok(original.includes(mount));
    await page.route("http://votc-smoke.local/renderer.js", route => route.fulfill({ contentType: "text/javascript", body: original.replace(mount, 'jsxRuntimeExports.jsx(WorldlineView, {})') }));
    await page.addScriptTag({ type: "module", url: "http://votc-smoke.local/renderer.js" });
    await page.getByRole("tab", { name: "诊断", exact: true }).click();
    await page.getByPlaceholder("输入要检查的查询，例如：岳飞现在在哪里").fill("岳飞");
    await page.getByRole("button", { name: "运行诊断", exact: true }).click();
    await page.getByText("展开开发者原始数据", { exact: true }).waitFor();
    assert.equal(await page.locator(".worldline-prompt-row").count(), 0, "collapsed details create no list nodes");
    await page.getByText("展开开发者原始数据", { exact: true }).click();
    await page.getByText("delta-0", { exact: true }).waitFor();
    assert.equal(await page.locator(".worldline-prompt-row").count(), 50, "legacy 42313 records are capped in the real DOM");
    await page.evaluate(() => { window.legacyPayload = false; });
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.getByText("delta-50", { exact: true }).waitFor();
    for (const width of [1024, 1280, 1440]) for (const theme of ["parchment", "ink", "knight"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(value => document.documentElement.setAttribute("data-votc-theme", value), theme);
      await page.getByRole("button", { name: "上一页", exact: true }).click();
      await page.getByText("delta-0", { exact: true }).waitFor();
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await page.getByText("delta-50", { exact: true }).waitFor();
      await page.getByText("展开开发者原始数据", { exact: true }).click();
      await page.getByText("展开历史人物判定依据", { exact: true }).click();
      await page.locator(".worldline-candidate-readable").first().waitFor();
      assert.equal(await page.locator(".worldline-candidate-readable").count(), 2);
      await page.getByText("逐实体身份与世界线差异", { exact: true }).click();
      await page.locator(".worldline-entity-resolution-card").first().waitFor();
      assert.equal(await page.locator(".worldline-entity-resolution-card").count(), 3, "all diagnostic entities remain visible");
      const entityText = await page.locator(".worldline-entity-resolution-list").innerText();
      assert.ok(entityText.includes("岳飞") && entityText.includes("韩世忠") && entityText.includes("赵思昭"));
      assert.ok(entityText.includes("当前角色出生时间与历史基准存在偏移，不影响已确认的历史身份。"));
      assert.ok(!/runtimeId|definitionId|NAME_EXACT|Fei_name11|96895/.test(entityText), "entity semantic layer contains no raw IDs or evidence codes");
      await page.getByText("逐实体身份与世界线差异", { exact: true }).click();
      const visible = await page.locator(".worldline-prompt-result").innerText();
      assert.ok(!/runtimeId|definitionId|NAME_EXACT|AGE_MATCH_STRONG|Fei_name11|96895/.test(visible), "A/B layers contain no raw evidence or ID");
      assert.ok(visible.includes("0.77 / 1.00"));
      await page.getByText("展开历史人物判定依据", { exact: true }).click();
      await page.getByRole("tab", { name: "年度变化", exact: true }).click();
      assert.ok((await page.locator(".worldline-delta-row").innerText()).includes("Chemgura"));
      assert.ok(!/16882983|Fei_name11/.test(await page.locator(".worldline-delta-row").innerText()));
      await page.getByRole("tab", { name: "历史人物", exact: true }).click();
      assert.ok(!/96895|tangyin_yue_014|Fei_name11/.test(await page.locator(".worldline-semantic-binding-row").innerText()));
      await page.getByRole("tab", { name: "诊断", exact: true }).click();
      await page.getByText("展开开发者原始数据", { exact: true }).click();
      await page.getByText("delta-50", { exact: true }).waitFor();
      assert.ok(await page.locator(".worldline-candidate-card").count() === 2, "raw candidate evidence remains reachable");
    }
    fs.mkdirSync(path.join(__dirname, "../output/playwright"), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, "../output/playwright/v8.5.2-luna-diagnostics.png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "PASS", mode: "real Chromium + production React/WorldlineView, fixture IPC", legacyRecords: 42313, visibleRows: await page.locator(".worldline-prompt-row").count(), domNodes: await page.locator("*").count(), errors }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
