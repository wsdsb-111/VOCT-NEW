"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { actionChecks, followupChecks, releaseChecks } = require("./test-manifest");

const scriptsDir = __dirname;
const allTests = fs.readdirSync(scriptsDir).filter((name) => /^test-.*\.js$/.test(name));
const direct = releaseChecks.map((check) => check.script).filter(Boolean);
const covered = new Set([...direct, ...actionChecks, ...followupChecks, "test-release.js", "test-manifest.js"]);
const missing = allTests.filter((name) => !covered.has(name));
assert.deepStrictEqual(missing, [], `unclassified test files: ${missing.join(", ")}`);
assert.strictEqual(new Set(releaseChecks.map((check) => check.group)).size, releaseChecks.length, "release group names must be unique");
for (const script of [...direct, ...actionChecks, ...followupChecks]) {
  assert(fs.existsSync(path.join(scriptsDir, script)), `manifest references missing script: ${script}`);
}
const releaseSource = fs.readFileSync(path.join(scriptsDir, "test-release.js"), "utf8");
const actionSource = fs.readFileSync(path.join(scriptsDir, "test-action-regression.js"), "utf8");
const ciSource = fs.readFileSync(path.join(scriptsDir, "..", ".github", "workflows", "regression.yml"), "utf8");
assert(releaseSource.includes('require("./test-manifest")'));
assert(actionSource.includes('require("./test-manifest")'));
assert(ciSource.includes("node scripts/test-release.js"), "CI must execute the same release manifest as local validation");
assert(/uses: actions\/checkout@v4\s+with:\s+lfs: true/.test(ciSource), "CI checkout must fetch Git LFS release assets");

console.log(`VOTC test manifest: PASS (${allTests.length} test files classified; ${releaseChecks.length} release groups)`);
