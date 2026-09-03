"use strict";
const electron = require("electron");
const fs$1 = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const Store = require("electron-store");
const uuid = require("uuid");
const Handlebars = require("handlebars");
const events = require("events");
const memorySystem = require("./memory-system");
const usageAnalyticsRetention = require("./usage-analytics-retention");
const { createChatWindow } = require("./window-manager");
const { SecureProviderSecrets } = require("./secure-provider-secrets");
const { registerProviderImplementations } = require("./providers");
const { ProviderRegistry, TokenCounter, LLMManager } = require("./provider-service");
const { MEMORY_ENGINE_VERSION } = require("./version");
const { registerIpcHandlers } = require("./ipc/register-ipc");
const { WorldlineService } = require("./worldline/worldline-service");
const { createPaths } = require("./config/paths");
const { getHistoricalReferenceByYear } = require("./game-data/legacy-historical-reference");
const { CampaignIdentityResolver } = require("./historical-system/campaign-identity");
const { WorldlineStore } = require("./historical-system/worldline-store");
const { DynamicHistoryService } = require("./historical-system/dynamic-history-service");
const { HistoricalFigureResolver } = require("./historical-system/historical-figure-resolver");
const { buildHistoricalFigureDiagnostics } = require("./historical-system/historical-figure-diagnostics");
const { HistoricalGroundTruthStore } = require("./historical-system/historical-ground-truth-store");
const { createHistoricalDiagnosticsController, registerHistoricalDiagnosticsIpc } = require("./historical-system/historical-diagnostics-ipc");
const { dataset: historicalDataset } = require("./historical-system/historical-baseline");
const { figureMatchingRecords } = require("./historical-system/historical-data/figure-matching");
const { parseGameDateStrict } = require("./historical-system/temporal-knowledge-gate");
const { createRelationshipResolver } = require("./game-data/relationship-resolver");
const { Character, inferGenderFromPronoun } = require("./game-data/character");

