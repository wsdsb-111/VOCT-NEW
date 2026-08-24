"use strict";

class ProviderRegistry {
  constructor() {
    this.providers = /* @__PURE__ */ new Map();
  }
  static getInstance() {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }
  /**
   * Register a provider class with the registry
   * @param providerType The provider type identifier
   * @param providerClass The provider class constructor
   */
  register(providerType, providerClass) {
    if (this.providers.has(providerType)) {
      console.warn(`Provider type '${providerType}' is already registered. Overwriting.`);
    }
    this.providers.set(providerType, providerClass);
    console.log(`Provider '${providerType}' registered successfully.`);
  }
  /**
   * Create a provider instance for the given configuration
   * @param config The provider configuration
   * @returns An instance of the appropriate provider
   * @throws Error if provider type is not registered
   */
  createProvider(config) {
    const providerClass = this.providers.get(config.providerType);
    if (!providerClass) {
      const availableTypes = Array.from(this.providers.keys()).join(", ");
      throw new Error(
        `Provider type '${config.providerType}' is not registered. Available types: ${availableTypes}`
      );
    }
    try {
      const provider = new providerClass();
      return provider;
    } catch (error) {
      throw new Error(`Failed to instantiate provider '${config.providerType}': ${error}`);
    }
  }
  /**
   * Get all registered provider types
   * @returns Array of registered provider types
   */
  getRegisteredTypes() {
    return Array.from(this.providers.keys());
  }
  /**
   * Check if a provider type is registered
   * @param providerType The provider type to check
   * @returns True if registered, false otherwise
   */
  isRegistered(providerType) {
    return this.providers.has(providerType);
  }
}

class TokenCounter {
  /**
   * Estimate token count (simple approximation)
   * This matches the existing logic in Conversation.ts
   */
  static estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }
  /**
   * Estimate token count for a message object
   */
  static estimateMessageTokens(message) {
    const text = message.name ? `${message.name}: ${message.content}` : message.content;
    return this.estimateTokens(text);
  }
  /**
   * Calculate total tokens for an array of messages
   */
  static calculateTotalTokens(messages) {
    return messages.reduce((total, message) => total + this.estimateMessageTokens(message), 0);
  }
  /**
   * Add token counts to an array of messages
   */
  static addTokensToMessages(messages) {
    return messages.map((message) => ({
      ...message,
      tokens: this.estimateMessageTokens(message)
    }));
  }
}

