"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { HistoricalGroundTruthStore } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-ground-truth-store"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v831-ground-truth-"));
try {
  const store = new HistoricalGroundTruthStore({ rootDir: tempRoot });
  const base = {
    schemaVersion: 1,
    capturedAt: "2026-08-31T12:00:00.000Z",
    campaignId: `ck3-${"a".repeat(32)}`,
    gameDate: "1153年4月2日",
    figureKey: "yue_fei",
    resolverStatus: "RESOLVED",
    score: 0.85,
    matchedCharacterId: 101,
    actualAge: 50,
    actualCulture: "汉人",
    verdict: "CORRECT"
  };
  store.append({ ...base, captureId: "capture-a" });
  store.append({ ...base, captureId: "capture-b", verdict: "INCORRECT" });
  const lines = fs.readFileSync(store.getFilePath(), "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.strictEqual(lines.length, 2, "verdicts must append rather than overwrite");
  assert.deepStrictEqual(lines.map((record) => record.captureId), ["capture-a", "capture-b"], "copied saves sharing campaignId must retain distinct captures");
  assert(!store.getFilePath().includes("dynamic_history"));

  const failingStore = new HistoricalGroundTruthStore({
    rootDir: path.join(tempRoot, "failure"),
    fs: { ...fs, appendFileSync: () => { throw new Error("disk full"); } }
  });
  assert.throws(() => failingStore.append({ ...base, captureId: "capture-c" }), /ground_truth_save_failed/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("VOTC v8.3.1 Ground Truth Store: PASS (append-only, copied-save safety, diagnostics path, write failure)");