const log = require("electron-log");
const electronUpdater = require("electron-updater");
const activeWin = require("active-win");
const TailFile = require("@logdna/tail-file");
const readline$1 = require("node:readline");
const archiver = require("archiver");
const PROVIDER_TYPES = ["player2", "openrouter", "openai-compatible", "ollama", "deepseek", "gemini"];
const DEFAULT_ACTIVE_PROVIDER = "player2";
const DEFAULT_PROVIDER_CONFIGS = {
  openrouter: {
    apiKey: "",
    baseUrl: "",
    defaultModel: "",
    defaultParameters: { temperature: 0.7, max_tokens: 2048 }
  },
  "openai-compatible": {
    apiKey: "",
    baseUrl: "",
    defaultModel: "",
    defaultParameters: { temperature: 0.7, max_tokens: 2048 }
  },
  ollama: {
    apiKey: "",
    baseUrl: "http://localhost:11434",
    // Ollama default base URL
    defaultModel: "",
    defaultParameters: { temperature: 0.7, max_tokens: 2048 }
  },
  player2: {
    apiKey: "dummy-api-key",
    baseUrl: "http://localhost:4315/v1",
    // Player2 default base URL
    defaultModel: "player2-model",
    defaultParameters: { temperature: 0.7, max_tokens: 2048 }
  },
  deepseek: {
    apiKey: "",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    defaultParameters: { temperature: 0.7, max_tokens: 2048 },
    useMinimizedActionsSchema: false,
    actionSchemaDeliveryMode: "optimized_local_validation",
    deepseekActionStateTransitionRecallOverlay: false,
    deepseekActionStablePrefixOptimization: false
  },
  gemini: {
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
    defaultParameters: { temperature: 0.7, max_tokens: 4096 }
  }
};
const {
  VOTC_DATA_DIR,
  VOTC_LOGS_DIR,
  VOTC_SUMMARIES_DIR,
  VOTC_MEMORY_DIR,
  VOTC_MEMORY_RECOVERY_DIR,
  VOTC_DYNAMIC_HISTORY_DIR,
  VOTC_ACTIONS_DIR,
  VOTC_USAGE_ANALYTICS_FILE,
  VOTC_PROMPTS_DIR,
  VOTC_PROMPTS_SYSTEM_DIR,
  VOTC_PROMPTS_CHARACTER_DIR,
  VOTC_PROMPTS_EXAMPLES_DIR,
  VOTC_PROMPTS_HELPERS_DIR,
  DEFAULT_PROMPTS_DIR
} = createPaths(electron.app);
const memoryEngine = new memorySystem.MemoryEngine({ baseDir: VOTC_MEMORY_DIR, summaryFoldersDir: VOTC_SUMMARIES_DIR, recoveryDir: VOTC_MEMORY_RECOVERY_DIR });
let historicalFigureResolver = null;
try {
  historicalFigureResolver = new HistoricalFigureResolver({
    figures: historicalDataset.figures,
    matchingRecords: figureMatchingRecords,
    relationshipResolver: createRelationshipResolver({ onDiagnostic: () => false }),
    inferGenderFromPronoun,
    parseGameDateStrict
  });
} catch (error) {
  console.error("[DynamicHistory] Historical figure resolver disabled:", error.message);
}
const dynamicHistoryService = new DynamicHistoryService({
  identityResolver: new CampaignIdentityResolver(),
  worldlineStore: new WorldlineStore({ rootDir: VOTC_DYNAMIC_HISTORY_DIR }),
  historicalFigureResolver
});
const DEFAULT_USERDATA_DIR$1 = DEFAULT_PROMPTS_DIR;
const DEFAULT_MAIN_TEMPLATE_PATH = "system/default.hbs";
const DEFAULT_LETTER_TEMPLATE_PATH = "system/letter.hbs";
const PROMPT_DEFAULTS_MANIFEST_NAME = ".bundled-defaults-manifest.json";
const PROMPT_DEFAULTS_MANIFEST_PATH = path.join(VOTC_PROMPTS_DIR, PROMPT_DEFAULTS_MANIFEST_NAME);
const PROMPT_DEFAULTS_MANIFEST_VERSION = 2;
const LEGACY_CHAT_INSTRUCTION = "[仅以 {{character.fullName}} 的身份撰写下一条回复]";
const DEFAULT_CHAT_INSTRUCTION = "[仅以 {{character.fullName}} 的身份撰写下一条回复；结合性格、关系、好感、地位与当前情绪自然完整表达，不复述提示词或记忆列表]";
const LEGACY_BUNDLED_PROMPT_HASHES = {
  // The same legacy template shipped with CRLF in installed Windows builds and
  // LF in source checkouts. Both hashes are safe because only exact matches are
  // migrated; any user edit produces a different hash and is preserved.
  "system/default.hbs": [
    "68f942300135fac99e11d7ddfde52e90a7372fb07f6475dd97709ec44226b2d2",
    "da530c8c3d08482fa1ee683086faaaa4753e956e6b5bbf0f01e599edc8639f9c",
    "9ef5e409071b1474e460bddbf2002e50420c153414bf53ac4255973c789742c6",
    "ec5cee04a10b9a451496a3a1b187372c17c05c94d214eba257e98e0355424983"
  ]
};
const DEBUG_VERBOSE_LLM = /^(?:1|true|yes|on)$/i.test(process.env.DEBUG_VERBOSE_LLM || "");
const hashPromptAsset = (content) => crypto.createHash("sha256").update(content).digest("hex");
const logVerboseLLM = (...args) => {
  if (DEBUG_VERBOSE_LLM) console.log(...args);
};
const { createPromptConfigManager } = require("./prompts/prompt-config-manager");
const PromptConfigManager = createPromptConfigManager({
  fs: fs$1, path, hashPromptAsset,
  promptsDir: VOTC_PROMPTS_DIR,
  promptsSystemDir: VOTC_PROMPTS_SYSTEM_DIR,
  promptsCharacterDir: VOTC_PROMPTS_CHARACTER_DIR,
  promptsExamplesDir: VOTC_PROMPTS_EXAMPLES_DIR,
  promptsHelpersDir: VOTC_PROMPTS_HELPERS_DIR,
  defaultPromptsDir: DEFAULT_USERDATA_DIR$1,
  defaultMainTemplatePath: DEFAULT_MAIN_TEMPLATE_PATH,
  defaultLetterTemplatePath: DEFAULT_LETTER_TEMPLATE_PATH,
  manifestName: PROMPT_DEFAULTS_MANIFEST_NAME,
  manifestPath: PROMPT_DEFAULTS_MANIFEST_PATH,
  manifestVersion: PROMPT_DEFAULTS_MANIFEST_VERSION,
  legacyChatInstruction: LEGACY_CHAT_INSTRUCTION,
  defaultChatInstruction: DEFAULT_CHAT_INSTRUCTION,
  legacyBundledPromptHashes: LEGACY_BUNDLED_PROMPT_HASHES
});
const promptConfigManager = new PromptConfigManager();
const baseProviderConfigSchema = {
  type: "object",
  properties: {
    instanceId: { type: "string" },
    providerType: { type: "string" },
    customName: { type: "string" },
    apiKey: { type: "string" },
    baseUrl: { type: "string" },
    defaultModel: { type: "string" },
    defaultParameters: { type: "object" },
    customContextLength: { type: "number" },
    useMinimizedActionsSchema: { type: "boolean" },
    actionSchemaDeliveryMode: { type: "string", enum: ["official_full_injected", "optimized_local_validation"] },
    deepseekActionStateTransitionRecallOverlay: { type: "boolean" },
    deepseekActionStablePrefixOptimization: { type: "boolean" }
  },
  required: ["instanceId", "providerType"]
};
const schema = {
  llmSettings: {
    type: "object",
    default: {
      providers: [],
      // Will be initialized with 3 base configs
      presets: [],
      activeProviderInstanceId: null
    },
    properties: {
      providers: {
        // Stores the 3 base configurations
        type: "array",
        default: [],
        items: baseProviderConfigSchema
      },
      presets: {
        // Stores user-created presets
        type: "array",
        default: [],
        items: baseProviderConfigSchema
      },
      activeProviderInstanceId: {
        type: ["string", "null"],
        default: null
      },
      actionsProviderInstanceId: {
        type: ["string", "null"],
        default: null
      },
      summaryProviderInstanceId: {
        type: ["string", "null"],
        default: null
      }
    }
  },
  ck3UserFolderPath: {
    type: ["string", "null"],
    default: null
  },
  modLocationPath: {
    type: ["string", "null"],
    default: null
  },
  globalStreamEnabled: {
    type: "boolean",
    default: true
  },
  pauseOnRegeneration: {
    type: "boolean",
    default: true
  },
  generateFollowingMessages: {
    type: "boolean",
    default: true
  },
  messageFontSize: {
    type: "number",
    default: 1.1
  },
  showSettingsOnStartup: {
    type: "boolean",
    default: true
  },
  language: {
    type: "string",
    default: "en"
  },
  promptSettings: {
    type: "object",
    default: {},
    properties: {
      mainTemplate: { type: "string", default: "" },
      defaultMainTemplatePath: { type: "string", default: "system/default.hbs" },
      blocks: { type: "array", default: [] },
      suffix: {
        type: "object",
        default: { enabled: false, template: "", label: "Suffix" },
        properties: {
          enabled: { type: "boolean", default: false },
          template: { type: "string", default: "" },
          label: { type: "string", default: "Suffix" }
        }
      }
    }
  },
  letterPromptSettings: {
    type: "object",
    default: {},
    properties: {
      mainTemplate: { type: "string", default: "" },
      defaultMainTemplatePath: { type: "string", default: "system/letter.hbs" },
      blocks: { type: "array", default: [] },
      suffix: {
        type: "object",
        default: { enabled: false, template: "", label: "Suffix" },
        properties: {
          enabled: { type: "boolean", default: false },
          template: { type: "string", default: "" },
          label: { type: "string", default: "Suffix" }
        }
      }
    }
  },
  actionSettings: {
    type: "object",
    default: { disabledActions: [], validation: {} },
    properties: {
      disabledActions: {
        type: "array",
        default: [],
        items: { type: "string" }
      },
      validation: {
        type: "object",
        default: {}
      }
    }
  },
  actionApprovalSettings: {
    type: "object",
    default: { approvalMode: "none", pauseOnApproval: true },
    properties: {
      approvalMode: {
        type: "string",
        enum: ["none", "non-destructive", "all"],
        default: "none"
      },
      pauseOnApproval: {
        type: "boolean",
        default: true
      }
    }
  },
  summaryPromptSettings: {
    type: "object",
    default: { rollingPrompt: "", finalPrompt: "", letterSummaryPrompt: "", finalSummaryMaxTokens: 4096 },
    properties: {
      rollingPrompt: { type: "string", default: "" },
      finalPrompt: { type: "string", default: "" },
      letterSummaryPrompt: { type: "string", default: "" },
      finalSummaryMaxTokens: { type: "number", minimum: 256, maximum: 16384, default: 4096 }
    }
  },
  allowPrerelease: {
    type: "boolean",
    default: false
  }
};
const { createSettingsRepository } = require("./config/settings-repository");
const SettingsRepository = createSettingsRepository({
  Store, schema, SecureProviderSecrets, electron,
  providerTypes: PROVIDER_TYPES,
  defaultProviderConfigs: DEFAULT_PROVIDER_CONFIGS,
  defaultActiveProvider: DEFAULT_ACTIVE_PROVIDER,
  promptConfigManager, logVerboseLLM, hashPromptAsset, path, fs: fs$1,
  promptsDir: VOTC_PROMPTS_DIR,
  defaultPromptsDir: DEFAULT_USERDATA_DIR$1,
  defaultMainTemplatePath: DEFAULT_MAIN_TEMPLATE_PATH,
  legacyBundledPromptHashes: LEGACY_BUNDLED_PROMPT_HASHES
});
const settingsRepository = new SettingsRepository();
const worldlineService = new WorldlineService({
  settingsRepository,
  dataDir: VOTC_DATA_DIR,
  dialog: electron.dialog
});
const providerRegistry = ProviderRegistry.getInstance();
function createPromptFingerprint(value) {
  if (value === null || value === void 0) return null;
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}
/**
 * Persists API usage metadata without storing prompts, replies, or credentials.
 * DeepSeek reports cache fields in usage; other providers simply remain "unknown".
 */
