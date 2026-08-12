"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Sends a message to the main process to set the window's mouse event ignoring state.
   * @param ignore True to ignore mouse events (click-through), false to capture them.
   */
  setIgnoreMouseEvents: (ignore) => {
    electron.ipcRenderer.send("set-ignore-mouse-events", ignore);
  },
  toggleConfigPanel: () => electron.ipcRenderer.invoke("toggle-config-panel"),
  hideWindow: () => electron.ipcRenderer.send("chat-hide"),
  onChatReset: (callback) => {
    electron.ipcRenderer.on("chat-reset", callback);
    return () => electron.ipcRenderer.removeListener("chat-reset", callback);
  },
  onToggleSettings: (callback) => {
    electron.ipcRenderer.on("toggle-settings", callback);
    return () => electron.ipcRenderer.removeListener("toggle-settings", callback);
  },
  onHideChat: (callback) => {
    electron.ipcRenderer.on("chat-hide", callback);
    return () => electron.ipcRenderer.removeListener("chat-hide", callback);
  },
  onToggleMinimize: (callback) => {
    electron.ipcRenderer.on("toggle-minimize", callback);
    return () => electron.ipcRenderer.removeListener("toggle-minimize", callback);
  },
  openExternal: (url) => electron.ipcRenderer.invoke("shell:openExternal", url),
  collectAndOpenLogs: () => electron.ipcRenderer.invoke("logs:collectAndOpen"),
  getAppVersion: () => electron.ipcRenderer.invoke("app:getVersion"),
  onOverlayVisibilityChange: (callback) => {
    const subscription = (_event, value) => callback(value);
    electron.ipcRenderer.on("overlay-visibility-change", subscription);
    return () => electron.ipcRenderer.removeListener("overlay-visibility-change", subscription);
  }
});
electron.contextBridge.exposeInMainWorld("llmConfigAPI", {
  getAppSettings: () => electron.ipcRenderer.invoke("llm:getAppSettings"),
  saveProviderConfig: (config) => electron.ipcRenderer.invoke("llm:saveProviderConfig", config),
  deletePreset: (instanceId) => electron.ipcRenderer.invoke("llm:deletePreset", instanceId),
  // Renamed
  setActiveProvider: (instanceId) => electron.ipcRenderer.invoke("llm:setActiveProvider", instanceId),
  listModels: () => electron.ipcRenderer.invoke("llm:listModels"),
  testConnection: () => electron.ipcRenderer.invoke("llm:testConnection"),
  checkPlayer2Health: () => electron.ipcRenderer.invoke("llm:checkPlayer2Health"),
  setCK3Folder: (path) => electron.ipcRenderer.invoke("llm:setCK3Folder", path),
  setModLocationPath: (path) => electron.ipcRenderer.invoke("llm:setModLocationPath", path),
  selectFolder: () => electron.ipcRenderer.invoke("dialog:selectFolder"),
  saveGlobalStreamSetting: (enabled) => electron.ipcRenderer.invoke("llm:saveGlobalStreamSetting", enabled),
  savePauseOnRegenerationSetting: (enabled) => electron.ipcRenderer.invoke("llm:savePauseOnRegenerationSetting", enabled),
  saveGenerateFollowingMessagesSetting: (enabled) => electron.ipcRenderer.invoke("llm:saveGenerateFollowingMessagesSetting", enabled),
  saveMessageFontSize: (fontSize) => electron.ipcRenderer.invoke("llm:saveMessageFontSize", fontSize),
  saveShowSettingsOnStartupSetting: (enabled) => electron.ipcRenderer.invoke("llm:saveShowSettingsOnStartupSetting", enabled),
  getLanguage: () => electron.ipcRenderer.invoke("llm:getLanguage"),
  saveLanguage: (language) => electron.ipcRenderer.invoke("llm:saveLanguage", language),
  getAllowPrerelease: () => electron.ipcRenderer.invoke("llm:getAllowPrerelease"),
  saveAllowPrerelease: (allow) => electron.ipcRenderer.invoke("llm:saveAllowPrerelease", allow),
  getCurrentContextLength: () => electron.ipcRenderer.invoke("llm:getCurrentContextLength"),
  getMaxContextLength: () => electron.ipcRenderer.invoke("llm:getMaxContextLength"),
  setCustomContextLength: (contextLength) => electron.ipcRenderer.invoke("llm:setCustomContextLength", contextLength),
  clearCustomContextLength: () => electron.ipcRenderer.invoke("llm:clearCustomContextLength"),
  importLegacySummaries: () => electron.ipcRenderer.invoke("llm:importLegacySummaries"),
  // Provider override methods
  getActionsProviderId: () => electron.ipcRenderer.invoke("llm:getActionsProviderId"),
  setActionsProviderId: (instanceId) => electron.ipcRenderer.invoke("llm:setActionsProviderId", instanceId),
  getSummaryProviderId: () => electron.ipcRenderer.invoke("llm:getSummaryProviderId"),
  setSummaryProviderId: (instanceId) => electron.ipcRenderer.invoke("llm:setSummaryProviderId", instanceId),
  getActionApprovalSettings: () => electron.ipcRenderer.invoke("llm:getActionApprovalSettings"),
  saveActionApprovalSettings: (settings) => electron.ipcRenderer.invoke("llm:saveActionApprovalSettings", settings),
  getSummaryPromptSettings: () => electron.ipcRenderer.invoke("llm:getSummaryPromptSettings"),
  saveSummaryPromptSettings: (settings) => electron.ipcRenderer.invoke("llm:saveSummaryPromptSettings", settings)
});
electron.contextBridge.exposeInMainWorld("promptsAPI", {
  getSettings: () => electron.ipcRenderer.invoke("prompts:getSettings"),
  saveSettings: (settings) => electron.ipcRenderer.invoke("prompts:saveSettings", settings),
  getLetterSettings: () => electron.ipcRenderer.invoke("prompts:getLetterSettings"),
  saveLetterSettings: (settings) => electron.ipcRenderer.invoke("prompts:saveLetterSettings", settings),
  listFiles: (category) => electron.ipcRenderer.invoke("prompts:list", category),
  readFile: (relativePath) => electron.ipcRenderer.invoke("prompts:readFile", relativePath),
  saveFile: (relativePath, content) => electron.ipcRenderer.invoke("prompts:saveFile", relativePath, content),
  getDefaultMain: () => electron.ipcRenderer.invoke("prompts:getDefaultMain"),
  getDefaultLetterMain: () => electron.ipcRenderer.invoke("prompts:getDefaultLetterMain"),
  listPresets: () => electron.ipcRenderer.invoke("prompts:listPresets"),
  savePreset: (preset) => electron.ipcRenderer.invoke("prompts:savePreset", preset),
  deletePreset: (id) => electron.ipcRenderer.invoke("prompts:deletePreset", id),
  openPromptsFolder: () => electron.ipcRenderer.invoke("prompts:openPromptsFolder"),
  openPromptFile: (relativePath) => electron.ipcRenderer.invoke("prompts:openPromptFile", relativePath),
  exportZip: (payload) => electron.ipcRenderer.invoke("prompts:exportZip", payload),
  validateTemplate: (templateString) => electron.ipcRenderer.invoke("prompts:validateTemplate", templateString)
});
electron.contextBridge.exposeInMainWorld("lettersAPI", {
  getPromptPreview: () => electron.ipcRenderer.invoke("letter:getPromptPreview"),
  getStatuses: () => electron.ipcRenderer.invoke("letters:getStatuses"),
  getLetterDetails: (letterId) => electron.ipcRenderer.invoke("letters:getLetterDetails", letterId),
  clearOldStatuses: (daysThreshold) => electron.ipcRenderer.invoke("letters:clearOldStatuses", daysThreshold)
});
electron.contextBridge.exposeInMainWorld("conversationAPI", {
  sendMessage: (userMessage) => {
    return electron.ipcRenderer.invoke("conversation:sendMessage", { message: userMessage });
  },
  reset: () => {
    return electron.ipcRenderer.invoke("conversation:reset");
  },
  getConversationEntries: () => {
    return electron.ipcRenderer.invoke("conversation:getEntries");
  },
  onConversationUpdate: (callback) => {
    const handler = (_event, entries) => callback(entries);
    electron.ipcRenderer.on("conversation:updated", handler);
    return () => electron.ipcRenderer.removeListener("conversation:updated", handler);
  },
  cancelStream: () => {
    return electron.ipcRenderer.invoke("conversation:cancelStream");
  },
  pauseConversation: () => {
    return electron.ipcRenderer.invoke("conversation:pause");
  },
  resumeConversation: () => {
    return electron.ipcRenderer.invoke("conversation:resume");
  },
  getConversationState: () => {
    return electron.ipcRenderer.invoke("conversation:getState");
  },
  regenerateMessage: (messageId) => {
    return electron.ipcRenderer.invoke("conversation:regenerateMessage", { messageId });
  },
  editUserMessage: (messageId, newContent) => {
    return electron.ipcRenderer.invoke("conversation:editUserMessage", { messageId, newContent });
  },
  regenerateError: (messageId) => {
    return electron.ipcRenderer.invoke("conversation:regenerateError", { messageId });
  },
  acceptSummaryImport: (characterId, sourcePlayerId) => electron.ipcRenderer.invoke("conversation:acceptSummaryImport", { characterId, sourcePlayerId }),
  declineSummaryImport: (characterId, sourcePlayerId) => electron.ipcRenderer.invoke("conversation:declineSummaryImport", { characterId, sourcePlayerId }),
  openSummaryFile: (filePath) => electron.ipcRenderer.invoke("conversation:openSummaryFile", { filePath }),
  getActiveConversationData: () => electron.ipcRenderer.invoke("conversation:getActiveConversationData"),
  getPromptPreview: (characterId) => electron.ipcRenderer.invoke("conversation:getPromptPreview", { characterId }),
  openSummariesFolder: () => electron.ipcRenderer.invoke("conversation:openSummariesFolder"),
  clearSummaries: () => electron.ipcRenderer.invoke("conversation:clearSummaries"),
  approveActions: (approvalEntryId) => electron.ipcRenderer.invoke("conversation:approveActions", { approvalEntryId }),
  declineActions: (approvalEntryId) => electron.ipcRenderer.invoke("conversation:declineActions", { approvalEntryId }),
  // Summaries manager methods
  listAllSummaries: () => electron.ipcRenderer.invoke("conversation:listAllSummaries"),
  getSummariesForCharacter: (playerId, characterId) => electron.ipcRenderer.invoke("conversation:getSummariesForCharacter", { playerId, characterId }),
  updateSummary: (playerId, characterId, summaryIndex, newContent) => electron.ipcRenderer.invoke("conversation:updateSummary", { playerId, characterId, summaryIndex, newContent }),
  deleteSummary: (playerId, characterId, summaryIndex) => electron.ipcRenderer.invoke("conversation:deleteSummary", { playerId, characterId, summaryIndex }),
  deleteCharacterSummaries: (playerId, characterId) => electron.ipcRenderer.invoke("conversation:deleteCharacterSummaries", { playerId, characterId }),
  migrateSummariesToNewFormat: () => electron.ipcRenderer.invoke("conversation:migrateSummariesToNewFormat")
});
electron.contextBridge.exposeInMainWorld("actionsAPI", {
  reload: () => electron.ipcRenderer.invoke("actions:reload"),
  getAll: () => electron.ipcRenderer.invoke("actions:getAll"),
  setDisabled: (actionId, disabled) => electron.ipcRenderer.invoke("actions:setDisabled", { actionId, disabled }),
  setDestructiveOverride: (actionId, isDestructive) => electron.ipcRenderer.invoke("actions:setDestructiveOverride", { actionId, isDestructive }),
  getSettings: () => electron.ipcRenderer.invoke("actions:getSettings"),
  openFolder: () => electron.ipcRenderer.invoke("actions:openFolder"),
  openFile: (filePath) => electron.ipcRenderer.invoke("actions:openFile", { filePath }),
  getDetails: (actionId, sourceCharacterId) => electron.ipcRenderer.invoke("actions:getDetails", { actionId, sourceCharacterId }),
  execute: (params) => electron.ipcRenderer.invoke("actions:execute", params)
});
