"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v871-recall-settings-"));
  let saved = {};
  const service = new WorldlineService({ dataDir: root, settingsRepository: { getWorldlineSettings: () => saved, saveWorldlineSettings: value => { saved = value; } } });
  try {
    const result = service.setRecallSettings({ promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION" });
    assert.equal(result.promptIntegrationEnabled, true);
    assert.equal(result.subjectiveWorldMode, "PRODUCTION");
    assert.equal(saved.autosavePath, null);
    assert.throws(() => service.setRecallSettings({ subjectiveWorldMode: "INVALID" }), /worldline_subjective_mode_invalid/);
    assert.throws(() => service.setRecallSettings({ promptIntegrationEnabled: "true" }), /worldline_prompt_integration_invalid/);
    assert.throws(() => service.setRecallSettings({}), /worldline_recall_settings_empty/);
    assert.throws(() => service.setRecallSettings(null), /worldline_recall_settings_invalid/);
    console.log("V8.7.1 recall settings contract PASS");
  } finally {
    service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
