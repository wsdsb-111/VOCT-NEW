"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CK3LocalizationResolver } = require("../resources/app/out/main/worldline/localization-resolver");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v841-hotfix-incomplete-"));
try {
  const userFolder = path.join(tempRoot, "Documents", "Paradox Interactive", "Crusader Kings III");
  fs.mkdirSync(userFolder, { recursive: true });
  fs.writeFileSync(path.join(userFolder, "dlc_load.json"), JSON.stringify({ enabled_mods: ["mod/missing.mod"] }), "utf8");
  const resolver = new CK3LocalizationResolver({ fs, path, getCK3UserFolderPath: () => userFolder });
  const lookup = resolver.findRawKeysByLocalizedValue("character", "岳飞");
  assert.equal(lookup.status, "INCOMPLETE_SOURCE_SCAN", "a missing descriptor must be observable instead of becoming a false no-match");
  assert.equal(lookup.sourceComplete, false, "incomplete source discovery must remain explicit");
  assert.deepEqual(lookup.missingDescriptors, ["mod/missing.mod"], "the unresolved descriptor must be retained for diagnostics");
  assert.deepEqual(lookup.matches, [], "incomplete scans must fail closed without identity aliases");
  console.log("V8.4.1 Hotfix Incomplete Source: PASS (diagnostic instead of empty alias result)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
