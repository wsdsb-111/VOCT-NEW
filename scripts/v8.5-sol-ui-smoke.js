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
        getAnnualDelta: async () => ({ annualDelta: [] }), getWorldKnowledge: async () => ({ gameTruth: [] }),
        getHistoricalBindings: async () => ({ bindings: [], total: 0 }), getDiagnostics: async () => ({}), listSupplemental: async () => ({ supplemental: [] }),
        getPromptDiagnostics: async payload => ({ promptDiagnostics: { available: true, query: payload.query, queryAnalysis: {}, gameTruth: {}, tokenBreakdown: [],
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
    await page.getByText("展开 Resolver 详细信息", { exact: true }).waitFor();
    assert.equal(await page.locator(".worldline-prompt-row").count(), 0, "collapsed details create no list nodes");
    await page.getByText("展开 Resolver 详细信息", { exact: true }).click();
    await page.getByText("delta-0", { exact: true }).waitFor();
    assert.equal(await page.locator(".worldline-prompt-row").count(), 50, "legacy 42313 records are capped in the real DOM");
    await page.evaluate(() => { window.legacyPayload = false; });
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.getByText("delta-50", { exact: true }).waitFor();
    for (const theme of ["parchment", "ink", "knight"]) {
      await page.evaluate(value => document.documentElement.setAttribute("data-votc-theme", value), theme);
      await page.getByRole("button", { name: "上一页", exact: true }).click();
      await page.getByText("delta-0", { exact: true }).waitFor();
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await page.getByText("delta-50", { exact: true }).waitFor();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "PASS", mode: "real Chromium + production React/WorldlineView, fixture IPC", legacyRecords: 42313, visibleRows: await page.locator(".worldline-prompt-row").count(), domNodes: await page.locator("*").count(), errors }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
