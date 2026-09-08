"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v871-picker-"));
try {
  const service = new WorldlineService({ dataDir: root, settingsRepository: { getWorldlineSettings: () => ({}), saveWorldlineSettings() {} } });
  service.currentCheckpoint = { id: "picker", snapshot: { playerId: "1", characters: {
    "1": { firstName: "赵思昭", alive: true, domainTitles: ["e_china"], courtEmployer: "1", liege: "0" },
    "2": { firstName: "韩世忠", fullName: "韩世忠", alive: true, domainTitles: ["c_linan"], courtEmployer: "1", liege: "1" },
    "3": { firstName: "岳飞", alive: false, domainTitles: [], courtEmployer: "1", liege: "1" }
  } } };
  service.getLiveState = () => ({ characters: [{ runtimeId: "2" }] });
  const result = service.listCanonCharacterOptions({ query: "韩" });
  assert.equal(result.total, 1);
  assert.deepEqual(result.options[0], { runtimeId: "2", displayName: "韩世忠", title: "c_linan", alive: true, court: "1", realm: "1", recentlyMentioned: true, currentlyPresent: false });
  console.log("V8.7.1 character picker API PASS");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
