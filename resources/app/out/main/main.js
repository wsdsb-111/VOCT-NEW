"use strict";
const electron = require("electron");
const fs$1 = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const Store = require("electron-store");
const uuid = require("uuid");
const Handlebars = require("handlebars");
const events = require("events");
const actionSystem = require("./action-system");
const memorySystem = require("./memory-system");
const scriptSandbox = require("./script-sandbox");
const usageAnalyticsRetention = require("./usage-analytics-retention");
const { createChatWindow } = require("./window-manager");
const { SecureProviderSecrets } = require("./secure-provider-secrets");
const { registerProviderImplementations } = require("./providers");
const { ProviderRegistry, TokenCounter, LLMManager } = require("./provider-service");
const { registerIpcHandlers } = require("./ipc/register-ipc");

const zod = require("zod");
const log = require("electron-log");
const electronUpdater = require("electron-updater");
const activeWin = require("active-win");
const TailFile = require("@logdna/tail-file");
const readline$1 = require("node:readline");
const archiver = require("archiver");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs$1);
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
    defaultParameters: { temperature: 0.7, max_tokens: 2048 }
  },
  gemini: {
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
    defaultParameters: { temperature: 0.7, max_tokens: 4096 }
  }
};
const VOTC_DATA_DIR = path.join(electron.app.getPath("userData"), "votc_data");
const VOTC_LOGS_DIR = path.join(VOTC_DATA_DIR, "logs");
const VOTC_SUMMARIES_DIR = path.join(VOTC_DATA_DIR, "conversation_summaries");
const VOTC_MEMORY_DIR = path.join(VOTC_DATA_DIR, "memory");
const VOTC_MEMORY_RECOVERY_DIR = path.join(VOTC_DATA_DIR, "memory_recovery");
const VOTC_ACTIONS_DIR = path.join(VOTC_DATA_DIR, "actions");
const VOTC_USAGE_ANALYTICS_FILE = path.join(VOTC_DATA_DIR, "usage-analytics.json");
const VOTC_PROMPTS_DIR = path.join(VOTC_DATA_DIR, "prompts");
const VOTC_PROMPTS_SYSTEM_DIR = path.join(VOTC_PROMPTS_DIR, "system");
const VOTC_PROMPTS_CHARACTER_DIR = path.join(VOTC_PROMPTS_DIR, "character_description");
const VOTC_PROMPTS_EXAMPLES_DIR = path.join(VOTC_PROMPTS_DIR, "example_messages");
const VOTC_PROMPTS_HELPERS_DIR = path.join(VOTC_PROMPTS_DIR, "helpers");
const memoryEngine = new memorySystem.MemoryEngine({ baseDir: VOTC_MEMORY_DIR, summaryFoldersDir: VOTC_SUMMARIES_DIR, recoveryDir: VOTC_MEMORY_RECOVERY_DIR });
const DEFAULT_USERDATA_DIR$1 = path.join(electron.app.getAppPath(), "default_userdata", "prompts");
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
class PromptConfigManager {
  ensurePromptDirs() {
    [VOTC_PROMPTS_DIR, VOTC_PROMPTS_SYSTEM_DIR, VOTC_PROMPTS_CHARACTER_DIR, VOTC_PROMPTS_EXAMPLES_DIR, VOTC_PROMPTS_HELPERS_DIR].forEach((dir) => fs$1.mkdirSync(dir, { recursive: true }));
  }
  /**
   * Seed bundled prompt assets without overwriting user customizations.
   * Files are copied when missing, or when their current hash still matches the
   * bundled hash recorded by the previous release. A modified file is treated
   * as a user override and is preserved.
   */
  seedDefaults() {
    this.ensurePromptDirs();
    if (!fs$1.existsSync(DEFAULT_USERDATA_DIR$1)) {
      return;
    }
    let previousManifest = { version: 0, files: {} };
    try {
      if (fs$1.existsSync(PROMPT_DEFAULTS_MANIFEST_PATH)) {
        const parsed = JSON.parse(fs$1.readFileSync(PROMPT_DEFAULTS_MANIFEST_PATH, "utf-8"));
        if (parsed && typeof parsed === "object" && parsed.files && typeof parsed.files === "object") {
          previousManifest = parsed;
        }
      }
    } catch (error) {
      console.warn("[PromptConfig] Could not read bundled-default manifest; preserving existing prompt files:", error);
    }
    const nextManifest = {
      version: PROMPT_DEFAULTS_MANIFEST_VERSION,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      files: {}
    };
    const copyRecursive = (src, dest, relativePath = "") => {
      if (!fs$1.existsSync(src)) return;
      const stat = fs$1.statSync(src);
      if (stat.isDirectory()) {
        fs$1.mkdirSync(dest, { recursive: true });
        for (const entry of fs$1.readdirSync(src)) {
          const childRelativePath = relativePath ? `${relativePath}/${entry}` : entry;
          copyRecursive(path.join(src, entry), path.join(dest, entry), childRelativePath);
        }
      } else {
        const normalizedPath = relativePath.replace(/\\/g, "/");
        const bundledContent = fs$1.readFileSync(src);
        const bundledHash = hashPromptAsset(bundledContent);
        nextManifest.files[normalizedPath] = bundledHash;
        if (!fs$1.existsSync(dest)) {
          fs$1.mkdirSync(path.dirname(dest), { recursive: true });
          fs$1.copyFileSync(src, dest);
          return;
        }
        const installedHash = hashPromptAsset(fs$1.readFileSync(dest));
        const previousBundledHash = previousManifest.files?.[normalizedPath];
        const knownLegacyHashes = LEGACY_BUNDLED_PROMPT_HASHES[normalizedPath] || [];
        const canSafelyMigrate = previousBundledHash ? installedHash === previousBundledHash : knownLegacyHashes.includes(installedHash);
        if (canSafelyMigrate && installedHash !== bundledHash) {
          fs$1.copyFileSync(src, dest);
        }
      }
    };
    copyRecursive(DEFAULT_USERDATA_DIR$1, VOTC_PROMPTS_DIR);
    try {
      fs$1.writeFileSync(PROMPT_DEFAULTS_MANIFEST_PATH, JSON.stringify(nextManifest, null, 2), "utf-8");
    } catch (error) {
      console.warn("[PromptConfig] Could not write bundled-default manifest:", error);
    }
  }
  listFiles(category) {
    let base = VOTC_PROMPTS_DIR;
    if (category === "system") base = VOTC_PROMPTS_SYSTEM_DIR;
    if (category === "character_description") base = VOTC_PROMPTS_CHARACTER_DIR;
    if (category === "example_messages") base = VOTC_PROMPTS_EXAMPLES_DIR;
    if (category === "helpers") base = VOTC_PROMPTS_HELPERS_DIR;
    const files = [];
    const walk = (dir) => {
      if (!fs$1.existsSync(dir)) return;
      for (const entry of fs$1.readdirSync(dir)) {
        if (entry === ".gitkeep" || entry === PROMPT_DEFAULTS_MANIFEST_NAME) continue;
        const full = path.join(dir, entry);
        const stat = fs$1.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else {
          files.push(path.relative(VOTC_PROMPTS_DIR, full).replace(/\\/g, "/"));
        }
      }
    };
    walk(base);
    return files;
  }
  readPromptFile(relativePath) {
    const full = path.join(VOTC_PROMPTS_DIR, relativePath);
    return fs$1.readFileSync(full, "utf-8");
  }
  savePromptFile(relativePath, content) {
    const full = path.join(VOTC_PROMPTS_DIR, relativePath);
    fs$1.mkdirSync(path.dirname(full), { recursive: true });
    fs$1.writeFileSync(full, content, "utf-8");
  }
  resolvePath(relativeOrAbsolute) {
    if (path.isAbsolute(relativeOrAbsolute)) return relativeOrAbsolute;
    return path.join(VOTC_PROMPTS_DIR, relativeOrAbsolute);
  }
  getDefaultMainTemplateContent() {
    const fallback = "You are a character in a medieval strategy game.";
    try {
      this.ensurePromptDirs();
      const fullPath = path.join(VOTC_PROMPTS_DIR, DEFAULT_MAIN_TEMPLATE_PATH);
      if (fs$1.existsSync(fullPath)) {
        return fs$1.readFileSync(fullPath, "utf-8");
      }
      const bundledDefault = path.join(DEFAULT_USERDATA_DIR$1, "system", "default.hbs");
      if (fs$1.existsSync(bundledDefault)) {
        return fs$1.readFileSync(bundledDefault, "utf-8");
      }
    } catch (error) {
      console.error("Failed to read default main template:", error);
    }
    return fallback;
  }
  generateBlockId(type) {
    return `${type}-${Math.random().toString(36).slice(2, 8)}`;
  }
  getDefaultBlocks() {
    return [
      {
        id: "main-system",
        type: "main",
        label: "Main System Prompt",
        enabled: true,
        role: "system",
        template: ""
      },
      {
        id: "character-description",
        type: "description",
        label: "Character Description (pList)",
        enabled: true,
        scriptPath: "character_description/standard/pListMccTest2.js"
      },
      {
        id: "example-messages",
        type: "examples",
        label: "Example Messages (AliChat)",
        enabled: true,
        scriptPath: "example_messages/standard/mccAliChat.js"
      },
      {
        id: "past-summaries",
        type: "past_summaries",
        label: "Past Conversation Summaries",
        enabled: true,
        template: ""
      },
      {
        id: "memories",
        type: "memories",
        label: "Memories",
        enabled: true,
        template: "相关记忆：\\n{{#each memories}}- {{this.creationDate}}：{{this.desc}}\\n{{/each}}",
        limit: 5
      },
      {
        id: "rolling-summary",
        type: "rolling_summary",
        label: "Rolling Summary",
        enabled: true,
        template: "此对话中较早消息的摘要：\\n{{summary}}"
      },
      {
        id: "history",
        type: "history",
        label: "Conversation History",
        enabled: true,
        pinned: true
      },
      {
        id: "instruction",
        type: "instruction",
        label: "Main Instruction",
        enabled: true,
        role: "user",
        template: DEFAULT_CHAT_INSTRUCTION
      }
    ];
  }
  getDefaultLetterBlocks() {
    return [
      {
        id: "letter-main-system",
        type: "main",
        label: "Letter System Prompt",
        enabled: true,
        role: "system",
        template: ""
      },
      {
        id: "letter-description",
        type: "description",
        label: "Letter Character Description (pList)",
        enabled: true,
        scriptPath: "character_description/letter/pListLetter.js"
      },
      {
        id: "letter-past-summaries",
        type: "past_summaries",
        label: "Past Conversation Summaries",
        enabled: true,
        template: ""
      },
      {
        id: "letter-memories",
        type: "memories",
        label: "All Memories",
        enabled: true,
        template: "所有记忆：\n{{#each memories}}- {{this.creationDate}}：{{this.desc}}\n{{/each}}"
      },
      {
        id: "letter-instruction",
        type: "instruction",
        label: "Letter Instruction",
        enabled: true,
        role: "user",
        template: '你收到了来自 {{player.fullName}} 的信件：\n"{{letter.content}}"\n仅以 {{character.fullName}} 的身份撰写回信。'
      }
    ];
  }
  mergeBlocks(defaults, incoming) {
    const cleanedIncoming = Array.isArray(incoming) ? incoming : [];
    const normalize = (block) => {
      const base = defaults.find((d) => d.id === block.id) || defaults.find((d) => d.type === block.type) || void 0;
      const template = block.template ?? base?.template;
      return {
        ...base,
        ...block,
        id: block.id || base?.id || this.generateBlockId(block.type),
        label: block.label || base?.label || block.type,
        enabled: block.enabled ?? base?.enabled ?? true,
        role: block.role || base?.role,
        template: block.type === "instruction" && template === LEGACY_CHAT_INSTRUCTION ? DEFAULT_CHAT_INSTRUCTION : template,
        scriptPath: block.scriptPath ?? base?.scriptPath,
        limit: block.limit ?? base?.limit,
        pinned: block.pinned ?? base?.pinned ?? false
      };
    };
    const merged = cleanedIncoming.map(normalize);
    defaults.forEach((d) => {
      const exists = merged.some((b) => b.id === d.id || b.type === d.type);
      if (!exists) {
        merged.push(d);
      }
    });
    return merged;
  }
  normalizeSettings(settings, options) {
    const defaults = options?.defaultBlocks || this.getDefaultBlocks();
    const defaultMainTemplate = options?.fallbackMainTemplate || this.getDefaultMainTemplateContent();
    const defaultPath = settings?.defaultMainTemplatePath || options?.defaultMainTemplatePath || DEFAULT_MAIN_TEMPLATE_PATH;
    let mainTemplate = settings?.mainTemplate;
    if (!mainTemplate) {
      const legacyPath = settings?.systemPromptTemplate || defaultPath;
      try {
        mainTemplate = this.readPromptFile(legacyPath);
      } catch {
        mainTemplate = defaultMainTemplate;
      }
    }
    const legacyDescScript = settings?.characterDescriptionScript;
    const legacyExamples = settings?.exampleMessagesScript;
    const legacySuffixEnabled = settings?.enableSuffixPrompt;
    const legacySuffixContent = settings?.suffixPrompt;
    let blocks = [];
    if (Array.isArray(settings?.blocks) && settings.blocks.length > 0) {
      blocks = this.mergeBlocks(defaults, settings.blocks);
    } else {
      blocks = this.getDefaultBlocks().map((b) => {
        if (b.type === "description" && legacyDescScript) {
          return { ...b, scriptPath: legacyDescScript };
        }
        if (b.type === "examples" && legacyExamples) {
          return { ...b, scriptPath: legacyExamples };
        }
        return b;
      });
    }
    const suffix = {
      enabled: legacySuffixEnabled ?? settings?.suffix?.enabled ?? false,
      template: legacySuffixContent ?? settings?.suffix?.template ?? "",
      label: settings?.suffix?.label || "Suffix"
    };
    return {
      mainTemplate,
      defaultMainTemplatePath: defaultPath,
      blocks,
      suffix
    };
  }
  getPresetsPath() {
    return path.join(VOTC_PROMPTS_DIR, "prompt-presets.json");
  }
  getPresets() {
    const presetsPath = this.getPresetsPath();
    if (!fs$1.existsSync(presetsPath)) {
      return [];
    }
    try {
      const raw = fs$1.readFileSync(presetsPath, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error("Failed to read prompt presets:", error);
      return [];
    }
  }
  savePreset(preset) {
    const presets = this.getPresets();
    const index = presets.findIndex((p) => p.id === preset.id);
    if (index >= 0) {
      presets[index] = preset;
    } else {
      presets.push(preset);
    }
    fs$1.mkdirSync(VOTC_PROMPTS_DIR, { recursive: true });
    fs$1.writeFileSync(this.getPresetsPath(), JSON.stringify(presets, null, 2), "utf-8");
    return preset;
  }
  deletePreset(id) {
    const presets = this.getPresets().filter((p) => p.id !== id);
    fs$1.mkdirSync(VOTC_PROMPTS_DIR, { recursive: true });
    fs$1.writeFileSync(this.getPresetsPath(), JSON.stringify(presets, null, 2), "utf-8");
  }
  getDefaultLetterMainTemplateContent() {
    const fallback = "Respond with a letter in-character. Do not perform actions.";
    try {
      this.ensurePromptDirs();
      const fullPath = path.join(VOTC_PROMPTS_DIR, DEFAULT_LETTER_TEMPLATE_PATH);
      if (fs$1.existsSync(fullPath)) {
        return fs$1.readFileSync(fullPath, "utf-8");
      }
      const bundledDefault = path.join(DEFAULT_USERDATA_DIR$1, "system", "letter.hbs");
      if (fs$1.existsSync(bundledDefault)) {
        return fs$1.readFileSync(bundledDefault, "utf-8");
      }
    } catch (error) {
      console.error("Failed to read default letter template:", error);
    }
    return fallback;
  }
}
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
    useMinimizedActionsSchema: { type: "boolean" }
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
    default: { rollingPrompt: "", finalPrompt: "", letterSummaryPrompt: "" },
    properties: {
      rollingPrompt: { type: "string", default: "" },
      finalPrompt: { type: "string", default: "" },
      letterSummaryPrompt: { type: "string", default: "" }
    }
  },
  allowPrerelease: {
    type: "boolean",
    default: false
  }
};
class SettingsRepository {
  constructor() {
    this.store = new Store({ schema, name: "votc-llm-config" });
    this.secretStore = new Store({ name: "votc-llm-secrets" });
    this.providerSecrets = new SecureProviderSecrets({ safeStorage: electron.safeStorage, store: this.secretStore });
    console.log("SettingsRepository initialized. Settings path:", this.store.path);
    this.initializeDefaultSettings();
  }
  initializeDefaultSettings() {
    const currentSettings = this.store.get("llmSettings", { providers: [], presets: [], activeProviderInstanceId: null });
    const currentAppSettings = this.store.store;
    let updatedProviders = [...currentSettings.providers];
    let settingsChanged = false;
    PROVIDER_TYPES.forEach((type) => {
      if (!updatedProviders.some((p) => p.providerType === type && p.instanceId === type)) {
        updatedProviders.push({
          instanceId: type,
          providerType: type,
          // customName: type.charAt(0).toUpperCase() + type.slice(1), // No customName for base configs
          ...DEFAULT_PROVIDER_CONFIGS[type]
          // customContextLength is intentionally omitted to use default
        });
        settingsChanged = true;
      }
    });
    updatedProviders = PROVIDER_TYPES.map((type) => {
      const existing = updatedProviders.find((p) => p.providerType === type && p.instanceId === type);
      return existing || {
        // Should not happen if logic above is correct, but as a fallback
        instanceId: type,
        providerType: type,
        ...DEFAULT_PROVIDER_CONFIGS[type]
        // customContextLength is intentionally omitted to use default
      };
    }).filter((p) => PROVIDER_TYPES.includes(p.instanceId));
    if (settingsChanged) {
      currentSettings.providers = updatedProviders;
    }
    if (!currentSettings.presets) {
      currentSettings.presets = [];
      settingsChanged = true;
    }
    if (currentSettings.activeProviderInstanceId === null && updatedProviders.some((p) => p.instanceId === DEFAULT_ACTIVE_PROVIDER)) {
      currentSettings.activeProviderInstanceId = DEFAULT_ACTIVE_PROVIDER;
      settingsChanged = true;
    }
    this.store.set("llmSettings", currentSettings);
    if (currentAppSettings.globalStreamEnabled === void 0) {
      this.store.set("globalStreamEnabled", true);
    }
    if (currentAppSettings.ck3UserFolderPath === void 0) {
      this.store.set("ck3UserFolderPath", null);
    }
    if (currentAppSettings.actionSettings === void 0) {
      this.store.set("actionSettings", { disabledActions: [], validation: {} });
    }
    if (currentAppSettings.promptSettings === void 0) {
      this.store.set("promptSettings", this.getDefaultPromptSettings());
    }
    if (currentAppSettings.letterPromptSettings === void 0) {
      this.store.set("letterPromptSettings", this.getDefaultLetterPromptSettings());
    }
    if (currentAppSettings.messageFontSize === void 0) {
      this.store.set("messageFontSize", 1.1);
    }
    if (currentAppSettings.showSettingsOnStartup === void 0) {
      this.store.set("showSettingsOnStartup", true);
    }
    if (currentAppSettings.actionApprovalSettings === void 0) {
      this.store.set("actionApprovalSettings", {
        approvalMode: "none",
        pauseOnApproval: true
      });
    }
    if (currentAppSettings.summaryPromptSettings === void 0) {
      this.store.set("summaryPromptSettings", {
        rollingPrompt: "",
        finalPrompt: "",
        letterSummaryPrompt: ""
      });
    }
    if (currentAppSettings.allowPrerelease === void 0) {
      this.store.set("allowPrerelease", false);
    }
  }
  getDefaultPromptSettings() {
    return promptConfigManager.normalizeSettings(
      {
        mainTemplate: promptConfigManager.getDefaultMainTemplateContent(),
        defaultMainTemplatePath: "system/default.hbs",
        blocks: promptConfigManager.getDefaultBlocks(),
        suffix: { enabled: false, template: "", label: "Suffix" }
      },
      {
        defaultBlocks: promptConfigManager.getDefaultBlocks(),
        defaultMainTemplatePath: "system/default.hbs",
        fallbackMainTemplate: promptConfigManager.getDefaultMainTemplateContent()
      }
    );
  }
  getDefaultLetterPromptSettings() {
    return promptConfigManager.normalizeSettings(
      {
        mainTemplate: promptConfigManager.getDefaultLetterMainTemplateContent(),
        defaultMainTemplatePath: "system/letter.hbs",
        blocks: promptConfigManager.getDefaultLetterBlocks(),
        suffix: { enabled: false, template: "", label: "Suffix" }
      },
      {
        defaultBlocks: promptConfigManager.getDefaultLetterBlocks(),
        defaultMainTemplatePath: "system/letter.hbs",
        fallbackMainTemplate: promptConfigManager.getDefaultLetterMainTemplateContent()
      }
    );
  }
  // --- Settings Management ---
  getAppSettings() {
    return {
      llmSettings: this.getLLMSettings(),
      ck3UserFolderPath: this.getCK3UserFolderPath(),
      modLocationPath: this.getModLocationPath(),
      globalStreamEnabled: this.getGlobalStreamSetting(),
      pauseOnRegeneration: this.getPauseOnRegenerationSetting(),
      generateFollowingMessages: this.getGenerateFollowingMessagesSetting(),
      messageFontSize: this.getMessageFontSize(),
      showSettingsOnStartup: this.getShowSettingsOnStartup(),
      allowPrerelease: this.getAllowPrerelease(),
      promptSettings: this.getPromptSettings(),
      letterPromptSettings: this.getLetterPromptSettings(),
      actionSettings: this.getActionSettings(),
      actionApprovalSettings: this.getActionApprovalSettings(),
      summaryPromptSettings: this.getSummaryPromptSettings(),
      language: this.getLanguage()
    };
  }
  getLLMSettings() {
    const settings = this.store.get("llmSettings");
    return this.providerSecrets.isAvailable() ? this.providerSecrets.hydrateSettings(settings) : settings;
  }
  saveLLMSettings(settings) {
    const sealed = this.providerSecrets.sealSettings(settings);
    this.store.set("llmSettings", sealed);
    console.log("LLM Settings saved.");
  }
  migrateProviderSecrets() {
    const settings = this.store.get("llmSettings");
    const result = this.providerSecrets.migratePlaintextSettings(settings);
    if (result.migrated) {
      this.store.set("llmSettings", result.settings);
      console.log("[SettingsRepository] Provider API keys migrated to Electron safeStorage.");
    } else if (result.deferred) {
      console.warn("[SettingsRepository] safeStorage unavailable; plaintext provider-key migration deferred without deleting existing data.");
    }
    return result;
  }
  getGlobalStreamSetting() {
    return this.store.get("globalStreamEnabled", true);
  }
  saveGlobalStreamSetting(enabled) {
    this.store.set("globalStreamEnabled", enabled);
    console.log("Global stream setting saved:", enabled);
  }
  getCK3UserFolderPath() {
    const path2 = this.store.get("ck3UserFolderPath");
    console.log(`SettingsRepository.getCK3UserFolderPath: Returning ${path2}`);
    return path2;
  }
  getCK3DebugLogPath() {
    const ck3Folder = this.getCK3UserFolderPath();
    const debugPath = ck3Folder ? path.join(ck3Folder, "logs", "debug.log") : null;
    console.log(`SettingsRepository.getCK3DebugLogPath: ck3Folder=${ck3Folder}, debugPath=${debugPath}`);
    return debugPath;
  }
  setCK3UserFolderPath(path2) {
    console.log(`SettingsRepository.setCK3UserFolderPath: Setting path to ${path2}`);
    this.store.set("ck3UserFolderPath", path2);
    console.log("CK3 User Folder Path saved:", path2);
  }
  getModLocationPath() {
    return this.store.get("modLocationPath");
  }
  setModLocationPath(modPath) {
    this.store.set("modLocationPath", modPath);
    console.log("VOTC Mod Path saved:", modPath);
  }
  getPauseOnRegenerationSetting() {
    return this.store.get("pauseOnRegeneration", true);
  }
  savePauseOnRegenerationSetting(enabled) {
    this.store.set("pauseOnRegeneration", enabled);
    console.log("Pause on regeneration setting saved:", enabled);
  }
  getGenerateFollowingMessagesSetting() {
    return this.store.get("generateFollowingMessages", true);
  }
  saveGenerateFollowingMessagesSetting(enabled) {
    this.store.set("generateFollowingMessages", enabled);
    console.log("Generate following messages setting saved:", enabled);
  }
  getMessageFontSize() {
    return this.store.get("messageFontSize", 1.1);
  }
  saveMessageFontSize(fontSize) {
    this.store.set("messageFontSize", fontSize);
    console.log("Message font size saved:", fontSize);
  }
  getShowSettingsOnStartup() {
    return this.store.get("showSettingsOnStartup", true);
  }
  saveShowSettingsOnStartupSetting(enabled) {
    this.store.set("showSettingsOnStartup", enabled);
    console.log("Show settings on startup setting saved:", enabled);
  }
  getLanguage() {
    return this.store.get("language", "en");
  }
  saveLanguage(language) {
    this.store.set("language", language);
    console.log("Language setting saved:", language);
  }
  getAllowPrerelease() {
    return this.store.get("allowPrerelease", false);
  }
  saveAllowPrerelease(allow) {
    this.store.set("allowPrerelease", allow);
    console.log("Allow prerelease setting saved:", allow);
  }
  // --- Prompt settings ---
  getPromptSettings() {
    let stored = this.store.get("promptSettings", this.getDefaultPromptSettings());
    const storedMainTemplateHash = typeof stored?.mainTemplate === "string" ? hashPromptAsset(stored.mainTemplate) : null;
    if (storedMainTemplateHash && (LEGACY_BUNDLED_PROMPT_HASHES[DEFAULT_MAIN_TEMPLATE_PATH] || []).includes(storedMainTemplateHash)) {
      const bundledMainTemplatePath = path.join(DEFAULT_USERDATA_DIR$1, "system", "default.hbs");
      const installedMainTemplatePath = path.join(VOTC_PROMPTS_DIR, DEFAULT_MAIN_TEMPLATE_PATH);
      const bundledMainTemplate = fs$1.existsSync(bundledMainTemplatePath) ? fs$1.readFileSync(bundledMainTemplatePath, "utf-8") : promptConfigManager.getDefaultMainTemplateContent();
      let migratedMainTemplate = bundledMainTemplate;
      if (fs$1.existsSync(installedMainTemplatePath)) {
        const installedMainTemplate = fs$1.readFileSync(installedMainTemplatePath, "utf-8");
        const installedMainTemplateHash = hashPromptAsset(installedMainTemplate);
        const installedIsLegacyDefault = (LEGACY_BUNDLED_PROMPT_HASHES[DEFAULT_MAIN_TEMPLATE_PATH] || []).includes(installedMainTemplateHash);
        // Prefer a current installed template or a direct user file override.
        // Only fall back to bundled content when the installed file is the
        // unchanged legacy default waiting to be migrated.
        if (!installedIsLegacyDefault) migratedMainTemplate = installedMainTemplate;
      }
      stored = {
        ...stored,
        mainTemplate: migratedMainTemplate
      };
      this.store.set("promptSettings", stored);
      console.log("[PromptConfig] Migrated unchanged legacy main template to the segmented cache layout.");
    }
    return promptConfigManager.normalizeSettings(stored, {
      defaultBlocks: promptConfigManager.getDefaultBlocks(),
      defaultMainTemplatePath: "system/default.hbs",
      fallbackMainTemplate: promptConfigManager.getDefaultMainTemplateContent()
    });
  }
  savePromptSettings(settings) {
    this.store.set(
      "promptSettings",
      promptConfigManager.normalizeSettings(settings, {
        defaultBlocks: promptConfigManager.getDefaultBlocks(),
        defaultMainTemplatePath: "system/default.hbs",
        fallbackMainTemplate: promptConfigManager.getDefaultMainTemplateContent()
      })
    );
    console.log("Prompt settings saved.");
  }
  getLetterPromptSettings() {
    const stored = this.store.get("letterPromptSettings", this.getDefaultLetterPromptSettings());
    return promptConfigManager.normalizeSettings(stored, {
      defaultBlocks: promptConfigManager.getDefaultLetterBlocks(),
      defaultMainTemplatePath: "system/letter.hbs",
      fallbackMainTemplate: promptConfigManager.getDefaultLetterMainTemplateContent()
    });
  }
  saveLetterPromptSettings(settings) {
    this.store.set(
      "letterPromptSettings",
      promptConfigManager.normalizeSettings(settings, {
        defaultBlocks: promptConfigManager.getDefaultLetterBlocks(),
        defaultMainTemplatePath: "system/letter.hbs",
        fallbackMainTemplate: promptConfigManager.getDefaultLetterMainTemplateContent()
      })
    );
    console.log("Letter prompt settings saved.");
  }
  // --- Action Settings (actions toggles and validation cache) ---
  getActionSettings() {
    const def = { disabledActions: [], validation: {} };
    return this.store.get("actionSettings", def);
  }
  saveActionSettings(settings) {
    this.store.set("actionSettings", settings);
    console.log("Action settings saved.");
  }
  // --- Action Approval Settings ---
  getActionApprovalSettings() {
    return this.store.get("actionApprovalSettings", {
      approvalMode: "none",
      pauseOnApproval: true
    });
  }
  saveActionApprovalSettings(settings) {
    this.store.set("actionApprovalSettings", settings);
    console.log("Action approval settings saved:", settings);
  }
  getPauseOnActionApprovalSetting() {
    const settings = this.getActionApprovalSettings();
    return settings.pauseOnApproval ?? true;
  }
  savePauseOnActionApprovalSetting(enabled) {
    const settings = this.getActionApprovalSettings();
    settings.pauseOnApproval = enabled;
    this.saveActionApprovalSettings(settings);
  }
  // --- Provider Configuration and Preset Management ---
  // This method now handles saving both base provider configs and presets
  saveProviderConfig(configToSave) {
    const settings = this.getLLMSettings();
    if (PROVIDER_TYPES.includes(configToSave.instanceId)) {
      const index = settings.providers.findIndex((p) => p.instanceId === configToSave.instanceId);
      if (index > -1) {
        settings.providers[index] = configToSave;
      } else {
        settings.providers.push(configToSave);
      }
    } else {
      if (!configToSave.instanceId) {
        configToSave.instanceId = uuid.v4();
      }
      const index = settings.presets.findIndex((p) => p.instanceId === configToSave.instanceId);
      if (index > -1) {
        settings.presets[index] = configToSave;
      } else {
        settings.presets.push(configToSave);
      }
    }
    this.saveLLMSettings(settings);
    return configToSave;
  }
  // deleteProviderConfig is effectively deletePreset now, as base configs are not deleted
  deletePreset(presetInstanceId) {
    const settings = this.getLLMSettings();
    settings.presets = settings.presets.filter((p) => p.instanceId !== presetInstanceId);
    if (settings.activeProviderInstanceId === presetInstanceId) {
      settings.activeProviderInstanceId = null;
    }
    if (settings.actionsProviderInstanceId === presetInstanceId) {
      settings.actionsProviderInstanceId = null;
    }
    if (settings.summaryProviderInstanceId === presetInstanceId) {
      settings.summaryProviderInstanceId = null;
    }
    this.saveLLMSettings(settings);
  }
  getActiveProviderInstanceId() {
    return this.getLLMSettings().activeProviderInstanceId;
  }
  setActiveProviderInstanceId(instanceId) {
    const settings = this.getLLMSettings();
    settings.activeProviderInstanceId = instanceId;
    this.saveLLMSettings(settings);
  }
  getActiveProviderConfig() {
    const activeId = this.getActiveProviderInstanceId();
    if (!activeId) return null;
    let config = this.getLLMSettings().providers.find((p) => p.instanceId === activeId);
    if (config) return config;
    config = this.getLLMSettings().presets.find((p) => p.instanceId === activeId);
    return config || null;
  }
  // --- Provider Override Management ---
  /**
   * Helper to get any provider config by instanceId (base or preset)
   */
  getProviderConfigById(instanceId) {
    const settings = this.getLLMSettings();
    let config = settings.providers.find((p) => p.instanceId === instanceId);
    if (config) return config;
    config = settings.presets.find((p) => p.instanceId === instanceId);
    return config || null;
  }
  getActionsProviderInstanceId() {
    return this.getLLMSettings().actionsProviderInstanceId ?? null;
  }
  getSummaryProviderInstanceId() {
    return this.getLLMSettings().summaryProviderInstanceId ?? null;
  }
  /**
   * Get the provider config for Actions.
   * Returns the override if set, otherwise falls back to active provider.
   */
  getActionsProviderConfig() {
    const overrideId = this.getActionsProviderInstanceId();
    if (overrideId) {
      return this.getProviderConfigById(overrideId);
    }
    return this.getActiveProviderConfig();
  }
  /**
   * Get the provider config for Summaries.
   * Returns the override if set, otherwise falls back to active provider.
   */
  getSummaryProviderConfig() {
    const overrideId = this.getSummaryProviderInstanceId();
    if (overrideId) {
      return this.getProviderConfigById(overrideId);
    }
    return this.getActiveProviderConfig();
  }
  setActionsProviderInstanceId(instanceId) {
    const settings = this.getLLMSettings();
    settings.actionsProviderInstanceId = instanceId;
    this.saveLLMSettings(settings);
    console.log("Actions provider override set:", instanceId);
  }
  setSummaryProviderInstanceId(instanceId) {
    const settings = this.getLLMSettings();
    settings.summaryProviderInstanceId = instanceId;
    this.saveLLMSettings(settings);
    console.log("Summary provider override set:", instanceId);
  }
  // --- Summary Prompt Settings ---
  getDefaultRollingSummaryPrompt() {
    return `更新之前的摘要，融入新消息的内容。创建一个连贯的摘要，包含之前的事件和新信息。

请按以下结构组织摘要：
1. **对话主题**：本次对话的核心议题
2. **关键事件**：讨论或发生的重要事件（保留具体细节：人名、地点、数字、日期）
3. **决策与承诺**：做出的决定、达成的协议、许下的承诺
4. **情感与关系**：角色之间的情感变化、关系发展
5. **后续计划**：提到的未来行动或计划

保持简洁但务必保留重要细节。使用中文撰写。`;
  }
  getDefaultFinalSummaryPrompt() {
    return `为这次对话创建一个详细的结构化摘要。

请按以下格式组织（使用中文）：

**对话概况**
- 参与者：[列出所有参与对话的角色]
- 主题：[对话的核心主题]
- 背景：[对话发生的情境]

**关键内容**
1. 重要事件和决策
   - [具体描述每个重要事件，包含人名、地点、时间等细节]
   
2. 角色互动与关系发展
   - [描述角色之间的互动，情感变化，关系进展]
   
3. 揭示的信息或秘密
   - [记录对话中揭示的重要信息、秘密或真相]
   
4. 达成的协议与承诺
   - [列出明确的承诺、协议或约定，包括具体条件]
   
5. 冲突与分歧
   - [记录任何冲突、争执或未解决的分歧]

**后续影响**
- 未来计划：[讨论的后续行动]
- 潜在后果：[对话可能带来的影响]
- 悬而未决：[尚未解决的问题]

**关键引用**（如有特别重要的原话，请标注）

使用中文撰写，保持简洁但确保关键信息完整。`;
  }
  getDefaultLetterSummaryPrompt() {
    return `简洁总结这封信件的内容。

包括：
- 核心话题
- 发信人的态度和语气
- 提出的请求或建议
- 重要的具体细节（数字、日期、地点、人名）

使用中文撰写，保持精炼。`;
  }
  getSummaryPromptSettings() {
    const stored = this.store.get("summaryPromptSettings", {
      rollingPrompt: "",
      finalPrompt: "",
      letterSummaryPrompt: ""
    });
    return {
      rollingPrompt: stored.rollingPrompt || this.getDefaultRollingSummaryPrompt(),
      finalPrompt: stored.finalPrompt || this.getDefaultFinalSummaryPrompt(),
      letterSummaryPrompt: stored.letterSummaryPrompt || this.getDefaultLetterSummaryPrompt()
    };
  }
  saveSummaryPromptSettings(settings) {
    this.store.set("summaryPromptSettings", settings);
    console.log("Summary prompt settings saved.");
    logVerboseLLM("[Settings][verbose] Summary prompt settings:", settings);
  }
}
const settingsRepository = new SettingsRepository();
const providerRegistry = ProviderRegistry.getInstance();
function createPromptFingerprint(value) {
  if (value === null || value === void 0) return null;
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}
/**
 * Persists API usage metadata without storing prompts, replies, or credentials.
 * DeepSeek reports cache fields in usage; other providers simply remain "unknown".
 */
