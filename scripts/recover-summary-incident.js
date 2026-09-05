"use strict";

// Explicit maintenance tool: prepare in an isolated directory, then apply only
// validated outputs after VOTC exits. Never rewrites provider configuration.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const memorySystem = require("../resources/app/out/main/memory-system");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); };

function runtime(dataDir) {
  const summariesDir = path.join(dataDir, "conversation_summaries");
  const engine = new memorySystem.MemoryEngine({ baseDir: path.join(dataDir, "memory"), summaryFoldersDir: summariesDir, recoveryDir: path.join(dataDir, "memory_recovery"), trace: new memorySystem.MemoryTrace({ logger: { log() {} } }) });
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine: engine, summariesDir, getHistoricalReferenceByYear: () => "" });
  const persistCharacterFolders = async (summary, context) => {
    const profiles = context.participants.map(p => ({ ...p, shortName: p.shortName || p.name }));
    const data = Object.assign(Object.create(GameData.prototype), { playerID: profiles[0].id, characters: new Map(profiles.map(p => [Number(p.id), p])), date: context.date, totalDays: context.totalDays });
    return data.saveCharactersSummaries(summary, profiles.map(p => p.id), { ...context, participantProfiles: profiles, excludedOwnerIds: context.excludedSummaryOwnerIds });
  };
  return { engine, persistCharacterFolders };
}

