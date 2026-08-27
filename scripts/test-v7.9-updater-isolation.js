"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const updateConfig = fs.readFileSync(path.join(root, "resources", "app-update.yml"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const updaterPath = path.join(root, "resources", "app", "out", "main", "app", "app-updater.js");
const updaterSource = fs.readFileSync(updaterPath, "utf8");

assert.match(updateConfig, /^owner:\s*wsdsb-111\s*$/m);
assert.match(updateConfig, /^repo:\s*VOCT-NEW\s*$/m);
assert.match(updateConfig, /^updaterCacheDirName:\s*votc-new-updater\s*$/m);
assert.doesNotMatch(updateConfig, /owner:\s*Voices-of-the-Court|repo:\s*VOTC\s*$|voices-of-the-court-updater/m);
assert(mainSource.includes("electron.app.isPackaged && VOTC_FORK_IDENTITY.autoUpdateEnabled"), "packaged startup must honor the disabled fork update policy");
assert(updaterSource.includes('repository: "wsdsb-111/VOCT-NEW"'));
assert(updaterSource.includes("autoUpdateEnabled: false"));
assert(updaterSource.includes("github.com/wsdsb-111/VOCT-NEW/releases"));
assert(!updaterSource.includes("github.com/Voices-of-the-Court/VOTC/releases"), "Fork changelog must not point to upstream releases");

let providerChecks = 0;
const listeners = new Map();
const autoUpdater = {
  on(event, handler) { listeners.set(event, handler); },
  checkForUpdates() { providerChecks++; }
};
const { createAppUpdater, VOTC_FORK_IDENTITY } = require(updaterPath);
assert.strictEqual(VOTC_FORK_IDENTITY.autoUpdateEnabled, false);
const AppUpdater = createAppUpdater({
  electronUpdater: { autoUpdater },
  log: { info() {}, error() {} },
  settingsRepository: { getAllowPrerelease: () => false, getLanguage: () => "en" },
  electron: { dialog: { showMessageBox: async () => ({ response: 2 }) }, shell: { openExternal: async () => {} } },
  updaterTranslations: { en: {} }
});
const updater = new AppUpdater();
assert.strictEqual(updater.checkForUpdates(), null);
assert.strictEqual(providerChecks, 0, "disabled fork updater must not contact any release provider");
assert(updater.getChangelogUrl("7.9").includes("wsdsb-111/VOCT-NEW"));

console.log("VOTC v7.9 updater isolation: PASS (fork target, cache, changelog and startup guard)");