class UsageAnalytics {
  constructor() {
    this.maxUsageEntries = usageAnalyticsRetention.DEFAULT_MAX_USAGE_ENTRIES;
    this.maxDiagnosticEntries = usageAnalyticsRetention.DEFAULT_MAX_DIAGNOSTIC_ENTRIES;
  }
  read() {
    try {
      if (!fs$1.existsSync(VOTC_USAGE_ANALYTICS_FILE)) return { version: 1, entries: [] };
      const data = JSON.parse(fs$1.readFileSync(VOTC_USAGE_ANALYTICS_FILE, "utf-8"));
      return Array.isArray(data?.entries) ? data : { version: 1, entries: [] };
    } catch (error) {
      console.warn("[UsageAnalytics] Failed to read analytics:", error);
      return { version: 1, entries: [] };
    }
  }
  write(data) {
    try {
      fs$1.mkdirSync(VOTC_DATA_DIR, { recursive: true });
      fs$1.writeFileSync(VOTC_USAGE_ANALYTICS_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      console.warn("[UsageAnalytics] Failed to save analytics:", error);
    }
  }
  record(metadata, usage) {
    const promptTokens = Number(usage?.prompt_tokens) || 0;
    const completionTokens = Number(usage?.completion_tokens) || 0;
    const cacheHitTokens = Number(usage?.prompt_cache_hit_tokens);
    const cacheMissTokens = Number(usage?.prompt_cache_miss_tokens);
    const entry = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      requestType: metadata?.requestType || "unknown",
      providerType: metadata?.providerType || "unknown",
      model: metadata?.model || "unknown",
      character: metadata?.character || null,
      characterId: Number.isFinite(Number(metadata?.characterId)) ? Number(metadata.characterId) : null,
      actionTrigger: metadata?.actionTrigger || null,
      actionOutcome: metadata?.actionOutcome || null,
      actionCandidateReasons: Array.isArray(metadata?.actionCandidateReasons) ? metadata.actionCandidateReasons : [],
      actionFinishReason: metadata?.actionFinishReason || null,
      selectedActionIds: Array.isArray(metadata?.selectedActionIds) ? metadata.selectedActionIds : [],
      executedActionIds: Array.isArray(metadata?.executedActionIds) ? metadata.executedActionIds : [],
      pendingActionIds: Array.isArray(metadata?.pendingActionIds) ? metadata.pendingActionIds : [],
      failedActionIds: Array.isArray(metadata?.failedActionIds) ? metadata.failedActionIds : [],
      skipReason: metadata?.skipReason || null,
      estimatedPromptTokens: Number(metadata?.estimatedPromptTokens) || 0,
      promptTokens,
      completionTokens,
      totalTokens: Number(usage?.total_tokens) || promptTokens + completionTokens,
      isUsageRecord: !!usage && typeof usage === "object",
      cacheHitTokens: Number.isFinite(cacheHitTokens) ? cacheHitTokens : null,
      cacheMissTokens: Number.isFinite(cacheMissTokens) ? cacheMissTokens : null,
      historyStartPosition: Number.isFinite(Number(metadata?.historyStartPosition)) ? Number(metadata.historyStartPosition) : null,
      prefixFingerprint: metadata?.prefixFingerprint || null,
      blocks: Array.isArray(metadata?.blocks) ? metadata.blocks.map((block, index) => ({
        id: block.id,
        label: block.label,
        type: block.type,
        position: Number.isFinite(Number(block.position)) ? Number(block.position) : index,
        tokens: Number(block.tokens) || 0,
        fingerprint: block.fingerprint || createPromptFingerprint(block.content)
      })) : []
    };
    const data = this.read();
    data.version = 4;
    data.entries.push(entry);
    data.entries = usageAnalyticsRetention.retainUsageAnalyticsEntries(data.entries, {
      maxUsageEntries: this.maxUsageEntries,
      maxDiagnosticEntries: this.maxDiagnosticEntries
    });
    this.write(data);
    console.log(`[UsageAnalytics] ${entry.requestType}: input=${entry.promptTokens || entry.estimatedPromptTokens}, hit=${entry.cacheHitTokens ?? "n/a"}, miss=${entry.cacheMissTokens ?? "n/a"}, output=${entry.completionTokens}`);
  }
  getReport() {
    const entries = this.read().entries;
    const groups = {};
    const add = (target, entry) => {
      target.requests += Math.max(1, Math.floor(Number(entry.requestCount) || 1));
      target.estimatedPromptTokens += entry.estimatedPromptTokens || 0;
      target.promptTokens += entry.promptTokens || 0;
      target.completionTokens += entry.completionTokens || 0;
      target.totalTokens += entry.totalTokens || 0;
      if (entry.cacheHitTokens != null) {
        target.cacheReportedRequests++;
        target.cacheHitTokens += entry.cacheHitTokens;
        target.cacheMissTokens += entry.cacheMissTokens || 0;
      }
    };
    const create = () => ({ requests: 0, estimatedPromptTokens: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheReportedRequests: 0, cacheHitTokens: 0, cacheMissTokens: 0 });
    const total = create();
    const diagnostics = { total: 0, actionSkipped: 0, byType: {} };
    const reconciliation = { aggregates: 0, requests: 0, totalTokens: 0 };
    const blockTotals = {};
    const missAttributionTotals = {};
    const changesSincePreviousTotals = {};
    const previousByRequest = /* @__PURE__ */ new Map();
    const recentWithAttribution = [];
    const actionOutcomes = {
      evaluated: 0,
      noAvailableAction: 0,
      emptyResponse: 0,
      invalidResponse: 0,
      noActionSelected: 0,
      withSelection: 0,
      executed: 0,
      pendingApproval: 0,
      failed: 0,
      selectedActionIds: {},
      outcomes: {}
    };
    for (const entry of entries) {
      const isUsageRecord = usageAnalyticsRetention.isUsageEntry(entry);
      const isActionOutcome = entry.requestType === "action_outcome";
      if (isUsageRecord) {
        add(total, entry);
        if (entry.isReconciledAggregate) {
          reconciliation.aggregates++;
          reconciliation.requests += Math.max(1, Math.floor(Number(entry.requestCount) || 1));
          reconciliation.totalTokens += entry.totalTokens || 0;
        }
        const key = `${entry.requestType} | ${entry.providerType} | ${entry.model}`;
        if (!groups[key]) groups[key] = create();
        add(groups[key], entry);
      } else if (isActionOutcome) {
        actionOutcomes.evaluated++;
        const outcome = entry.actionOutcome || "unknown";
        actionOutcomes.outcomes[outcome] = (actionOutcomes.outcomes[outcome] || 0) + 1;
        if (outcome === "no_available_action") actionOutcomes.noAvailableAction++;
        if (outcome === "empty_response") actionOutcomes.emptyResponse++;
        if (outcome === "invalid_json" || outcome === "invalid_schema") actionOutcomes.invalidResponse++;
        if (outcome === "no_action_selected") actionOutcomes.noActionSelected++;
        actionOutcomes.executed += entry.executedActionIds?.length || 0;
        actionOutcomes.pendingApproval += entry.pendingActionIds?.length || 0;
        actionOutcomes.failed += entry.failedActionIds?.length || 0;
        if ((entry.selectedActionIds?.length || 0) > 0) actionOutcomes.withSelection++;
        for (const actionId of entry.selectedActionIds || []) {
          actionOutcomes.selectedActionIds[actionId] = (actionOutcomes.selectedActionIds[actionId] || 0) + 1;
        }
      } else {
        diagnostics.total++;
        diagnostics.byType[entry.requestType] = (diagnostics.byType[entry.requestType] || 0) + 1;
        if (entry.requestType === "action_skipped") diagnostics.actionSkipped++;
      }
      if (!isUsageRecord) continue;
      for (const block of entry.blocks || []) {
        const blockKey = `${block.type || "unknown"} | ${block.label || block.id || "unknown"}`;
        if (!blockTotals[blockKey]) blockTotals[blockKey] = { requests: 0, tokens: 0 };
        blockTotals[blockKey].requests++;
        blockTotals[blockKey].tokens += block.tokens || 0;
      }
      const responderKey = entry.characterId ?? entry.character ?? "";
      const previousKey = `${entry.requestType} | ${entry.providerType} | ${entry.model} | ${responderKey}`;
      const previousEntry = previousByRequest.get(previousKey);
      const cacheAttribution = this.attributeCacheMiss(entry, previousEntry);
      previousByRequest.set(previousKey, entry);
      if (!entry.isReconciledAggregate) recentWithAttribution.push({ ...entry, cacheAttribution });
      if (cacheAttribution?.cacheMissTokens > 0) {
        const breakpoint = cacheAttribution.breakpoint;
        const attributionKey = cacheAttribution.coldStart ? `${entry.requestType} | cold_start | No reusable prefix` : breakpoint ? `${entry.requestType} | ${breakpoint.type || "unknown"} | ${breakpoint.label || breakpoint.id || "unknown"}` : `${entry.requestType} | unattributed | No block metadata`;
        if (!missAttributionTotals[attributionKey]) {
          missAttributionTotals[attributionKey] = {
            requests: 0,
            cacheMissTokens: 0,
            breakpointMissTokens: 0,
            downstreamMissTokens: 0,
            changedSincePreviousRequests: 0
          };
        }
        const target = missAttributionTotals[attributionKey];
        target.requests++;
        target.cacheMissTokens += cacheAttribution.cacheMissTokens;
        target.breakpointMissTokens += breakpoint?.attributedMissTokens || 0;
        target.downstreamMissTokens += cacheAttribution.downstreamMissTokens || 0;
        if (cacheAttribution.firstChangedBlock) target.changedSincePreviousRequests++;
        const changedBlock = cacheAttribution.firstChangedBlock;
        if (changedBlock) {
          const changeKey = `${entry.requestType} | ${changedBlock.type || "unknown"} | ${changedBlock.label || changedBlock.id || "unknown"}`;
          if (!changesSincePreviousTotals[changeKey]) {
            changesSincePreviousTotals[changeKey] = { requests: 0, cacheMissTokens: 0, agreesWithBreakpointRequests: 0 };
          }
          changesSincePreviousTotals[changeKey].requests++;
          changesSincePreviousTotals[changeKey].cacheMissTokens += cacheAttribution.cacheMissTokens;
          if (cacheAttribution.fingerprintAgreesWithBreakpoint) changesSincePreviousTotals[changeKey].agreesWithBreakpointRequests++;
        }
      }
    }
    const finish = (value) => ({ ...value, cacheHitRate: value.cacheHitTokens + value.cacheMissTokens > 0 ? value.cacheHitTokens / (value.cacheHitTokens + value.cacheMissTokens) : null });
    return {
      filePath: VOTC_USAGE_ANALYTICS_FILE,
      total: finish(total),
      diagnostics,
      reconciliation,
      byRequest: Object.entries(groups).map(([key, value]) => ({ key, ...finish(value) })).sort((a, b) => b.totalTokens - a.totalTokens),
      blocks: Object.entries(blockTotals).map(([key, value]) => ({ key, ...value })).sort((a, b) => b.tokens - a.tokens),
      missAttribution: Object.entries(missAttributionTotals).map(([key, value]) => ({ key, ...value })).sort((a, b) => b.cacheMissTokens - a.cacheMissTokens),
      changesSincePrevious: Object.entries(changesSincePreviousTotals).map(([key, value]) => ({ key, ...value })).sort((a, b) => b.cacheMissTokens - a.cacheMissTokens),
      actionOutcomes: {
        ...actionOutcomes,
        selectionRate: actionOutcomes.evaluated > 0 ? actionOutcomes.withSelection / actionOutcomes.evaluated : null,
        successfulExecutionRate: actionOutcomes.executed + actionOutcomes.failed > 0 ? actionOutcomes.executed / (actionOutcomes.executed + actionOutcomes.failed) : null
      },
      recent: recentWithAttribution.slice(-100).reverse()
    };
  }
  attributeCacheMiss(entry, previousEntry = null) {
    if (entry?.cacheHitTokens == null || entry?.cacheMissTokens == null) return null;
    const cacheHitTokens = Number(entry?.cacheHitTokens);
    const cacheMissTokens = Number(entry?.cacheMissTokens);
    if (!Number.isFinite(cacheHitTokens) || !Number.isFinite(cacheMissTokens)) return null;
    const cacheTotal = cacheHitTokens + cacheMissTokens;
    const blocks = Array.isArray(entry?.blocks) ? entry.blocks : [];
    if (cacheTotal <= 0 || blocks.length === 0) {
      return {
        method: "ordered_prefix_estimate_v1",
        cacheHitTokens,
        cacheMissTokens,
        coldStart: cacheHitTokens === 0 && cacheMissTokens > 0,
        breakpoint: null,
        downstreamMissTokens: cacheMissTokens,
        firstChangedBlock: null,
        blocks: []
      };
    }
    const estimatedTotal = blocks.reduce((sum, block) => sum + (Number(block.tokens) || 0), 0);
    if (estimatedTotal <= 0) return null;
    let estimatedCursor = 0;
    let actualCursor = 0;
    const attributedBlocks = blocks.map((block, index) => {
      estimatedCursor += Number(block.tokens) || 0;
      const actualEnd = index === blocks.length - 1 ? cacheTotal : Math.round(estimatedCursor / estimatedTotal * cacheTotal);
      const actualTokens = Math.max(0, actualEnd - actualCursor);
      const attributedHitTokens = Math.max(0, Math.min(actualEnd, cacheHitTokens) - Math.min(actualCursor, cacheHitTokens));
      const attributedMissTokens = Math.max(0, actualTokens - attributedHitTokens);
      actualCursor = actualEnd;
      return {
        id: block.id,
        label: block.label,
        type: block.type,
        position: Number.isFinite(Number(block.position)) ? Number(block.position) : index,
        estimatedTokens: Number(block.tokens) || 0,
        attributedTokens: actualTokens,
        attributedHitTokens,
        attributedMissTokens
      };
    });
    const breakpoint = attributedBlocks.find((block) => block.attributedMissTokens > 0) || null;
    const breakpointIndex = breakpoint ? attributedBlocks.indexOf(breakpoint) : -1;
    const downstreamMissTokens = breakpointIndex >= 0 ? attributedBlocks.slice(breakpointIndex + 1).reduce((sum, block) => sum + block.attributedMissTokens, 0) : 0;
    let firstChangedBlock = null;
    const previousBlocks = Array.isArray(previousEntry?.blocks) ? previousEntry.blocks : [];
    if (previousBlocks.length > 0) {
      const maxLength = Math.max(blocks.length, previousBlocks.length);
      for (let index = 0; index < maxLength; index++) {
        const current = blocks[index];
        const previous = previousBlocks[index];
        if (!current || !previous || current.id !== previous.id) {
          if (current) {
            firstChangedBlock = { id: current.id, label: current.label, type: current.type, position: index };
          }
          break;
        }
        // Older analytics entries have no fingerprints. Their token breakpoint
        // remains usable, but an exact content-change comparison is unavailable.
        if (!current.fingerprint || !previous.fingerprint) break;
        if (current.fingerprint !== previous.fingerprint) {
          firstChangedBlock = { id: current.id, label: current.label, type: current.type, position: index };
          break;
        }
      }
    }
    const prefixFingerprintMatchesPrevious = !!(entry?.prefixFingerprint && previousEntry?.prefixFingerprint && entry.prefixFingerprint === previousEntry.prefixFingerprint);
    const firstChangedBeforeHistory = !!(firstChangedBlock && Number.isFinite(Number(entry?.historyStartPosition)) && firstChangedBlock.position < Number(entry.historyStartPosition));
    return {
      method: "ordered_prefix_estimate_v1",
      cacheHitTokens,
      cacheMissTokens,
      estimatedBlockTokens: estimatedTotal,
      scale: cacheTotal / estimatedTotal,
      coldStart: cacheHitTokens === 0 && cacheMissTokens > 0,
      breakpoint,
      downstreamMissTokens,
      firstChangedBlock,
      prefixFingerprintMatchesPrevious,
      firstChangedBeforeHistory,
      fingerprintAgreesWithBreakpoint: !!(breakpoint && firstChangedBlock && breakpoint.id === firstChangedBlock.id),
      blocks: attributedBlocks
    };
  }
  clear() {
    this.write({ version: 4, entries: [] });
  }
}
const usageAnalytics = new UsageAnalytics();
function removeTooltip$2(text) {
  return text.replace(/<.*?>.*?<\/.*?>/gi, "").trim();
}
class GameData {
  constructor(data) {
    this.playerID = Number(data[0]), this.playerName = removeTooltip$2(data[1]), this.aiID = Number(data[2]), this.aiName = removeTooltip$2(data[3]), this.date = data[4], this.scene = data[5].substring(11), this.location = data[6], this.locationController = data[7], this.totalDays = Number(data[8]), this.characters = /* @__PURE__ */ new Map(), this.letterData = null;
    
    // 解析动态历史信息
    this.parseHistoricalContext();
  }
  
  /**
   * 解析当前游戏时间的历史背景信息
   * 注意：不使用硬编码的真实历史皇帝，而是从游戏实际数据获取
   */
  parseHistoricalContext() {
    // 从日期字符串提取年份，例如 "976年5月3日" -> 976
    const yearMatch = this.date.match(/(\d+)年/);
    this.year = yearMatch ? parseInt(yearMatch[1]) : 976;
    
    // 根据年份判断朝代
    if (this.year < 907) {
      this.dynasty = '唐朝';
    } else if (this.year < 960) {
      this.dynasty = '五代十国';
    } else if (this.year < 1127) {
      this.dynasty = '北宋';
    } else if (this.year < 1279) {
      this.dynasty = '南宋';
    } else {
      this.dynasty = '元朝';
    }
    
    // 当前皇帝、年号等信息从游戏中获取
    // 这些会在 characters 加载后更新
    this.currentEmperor = null;
    this.currentEmperorTitle = null;
    this.currentEraName = null;
    
    // 历史背景：根据年份提供真实历史的参考信息
    // 这些是"历史知识"，即使游戏中历史改变了，这些人物和事件仍作为背景知识存在
    this.historicalReferenceInfo = this.getHistoricalReferenceByYear(this.year);
  }
  
