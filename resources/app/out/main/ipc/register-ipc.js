"use strict";

const path = require("path");

function requireInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}_must_be_an_integer_between_${min}_and_${max}`);
  return value;
}

function validateExternalHttpUrl(value) {
  if (typeof value !== "string") throw new Error("external_url_must_be_a_string");
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw new Error("external_url_must_be_valid");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("external_url_protocol_not_allowed");
  return parsed.toString();
}

function validateActionFilePath(filePath, actionsRoot) {
  if (typeof filePath !== "string" || !filePath) throw new Error("action_file_path_required");
  const root = path.resolve(actionsRoot);
  const relative = path.relative(root, path.resolve(filePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("action_file_path_outside_actions_root");
  return path.join(root, relative);
}

function registerIpcHandlers(runtime) {
  const { electron, settingsRepository, promptConfigManager, uuid, VOTC_PROMPTS_DIR, TemplateEngine, exportPromptsZip, letterManager, llmManager, providerRegistry, usageAnalytics, actionRegistry, VOTC_ACTIONS_DIR, resolveI18nString, conversationManager, ActionEngine, VOTC_SUMMARIES_DIR, SummariesManager, memoryEngine } = runtime;

  electron.ipcMain.handle("toggle-config-panel", () => {
    if (runtime.chatWindow) {
      runtime.chatWindow.webContents.send("toggle-settings");
    }
    return true;
  });
  electron.ipcMain.handle("llm:getAppSettings", () => {
    return settingsRepository.getAppSettings();
  });
  electron.ipcMain.handle("prompts:getSettings", () => {
    return settingsRepository.getPromptSettings();
  });
  electron.ipcMain.handle("prompts:saveSettings", (_event, settings) => {
    settingsRepository.savePromptSettings(settings);
    return true;
  });
  electron.ipcMain.handle("prompts:getLetterSettings", () => {
    return settingsRepository.getLetterPromptSettings();
  });
  electron.ipcMain.handle("prompts:saveLetterSettings", (_event, settings) => {
    settingsRepository.saveLetterPromptSettings(settings);
    return true;
  });
  electron.ipcMain.handle("prompts:list", (_event, category) => {
    try {
      return promptConfigManager.listFiles(category);
    } catch (error) {
      console.error("Failed to list prompt files:", error);
      return [];
    }
  });
  electron.ipcMain.handle("prompts:readFile", (_event, relativePath) => {
    try {
      return promptConfigManager.readPromptFile(relativePath);
    } catch (error) {
      console.error("Failed to read prompt file:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("prompts:saveFile", (_event, relativePath, content) => {
    try {
      promptConfigManager.savePromptFile(relativePath, content);
      return true;
    } catch (error) {
      console.error("Failed to save prompt file:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("prompts:getDefaultMain", () => {
    return promptConfigManager.getDefaultMainTemplateContent();
  });
  electron.ipcMain.handle("prompts:getDefaultLetterMain", () => {
    return promptConfigManager.getDefaultLetterMainTemplateContent();
  });
  electron.ipcMain.handle("prompts:listPresets", () => {
    return promptConfigManager.getPresets();
  });
  electron.ipcMain.handle("prompts:savePreset", (_event, preset) => {
    const normalizedSettings = promptConfigManager.normalizeSettings(preset.settings);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const toSave = {
      id: preset.id || uuid.v4(),
      name: preset.name || "Prompt Preset",
      createdAt: preset.createdAt || now,
      updatedAt: now,
      settings: normalizedSettings
    };
    return promptConfigManager.savePreset(toSave);
  });
  electron.ipcMain.handle("prompts:deletePreset", (_event, id) => {
    promptConfigManager.deletePreset(id);
    return true;
  });
  electron.ipcMain.handle("prompts:openPromptsFolder", async () => {
    await electron.shell.openPath(VOTC_PROMPTS_DIR);
    return true;
  });
  electron.ipcMain.handle("prompts:openPromptFile", async (_event, relativePath) => {
    const full = promptConfigManager.resolvePath(relativePath);
    await electron.shell.openPath(full);
    return true;
  });
  electron.ipcMain.handle("prompts:validateTemplate", (_event, templateString) => {
    return TemplateEngine.validateTemplate(templateString);
  });
  electron.ipcMain.handle("prompts:exportZip", async (_event, payload) => {
    promptConfigManager.ensurePromptDirs();
    const normalizedSettings = promptConfigManager.normalizeSettings(payload?.settings || settingsRepository.getPromptSettings());
    const presets = promptConfigManager.getPresets();
    let targetPath = payload?.path;
    if (!targetPath) {
      const result = await electron.dialog.showSaveDialog({
        title: "Export prompt configuration",
        defaultPath: "prompts-export.zip",
        filters: [{ name: "Zip Archive", extensions: ["zip"] }]
      });
      if (result.canceled || !result.filePath) {
        return { cancelled: true };
      }
      targetPath = result.filePath;
    }
    await exportPromptsZip(targetPath, normalizedSettings, presets);
    return { success: true, path: targetPath };
  });
  electron.ipcMain.handle("letter:getPromptPreview", async () => {
    try {
      return await letterManager.buildPromptPreview();
    } catch (error) {
      console.error("Failed to build letter prompt preview:", error);
      return null;
    }
  });
  electron.ipcMain.handle("letters:getStatuses", async () => {
    try {
      return letterManager.getAllLetterStatuses();
    } catch (error) {
      console.error("Failed to get letter statuses:", error);
      return {
        letters: [],
        currentTotalDays: 0,
        timestamp: Date.now()
      };
    }
  });
  electron.ipcMain.handle("letters:getLetterDetails", async (_, letterId) => {
    try {
      return letterManager.getLetterStatus(letterId);
    } catch (error) {
      console.error("Failed to get letter details:", error);
      return null;
    }
  });
  electron.ipcMain.handle("letters:clearOldStatuses", async (_, daysThreshold) => {
    try {
      letterManager.clearOldStatuses(daysThreshold);
      return { success: true };
    } catch (error) {
      console.error("Failed to clear old statuses:", error);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("llm:saveProviderConfig", (_, config) => {
    return settingsRepository.saveProviderConfig(config);
  });
  electron.ipcMain.handle("llm:deletePreset", (_, instanceId) => {
    settingsRepository.deletePreset(instanceId);
  });
  electron.ipcMain.handle("llm:setActiveProvider", (_, instanceId) => {
    settingsRepository.setActiveProviderInstanceId(instanceId);
  });
  electron.ipcMain.handle("llm:listModels", async () => {
    try {
      return await llmManager.listModelsForProvider();
    } catch (error) {
      console.error("IPC llm:listModels error:", error);
      return { error: error.message || "Failed to list models" };
    }
  });
  electron.ipcMain.handle("llm:testConnection", async () => {
    return await llmManager.testProviderConnection();
  });
  electron.ipcMain.handle("llm:checkPlayer2Health", async () => {
    const config = settingsRepository.getActiveProviderConfig();
    if (!config || config.providerType !== "player2") {
      return { success: false, error: "Player2 is not the active provider." };
    }
    try {
      const provider = providerRegistry.createProvider(config);
      if (provider?.checkHealth) {
        return await provider.checkHealth();
      }
      return { success: false, error: "Provider does not support health check." };
    } catch (error) {
      console.error(`Error checking Player2 health (${config.customName || config.providerType}):`, error);
      return { success: false, error: error.message || "Unknown error during Player2 health check." };
    }
  });
  electron.ipcMain.handle("llm:setCK3Folder", async (_, path2) => {
    settingsRepository.setCK3UserFolderPath(path2);
    if (path2) {
      try {
        await letterManager.restartLogTailing();
        console.log("Log tailing restarted after CK3 path update");
      } catch (error) {
        console.error("Failed to restart log tailing after CK3 path update:", error);
      }
    }
  });
  electron.ipcMain.handle("llm:setModLocationPath", (_, path2) => {
    settingsRepository.setModLocationPath(path2);
  });
  electron.ipcMain.handle("dialog:selectFolder", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openDirectory"]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });
  electron.ipcMain.handle("llm:saveGlobalStreamSetting", (_, enabled) => {
    settingsRepository.saveGlobalStreamSetting(enabled);
  });
  electron.ipcMain.handle("llm:savePauseOnRegenerationSetting", (_, enabled) => {
    settingsRepository.savePauseOnRegenerationSetting(enabled);
  });
  electron.ipcMain.handle("llm:saveGenerateFollowingMessagesSetting", (_, enabled) => {
    settingsRepository.saveGenerateFollowingMessagesSetting(enabled);
  });
  electron.ipcMain.handle("llm:saveMessageFontSize", (_, fontSize) => {
    settingsRepository.saveMessageFontSize(fontSize);
  });
  electron.ipcMain.handle("llm:saveShowSettingsOnStartupSetting", (_, enabled) => {
    settingsRepository.saveShowSettingsOnStartupSetting(enabled);
  });
  electron.ipcMain.handle("llm:getLanguage", () => {
    return settingsRepository.getLanguage();
  });
  electron.ipcMain.handle("llm:saveLanguage", (_, language) => {
    settingsRepository.saveLanguage(language);
  });
  electron.ipcMain.handle("llm:getAllowPrerelease", () => {
    return settingsRepository.getAllowPrerelease();
  });
  electron.ipcMain.handle("llm:saveAllowPrerelease", (_, allow) => {
    settingsRepository.saveAllowPrerelease(allow);
  });
  electron.ipcMain.handle("llm:getCurrentContextLength", async () => {
    try {
      return await llmManager.getCurrentContextLength();
    } catch (error) {
      console.error("IPC llm:getCurrentContextLength error:", error);
      return 9e4;
    }
  });
  electron.ipcMain.handle("llm:getMaxContextLength", async () => {
    try {
      return await llmManager.getMaxContextLength();
    } catch (error) {
      console.error("IPC llm:getMaxContextLength error:", error);
      return 9e4;
    }
  });
  electron.ipcMain.handle("llm:setCustomContextLength", (_, contextLength) => {
    try {
      llmManager.setCustomContextLength(contextLength);
    } catch (error) {
      console.error("IPC llm:setCustomContextLength error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("llm:clearCustomContextLength", () => {
    try {
      llmManager.clearCustomContextLength();
    } catch (error) {
      console.error("IPC llm:clearCustomContextLength error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("llm:getActionsProviderId", () => {
    return settingsRepository.getActionsProviderInstanceId();
  });
  electron.ipcMain.handle("llm:setActionsProviderId", (_, instanceId) => {
    settingsRepository.setActionsProviderInstanceId(instanceId);
  });
  electron.ipcMain.handle("llm:getSummaryProviderId", () => {
    return settingsRepository.getSummaryProviderInstanceId();
  });
  electron.ipcMain.handle("llm:setSummaryProviderId", (_, instanceId) => {
    settingsRepository.setSummaryProviderInstanceId(instanceId);
  });
  electron.ipcMain.handle("llm:getActionApprovalSettings", () => {
    return settingsRepository.getActionApprovalSettings();
  });
  electron.ipcMain.handle("llm:saveActionApprovalSettings", (_, settings) => {
    settingsRepository.saveActionApprovalSettings(settings);
    return true;
  });
  electron.ipcMain.handle("llm:getSummaryPromptSettings", () => {
    return settingsRepository.getSummaryPromptSettings();
  });
  electron.ipcMain.handle("usage:getReport", () => usageAnalytics.getReport());
  electron.ipcMain.handle("usage:clear", () => {
    usageAnalytics.clear();
    return { success: true };
  });
  electron.ipcMain.handle("llm:saveSummaryPromptSettings", (_, settings) => {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("summary_prompt_settings_must_be_an_object");
    requireInteger(Number(settings.finalSummaryMaxTokens), "final_summary_max_tokens", { min: 256, max: 16384 });
    settingsRepository.saveSummaryPromptSettings(settings);
    return true;
  });
  console.log("Setting up action system IPC handlers...");
  electron.ipcMain.handle("actions:reload", async () => {
    try {
      await actionRegistry.reloadActions();
      return { success: true };
    } catch (error) {
      console.error("Failed to reload actions:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("actions:getAll", async () => {
    try {
      const actions = actionRegistry.getAllActions(
        /* includeDisabled = */
        true
      );
      const userLang = settingsRepository.getLanguage();
      return actions.map((a) => {
        const semantic = a.definition.semantic || {};
        const triggerCategories = Array.isArray(a.definition.triggerCategories) ? a.definition.triggerCategories : [];
        return {
          id: a.id,
          title: a.definition.title ? resolveI18nString(a.definition.title, userLang) : a.id,
          scope: a.scope,
          filePath: a.filePath,
          validation: a.validation,
          disabled: actionRegistry.isActionDisabled(a.id),
          isDestructive: actionRegistry.getEffectiveDestructive(a.id),
          hasDestructiveOverride: actionRegistry.hasDestructiveOverride(a.id),
          triggerCategories,
          riskLevel: semantic.riskLevel || "unknown",
          semanticMode: semantic.fallback ? "fallback" : "event"
        };
      });
    } catch (error) {
      console.error("Failed to get actions:", error);
      return [];
    }
  });
  electron.ipcMain.handle("actions:setDisabled", async (_, { actionId, disabled }) => {
    try {
      actionRegistry.setActionDisabled(actionId, disabled);
      const settings = actionRegistry.getSettings();
      settingsRepository.saveActionSettings(settings);
      return { success: true };
    } catch (error) {
      console.error("Failed to set action disabled state:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("actions:setDestructiveOverride", async (_, { actionId, isDestructive }) => {
    try {
      actionRegistry.setDestructiveOverride(actionId, isDestructive);
      const settings = actionRegistry.getSettings();
      settingsRepository.saveActionSettings(settings);
      return { success: true };
    } catch (error) {
      console.error("Failed to set action destructive override:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("actions:getSettings", async () => {
    try {
      return settingsRepository.getActionSettings();
    } catch (error) {
      console.error("Failed to get action settings:", error);
      return { disabledActions: [], validation: {} };
    }
  });
  electron.ipcMain.handle("actions:openFolder", async () => {
    try {
      await electron.shell.openPath(VOTC_ACTIONS_DIR);
      return;
    } catch (error) {
      console.error("Failed to open actions folder:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("actions:openFile", async (_, request = {}) => {
    try {
      await electron.shell.openPath(validateActionFilePath(request.filePath, VOTC_ACTIONS_DIR));
      return { success: true };
    } catch (error) {
      console.error("Failed to open action file:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("actions:getDetails", async (_, { actionId, sourceCharacterId }) => {
    try {
      const userLang = settingsRepository.getLanguage();
      const loaded = actionRegistry.getById(actionId);
      if (!loaded || !loaded.validation.valid) {
        return { error: "Action not found or invalid", valid: false };
      }
      const conv = conversationManager.getCurrentConversation();
      if (!conv) {
        return { error: "No active conversation", valid: false };
      }
      const sourceCharacter = conv.gameData.characters.get(sourceCharacterId);
      if (!sourceCharacter) {
        return { error: "Source character not found", valid: false };
      }
      const checkResult = await loaded.definition.check({
        gameData: conv.gameData,
        sourceCharacter
      });
      if (!checkResult?.canExecute) {
        return { error: checkResult?.reason || "Action cannot be executed", valid: false, canExecute: false };
      }
      let args;
      if (typeof loaded.definition.args === "function") {
        args = loaded.definition.args({ gameData: conv.gameData, sourceCharacter });
      } else {
        args = loaded.definition.args;
      }
      const resolvedArgs = args.map((arg) => ({
        ...arg,
        description: resolveI18nString(arg.description, userLang),
        displayName: arg.displayName ? resolveI18nString(arg.displayName, userLang) : void 0
      }));
      return {
        valid: true,
        canExecute: true,
        id: loaded.id,
        title: loaded.definition.title ? resolveI18nString(loaded.definition.title, userLang) : loaded.id,
        args: resolvedArgs,
        requiresTarget: typeof checkResult.requiresTarget === "boolean" ? checkResult.requiresTarget : !!(checkResult.validTargetCharacterIds && checkResult.validTargetCharacterIds.length > 0),
        validTargetCharacterIds: checkResult.validTargetCharacterIds || [],
        isDestructive: actionRegistry.getEffectiveDestructive(actionId)
      };
    } catch (error) {
      console.error("Failed to get action details:", error);
      return { error: error.message || "Unknown error", valid: false };
    }
  });
  electron.ipcMain.handle("actions:execute", async (_, { actionId, sourceCharacterId, targetCharacterId, args }) => {
    try {
      const conv = conversationManager.getCurrentConversation();
      if (!conv) {
        return { success: false, error: "No active conversation" };
      }
      const sourceCharacter = conv.gameData.characters.get(sourceCharacterId);
      if (!sourceCharacter) {
        return { success: false, error: "Source character not found" };
      }
      const invocation = {
        actionId,
        sourceCharacterId: sourceCharacter.id,
        targetCharacterId: targetCharacterId ?? null,
        args,
        bindingId: `manual:${sourceCharacter.id}:${targetCharacterId ?? "none"}:${actionId}`,
        eventId: "manual_action",
        traceId: `manual:${actionId}`
      };
      const result = await ActionEngine.runInvocation(conv, sourceCharacter, invocation);
      if (result.feedback) {
        conversationManager.addManualActionFeedback({
          actionId: result.actionId,
          success: result.success,
          message: result.feedback.message,
          sentiment: result.feedback.sentiment
        });
      } else if (result.success) {
        conversationManager.addManualActionFeedback({
          actionId: result.actionId,
          success: true,
          message: `Action ${result.actionId} executed successfully`,
          sentiment: "neutral"
        });
      } else {
        conversationManager.addManualActionFeedback({
          actionId: result.actionId,
          success: false,
          message: result.error || `Action ${result.actionId} failed`,
          sentiment: "negative"
        });
      }
      return result;
    } catch (error) {
      console.error("Failed to execute action:", error);
      return { success: false, error: error.message || "Unknown error", actionId };
    }
  });
  electron.ipcMain.handle("shell:openExternal", async (_, url) => {
    try {
      await electron.shell.openExternal(validateExternalHttpUrl(url));
      return { success: true };
    } catch (error) {
      console.error("Failed to open external URL:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("logs:collectAndOpen", async () => {
    try {
      const os = require("os");
      const path2 = require("path");
      const fs2 = require("fs");
      const logsFolder = path2.join(os.tmpdir(), "VOTC-all-logs");
      if (fs2.existsSync(logsFolder)) {
        const files = fs2.readdirSync(logsFolder);
        for (const file of files) {
          const filePath = path2.join(logsFolder, file);
          fs2.unlinkSync(filePath);
        }
      } else {
        fs2.mkdirSync(logsFolder, { recursive: true });
      }
      const userDataPath = electron.app.getPath("userData");
      const appLogsPath = path2.join(userDataPath, "votc_data", "logs");
      if (fs2.existsSync(appLogsPath)) {
        const appLogFiles = fs2.readdirSync(appLogsPath);
        for (const file of appLogFiles) {
          const srcPath = path2.join(appLogsPath, file);
          const destPath = path2.join(logsFolder, `app-${file}`);
          fs2.copyFileSync(srcPath, destPath);
        }
      }
      const ck3Path = settingsRepository.getCK3UserFolderPath();
      if (ck3Path) {
        const ck3LogsPath = path2.join(ck3Path, "logs");
        const debugLogPath = path2.join(ck3LogsPath, "debug.log");
        if (fs2.existsSync(debugLogPath)) {
          fs2.copyFileSync(debugLogPath, path2.join(logsFolder, "debug.log"));
        }
        const gameLogPath = path2.join(ck3LogsPath, "game.log");
        if (fs2.existsSync(gameLogPath)) {
          fs2.copyFileSync(gameLogPath, path2.join(logsFolder, "game.log"));
        }
        const errorLogPath = path2.join(ck3LogsPath, "error.log");
        if (fs2.existsSync(errorLogPath)) {
          fs2.copyFileSync(errorLogPath, path2.join(logsFolder, "error.log"));
        }
      }
      const summary = {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        appVersion: electron.app.getVersion(),
        ck3Path: ck3Path || "Not set"
      };
      fs2.writeFileSync(
        path2.join(logsFolder, "system-info.json"),
        JSON.stringify(summary, null, 2)
      );
      await electron.shell.openPath(logsFolder);
      return {
        success: true,
        path: logsFolder
      };
    } catch (error) {
      console.error("Failed to collect logs:", error);
      return {
        success: false,
        error: error.message || "Unknown error"
      };
    }
  });
  electron.ipcMain.handle("app:getVersion", () => {
    return electron.app.getVersion();
  });
  console.log("Setting up conversation IPC handlers...");
  electron.ipcMain.handle("conversation:sendMessage", async (_, requestArgs) => {
    const { message } = requestArgs;
    try {
      console.log("IPC: Sending message:", message);
      const streaming = settingsRepository.getGlobalStreamSetting() || true;
      const result = await conversationManager.sendMessage(message, streaming);
      console.log("IPC: Message sent successfully, result type:", typeof result);
      return { streamStarted: false, message: result };
    } catch (error) {
      console.error("IPC: Failed to send message:", error);
      return {
        streamStarted: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  });
  electron.ipcMain.handle("conversation:reset", () => {
    conversationManager.endCurrentConversation();
    return true;
  });
  electron.ipcMain.handle("conversation:getEntries", () => {
    return conversationManager.getConversationEntries();
  });
  electron.ipcMain.handle("conversation:cancelStream", () => {
    conversationManager.cancelCurrentStream();
  });
  electron.ipcMain.handle("conversation:pause", () => {
    conversationManager.pauseConversation();
  });
  electron.ipcMain.handle("conversation:resume", () => {
    conversationManager.resumeConversation();
  });
  electron.ipcMain.handle("conversation:getState", () => {
    return conversationManager.getConversationState();
  });
  electron.ipcMain.handle("conversation:joinWaitingCharacter", async (_, { characterId }) => {
    return conversationManager.joinWaitingCharacter(characterId);
  });
  electron.ipcMain.handle("conversation:leavePresentCharacter", async (_, { characterId }) => {
    return conversationManager.leavePresentCharacter(characterId);
  });
  electron.ipcMain.handle("conversation:temporarilyLeaveCharacter", async (_, { characterId, mode }) => {
    return conversationManager.temporarilyLeaveCharacter(characterId, mode);
  });
  electron.ipcMain.handle("conversation:returnTemporaryCharacter", async (_, { characterId }) => {
    return conversationManager.returnTemporaryCharacter(characterId);
  });
  electron.ipcMain.handle("conversation:regenerateMessage", async (_, requestArgs = {}) => {
    const messageId = requireInteger(requestArgs.messageId, "message_id", { min: 0, max: 2147483647 });
    try {
      console.log("IPC: Regenerating message:", messageId);
      const conversation = conversationManager.getCurrentConversation();
      if (!conversation) {
        throw new Error("No active conversation");
      }
      await conversation.regenerateMessage(messageId);
      return { success: true };
    } catch (error) {
      console.error("IPC: Failed to regenerate message:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  });
  electron.ipcMain.handle("conversation:editUserMessage", async (_, requestArgs) => {
    const { messageId, newContent } = requestArgs;
    try {
      console.log("IPC: Editing user message:", messageId);
      const conversation = conversationManager.getCurrentConversation();
      if (!conversation) {
        throw new Error("No active conversation");
      }
      await conversation.editUserMessage(messageId, newContent);
      return { success: true };
    } catch (error) {
      console.error("IPC: Failed to edit user message:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  });
  electron.ipcMain.handle("conversation:regenerateError", async (_, requestArgs) => {
    const { messageId } = requestArgs;
    try {
      console.log("IPC: Regenerating error:", messageId);
      const conversation = conversationManager.getCurrentConversation();
      if (!conversation) {
        throw new Error("No active conversation");
      }
      await conversationManager.regenerateError(messageId);
      return { success: true };
    } catch (error) {
      console.error("IPC: Failed to regenerate error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  });
  electron.ipcMain.handle("conversation:openSummariesFolder", async () => {
    try {
      await electron.shell.openPath(VOTC_SUMMARIES_DIR);
      return { success: true };
    } catch (error) {
      console.error("Failed to open summaries folder:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("conversation:clearSummaries", async () => {
    try {
      const fs2 = require("fs");
      const path2 = require("path");
      if (fs2.existsSync(VOTC_SUMMARIES_DIR)) {
        const playerDirs = fs2.readdirSync(VOTC_SUMMARIES_DIR, { withFileTypes: true }).filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name);
        let totalFilesDeleted = 0;
        for (const playerDir of playerDirs) {
          const playerPath = path2.join(VOTC_SUMMARIES_DIR, playerDir);
          const files = fs2.readdirSync(playerPath);
          for (const file of files) {
            fs2.unlinkSync(path2.join(playerPath, file));
            totalFilesDeleted++;
          }
          fs2.rmdirSync(playerPath);
        }
        console.log(`Cleared ${totalFilesDeleted} summary files and removed ${playerDirs.length} player directories`);
      }
      memoryEngine.invalidateSummaryFolderCache();
      const conversation = conversationManager.getCurrentConversation();
      if (conversation) {
        conversation.gameData.loadCharactersSummaries();
      }
      return { success: true };
    } catch (error) {
      console.error("Failed to clear summaries:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("conversation:listAllSummaries", async () => {
    try {
      return await SummariesManager.listAllSummaries();
    } catch (error) {
      console.error("Failed to list all summaries:", error);
      return [];
    }
  });
  electron.ipcMain.handle("conversation:getMemoryOverview", async () => {
    try {
      const summaryCatalog = await SummariesManager.listAllSummaries();
      return memoryEngine.getUiOverview({ summaryCatalog });
    } catch (error) {
      console.error("Failed to get Memory Engine overview:", error);
      return { engineVersion: "2.2", totals: {}, boundaries: [], routingPolicy: {}, characters: [], error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("conversation:getSummariesDashboardData", async (_, options = {}) => {
    try {
      if (options?.refresh === true) memoryEngine.invalidateSummaryFolderCache();
      const summaries = await SummariesManager.listAllSummaries();
      return { summaries, memoryOverview: memoryEngine.getUiOverview({ summaryCatalog: summaries }) };
    } catch (error) {
      console.error("Failed to get summaries dashboard data:", error);
      return { summaries: [], memoryOverview: { engineVersion: "2.2", totals: {}, boundaries: [], routingPolicy: {}, characters: [], error: error.message || "Unknown error" } };
    }
  });
  electron.ipcMain.handle("conversation:updateStructuredMemory", async (_, { memoryId, content }) => {
    try {
      return memoryEngine.updateMemoryContent(memoryId, content);
    } catch (error) {
      console.error("Failed to update structured memory:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("shell:openPlayer2", async () => {
    try {
      await electron.shell.openExternal("player2://");
      return { success: true };
    } catch (error) {
      console.error("Failed to open Player2 app:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("memory:updateRecord", async (_, { memoryId, updates, advanced = false }) => {
    try {
      return memoryEngine.updateMemory(memoryId, updates, { advanced });
    } catch (error) {
      console.error("Failed to update memory record:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("memory:deleteRecord", async (_, { memoryId }) => {
    try {
      return memoryEngine.deleteMemory(memoryId);
    } catch (error) {
      console.error("Failed to delete memory record:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("conversation:getSummariesForCharacter", async (_, request = {}) => {
    try {
      return await SummariesManager.getSummariesForCharacter(requireInteger(request.playerId, "player_id", { max: 2147483647 }), requireInteger(request.characterId, "character_id", { max: 2147483647 }));
    } catch (error) {
      console.error("Failed to get summaries for character:", error);
      return [];
    }
  });
  electron.ipcMain.handle("conversation:updateSummary", async (_, request = {}) => {
    try {
      if (typeof request.newContent !== "string" || request.newContent.length > 1048576) throw new Error("summary_content_must_be_a_string_up_to_1048576_chars");
      return await SummariesManager.updateSummary(requireInteger(request.playerId, "player_id", { max: 2147483647 }), requireInteger(request.characterId, "character_id", { max: 2147483647 }), requireInteger(request.summaryIndex, "summary_index", { max: 1000000 }), request.newContent);
    } catch (error) {
      console.error("Failed to update summary:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("conversation:deleteSummary", async (_, request = {}) => {
    try {
      return await SummariesManager.deleteSummary(requireInteger(request.playerId, "player_id", { max: 2147483647 }), requireInteger(request.characterId, "character_id", { max: 2147483647 }), requireInteger(request.summaryIndex, "summary_index", { max: 1000000 }));
    } catch (error) {
      console.error("Failed to delete summary:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("conversation:deleteCharacterSummaries", async (_, request = {}) => {
    try {
      return await SummariesManager.deleteCharacterSummaries(requireInteger(request.playerId, "player_id", { max: 2147483647 }), requireInteger(request.characterId, "character_id", { max: 2147483647 }));
    } catch (error) {
      console.error("Failed to delete character summaries:", error);
      return { success: false, error: error.message || "Unknown error" };
    }
  });
  electron.ipcMain.handle("conversation:approveActions", async (_, { approvalEntryId }) => {
    const conversation = conversationManager.getCurrentConversation();
    if (!conversation) throw new Error("No active conversation");
    await conversation.approveActions(approvalEntryId);
    return { success: true };
  });
  electron.ipcMain.handle("conversation:declineActions", async (_, { approvalEntryId }) => {
    const conversation = conversationManager.getCurrentConversation();
    if (!conversation) throw new Error("No active conversation");
    await conversation.declineActions(approvalEntryId);
    return { success: true };
  });
  electron.ipcMain.handle("conversation:getActiveConversationData", () => {
    return conversationManager.getActiveConversationData();
  });
  electron.ipcMain.handle("conversation:getPromptPreview", (_, { characterId }) => {
    return conversationManager.getPromptPreview(characterId);
  });
  const conversationUpdateCallback = (entries) => {
    if (runtime.chatWindow && !runtime.chatWindow.isDestroyed()) {
      runtime.chatWindow.webContents.send("conversation:updated", entries);
    }
  };
  conversationManager.onConversationUpdate(conversationUpdateCallback);
  console.log("Conversation IPC handlers registered successfully");
}

module.exports = { registerIpcHandlers, requireInteger, validateExternalHttpUrl, validateActionFilePath };
