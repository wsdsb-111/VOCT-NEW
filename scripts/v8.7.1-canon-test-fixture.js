"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { CanonService } = require("../resources/app/out/main/worldline/canon-service");

function createCanonFixture({ gameDate = "1175.1.1", totalDays = 430000 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v871-canon-"));
  let checkpoint = {
    id: "checkpoint-1",
    source: { path: "C:\\saves\\autosave.ck3", fingerprint: "a".repeat(64) },
    snapshot: {
      playthroughId: "v871-campaign",
      gameDate,
      totalDays,
      playerId: "1",
      characters: {
        "1": { id: "1", firstName: "玩家", fullName: "赵思昭", alive: true, location: "临安", faith: "儒教", culture: "汉", liege: "0", primaryTitle: "e_china", courtEmployer: "1", imprisoned: false },
        "2": { id: "2", firstName: "韩世忠", fullName: "韩世忠", alive: true, location: "临安", faith: "儒教", culture: "汉", liege: "1", primaryTitle: "c_linan", courtEmployer: "1", imprisoned: false }
      }
    }
  };
  const service = new CanonService({ root, getCheckpoint: () => checkpoint, getLiveState: () => ({ gameDate: checkpoint.snapshot.gameDate, totalDays: checkpoint.snapshot.totalDays, characters: [] }) });
  return {
    root,
    service,
    checkpoint: () => checkpoint,
    advance({ gameDate: nextDate, totalDays: nextDays, fingerprint = "b".repeat(64) }) {
      checkpoint = { ...checkpoint, id: `checkpoint-${nextDate}`, source: { ...checkpoint.source, fingerprint }, snapshot: { ...checkpoint.snapshot, gameDate: nextDate, totalDays: nextDays } };
    },
    dispose() { fs.rmSync(root, { recursive: true, force: true }); }
  };
}

async function create(service, payload) {
  const page = await service.list();
  return service.mutate({ token: page.branch.token, operation: "create", payload });
}

module.exports = { create, createCanonFixture };
