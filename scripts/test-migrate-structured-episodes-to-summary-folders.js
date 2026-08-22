"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { migrateStructuredEpisodes } = require("./migrate-structured-episodes-to-summary-folders");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-structured-summary-migration-"));
try {
  const episodesDir = path.join(tempDir, "memory", "episodes");
  const summariesDir = path.join(tempDir, "conversation_summaries");
  fs.mkdirSync(episodesDir, { recursive: true });
  fs.writeFileSync(path.join(episodesDir, "episode_pair.json"), JSON.stringify({
    date: "1121年1月29日",
    totalDays: 409194,
    sessionSummary: "甲与乙完成了一次对话。",
    participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }]
  }), "utf8");
  const first = migrateStructuredEpisodes({ episodesDir, summariesDir });
  assert.deepStrictEqual(first, { episodesScanned: 1, summariesWritten: 2, existingSkipped: 0, invalidEpisodes: 0 });
  const leftPath = path.join(summariesDir, "1_甲", "与乙的对话.json");
  const rightPath = path.join(summariesDir, "2_乙", "与甲的对话.json");
  assert(fs.existsSync(leftPath) && fs.existsSync(rightPath), "each participant must receive a separate counterpart summary file");
  assert.strictEqual(JSON.parse(fs.readFileSync(leftPath, "utf8"))[0].characterId, 2);
  assert.strictEqual(JSON.parse(fs.readFileSync(rightPath, "utf8"))[0].characterId, 1);
  const second = migrateStructuredEpisodes({ episodesDir, summariesDir });
  assert.deepStrictEqual(second, { episodesScanned: 1, summariesWritten: 0, existingSkipped: 2, invalidEpisodes: 0 }, "migration must not duplicate existing summaries");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("VOTC structured episode migration: PASS (directed folders, counterpart files, no overwrite)");