async function run(electron = null) {
  const args = process.argv.slice(process.argv.findIndex(arg => ["--prepare", "--apply"].includes(arg)));
  const [mode, userDirArg, stageArg, ...idArgs] = args;
  if (!["--prepare", "--apply"].includes(mode) || !userDirArg || !stageArg) throw new Error("usage: --prepare|--apply <VOTC user directory> <isolated stage> <conversation IDs> [--allow-provider]");
  const userDir = path.resolve(userDirArg), stage = path.resolve(stageArg), dataDir = path.join(userDir, "votc_data");
  if (stage === dataDir || stage.startsWith(dataDir + path.sep)) throw new Error("stage_must_be_outside_userdata");
  const ids = idArgs.filter(id => id !== "--allow-provider");
  if (!ids.length || ids.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw new Error("explicit_conversation_ids_required");
  const providerAllowed = idArgs.includes("--allow-provider");
  let provider = null, config = null, settings = null;
  if (providerAllowed && mode === "--prepare") {
    if (!electron?.safeStorage?.isEncryptionAvailable()) throw new Error("use_isolated_electron_for_configured_provider");
    settings = read(path.join(userDir, "votc-llm-config.json"));
    const { SecureProviderSecrets } = require("../resources/app/out/main/secure-provider-secrets");
    const secrets = read(path.join(userDir, "votc-llm-secrets.json"));
    const selectedId = settings.llmSettings.summaryProviderInstanceId || settings.llmSettings.activeProviderInstanceId;
    const selected = [...settings.llmSettings.providers, ...settings.llmSettings.presets].find(p => p.instanceId === selectedId);
    const hydrated = new SecureProviderSecrets({ safeStorage: electron.safeStorage, store: { get: key => secrets[key] } }).hydrateSettings({ providers: selected ? [selected] : [], presets: [] });
    config = hydrated.providers[0];
    if (config?.providerType !== "deepseek") throw new Error("maintenance_provider_not_supported");
    provider = new (require("../resources/app/out/main/providers").DeepseekProvider)();
    provider.validateConfig(config);
  }
  let calls = 0;
  const requestSummary = async messages => {
    if (!provider || mode !== "--prepare") throw new Error("provider_requests_disabled");
    const max = settings.summaryPromptSettings?.finalSummaryMaxTokens || 4096;
    console.log(JSON.stringify({ stage: "provider_request", call: ++calls, maxTokens: max }));
    const result = await provider.chatCompletion({ model: config.defaultModel, messages, ...config.defaultParameters, max_tokens: max, stream: false, thinking: { type: "disabled" }, response_format: { type: "json_object" }, signal: AbortSignal.timeout(120000) }, config);
    fs.appendFileSync(path.join(stage, "provider-usage.jsonl"), JSON.stringify({ at: new Date().toISOString(), requestType: "memory_recovery", model: config.defaultModel, usage: result.usage, finishReason: result.finish_reason }) + "\n");
    return result;
  };
  const filename = id => `conversation_${id}.json`;
  if (mode === "--apply") {
    // Preflight every target before any write. An active app changing a snapshot
    // makes this fail closed; the operator must also ensure VOTC has exited.
    for (const id of ids) {
      const prepared = read(path.join(stage, "prepared", filename(id)));
      const source = path.join(dataDir, "memory_recovery", filename(id));
      if (hash(fs.readFileSync(source)) !== prepared.sourceHash) throw new Error(`snapshot_changed:${id}`);
    }
    const backup = path.join(dataDir, `summary_incident_backup_${Date.now()}`);
    fs.mkdirSync(backup);
    for (const name of ["memory", "memory_recovery", "conversation_summaries"]) {
      const source = path.join(dataDir, name);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(backup, name), { recursive: true, errorOnExist: true, force: false });
    }
    console.log(JSON.stringify({ backup }));
    const { engine, persistCharacterFolders } = runtime(dataDir);
    for (const id of ids) {
      const prepared = read(path.join(stage, "prepared", filename(id)));
      const target = path.join(dataDir, "memory_recovery", filename(id));
      write(target, prepared.snapshot);
      const result = await engine.recoverFailedFinalization(target, { requestSummary, buildPrompt: c => engine.buildFinalizationPrompt(c), persistCharacterFolders });
      console.log(JSON.stringify({ id, applied: result.success, error: result.error?.message || null, directedFiles: result.directedSummaries?.size || 0 }));
      if (!result.success) throw new Error(`apply_failed_snapshot_retained:${id}`);
    }
    return;
  }
  fs.mkdirSync(stage, { recursive: true });
  const { engine, persistCharacterFolders } = runtime(path.join(stage, "data"));
  for (const id of ids) {
    const sourceBytes = fs.readFileSync(path.join(dataDir, "memory_recovery", filename(id)));
    const snapshot = JSON.parse(sourceBytes);
    const target = path.join(engine.store.paths.recovery, filename(id));
    write(target, snapshot);
    const result = await engine.recoverFailedFinalization(target, { requestSummary, buildPrompt: c => engine.buildFinalizationPrompt({ ...c, finalInstructions: settings?.summaryPromptSettings?.finalPrompt || "" }), persistCharacterFolders });
    if (result.success && result.extraction) write(path.join(stage, "prepared", filename(id)), { sourceHash: hash(sourceBytes), snapshot: { ...snapshot, providerOutput: result.finalSummary, parsedExtraction: engine.serializeExtraction(result.extraction), finalizationStage: "persist", finalizationStatus: "pending" } });
    console.log(JSON.stringify({ id, prepared: result.success, error: result.error?.message || null, directedFiles: result.directedSummaries?.size || 0 }));
  }
}

if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
  const electron = require("electron");
  const stageArg = process.argv[process.argv.findIndex(arg => arg === "--prepare") + 2];
  if (stageArg) {
    const profile = path.join(path.resolve(stageArg), "helper-profile");
    fs.mkdirSync(profile, { recursive: true });
    const userDirArg = process.argv[process.argv.findIndex(arg => arg === "--prepare") + 1];
    const originalState = read(path.join(path.resolve(userDirArg), "Local State"));
    // Keep the existing encrypted OS key, not plaintext credentials, so Electron
    // can use the user's configured provider in an isolated helper profile.
    if (originalState.os_crypt) write(path.join(profile, "Local State"), { os_crypt: originalState.os_crypt });
    electron.app.setPath("userData", profile);
  }
  electron.app.whenReady().then(() => run(electron)).then(() => electron.app.exit(0)).catch(error => { console.error(error.message); electron.app.exit(1); });
} else if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