const { createUsageAnalytics } = require("./analytics/usage-analytics");
const UsageAnalytics = createUsageAnalytics({
  fs: fs$1,
  dataDir: VOTC_DATA_DIR,
  analyticsFile: VOTC_USAGE_ANALYTICS_FILE,
  retention: usageAnalyticsRetention,
  createPromptFingerprint
});
const usageAnalytics = new UsageAnalytics();
const { createGameData } = require("./game-data/game-data");
const GameData = createGameData({
  fs: fs$1,
  path,
  memorySystem,
  memoryEngine,
  summariesDir: VOTC_SUMMARIES_DIR,
  getHistoricalReferenceByYear
});
const fs = require("fs");
const { createLogParser } = require("./game-data/log-parser");
const parseLog = createLogParser({ GameData, Character, onGameDataParsed: (gameData) => dynamicHistoryService.updateFromGameData(gameData) });
const historicalGroundTruthStore = new HistoricalGroundTruthStore({ rootDir: VOTC_DATA_DIR });
const historicalDiagnosticsController = createHistoricalDiagnosticsController({
  settingsRepository,
  parseLog,
  buildDiagnostics: buildHistoricalFigureDiagnostics,
  figures: historicalDataset.figures,
  matchingRecords: figureMatchingRecords,
  groundTruthStore: historicalGroundTruthStore
});
function createMessage(input) {
  return {
    ...input,
    type: "message",
    datetime: /* @__PURE__ */ new Date()
  };
}
function createError(input) {
  return {
    ...input,
    type: "error",
    datetime: /* @__PURE__ */ new Date()
  };
}
function createActionFeedback(input) {
  return {
    ...input,
    type: "action-feedback",
    datetime: /* @__PURE__ */ new Date()
  };
}
function createActionApproval(params) {
  return {
    type: "action-approval",
    id: params.id,
    associatedMessageId: params.associatedMessageId,
    action: params.action,
    status: "pending",
    previewFeedback: params.previewFeedback,
    previewSentiment: params.previewSentiment,
    datetime: /* @__PURE__ */ new Date()
  };
}
const { PromptScriptSandbox } = require("./prompts/prompt-script-sandbox");
const { createTemplateEngine } = require("./prompts/template-engine");
const TemplateEngine = createTemplateEngine({
  Handlebars,
  fs: fs$1,
  path,
  promptsHelpersDir: VOTC_PROMPTS_HELPERS_DIR,
  defaultPromptsDir: DEFAULT_USERDATA_DIR$1,
  PromptScriptSandbox
});
const { PromptScriptLoader } = require("./prompts/prompt-script-loader");
const { createPromptBuilder } = require("./prompts/prompt-builder");
const PromptBuilder = createPromptBuilder({
  TemplateEngine,
  PromptScriptLoader,
  promptConfigManager,
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint,
  defaultChatInstruction: DEFAULT_CHAT_INSTRUCTION
});
const llmManager = new LLMManager({
  settingsRepository,
  providerRegistry,
  usageAnalytics,
  TokenCounter,
  PromptBuilder,
  debugVerboseLLM: DEBUG_VERBOSE_LLM,
  logVerboseLLM
});
const { ActionRegistry, ActionPromptBuilder, ActionSandbox, createActionEffectWriter, createActionEngine, CriticalActionRecallObserver, schema: actionSchema, responseHealing, resolveI18nString } = require("./actions");
const ActionRegistryClass = ActionRegistry.configure({
  actionsDir: VOTC_ACTIONS_DIR,
  dataDir: VOTC_DATA_DIR,
  defaultUserdataDir: path.join(electron.app.getAppPath(), "default_userdata", "actions")
});
const actionRegistry = ActionRegistryClass.getInstance();
const { buildStructuredResponseJsonSchema, buildStructuredResponseSchema } = actionSchema;
const { createRunFileManager } = require("./actions/run-file-manager");
const { scanRunAcksForPendingCommands } = require("./actions/run-command-recovery");
const RunFileManager = createRunFileManager({ settingsRepository, path, fs: fs$1, dataDir: VOTC_DATA_DIR });
const runFileManager = new RunFileManager();
const ActionEffectWriter = createActionEffectWriter({ runFileManager });
const ActionEngine = createActionEngine({
  actionRegistry,
  settingsRepository,
  usageAnalytics,
  llmManager,
  ActionPromptBuilder,
  ActionSandbox,
  ActionEffectWriter,
  CriticalActionRecallObserver,
  buildStructuredResponseJsonSchema,
  buildStructuredResponseSchema,
  healJsonResponseWithLogging: responseHealing.healJsonResponseWithLogging,
  resolveI18nString,
  logVerboseLLM
});
const { Conversation } = require("./conversation/conversation");
Conversation.configure({
  ActionEngine,
  settingsRepository,
  usageAnalytics,
  llmManager,
  runFileManager,
  parseLog,
  createError,
  createMessage,
  createActionApproval,
  createActionFeedback,
  createPromptFingerprint,
  PromptBuilder,
  TokenCounter,
  logVerboseLLM,
  events,
  uuid,
  path,
  memoryEngine,
  worldlineService
});
const { createConversationManager } = require("./conversation/conversation-manager");
const ConversationManager = createConversationManager({ events, memorySystem, Conversation, PromptBuilder, createActionFeedback, logVerboseLLM, runFileManager });
const conversationManager = ConversationManager.getInstance();
let quitAfterFinalizations = false;
let quitDrainStarted = false;
class ClipboardListener extends events.EventEmitter {
  constructor() {
    super();
    let clipboardText = electron.clipboard.readText();
    if (clipboardText.startsWith("VOTC:")) {
      electron.clipboard.writeText("");
      this.previousClipboard = "";
    } else {
      this.previousClipboard = clipboardText;
    }
    this.isListening = false;
  }
  start() {
    if (this.isListening) {
      throw new Error("ClipboardListener is already listening!");
    }
    this.interval = setInterval(this.readClipboard.bind(this), 100);
    this.isListening = true;
  }
  stop() {
    if (!this.isListening) {
      throw new Error("ClipboardListener is not currently listening!");
    }
    clearInterval(this.interval);
    this.isListening = false;
  }
  readClipboard() {
    let currentClipboard = electron.clipboard.readText();
    if (this.previousClipboard == currentClipboard) return;
    if (currentClipboard.startsWith("VOTC:")) {
      let command = currentClipboard.split(":")[1];
      switch (command) {
        case "IN":
          this.emit("VOTC:IN");
          break;
        case "EFFECT_ACCEPTED":
          this.emit("VOTC:EFFECT_ACCEPTED");
          break;
        case "LETTER":
          this.emit("VOTC:LETTER");
          break;
        case "LETTER_ACCEPTED":
          this.emit("VOTC:LETTER_ACCEPTED");
          break;
      }
      electron.clipboard.writeText(this.previousClipboard);
    } else {
      this.previousClipboard = electron.clipboard.readText();
    }
  }
}
function initLogger() {
  log.initialize();
  log.transports.file.resolvePathFn = () => path.join(VOTC_LOGS_DIR, "votc_app.log");
  console.log = log.log;
  console.error = log.error;
  console.warn = log.warn;
  console.info = log.info;
}
function clearLog() {
  try {
    fs$1.mkdirSync(path.dirname(VOTC_LOGS_DIR), { recursive: true });
    fs$1.writeFileSync(path.join(VOTC_LOGS_DIR, "votc_app.log"), "");
  } catch (error) {
    console.error("Failed to clear log file:", error);
  }
}
const { createSummariesManager } = require("./summaries/summaries-manager");
const SummariesManager = createSummariesManager({ fs: fs$1, path, summariesDir: VOTC_SUMMARIES_DIR, memoryEngine, memorySystem });
const updaterTranslations = {
  en: {
    updateAvailable: {
      title: "Update Available",
      message: "A new version ({version}) is available!",
      detail: "Release notes:\n{releaseNotes}\n\nWould you like to download the update now?",
      download: "Download Update",
      viewChangelog: "View Changelog",
      later: "Later"
    },
    updateAvailablePrerelease: {
      title: "Pre-release Update Available",
      message: "A new pre-release version ({version}) is available!",
      detail: "This is a pre-release version and may be less stable.\n\nRelease notes:\n{releaseNotes}\n\nWould you like to download the update now?",
      download: "Download Pre-release",
      viewChangelog: "View Changelog",
      later: "Later"
    },
    updateDownloaded: {
      title: "Update Ready",
      message: "The update has been downloaded and is ready to install.",
      detail: "Would you like to install the update now? The application will restart.",
      installNow: "Install Now",
      installOnExit: "Install on Exit"
    },
    checkingForUpdate: "Checking for update...",
    updateNotAvailable: "You are running the latest version.",
    downloadProgress: "Downloading {percent}%"
  },
  de: {
    updateAvailable: {
      title: "Update verfügbar",
      message: "Eine neue Version ({version}) ist verfügbar!",
      detail: "Versionshinweise:\n{releaseNotes}\n\nMöchten Sie das Update jetzt herunterladen?",
      download: "Update herunterladen",
      viewChangelog: "Änderungsprotokoll anzeigen",
      later: "Später"
    },
    updateAvailablePrerelease: {
      title: "Vorabversion verfügbar",
      message: "Eine neue Vorabversion ({version}) ist verfügbar!",
      detail: "Dies ist eine Vorabversion und möglicherweise weniger stabil.\n\nVersionshinweise:\n{releaseNotes}\n\nMöchten Sie das Update jetzt herunterladen?",
      download: "Vorabversion herunterladen",
      viewChangelog: "Änderungsprotokoll anzeigen",
      later: "Später"
    },
    updateDownloaded: {
      title: "Update bereit",
      message: "Das Update wurde heruntergeladen und ist bereit zur Installation.",
      detail: "Möchten Sie das Update jetzt installieren? Die Anwendung wird neu gestartet.",
      installNow: "Jetzt installieren",
      installOnExit: "Beim Beenden installieren"
    },
    checkingForUpdate: "Suche nach Updates...",
    updateNotAvailable: "Sie verwenden die aktuelle Version.",
    downloadProgress: "Herunterladen {percent}%"
  },
  es: {
    updateAvailable: {
      title: "Actualización disponible",
      message: "¡Una nueva versión ({version}) está disponible!",
      detail: "Notas de la versión:\n{releaseNotes}\n\n¿Desea descargar la actualización ahora?",
      download: "Descargar actualización",
      viewChangelog: "Ver registro de cambios",
      later: "Más tarde"
    },
    updateAvailablePrerelease: {
      title: "Actualización preliminar disponible",
      message: "¡Una nueva versión preliminar ({version}) está disponible!",
      detail: "Esta es una versión preliminar y puede ser menos estable.\n\nNotas de la versión:\n{releaseNotes}\n\n¿Desea descargar la actualización ahora?",
      download: "Descargar preliminar",
      viewChangelog: "Ver registro de cambios",
      later: "Más tarde"
    },
    updateDownloaded: {
      title: "Actualización lista",
      message: "La actualización se ha descargado y está lista para instalar.",
      detail: "¿Desea instalar la actualización ahora? La aplicación se reiniciará.",
      installNow: "Instalar ahora",
      installOnExit: "Instalar al salir"
    },
    checkingForUpdate: "Buscando actualizaciones...",
    updateNotAvailable: "Está utilizando la última versión.",
    downloadProgress: "Descargando {percent}%"
  },
  fr: {
    updateAvailable: {
      title: "Mise à jour disponible",
      message: "Une nouvelle version ({version}) est disponible !",
      detail: "Notes de version :\n{releaseNotes}\n\nVoulez-vous télécharger la mise à jour maintenant ?",
      download: "Télécharger la mise à jour",
      viewChangelog: "Voir le journal des modifications",
      later: "Plus tard"
    },
    updateAvailablePrerelease: {
      title: "Mise à jour préliminaire disponible",
      message: "Une nouvelle version préliminaire ({version}) est disponible !",
      detail: "Il s'agit d'une version préliminaire et elle peut être moins stable.\n\nNotes de version :\n{releaseNotes}\n\nVoulez-vous télécharger la mise à jour maintenant ?",
      download: "Télécharger la préliminaire",
      viewChangelog: "Voir le journal des modifications",
      later: "Plus tard"
    },
    updateDownloaded: {
      title: "Mise à jour prête",
      message: "La mise à jour a été téléchargée et est prête à être installée.",
      detail: "Voulez-vous installer la mise à jour maintenant ? L'application va redémarrer.",
      installNow: "Installer maintenant",
      installOnExit: "Installer à la fermeture"
    },
    checkingForUpdate: "Recherche de mises à jour...",
    updateNotAvailable: "Vous utilisez la dernière version.",
    downloadProgress: "Téléchargement {percent}%"
  },
  ja: {
    updateAvailable: {
      title: "アップデート利用可能",
      message: "新しいバージョン ({version}) が利用可能です！",
      detail: "リリースノート:\n{releaseNotes}\n\n今すぐアップデートをダウンロードしますか？",
      download: "アップデートをダウンロード",
      viewChangelog: "変更履歴を見る",
      later: "後で"
    },
    updateAvailablePrerelease: {
      title: "プレリリースアップデート利用可能",
      message: "新しいプレリリース版 ({version}) が利用可能です！",
      detail: "これはプレリリース版であり、安定性が低い可能性があります。\n\nリリースノート:\n{releaseNotes}\n\n今すぐアップデートをダウンロードしますか？",
      download: "プレリリースをダウンロード",
      viewChangelog: "変更履歴を見る",
      later: "後で"
    },
    updateDownloaded: {
      title: "アップデート準備完了",
      message: "アップデートがダウンロードされ、インストールの準備ができました。",
      detail: "今すぐアップデートをインストールしますか？アプリケーションが再起動します。",
      installNow: "今すぐインストール",
      installOnExit: "終了時にインストール"
    },
    checkingForUpdate: "アップデートを確認中...",
    updateNotAvailable: "最新バージョンを使用しています。",
    downloadProgress: "ダウンロード中 {percent}%"
  },
  ko: {
    updateAvailable: {
      title: "업데이트 사용 가능",
      message: "새 버전 ({version})을 사용할 수 있습니다!",
      detail: "릴리스 정보:\n{releaseNotes}\n\n지금 업데이트를 다운로드하시겠습니까?",
      download: "업데이트 다운로드",
      viewChangelog: "변경 로그 보기",
      later: "나중에"
    },
    updateAvailablePrerelease: {
      title: "시험판 업데이트 사용 가능",
      message: "새 시험판 버전 ({version})을 사용할 수 있습니다!",
      detail: "이것은 시험판 버전이며 안정성이 떨어질 수 있습니다.\n\n릴리스 정보:\n{releaseNotes}\n\n지금 업데이트를 다운로드하시겠습니까?",
      download: "시험판 다운로드",
      viewChangelog: "변경 로그 보기",
      later: "나중에"
    },
    updateDownloaded: {
      title: "업데이트 준비 완료",
      message: "업데이트가 다운로드되었으며 설치할 준비가 되었습니다.",
      detail: "지금 업데이트를 설치하시겠습니까? 애플리케이션이 다시 시작됩니다.",
      installNow: "지금 설치",
      installOnExit: "종료 시 설치"
    },
    checkingForUpdate: "업데이트 확인 중...",
    updateNotAvailable: "최신 버전을 사용하고 있습니다.",
    downloadProgress: "다운로드 중 {percent}%"
  },
  pl: {
    updateAvailable: {
      title: "Dostępna aktualizacja",
      message: "Nowa wersja ({version}) jest dostępna!",
      detail: "Informacje o wersji:\n{releaseNotes}\n\nCzy chcesz pobrać aktualizację teraz?",
      download: "Pobierz aktualizację",
      viewChangelog: "Zobacz dziennik zmian",
      later: "Później"
    },
    updateAvailablePrerelease: {
      title: "Dostępna aktualizacja wstępna",
      message: "Nowa wersja wstępna ({version}) jest dostępna!",
      detail: "To jest wersja wstępna i może być mniej stabilna.\n\nInformacje o wersji:\n{releaseNotes}\n\nCzy chcesz pobrać aktualizację teraz?",
      download: "Pobierz wersję wstępną",
      viewChangelog: "Zobacz dziennik zmian",
      later: "Później"
    },
    updateDownloaded: {
      title: "Aktualizacja gotowa",
      message: "Aktualizacja została pobrana i jest gotowa do instalacji.",
      detail: "Czy chcesz zainstalować aktualizację teraz? Aplikacja zostanie uruchomiona ponownie.",
      installNow: "Zainstaluj teraz",
      installOnExit: "Zainstaluj przy wyjściu"
    },
    checkingForUpdate: "Sprawdzanie aktualizacji...",
    updateNotAvailable: "Korzystasz z najnowszej wersji.",
    downloadProgress: "Pobieranie {percent}%"
  },
  ru: {
    updateAvailable: {
      title: "Доступно обновление",
      message: "Доступна новая версия ({version})!",
      detail: "Примечания к выпуску:\n{releaseNotes}\n\nХотите скачать обновление сейчас?",
      download: "Скачать обновление",
      viewChangelog: "Открыть список изменений",
      later: "Позже"
    },
    updateAvailablePrerelease: {
      title: "Доступна предварительная версия",
      message: "Доступна новая предварительная версия ({version})!",
      detail: "Это предварительная версия, она может быть менее стабильной.\n\nПримечания к выпуску:\n{releaseNotes}\n\nХотите скачать обновление сейчас?",
      download: "Скачать предварительную версию",
      viewChangelog: "Открыть список изменений",
      later: "Позже"
    },
    updateDownloaded: {
      title: "Обновление готово",
      message: "Обновление загружено и готово к установке.",
      detail: "Хотите установить обновление сейчас? Приложение будет перезапущено.",
      installNow: "Установить сейчас",
      installOnExit: "Установить при выходе"
    },
    checkingForUpdate: "Проверка обновлений...",
    updateNotAvailable: "Вы используете последнюю версию.",
    downloadProgress: "Загрузка {percent}%"
  },
  zh: {
    updateAvailable: {
      title: "有可用更新",
      message: "新版本 ({version}) 已可用！",
      detail: "更新说明：\n{releaseNotes}\n\n您想现在下载更新吗？",
      download: "下载更新",
      viewChangelog: "查看更新日志",
      later: "稍后"
    },
    updateAvailablePrerelease: {
      title: "有可用预发布更新",
      message: "新预发布版本 ({version}) 已可用！",
      detail: "这是一个预发布版本，可能不太稳定。\n\n更新说明：\n{releaseNotes}\n\n您想现在下载更新吗？",
      download: "下载预发布版",
      viewChangelog: "查看更新日志",
      later: "稍后"
    },
    updateDownloaded: {
      title: "更新准备就绪",
      message: "更新已下载并准备安装。",
      detail: "您想现在安装更新吗？应用程序将重新启动。",
      installNow: "立即安装",
      installOnExit: "退出时安装"
    },
    checkingForUpdate: "正在检查更新...",
    updateNotAvailable: "您正在使用最新版本。",
    downloadProgress: "下载中 {percent}%"
  }
};
const { createAppUpdater, VOTC_FORK_IDENTITY } = require("./app/app-updater");
const AppUpdater = createAppUpdater({ electronUpdater, log, settingsRepository, electron, updaterTranslations });
const appUpdater = new AppUpdater();
const { createFocusMonitor } = require("./app/focus-monitor");
const FocusMonitor = createFocusMonitor({ events, activeWin, electron });
const focusMonitor = new FocusMonitor();
const appIcon = path.join(__dirname, "./chunks/icon-BljXrxwL.ico");
registerProviderImplementations(providerRegistry);
const { createLetterPromptBuilder } = require("./prompts/letter-prompt-builder");
const LetterPromptBuilder = createLetterPromptBuilder({ TemplateEngine, PromptScriptLoader, settingsRepository, memoryEngine, memorySystem, PromptBuilder, TokenCounter, promptConfigManager, logVerboseLLM });
const letterPromptBuilder = new LetterPromptBuilder();
const { createLetterEffectTransport } = require("./letters/letter-effect-transport");
const { LetterEffectTransport } = createLetterEffectTransport({ settingsRepository, fs: fs$1, path, runFileManager, dataDir: VOTC_DATA_DIR });
const letterEffectTransport = new LetterEffectTransport();
const { createLetterManager } = require("./letters/letter-manager");
const { LetterManager, LetterResponseStatus, LetterSummaryStatus } = createLetterManager({
  settingsRepository, fs: fs$1, path, TailFile, readline: readline$1, parseLog,
  letterPromptBuilder, llmManager, PromptBuilder, TokenCounter, memoryEngine, dataDir: VOTC_DATA_DIR, letterEffectTransport, runFileManager, scanRunAcksForPendingCommands, autoStartLogTailing: false
});
const letterManager = new LetterManager();
const initializeRunCommandQueue = async () => {
  const reconciledById = /* @__PURE__ */ new Map();
  const reconcileRecentAcks = () => {
    const debugLogPath = settingsRepository.getCK3DebugLogPath();
    const reconciled = runFileManager.reconcileAcknowledgedCommands(scanRunAcksForPendingCommands(debugLogPath, { fs: fs$1, pendingCommands: runFileManager.getPendingCommands() }));
    for (const command of reconciled) reconciledById.set(command.commandId, command);
  };
  reconcileRecentAcks();
  await letterManager.startLogTailing();
  reconcileRecentAcks();
  runFileManager.initializeAfterAckReconciliation();
  letterManager.handleReconciledRunCommands(Array.from(reconciledById.values()), "startup");
  letterManager.startRunCommandWatchdog();
};
initLogger();
let chatWindow = null;
let tray = null;
if (require("electron-squirrel-startup")) {
  electron.app.quit();
}
electron.Menu.setApplicationMenu(null);
const exportPromptsZip = (destination, settings, presets) => {
  return new Promise((resolve, reject) => {
    try {
      const output = fs$1.createWriteStream(destination);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", () => resolve());
      output.on("error", reject);
      archive.on("error", reject);
      archive.pipe(output);
      archive.directory(VOTC_PROMPTS_DIR, "prompts");
      archive.append(JSON.stringify(settings, null, 2), { name: "prompt-settings.json" });
      archive.append(JSON.stringify(presets, null, 2), { name: "prompt-presets.json" });
      archive.finalize();
    } catch (error) {
      reject(error);
    }
  });
};
const createWindow = () => {
  return createChatWindow({
    electron,
    preloadPath: path.join(__dirname, "../preload/preload.js"),
    rendererPath: path.join(__dirname, "../renderer/index.html"),
    rendererUrl: !electron.app.isPackaged ? process.env["ELECTRON_RENDERER_URL"] || null : null
  });
};
const setupIpcHandlers = () => {
  registerIpcHandlers({
    electron,
    settingsRepository,
    promptConfigManager,
    uuid,
    VOTC_PROMPTS_DIR,
    TemplateEngine,
    exportPromptsZip,
    letterManager,
    runFileManager,
    llmManager,
    providerRegistry,
    usageAnalytics,
    actionRegistry,
    VOTC_ACTIONS_DIR,
    resolveI18nString,
    conversationManager,
    ActionEngine,
    VOTC_SUMMARIES_DIR,
    SummariesManager,
    memoryEngine,
    worldlineService,
    get chatWindow() {
      return chatWindow;
    }
  });
  registerHistoricalDiagnosticsIpc({ electron, controller: historicalDiagnosticsController });
};
const setupFocusMonitoring = (window) => {
  focusMonitor.on("overlay-state-changed", (isOverlay) => {
    if (!window || window.isDestroyed()) return;
    window.webContents.send("overlay-visibility-change", isOverlay);
    if (isOverlay) {
      window.setAlwaysOnTop(true, "screen-saver");
    } else {
      window.setIgnoreMouseEvents(true, { forward: true });
    }
  });
  window.on("focus", () => {
    window.setAlwaysOnTop(true, "screen-saver");
  });
  focusMonitor.start();
};
electron.app.on("ready", async () => {
  console.log(electron.app.getPath("userData"));
  clearLog();
  settingsRepository.migrateProviderSecrets();
  promptConfigManager.seedDefaults();
  try {
    await initializeRunCommandQueue();
  } catch (error) {
    console.error("Run Command Queue startup recovery failed; dispatch remains disabled:", error);
  }
  setupIpcHandlers();
  worldlineService.start().catch((error) => console.error("[Worldline] Startup failed:", error));
  chatWindow = createWindow();
  appUpdater.setMainWindow(chatWindow);
  if (electron.app.isPackaged && VOTC_FORK_IDENTITY.autoUpdateEnabled) {
    appUpdater.checkForUpdates();
  }
  actionRegistry.setSettings(settingsRepository.getActionSettings());
  actionRegistry.reloadActions().catch((err) => console.error("Failed to reload actions on startup:", err));
  setupFocusMonitoring(chatWindow);
  console.log("Current __dirname:", __dirname);
  console.log("Process resources:", process.resourcesPath);
  console.log("App path:", electron.app.getAppPath());
  try {
    tray = new electron.Tray(appIcon);
    console.log("Tray created successfully");
  } catch (error) {
    console.error("Error creating tray:", error);
    return;
  }
  const contextMenu = electron.Menu.buildFromTemplate([
    {
      label: "Open Settings",
      click: () => {
        if (chatWindow && !chatWindow.isDestroyed()) {
          chatWindow.show();
          chatWindow.focus();
          chatWindow.webContents.send("toggle-settings");
        }
      }
    },
    {
      label: "Quit",
      click: () => {
        electron.app.quit();
      }
    }
  ]);
  tray.setToolTip("VOTC Overlay");
  tray.setContextMenu(contextMenu);
  const clipboardListener = new ClipboardListener();
  clipboardListener.start();
  clipboardListener.on("VOTC:IN", () => {
    console.log("VOTC:IN triggered - showing chat interface");
    if (!chatWindow || chatWindow.isDestroyed()) {
      console.log("Creating new chat window");
      chatWindow = createWindow();
    }
    conversationManager.createConversation();
    chatWindow.show();
    chatWindow.focus();
    chatWindow.webContents.send("chat-reset");
  });
  clipboardListener.on("VOTC:EFFECT_ACCEPTED", () => {
    console.log("VOTC:EFFECT_ACCEPTED detected - waiting for command-specific CK3 debug ACK");
  });
  clipboardListener.on("VOTC:LETTER", async () => {
    console.log("VOTC:LETTER detected - generating reply");
    try {
      await letterManager.processLatestLetter();
    } catch (error) {
      console.error("Failed to process letter:", error);
    }
  });
  clipboardListener.on("VOTC:LETTER_ACCEPTED", async () => {
    console.log("VOTC:LETTER_ACCEPTED detected - clearing letters.txt");
    try {
      await letterManager.clearLettersFile();
    } catch (error) {
      console.error("Failed to clear letters file:", error);
    }
  });
  electron.ipcMain.on("chat-hide", () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send("chat-hide");
    }
  });
  const ret = electron.globalShortcut.register("Control+H", () => {
    if (chatWindow && !chatWindow.isDestroyed() && conversationManager.hasActiveConversation()) {
      console.log("Ctrl+H pressed - toggling minimize");
      chatWindow.show();
      chatWindow.focus();
      chatWindow.webContents.send("toggle-minimize");
    }
  });
  if (!ret) {
    console.log("Failed to register Ctrl+H global shortcut");
  }
  const reta = electron.globalShortcut.register("Control+Shift+H", () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      console.log("Ctrl+Shift+H pressed - toggling settings");
      chatWindow.show();
      chatWindow.focus();
      chatWindow.webContents.send("toggle-settings");
    }
  });
  if (!reta) {
    console.log("Failed to register Ctrl+Shift+H global shortcut");
  }
  console.log("Ctrl+H shortcut registered:", electron.globalShortcut.isRegistered("Control+H"));
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("before-quit", (event) => {
  if (!quitAfterFinalizations && (conversationManager.getCurrentConversation() || conversationManager.hasPendingFinalizations())) {
    event.preventDefault();
    if (!quitDrainStarted) {
      quitDrainStarted = true;
      conversationManager.endCurrentConversation();
      conversationManager.flushFinalizations({ timeoutMs: 15000 }).then((result) => {
        if (result?.timedOut) console.warn(`[Finalization] Quit drain timed out with ${result.pendingCount} task(s); recovery snapshots will resume next launch.`);
      }).finally(() => {
        quitAfterFinalizations = true;
        electron.app.quit();
      });
    }
    return;
  }
  tray?.destroy();
  letterManager.stopLogTailing();
  worldlineService.dispose();
  focusMonitor.stop();
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
