"use strict";

function createSettingsRepository({ Store, schema, SecureProviderSecrets, electron, providerTypes, defaultProviderConfigs, defaultActiveProvider, promptConfigManager, logVerboseLLM, hashPromptAsset, path, fs, promptsDir, defaultPromptsDir, defaultMainTemplatePath, legacyBundledPromptHashes }) {
  const PROVIDER_TYPES = providerTypes;
  const DEFAULT_PROVIDER_CONFIGS = defaultProviderConfigs;
  const DEFAULT_ACTIVE_PROVIDER = defaultActiveProvider;
  const fs$1 = fs;
  const VOTC_PROMPTS_DIR = promptsDir;
  const DEFAULT_USERDATA_DIR$1 = defaultPromptsDir;
  const DEFAULT_MAIN_TEMPLATE_PATH = defaultMainTemplatePath;
  const LEGACY_BUNDLED_PROMPT_HASHES = legacyBundledPromptHashes;
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
          letterSummaryPrompt: "",
          finalSummaryMaxTokens: 4096
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
      const config = overrideId ? this.getProviderConfigById(overrideId) : this.getActiveProviderConfig();
      return config?.providerType === "deepseek" ? {
        ...config,
        useMinimizedActionsSchema: false,
        actionSchemaDeliveryMode: config.actionSchemaDeliveryMode || "optimized_local_validation",
        deepseekActionStateTransitionRecallOverlay: config.deepseekActionStateTransitionRecallOverlay === true,
        deepseekActionStablePrefixOptimization: config.deepseekActionStablePrefixOptimization === true
      } : config;
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
      return `为这次对话创建高信息密度的中文最终摘要。
  
  摘要不设置固定字数或段落数量；应根据原始对话的信息量，在当前配置的输出 Token 上限内完整保留细节。请在不遗漏实质内容、人物归属、因果关系和关键细节的前提下尽量精简，删去重复和低信息量措辞，不得为了凑长度虚构内容，也不得任意压缩成几句概述。按实际发生顺序组织连贯内容，并做到：
  
  1. 每项言论、行动、观点、情绪和决定都明确归属于具体人物，不混淆多人视角。
  2. 写清对话背景、时间、地点、事件先后及因果关系；保留确切人名、头衔、数字、日期、物件和关键措辞。
  3. 记录每个人提出、接受、拒绝、隐瞒或计划的内容，包括请求、条件、承诺、协议、秘密、冲突与未决事项。
  4. 描述语气和情绪如何变化，以及这些变化对信任、亲密、敌意、权力关系或后续行动的影响。
  5. 只在措辞本身影响含义时保留简短原话；不要大段抄写，也不要重复同一事实。
  6. 知情范围发生变化时必须分段；角色睡着、昏迷、离场、独处、自言自语、默想或实施未被他人察觉的行为时，不得把相关内容写成所有在场者共同知情。
  
  不得笼统写成“双方讨论了某事”“关系有所发展”或“交换了意见”；必须说明谁说了什么、为何这样说、对方如何回应，以及最终达成或尚未解决的结果。`;
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
        letterSummaryPrompt: "",
        finalSummaryMaxTokens: 4096
      });
      const configuredMaxTokens = Number(stored.finalSummaryMaxTokens);
      const finalSummaryMaxTokens = Number.isInteger(configuredMaxTokens) && configuredMaxTokens >= 256 && configuredMaxTokens <= 16384 ? configuredMaxTokens : 4096;
      return {
        rollingPrompt: stored.rollingPrompt || this.getDefaultRollingSummaryPrompt(),
        finalPrompt: stored.finalPrompt || this.getDefaultFinalSummaryPrompt(),
        letterSummaryPrompt: stored.letterSummaryPrompt || this.getDefaultLetterSummaryPrompt(),
        finalSummaryMaxTokens
      };
    }
    saveSummaryPromptSettings(settings) {
      const configuredMaxTokens = Number(settings?.finalSummaryMaxTokens);
      this.store.set("summaryPromptSettings", {
        ...settings,
        finalSummaryMaxTokens: Number.isInteger(configuredMaxTokens) && configuredMaxTokens >= 256 && configuredMaxTokens <= 16384 ? configuredMaxTokens : 4096
      });
      console.log("Summary prompt settings saved.");
      logVerboseLLM("[Settings][verbose] Summary prompt settings:", settings);
    }
  }
  
  return SettingsRepository;
}

module.exports = { createSettingsRepository };