  /**
   * 根据年份返回真实历史的参考信息
   * 这些信息作为"历史知识背景"，帮助AI理解时代特征
   * 即使游戏中历史改变了，这些历史人物和事件仍然作为可能的知识存在
   * 
   * 涵盖时期：唐末(875年)至南宋灭亡(1279年)
   */
  getHistoricalReferenceByYear(year) {
    // 唐末五代十国时期
    if (year >= 875 && year < 907) {
      return {
        period: '唐末黄巢起义至唐朝灭亡',
        context: '黄巢起义动摇唐朝根基，藩镇割据严重，天下大乱',
        notableEvents: ['黄巢起义(875-884)', '长安陷落', '朱温篡唐(907)'],
        notableFigures: ['黄巢', '朱温', '李克用', '李茂贞']
      };
    } else if (year >= 907 && year < 960) {
      return {
        period: '五代十国',
        context: '中原五代更迭，南方十国并立，战乱频仍',
        notableEvents: ['后梁建立', '后唐灭梁', '后周世宗改革'],
        notableFigures: ['朱温', '李存勖', '石敬瑭', '柴荣', '赵匡胤']
      };
    }
    // 北宋时期
    else if (year >= 960 && year < 976) {
      return {
        period: '北宋开国',
        context: '宋朝开国，结束五代十国乱世，中央集权初步建立',
        notableEvents: ['陈桥兵变', '杯酒释兵权', '统一南方'],
        notableFigures: ['赵普', '石守信', '王全斌']
      };
    } else if (year >= 976 && year < 1000) {
      return {
        period: '北宋统一战争',
        context: '继续统一战争，强化中央集权，重文轻武政策形成',
        notableEvents: ['灭北汉', '高梁河之战', '雍熙北伐'],
        notableFigures: ['赵普', '潘美', '杨业']
      };
    } else if (year >= 1000 && year < 1022) {
      return {
        period: '咸平景德年间',
        context: '辽宋对峙，澶渊之盟签订',
        notableEvents: ['澶渊之盟(1004)', '宋辽议和'],
        notableFigures: ['寇准', '王钦若', '毕士安']
      };
    } else if (year >= 1022 && year < 1050) {
      return {
        period: '仁宗前期',
        context: '仁宗亲政初期，士大夫势力增强',
        notableEvents: ['刘太后垂帘听政', '废郭皇后'],
        notableFigures: ['范仲淹', '欧阳修', '韩琦']
      };
    } else if (year >= 1050 && year < 1063) {
      return {
        period: '仁宗后期',
        context: '庆历新政后，辽夏压力增加',
        notableEvents: ['庆历新政', '宋夏战争'],
        notableFigures: ['范仲淹', '富弼', '欧阳修', '司马光']
      };
    } else if (year >= 1063 && year < 1085) {
      return {
        period: '熙宁变法',
        context: '王安石变法，改革派与保守派斗争激烈',
        notableEvents: ['熙宁变法', '新旧党争'],
        notableFigures: ['王安石', '司马光', '苏轼', '苏辙']
      };
    } else if (year >= 1085 && year < 1100) {
      return {
        period: '元祐更化',
        context: '废除新法，保守派当政',
        notableEvents: ['元祐更化', '高太后垂帘听政'],
        notableFigures: ['司马光', '苏轼', '苏辙', '程颐']
      };
    } else if (year >= 1100 && year < 1126) {
      return {
        period: '北宋末期',
        context: '政治腐败，金国崛起，北宋危机',
        notableEvents: ['蔡京专权', '方腊起义', '靖康之变前夕'],
        notableFigures: ['蔡京', '童贯', '李纲', '种师道']
      };
    }
    // 靖康之变与南宋初期
    else if (year >= 1126 && year < 1142) {
      return {
        period: '靖康之变与南宋建立',
        context: '金兵南下，徽钦二帝被俘，康王赵构南渡建立南宋',
        notableEvents: ['靖康之变(1127)', '南宋建立', '宋金战争'],
        notableFigures: ['岳飞', '韩世忠', '宗泽', '李纲', '秦桧']
      };
    } else if (year >= 1142 && year < 1162) {
      return {
        period: '绍兴议和',
        context: '绍兴和议后，宋金对峙局面形成',
        notableEvents: ['绍兴和议(1141)', '岳飞被害'],
        notableFigures: ['秦桧', '岳飞', '韩世忠', '张俊']
      };
    } else if (year >= 1162 && year < 1189) {
      return {
        period: '孝宗中兴',
        context: '孝宗力图恢复，经济文化发展',
        notableEvents: ['隆兴北伐', '乾道之治'],
        notableFigures: ['虞允文', '张浚', '辛弃疾', '陆游']
      };
    } else if (year >= 1189 && year < 1234) {
      return {
        period: '南宋中期',
        context: '宋金对峙，蒙古崛起改变局势',
        notableEvents: ['开禧北伐', '蒙古西征', '宋蒙联合灭金'],
        notableFigures: ['韩侂胄', '史弥远', '辛弃疾', '陆游']
      };
    } else if (year >= 1234 && year < 1260) {
      return {
        period: '宋蒙战争前期',
        context: '金国灭亡，宋蒙关系破裂，襄樊鏖战',
        notableEvents: ['联蒙灭金(1234)', '钓鱼城之战', '襄阳保卫战'],
        notableFigures: ['孟珙', '余玠', '贾似道']
      };
    } else if (year >= 1260 && year < 1279) {
      return {
        period: '南宋末期',
        context: '蒙古铁骑南下，南宋危在旦夕',
        notableEvents: ['襄阳陷落(1273)', '临安陷落(1276)', '崖山海战前'],
        notableFigures: ['文天祥', '张世杰', '陆秀夫', '贾似道']
      };
    } else if (year >= 1279) {
      return {
        period: '元朝建立',
        context: '崖山海战后，南宋灭亡，蒙元统治中原',
        notableEvents: ['崖山海战(1279)', '南宋灭亡', '元朝统治'],
        notableFigures: ['忽必烈', '伯颜', '文天祥']
      };
    }
    
    // 默认（年份早于875年）
    return {
      period: '唐朝时期',
      context: '大唐帝国，文治武功鼎盛',
      notableEvents: [],
      notableFigures: []
    };
  }
  
  /**
   * 更新当前皇帝信息（从游戏角色数据中获取）
   * 在 characters 加载完成后调用
   */
  updateCurrentEmperorInfo() {
    // 从游戏角色中查找皇帝
    // 皇帝通常有特定的标题，如"皇帝"、"陛下"等
    for (const char of this.characters.values()) {
      if (char.primaryTitle && (
        char.primaryTitle.includes('皇帝') || 
        char.primaryTitle.includes('天子') ||
        char.primaryTitle.includes('陛下')
      )) {
        this.currentEmperor = char.shortName;
        this.currentEmperorTitle = char.primaryTitle;
        break;
      }
    }
    
    // 如果找到了玩家是皇帝
    const player = this.getPlayer();
    if (player && player.primaryTitle && (
      player.primaryTitle.includes('皇帝') || 
      player.primaryTitle.includes('天子')
    )) {
      this.currentEmperor = player.shortName;
      this.currentEmperorTitle = player.primaryTitle;
    }
    
    // 年号通常在primaryTitle中，尝试提取
    // 例如："宋淳祐皇帝" -> "淳祐"
    if (this.currentEmperorTitle) {
      const eraMatch = this.currentEmperorTitle.match(/宋(.+?)皇帝/);
      if (eraMatch) {
        this.currentEraName = eraMatch[1];
      }
    }
  }
  
  getPlayer() {
    return this.characters.get(this.playerID);
  }
  /**
   * 
   * @return {Character} ai
   */
  getAi() {
    return this.characters.get(this.aiID);
  }
  // Helper function to generate safe folder/file names
  sanitizeFileName(name) {
    // Remove or replace characters that are invalid in filenames
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
  }
  getCharacterPersonalName(characterId, fallbackName = "") {
    const character = this.characters?.get(Number(characterId)) || { id: characterId, shortName: fallbackName };
    return memorySystem.getCharacterPersonalName(character, fallbackName);
  }
  
  // Helper function to get character folder path
  // IMPORTANT: Use character ID + short name (pure name without titles)
  // This ensures the same person always uses the same folder, even when titles change
  // Example: "62984_赵光义" (stable) instead of "宋淳祐皇帝，赵光义" (changes with title)
  getCharacterFolderPath(characterId, characterName) {
    const character = this.characters?.get(Number(characterId)) || { id: characterId, shortName: characterName };
    const folderName = memorySystem.getCharacterStorageDirectoryName(character, characterName);
    return path.join(VOTC_SUMMARIES_DIR, folderName);
  }
  
  // Helper function to get summary file path for a conversation
  getConversationFilePath(fromCharId, fromCharName, toCharId, toCharName) {
    const fromFolder = this.getCharacterFolderPath(fromCharId, fromCharName);
    const toName = this.sanitizeFileName(this.getCharacterPersonalName(toCharId, toCharName));
    const fileName = `与${toName}的对话.json`;
    return path.join(fromFolder, fileName);
  }
  
  /**
   * Load all conversation summaries for a character from their folder
   * This allows the character to remember conversations with other people
   */
  loadAllConversationsForCharacter(character) {
    const characterFolder = this.getCharacterFolderPath(character.id, character.shortName);
    
    // Initialize array to store all summaries from different conversations
    if (!character.allConversationSummaries) {
      character.allConversationSummaries = [];
    }
    
    try {
      if (!fs$1.existsSync(characterFolder)) {
        return;
      }
      
      // Read all conversation files in the character's folder
      const files = fs$1.readdirSync(characterFolder).filter(f => f.endsWith('.json'));
      
      for (const file of files) {
        const filePath = path.join(characterFolder, file);
        try {
          const fileContent = fs$1.readFileSync(filePath, 'utf8');
          const summaries = JSON.parse(fileContent);
          
          if (Array.isArray(summaries) && summaries.length > 0) {
            // Extract the other character's name from filename: "与XXX的对话.json"
            const match = file.match(/^与(.+)的对话\.json$/);
            const otherCharacterName = match ? match[1] : '未知角色';
            
            // Add recent summaries (last 5 from each conversation).
            const recentSummaries = summaries.slice(0, 5).map(s => ({
              ...s,
              conversationWith: otherCharacterName,
              sourceFile: file
            }));
            
            character.allConversationSummaries.push(...recentSummaries);
          }
        } catch (error) {
          console.error(`Failed to load summaries from ${filePath}:`, error);
        }
      }
      
      // Sort all summaries by date (most recent first)
      character.allConversationSummaries.sort((a, b) => {
        if (a.totalDays && b.totalDays) {
          return b.totalDays - a.totalDays;
        }
        return b.date.localeCompare(a.date);
      });
      
      // Keep only the most recent 5 summaries across all conversations
      character.allConversationSummaries = character.allConversationSummaries.slice(0, 5);
      
    } catch (error) {
      console.error(`Failed to load all conversations for character ${character.shortName}:`, error);
    }
  }
  
  /**
   * Dynamically load specific conversation summaries when mentioned in dialogue
   * Only loads summaries for characters mentioned by name in the conversation
   * @param {Character} character - The character whose memory to load
   * @param {string} mentionedCharacterName - Name of the character mentioned in conversation
   * @returns {Array} Array of summaries for the mentioned conversation
   */
  loadConversationWithMentionedCharacter(character, mentionedCharacterName) {
    const characterFolder = this.getCharacterFolderPath(character.id, character.shortName);
    
    // Initialize cache if not exists (use separate property for per-conversation cache)
    if (!character.conversationCache) {
      character.conversationCache = new Map();
    }
    
    // Return cached memory if already loaded
    if (character.conversationCache.has(mentionedCharacterName)) {
      return character.conversationCache.get(mentionedCharacterName);
    }
    
    try {
      if (!fs$1.existsSync(characterFolder)) {
        return [];
      }
      
      // Sanitize the mentioned character name for filename matching
      const sanitizedName = this.sanitizeFileName(mentionedCharacterName);
      const conversationFile = `与${sanitizedName}的对话.json`;
      const filePath = path.join(characterFolder, conversationFile);
      
      if (fs$1.existsSync(filePath)) {
        const fileContent = fs$1.readFileSync(filePath, 'utf8');
        const summaries = JSON.parse(fileContent);
        
        if (Array.isArray(summaries) && summaries.length > 0) {
          // Take the 5 most recent summaries for a directly mentioned person.
          const recentSummaries = summaries.slice(0, 5).map(s => ({
            ...s,
            conversationWith: mentionedCharacterName,
            sourceFile: conversationFile,
            dynamicallyLoaded: true
          }));
          
          // Cache the loaded summaries
          character.conversationCache.set(mentionedCharacterName, recentSummaries);
          
          console.log(`Dynamically loaded ${recentSummaries.length} summaries: ${character.shortName} ↔ ${mentionedCharacterName}`);
          
          return recentSummaries;
        }
      }
    } catch (error) {
      console.error(`Failed to dynamically load conversation ${character.shortName} ↔ ${mentionedCharacterName}:`, error);
    }
    
    return [];
  }
  
  /**
   * Detect mentioned character names in conversation history and load their memories
   * 
   * PERFORMANCE OPTIMIZATION (v5.1):
   * - Caches detection results to avoid re-scanning history
   * - Only re-scans when new player messages are added
   * 
   * @param {Array} history - Conversation history
   * @param {Character} character - The AI character
   * @returns {Array} Dynamically loaded summaries for mentioned characters
   */
  loadDynamicMemoriesFromHistory(history, character) {
    const dynamicMemories = [];
    
    // Performance optimization: Only check if history has at least 1 message
    if (!history || history.length === 0) {
      return dynamicMemories;
    }
    
    // Cache and scan the latest player messages, not merely the last array
    // entries. In a multi-NPC turn the player's line is quickly followed by
    // several assistant replies and would otherwise fall out of the window.
    const recentPlayerMessages = history.filter((m) => m.role === "user").slice(-3);
    const cacheKey = recentPlayerMessages.map(m => m.content || '').join('|');
    
    // Check if we've already processed this exact set of messages
    if (character.dynamicMemoryCache && character.dynamicMemoryCache.key === cacheKey) {
      console.log(`[Performance] Using cached dynamic memories (no new player messages)`);
      
      // Still need to update mentionedCharactersInContext for character info
      if (character.dynamicMemoryCache.mentionedCharacterIds) {
        if (!this.mentionedCharactersInContext) {
          this.mentionedCharactersInContext = new Set();
        }
        const mentionableProfiles = this.getMentionableCharacterProfiles();
        for (const id of character.dynamicMemoryCache.mentionedCharacterIds) {
          if (mentionableProfiles.has(id)) this.mentionedCharactersInContext.add(id);
        }
      }
      if (character.dynamicMemoryCache.mentionedNames) {
        if (!this.mentionedCharactersInContext) {
          this.mentionedCharactersInContext = new Set();
        }
        for (const name of character.dynamicMemoryCache.mentionedNames) {
          const char = this.getCharacterByName(name);
          if (char) {
            this.mentionedCharactersInContext.add(char.id);
          }
        }
      }
      
      return character.dynamicMemoryCache.memories || [];
    }
    
    console.log(`[Performance] Scanning for mentioned characters (new player messages detected)`);
    
    // CRITICAL FIX: Only get names of characters who have conversation files
    // Don't iterate through ALL characters in the game (could be hundreds!)
    // Check BOTH character's folder AND player's folder for conversation files
    const characterFolder = this.getCharacterFolderPath(character.id, character.shortName);
    const player = this.characters.get(this.playerID);
    const playerFolder = player ? this.getCharacterFolderPath(this.playerID, player.shortName) : null;
    
    let relevantCharacterNames = new Set();
    
    try {
      // 1. Check character's folder (AI's conversations)
      if (fs$1.existsSync(characterFolder)) {
        const files = fs$1.readdirSync(characterFolder).filter(f => f.endsWith('.json'));
        files.forEach(file => {
          const match = file.match(/^与(.+)的对话\.json$/);
          if (match) relevantCharacterNames.add(match[1]);
        });
      }
      
      // 2. Check player's folder (Player's conversations)
      if (playerFolder && fs$1.existsSync(playerFolder)) {
        const files = fs$1.readdirSync(playerFolder).filter(f => f.endsWith('.json'));
        files.forEach(file => {
          const match = file.match(/^与(.+)的对话\.json$/);
          if (match) relevantCharacterNames.add(match[1]);
        });
      }
      
      // Convert Set to Array
      relevantCharacterNames = Array.from(relevantCharacterNames);
      
      console.log(`[Performance] Only checking ${relevantCharacterNames.length} characters with conversation history (instead of all ${this.characters.size} characters)`);
    } catch (error) {
      console.error('Failed to read character folders:', error);
      return dynamicMemories;
    }
    
    // If no relevant characters found, cache and return early
    if (relevantCharacterNames.length === 0) {
      // No conversation memories are available, but a mentioned third person
      // can still have useful CK3 family/relationship data.
      const mentionedCharacterIds = this.findMentionedCharacterIdsInHistory(history, character);
      if (!this.mentionedCharactersInContext) {
        this.mentionedCharactersInContext = new Set();
      }
      for (const id of mentionedCharacterIds) {
        this.mentionedCharactersInContext.add(id);
      }
      if (!character.dynamicMemoryCache) {
        character.dynamicMemoryCache = {};
      }
      character.dynamicMemoryCache = {
        key: cacheKey,
        memories: [],
        mentionedNames: [],
        mentionedCharacterIds: Array.from(mentionedCharacterIds)
      };
      return dynamicMemories;
    }
    
    // Check the latest player messages. This keeps third-party mentions
    // available to every NPC responding in the same turn.
    const recentMessages = recentPlayerMessages;
    const mentionedCharacters = new Set();
    
    for (const message of recentMessages) {
      if (!message.content) continue;
      
      // Performance optimization: Only check player messages (not AI responses)
      if (message.role !== 'user') continue;
      
      // Check if any relevant character name is mentioned
      for (const charName of relevantCharacterNames) {
        if (message.content.includes(charName)) {
          mentionedCharacters.add(charName);
        }
      }
    }
    
    // Load summaries for each mentioned character
    // Try loading from BOTH character's folder AND player's folder
    if (mentionedCharacters.size > 0) {
      console.log(`Detected mentioned characters: ${Array.from(mentionedCharacters).join(', ')}`);
      
      for (const mentionedName of mentionedCharacters) {
        // Try loading from character's folder first
        let summaries = this.loadConversationWithMentionedCharacter(character, mentionedName);
        
        if (summaries.length > 0) {
          dynamicMemories.push(...summaries);
        }
        
        // 【新增】标记提到的角色为"上下文相关"
        // 这样在构建prompt时，可以包含这些角色的完整信息
        const mentionedChar = this.getCharacterByName(mentionedName);
        if (mentionedChar) {
          if (!this.mentionedCharactersInContext) {
            this.mentionedCharactersInContext = new Set();
          }
          this.mentionedCharactersInContext.add(mentionedChar.id);
          console.log(`Marked character ${mentionedName} (ID: ${mentionedChar.id}) as contextually relevant`);
        }
      }
    }
    
    // PERFORMANCE: Cache the result
    // Relationship context must not depend on whether this third character has
    // an existing conversation-summary file. Memories stay selectively loaded
    // above, while game-data relationships are detected from all loaded CK3
    // characters here.
    const mentionedCharacterIds = this.findMentionedCharacterIdsInHistory(history, character);
    if (!this.mentionedCharactersInContext) {
      this.mentionedCharactersInContext = new Set();
    }
    for (const id of mentionedCharacterIds) {
      this.mentionedCharactersInContext.add(id);
    }
    if (!character.dynamicMemoryCache) {
      character.dynamicMemoryCache = {};
    }
    character.dynamicMemoryCache = {
      key: cacheKey,
      memories: dynamicMemories,
      mentionedNames: Array.from(mentionedCharacters),
      mentionedCharacterIds: Array.from(mentionedCharacterIds)
    };
    
    return dynamicMemories;
  }
  
  loadCharactersSummaries() {
    // 更新当前皇帝信息（从游戏角色中获取实际的当前皇帝）
    this.updateCurrentEmperorInfo();
    
    const player = this.characters.get(this.playerID);
    const playerName = player ? player.shortName : null;
    
    for (const character of this.characters.values()) {
      // Skip loading summaries for the player character itself
      if (character.id === this.playerID) continue;
      
      // Load summaries from player's perspective (A ↔ B conversation)
      const summaryFile = this.getConversationFilePath(
        this.playerID,
        playerName,
        character.id,
        character.shortName
      );
      
      character.loadSummaries(summaryFile);
      
      // ❌ 不再自动加载所有跨角色对话
      // 改为：只在对话中提到其他角色时动态加载
      // this.loadAllConversationsForCharacter(character);
      
      // Initialize dynamic memory caches
      // conversationCache: Map for caching individual conversations
      // dynamicMemoryCache: Object for caching scan results
      if (!character.conversationCache) {
        character.conversationCache = new Map();
      }
      if (!character.dynamicMemoryCache) {
        character.dynamicMemoryCache = {};
      }
    }
    
    // Initialize mentioned characters tracking
    this.mentionedCharactersInContext = new Set();
  }
  
  /**
   * 通过名字查找角色（支持shortName和fullName）
   * @param {string} name - 角色名字
   * @returns {Character|null} - 找到的角色或null
   */
  getCharacterByName(name) {
    for (const char of this.characters.values()) {
      if (char.fullName === name || char.shortName === name || char.firstName === name) {
        return char;
      }
    }
    return null;
  }
  /**
   * Build lightweight profiles for both active participants and their directly
   * logged parents, children, and siblings. Relatives do not become speakers or
   * action targets; their profiles are used only for mentioned-person context.
   */
  getMentionableCharacterProfiles() {
    const profiles = /* @__PURE__ */ new Map(this.characters);
    const addRelative = (entry) => {
      const id = Number(entry?.id);
      if (!Number.isFinite(id) || profiles.has(id) || !entry?.name) return;
      const birthDateTotalDays = Number(entry.birthDateTotalDays);
      const age = Number.isFinite(birthDateTotalDays) && Number.isFinite(this.totalDays) ? Math.max(0, Math.floor((this.totalDays - birthDateTotalDays) / 365.2425)) : null;
      const gender = entry.gender || (entry.sheHe ? inferGenderFromPronoun(entry.sheHe) : "unknown");
      profiles.set(id, {
        id,
        shortName: entry.name,
        fullName: entry.name,
        firstName: entry.name,
        age,
        gender,
        primaryTitle: "",
        traits: Array.isArray(entry.traits) ? entry.traits : [],
        relationsToCharacters: [],
        relationsToPlayer: [],
        parents: [],
        children: [],
        siblings: [],
        consort: "",
        liege: "",
        isMentionedRelativeProfile: true
      });
    };
    for (const participant of this.characters.values()) {
      for (const parent of participant.parents || []) addRelative(parent);
      for (const child of participant.children || []) addRelative(child);
      for (const sibling of participant.siblings || []) addRelative(sibling);
    }
    const addRelationAliases = (characterId, aliases) => {
      const profile = profiles.get(Number(characterId));
      if (!profile) return;
      profile.mentionAliases = [...new Set([...(profile.mentionAliases || []), ...aliases])];
    };
    for (const participant of this.characters.values()) {
      for (const parent of participant.parents || []) {
        const gender = parent.gender || (parent.sheHe ? inferGenderFromPronoun(parent.sheHe) : "unknown");
        addRelationAliases(parent.id, gender === "male" ? ["令尊", "家父", "父亲"] : gender === "female" ? ["令堂", "家母", "母亲"] : ["父母"]);
      }
      for (const sibling of participant.siblings || []) {
        const siblingAge = Number.isFinite(Number(sibling.birthDateTotalDays)) && Number.isFinite(this.totalDays)
          ? Math.max(0, Math.floor((this.totalDays - Number(sibling.birthDateTotalDays)) / 365.2425))
          : null;
        const gender = sibling.gender || (sibling.sheHe ? inferGenderFromPronoun(sibling.sheHe) : "unknown");
        if (Number.isFinite(siblingAge) && Number.isFinite(participant.age) && siblingAge > participant.age) {
          addRelationAliases(sibling.id, gender === "male" ? ["家兄", "兄长"] : gender === "female" ? ["家姐", "姐姐"] : ["年长手足"]);
        }
      }
    }
    return profiles;
  }
  /**
   * Find third-party characters mentioned by any speaker. This intentionally
   * scans active CK3 characters and their directly logged relatives instead of
   * only summary-file names: relationship data exists even when nobody has
   * previously talked to the mentioned person.
   */
  getMentionExclusionIds(activeParticipantIds = null) {
    const participantIds = Array.isArray(activeParticipantIds) ? activeParticipantIds : [...this.characters.keys()];
    return [...new Set([this.playerID, ...participantIds].map(Number).filter(Number.isFinite))];
  }
  findMentionedCharacterIdsInHistory(history, activeCharacter, excludedCharacterIds = null) {
    if (!Array.isArray(history) || history.length === 0) return /* @__PURE__ */ new Set();
    const exclusions = this.getMentionExclusionIds(
      Array.isArray(excludedCharacterIds) ? [activeCharacter?.id, ...excludedCharacterIds] : null
    );
    return new Set(memoryEngine.findMentionedCharactersInHistory({
      history,
      candidates: [...this.getMentionableCharacterProfiles().values()],
      excludedIds: exclusions
    }));
  }
  findFamilyEntry(entries, characterId) {
    return Array.isArray(entries) ? entries.find((entry) => entry?.id === characterId) : void 0;
  }
  /** Return a precise sibling title for subject relative to other. */
  getSiblingRelation(subject, other) {
    const subjectSiblingEntry = this.findFamilyEntry(subject?.siblings, other?.id);
    const otherSiblingEntry = this.findFamilyEntry(other?.siblings, subject?.id);
    if (!subjectSiblingEntry && !otherSiblingEntry) return null;
    const subjectBirth = Number(otherSiblingEntry?.birthDateTotalDays);
    const otherBirth = Number(subjectSiblingEntry?.birthDateTotalDays);
    let subjectIsOlder = null;
    if (Number.isFinite(subjectBirth) && Number.isFinite(otherBirth) && subjectBirth !== otherBirth) {
      subjectIsOlder = subjectBirth < otherBirth;
    } else if (Number.isFinite(subject?.age) && Number.isFinite(other?.age) && subject.age !== other.age) {
      subjectIsOlder = subject.age > other.age;
    }
    if (subjectIsOlder === null) return "同胞手足（长幼不详）";
    if (subject?.gender === "male") return subjectIsOlder ? "哥哥" : "弟弟";
    if (subject?.gender === "female") return subjectIsOlder ? "姐姐" : "妹妹";
    return subjectIsOlder ? "年长的手足" : "年幼的手足";
  }
  /**
   * Describe subject's relationship to other using parsed family data first.
   * CK3's plain relation string often only says "brother", so siblings are
   * resolved with birth date (and age as a fallback) before using that string.
   */
  describeCharacterRelationship(subject, other) {
    if (!subject || !other || subject.id === other.id) return null;
    const siblingRelation = this.getSiblingRelation(subject, other);
    if (siblingRelation) return `${subject.fullName}是${other.fullName}的${siblingRelation}`;
    const subjectIsChild = !!this.findFamilyEntry(subject.parents, other.id) || !!this.findFamilyEntry(other.children, subject.id);
    if (subjectIsChild) {
      const label = subject.gender === "male" ? "儿子" : subject.gender === "female" ? "女儿" : "子女";
      return `${subject.fullName}是${other.fullName}的${label}`;
    }
    const subjectIsParent = !!this.findFamilyEntry(subject.children, other.id) || !!this.findFamilyEntry(other.parents, subject.id);
    if (subjectIsParent) {
      const label = subject.gender === "male" ? "父亲" : subject.gender === "female" ? "母亲" : "父母";
      return `${subject.fullName}是${other.fullName}的${label}`;
    }
    const direct = subject.relationsToCharacters?.find((relation) => relation.id === other.id)?.relations || [];
    if (direct.length > 0) return `${subject.fullName}与${other.fullName}的游戏关系：${direct.join("、")}`;
    if (other.id === this.playerID && subject.relationsToPlayer?.length > 0) {
      return `${subject.fullName}与${other.fullName}的游戏关系：${subject.relationsToPlayer.join("、")}`;
    }
    const reverse = other.relationsToCharacters?.find((relation) => relation.id === subject.id)?.relations || [];
    if (reverse.length > 0) return `${other.fullName}与${subject.fullName}的游戏关系：${reverse.join("、")}`;
    return null;
  }
  /**
   * The age-resolved sibling wording was previously emitted only for a third
   * character mentioned in the dialogue. The active pair therefore still saw
   * CK3's ambiguous raw `brother` / `sister` relation in the main prompt.
  */
  getActiveParticipantRelationshipInfo(activeCharacter, counterpartIds = []) {
    if (!activeCharacter) return "";
    const counterpartIdSet = /* @__PURE__ */ new Set([this.playerID, ...counterpartIds]);
    counterpartIdSet.delete(activeCharacter.id);
    const relations = [];
    for (const counterpartId of counterpartIdSet) {
      const counterpart = this.characters.get(counterpartId);
      if (!counterpart) continue;
      const activeToCounterpart = this.describeCharacterRelationship(activeCharacter, counterpart);
      const counterpartToActive = this.describeCharacterRelationship(counterpart, activeCharacter);
      if (activeToCounterpart) relations.push(activeToCounterpart);
      if (counterpartToActive) relations.push(counterpartToActive);
    }
    if (relations.length === 0) return "";
    return `=== 当前回应角色与亲属/对话对象的精确关系（高优先级游戏数据） ===\n${relations.map((relation) => `- ${relation}`).join("\n")}\n称谓必须服从上述关系与长幼：不得把哥哥称为弟弟、把姐姐称为妹妹，也不得仅因 CK3 的原始 brother/sister 标签而忽略出生日期或年龄。`;
  }
  
