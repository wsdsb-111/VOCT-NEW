"use strict";

const crypto = require("crypto");
const { estimateTokens } = require("./token-estimator");
const { OVERLAY_BLOCK_ID, OVERLAY_VERSION, prepareActionMessages } = require("./actions/action-prompt-compatibility-overlay");

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
    return estimateTokens(text);
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
    const isDeepseekAction = config.providerType === "deepseek" && schemaName === "votc_actions";
    const overlayEnabled = isDeepseekAction && config.deepseekActionStateTransitionRecallOverlay === true;
    const stablePrefixRequested = isDeepseekAction && config.deepseekActionStablePrefixOptimization === true;
    const preparedActionPrompt = isDeepseekAction ? prepareActionMessages(messages, {
      overlayEnabled,
      stablePrefixEnabled: stablePrefixRequested
    }) : {
      messages,
      blockMessages: messages,
      blockMetadataValid: false,
      overlayApplied: false,
      stablePrefixApplied: false,
      failureReason: null,
      experimentStage: null
    };
    const request = {
      model: config.defaultModel,
      messages: preparedActionPrompt.messages,
      stream: false,
      ...config.defaultParameters,
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
    const estimatedPromptTokens = this.TokenCounter.calculateTotalTokens(preparedActionPrompt.messages);
    const serializedSchema = JSON.stringify(jsonSchemaObject || {});
    const schemaTokenEstimate = this.TokenCounter.estimateTokens(serializedSchema);
    const schemaFingerprint = crypto.createHash("sha256").update(serializedSchema).digest("hex").slice(0, 16);
    const deepseekSchemaInjection = config.providerType === "deepseek";
    const actionSchemaDeliveryMode = deepseekSchemaInjection && schemaName === "votc_actions" ? config.actionSchemaDeliveryMode || "optimized_local_validation" : null;
    const providerInjectsSchema = deepseekSchemaInjection && actionSchemaDeliveryMode !== "optimized_local_validation";
    const schemaCacheRole = providerInjectsSchema ? "provider_injected_system_message" : deepseekSchemaInjection ? "local_validation_only" : "response_format";
    const providerSerializedOrder = preparedActionPrompt.stablePrefixApplied ? preparedActionPrompt.overlayApplied ? "deepseek_intro_state_transition_rules_actions_examples_roster_recent_actions_recent_messages_final" : "deepseek_intro_actions_examples_roster_recent_actions_recent_messages_final" : preparedActionPrompt.overlayApplied ? "deepseek_official_order_with_state_transition_overlay" : stablePrefixRequested && preparedActionPrompt.failureReason ? "messages_official_fail_open" : providerInjectsSchema ? "messages_then_provider_injected_schema_then_response_format" : "messages_then_response_format";
    const actionPromptBlocks = schemaName === "votc_actions" && (!Array.isArray(metadata.blocks) || metadata.blocks.length === 0) ? this.buildActionPromptBlocks(preparedActionPrompt.blockMessages, serializedSchema, providerInjectsSchema) : Array.isArray(metadata.blocks) ? metadata.blocks : [];
    const rosterPosition = preparedActionPrompt.stablePrefixApplied ? actionPromptBlocks.findIndex((block) => block.id === "action_roster") : -1;
    const stablePrefixEndPosition = rosterPosition >= 0 ? rosterPosition : null;
    const stablePrefixTokens = rosterPosition >= 0 ? actionPromptBlocks.slice(0, rosterPosition).reduce((sum, block) => sum + (Number(block.tokens) || 0), 0) : 0;
    const overlayBlock = actionPromptBlocks.find((block) => block.id === OVERLAY_BLOCK_ID);
    console.log(`[LLMManager] Action request: provider=${config.providerType}, model=${config.defaultModel}, messages=${preparedActionPrompt.messages.length}, schema=${schemaName}, estimatedPromptTokens=${estimatedPromptTokens}`);
    if (this.debugVerboseLLM) {
      this.logVerboseLLM("[LLMManager][verbose] Structured action request:", JSON.stringify(request));
      this.logVerboseLLM("[LLMManager][verbose] Provider config:", JSON.stringify(config).replace(/"apiKey":\s*"[^"]*"/g, "HIDDEN"));
    }
    return await this.trackUsage(provider.chatCompletion(request, config), {
      ...metadata,
      requestType: "action",
      providerType: config.providerType,
      model: config.defaultModel,
      blocks: actionPromptBlocks,
      estimatedPromptTokens,
      schemaTokenEstimate,
      schemaFingerprint,
      schemaCacheRole,
      actionSchemaDeliveryMode,
      deepseekActionStablePrefixOptimization: stablePrefixRequested,
      stablePrefixApplied: preparedActionPrompt.stablePrefixApplied,
      stablePrefixFailureReason: stablePrefixRequested ? preparedActionPrompt.failureReason : null,
      actionBlockMetadataValid: preparedActionPrompt.blockMetadataValid,
      deepseekActionStateTransitionRecallOverlay: overlayEnabled,
      overlayEnabled,
      overlayApplied: preparedActionPrompt.overlayApplied,
      overlayVersion: preparedActionPrompt.overlayApplied ? OVERLAY_VERSION : null,
      overlayTokenEstimate: overlayBlock?.tokens || 0,
      actionExperimentStage: preparedActionPrompt.experimentStage,
      providerSerializedOrder,
      stablePrefixEndPosition,
      stablePrefixTokens,
      estimatedSerializedPromptTokens: estimatedPromptTokens + (providerInjectsSchema ? schemaTokenEstimate : 0)
    });
  }
  buildActionPromptBlocks(messages, serializedSchema, providerInjectsSchema = true) {
    const definitions = new Map([
      ["action_system_intro", ["Action system introduction", "action_prompt", true]],
      [OVERLAY_BLOCK_ID, ["State transition recall rules", "action_prompt", true]],
      ["action_recent_messages", ["Recent messages", "action_prompt", false]],
      ["action_recent_actions", ["Recent actions", "action_prompt", false]],
      ["action_roster", ["Character roster", "action_prompt", false]],
      ["action_available_actions", ["Available actions", "action_prompt", false]],
      ["action_examples", ["Examples", "action_prompt", true]],
      ["action_final_instruction", ["Final instruction", "action_prompt", false]]
    ]);
    if (Array.isArray(messages) && messages.length > 0 && messages.every((message) => definitions.has(message?.blockId))) {
      const blocks = messages.map((message, position) => {
        const [label, type, stable] = definitions.get(message.blockId);
        return {
          id: message.blockId,
          label,
          type,
          position,
          stable,
          tokens: this.TokenCounter.estimateMessageTokens ? this.TokenCounter.estimateMessageTokens(message) : this.TokenCounter.estimateTokens(message.content),
          content: message.content
        };
      });
      if (!blocks.some((block) => block.id === "action_recent_actions")) {
        const recentMessagesPosition = blocks.findIndex((block) => block.id === "action_recent_messages");
        const rosterPosition = blocks.findIndex((block) => block.id === "action_roster");
        const insertionPosition = recentMessagesPosition < rosterPosition ? recentMessagesPosition + 1 : recentMessagesPosition;
        blocks.splice(insertionPosition, 0, {
          id: "action_recent_actions",
          label: "Recent actions",
          type: "action_prompt",
          position: insertionPosition,
          stable: false,
          tokens: 0,
          content: ""
        });
      }
      const schemaPosition = Math.max(0, blocks.findIndex((block) => block.id === "action_available_actions") + 1);
      blocks.splice(schemaPosition, 0, {
        id: "action_provider_schema",
        label: "Provider schema",
        type: "action_provider_schema",
        position: schemaPosition,
        stable: false,
        tokens: providerInjectsSchema ? this.TokenCounter.estimateTokens(serializedSchema) : 0,
        content: serializedSchema
      });
      return blocks.map((block, position) => ({ ...block, position }));
    }
    const fallbackDefinitions = [...definitions.entries()].map(([id, [label, type, stable]]) => [id, label, type, stable]);
    fallbackDefinitions.splice(6, 0, ["action_provider_schema", "Provider schema", "action_provider_schema", false]);
    const contents = new Map(fallbackDefinitions.map(([id]) => [id, ""]));
    for (const message of messages) {
      const content = typeof message?.content === "string" ? message.content : "";
      let blockId = null;
      if (content.startsWith("You are an action selection engine")) blockId = "action_system_intro";
      else if (content.startsWith("Recent messages:")) blockId = "action_recent_messages";
      else if (content.startsWith("Recent actions (last ")) blockId = "action_recent_actions";
      else if (content.startsWith("Characters in this conversation")) blockId = "action_roster";
      else if (content.startsWith("Available Actions:")) blockId = "action_available_actions";
      else if (content.startsWith("Examples of correct JSON output:")) blockId = "action_examples";
      else if (message?.role === "user" && content.startsWith("Given everything above, select the actions")) blockId = "action_final_instruction";
      if (blockId) contents.set(blockId, `${contents.get(blockId) || ""}${contents.get(blockId) ? "\n" : ""}${content}`);
    }
    contents.set("action_provider_schema", serializedSchema);
    return fallbackDefinitions.map(([id, label, type, stable], position) => {
      const content = contents.get(id) || "";
      return {
        id,
        label,
        type,
        position,
        stable,
        tokens: id === "action_provider_schema" ? providerInjectsSchema ? this.TokenCounter.estimateTokens(content) : 0 : this.TokenCounter.estimateMessageTokens ? this.TokenCounter.estimateMessageTokens({ role: "system", content }) : this.TokenCounter.estimateTokens(content),
        content
      };
    });
  }
  reorderActionPromptBlocks(blocks) {
    const order = ["action_system_intro", OVERLAY_BLOCK_ID, "action_available_actions", "action_provider_schema", "action_examples", "action_roster", "action_recent_actions", "action_recent_messages", "action_final_instruction"];
    const positions = new Map(order.map((id, index) => [id, index]));
    return [...blocks].sort((left, right) => (positions.get(left.id) ?? order.length) - (positions.get(right.id) ?? order.length)).map((block, position) => ({ ...block, position }));
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
    const useDeepseekNonThinking = config.providerType === "deepseek" && isStructuredSummary;
    const requestedMaxTokens = Number(metadata?.maxTokens);
    const structuredSummaryMaxTokens = Number.isInteger(requestedMaxTokens) && requestedMaxTokens >= 256 && requestedMaxTokens <= 16384 ? requestedMaxTokens : 4096;
    const request = {
      model: config.defaultModel,
      messages: preparedMessages,
      stream: false,
      // summaries don't need streaming
      ...config.defaultParameters,
      ...useDeepseekNonThinking ? { thinking: { type: "disabled" }, max_tokens: structuredSummaryMaxTokens, response_format: { type: "json_object" } } : isStructuredSummary ? { max_tokens: structuredSummaryMaxTokens, response_format: { type: "json_object" } } : {},
      signal
    };
    const estimatedPromptTokens = this.TokenCounter.calculateTotalTokens(preparedMessages);
    const deepseekMode = useDeepseekNonThinking ? `, maxTokens=${structuredSummaryMaxTokens}, thinking=disabled` : "";
    console.log(`[LLMManager] Summary request: provider=${config.providerType}, model=${config.defaultModel}, messages=${preparedMessages.length}, estimatedPromptTokens=${estimatedPromptTokens}${deepseekMode}`);
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
    if (!Number.isInteger(contextLength) || contextLength < 256 || contextLength > 2e6) {
      throw new Error("custom_context_length_must_be_an_integer_between_256_and_2000000");
    }
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