class LLMManager {
  // Cache instantiated providers
  constructor({ settingsRepository, providerRegistry, usageAnalytics, TokenCounter, PromptBuilder, debugVerboseLLM = false, logVerboseLLM = () => {} }) {
    this.settingsRepository = settingsRepository;
    this.providerRegistry = providerRegistry;
    this.usageAnalytics = usageAnalytics;
    this.TokenCounter = TokenCounter;
    this.PromptBuilder = PromptBuilder;
    this.debugVerboseLLM = debugVerboseLLM;
    this.logVerboseLLM = logVerboseLLM;
    this.providers = /* @__PURE__ */ new Map();
    console.log("LLMManager initialized with refactored architecture.");
  }
  // --- Provider Instantiation ---
  getProviderInstance(config) {
    if (this.providers.has(config.providerType)) {
      return this.providers.get(config.providerType);
    }
    const provider = this.providerRegistry.createProvider(config);
    this.providers.set(config.providerType, provider);
    return provider;
  }
  // --- Core Functionality ---
  async listModelsForProvider() {
    const config = this.settingsRepository.getActiveProviderConfig();
    if (!config) {
      throw new Error("No active and enabled LLM provider configured.");
    }
    try {
      const provider = this.getProviderInstance(config);
      if (provider.listModels) {
        return await provider.listModels(config);
      }
      return [];
    } catch (error) {
      console.error(`Error listing models for ${config.customName} (${config.providerType}):`, error);
      throw error;
    }
  }
  async testProviderConnection() {
    const config = this.settingsRepository.getActiveProviderConfig();
    if (!config) {
      return { success: false, error: "No active and enabled LLM provider configured." };
    }
    try {
      const provider = this.getProviderInstance(config);
      if (provider.testConnection) {
        return await provider.testConnection(config);
      }
      return { success: false, error: "Provider does not support testConnection method." };
    } catch (error) {
      console.error(`Error testing connection for ${config.customName} (${config.providerType}):`, error);
      return { success: false, error: error.message || "Unknown error during test connection." };
    }
  }
  // Unified method to send requests to the *active* provider
  async sendChatRequest(messages, signal, noStream, metadata = {}) {
    const activeConfig = this.settingsRepository.getActiveProviderConfig();
    if (!activeConfig) {
      throw new Error("No active and enabled LLM provider configured.");
    }
    if (!activeConfig.defaultModel) {
      throw new Error(`Active provider '${activeConfig.customName}' has no default model selected.`);
    }
    const provider = this.getProviderInstance(activeConfig);
    const stream = this.settingsRepository.getGlobalStreamSetting() && !noStream;
    const isDeepseekChat = activeConfig.providerType === "deepseek";
    const request = {
      model: activeConfig.defaultModel,
      messages,
      stream,
      // Merge default parameters from config with specific request params
      ...activeConfig.defaultParameters,
      ...isDeepseekChat ? {
        thinking: { type: "enabled" },
        max_tokens: 4096
      } : {},
      signal
      // ...params,
    };
    const estimatedPromptTokens = this.TokenCounter.calculateTotalTokens(messages);
    console.log(`[LLMManager] Chat request: provider=${activeConfig.providerType}, model=${activeConfig.defaultModel}, messages=${messages.length}, estimatedPromptTokens=${estimatedPromptTokens}${isDeepseekChat ? `, maxTokens=${request.max_tokens}, thinking=enabled` : ""}`);
    if (this.debugVerboseLLM) {
      this.logVerboseLLM("[LLMManager][verbose] Chat messages:", messages);
      this.logVerboseLLM("[LLMManager][verbose] Provider config:", JSON.stringify(activeConfig).replace(/"apiKey":\s*"[^"]*"/g, "HIDDEN"));
    }
    return await this.trackUsage(provider.chatCompletion(request, activeConfig), { ...metadata, requestType: metadata.requestType || "chat", providerType: activeConfig.providerType, model: activeConfig.defaultModel, estimatedPromptTokens });
  }
  /**
   * Send a structured JSON request for Actions.
   * Uses the actions provider override if set, otherwise active provider.
   */
  async sendActionsRequest(messages, schemaName, jsonSchemaObject, signal, metadata = {}) {
    const config = this.settingsRepository.getActionsProviderConfig();
    if (!config) {
      throw new Error("No provider configured for Actions.");
    }
    if (!config.defaultModel) {
      throw new Error(`Provider '${config.customName || config.providerType}' has no default model selected.`);
    }
    const provider = this.getProviderInstance(config);
    const request = {
      model: config.defaultModel,
      messages,
      stream: false,
      // structured outputs should be non-streamed
      ...config.defaultParameters,
      // Action selection is a small classification task. DeepSeek V4 enables
      // thinking by default, which previously spent up to 4096 hidden output
      // tokens even when the visible result was an empty string.
      temperature: 0.1,
      max_tokens: 512,
      thinking: { type: "disabled" },
      signal,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          schema: jsonSchemaObject,
          strict: true
        }
      }
    };
    const estimatedPromptTokens = this.TokenCounter.calculateTotalTokens(messages);
    console.log(`[LLMManager] Action request: provider=${config.providerType}, model=${config.defaultModel}, messages=${messages.length}, schema=${schemaName}, estimatedPromptTokens=${estimatedPromptTokens}, maxTokens=512, thinking=disabled`);
    if (this.debugVerboseLLM) {
      this.logVerboseLLM("[LLMManager][verbose] Structured action request:", JSON.stringify(request));
      this.logVerboseLLM("[LLMManager][verbose] Provider config:", JSON.stringify(config).replace(/"apiKey":\s*"[^"]*"/g, "HIDDEN"));
    }
    return await this.trackUsage(provider.chatCompletion(request, config), { ...metadata, requestType: "action", providerType: config.providerType, model: config.defaultModel, estimatedPromptTokens });
  }
  /**
   * Send a request for Summaries (rolling or final).
   * Uses the summary provider override if set, otherwise active provider.
   */
  async sendSummaryRequest(messages, signal, metadata = {}) {
    const config = this.settingsRepository.getSummaryProviderConfig();
    if (!config) {
      throw new Error("No provider configured for Summaries.");
    }
    if (!config.defaultModel) {
      throw new Error(`Provider '${config.customName || config.providerType}' has no default model selected.`);
    }
    const provider = this.getProviderInstance(config);
    const preparedMessages = this.PromptBuilder.prepareSummaryMessages(messages);
    const summaryBlocks = Array.isArray(metadata?.blocks) && metadata.blocks.length > 0 ? metadata.blocks : this.PromptBuilder.getSummaryPromptBlocks(preparedMessages, metadata?.requestType || "summary");
    const isStructuredSummary = ["final_summary", "memory_recovery"].includes(metadata.requestType);
    const isDeepseekStructuredSummary = config.providerType === "deepseek" && isStructuredSummary;
    const request = {
      model: config.defaultModel,
      messages: preparedMessages,
      stream: false,
      // summaries don't need streaming
      ...config.defaultParameters,
      ...isDeepseekStructuredSummary ? { thinking: { type: "enabled" }, max_tokens: 4096, response_format: { type: "json_object" } } : isStructuredSummary ? { response_format: { type: "json_object" } } : {},
      signal
    };
    const estimatedPromptTokens = this.TokenCounter.calculateTotalTokens(preparedMessages);
    console.log(`[LLMManager] Summary request: provider=${config.providerType}, model=${config.defaultModel}, messages=${preparedMessages.length}, estimatedPromptTokens=${estimatedPromptTokens}`);
    if (this.debugVerboseLLM) {
      this.logVerboseLLM("[LLMManager][verbose] Summary messages:", preparedMessages);
      this.logVerboseLLM("[LLMManager][verbose] Provider config:", JSON.stringify(config).replace(/"apiKey":\s*"[^"]*"/g, "HIDDEN"));
    }
    return await this.trackUsage(provider.chatCompletion(request, config), { ...metadata, blocks: summaryBlocks, requestType: metadata.requestType || "summary", providerType: config.providerType, model: config.defaultModel, estimatedPromptTokens });
  }
  async trackUsage(result, metadata) {
    const response = await result;
    if (response && typeof response[Symbol.asyncIterator] === "function") {
      const iterator = response[Symbol.asyncIterator]();
      const analytics = this.usageAnalytics;
      return {
        async *[Symbol.asyncIterator]() {
          while (true) {
            const step = await iterator.next();
            if (step.done) {
              analytics.record(metadata, step.value?.usage);
              return step.value;
            }
            yield step.value;
          }
        }
      };
    }
    this.usageAnalytics.record(metadata, response?.usage);
    return response;
  }
  // Get current context length for the active provider
  async getCurrentContextLength() {
    const activeConfig = this.settingsRepository.getActiveProviderConfig();
    if (!activeConfig) {
      return 9e4;
    }
    if (activeConfig.customContextLength !== void 0) {
      return activeConfig.customContextLength;
    }
    try {
      const models = await this.listModelsForProvider();
      const currentModel = models.find((model) => model.id === activeConfig.defaultModel);
      if (currentModel && currentModel.contextLength !== void 0) {
        return currentModel.contextLength;
      }
    } catch (error) {
      console.warn("Failed to fetch model context length:", error);
    }
    return 9e4;
  }
  // Get the maximum context length for the current model
  async getMaxContextLength() {
    const activeConfig = this.settingsRepository.getActiveProviderConfig();
    if (!activeConfig) {
      return 9e4;
    }
    try {
      const models = await this.listModelsForProvider();
      const currentModel = models.find((model) => model.id === activeConfig.defaultModel);
      if (currentModel && currentModel.contextLength !== void 0) {
        return currentModel.contextLength;
      }
    } catch (error) {
      console.warn("Failed to fetch model max context length:", error);
    }
    return 9e4;
  }
  // Set custom context length for the active provider
  setCustomContextLength(contextLength) {
    const activeConfig = this.settingsRepository.getActiveProviderConfig();
    if (!activeConfig) {
      throw new Error("No active and enabled LLM provider configured.");
    }
    const updatedConfig = {
      ...activeConfig,
      customContextLength: contextLength
    };
    this.settingsRepository.saveProviderConfig(updatedConfig);
  }
  // Clear custom context length for the active provider
  clearCustomContextLength() {
    const activeConfig = this.settingsRepository.getActiveProviderConfig();
    if (!activeConfig) {
      throw new Error("No active and enabled LLM provider configured.");
    }
    const { customContextLength, ...configWithoutCustomContext } = activeConfig;
    this.settingsRepository.saveProviderConfig(configWithoutCustomContext);
  }
}

module.exports = { ProviderRegistry, TokenCounter, LLMManager };
