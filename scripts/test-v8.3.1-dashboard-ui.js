"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const helpers = require(path.join(root, "resources", "app", "out", "renderer", "historical-dashboard-helpers"));

const rows = [
  { figureKey: "ambiguous", historical: { name: "岳飞", resolverReady: true }, resolution: { status: "AMBIGUOUS", matchedCharacterId: null }, character: { id: 101, name: "岳飞", fullName: "岳飞" } },
  { figureKey: "candidate", historical: { name: "王安石", resolverReady: true }, resolution: { status: "CANDIDATE", matchedCharacterId: null }, character: { id: 202, name: "王安石", fullName: "荆国公王安石" } },
  { figureKey: "missing", historical: { name: "苏轼", resolverReady: true }, resolution: { status: "DUE_UNRESOLVED", matchedCharacterId: null }, character: null },
  { figureKey: "resolved", historical: { name: "寇准", resolverReady: true }, resolution: { status: "RESOLVED", matchedCharacterId: 303 }, character: { id: 303, name: "寇准", fullName: "寇准" } },
  { figureKey: "unsupported", historical: { name: "未支持", resolverReady: false }, resolution: { status: "UNSUPPORTED", matchedCharacterId: null }, character: null }
];

assert.deepStrictEqual(helpers.filterFigureRows(rows, { readyOnly: true, statusFilter: "REVIEW", search: "" }).map((row) => row.figureKey), ["ambiguous", "candidate", "missing"]);
assert.deepStrictEqual(helpers.filterFigureRows(rows, { readyOnly: false, statusFilter: "ALL", search: "202" }).map((row) => row.figureKey), ["candidate"]);
assert.deepStrictEqual(helpers.filterFigureRows(rows, { readyOnly: true, statusFilter: "ALL", search: "candidate" }).map((row) => row.figureKey), ["candidate"]);
assert.deepStrictEqual(helpers.filterFigureRows(rows, { readyOnly: true, statusFilter: "ALL", search: "yue_fei" }).map((row) => row.figureKey), []);
assert.deepStrictEqual(helpers.filterFigureRows(rows, { readyOnly: true, statusFilter: "ALL", search: "岳飞" }).map((row) => row.figureKey), ["ambiguous"]);
assert.strictEqual(helpers.findNextReviewFigureKey(rows), "ambiguous");
assert.strictEqual(helpers.findNextReviewFigureKey(rows, "ambiguous"), "candidate");
assert.strictEqual(helpers.findNextReviewFigureKey(rows, "candidate"), "missing");

const preload = fs.readFileSync(path.join(root, "resources", "app", "out", "preload", "preload.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
const css = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-WtJH_nua.css"), "utf8");
const html = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "index.html"), "utf8");
assert(preload.includes('exposeInMainWorld("historicalAPI"'));
assert(preload.includes("historical:getFigureGroundTruthDashboard"));
assert(preload.includes("historical:recordFigureGroundTruthVerdict"));
assert(html.indexOf("historical-dashboard-helpers.js") < html.indexOf("index-Dn3qWlAB.js"));
for (const text of ["历史人物实机校准", "重新读取当前游戏", "只显示已校准人物", "下一个待核验", "史实基准", "当前 CK3", "Culture Raw", "SHADOW MODE", "SHOULD_BE_AMBIGUOUS"]) assert(renderer.includes(text), `renderer missing ${text}`);
for (const className of ["historical-dashboard", "historical-score-bar", "historical-evidence-groups", "historical-alternatives", "historical-verdicts"]) assert(css.includes(`.${className}`), `CSS missing ${className}`);

console.log("VOTC v8.3.1 Dashboard UI: PASS (ready/status/search/next helpers, preload API, required diagnostics controls)");