  /**
   * 获取提到的角色的详细信息（用于添加到prompt上下文）
   * @returns {string} - 格式化的角色信息字符串
   */
  getMentionedCharactersInfo(activeCharacter) {
    if (!this.mentionedCharactersInContext || this.mentionedCharactersInContext.size === 0) {
      return '';
    }
    
    const player = this.characters.get(this.playerID);
    const dialoguePartner = activeCharacter || this.characters.get(this.aiID);
    const mentionableProfiles = this.getMentionableCharacterProfiles();
    
    let info = '\n=== 对话中提到的其他角色信息 ===\n\n';
    
    for (const charId of this.mentionedCharactersInContext) {
      const char = mentionableProfiles.get(charId);
      if (!char || charId === this.playerID || charId === dialoguePartner?.id) continue;
      
      info += `【${char.fullName}】\n`;
      if (Number.isFinite(char.age)) info += `- 年龄：${char.age}岁\n`;
      info += `- 性别：${char.gender === 'male' ? '男性' : char.gender === 'female' ? '女性' : '未知'}\n`;
      
      if (char.primaryTitle) {
        info += `- 头衔：${char.primaryTitle}\n`;
      }
      
      // 特质（最多显示5个）
      if (char.traits && char.traits.length > 0) {
        const traitNames = char.traits.slice(0, 5).map(t => t.name).join('、');
        info += `- 性格特质：${traitNames}\n`;
      }
      
      // With both participants. Do not assume GameData.aiID is the current
      // responder: one conversation can generate replies for several NPCs.
      if (player) {
        const relation = this.describeCharacterRelationship(char, player);
        if (relation) info += `- 与${player.fullName}的关系：${relation}\n`;
      }
      
      if (dialoguePartner && dialoguePartner.id !== this.playerID) {
        const relation = this.describeCharacterRelationship(char, dialoguePartner);
        if (relation) info += `- 与${dialoguePartner.fullName}的关系：${relation}\n`;
      }
      
      // 配偶
      if (char.consort) {
        info += `- 配偶：${char.consort}\n`;
      }
      
      // 领主
      if (char.liege) {
        info += `- 领主：${char.liege}\n`;
      }
      
      info += '\n';
    }
    
    console.log(`Built mentioned characters info for ${this.mentionedCharactersInContext.size} character(s)`);
    return info;
  }
  
  saveCharacterSummary(characterId, summary) {
    const target = this.characters.get(characterId);
    if (!target) return;
    
    const player = this.characters.get(this.playerID);
    const playerName = player ? player.shortName : null;
    
    const summaryWithMetadata = {
      ...summary,
      characterName: target.shortName,
      playerName: playerName || `角色 ${this.playerID}`,
      playerId: this.playerID,
      characterId: characterId
    };
    
    target.conversationSummaries.unshift(summaryWithMetadata);
    
    // Save to BOTH character folders for memory sharing
    // 1. Save to player's folder (player's perspective of conversation with target)
    const playerFile = this.getConversationFilePath(
      this.playerID,
      playerName,
      characterId,
      target.shortName
    );
    fs$1.mkdirSync(path.dirname(playerFile), { recursive: true });
    target.saveSummaries(playerFile);
    
    // 2. Save to target character's folder (target's perspective of conversation with player)
    // Need to swap the perspective in metadata
    const targetFile = this.getConversationFilePath(
      characterId,
      target.shortName,
      this.playerID,
      playerName
    );
    fs$1.mkdirSync(path.dirname(targetFile), { recursive: true });
    
    // Create a swapped version for target's perspective
    const swappedSummaries = target.conversationSummaries.map(s => ({
      ...s,
      playerName: s.characterName,
      characterName: s.playerName,
      playerId: s.characterId,
      characterId: s.playerId
    }));
    
    fs$1.writeFileSync(targetFile, JSON.stringify(swappedSummaries, null, "\t"));
  }
  
