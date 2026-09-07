"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Character, inferGenderFromPronoun } = require("../resources/app/out/main/game-data/character");
const { createLogParser } = require("../resources/app/out/main/game-data/log-parser");
const { createRelationshipResolver } = require("../resources/app/out/main/game-data/relationship-resolver");
const { CK3LogProductionFixture, productionFamilyLogLines } = require("./v8.7-production-fixtures");

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v870-family-"));
  const logPath = path.join(tempDir, "debug.log");
  try {
    fs.writeFileSync(logPath, `${productionFamilyLogLines().join("\n")}\n`, "utf8");
    const parseLog = createLogParser({ GameData: CK3LogProductionFixture, Character });
    const gameData = await parseLog(logPath);
    const profiles = createRelationshipResolver({ onDiagnostic: () => false }).buildCanonicalProfiles(gameData.characters, gameData.totalDays, inferGenderFromPronoun);
    for (const [id, reason] of [[10, "MURDER"], [11, "DISEASE"], [12, "BATTLE"]]) {
      const profile = profiles.get(id);
      assert(profile, `production relative ${id} must survive canonicalization`);
      assert.equal(profile.alive, false);
      assert.equal(profile.deathDateTotalDays, 428000);
      assert.equal(profile.deathDate, "1171年9月2日");
      assert.equal(profile.deathReason, reason);
      assert.equal(profile.age, Math.floor((428000 - profile.birthDateTotalDays) / 365.2425));
    }
    console.log("V8.7.0 Production Family Adapter: PASS (parser-shaped parent/child/sibling death passthrough)");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