  readConversationSummariesFile(filePath) {
    try {
      if (!fs$1.existsSync(filePath)) return [];
      const parsed = JSON.parse(fs$1.readFileSync(filePath, "utf8"));
      return Array.isArray(parsed) ? parsed.map((summary) => memorySystem.normalizeSummaryRecord(summary)) : [];
    } catch (error) {
      console.error(`[Summary] Failed to read ${filePath}; existing file was left untouched:`, error);
      return null;
    }
  }
  writeConversationSummariesFile(filePath, summaries) {
    fs$1.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs$1.writeFileSync(tempPath, JSON.stringify(summaries, null, "\t"), "utf8");
    fs$1.renameSync(tempPath, filePath);
  }
  saveSummaryForDirectedPair(owner, other, finalSummary, participantMetadata, options = {}) {
    const filePath = this.getConversationFilePath(owner.id, owner.shortName, other.id, other.shortName);
    const ownerName = this.getCharacterPersonalName(owner.id, owner.shortName);
    const otherName = this.getCharacterPersonalName(other.id, other.shortName);
    fs$1.mkdirSync(path.dirname(filePath), { recursive: true });
    const summaries = this.readConversationSummariesFile(filePath);
    if (!summaries) throw new Error(`summary_file_read_failed:${filePath}`);
    const projectionKey = `${Number(owner.id)}->${Number(other.id)}`;
    const projection = options.directedSummaries instanceof Map
      ? options.directedSummaries.get(projectionKey)
      : options.directedSummaries?.[projectionKey];
    if (options.directedSummaries && !projection) throw new Error(`missing_directed_summary_projection:${projectionKey}`);
    const directedContent = projection?.content || finalSummary;
    const alreadySaved = summaries.some((summary) => options.finalizationId ? summary.finalizationId === options.finalizationId : summary.totalDays === this.totalDays && summary.content === directedContent && summary.playerId === owner.id && summary.characterId === other.id);
    if (!alreadySaved) {
      summaries.unshift({
        schemaVersion: memorySystem.CURRENT_SUMMARY_SCHEMA_VERSION,
        date: this.date,
        totalDays: this.totalDays,
        content: directedContent,
        playerName: ownerName,
        playerId: owner.id,
        characterName: otherName,
        characterId: other.id,
        conversationType: participantMetadata.length > 2 ? "group" : "pair",
        participants: participantMetadata,
        finalizationId: options.finalizationId || null,
        engineVersion: projection ? "2.3" : "2.2",
        perspectiveOwnerId: projection?.ownerId ?? owner.id,
        perspectiveMemoryIds: projection?.memoryIds || [],
        projectionHash: projection?.projectionHash || null,
        presenceJoins: Array.isArray(options.presenceJoins) ? options.presenceJoins : [],
        presenceLeaves: Array.isArray(options.presenceLeaves) ? options.presenceLeaves : [],
        pinned: projection?.pinned === true,
        open: projection?.open === true
      });
      this.writeConversationSummariesFile(filePath, summaries);
    }
    return summaries;
  }
  /**
   * Save one generated summary to every directed participant pair. This keeps
   * A↔B compatibility while adding A↔C, B↔C, and all other group pair files
   * without making extra LLM summary requests.
   */
  saveCharactersSummaries(finalSummary, participantIds = null, options = {}) {
    const excludedOwnerIds = new Set((options.excludedOwnerIds || []).map(Number).filter(Number.isFinite));
    const requestedIds = Array.isArray(participantIds) ? participantIds : Array.from(this.characters.keys());
    const participants = memorySystem.resolveSummaryParticipants({
      playerId: this.playerID,
      participantIds: requestedIds,
      currentCharacters: this.characters,
      participantProfiles: options.participantProfiles
    });
    if (participants.length < 2) {
      return { success: false, error: "insufficient_summary_participants", participantCount: participants.length };
    }
    const participantMetadata = participants.map((character) => ({
      id: character.id,
      name: this.getCharacterPersonalName(character.id, character.shortName),
      firstName: character.firstName,
      shortName: this.getCharacterPersonalName(character.id, character.shortName),
      fullName: character.fullName,
      primaryTitle: character.primaryTitle,
      heldCourtAndCouncilPositions: character.heldCourtAndCouncilPositions,
      titleRankConcept: character.titleRankConcept
    }));
    const directedPairs = memorySystem.buildDirectedParticipantPairs(participants, excludedOwnerIds);
    for (const { owner, counterpart } of directedPairs) {
      const summaries = this.saveSummaryForDirectedPair(owner, counterpart, finalSummary, participantMetadata, options);
      // Keep the in-memory compatibility field synchronized for extensions;
      // Engine 2.2 reads the canonical owner folders directly for prompts.
      if (owner.id === this.playerID) counterpart.conversationSummaries = summaries;
    }
    const verification = memorySystem.verifyDirectedSummaryPersistence({
      directedPairs,
      finalizationId: options.finalizationId,
      requirePerspective: options.directedSummaries instanceof Map,
      getFilePath: (owner, counterpart) => this.getConversationFilePath(owner.id, owner.shortName, counterpart.id, counterpart.shortName),
      readSummaries: (filePath) => this.readConversationSummariesFile(filePath)
    });
    if (!verification.success) {
      throw new Error(`${verification.error}:${verification.missingPairs.map((pair) => `${pair.ownerId}->${pair.counterpartId}`).join(",")}`);
    }
    const directedFilesWritten = directedPairs.length;
    console.log(`[Summary] Saved finalization ${options.finalizationId || "untracked"} for ${participants.length} participants across ${directedFilesWritten} directed pair files`);
    return { success: true, participantCount: participants.length, directedFilesWritten };
  }
}
function removeTooltip$1(text) {
  return text.replace(/<.*?>.*?<\/.*?>/gi, "").trim();
}
function inferGenderFromPronoun(value) {
  const text = removeTooltip$1(String(value ?? "")).trim().toLowerCase();
  const maleValues = /* @__PURE__ */ new Set(["he", "him", "his", "male", "man", "m", "他", "男", "男性", "男人", "il", "er", "el", "él", "on", "он", "его", "彼", "그"]);
  const femaleValues = /* @__PURE__ */ new Set(["she", "her", "hers", "female", "woman", "f", "她", "女", "女性", "女人", "elle", "sie", "ella", "ona", "она", "ее", "её", "彼女", "그녀"]);
  if (maleValues.has(text)) return "male";
  if (femaleValues.has(text)) return "female";
  return "unknown";
}
class Character {
  constructor(data) {
    this.conversationSummaries = [];
    const ageText = String(data[5] ?? "").replace(/<[^>]*>/g, "").trim();
    const parsedAge = Number(ageText);
    this.id = Number(data[0]), this.shortName = data[1], this.fullName = data[2], this.primaryTitle = String(data[3] ?? "").replace(/<[^>]*>/g, "").trim(), this.sheHe = data[4], this.gender = inferGenderFromPronoun(data[4]), this.age = Number.isFinite(parsedAge) ? Math.floor(parsedAge) : Number.parseInt(ageText.match(/\d+/)?.[0] || "", 10), this.gold = Math.floor(Number(data[6])), this.opinionOfPlayer = Number(data[7]), this.sexuality = removeTooltip$1(data[8]), this.personality = data[9], this.greed = Number(data[10]), this.boldness = 0, this.compassion = 0, this.energy = 0, this.honor = 0, this.rationality = 0, this.sociability = 0, this.vengefulness = 0, this.zeal = 0, this.isIndependentRuler = !!Number(data[11]), this.liege = data[12], this.consort = data[13], this.culture = data[14], this.faith = data[15], this.house = data[16], this.isRuler = !!Number(data[17]), this.firstName = data[18], this.capitalLocation = data[19], this.topLiege = data[20], this.prowess = Number(data[21]), this.isKnight = !!Number(data[22]), this.liegeRealmLaw = data[23], this.isLandedRuler = !!Number(data[24]), this.heldCourtAndCouncilPositions = data[25], this.titleRankConcept = data[26], this.secrets = [], this.knownSecrets = [], this.modifiers = [], this.laws = [], this.memories = [], this.traits = [], this.relationsToPlayer = [], this.relationsToCharacters = [], this.opinionBreakdowns = [], this.opinions = [], this.parents = [], this.children = [], this.siblings = [];
  }
  /**
   * Check if the character has a trait with a given name.
   * @param name - the name of the trait
   * @return {boolean} 
   */
  hasTrait(name) {
    return this.traits.some((trait) => trait.name.toLowerCase() == name.toLowerCase());
  }
  /**
   * Append a new trait to the character.
   * @param {Trait }trait
   * @returns {void} 
   */
  addTrait(trait) {
    this.traits.push(trait);
  }
  removeTrait(name) {
    this.traits.filter((trait) => {
      return trait.name.toLowerCase() !== name.toLowerCase();
    });
  }
  /**
   * Get the opinion breakdown to a specific character
   * @param {number} targetId - the ID of the target character
   * @returns {OpinionModifier[]} - array of opinion modifiers, or empty array if not found
   */
  getOpinionBreakdownTo(targetId) {
    const breakdown = this.opinionBreakdowns.find((ob) => ob.id === targetId);
    return breakdown ? breakdown.breakdown : [];
  }
  /**
   * Get the value of the opinion modifier with the given reason text towards a specific character
   * @param {number} targetId - the ID of the target character
   * @param {string} reason - the opinion modifier's reason text
   * @returns {number} - opinion modifier's value. returns 0 if doesn't exist.
   */
  getOpinionModifierValue(targetId, reason) {
    const breakdown = this.getOpinionBreakdownTo(targetId);
    let target = breakdown.find((modifier) => modifier.reason === reason);
    if (target !== void 0) {
      return target.value;
    } else {
      return 0;
    }
  }
  /**
   * Sets the opinion modifier's value towards a specific character. Creates a new opinion modifier if it doesn't exist.
   * @param {number} targetId - the ID of the target character
   * @param {string} reason - The opinion modifier's reason text.
   * @param {number} value - The value to set the opinion modifier.
   * @returns {void}
   */
  setOpinionModifierValue(targetId, reason, value) {
    let breakdownEntry = this.opinionBreakdowns.find((ob) => ob.id === targetId);
    if (!breakdownEntry) {
      breakdownEntry = { id: targetId, breakdown: [] };
      this.opinionBreakdowns.push(breakdownEntry);
    }
    let targetIndex = breakdownEntry.breakdown.findIndex((om) => {
      return om.reason.toLowerCase() == reason.toLowerCase();
    });
    if (targetIndex != -1) {
      breakdownEntry.breakdown[targetIndex].value = value;
    } else {
      breakdownEntry.breakdown.push({
        reason,
        value
      });
    }
  }
  saveSummaries(summariesPath) {
    fs$1.writeFileSync(summariesPath, JSON.stringify(this.conversationSummaries, null, "	"));
  }
  loadSummaries(summariesPath) {
    if (fs$1.existsSync(summariesPath)) {
      this.conversationSummaries = JSON.parse(fs$1.readFileSync(summariesPath, "utf8"));
    }
  }
}
const fs = require("fs");
const readline = require("readline");
async function parseLog(debugLogPath) {
  console.log(`parseLog: Processing debug log at path: ${debugLogPath}`);
  let gameData;
  let multiLineTempStorage = [];
  let isWaitingForMultiLine = false;
  let multiLineType = "";
  let currentRootID = 0;
  let currentTargetID = 0;
  let currentSecret = null;
  let currentKnownSecret = null;
  let currentTroops = null;
  let currentChild = null;
  let currentSibling = null;
  const fileStream = fs.createReadStream(debugLogPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    if (isWaitingForMultiLine) {
      let value = line.split("#")[0];
      switch (multiLineType) {
        case "new_relations":
          value = removeTooltip(value);
          multiLineTempStorage.push(value);
          break;
        case "relations":
          multiLineTempStorage.push(removeTooltip(value));
          break;
        case "opinionBreakdown":
          multiLineTempStorage.push(parseOpinionModifier(value));
          break;
        case "income":
        case "treasury":
        case "influence":
        case "herd":
          multiLineTempStorage.push(removeTooltip(value));
          break;
      }
      if (line.includes("#ENDMULTILINE")) {
        const fullContent = multiLineTempStorage.join("\n");
        if (multiLineType === "income" && gameData.characters.get(currentRootID).income) {
          gameData.characters.get(currentRootID).income.balanceBreakdown = fullContent;
        } else if (multiLineType === "treasury" && gameData.characters.get(currentRootID).treasury) {
          gameData.characters.get(currentRootID).treasury.tooltip = fullContent;
        } else if (multiLineType === "influence" && gameData.characters.get(currentRootID).influence) {
          gameData.characters.get(currentRootID).influence.tooltip = fullContent;
        } else if (multiLineType === "herd" && gameData.characters.get(currentRootID).herd) {
          gameData.characters.get(currentRootID).herd.breakdown = fullContent;
        }
        isWaitingForMultiLine = false;
      }
      continue;
    }
    if (line.includes("VOTC:LETTER") && !line.includes("delay") && !line.includes("set to thread")) {
      if (gameData) {
        const parts = line.split("/;/").slice(1).map(removeTooltip);
        let letterData = null;
        letterData = {
          content: parts[0],
          letterId: parts[1],
          totalDays: Number(parts[2]),
          delay: Number(parts[3])
        };
        if (letterData) {
          gameData.letterData = letterData;
        }
      }
      continue;
    }
    if (line.includes("VOTC:IN")) {
      let data = line.split("/;/");
      const dataType = data[1];
      data.splice(0, 2);
      const rootID = Number(data[0]);
      currentRootID = rootID;
      for (let i = 0; i < data.length; i++) {
        data[i] = removeTooltip(data[i]);
      }
      switch (dataType) {
        case "init":
          gameData = new GameData(data);
          break;
        case "character":
          let char = new Character(data);
          gameData.characters.set(char.id, char);
          break;
        case "memory":
          let memory = parseMemory(data);
          gameData.characters.get(rootID).memories.push(memory);
          break;
        case "secret":
          currentSecret = parseSecretStart(data);
          break;
        case "secret_is_criminal":
          if (currentSecret) currentSecret.isCriminal = true;
          break;
        case "secret_is_shunned":
          if (currentSecret) currentSecret.isShunned = true;
          break;
        case "secret_target":
          if (currentSecret) {
            currentSecret.target = {
              id: Number(data[1]),
              name: data[2]
            };
          }
          break;
        case "secret_knower":
          if (currentSecret) {
            if (!currentSecret.knowers) currentSecret.knowers = [];
            currentSecret.knowers.push({
              id: Number(data[2]),
              name: data[3],
              isSpent: false,
              canBeExposed: false
            });
          }
          break;
        case "secret_spent":
          if (currentSecret && currentSecret.knowers && currentSecret.knowers.length > 0) {
            const lastKnower = currentSecret.knowers[currentSecret.knowers.length - 1];
            lastKnower.isSpent = data[1] === "yes";
          }
          break;
        case "secret_can_be_exposed":
          if (currentSecret && currentSecret.knowers && currentSecret.knowers.length > 0) {
            const lastKnower = currentSecret.knowers[currentSecret.knowers.length - 1];
            lastKnower.canBeExposed = data[1] === "yes";
          }
          break;
        case "secret_eob":
          if (currentSecret) {
            const secret = {
              name: currentSecret.name || "",
              desc: currentSecret.desc || "",
              category: currentSecret.category || "",
              type: currentSecret.type || "",
              isCriminal: currentSecret.isCriminal || false,
              isShunned: currentSecret.isShunned || false,
              target: currentSecret.target,
              knowers: currentSecret.knowers || []
            };
            gameData.characters.get(rootID).secrets.push(secret);
            currentSecret = null;
          }
          break;
        case "k_secret":
          currentKnownSecret = parseKnownSecretStart(data);
          break;
        case "k_secret_owner":
          if (currentKnownSecret) {
            currentKnownSecret.ownerId = Number(data[1]);
            currentKnownSecret.ownerName = data[2];
          }
          break;
        case "k_secret_is_criminal":
          if (currentKnownSecret) currentKnownSecret.isCriminal = true;
          break;
        case "k_secret_is_shunned":
          if (currentKnownSecret) currentKnownSecret.isShunned = true;
          break;
        case "k_secret_target":
          if (currentKnownSecret) {
            currentKnownSecret.target = {
              id: Number(data[1]),
              name: data[2]
            };
          }
          break;
        case "k_secret_spent":
          if (currentKnownSecret) {
            currentKnownSecret.isSpent = data[1] === "yes";
          }
          break;
        case "k_secret_can_be_exposed":
          if (currentKnownSecret) {
            currentKnownSecret.canBeExposed = data[1] === "yes";
          }
          break;
        case "k_secret_knower":
          if (currentKnownSecret) {
            if (!currentKnownSecret.knowers) currentKnownSecret.knowers = [];
            currentKnownSecret.knowers.push({
              id: Number(data[2]),
              name: data[3],
              isSpent: false,
              // Not applicable for known secrets
              canBeExposed: false
              // Not applicable for known secrets
            });
          }
          break;
        case "k_secret_eob":
          if (currentKnownSecret) {
            const knownSecret = {
              name: currentKnownSecret.name || "",
              desc: currentKnownSecret.desc || "",
              category: currentKnownSecret.category || "",
              type: currentKnownSecret.type || "",
              ownerId: currentKnownSecret.ownerId || 0,
              ownerName: currentKnownSecret.ownerName || "",
              isCriminal: currentKnownSecret.isCriminal || false,
              isShunned: currentKnownSecret.isShunned || false,
              target: currentKnownSecret.target,
              isSpent: currentKnownSecret.isSpent || false,
              canBeExposed: currentKnownSecret.canBeExposed || false,
              knowers: currentKnownSecret.knowers || []
            };
            gameData.characters.get(rootID).knownSecrets.push(knownSecret);
            currentKnownSecret = null;
          }
          break;
        case "modifier":
          const modifier = {
            id: data[1],
            name: data[2],
            description: data[3]
          };
          gameData.characters.get(rootID).modifiers.push(modifier);
          break;
        case "stress":
          const stress = {
            value: Number(data[1]),
            level: Number(data[2]),
            progress: Number(data[3])
          };
          gameData.characters.get(rootID).stress = stress;
          break;
        case "legitimacy":
          if (data[1] === "no") {
            gameData.characters.get(rootID).legitimacy = void 0;
          } else {
            const legitimacy = {
              value: Number(data[1]),
              level: Number(data[2]),
              type: data[3],
              avgPowerfulVassalExpectation: Number(data[4]),
              avgVassalExpectation: Number(data[5]),
              liegeExpectation: Number(data[6])
            };
            gameData.characters.get(rootID).legitimacy = legitimacy;
          }
          break;
        case "levies_vassals":
          if (!currentTroops) {
            currentTroops = {
              leviesVassals: 0,
              leviesDomain: [],
              leviesTheocratic: 0,
              maaRegiments: []
            };
          }
          currentTroops.leviesVassals = Number(data[1]);
          break;
        case "levies_dom":
          if (!currentTroops) {
            currentTroops = {
              leviesVassals: 0,
              leviesDomain: [],
              leviesTheocratic: 0,
              maaRegiments: []
            };
          }
          if (!currentTroops.leviesDomain) {
            currentTroops.leviesDomain = [];
          }
          currentTroops.leviesDomain.push(Number(data[1]));
          break;
        case "levies_theo":
          if (!currentTroops) {
            currentTroops = {
              leviesVassals: 0,
              leviesDomain: [],
              leviesTheocratic: 0,
              maaRegiments: []
            };
          }
          currentTroops.leviesTheocratic = Number(data[1]);
          break;
        case "maa":
          if (!currentTroops) {
            currentTroops = {
              leviesVassals: 0,
              leviesDomain: [],
              leviesTheocratic: 0,
              maaRegiments: []
            };
          }
          if (!currentTroops.maaRegiments) {
            currentTroops.maaRegiments = [];
          }
          const regiment = {
            name: data[1],
            isPersonal: data[2] === "1",
            menAlive: Number(data[3])
          };
          currentTroops.maaRegiments.push(regiment);
          break;
        case "laws":
          if (data[1] === "") {
            break;
          }
          const law = {
            name: data[1]
          };
          gameData.characters.get(rootID).laws.push(law);
          break;
        case "troops_eob":
          if (currentTroops) {
            const leviesDomainSum = (currentTroops.leviesDomain || []).reduce((sum, val) => sum + val, 0);
            const personalMAATotal = (currentTroops.maaRegiments || []).filter((regiment2) => regiment2.isPersonal).reduce((sum, regiment2) => sum + regiment2.menAlive, 0);
            const totalOwnedTroops = leviesDomainSum + (currentTroops.leviesTheocratic || 0) + personalMAATotal;
            const troops = {
              leviesVassals: currentTroops.leviesVassals || 0,
              leviesDomain: currentTroops.leviesDomain || [],
              leviesDomainSum,
              leviesTheocratic: currentTroops.leviesTheocratic || 0,
              maaRegiments: currentTroops.maaRegiments || [],
              totalOwnedTroops
            };
            gameData.characters.get(rootID).troops = troops;
            currentTroops = null;
          }
          break;
        case "income":
          if (line.split("#")[1] !== "") {
            const income = {
              gold: Number(data[1]),
              balance: Number(data[2]),
              balanceBreakdown: removeTooltip(line.split("#")[1])
            };
            gameData.characters.get(rootID).income = income;
          }
          if (!line.includes("#ENDMULTILINE")) {
            multiLineTempStorage = [gameData.characters.get(rootID).income.balanceBreakdown];
            isWaitingForMultiLine = true;
            multiLineType = "income";
          }
          break;
        case "treasury":
          if (line.split("#")[1] !== "") {
            const treasury = {
              amount: Number(data[1]),
              tooltip: removeTooltip(line.split("#")[1])
            };
            gameData.characters.get(rootID).treasury = treasury;
          }
          if (!line.includes("#ENDMULTILINE")) {
            multiLineTempStorage = [gameData.characters.get(rootID).treasury.tooltip];
            isWaitingForMultiLine = true;
            multiLineType = "treasury";
          }
          break;
        case "influence":
          if (line.split("#")[1] !== "") {
            const influence = {
              amount: Number(data[1]),
              tooltip: removeTooltip(line.split("#")[1])
            };
            gameData.characters.get(rootID).influence = influence;
          }
          if (!line.includes("#ENDMULTILINE")) {
            multiLineTempStorage = [gameData.characters.get(rootID).influence.tooltip];
            isWaitingForMultiLine = true;
            multiLineType = "influence";
          }
          break;
        case "herd":
          if (line.split("#")[1] !== "") {
            const herd = {
              amount: Number(data[1]),
              breakdown: removeTooltip(line.split("#")[1])
            };
            gameData.characters.get(rootID).herd = herd;
          }
          if (!line.includes("#ENDMULTILINE")) {
            multiLineTempStorage = [gameData.characters.get(rootID).herd.breakdown];
            isWaitingForMultiLine = true;
            multiLineType = "herd";
          }
          break;
        case "trait":
          gameData.characters.get(rootID).traits.push(parseTrait(data));
          break;
        case "opinions":
          gameData.characters.get(rootID).opinions.push({ id: Number(data[1]), opinon: Number(data[2]) });
          break;
        case "relations":
          if (line.split("#")[1] !== "") {
            gameData.characters.get(rootID).relationsToPlayer = [removeTooltip(line.split("#")[1])];
          }
          if (!line.includes("#ENDMULTILINE")) {
            multiLineTempStorage = gameData.characters.get(rootID).relationsToPlayer;
            isWaitingForMultiLine = true;
            multiLineType = "relations";
          }
          break;
        case "new_relations": {
          const tmpTargetId = Number(data[1]);
          const ch = gameData.characters.get(rootID);
          if (!ch || Number.isNaN(tmpTargetId)) break;
          const relObj = { id: tmpTargetId, relations: [] };
          ch.relationsToCharacters.push(relObj);
          const firstChunk = line.split("#")[1] ?? "";
          const cleaned = removeTooltip(firstChunk).trim();
          if (cleaned) relObj.relations.push(cleaned);
          if (!line.includes("#ENDMULTILINE")) {
            multiLineTempStorage = relObj.relations;
            isWaitingForMultiLine = true;
            multiLineType = "new_relations";
          }
          break;
        }
        case "opinionBreakdown":
          currentTargetID = Number(data[1]);
          let breakdownEntry = gameData.characters.get(rootID).opinionBreakdowns.find((ob) => ob.id === currentTargetID);
          if (!breakdownEntry) {
            breakdownEntry = { id: currentTargetID, breakdown: [] };
            gameData.characters.get(rootID).opinionBreakdowns.push(breakdownEntry);
          }
          if (line.split("#")[1] !== "") {
            breakdownEntry.breakdown = [parseOpinionModifier(line.split("#")[1])];
          }
          if (!line.includes("#ENDMULTILINE")) {
            multiLineTempStorage = breakdownEntry.breakdown;
            isWaitingForMultiLine = true;
            multiLineType = "opinionBreakdown";
          }
          break;
        case "parents":
          const parent = {
            id: Number(data[1]),
            name: data[2],
            birthDateTotalDays: Number(data[3]),
            birthDate: data[4]
          };
          gameData.characters.get(rootID).parents.push(parent);
          break;
        case "parent_death":
          const parentId = Number(data[1]);
          const parentToUpdate = gameData.characters.get(rootID).parents.find((p) => p.id === parentId);
          if (parentToUpdate) {
            parentToUpdate.deathDateTotalDays = Number(data[2]);
            parentToUpdate.deathDate = data[3];
            parentToUpdate.deathReason = data[4];
          }
          break;
        case "kids":
          currentChild = {
            id: Number(data[1]),
            name: data[2],
            sheHe: data[3],
            gender: inferGenderFromPronoun(data[3]),
            birthDateTotalDays: Number(data[4]),
            birthDate: data[5],
            traits: [],
            maritalStatus: "unmarried",
            concubines: [],
            spouses: []
          };
          gameData.characters.get(rootID).children.push(currentChild);
          break;
        case "kid_other_parent":
          if (currentChild) {
            currentChild.otherParent = {
              id: Number(data[2]),
              name: data[3]
            };
          }
          break;
        case "kid_trait":
          if (currentChild && currentChild.traits) {
            currentChild.traits.push({
              category: data[2],
              name: data[3],
              desc: data[4]
            });
          }
          break;
        case "kid_is_concubine":
          if (currentChild) {
            currentChild.maritalStatus = "concubine";
            currentChild.concubineOf = {
              id: Number(data[2]),
              name: data[3]
            };
          }
          break;
        case "kid_concubine":
          if (currentChild) {
            currentChild.maritalStatus = "has_concubines";
            if (!currentChild.concubines) currentChild.concubines = [];
            currentChild.concubines.push({
              id: Number(data[2]),
              name: data[3]
            });
          }
          break;
        case "kid_spouse":
          if (currentChild) {
            currentChild.maritalStatus = "has_spouses";
            if (!currentChild.spouses) currentChild.spouses = [];
            currentChild.spouses.push({
              id: Number(data[2]),
              name: data[3]
            });
          }
          break;
        case "kid_betrothed":
          if (currentChild) {
            currentChild.maritalStatus = "betrothed";
            currentChild.betrothed = {
              id: Number(data[2]),
              name: data[3]
            };
          }
          break;
        case "kid_unmarried":
          if (currentChild) {
            currentChild.maritalStatus = "unmarried";
          }
          break;
        case "kid_death":
          if (currentChild) {
            currentChild.deathDateTotalDays = Number(data[2]);
            currentChild.deathDate = data[3];
            currentChild.deathReason = data[4];
          }
          break;
        case "kid_eob":
          currentChild = null;
          break;
        case "siblings":
          currentSibling = {
            id: Number(data[1]),
            name: data[2],
            sheHe: data[3],
            gender: inferGenderFromPronoun(data[3]),
            birthDateTotalDays: Number(data[4]),
            birthDate: data[5],
            traits: [],
            maritalStatus: "unmarried",
            concubines: [],
            spouses: []
          };
          gameData.characters.get(rootID).siblings.push(currentSibling);
          break;
        case "sibling_other_parent":
          if (currentSibling) {
            currentSibling.otherParent = {
              id: Number(data[2]),
              name: data[3]
            };
          }
          break;
        case "sibling_trait":
          if (currentSibling && currentSibling.traits) {
            currentSibling.traits.push({
              category: data[2],
              name: data[3],
              desc: data[4]
            });
          }
          break;
        case "sibling_is_concubine":
          if (currentSibling) {
            currentSibling.maritalStatus = "concubine";
            currentSibling.concubineOf = {
              id: Number(data[2]),
              name: data[3]
            };
          }
          break;
        case "sibling_concubine":
          if (currentSibling) {
            currentSibling.maritalStatus = "has_concubines";
            if (!currentSibling.concubines) currentSibling.concubines = [];
            currentSibling.concubines.push({
              id: Number(data[2]),
              name: data[3]
            });
          }
          break;
        case "sibling_spouse":
          if (currentSibling) {
            currentSibling.maritalStatus = "has_spouses";
            if (!currentSibling.spouses) currentSibling.spouses = [];
            currentSibling.spouses.push({
              id: Number(data[2]),
              name: data[3]
            });
          }
          break;
        case "sibling_betrothed":
          if (currentSibling) {
            currentSibling.maritalStatus = "betrothed";
            currentSibling.betrothed = {
              id: Number(data[2]),
              name: data[3]
            };
          }
          break;
        case "sibling_unmarried":
          if (currentSibling) {
            currentSibling.maritalStatus = "unmarried";
          }
          break;
        case "sibling_death":
          if (currentSibling) {
            currentSibling.deathDateTotalDays = Number(data[2]);
            currentSibling.deathDate = data[3];
            currentSibling.deathReason = data[4];
          }
          break;
        case "sibling_eob":
          currentSibling = null;
          break;
        case "persona_numbers":
          const character = gameData.characters.get(rootID);
          if (character) {
            character.boldness = Number(data[1]);
            character.compassion = Number(data[2]);
            character.energy = Number(data[3]);
            character.greed = Number(data[4]);
            character.honor = Number(data[5]);
            character.rationality = Number(data[6]);
            character.sociability = Number(data[7]);
            character.vengefulness = Number(data[8]);
            character.zeal = Number(data[9]);
          }
          break;
      }
    }
  }
  function parseMemory(data) {
    const memory = {
      type: data[1],
      creationDate: data[2],
      desc: data[3],
      relevanceWeight: Number(data[4]),
      creationDateTotalDays: Number(data[5])
    };
    return memory;
  }
  function parseSecretStart(data) {
    return {
      name: data[1],
      desc: data[2],
      category: data[3],
      type: data[4] || "",
      isCriminal: false,
      isShunned: false,
      knowers: []
    };
  }
  function parseKnownSecretStart(data) {
    return {
      name: data[1],
      desc: data[2],
      category: data[3],
      type: data[4] || "",
      isCriminal: false,
      isShunned: false,
      isSpent: false,
      canBeExposed: false,
      knowers: []
    };
  }
  function parseTrait(data) {
    return {
      category: data[1],
      name: data[2],
      desc: data[3]
    };
  }
  function parseOpinionModifier(line) {
    line = line.replace(/ *\([^)]*\) */g, "");
    let splits = line.split(": ");
    for (let i = 0; i < splits.length; i++) {
      splits[i] = removeTooltip(splits[i]);
    }
    return {
      reason: splits[0],
      value: Number(splits[1])
    };
  }
  console.log(gameData);
  return gameData;
}
function removeTooltip(str) {
  let newWords = [];
  str.split(" ").forEach((word) => {
    if (word.includes("")) {
      newWords.push(word.split("")[0]);
    } else {
      newWords.push(word);
    }
  });
  return newWords.join(" ").replace(/ +(?= )/g, "").trim();
}
async function cleanLogFile(filePath) {
  const fileContent = await fs.promises.readFile(filePath, "utf-8");
  const lines = fileContent.split("\n");
  const stringsToRemove = [
    "Running console command",
    "console_failure: Effect is empty. Check error log",
    "console_success: Executing effect",
    "Trying to trigger an animation with glow_alpha for a widget which has no glow",
    "No sound alias named 'river_node' configured! Please check you sound alias database"
  ];
  const cleaned = lines.filter((line) => {
    return !stringsToRemove.some((str) => line.includes(str));
  });
  await fs.promises.writeFile(filePath, cleaned.join("\n"), "utf-8");
}
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
class PromptScriptSandbox {
  /**
   * Execute a description script (pList) in a sandboxed VM context
   * Expected to return a string
   */
  static executeDescription(scriptFilePath, context) {
    const scriptCode = fs__namespace.readFileSync(scriptFilePath, "utf-8");
    const sandbox = this.createBaseSandbox();
    sandbox.gameData = context.gameData;
    sandbox.currentCharacterId = context.currentCharacterId;
    const result = this.executeScript(scriptFilePath, scriptCode, sandbox, "description");
    return result;
  }
  /**
   * Execute an example script (aliChat) in a sandboxed VM context
   * Expected to return an array of message objects
   */
  static executeExamples(scriptFilePath, context) {
    const scriptCode = fs__namespace.readFileSync(scriptFilePath, "utf-8");
    const sandbox = this.createBaseSandbox();
    sandbox.gameData = context.gameData;
    sandbox.currentCharacterId = context.currentCharacterId;
    const result = this.executeScript(scriptFilePath, scriptCode, sandbox, "examples");
    return Array.isArray(result) ? result : [];
  }
  /**
   * Execute a helper script in a sandboxed VM context
   * Helper scripts register Handlebars helpers
   */
  static executeHelper(scriptFilePath, Handlebars2) {
    const scriptCode = fs__namespace.readFileSync(scriptFilePath, "utf-8");
    const sandbox = this.createBaseSandbox();
    sandbox.Handlebars = Handlebars2;
    this.executeScript(scriptFilePath, scriptCode, sandbox, "helper");
  }
  /**
   * Create the base sandbox with safe globals
   */
  static createBaseSandbox() {
    return scriptSandbox.createSandbox();
  }
  /**
   * Execute script in VM context with appropriate wrapper
   * Synchronous execution for compatibility with existing API
   */
  static executeScript(filePath, scriptCode, sandbox, scriptType) {
    const wrapperCode = `
      (function() {
        // Create a module-like structure for CommonJS style exports
        const module = { exports: {} };
        const exports = module.exports;
        
        // Execute the script code to populate module.exports
        ${scriptCode}
        
        // Get the exported function (support both module.exports and default export)
        const exportedFn = module.exports && module.exports.default 
          ? module.exports.default 
          : module.exports;
        
        if (typeof exportedFn !== 'function') {
          throw new Error('Script must export a function');
        }
        
        // Execute based on script type
        ${this.getExecutionCode(scriptType)}
      })();
    `;
    try {
      const result = scriptSandbox.runScript(wrapperCode, { filename: filePath, sandbox });
      if (scriptType === "description" && typeof result !== "string") {
        throw new Error(`Description script must return a string, got ${typeof result}`);
      }
      if (scriptType === "examples" && !Array.isArray(result)) {
        throw new Error(`Example script must return an array, got ${typeof result}`);
      }
      return result;
    } catch (error) {
      console.error("[PromptScriptSandbox] Execution error:", error);
      throw new Error(`Script execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /**
   * Get the execution code based on script type
   */
  static getExecutionCode(scriptType) {
    switch (scriptType) {
      case "description":
      case "examples":
        return `
          const result = exportedFn(gameData, currentCharacterId);
          return result;
        `;
      case "helper":
        return `
          exportedFn(Handlebars);
          return undefined;
        `;
    }
  }
}
class TemplateEngine {
  constructor() {
    this.helpersRegistered = false;
  }
  ensureHelpers() {
    if (this.helpersRegistered) return;
    Handlebars.registerHelper("gt", (a, b) => a > b);
    Handlebars.registerHelper("lt", (a, b) => a < b);
    Handlebars.registerHelper("eq", (a, b) => a === b);
    Handlebars.registerHelper("ageDescription", (age) => {
      if (age < 3) return "infant";
      if (age < 6) return "small child";
      if (age < 10) return "child";
      if (age < 13) return "preteen";
      if (age < 16) return "adolescent";
      if (age < 20) return "young adult";
      if (age < 30) return "adult";
      if (age < 40) return "experienced adult";
      if (age < 60) return "seasoned adult";
      return "elder";
    });
    Handlebars.registerHelper("opinionLevel", (opinion) => {
      if (opinion > 60) return "very favorable";
      if (opinion > 20) return "positive";
      if (opinion > -20) return "neutral";
      if (opinion > -60) return "negative";
      return "hostile";
    });
    Handlebars.registerHelper("prowessDescription", (prowess) => {
      if (prowess >= 15) return "formidable warrior";
      if (prowess >= 10) return "skilled combatant";
      if (prowess >= 5) return "trained fighter";
      if (prowess > 0) return "inexperienced fighter";
      return "non-combatant";
    });
    Handlebars.registerHelper("goldStatus", (gold) => {
      if (gold >= 500) return "wealthy";
      if (gold > 100) return "comfortable";
      if (gold > 50) return "poor";
      if (gold > 0) return "struggling";
      if (gold === 0) return "broke";
      return "in debt";
    });
    Handlebars.registerHelper("filterTraits", (traits, category) => {
      if (!Array.isArray(traits)) return [];
      return traits.filter((t) => t.category === category);
    });
    Handlebars.registerHelper("otherCharacters", (characters, currentId) => {
      if (!characters || typeof characters.values !== "function") return [];
      return Array.from(characters.values()).filter((c) => c.id !== currentId);
    });
    Handlebars.registerHelper("formatRelations", (relations) => {
      if (!relations || relations.length === 0) return "";
      return relations.join(", ");
    });
    this.loadCustomHelpers();
    this.helpersRegistered = true;
  }
  renderTemplate(templatePath, context) {
    this.ensureHelpers();
    const resolved = path.resolve(templatePath);
    const content = fs$1.readFileSync(resolved, "utf-8");
    return this.renderTemplateString(content, context);
  }
  renderTemplateString(content, context) {
    this.ensureHelpers();
    const template = Handlebars.compile(content);
    const rootContext = {
      ...context.character || {},
      character: context.character,
      gameData: context.gameData,
      description: context.description,
      examples: context.examples,
      ...context
    };
    return template(rootContext, {
      allowProtoPropertiesByDefault: true,
      allowProtoMethodsByDefault: true
    });
  }
  /**
   * Validate a Handlebars template string without rendering it.
   * Returns validation result with error details if invalid.
   */
  static validateTemplate(templateString) {
    try {
      Handlebars.precompile(templateString);
      return { valid: true };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      const lineMatch = errorMsg.match(/on line (\d+)/);
      const columnMatch = errorMsg.match(/column (\d+)/);
      return {
        valid: false,
        error: errorMsg,
        line: lineMatch ? parseInt(lineMatch[1]) : void 0,
        column: columnMatch ? parseInt(columnMatch[1]) : void 0
      };
    }
  }
  loadCustomHelpers() {
    const defaultHelpersDir = path.join(electron.app.getAppPath(), "default_userdata", "prompts", "helpers");
    const userHelpersDir = VOTC_PROMPTS_HELPERS_DIR;
    const loadHelpersFromDir = (helpersDir) => {
      if (!fs$1.existsSync(helpersDir)) return;
      const helperFiles = fs$1.readdirSync(helpersDir).filter((file) => file.endsWith(".js"));
      for (const file of helperFiles) {
        try {
          const helperPath = path.join(helpersDir, file);
          PromptScriptSandbox.executeHelper(helperPath, Handlebars);
        } catch (error) {
          console.error(`Failed to load helper ${file}:`, error);
        }
      }
    };
    loadHelpersFromDir(defaultHelpersDir);
    loadHelpersFromDir(userHelpersDir);
  }
}
class PromptScriptLoader {
  resolve(scriptPath) {
    return path.resolve(scriptPath);
  }
  executeDescription(scriptPath, gameData, currentCharacterId) {
    const resolved = this.resolve(scriptPath);
    if (!fs$1.existsSync(resolved)) {
      throw new Error(`Prompt script not found: ${resolved}`);
    }
    return PromptScriptSandbox.executeDescription(resolved, { gameData, currentCharacterId });
  }
  executeExamples(scriptPath, gameData, currentCharacterId) {
    const resolved = this.resolve(scriptPath);
    if (!fs$1.existsSync(resolved)) {
      throw new Error(`Prompt script not found: ${resolved}`);
    }
    return PromptScriptSandbox.executeExamples(resolved, { gameData, currentCharacterId });
  }
}
class PromptBuilder {
  static {
    this.templateEngine = new TemplateEngine();
  }
  static {
    this.scriptLoader = new PromptScriptLoader();
  }
  static buildSummaryCacheAnchor() {
    return `VOTC_SUMMARY_CACHE_ANCHOR_v1
You summarize CK3 roleplay records. Preserve concrete names, relationships, dates, places, amounts, decisions, promises, conflicts, emotional changes and unresolved plans that appear in the supplied material. Do not invent facts, merge different people, add later historical knowledge, or turn a proposal into a completed event. Follow the requested language and format. Output only the requested summary.`;
  }
  static prepareSummaryMessages(messages) {
    const prepared = Array.isArray(messages) ? messages.map((message) => ({ ...message })) : [];
    const alreadyAnchored = prepared.some((message) => typeof message.content === "string" && message.content.startsWith("VOTC_SUMMARY_CACHE_ANCHOR_"));
    if (!alreadyAnchored) prepared.unshift({ role: "system", content: this.buildSummaryCacheAnchor() });
    return prepared;
  }
  static getSummaryPromptBlocks(messages, requestType = "summary") {
    return messages.map((message, index) => {
      const content = typeof message.content === "string" ? message.content : "";
      let label = "Summary Dynamic Context";
      let type = "summary_dynamic";
      if (content.startsWith("VOTC_SUMMARY_CACHE_ANCHOR_")) {
        label = "Stable Summary Cache Anchor";
        type = "summary_cache_anchor";
      } else if (content.startsWith("Stable rolling-summary instructions:")) {
        label = "Stable Rolling Summary Instructions";
        type = "summary_stable";
      } else if (content.startsWith("Stable final-summary instructions:")) {
        label = "Stable Final Summary Instructions";
        type = "summary_stable";
      } else if (content.startsWith("Stable letter-summary instructions:")) {
        label = "Stable Letter Summary Instructions";
        type = "summary_stable";
      } else if (content.startsWith("Stable leaving-summary instructions:")) {
        label = "Stable Leaving Summary Instructions";
        type = "summary_stable";
      } else if (content.startsWith("Previous summary") || content.startsWith("此对话的先前摘要：")) {
        label = "Previous Summary";
      } else if (content.startsWith("New messages") || content.startsWith("完整对话：") || content.startsWith("最近的对话：") || content.startsWith("Full conversation:")) {
        label = "Summary Conversation Content";
      } else if (content.startsWith("Conversation participants:")) {
        label = "Summary Participant Context";
      } else if (content.startsWith("Dynamic leaving character:")) {
        label = "Leaving Character Context";
      } else if (message.role === "user" && index === messages.length - 1) {
        label = "Summary Generation Request";
      }
      return {
        id: `${requestType}-${index}`,
        label,
        type,
        position: index,
        tokens: TokenCounter.estimateMessageTokens(message),
        fingerprint: createPromptFingerprint(content)
      };
    });
  }
  /**
  * Build prompt for resummarization
  */
  static buildResummarizePrompt(messagesToSummarize, existingSummary) {
    const summarySettings = settingsRepository.getSummaryPromptSettings();
    const prompt = [{
      role: "system",
      content: `Stable rolling-summary instructions:\n${summarySettings.rollingPrompt}`
    }];
    if (existingSummary) {
      prompt.push({
        role: "system",
        content: `Previous summary of this conversation:

${existingSummary}`
      });
    }
    prompt.push({
      role: "system",
      content: "New messages to incorporate into the summary:\n\n" + messagesToSummarize.map((m) => `${m.name}: ${m.content}`).join("\n")
    });
    prompt.push({
      role: "user",
      content: "Generate the updated rolling summary now."
    });
    return prompt;
  }
  static getFinalSummaryInstructions() {
    return settingsRepository.getSummaryPromptSettings().finalPrompt;
  }
  /**
   * Generate a system prompt based on the characters in the conversation
   */
  static generateSystemPrompt(char, gameData) {
    const promptSettings = settingsRepository.getPromptSettings();
    const templatePath = promptConfigManager.resolvePath(promptSettings.defaultMainTemplatePath);
    if (gameData.characters.size === 0 || !char) {
      console.log("No characters or main character missing for system prompt");
      return "You are characters in a medieval strategy game. Engage in conversation naturally.";
    }
    try {
      const rendered = this.templateEngine.renderTemplate(templatePath, {
        character: char,
        gameData
      });
      return rendered;
    } catch (error) {
      console.error("Failed to render system template, using fallback:", error);
    }
    return "You are characters in a medieval strategy game. Engage in conversation naturally.";
  }
  static buildMessages(history, char, gameData, currentSessionSummary, memoryContext = null) {
    // Keep context-length checks and actual requests byte-for-byte aligned.
    // The token-counting builder owns cache-aware ordering and still returns
    // the same message data used by this legacy convenience method.
    return this.buildMessagesWithTokenCount(history, char, gameData, currentSessionSummary, memoryContext).messages;
  }
  /**
   * Character-description scripts can be customized or disabled. Keep exact
   * responder facts close to history so direct factual questions use CK3 data.
   */
  static buildResponderGameFacts(char) {
    if (!char) return null;
    const age = Number(char.age);
    const primaryTitle = typeof char.primaryTitle === "string" ? char.primaryTitle.trim() : "";
    const title = primaryTitle && !["None", "None of", "None von", "None de"].includes(primaryTitle) ? primaryTitle : "无主要头衔";
    const courtPosition = typeof char.heldCourtAndCouncilPositions === "string" && char.heldCourtAndCouncilPositions.trim() ? char.heldCourtAndCouncilPositions.trim() : "无";
    const titleRank = typeof char.titleRankConcept === "string" && char.titleRankConcept !== "concept_none" ? char.titleRankConcept : "无";
    return `=== 当前回应角色的权威游戏资料（本轮 CK3 数据） ===
- 游戏姓名／称号：${char.fullName || char.shortName || "未知"}
- 姓名：${char.shortName || char.firstName || "未知"}
- 年龄：${Number.isFinite(age) ? `${Math.floor(age)}岁` : "游戏未提供"}
- 主要头衔：${title}
- 宫廷／议会职位：${courtPosition}
- 头衔等级：${titleRank}
当被问及自己的姓名、称号、头衔、官职或年龄时，必须逐项以以上本轮游戏数据直接回答；不得根据历史、对话记忆或常识猜测，也不得用年龄阶段替代具体岁数。`;
  }
  /**
   * Stable, character-independent prefix for providers with prefix KV caching.
   * Keep this before all character-specific prompt blocks. It deliberately does
   * not include conversation history or memory, so the existing memory/history
   * behavior remains unchanged.
   */
  static buildCacheAnchor(gameData) {
    return `VOTC_CACHE_ANCHOR_v3
这是 Voices of the Court 的固定系统上下文锚点。请将后续内容视为当前游戏的动态上下文，并始终遵守以下稳定规则：保持角色扮演身份；优先使用游戏实际数据；不把现代价值观强加给中世纪角色；涉及历史人物、事件、作品、诗词、典故、制度或技术时，先核验其出现、发生、写成、成名或流传时间是否不晚于游戏当前年份；年份不确定时明确表示不知晓，不得猜测或用未来知识补全；不得预知未来、后世评价或事件结局。角色回复不设固定句数、段落数或人为短回复目标，应按人物性格、关系、情绪和场景完整表达，但避免无意义重复。长期稳定记忆和当前话题记忆只代表过去知情背景，本轮事实与动作必须以当前对话消息及游戏实时数据为准。不要把本段当作对话内容，也不要复述本段。`;
  }
  /**
  * Build the stable portion of a character's past conversation summaries.
  * Third-party memories and relationship data are deliberately built by
  * buildMentionedCharactersContext() and placed near conversation history, so
  * changing the mentioned person does not invalidate this earlier cache prefix.
  *
  * @param {Character} char - The character
  * @param {GameData} gameData - The game data
  */
  static buildPastSummariesContext(char, gameData) {
    if (!char.conversationSummaries || char.conversationSummaries.length === 0) {
      return null;
    }
    
    let context = `以下是 ${char.shortName}、${gameData.playerName} 及其他角色之间最近的对话摘要：

`;
    
    const recentSummaries = char.conversationSummaries.slice(0, 5);
    for (const summary of recentSummaries) {
      const absoluteDate = summary.date || "日期不详";
      context += `${absoluteDate}：${summary.content}
`;
    }
    
    return context;
  }
  /**
   * Build volatile third-party memory and relationship context. The content is
   * unchanged in meaning, but is emitted immediately before conversation
   * history rather than inside the earlier stable summaries block.
   */
  static buildMentionedCharactersContext(char, gameData, history = null) {
    if (!history || history.length === 0) return null;
    const mentionedCharacterIds = gameData.findMentionedCharacterIdsInHistory(history, char);
    if (!gameData.mentionedCharactersInContext) gameData.mentionedCharactersInContext = /* @__PURE__ */ new Set();
    for (const characterId of mentionedCharacterIds) {
      gameData.mentionedCharactersInContext.add(characterId);
    }
    let context = "";
    const mentionedCharsInfo = gameData.getMentionedCharactersInfo(char);
    if (mentionedCharsInfo) context += mentionedCharsInfo;
    return context.trim() ? context : null;
  }
  /**
   * Build a final, comprehensive summary using all roleplay messages.
   */
  static buildFinalSummary(gameData, history, currentSummary, lastSummarizedMessageIndex) {
    const characters = Array.from(gameData.characters.values()).map((c) => c.shortName).join("、");
    const summarySettings = settingsRepository.getSummaryPromptSettings();
    const stableInstructions = {
      role: "system",
      content: `Stable final-summary instructions:\n${summarySettings.finalPrompt}`
    };
    const baseSystem = {
      role: "system",
      content: `Conversation participants: ${characters}. This is a medieval roleplay conversation.`
    };
    const buildConversationText = (msgs, title) => ({
      role: "system",
      content: `${title}
` + msgs.map((m) => `${m.name}：${m.content}`).join("\n")
    });
    const userPrompt = {
      role: "user",
      content: "Generate the final conversation summary now."
    };
    if (lastSummarizedMessageIndex == null) {
      return [
        stableInstructions,
        baseSystem,
        buildConversationText(history, "完整对话："),
        userPrompt
      ];
    }
    const newMessages = history.slice(lastSummarizedMessageIndex);
    return [
      stableInstructions,
      baseSystem,
      { role: "system", content: "此对话的先前摘要：\n" + currentSummary },
      buildConversationText(newMessages, "最近的对话："),
      userPrompt
    ];
  }
  /**
   * Calculate relative time between dates
   */
  static getRelativeTime(pastDateTotalDays, currentDateTotalDays) {
    if (pastDateTotalDays === void 0) {
      return null;
    }
    const timeDifference = currentDateTotalDays - pastDateTotalDays;
    if (timeDifference < 1) {
      return "不到一天前";
    }
    if (timeDifference < 7) {
      return `${timeDifference}天前`;
    }
    if (timeDifference < 30) {
      return `${Math.floor(timeDifference / 7)}周前`;
    }
    if (timeDifference < 365) {
      return `${Math.floor(timeDifference / 30)}个月前`;
    }
    return `${Math.floor(timeDifference / 365)}年前`;
  }
  static buildMemoriesBlock(gameData, character, limit = 5, template, context = {}) {
    const allMemories = Array.isArray(character?.memories) ? [...character.memories] : [];
    if (allMemories.length === 0) return null;
    const sorted = allMemories.sort((a, b) => (b.relevanceWeight ?? 0) - (a.relevanceWeight ?? 0));
    const selected = sorted.slice(0, limit);
    const tpl = template || "相关记忆：\n{{#each memories}}- {{this.creationDate}}：{{this.desc}}\n{{/each}}";
    return this.templateEngine.renderTemplateString(tpl, { ...context, memories: selected });
  }
  /**
   * Split the bundled main template into cache-aware system messages. Custom
   * templates without VOTC_SEGMENT markers remain a single backwards-compatible
   * main block. Markers are Handlebars comments, so they are harmless in the
   * prompt editor and in older builds.
   */
  static splitMainTemplateSegments(template) {
    const markerPattern = /\{\{!\s*VOTC_SEGMENT:([a-z0-9_-]+)\s*\}\}/gi;
    const labels = {
      stable_global: "Stable Global Rules",
      stable_history_rp: "Stable History and Roleplay Rules",
      world_context: "World and Historical Context",
      character_base: "Character Base Profile",
      character_state: "Character State, Relations and Scene"
    };
    const segments = [];
    let currentId = "main";
    let contentStart = 0;
    let markerFound = false;
    let match;
    while ((match = markerPattern.exec(template)) !== null) {
      markerFound = true;
      const content = template.slice(contentStart, match.index);
      if (content.trim()) {
        segments.push({ id: currentId, label: labels[currentId] || "Main Prompt Preamble", template: content });
      }
      currentId = match[1].toLowerCase();
      contentStart = markerPattern.lastIndex;
    }
    const remaining = template.slice(contentStart);
    if (remaining.trim()) {
      segments.push({ id: currentId, label: labels[currentId] || currentId, template: remaining });
    }
    if (!markerFound) {
      return [{ id: "main", label: "Main System Prompt", template }];
    }
    return segments;
  }
  static applyBlock(block, messages, history, baseContext, promptSettings) {
    const { character, gameData, summary } = baseContext;
    const renderTemplate = (template, context) => {
      try {
        return this.templateEngine.renderTemplateString(template, context);
      } catch (error) {
        const blockLabel = block.label || block.type;
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Template error in block "${blockLabel}" (${block.type}): ${errorMsg}`);
      }
    };
    switch (block.type) {
      case "main": {
        const template = promptSettings.mainTemplate || promptConfigManager.getDefaultMainTemplateContent();
        const segments = this.splitMainTemplateSegments(template);
        for (const segment of segments) {
          const content = renderTemplate(segment.template, baseContext);
          if (content?.trim()) {
            messages.push({ role: block.role || "system", content });
          }
        }
        break;
      }
      case "description": {
        if (!block.scriptPath) break;
        const descScriptPath = promptConfigManager.resolvePath(block.scriptPath);
        try {
          const descriptionBlock = this.scriptLoader.executeDescription(descScriptPath, gameData, character.id);
          if (descriptionBlock) {
            messages.push({ role: "system", content: descriptionBlock });
          } 
        } catch (error) {
          console.error("Failed to run description script:", error);
        }
        break;
      }
      case "examples": {
        if (!block.scriptPath) break;
        const examplesScriptPath = promptConfigManager.resolvePath(block.scriptPath);
        try {
          const exampleMessages = this.scriptLoader.executeExamples(examplesScriptPath, gameData, character.id);
          if (Array.isArray(exampleMessages) && exampleMessages.length > 0) {
            messages.push(...exampleMessages);
          }
        } catch (error) {
          console.error("Failed to run example script:", error); 
        }
        break;
      }
      case "memories": {
        const memoriesBlock = this.buildMemoriesBlock(gameData, character, block.limit ?? 5, block.template, baseContext);
        if (memoriesBlock) {
          messages.push({ role: block.role || "system", content: memoriesBlock });
        }
        break;
      }
      case "past_summaries": {
        if (baseContext.memoryContext?.engineVersion?.startsWith("2.")) break;
        const pastSummaries = this.buildPastSummariesContext(character, gameData);
        if (pastSummaries) {
          const content = block.template ? renderTemplate(block.template, { ...baseContext, pastSummaries }) : pastSummaries;
          messages.push({ role: block.role || "system", content });
        }
        break;
      }
      case "rolling_summary": {
        if (summary) {
          const tpl = block.template || "此对话中较早消息的摘要：\n{{summary}}";
          const content = renderTemplate(tpl, { ...baseContext, summary });
          messages.push({ role: block.role || "system", content });
        }
        break;
      }
      case "history": {
        messages.push(
          ...history.map((m) => ({
            role: m.role,
            content: m.name ? `${m.name}: ${m.content}` : m.content
          }))
        );
        break;
      }
      case "instruction": {
        const tpl = block.template || DEFAULT_CHAT_INSTRUCTION;
        const content = renderTemplate(tpl, baseContext);
        messages.push({
          role: block.role || "user",
          content
        });
        break;
      }
      case "custom": {
        if (!block.template) break;
        const content = renderTemplate(block.template, baseContext);
        messages.push({ role: block.role || "system", content });
        break;
      }
    }
  }
  /**
   * Build messages with token counting for preview
   */
  static buildMessagesWithTokenCount(history, char, gameData, currentSessionSummary, memoryContext = null) {
    const promptSettings = settingsRepository.getPromptSettings();
    const blocks = promptSettings.blocks || [];
    const llmMessages = [];
    const blocksWithTokens = [{
      block: { id: "cache-anchor", type: "cache_anchor", label: "Stable Cache Anchor" },
      content: this.buildCacheAnchor(gameData),
      tokens: TokenCounter.estimateTokens(this.buildCacheAnchor(gameData))
    }];
    llmMessages.push({ role: "system", content: blocksWithTokens[0].content });
    const context = {
      character: char,
      gameData,
      summary: currentSessionSummary,
      memoryContext
    };
    const workingHistory = history.map((m) => ({
      role: m.role,
      name: m.name,
      content: m.content
    })).filter((m) => !!m.content);
    const activeParticipantIds = new Set((memoryContext?.activeParticipantIds || [...gameData.characters.keys()]).map(Number));
    const siblingIds = Array.isArray(char.siblings) ? char.siblings.map((sibling) => sibling?.id).filter((id) => id !== void 0 && activeParticipantIds.has(Number(id))) : [];
    const activeParticipantRelationshipContext = gameData.getActiveParticipantRelationshipInfo(char, siblingIds);
    const activeParticipantRelationshipBlock = {
      id: "active-participant-relationship",
      type: "participant_relationship",
      label: "Active Participant Relationship",
      enabled: true,
      role: "system"
    };
    const mentionedCharactersContext = this.buildMentionedCharactersContext(char, gameData, workingHistory);
    const responderGameFacts = this.buildResponderGameFacts(char);
    const responderGameFactsBlock = {
      id: "responder-game-facts",
      type: "responder_game_facts",
      label: "Responder Authoritative Game Facts",
      enabled: true,
      role: "system"
    };
    const stableMemoryBlock = {
      id: "memory-stable",
      type: "memory_stable",
      label: "Stable Long-term Memory",
      enabled: true,
      role: "system"
    };
    const directMemoryBlock = {
      id: "memory-direct-frozen",
      type: "memory_direct_frozen",
      label: "Frozen Direct Relationship Memory",
      enabled: true,
      role: "system"
    };
    const mentionedSnapshotBlock = {
      id: "memory-mentioned-snapshot",
      type: "memory_mentioned_snapshot",
      label: "Frozen Mentioned Character Snapshot",
      enabled: true,
      role: "system"
    };
    const deferredMainSegments = [];
    const deferredDescriptionBlocks = [];
    let preHistoryContextInserted = false;
    const insertPreHistoryContext = () => {
      if (preHistoryContextInserted) return;
      preHistoryContextInserted = true;
      // Relationship and long-lived summaries are normally unchanged for a
      // responder. Keep them before date/scene state so a date advance does
      // not evict this useful prefix from the provider cache.
      if (memoryContext?.stableText) {
        llmMessages.push({ role: "system", content: memoryContext.stableText });
        blocksWithTokens.push({
          block: stableMemoryBlock,
          content: memoryContext.stableText,
          tokens: TokenCounter.estimateTokens(memoryContext.stableText)
        });
      }
      if (memoryContext?.directStableText) {
        llmMessages.push({ role: "system", content: memoryContext.directStableText });
        blocksWithTokens.push({
          block: directMemoryBlock,
          content: memoryContext.directStableText,
          tokens: TokenCounter.estimateTokens(memoryContext.directStableText)
        });
      }
      if (memoryContext?.mentionedSnapshotText) {
        llmMessages.push({ role: "system", content: memoryContext.mentionedSnapshotText });
        blocksWithTokens.push({
          block: mentionedSnapshotBlock,
          content: memoryContext.mentionedSnapshotText,
          tokens: TokenCounter.estimateTokens(memoryContext.mentionedSnapshotText)
        });
      }
      for (const deferred of deferredMainSegments) {
        llmMessages.push(deferred.message);
        blocksWithTokens.push(deferred.tokenBlock);
      }
      for (const deferred of deferredDescriptionBlocks) {
        llmMessages.push(deferred.message);
        blocksWithTokens.push(deferred.tokenBlock);
      }
      if (responderGameFacts) {
        llmMessages.push({ role: "system", content: responderGameFacts });
        blocksWithTokens.push({
          block: responderGameFactsBlock,
          content: responderGameFacts,
          tokens: TokenCounter.estimateTokens(responderGameFacts)
        });
      }
    };
    for (const block of blocks) {
      if (!block.enabled) continue;
      if (block.type === "history" || block.type === "instruction") insertPreHistoryContext();
      const result = this.applyBlockWithTokenCount(block, llmMessages, workingHistory, context, promptSettings, {
        deferredMainSegments,
        deferredDescriptionBlocks,
        presenceText: [memoryContext?.presenceText, activeParticipantRelationshipContext].filter(Boolean).join("\n\n"),
        topicPatchText: [mentionedCharactersContext, memoryContext?.topicPatchText].filter(Boolean).join("\n\n")
      });
      if (Array.isArray(result)) {
        blocksWithTokens.push(...result);
      } else if (result) {
        blocksWithTokens.push(result);
      }
    }
    insertPreHistoryContext();
    if (promptSettings.suffix?.enabled && promptSettings.suffix.template) {
      const suffixBlock = {
        id: "suffix",
        type: "custom",
        label: promptSettings.suffix.label || "Suffix",
        enabled: true,
        role: "system",
        template: promptSettings.suffix.template
      };
      try {
        const suffixContent = this.templateEngine.renderTemplateString(promptSettings.suffix.template, context);
        const suffixTokens = TokenCounter.estimateTokens(suffixContent);
        llmMessages.push({ role: "system", content: suffixContent });
        blocksWithTokens.push({ block: suffixBlock, content: suffixContent, tokens: suffixTokens });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("Template error in Suffix block:", errorMsg);
        blocksWithTokens.push({ block: suffixBlock, content: "", tokens: 0, error: `Template error in Suffix block. Check Handlebars syntax.` });
      }
    }
    const totalTokens = TokenCounter.calculateTotalTokens(llmMessages);
    return {
      messages: llmMessages,
      blocks: blocksWithTokens,
      totalTokens
    };
  }
  /**
   * Apply a single block with token counting.
   * Template errors are caught and returned as error info in the result rather than thrown.
   */
  static applyBlockWithTokenCount(block, messages, history, baseContext, promptSettings, options = {}) {
    const { character, gameData, summary } = baseContext;
    const renderTemplate = (template, context) => {
      try {
        return this.templateEngine.renderTemplateString(template, context);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Template error in block "${block.label || block.type}":`, errorMsg);
        return null;
      }
    };
    switch (block.type) {
      case "main": {
        const template = promptSettings.mainTemplate || promptConfigManager.getDefaultMainTemplateContent();
        const segments = this.splitMainTemplateSegments(template);
        const renderedSegments = segments.map((segment) => ({ ...segment, content: renderTemplate(segment.template, baseContext) }));
        if (renderedSegments.some((segment) => segment.content === null)) {
          return { block, content: "", tokens: 0, error: `Template error in "${block.label || "Main Prompt"}" block. Check Handlebars syntax.` };
        }
        const nonEmptySegments = renderedSegments.filter((segment) => segment.content?.trim());
        const immediateBlocks = [];
        for (const segment of nonEmptySegments) {
          const message = { role: block.role || "system", content: segment.content };
          const tokenBlock = {
            block: {
              ...block,
              id: `${block.id || "main"}-${segment.id}`,
              type: "main_segment",
              label: segment.label
            },
            content: segment.content,
            tokens: TokenCounter.estimateTokens(segment.content)
          };
          // Date, world state and scene must stay near the history tail. This
          // leaves character profile, examples and persisted summaries in the
          // reusable prefix when a game day advances.
          if (options.deferredMainSegments && (segment.id === "world_context" || segment.id === "character_state")) {
            options.deferredMainSegments.push({ message, tokenBlock });
          } else {
            messages.push(message);
            immediateBlocks.push(tokenBlock);
          }
        }
        if (nonEmptySegments.length === 1 && nonEmptySegments[0].id === "main") {
          const content = nonEmptySegments[0].content;
          return { block, content, tokens: TokenCounter.estimateTokens(content) };
        }
        if (immediateBlocks.length > 0) return immediateBlocks;
        break;
      }
      case "description": {
        if (!block.scriptPath) break;
        const descScriptPath = promptConfigManager.resolvePath(block.scriptPath);
        try {
          const descriptionBlock = this.scriptLoader.executeDescription(descScriptPath, gameData, character.id);
          if (descriptionBlock) {
            const { stableContent, dynamicContent } = this.splitDescriptionForCache(descriptionBlock);
            const tokenBlocks = [];
            if (stableContent) {
              messages.push({ role: "system", content: stableContent });
              tokenBlocks.push({
                block: { ...block, id: `${block.id || "description"}-stable`, type: "description", label: `${block.label || "Character Description"} (Stable Profile)` },
                content: stableContent,
                tokens: TokenCounter.estimateTokens(stableContent)
              });
            }
            if (dynamicContent) {
              const tokenBlock = {
                block: { ...block, id: `${block.id || "description"}-dynamic`, type: "description_dynamic", label: `${block.label || "Character Description"} (Dynamic Scene)` },
                content: dynamicContent,
                tokens: TokenCounter.estimateTokens(dynamicContent)
              };
              if (options.deferredDescriptionBlocks) {
                options.deferredDescriptionBlocks.push({ message: { role: "system", content: dynamicContent }, tokenBlock });
              } else {
                messages.push({ role: "system", content: dynamicContent });
                tokenBlocks.push(tokenBlock);
              }
            }
            return tokenBlocks.length === 1 ? tokenBlocks[0] : tokenBlocks;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error("Failed to run description script:", error);
          return { block, content: "", tokens: 0, error: `Script error: ${errorMsg}` };
        }
        break;
      }
      case "examples": {
        if (!block.scriptPath) break;
        const examplesScriptPath = promptConfigManager.resolvePath(block.scriptPath);
        try {
          const exampleMessages = this.scriptLoader.executeExamples(examplesScriptPath, gameData, character.id);
          if (Array.isArray(exampleMessages) && exampleMessages.length > 0) {
            messages.push(...exampleMessages);
            const content = exampleMessages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
            return { block, content, tokens: TokenCounter.calculateTotalTokens(exampleMessages) };
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error("Failed to run example script:", error);
          return { block, content: "", tokens: 0, error: `Script error: ${errorMsg}` };
        }
        break;
      }
      case "memories": {
        try {
          const memoriesBlock = this.buildMemoriesBlock(gameData, character, block.limit ?? 5, block.template, baseContext);
          if (memoriesBlock) {
            messages.push({ role: block.role || "system", content: memoriesBlock });
            return { block, content: memoriesBlock, tokens: TokenCounter.estimateTokens(memoriesBlock) };
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return { block, content: "", tokens: 0, error: `Template error in "${block.label || "Memories"}" block: ${errorMsg}` };
        }
        break;
      }
      case "past_summaries": {
        if (baseContext.memoryContext?.engineVersion?.startsWith("2.")) break;
        const pastSummaries = this.buildPastSummariesContext(character, gameData);
        if (pastSummaries) {
          const content = block.template ? renderTemplate(block.template, { ...baseContext, pastSummaries }) : pastSummaries;
          if (content === null) {
            return { block, content: "", tokens: 0, error: `Template error in "${block.label || "Past Summaries"}" block. Check Handlebars syntax.` };
          }
          messages.push({ role: block.role || "system", content });
          return { block, content, tokens: TokenCounter.estimateTokens(content) };
        }
        break;
      }
      case "rolling_summary": {
        if (summary) {
          const tpl = block.template || "此对话中较早消息的摘要：\n{{summary}}";
          const content = renderTemplate(tpl, { ...baseContext, summary });
          if (content === null) {
            return { block, content: "", tokens: 0, error: `模板错误："${block.label || "Rolling Summary"}" block。请检查 Handlebars 语法。` };
          }
          messages.push({ role: block.role || "system", content });
          return { block, content, tokens: TokenCounter.estimateTokens(content) };
        }
        break;
      }
      case "history": {
        const historyMessages = history.map((m) => ({
          role: m.role,
          content: m.name ? `${m.name}: ${m.content}` : m.content
        }));
        const hasCurrentUserMessage = historyMessages.at(-1)?.role === "user";
        const priorHistory = hasCurrentUserMessage ? historyMessages.slice(0, -1) : historyMessages;
        const currentUserMessage = hasCurrentUserMessage ? historyMessages.at(-1) : null;
        const tokenBlocks = [];
        if (priorHistory.length > 0) {
          messages.push(...priorHistory);
          tokenBlocks.push({
            block,
            content: priorHistory.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
            tokens: TokenCounter.calculateTotalTokens(priorHistory)
          });
        }
        if (options.presenceText) {
          messages.push({ role: "system", content: options.presenceText });
          tokenBlocks.push({
            block: { id: "current-presence-roster", type: "presence_roster", label: "Current Presence and Relationships", enabled: true, role: "system" },
            content: options.presenceText,
            tokens: TokenCounter.estimateTokens(options.presenceText)
          });
        }
        if (options.topicPatchText) {
          messages.push({ role: "system", content: options.topicPatchText });
          tokenBlocks.push({
            block: { id: "memory-topic-patch", type: "memory_topic_patch", label: "Turn Topic Memory Patch", enabled: true, role: "system" },
            content: options.topicPatchText,
            tokens: TokenCounter.estimateTokens(options.topicPatchText)
          });
        }
        if (currentUserMessage) {
          messages.push(currentUserMessage);
          tokenBlocks.push({
            block: { ...block, id: `${block.id || "history"}-current-user`, type: "current_user", label: "Current User Message" },
            content: `user: ${currentUserMessage.content}`,
            tokens: TokenCounter.calculateTotalTokens([currentUserMessage])
          });
        }
        return tokenBlocks;
      }
      case "instruction": {
        const tpl = block.template || DEFAULT_CHAT_INSTRUCTION;
        const content = renderTemplate(tpl, baseContext);
        if (content === null) {
          return { block, content: "", tokens: 0, error: `模板错误："${block.label || "Instruction"}" block。请检查 Handlebars 语法。` };
        }
        messages.push({ role: block.role || "user", content });
        return { block, content, tokens: TokenCounter.estimateTokens(content) };
      }
      case "custom": {
        if (!block.template) break;
        const content = renderTemplate(block.template, baseContext);
        if (content === null) {
          return { block, content: "", tokens: 0, error: `模板错误："${block.label || "Custom"}" block。请检查 Handlebars 语法。` };
        }
        messages.push({ role: block.role || "system", content });
        return { block, content, tokens: TokenCounter.estimateTokens(content) };
      }
    }
    return null;
  }
}
const llmManager = new LLMManager({
  settingsRepository,
  providerRegistry,
  usageAnalytics,
  TokenCounter,
  PromptBuilder,
  debugVerboseLLM: DEBUG_VERBOSE_LLM,
  logVerboseLLM
});
const ActionRegistry = actionSystem.ActionRegistry.configure({
  actionsDir: VOTC_ACTIONS_DIR,
  dataDir: VOTC_DATA_DIR,
  defaultUserdataDir: path.join(electron.app.getAppPath(), "default_userdata", "actions")
});
const actionRegistry = ActionRegistry.getInstance();
const {
  buildStructuredResponseJsonSchema,
  buildStructuredResponseSchema
} = actionSystem.actionSchema;
class RunFileManager {
  constructor() {
    this.ck3UserPath = settingsRepository.getCK3UserFolderPath() || null;
    console.log(`RunFileManager: CK3 user path from settings: ${this.ck3UserPath}`);
    if (this.ck3UserPath) {
      this.path = path.join(this.ck3UserPath, "run", "votc.txt");
      console.log(`RunFileManager: Resolved votc.txt path: ${this.path}`);
      this.createRunFolder(this.ck3UserPath);
    } else {
      console.warn("RunFileManager: CK3 user folder path is not configured. Run file operations will be disabled.");
      this.path = null;
    }
  }
  write(text) {
    if (!this.path) {
      if (!this.ck3UserPath) {
        this.ck3UserPath = settingsRepository.getCK3UserFolderPath() || null;
      }
      if (!this.ck3UserPath) {
        console.warn("RunFileManager: CK3 user folder path is not configured. Run file operations will be disabled.");
        return;
      }
      this.createRunFolder(this.ck3UserPath);
      this.path = path.join(this.ck3UserPath, "run", "votc.txt");
      console.log(`RunFileManager: Successfully resolved votc.txt path: ${this.path}`);
    }
    try {
      const currentText = fs$1.readFileSync(this.path, "utf-8");
      console.log(`RunFileManager: Current text in run file: ${currentText}`);
      if (currentText.trim() === "") {
        console.log(`RunFileManager: Run file is empty - writing to it: ${text}`);
        fs$1.writeFileSync(
          this.path,
          `${text}
root = {trigger_event = mcc_event_v2.9003}`,
          "utf-8"
        );
      } else {
        console.log(`RunFileManager: Run file is not empty - prepending to it: ${text}`);
        fs$1.writeFileSync(
          this.path,
          `${text}
${currentText}`,
          "utf-8"
        );
      }
    } catch (error) {
      console.error(`RunFileManager: Failed to write to file ${this.path}:`, error);
    }
  }
  append(text) {
    if (!this.path) {
      console.warn("RunFileManager: Cannot append - CK3 user folder is not configured");
      return;
    }
    try {
      fs$1.appendFileSync(this.path, text, "utf-8");
      console.log(`RunFileManager: appended to run file: ${text}`);
    } catch (error) {
      console.error(`RunFileManager: Failed to append to file ${this.path}:`, error);
    }
  }
  clear() {
    if (!this.path) {
      console.warn("RunFileManager: Cannot clear - CK3 user folder is not configured");
      return;
    }
    try {
      fs$1.writeFileSync(this.path, "", "utf-8");
      console.log("RunFileManager: Run File cleared");
    } catch (error) {
      console.error(`RunFileManager: Failed to clear file ${this.path}:`, error);
    }
  }
  createRunFolder(userFolderPath) {
    const runFolderPath = path.join(userFolderPath, "run");
    console.log(`RunFileManager: Checking run folder path: ${runFolderPath}`);
    if (!fs$1.existsSync(runFolderPath)) {
      try {
        fs$1.mkdirSync(runFolderPath, { recursive: true });
        console.log(`RunFileManager: Created run folder: ${runFolderPath}`);
      } catch (err) {
        console.error(`RunFileManager: Error creating run folder ${runFolderPath}:`, err);
      }
    } else {
      console.log(`RunFileManager: Run folder already exists: ${runFolderPath}`);
    }
  }
  // Method to check if run file operations are available
  isAvailable() {
    return this.path !== null;
  }
}
const runFileManager = new RunFileManager();
class ActionEffectWriter {
  /**
   * Compose CK3 prelude code to scope source/target characters from the ordered list.
   * Uses:
   *  - global_var:votc_action_source
   *  - global_var:votc_action_target
   */
  static composeScopePrelude(sourceIndex, targetIndex, isPlayerTarget) {
    let prelude = "";
    if (sourceIndex !== null && sourceIndex !== void 0) {
      prelude += `
ordered_in_global_list = {
    variable = mcc_characters_list_v2
    position = ${sourceIndex}
    set_global_variable = {
        name = votc_action_source
        value = this
    }
}
`;
    }
    if (targetIndex !== null && targetIndex !== void 0) {
      if (isPlayerTarget) {
        prelude += `
root = {
    set_global_variable = {
        name = votc_action_target
        value = root
    }
}
`;
      } else {
        prelude += `
ordered_in_global_list = {
    variable = mcc_characters_list_v2
    position = ${targetIndex}
    set_global_variable = {
        name = votc_action_target
        value = this
    }
}
`;
      }
    }
    return prelude;
  }
  /**
   * Compose final CK3 effect block including scope prelude and action effect text.
   * Consumers can write this string into run file.
   */
  static composeFullEffect(gameData, sourceCharacterId, targetCharacterId, effectBody) {
    const sourceIndex = this.getCharacterIndex(gameData, sourceCharacterId);
    const targetIndex = targetCharacterId != null ? this.getCharacterIndex(gameData, targetCharacterId) : null;
    const isPlayerTarget = targetCharacterId != null && targetCharacterId === gameData.playerID;
    const prelude = this.composeScopePrelude(sourceIndex, targetIndex, isPlayerTarget);
    return `${prelude}
${effectBody}
`;
  }
  /**
   * Write composed effect to run file (appends).
   * Creates a RunFileManager using CK3 user folder path from SettingsRepository if not already created.
   */
  static writeEffect(gameData, sourceCharacterId, targetCharacterId, effectBody) {
    const effect = this.composeFullEffect(gameData, sourceCharacterId, targetCharacterId, effectBody);
    runFileManager.write(effect);
  }
  /**
   * Compute 0-based position for character id in the ordered list.
   * The GameData.characters Map is guaranteed to be in CK3 order.
   */
  static getCharacterIndex(gameData, characterId) {
    const ids = Array.from(gameData.characters.keys());
    const idx = ids.indexOf(characterId);
    if (idx === -1) {
      throw new Error(`Character id ${characterId} not found in GameData.characters`);
    }
    return idx;
  }
}
const ActionPromptBuilder = actionSystem.ActionPromptBuilder.configure({
  TokenCounter,
  createPromptFingerprint
});
function fixTypingErrors(obj) {
  if (obj === null || obj === void 0) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => fixTypingErrors(item));
  }
  if (typeof obj === "object") {
    const fixed = {};
    for (const [key, value] of Object.entries(obj)) {
      fixed[key] = fixTypingErrors(value);
    }
    return fixed;
  }
  if (typeof obj === "string") {
    const trimmed = obj.trim();
    if (trimmed !== "" && !isNaN(Number(trimmed))) {
      if (/^-?\d+\.?\d*$/.test(trimmed)) {
        return Number(trimmed);
      }
    }
    if (trimmed.toLowerCase() === "true") {
      return true;
    }
    if (trimmed.toLowerCase() === "false") {
      return false;
    }
  }
  return obj;
}
function healJsonResponse(content) {
  if (!content || typeof content !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(content);
    return fixTypingErrors(parsed);
  } catch {
  }
  const markdownMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (markdownMatch) {
    try {
      const parsed = JSON.parse(markdownMatch[1].trim());
      return fixTypingErrors(parsed);
    } catch {
      content = markdownMatch[1].trim();
    }
  }
  const jsonStart = Math.min(
    content.indexOf("{") !== -1 ? content.indexOf("{") : Infinity,
    content.indexOf("[") !== -1 ? content.indexOf("[") : Infinity
  );
  if (jsonStart !== Infinity) {
    const startChar = content[jsonStart];
    const endChar = startChar === "{" ? "}" : "]";
    const jsonEnd = content.lastIndexOf(endChar);
    if (jsonEnd > jsonStart) {
      const extracted = content.substring(jsonStart, jsonEnd + 1);
      try {
        const parsed = JSON.parse(extracted);
        return fixTypingErrors(parsed);
      } catch {
        content = extracted;
      }
    }
  }
  let repaired = content.trim();
  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  if (openBraces > closeBraces) {
    repaired += "}".repeat(openBraces - closeBraces);
  }
  if (openBrackets > closeBrackets) {
    repaired += "]".repeat(openBrackets - closeBrackets);
  }
  try {
    const parsed = JSON.parse(repaired);
    return fixTypingErrors(parsed);
  } catch {
    return null;
  }
}
function healJsonResponseWithLogging(content, context = "JSON") {
  console.log(`[${context}] Attempting to heal JSON response`);
  console.log(`[${context}] Original content length: ${content?.length || 0} characters`);
  const healed = healJsonResponse(content);
  if (healed !== null) {
    console.log(`[${context}] Successfully healed JSON response`);
    return healed;
  }
  console.error(`[${context}] Failed to heal JSON response`);
  logVerboseLLM(`[${context}][verbose] Original content:`, content?.substring(0, 500));
  return null;
}
function resolveI18nString(value, lang) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    if (lang && value[lang]) {
      return value[lang];
    }
    if (value["en"]) {
      return value["en"];
    }
    const keys = Object.keys(value);
    if (keys.length > 0) {
      return value[keys[0]];
    }
  }
  return "";
}
class ActionSandbox {
  /**
   * Load and execute an action in a sandboxed VM context
   */
  static async executeAction(actionFilePath, context) {
    const actionCode = fs__namespace.readFileSync(actionFilePath, "utf-8");
    const sandbox = scriptSandbox.createSandbox({
      // Provide the context objects (these are references, so modifications work)
      gameData: context.gameData,
      sourceCharacter: context.sourceCharacter,
      targetCharacter: context.targetCharacter,
      runGameEffect: context.runGameEffect,
      args: context.args,
      conversation: context.conversation,
      dryRun: context.dryRun,
      lang: context.lang
    });
    const wrapperCode = `
      (async function() {
        // Create a module-like structure
        const module = { exports: {} };
        const exports = module.exports;

        // Execute the action code to populate module.exports
        ${actionCode}

        // Get the action definition
        const actionDef = module.exports;

        if (!actionDef || typeof actionDef.run !== 'function') {
          throw new Error('Action must export an object with a run function');
        }

        // Execute the run function with the context
        const result = await actionDef.run({
          gameData,
          sourceCharacter,
          targetCharacter,
          runGameEffect,
          args,
          conversation,
          dryRun,
          lang
        });

        return result;
      })();
    `;
    try {
      const result = await scriptSandbox.runScript(wrapperCode, { filename: actionFilePath, sandbox });
      return result;
    } catch (error) {
      console.error("[ActionSandbox] Execution error:", error);
      throw new Error(`Action execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
const ActionEngine = actionSystem.ActionEngine.configure({
  actionRegistry,
  settingsRepository,
  usageAnalytics,
  llmManager,
  ActionPromptBuilder,
  ActionSandbox,
  ActionEffectWriter,
  buildStructuredResponseJsonSchema,
  buildStructuredResponseSchema,
  healJsonResponseWithLogging,
  resolveI18nString,
  logVerboseLLM
});
const Conversation = actionSystem.Conversation.configure({
  actionSystem,
  ActionEngine,
  actionRegistry,
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
  cleanLogFile,
  resolveI18nString,
  PromptBuilder,
  TokenCounter,
  logVerboseLLM,
  events,
  uuid,
  path,
  memoryEngine
});
class ConversationManager {
  constructor() {
    this.currentConversation = null;
    this.eventEmitter = new events.EventEmitter();
    this.finalizationCoordinator = new memorySystem.FinalizationCoordinator({ logger: console });
  }
  static getInstance() {
    if (!ConversationManager.instance) {
      ConversationManager.instance = new ConversationManager();
    }
    return ConversationManager.instance;
  }
  setupConversationListeners() {
    if (this.currentConversation) {
      this.currentConversation.onConversationUpdate((entries) => {
        this.eventEmitter.emit("conversation-updated", entries);
      });
    }
  }
  emitConversationUpdate() {
    const entries = this.getConversationEntries();
    this.eventEmitter.emit("conversation-updated", entries);
  }
  /**
   * Create a new conversation with an NPC
   */
  createConversation() {
    try {
      this.endCurrentConversation();
      this.currentConversation = new Conversation();
      this.setupConversationListeners();
      return this.currentConversation;
    } catch (error) {
      console.error("Failed to create conversation:", error);
      return null;
    }
  }
  /**
   * Get the current active conversation
   */
  getCurrentConversation() {
    return this.currentConversation;
  }
  /**
   * Send a message in the current conversation
   */
  async sendMessage(userMessage, streaming = false) {
    console.log(`ConversationManager.sendMessage called (characters=${typeof userMessage === "string" ? userMessage.length : 0}, streaming=${streaming})`);
    logVerboseLLM("[ConversationManager][verbose] User message:", userMessage);
    console.log("Current conversation exists:", !!this.currentConversation);
    console.log("Current conversation active:", this.currentConversation?.isActive);
    if (!this.currentConversation) {
      console.error("No active conversation");
      throw new Error("No active conversation");
    }
    if (!this.currentConversation.isActive) {
      console.error("Current conversation is not active");
      throw new Error("Current conversation is not active");
    }
    try {
      const result = await this.currentConversation.sendMessage(userMessage);
      console.log("Conversation sendMessage returned type:", typeof result);
      if (streaming && result && typeof result[Symbol.asyncIterator] === "function") {
        console.log("Returning async generator for streaming");
        return result;
      } else {
        console.log("Conversation sendMessage returned:", result);
        this.emitConversationUpdate();
        return result;
      }
    } catch (error) {
      console.error("Error in ConversationManager.sendMessage:", error);
      this.emitConversationUpdate();
      throw error;
    }
  }
  /**
   * Get all conversation entries (messages and errors)
   */
  getConversationEntries() {
    if (!this.currentConversation) {
      return [];
    }
    return this.currentConversation.messages.map((entry) => {
      if ("role" in entry) {
        return {
          type: "message",
          id: entry.id,
          role: entry.role,
          content: entry.content,
          datetime: entry.datetime,
          name: entry.name,
          isStreaming: entry.isStreaming,
          streamStatus: entry.streamStatus
        };
      } else if (entry.type === "action-feedback") {
        return {
          type: "action-feedback",
          id: entry.id,
          associatedMessageId: entry.associatedMessageId,
          feedbacks: entry.feedbacks.map((f) => ({
            actionId: f.actionId,
            success: f.success,
            message: f.message,
            sentiment: f.sentiment
          })),
          datetime: entry.datetime
        };
      } else if (entry.type === "action-approval") {
        return {
          type: "action-approval",
          id: entry.id,
          associatedMessageId: entry.associatedMessageId,
          action: entry.action,
          status: entry.status,
          previewFeedback: entry.previewFeedback,
          previewSentiment: entry.previewSentiment,
          resultFeedback: entry.resultFeedback,
          resultSentiment: entry.resultSentiment,
          datetime: entry.datetime
        };
      } else {
        return {
          type: "error",
          id: entry.id,
          content: entry.content,
          datetime: entry.datetime,
          details: entry.details
        };
      }
    });
  }
  /**
   * End current conversation
   */
  endCurrentConversation() {
    const conversation = this.currentConversation;
    this.currentConversation = null;
    if (!conversation) return Promise.resolve(null);
    console.log(`Conversation ${conversation.id} detached; finalization queued`);
    return this.finalizationCoordinator.enqueue(conversation.id, () => conversation.finalizeConversation()).catch((error) => {
      console.error(`Conversation ${conversation.id} finalization failed:`, error);
      return { success: false, error };
    });
  }
  flushFinalizations(options = {}) {
    return this.finalizationCoordinator.drain(options);
  }
  hasPendingFinalizations() {
    return this.finalizationCoordinator.pendingCount > 0;
  }
  /**
   * Cancel the current stream in the active conversation
   */
  cancelCurrentStream() {
    if (this.currentConversation) {
      this.currentConversation.cancelCurrentStream();
    }
  }
  /**
   * Check if there's an active conversation
   */
  hasActiveConversation() {
    return this.currentConversation !== null && this.currentConversation.isActive;
  }
  /**
   * Pause the current conversation
   */
  pauseConversation() {
    if (this.currentConversation) {
      this.currentConversation.pauseConversation();
    }
  }
  /**
   * Resume the current conversation
   */
  resumeConversation() {
    if (this.currentConversation) {
      this.currentConversation.resumeConversation();
    }
  }
  /**
   * Get conversation state (paused, queue length)
   */
  getConversationState() {
    if (!this.currentConversation) {
      return { isPaused: false, queueLength: 0, presence: null };
    }
    return {
      isPaused: this.currentConversation.isPaused,
      queueLength: this.currentConversation.npcQueue.length,
      presence: this.currentConversation.getPresenceState()
    };
  }
  async joinWaitingCharacter(characterId) {
    if (!this.currentConversation?.isActive) return { success: false, error: "no_active_conversation" };
    const result = await this.currentConversation.joinWaitingCharacter(characterId);
    this.emitConversationUpdate();
    return result;
  }
  async leavePresentCharacter(characterId) {
    if (!this.currentConversation?.isActive) return { success: false, error: "no_active_conversation" };
    const result = await this.currentConversation.leavePresentCharacter(characterId);
    this.emitConversationUpdate();
    return result;
  }
  /**
   * Regenerate an error message
   */
  async regenerateError(messageId) {
    if (!this.currentConversation) {
      throw new Error("No active conversation");
    }
    try {
      await this.currentConversation.regenerateError(messageId);
      this.emitConversationUpdate();
      return { success: true };
    } catch (error) {
      console.error("Error in ConversationManager.regenerateError:", error);
      this.emitConversationUpdate();
      throw error;
    }
  }
  /**
   * Subscribe to conversation updates
   */
  onConversationUpdate(callback) {
    this.eventEmitter.on("conversation-updated", callback);
  }
  /**
   * Unsubscribe from conversation updates
   */
  offConversationUpdate(callback) {
    this.eventEmitter.off("conversation-updated", callback);
  }
  /**
   * Get active conversation data
   */
  getActiveConversationData() {
    if (!this.currentConversation || !this.currentConversation.isActive) {
      return null;
    }
    const characters = Array.from(this.currentConversation.gameData.characters.values()).map((char) => ({
      id: char.id,
      fullName: char.fullName,
      shortName: char.shortName
    }));
    return {
      characters,
      playerID: this.currentConversation.gameData.playerID,
      aiID: this.currentConversation.gameData.aiID,
      historyLength: this.currentConversation.getHistory().length,
      presence: this.currentConversation.getPresenceState()
    };
  }
  /**
   * Get prompt preview for a specific character
   */
  getPromptPreview(characterId) {
    if (!this.currentConversation || !this.currentConversation.isActive) {
      return null;
    }
    const character = this.currentConversation.gameData.characters.get(characterId);
    if (!character) {
      return null;
    }
    const history = this.currentConversation.getPromptHistoryForCharacter(characterId);
    const result = PromptBuilder.buildMessagesWithTokenCount(
      history,
      character,
      this.currentConversation.gameData,
      this.currentConversation.getPromptSummaryForCharacter(characterId),
      {
        activeParticipantIds: this.currentConversation.getActiveConversationCharacters().map((participant) => participant.id),
        presenceText: this.currentConversation.buildPresenceContext()
      }
    );
    return {
      characterId,
      characterName: character.fullName,
      ...result
    };
  }
  /**
   * Add an action feedback entry for a manually executed action
   */
  addManualActionFeedback(feedback) {
    if (!this.currentConversation || !this.currentConversation.isActive) {
      console.warn("No active conversation to add action feedback");
      return;
    }
    const feedbackEntry = createActionFeedback({
      id: this.currentConversation["nextId"]++,
      feedbacks: [{
        actionId: feedback.actionId,
        success: feedback.success,
        message: feedback.message,
        sentiment: feedback.sentiment
      }]
    });
    this.currentConversation["messages"].push(feedbackEntry);
    this.currentConversation["emitUpdate"]();
  }
}
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
class SummariesManager {
  static writeSummaryJsonAtomic(filePath, summaries) {
    fs$1.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs$1.writeFileSync(tempPath, JSON.stringify(summaries, null, "\t"), "utf8");
    fs$1.renameSync(tempPath, filePath);
  }
  
  /**
   * List all summaries across all character folders with metadata
   * New format: character_name/与other_character的对话.json
   */
  static async listAllSummaries() {
    const results = [];
    try {
      if (!fs$1.existsSync(VOTC_SUMMARIES_DIR)) {
        return results;
      }
      
      // Read all entries in the summaries directory
      const entries = fs$1.readdirSync(VOTC_SUMMARIES_DIR, { withFileTypes: true });
      
      // Process character folders (new format)
      const characterFolders = entries.filter((dirent) => dirent.isDirectory());
      
      for (const folder of characterFolders) {
        const characterFolderName = folder.name;
        const characterFolderPath = path.join(VOTC_SUMMARIES_DIR, characterFolderName);
        
        try {
          // Read all conversation files in this character's folder
          const conversationFiles = fs$1.readdirSync(characterFolderPath).filter((file) => file.endsWith('.json'));
          
          for (const conversationFile of conversationFiles) {
            const filePath = path.join(characterFolderPath, conversationFile);
            
            try {
              const fileContent = fs$1.readFileSync(filePath, "utf8");
              const summaries = JSON.parse(fileContent);
              
              if (!Array.isArray(summaries) || summaries.length === 0) {
                continue;
              }
              results.push(memorySystem.buildSummaryCatalogEntry({
                folderName: characterFolderName,
                conversationFile,
                summaries,
                filePath
              }));
            } catch (error) {
              console.error(`Failed to read summaries from ${filePath}:`, error);
            }
          }
        } catch (error) {
          console.error(`Failed to process character folder ${characterFolderName}:`, error);
        }
      }
      
    } catch (error) {
      console.error("Failed to list summaries:", error);
    }
    return results;
  }
  /**
   * Helper method to find summary file paths in character folder structure
   * Returns an object with both character perspectives' file paths
   */
  static findSummaryFilePath(playerId, characterId, playerName = null, characterName = null) {
    const result = {
      playerPerspectivePath: null,
      characterPerspectivePath: null
    };
    
    // Try new format: character folders
    if (playerName && characterName) {
      // We have names, so we can construct the exact paths
      const sanitize = (name) => name.replace(/[<>:"/\\|?*]/g, '_').trim();
      
      const playerFolder = path.join(VOTC_SUMMARIES_DIR, sanitize(playerName));
      const playerFile = path.join(playerFolder, `与${sanitize(characterName)}的对话.json`);
      if (fs$1.existsSync(playerFile)) {
        result.playerPerspectivePath = playerFile;
      }
      
      const characterFolder = path.join(VOTC_SUMMARIES_DIR, sanitize(characterName));
      const characterFile = path.join(characterFolder, `与${sanitize(playerName)}的对话.json`);
      if (fs$1.existsSync(characterFile)) {
        result.characterPerspectivePath = characterFile;
      }
    } else {
      // Try to search by scanning folders
      try {
        if (fs$1.existsSync(VOTC_SUMMARIES_DIR)) {
          const entries = fs$1.readdirSync(VOTC_SUMMARIES_DIR, { withFileTypes: true });
          const folders = entries.filter(dirent => dirent.isDirectory());
          
          for (const folder of folders) {
            const folderPath = path.join(VOTC_SUMMARIES_DIR, folder.name);
            const files = fs$1.readdirSync(folderPath).filter(f => f.endsWith('.json'));
            
            for (const file of files) {
              const filePath = path.join(folderPath, file);
              try {
                const content = fs$1.readFileSync(filePath, "utf8");
                const summaries = JSON.parse(content);
                
                if (Array.isArray(summaries) && summaries.length > 0) {
                  const summary = summaries[0];
                  
                  // Check if this file is for the requested conversation
                  if ((summary.playerId == playerId && summary.characterId == characterId) ||
                      (summary.playerId == characterId && summary.characterId == playerId)) {
                    
                    // Determine which perspective this file represents
                    if (summary.playerId == playerId) {
                      result.playerPerspectivePath = filePath;
                      if (!playerName) playerName = summary.playerName;
                      if (!characterName) characterName = summary.characterName;
                    } else {
                      result.characterPerspectivePath = filePath;
                      if (!playerName) playerName = summary.characterName;
                      if (!characterName) characterName = summary.playerName;
                    }
                  }
                }
              } catch (error) {
                console.error(`Failed to read ${filePath}:`, error);
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to search character folders:', error);
      }
    }
    
    return result;
  }
  
  /**
   * Get summaries for a specific Memory Engine 2.2 character conversation.
   */
  static async getSummariesForCharacter(playerId, characterId) {
    // Try new format first: look for character folders
    // The playerId could be a character name (folder name) or an ID
    const characterFolderPath = path.join(VOTC_SUMMARIES_DIR, playerId);
    
    if (fs$1.existsSync(characterFolderPath) && fs$1.statSync(characterFolderPath).isDirectory()) {
      // New format: look for conversation files in the character folder
      try {
        const conversationFiles = fs$1.readdirSync(characterFolderPath).filter((file) => file.endsWith('.json'));
        
        // Try to find a file that matches the characterId
        for (const file of conversationFiles) {
          const filePath = path.join(characterFolderPath, file);
          try {
            const fileContent = fs$1.readFileSync(filePath, "utf8");
            const summaries = JSON.parse(fileContent);
            
            if (Array.isArray(summaries) && summaries.length > 0) {
              // Check if this file is for the requested character
              const firstSummary = summaries[0];
              if (firstSummary.characterId == characterId || firstSummary.characterName === characterId) {
                return summaries;
              }
            }
          } catch (error) {
            console.error(`Failed to read ${filePath}:`, error);
          }
        }
      } catch (error) {
        console.error(`Failed to read character folder ${characterFolderPath}:`, error);
      }
    }
    
    return [];
  }
  /**
   * Update a specific summary's content
   * Updates only the selected owner-folder record.
   */
  static async updateSummary(playerId, characterId, summaryIndex, newContent) {
    const paths = this.findSummaryFilePath(playerId, characterId);
    const filePath = paths.playerPerspectivePath;
    if (!filePath) {
      return { success: false, error: "Summary file not found" };
    }
    try {
      const summaries = JSON.parse(fs$1.readFileSync(filePath, "utf8"));
      if (!Array.isArray(summaries) || summaryIndex < 0 || summaryIndex >= summaries.length) return { success: false, error: "Invalid summary index" };
      summaries[summaryIndex].content = newContent;
      this.writeSummaryJsonAtomic(filePath, summaries);
      return { success: true };
    } catch (error) {
      console.error(`Failed to update summary for character ${characterId} from player ${playerId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  /**
   * Delete a specific summary
   * Deletes only the selected owner-folder record.
   */
  static async deleteSummary(playerId, characterId, summaryIndex) {
    const paths = this.findSummaryFilePath(playerId, characterId);
    const filePath = paths.playerPerspectivePath;
    if (!filePath) {
      return { success: false, error: "Summary file not found" };
    }
    try {
      const summaries = JSON.parse(fs$1.readFileSync(filePath, "utf8"));
      if (!Array.isArray(summaries) || summaryIndex < 0 || summaryIndex >= summaries.length) {
        return { success: false, error: "Invalid summary index" };
      }
      summaries.splice(summaryIndex, 1);
      if (summaries.length === 0) {
        fs$1.unlinkSync(filePath);
      } else {
        this.writeSummaryJsonAtomic(filePath, summaries);
      }
      return { success: true };
    } catch (error) {
      console.error(`Failed to delete summary for character ${characterId} from player ${playerId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  /**
   * Delete all summaries for a character conversation
   * Deletes only the selected owner-folder record.
   */
  static async deleteCharacterSummaries(playerId, characterId) {
    const paths = this.findSummaryFilePath(playerId, characterId);
    const filePath = paths.playerPerspectivePath;
    if (!filePath || !fs$1.existsSync(filePath)) {
      return { success: false, error: "No summary files found" };
    }
    try {
      fs$1.unlinkSync(filePath);
      return { success: true };
    } catch (error) {
      console.error(`Failed to delete owner summary file at ${filePath}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  /**
   * Get a character name from canonical owner-folder summaries.
   */
  static async getCharacterNameFromFile(playerId, characterId) {
    // Find the summary file(s)
    const paths = this.findSummaryFilePath(playerId, characterId);
    
    // Try new format files first
    const filesToCheck = [];
    if (paths.playerPerspectivePath) {
      filesToCheck.push(paths.playerPerspectivePath);
    }
    if (paths.characterPerspectivePath) {
      filesToCheck.push(paths.characterPerspectivePath);
    }
    for (const filePath of filesToCheck) {
      try {
        if (fs$1.existsSync(filePath)) {
          const fileContent = fs$1.readFileSync(filePath, "utf8");
          const summaries = JSON.parse(fileContent);
          if (Array.isArray(summaries) && summaries.length > 0 && summaries[0].characterName) {
            return summaries[0].characterName;
          }
        }
      } catch (error) {
        console.error(`Failed to get character name from ${filePath}:`, error);
      }
    }
    
    return `Character ID: ${characterId}`;
  }
  
}
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
class AppUpdater {
  constructor() {
    this.mainWindow = null;
    this.updateAvailable = false;
    electronUpdater.autoUpdater.logger = log;
    electronUpdater.autoUpdater.autoDownload = false;
    electronUpdater.autoUpdater.autoInstallOnAppQuit = false;
    this.setupEventHandlers();
  }
  setMainWindow(window) {
    this.mainWindow = window;
  }
  checkForUpdates() {
    log.info("Checking for updates...");
    electronUpdater.autoUpdater.allowPrerelease = settingsRepository.getAllowPrerelease();
    log.info(`Prerelease updates ${electronUpdater.autoUpdater.allowPrerelease ? "enabled" : "disabled"}`);
    electronUpdater.autoUpdater.checkForUpdates();
  }
  downloadUpdate() {
    if (this.updateAvailable) {
      log.info("Downloading update...");
      electronUpdater.autoUpdater.downloadUpdate();
    }
  }
  installUpdate() {
    if (this.updateAvailable) {
      log.info("Installing update...");
      electronUpdater.autoUpdater.quitAndInstall(false, true);
    }
  }
  getTranslations() {
    const language = settingsRepository.getLanguage() || "en";
    return updaterTranslations[language] || updaterTranslations.en;
  }
  /**
   * Strip HTML tags and decode common HTML entities from release notes
   */
  stripHtml(html) {
    let text = html.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
    text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/div>/gi, "\n").replace(/<\/li>/gi, "\n").replace(/<li[^>]*>/gi, "• ");
    text = text.replace(/<[^>]+>/g, "");
    text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
    return text;
  }
  formatReleaseNotes(notes) {
    if (!notes) return "No release notes available.";
    let text = this.stripHtml(notes);
    const maxLength = 500;
    if (text.length > maxLength) {
      return text.substring(0, maxLength) + "...";
    }
    return text;
  }
  /**
   * Check if a version is a pre-release
   */
  isPrerelease(version) {
    const prereleasePatterns = [
      /-alpha/i,
      /-beta/i,
      /-rc/i,
      /-pre/i,
      /-preview/i,
      /-dev/i,
      /-test/i,
      /-snapshot/i,
      /\.0a/i,
      /\.0b/i
    ];
    return prereleasePatterns.some((pattern) => pattern.test(version));
  }
  setupEventHandlers() {
    electronUpdater.autoUpdater.on("checking-for-update", () => {
      log.info("Checking for update...");
    });
    electronUpdater.autoUpdater.on("update-available", (info) => {
      log.info("Update available:", info);
      this.updateAvailable = true;
      this.showUpdateAvailableDialog(info);
    });
    electronUpdater.autoUpdater.on("update-not-available", (info) => {
      log.info("Update not available:", info);
    });
    electronUpdater.autoUpdater.on("error", (err) => {
      log.error("Error in auto-updater:", err);
    });
    electronUpdater.autoUpdater.on("download-progress", (progressObj) => {
      let log_message = "Download speed: " + progressObj.bytesPerSecond;
      log_message = log_message + " - Downloaded " + progressObj.percent + "%";
      log_message = log_message + " (" + progressObj.transferred + "/" + progressObj.total + ")";
      log.info(log_message);
    });
    electronUpdater.autoUpdater.on("update-downloaded", (info) => {
      log.info("Update downloaded:", info);
      this.showUpdateDownloadedDialog();
    });
  }
  async showUpdateAvailableDialog(info) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const t = this.getTranslations();
    const releaseNotes = this.formatReleaseNotes(info.releaseNotes);
    const isPrerelease = this.isPrerelease(info.version);
    const strings = isPrerelease ? t.updateAvailablePrerelease : t.updateAvailable;
    const result = await electron.dialog.showMessageBox(this.mainWindow, {
      type: "info",
      title: strings.title,
      message: strings.message.replace("{version}", info.version),
      detail: strings.detail.replace("{releaseNotes}", releaseNotes),
      buttons: [strings.download, strings.viewChangelog, strings.later],
      defaultId: 0,
      cancelId: 2
    });
    switch (result.response) {
      case 0:
        this.downloadUpdate();
        break;
      case 1:
        const changelogUrl = this.getChangelogUrl(info.version);
        await electron.shell.openExternal(changelogUrl);
        this.showUpdateAvailableDialog(info);
        break;
    }
  }
  /**
   * Get the changelog URL for a given version
   */
  getChangelogUrl(version) {
    return `https://github.com/Voices-of-the-Court/VOTC/releases/tag/v${version}`;
  }
  async showUpdateDownloadedDialog() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const t = this.getTranslations();
    const result = await electron.dialog.showMessageBox(this.mainWindow, {
      type: "info",
      title: t.updateDownloaded.title,
      message: t.updateDownloaded.message,
      detail: t.updateDownloaded.detail,
      buttons: [t.updateDownloaded.installNow, t.updateDownloaded.installOnExit],
      defaultId: 0,
      cancelId: 1
    });
    switch (result.response) {
      case 0:
        this.installUpdate();
        break;
      case 1:
        electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
        break;
    }
  }
}
const appUpdater = new AppUpdater();
class FocusMonitor extends events.EventEmitter {
  constructor() {
    super();
    this.pollingInterval = null;
    this.isOverlayMode = false;
    this.lastStateChangeTime = 0;
    this.POLL_INTERVAL_MS = 500;
    this.MIN_STATE_CHANGE_INTERVAL_MS = 200;
  }
  /**
   * Start monitoring the active window
   */
  start() {
    if (this.pollingInterval) {
      console.log("FocusMonitor: Already running");
      return;
    }
    console.log("FocusMonitor: Starting...");
    this.checkActiveWindow();
    this.pollingInterval = setInterval(() => {
      this.checkActiveWindow();
    }, this.POLL_INTERVAL_MS);
  }
  /**
   * Stop monitoring the active window
   */
  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log("FocusMonitor: Stopped");
    }
  }
  /**
   * Get the current overlay state
   */
  getCurrentOverlayState() {
    return this.isOverlayMode;
  }
  /**
   * Check the currently active window and update overlay state
   */
  async checkActiveWindow() {
    try {
      const activeWindow = await activeWin();
      if (!activeWindow) {
        return;
      }
      const shouldBeOverlay = this.shouldBeInOverlayMode(activeWindow);
      if (shouldBeOverlay !== this.isOverlayMode) {
        const now = Date.now();
        if (now - this.lastStateChangeTime >= this.MIN_STATE_CHANGE_INTERVAL_MS) {
          this.isOverlayMode = shouldBeOverlay;
          this.lastStateChangeTime = now;
          console.log(`FocusMonitor: Overlay mode ${shouldBeOverlay ? "ENABLED" : "DISABLED"} (focused: ${activeWindow.owner.name})`);
          this.emit("overlay-state-changed", shouldBeOverlay);
        }
      }
    } catch (error) {
      if (error instanceof Error && !error.message.includes("EACCES")) {
        console.error("FocusMonitor: Error checking active window:", error);
      }
    }
  }
  /**
   * Determine if the app should be in overlay mode based on the active window
   */
  shouldBeInOverlayMode(activeWindow) {
    const processName = activeWindow.owner.name.toLowerCase();
    const processPath = activeWindow.owner.path?.toLowerCase() || "";
    if (processName.includes("ck3") || processPath.includes("ck3.exe")) {
      return true;
    }
    const ourAppName = this.getOurAppName();
    if (processName.includes(ourAppName.toLowerCase())) {
      return true;
    }
    const ourAppPath = process.execPath.toLowerCase();
    if (processPath === ourAppPath) {
      return true;
    }
    return false;
  }
  /**
   * Get the name of our application executable
   */
  getOurAppName() {
    if (electron.app.isPackaged) {
      return electron.app.getName();
    } else {
      return "electron";
    }
  }
}
const focusMonitor = new FocusMonitor();
const appIcon = path.join(__dirname, "./chunks/icon-BljXrxwL.ico");
registerProviderImplementations(providerRegistry);
class LetterPromptBuilder {
  constructor() {
    this.templateEngine = new TemplateEngine();
    this.scriptLoader = new PromptScriptLoader();
  }
  buildMessages(gameData, letter) {
    const ai = gameData.getAi();
    const player = gameData.getPlayer();
    if (!ai || !player) {
      throw new Error("Missing player or AI character data for letter prompt");
    }
    const settings = settingsRepository.getLetterPromptSettings();
    const messages = [];
    const context = {
      character: ai,
      player,
      ai,
      gameData,
      letter
    };
    const mentionableProfiles = gameData.getMentionableCharacterProfiles();
    const ownerFolderMemories = memoryEngine.loadOwnerFolderMemories(ai.id);
    for (const [characterId, profile] of memoryEngine.getMentionableProfilesFromFolderMemories(ownerFolderMemories)) {
      if (!mentionableProfiles.has(characterId)) mentionableProfiles.set(characterId, profile);
    }
    const mentionedEntityIds = memoryEngine.findMentionedCharactersInHistory({
      history: [{ id: letter.id || "letter", role: "user", content: letter.content || "" }],
      candidates: [...mentionableProfiles.values()],
      excludedIds: gameData.getMentionExclusionIds([ai.id, player.id])
    });
    const mentionedEntityNames = Object.fromEntries(mentionedEntityIds.map((characterId) => {
      const character = mentionableProfiles.get(characterId);
      return [characterId, character ? memorySystem.getCharacterMentionAliases(character) : []];
    }));
    const memoryContext = memoryEngine.retrieveForResponder({
      characterId: ai.id,
      query: letter.content || "",
      directCounterpartIds: [player.id],
      mentionedEntityIds,
      mentionedEntityNames,
      ownerFolderMemories,
      currentTotalDays: gameData.totalDays,
      tokenBudget: 800,
      estimateTokens: (text) => TokenCounter.estimateTokens(text)
    });
    context.memoryContext = memoryContext;
    let memoryInserted = false;
    for (const block of settings.blocks || []) {
      if (!block.enabled) continue;
      if (!memoryInserted && block.type === "instruction") {
        for (const content of [memoryContext.stableText, memoryContext.relevantText].filter(Boolean)) {
          messages.push({ role: "system", content });
        }
        memoryInserted = true;
      }
      this.applyBlock(block, messages, context, settings);
    }
    if (settings.suffix?.enabled && settings.suffix.template) {
      const suffixContent = this.templateEngine.renderTemplateString(settings.suffix.template, context);
      messages.push({ role: "system", content: suffixContent });
    }
    console.log(`[LetterPromptBuilder] Built ${messages.length} messages (${TokenCounter.calculateTotalTokens(messages)} estimated tokens)`);
    logVerboseLLM("[LetterPromptBuilder][verbose] Messages:", messages);
    return messages;
  }
  buildPreview(gameData, letter) {
    const messages = this.buildMessages(gameData, letter);
    return messages.map((m) => `${m.role?.toUpperCase() || "SYSTEM"}: ${m.content}`).join("\n\n");
  }
  applyBlock(block, messages, context, settings) {
    const { character, gameData } = context;
    switch (block.type) {
      case "main": {
        const template = settings.mainTemplate || promptConfigManager.getDefaultLetterMainTemplateContent();
        const content = this.templateEngine.renderTemplateString(template, context);
        if (content?.trim()) {
          const role = block.role || "system";
          messages.push({ role, content });
        }
        break;
      }
      case "description": {
        if (!block.scriptPath) break;
        try {
          const descScriptPath = promptConfigManager.resolvePath(block.scriptPath);
          const description = this.scriptLoader.executeDescription(descScriptPath, gameData, character.id);
          if (description) {
            messages.push({ role: "system", content: description });
          }
        } catch (error) {
          console.error("Failed to render letter description script:", error);
        }
        break;
      }
      case "past_summaries": {
        if (context.memoryContext?.engineVersion?.startsWith("2.")) break;
        const summaries = this.buildPastSummariesContext(character, gameData);
        if (summaries) {
          const content = block.template ? this.templateEngine.renderTemplateString(block.template, { ...context, pastSummaries: summaries }) : summaries;
          const role = block.role || "system";
          messages.push({ role, content });
        }
        break;
      }
      case "memories": {
        const memoriesBlock = this.buildAllMemoriesBlock(context.player, character, block.template, context);
        if (memoriesBlock) {
          const role = block.role || "system";
          messages.push({ role, content: memoriesBlock });
        }
        break;
      }
      case "instruction": {
        const tpl = block.template || `你收到了来自 {{player.fullName}} 的信件：
"{{letter.content}}"
以 {{character.fullName}} 的身份回信。`;
        const content = this.templateEngine.renderTemplateString(tpl, context);
        const role = block.role || "user";
        messages.push({ role, content });
        break;
      }
      case "custom": {
        if (!block.template) break;
        const content = this.templateEngine.renderTemplateString(block.template, context);
        const role = block.role || "system";
        messages.push({ role, content });
        break;
      }
    }
  }
  buildPastSummariesContext(char, gameData) {
    if (!char.conversationSummaries || char.conversationSummaries.length === 0) {
      return null;
    }

    let context = `${char.shortName} 与 ${gameData.playerName} 之间最近的往来：
`;

    // Use the 3 most recent summaries from current conversation
    const recentSummaries = char.conversationSummaries.slice(0, 3);
    for (const summary of recentSummaries) {
      context += `${summary.date}：${summary.content}
`;
    }

    // Note: Dynamic memory loading not implemented for letters
    // Letters are one-way communication so we don't have conversation history to analyze
    // If needed, can be enhanced to detect mentioned names in the incoming letter text

    return context;
  }
  buildAllMemoriesBlock(player, ai, template, context = {}) {
    const memories = (ai.memories || []).map((memory) => ({ ...memory, character: ai.shortName }));
    if (memories.length === 0) return null;
    const tpl = template || `所有相关角色的记忆：
{{#each memories}}- {{this.character}} | {{this.creationDate}}（{{this.creationDateTotalDays}}）：{{this.desc}} [相关性：{{this.relevanceWeight}}]
{{/each}}`;
    return this.templateEngine.renderTemplateString(tpl, { ...context, memories });
  }
}
const letterPromptBuilder = new LetterPromptBuilder();
var LetterResponseStatus = /* @__PURE__ */ ((LetterResponseStatus2) => {
  LetterResponseStatus2["GENERATING"] = "generating";
  LetterResponseStatus2["GENERATED"] = "generated";
  LetterResponseStatus2["GENERATION_FAILED"] = "generation_failed";
  LetterResponseStatus2["PENDING_DELIVERY"] = "pending_delivery";
  LetterResponseStatus2["SENT"] = "sent";
  LetterResponseStatus2["SEND_FAILED"] = "send_failed";
  return LetterResponseStatus2;
})(LetterResponseStatus || {});
var LetterSummaryStatus = /* @__PURE__ */ ((LetterSummaryStatus2) => {
  LetterSummaryStatus2["NOT_STARTED"] = "not_started";
  LetterSummaryStatus2["GENERATING"] = "generating";
  LetterSummaryStatus2["GENERATED"] = "generated";
  LetterSummaryStatus2["GENERATION_FAILED"] = "generation_failed";
  LetterSummaryStatus2["SAVED"] = "saved";
  LetterSummaryStatus2["SAVE_FAILED"] = "save_failed";
  return LetterSummaryStatus2;
})(LetterSummaryStatus || {});
class LetterManager {
  // 5 minutes
  constructor() {
    this.currentTotalDays = 0;
    this.storedLetters = /* @__PURE__ */ new Map();
    this.letterStatuses = /* @__PURE__ */ new Map();
    this.tailFile = null;
    this.readline = null;
    this.lastCleanTime = 0;
    this.CLEAN_INTERVAL_MS = 3e5;
    const ck3UserPath = settingsRepository.getCK3UserFolderPath();
    if (ck3UserPath) {
      this.startLogTailing();
    } else {
      console.log("LetterManager: CK3 user path not configured yet, will start tailing when path is set");
    }
  }
  /**
   * Start tailing the debug.log file to track VOTC:DATE updates
   */
  async startLogTailing() {
    const ck3UserPath = settingsRepository.getCK3UserFolderPath();
    console.log(`LetterManager: CK3 user path from settings: ${ck3UserPath}`);
    const debugLogPath = settingsRepository.getCK3DebugLogPath();
    console.log(`LetterManager: Resolved debug log path: ${debugLogPath}`);
    if (!debugLogPath) {
      console.warn("LetterManager: CK3 debug log path is not configured; cannot start log tailing.");
      return;
    }
    if (!fs$1.existsSync(debugLogPath)) {
      console.warn(`LetterManager: Debug log file does not exist: ${debugLogPath}`);
      return;
    }
    try {
      this.tailFile = new TailFile(debugLogPath, { encoding: "utf8" }).on("tail_error", (err) => {
        console.error("Tail error:", err);
      });
      await this.tailFile.start();
      console.log(`Started tailing debug log: ${debugLogPath}`);
      this.readline = readline$1.createInterface({ input: this.tailFile });
      this.readline.on("line", (line) => {
        this.processLogLine(line, debugLogPath);
      });
    } catch (error) {
      console.error("Failed to start log tailing:", error);
    }
  }
  /**
   * Process a single log line looking for VOTC:DATE
   */
  processLogLine(line, debugLogPath) {
    const dateRegex = /VOTC:DATE\/;\/(\d+)/;
    const match = line.match(dateRegex);
    if (match) {
      const newTotalDays = Number(match[1]);
      this.updateCurrentDate(newTotalDays);
    }
    const now = Date.now();
    if (now - this.lastCleanTime >= this.CLEAN_INTERVAL_MS) {
      this.lastCleanTime = now;
      cleanLogFile(debugLogPath);
    }
  }
  /**
   * Update current date and handle time travel detection
   */
  updateCurrentDate(newTotalDays) {
    const oldTotalDays = this.currentTotalDays;
    if (oldTotalDays > 0 && newTotalDays < oldTotalDays) {
      console.log(`Time travel detected (backwards). Removing letters sent after new date. | Old date: ${oldTotalDays} | New date: ${newTotalDays}`);
      this.removeLettersAfterDate(newTotalDays);
    } else if (oldTotalDays > 0 && newTotalDays - oldTotalDays > 40) {
      console.log("Large time jump detected (>40 days). Removing letters sent after old date.");
      this.removeLettersAfterDate(oldTotalDays);
    }
    this.currentTotalDays = newTotalDays;
    this.checkAndDeliverLetters();
  }
  /**
   * Remove letters that were generated after a certain date (time travel cleanup)
   */
  removeLettersAfterDate(cutoffDate) {
    const lettersToRemove = [];
    for (const [letterId, storedLetter] of this.storedLetters.entries()) {
      if (storedLetter.letter.totalDays > cutoffDate) {
        lettersToRemove.push(letterId);
      }
    }
    for (const letterId of lettersToRemove) {
      console.log(`Removing letter ${letterId} due to time travel`);
      this.storedLetters.delete(letterId);
    }
  }
  /**
   * Check stored letters and deliver any that are ready
   */
  checkAndDeliverLetters() {
    for (const [letterId, storedLetter] of this.storedLetters.entries()) {
      if (this.currentTotalDays >= storedLetter.expectedDeliveryDay) {
        console.log(`Delivering letter ${letterId} (current: ${this.currentTotalDays}, expected: ${storedLetter.expectedDeliveryDay})`);
        this.deliverLetter(storedLetter);
        this.storedLetters.delete(letterId);
      }
    }
  }
  /**
   * Deliver a letter by writing the effect file and updating localization
   */
  async deliverLetter(storedLetter) {
    await this.writeLetterEffect(storedLetter.reply, storedLetter.letter);
  }
  /**
   * Process a new letter: generate response immediately but store it for delayed delivery
   */
  async processLatestLetter() {
    const ck3UserPath = settingsRepository.getCK3UserFolderPath();
    if (ck3UserPath) {
      const runFolder = path.join(ck3UserPath, "run");
      const letterFilePath = path.join(runFolder, "letters.txt");
      console.log(`LetterManager: Resolved letters.txt path: ${letterFilePath}`);
      fs$1.writeFileSync(letterFilePath, `debug_log = "[Localize('talk_event.9999.desc')]"`, "utf-8");
      console.log("Created letters.txt file");
    }
    const context = await this.loadLatestGameDataWithLetter();
    if (!context) return null;
    const { gameData, letter } = context;
    const characterName = gameData.getAi()?.fullName || "Unknown";
    this.createLetterStatus(letter, characterName);
    this.updateLetterStatus(letter.letterId, { responseStatus: LetterResponseStatus.GENERATING });
    const messages = letterPromptBuilder.buildMessages(gameData, letter);
    let reply = null;
    let responseError = null;
    try {
      const result = await llmManager.sendChatRequest(messages, void 0, true, { requestType: "letter", character: characterName });
      reply = await this.extractReply(result);
      if (!reply) {
        throw new Error("Letter reply generation returned empty content.");
      }
      this.updateLetterStatus(letter.letterId, {
        responseStatus: LetterResponseStatus.GENERATED,
        responseContent: reply,
        responseError: null
      });
    } catch (error) {
      responseError = error instanceof Error ? error.message : "Unknown error";
      console.error("Letter reply generation failed:", error);
      this.updateLetterStatus(letter.letterId, {
        responseStatus: LetterResponseStatus.GENERATION_FAILED,
        responseError
      });
      return null;
    }
    await this.generateSummary(gameData, letter, reply);
    const expectedDeliveryDay = letter.totalDays + letter.delay;
    const storedLetter = {
      letter,
      reply,
      expectedDeliveryDay
    };
    this.storedLetters.set(letter.letterId, storedLetter);
    this.updateLetterStatus(letter.letterId, {
      responseStatus: LetterResponseStatus.PENDING_DELIVERY,
      expectedDeliveryDay,
      daysUntilDelivery: expectedDeliveryDay - this.currentTotalDays,
      isLate: this.currentTotalDays > expectedDeliveryDay
    });
    console.log(`Letter ${letter.letterId} generated and stored. Will deliver on day ${expectedDeliveryDay} (current: ${this.currentTotalDays})`);
    if (this.currentTotalDays >= expectedDeliveryDay) {
      console.log(`Letter ${letter.letterId} is ready for immediate delivery`);
      await this.deliverLetter(storedLetter);
      this.storedLetters.delete(letter.letterId);
    }
    return reply;
  }
  async buildPromptPreview() {
    const context = await this.loadLatestGameDataWithLetter();
    if (!context) return null;
    const { gameData, letter } = context;
    return letterPromptBuilder.buildPreview(gameData, letter);
  }
  async loadLatestGameDataWithLetter() {
    const debugLogPath = settingsRepository.getCK3DebugLogPath();
    if (!debugLogPath) {
      console.warn("CK3 debug log path is not configured; cannot process letter.");
      return null;
    }
    const gameData = await parseLog(debugLogPath);
    gameData.loadCharactersSummaries();
    const letter = gameData.letterData;
    if (!letter) {
      console.warn("No letter data found in parsed game data.");
      return null;
    }
    return { gameData, letter };
  }
  async extractReply(result) {
    if (result && typeof result === "object" && "content" in result) {
      const content = result.content;
      return typeof content === "string" ? content.trim() : null;
    }
    if (result && typeof result[Symbol.asyncIterator] === "function") {
      let text = "";
      for await (const chunk of result) {
        if (chunk?.delta?.content) {
          text += chunk.delta.content;
        }
      }
      return text.trim() || null;
    }
    return null;
  }
  async generateSummary(gameData, letter, reply) {
    const ai = gameData.getAi();
    if (!ai) return;
    this.updateLetterStatus(letter.letterId, {
      summaryStatus: LetterSummaryStatus.GENERATING
    });
    const summarySettings = settingsRepository.getSummaryPromptSettings();
    const summaryPrompt = [
      {
        role: "system",
        content: `Stable letter-summary instructions:\n${summarySettings.letterSummaryPrompt}`
      },
      {
        role: "system",
        content: `${gameData.playerName} letter to ${ai.fullName}:
"${letter.content}"

Reply from ${ai.fullName}:
"${reply}"`
      },
      {
        role: "user",
        content: "Generate the concise letter summary now."
      }
    ];
    try {
      console.log(`[TOKEN_COUNT] Letter summary prompt tokens: ${TokenCounter.estimateMessageTokens(summaryPrompt[0])}`);
      console.log(`[TOKEN_COUNT] Letter summary letters letters content tokens: ${TokenCounter.estimateMessageTokens(summaryPrompt[1])}`);
      const summaryResult = await llmManager.sendSummaryRequest(summaryPrompt, void 0, { requestType: "letter_summary", character: ai.shortName });
      if (summaryResult && typeof summaryResult === "object" && "content" in summaryResult) {
        const summary = summaryResult.content;
        if (summary?.trim()) {
          this.updateLetterStatus(letter.letterId, {
            summaryStatus: LetterSummaryStatus.GENERATED,
            summaryContent: summary.trim(),
            summaryError: null
          });
          gameData.saveCharacterSummary(ai.id, {
            date: gameData.date,
            totalDays: gameData.totalDays,
            content: summary.trim()
          });
          memoryEngine.recordLetterMemory({
            senderId: gameData.playerID,
            recipientId: ai.id,
            content: summary.trim(),
            date: gameData.date,
            totalDays: gameData.totalDays,
            letterId: letter.letterId
          });
          this.updateLetterStatus(letter.letterId, {
            summaryStatus: LetterSummaryStatus.SAVED
          });
        }
      }
    } catch (error) {
      const summaryError = error instanceof Error ? error.message : "Unknown error";
      console.error("Failed to generate letter summary:", error);
      this.updateLetterStatus(letter.letterId, {
        summaryStatus: LetterSummaryStatus.GENERATION_FAILED,
        summaryError
      });
    }
  }
  async writeLetterEffect(reply, letter) {
    const ck3Folder = settingsRepository.getCK3UserFolderPath();
    console.log(`LetterManager.writeLetterEffect: CK3 user path: ${ck3Folder}`);
    if (!ck3Folder) {
      console.warn("LetterManager.writeLetterEffect: CK3 user folder is not configured; skipping writing letter effect.");
      this.updateLetterStatus(letter.letterId, {
        responseStatus: LetterResponseStatus.SEND_FAILED,
        responseError: "CK3 user folder not configured"
      });
      return;
    }
    const runFolder = path.join(ck3Folder, "run");
    console.log(`LetterManager.writeLetterEffect: Run folder path: ${runFolder}`);
    try {
      fs$1.mkdirSync(runFolder, { recursive: true });
      console.log(`LetterManager.writeLetterEffect: Run folder created/verified`);
    } catch (error) {
      const errorMessage = `Failed to create run folder: ${error instanceof Error ? error.message : "Unknown error"}`;
      console.error(`LetterManager.writeLetterEffect: ${errorMessage}`);
      this.updateLetterStatus(letter.letterId, {
        responseStatus: LetterResponseStatus.SEND_FAILED,
        responseError: errorMessage
      });
      return;
    }
    const letterFilePath = path.join(runFolder, `letters.txt`);
    console.log(`LetterManager.writeLetterEffect: Letter file path: ${letterFilePath}`);
    const escapedReply = reply.replace(/"/g, '\\"');
    const gameCommand = `debug_log = "[Localize('talk_event.9999.desc')]"
remove_global_variable ?= votc_${letter.letterId}
create_artifact = {
	name = votc_huixin_title${letter.letterId.replace(/letter_/, "")}
	description = "${escapedReply}"
	type = journal
	visuals = scroll
	creator = global_var:message_second_scope_${letter.letterId}
	modifier = artifact_monthly_minor_prestige_1_modifier
	wealth = scope:wealth
	save_scope_as = votc_latest_letter
}
scope:votc_latest_letter = {
set_variable = { name = votc_letter_artifact value = yes}
}
set_global_variable = {
	name = votc_latest_letter
	value = scope:votc_latest_letter
}
trigger_event = message_event.362`;
    try {
      fs$1.writeFileSync(letterFilePath, gameCommand, "utf-8");
      this.updateLetterStatus(letter.letterId, {
        responseStatus: LetterResponseStatus.SENT,
        responseError: null
      });
    } catch (error) {
      const errorMessage = `Failed to write letter effect: ${error instanceof Error ? error.message : "Unknown error"}`;
      console.error(`LetterManager.writeLetterEffect: ${errorMessage}`);
      this.updateLetterStatus(letter.letterId, {
        responseStatus: LetterResponseStatus.SEND_FAILED,
        responseError: errorMessage
      });
    }
  }
  /**
   * Clear the letters.txt file
   */
  clearLettersFile() {
    const ck3Folder = settingsRepository.getCK3UserFolderPath();
    console.log(`LetterManager.clearLettersFile: CK3 user path: ${ck3Folder}`);
    if (!ck3Folder) {
      console.warn("LetterManager.clearLettersFile: CK3 user folder is not configured; cannot clear letters file.");
      return;
    }
    const runFolder = path.join(ck3Folder, "run");
    const letterFilePath = path.join(runFolder, "letters.txt");
    console.log(`LetterManager.clearLettersFile: Letter file path: ${letterFilePath}`);
    if (fs$1.existsSync(letterFilePath)) {
      fs$1.writeFileSync(letterFilePath, `debug_log = "[Localize('talk_event.9999.desc')]"`, "utf-8");
      console.log("Cleared letters.txt file");
    } else {
      console.log("letters.txt file does not exist, nothing to clear");
    }
  }
  /**
   * Stop log tailing (cleanup)
   */
  async stopLogTailing() {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    if (this.tailFile) {
      await this.tailFile.quit();
      this.tailFile = null;
      console.log("Stopped log tailing");
    }
  }
  /**
   * Restart log tailing (useful when CK3 path is updated)
   */
  async restartLogTailing() {
    console.log("Restarting log tailing...");
    await this.stopLogTailing();
    this.currentTotalDays = 0;
    await this.startLogTailing();
  }
  /**
   * Get current tracked date
   */
  getCurrentTotalDays() {
    return this.currentTotalDays;
  }
  /**
   * Create initial letter status entry
   */
  createLetterStatus(letter, characterName) {
    const statusInfo = {
      letterId: letter.letterId,
      letterContent: letter.content,
      responseContent: null,
      responseStatus: LetterResponseStatus.GENERATING,
      responseError: null,
      summaryStatus: LetterSummaryStatus.NOT_STARTED,
      summaryContent: null,
      summaryError: null,
      createdAt: Date.now(),
      expectedDeliveryDay: letter.totalDays + letter.delay,
      currentDay: this.currentTotalDays,
      daysUntilDelivery: letter.totalDays + letter.delay - this.currentTotalDays,
      isLate: this.currentTotalDays > letter.totalDays + letter.delay,
      characterName
    };
    this.letterStatuses.set(letter.letterId, statusInfo);
  }
  /**
   * Update letter status information
   */
  updateLetterStatus(letterId, updates) {
    const existing = this.letterStatuses.get(letterId);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.letterStatuses.set(letterId, updated);
    }
  }
  /**
   * Get letter status by ID
   */
  getLetterStatus(letterId) {
    return this.letterStatuses.get(letterId) || null;
  }
  /**
   * Get all letter statuses
   */
  getAllLetterStatuses() {
    for (const status of this.letterStatuses.values()) {
      status.currentDay = this.currentTotalDays;
      status.daysUntilDelivery = status.expectedDeliveryDay - this.currentTotalDays;
      status.isLate = this.currentTotalDays > status.expectedDeliveryDay;
    }
    return {
      letters: Array.from(this.letterStatuses.values()),
      currentTotalDays: this.currentTotalDays,
      timestamp: Date.now()
    };
  }
  /**
   * Clear old completed statuses to manage memory
   */
  clearOldStatuses(daysThreshold = 30) {
    const cutoffTime = Date.now() - daysThreshold * 24 * 60 * 60 * 1e3;
    const statusesToRemove = [];
    for (const [letterId, status] of this.letterStatuses.entries()) {
      if (status.responseStatus === LetterResponseStatus.SENT && status.summaryStatus === LetterSummaryStatus.SAVED && status.createdAt < cutoffTime) {
        statusesToRemove.push(letterId);
      }
    }
    for (const letterId of statusesToRemove) {
      this.letterStatuses.delete(letterId);
      console.log(`Cleared old letter status: ${letterId}`);
    }
    if (statusesToRemove.length > 0) {
      console.log(`Cleared ${statusesToRemove.length} old letter statuses`);
    }
  }
}
const letterManager = new LetterManager();
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
const setupIpcHandlers = () => registerIpcHandlers({
  electron,
  settingsRepository,
  promptConfigManager,
  uuid,
  VOTC_PROMPTS_DIR,
  TemplateEngine,
  exportPromptsZip,
  letterManager,
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
  get chatWindow() {
    return chatWindow;
  }
});
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
electron.app.on("ready", () => {
  console.log(electron.app.getPath("userData"));
  clearLog();
  settingsRepository.migrateProviderSecrets();
  promptConfigManager.seedDefaults();
  setupIpcHandlers();
  chatWindow = createWindow();
  appUpdater.setMainWindow(chatWindow);
  if (electron.app.isPackaged) {
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
    console.log("VOTC:EFFECT_ACCEPTED detected - clearing run file");
    runFileManager.clear();
  });
  clipboardListener.on("VOTC:LETTER", async () => {
    console.log("VOTC:LETTER detected - generating reply");
    try {
      await letterManager.processLatestLetter();
    } catch (error) {
      console.error("Failed to process letter:", error);
    }
  });
  clipboardListener.on("VOTC:LETTER_ACCEPTED", () => {
    console.log("VOTC:LETTER_ACCEPTED detected - clearing letters.txt");
    try {
      letterManager.clearLettersFile();
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
  focusMonitor.stop();
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
