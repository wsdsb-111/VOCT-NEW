"use strict";

const crypto = require("crypto");
const { estimateTokens } = require("./token-estimator");
const { resolveContextMode, resolveProviderCapabilities, planRequestBudget, validateContextConfiguration } = require("./providers/request-budget");
const { isMemoryBudgetBlock } = require("./memory-system/memory-budget-policy");
const { OVERLAY_BLOCK_ID, ACTION_TURN_IDENTITY_BLOCK_ID, OVERLAY_VERSION, prepareActionMessages } = require("./actions/action-prompt-compatibility-overlay");
const { buildProviderCapabilities, capabilityCacheKey } = require("./providers/provider-capabilities");
const { createRequestControl, awaitWithSignal, assertActive, managedIterator } = require("./providers/provider-cancellation");
const { preflightEffectiveRequestBudget } = require("./providers/effective-request");
const { ProviderPlatformFacade } = require("./providers/provider-platform");
const { normalizeProviderResult } = require("./providers/provider-result");
const { toProviderError, safeProviderConsole } = require("./providers/provider-errors");
const console = safeProviderConsole;

function rejectRetiredDurableOutbound(requestType) {
  if (requestType === "memory4_durable") throw new Error("memory4_durable_retired");
}

function memoryBudgetMetadataSnapshot(messages, metadata) {
  try {
    const blocks = metadata.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      messageStartPosition: block.messageStartPosition,
      messageCount: block.messageCount,
      tokens: block.tokens,
      fingerprint: block.fingerprint
    }));
    return crypto.createHash("sha256").update(JSON.stringify({
      messages,
      memoryBudgetTokens: metadata.memoryBudgetTokens,
      renderedMemoryTokens: metadata.renderedMemoryTokens,
      blocks
    })).digest("hex");
  } catch (_error) {
    throw new Error("chat_memory_budget_metadata_invalid");
  }
}

function validateMemoryBudgetMessages(messages, metadata, TokenCounter) {
  const budget = metadata.memoryBudgetTokens;
  const rendered = metadata.renderedMemoryTokens;
  if (!Number.isSafeInteger(budget) || budget < 0
    || !Number.isSafeInteger(rendered) || rendered < 0
    || !Array.isArray(messages) || !Array.isArray(metadata.blocks)) {
    throw new Error("chat_memory_budget_metadata_invalid");
  }
  if (rendered > budget) throw new Error("chat_memory_budget_exceeded");

  const spans = [];
  let actualMemoryTokens = 0;
  for (const block of metadata.blocks) {
    if (!block || typeof block !== "object") throw new Error("chat_memory_budget_metadata_invalid");
    const isMemory = isMemoryBudgetBlock(block);
    const start = block.messageStartPosition;
    const count = block.messageCount;
    if (start == null) {
      if (count !== 0 || isMemory) throw new Error("chat_memory_budget_block_unmapped");
      continue;
    }
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 1
      || start + count > messages.length) {
      throw new Error("chat_memory_budget_block_mapping_invalid");
    }
    const end = start + count;
    spans.push({ start, end });
    if (!isMemory) continue;

    const blockMessages = messages.slice(start, end);
    if (blockMessages.some((message) => !message || typeof message.role !== "string" || typeof message.content !== "string")) {
      throw new Error("chat_memory_budget_block_mapping_invalid");
    }
    const directText = blockMessages.length === 1 ? blockMessages[0].content : null;
    const roleText = blockMessages.map((message) => `${message.role}: ${message.content}`).join("\n\n");
    const fingerprint = value => crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
    if (typeof block.fingerprint !== "string" || !/^[a-f0-9]{16}$/.test(block.fingerprint)
      || block.fingerprint !== fingerprint(roleText) && (directText === null || block.fingerprint !== fingerprint(directText))) {
      throw new Error("chat_memory_budget_block_fingerprint_mismatch");
    }
    for (const message of blockMessages) {
      const messageTokens = typeof TokenCounter.estimateMessageTokens === "function"
        ? TokenCounter.estimateMessageTokens(message) : TokenCounter.estimateTokens(message.content);
      if (!Number.isFinite(messageTokens) || messageTokens < 0) throw new Error("chat_memory_budget_metadata_invalid");
      actualMemoryTokens += Math.ceil(messageTokens) + 8;
    }
  }
  spans.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start < spans[index - 1].end) throw new Error("chat_memory_budget_blocks_overlap");
  }
  if (actualMemoryTokens > budget) throw new Error("chat_memory_budget_exceeded");
  return actualMemoryTokens;
}

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
  constructor({ settingsRepository, providerRegistry, usageAnalytics, providerDiagnostics = null, performanceTrace = null, TokenCounter, PromptBuilder, debugVerboseLLM = false, logVerboseLLM = () => {} }) {
    this.settingsRepository = settingsRepository;
    this.providerRegistry = providerRegistry;
    this.usageAnalytics = usageAnalytics;
    this.providerDiagnostics = providerDiagnostics;
    this.performanceTrace = performanceTrace;
    this.TokenCounter = TokenCounter;
    this.PromptBuilder = PromptBuilder;
    this.debugVerboseLLM = debugVerboseLLM;
    this.logVerboseLLM = logVerboseLLM;
    this.providers = /* @__PURE__ */ new Map();
    this.capabilityCache = new Map();
    this.platform = new ProviderPlatformFacade();
    console.log("LLMManager initialized with refactored architecture.");
  }
  // --- Provider Instantiation ---
  getProviderInstance(config) {
    const key = capabilityCacheKey(config, "ADAPTER");
    if (this.providers.has(key)) {
      return this.providers.get(key);
    }
    const provider = this.providerRegistry.createProvider(config);
    this.providers.set(key, provider);
    return provider;
  }
  getRouteProviderConfig(route, snapshot = null) {
    const selected = route === "SUMMARY" ? this.settingsRepository.getSummaryProviderConfig()
      : route === "ACTION" ? this.settingsRepository.getActionsProviderConfig()
      : this.settingsRepository.getActiveProviderConfig();
    if (!snapshot) return selected;
    const pinned = this.settingsRepository.getProviderConfigById?.(snapshot.providerId);
    if (!pinned || pinned.defaultModel !== snapshot.modelId || pinned.providerType !== snapshot.providerType) {
      throw new Error("summary_provider_snapshot_unavailable");
    }
    if (snapshot.cacheKey && capabilityCacheKey(pinned, route) !== snapshot.cacheKey) throw new Error("summary_provider_capabilities_changed");
    return pinned;
  }
  async getProviderCapabilities(route = "CHAT", snapshot = null, control = null, configSnapshot = null) {
    const config = configSnapshot || this.getRouteProviderConfig(route, snapshot);
    assertActive(control?.signal);
    if (!config?.defaultModel) throw new Error(`${route.toLowerCase()}_provider_not_configured`);
    const key = capabilityCacheKey(config, route);
    let cached = this.capabilityCache.get(key);
    if (!cached || cached.expiresAt < Date.now()) {
      let model = null;
      const contextMode = resolveContextMode(config);
      const needsNativeContextLookup = contextMode === "auto"
        || contextMode === "custom" && ["openrouter", "gemini"].includes(config.providerType);
      if (needsNativeContextLookup || !config.customMaxOutputTokens) {
        try {
          const lookupControl = control ? { signal: control.signal, deadline: control.deadline, maxAttempts: 1, check: control.check } : null;
          const models = await awaitWithSignal(this.getProviderInstance(config).listModels?.(config, lookupControl), control?.signal);
          model = Array.isArray(models) ? models.find((candidate) => candidate.id === config.defaultModel) || null : null;
        } catch (error) {
          assertActive(control?.signal);
          if (error.name === "AbortError") throw error;
          console.warn(`[LLMManager] ${route} capability lookup failed:`, error.message || String(error));
        }
      }
      cached = { model, expiresAt: Date.now() + 5 * 60 * 1000 };
      this.capabilityCache.set(key, cached);
    }
    assertActive(control?.signal);
    const capabilities = { ...buildProviderCapabilities(config, resolveProviderCapabilities(config, cached.model, route), cached.model, route), cacheKey: key };
    if (snapshot && (capabilities.contextWindow !== snapshot.contextWindow || capabilities.maxOutputTokens !== snapshot.maxOutputTokens)) {
      throw new Error("summary_provider_capabilities_changed");
    }
    return capabilities;
  }
  createControl(config, route, signal, metadata = {}) {
    const key = capabilityCacheKey(config, route);
    const proof = metadata.promptPlanProof;
    const hasPromptPlanProof = !!proof && typeof proof === "object" && proof.plan && proof.serialized != null;
    const ownerEvidence = hasPromptPlanProof && proof.ownerEvidence === true ? "PRESENT" : "UNKNOWN";
    return createRequestControl({ signal, deadline: metadata.deadline, maxAttempts: metadata.maxAttempts,
      reserveAttempt: metadata.reserveAttempt, onEvent: event => metadata.onProviderEvent?.(event),
      requestType: metadata.requestType || (route === "ACTION" ? "action" : route === "SUMMARY" ? "summary" : "chat"),
      planStatus: hasPromptPlanProof ? "PROMPT_PLAN_V9" : "LEGACY_OBSERVED",
      ownerEvidence,
      promptPlanProof: hasPromptPlanProof ? proof : undefined,
      beforeTransport: typeof metadata.beforeTransportGuard === "function"
        ? (snapshot, promptPlanProof, budget) => metadata.beforeTransportGuard(snapshot, promptPlanProof, budget)
        : undefined,
      onEffectiveRequest: typeof metadata.onEffectiveRequest === "function" ? metadata.onEffectiveRequest : undefined,
      beforeSend: () => {
        const current = this.getRouteProviderConfig(route, metadata.providerSnapshot);
        if (!current || capabilityCacheKey(current, route) !== key || current.apiKey !== config.apiKey) {
          throw new Error("provider_configuration_changed_before_send");
        }
        metadata.beforeSendGuard?.();
      } });
  }
  createCacheDiagnosticsObserver(provider, model, requestType, requestDiff, metadata = {}) {
    try {
      return this.providerDiagnostics?.createCacheDiagnosticsObserver?.({
        provider, model, requestType, requestDiff,
        cacheDiagnosticContext: metadata.cacheDiagnosticContext,
        blocks: metadata.blocks
      }) || null;
    } catch { return null; }
  }
  wireEffectiveRequestObserver(control, observerToken, metadata = {}) {
    control.onEffectiveRequest = typeof metadata.onEffectiveRequest === "function" ? metadata.onEffectiveRequest : null;
    control.onEffectiveRequestDiagnostic = (snapshot, budget) => {
      try { this.providerDiagnostics?.attachEffectiveRequest?.(observerToken, snapshot, budget); } catch {}
    };
  }
  generate(provider, request, config, capabilities, control, estimatedPromptTokens) {
    control?.setEffectiveRequestBudget?.(snapshot => preflightEffectiveRequestBudget(snapshot, {
      capabilities,
      requestedOutputTokens: Number(request.max_tokens) || capabilities.maxOutputTokens,
      countTokens: items => this.TokenCounter.calculateTotalTokens(items)
    }));
    return this.platform.generate(provider, request, config, { capabilities, control, estimatedPromptTokens,
      estimateTokens: text => this.TokenCounter.estimateTokens(text) });
  }
  // --- Core Functionality ---
  async listModelsForProvider(signal, options = {}) {
    const hasInstanceId = options.instanceId !== undefined;
    const selectedConfig = hasInstanceId
      ? this.settingsRepository.getProviderConfigById(options.instanceId)
      : this.settingsRepository.getActiveProviderConfig();
    if (!selectedConfig) {
      const code = hasInstanceId ? "provider_instance_unavailable" : "provider_not_configured";
      const error = new Error(code);
      error.code = code;
      throw error;
    }
    const config = hasInstanceId ? JSON.parse(JSON.stringify(selectedConfig)) : selectedConfig;
    try {
      const provider = this.getProviderInstance(config);
      if (provider.listModels) {
        const control = createRequestControl({ signal, deadline: options.deadline });
        try { return await awaitWithSignal(provider.listModels(config, control), control.signal); }
        finally { control.dispose(); }
      }
      return [];
    } catch (error) {
      console.error(`Error listing models for ${config.customName} (${config.providerType}):`, error);
      throw toProviderError(error);
    }
  }
  async testProviderConnection(signal, options = {}) {
    const config = this.settingsRepository.getActiveProviderConfig();
    if (!config) {
      return { success: false, error: "No active and enabled LLM provider configured." };
    }
    try {
      const provider = this.getProviderInstance(config);
      if (provider.testConnection) {
        const pinned = JSON.parse(JSON.stringify(config));
        const control = this.createControl(pinned, "CHAT", signal, options);
        try { return await awaitWithSignal(provider.testConnection(pinned, control), control.signal); }
        finally { control.dispose(); }
      }
      return { success: false, error: "Provider does not support testConnection method." };
    } catch (error) {
      console.error(`Error testing connection for ${config.customName} (${config.providerType}):`, error);
      return { success: false, error: toProviderError(error).message };
    }
  }
  // Unified method to send requests to the *active* provider
  async sendChatRequest(messages, signal, noStream, metadata = {}) {
    rejectRetiredDurableOutbound(metadata.requestType);
    const selectedConfig = this.settingsRepository.getActiveProviderConfig();
    const activeConfig = selectedConfig && JSON.parse(JSON.stringify(selectedConfig));
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
    const memoryBudgetGuardEnabled = Object.prototype.hasOwnProperty.call(metadata, "memoryBudgetTokens");
    const memoryGuardState = { snapshot: null, capabilities: null, reservedOutputTokens: null };
    let controlMetadata = metadata;
    if (memoryBudgetGuardEnabled) {
      validateMemoryBudgetMessages(request.messages, metadata, this.TokenCounter);
      memoryGuardState.snapshot = memoryBudgetMetadataSnapshot(request.messages, metadata);
      const verifyMemoryAndRequestBudget = () => {
        if (memoryBudgetMetadataSnapshot(request.messages, metadata) !== memoryGuardState.snapshot) {
          throw new Error("chat_memory_budget_request_changed_before_send");
        }
        validateMemoryBudgetMessages(request.messages, metadata, this.TokenCounter);
        if (!memoryGuardState.capabilities || !Number.isSafeInteger(memoryGuardState.reservedOutputTokens)
          || request.max_tokens !== memoryGuardState.reservedOutputTokens) {
          throw new Error("chat_request_budget_changed_before_send");
        }
        const finalBudget = planRequestBudget({
          messages: request.messages,
          capabilities: memoryGuardState.capabilities,
          requestedOutputTokens: memoryGuardState.reservedOutputTokens,
          countTokens: items => this.TokenCounter.calculateTotalTokens(items)
        });
        if (!finalBudget.safe || finalBudget.reservedOutputTokens !== memoryGuardState.reservedOutputTokens) {
          throw new Error("chat_request_budget_exceeded_before_send");
        }
      };
      controlMetadata = {
        ...metadata,
        beforeSendGuard: () => {
          verifyMemoryAndRequestBudget();
          const guardResult = metadata.beforeSendGuard?.();
          if (guardResult && typeof guardResult.then === "function") throw new Error("provider_async_guard_unsupported");
          verifyMemoryAndRequestBudget();
        }
      };
    }
    const control = this.createControl(activeConfig, "CHAT", signal, controlMetadata);
    let capabilities;
    try { capabilities = await this.getProviderCapabilities("CHAT", null, control, activeConfig); }
    catch (error) { control.dispose(); throw toProviderError(error); }
    const requestedMaxTokens = Number(metadata.maxTokens) || Number(request.max_tokens) || capabilities.maxOutputTokens;
    const budget = planRequestBudget({ messages, capabilities, requestedOutputTokens: requestedMaxTokens, countTokens: (items) => this.TokenCounter.calculateTotalTokens(items) });
    if (!budget.safe) {
      control.dispose();
      const error = new Error("chat_request_budget_exceeded");
      error.budget = budget;
      throw error;
    }
    request.max_tokens = budget.reservedOutputTokens;
    if (memoryBudgetGuardEnabled) {
      memoryGuardState.capabilities = Object.freeze({
        contextWindow: capabilities.contextWindow,
        maxOutputTokens: capabilities.maxOutputTokens
      });
      memoryGuardState.reservedOutputTokens = budget.reservedOutputTokens;
    }
    const estimatedPromptTokens = this.TokenCounter.calculateTotalTokens(messages);
    console.log(`[LLMManager] Chat request: provider=${activeConfig.providerType}, model=${activeConfig.defaultModel}, messages=${messages.length}, estimatedPromptTokens=${estimatedPromptTokens}${isDeepseekChat ? `, maxTokens=${request.max_tokens}, thinking=enabled` : ""}`);
    const requestType = metadata.requestType || "chat";
    const v89Settings = this.settingsRepository.getChatPromptV89Settings?.() || { chatPromptV89OutboundDiagnostics: true };
    const diagnosticRequest = typeof provider.buildDiagnosticRequest === "function"
      ? provider.buildDiagnosticRequest(request, activeConfig)
      : request;
    const realRequestDiff = requestType === "chat" && v89Settings.chatPromptV89OutboundDiagnostics !== false
      ? this.providerDiagnostics?.prepareOutboundRequest({
        provider: activeConfig.providerType,
        model: activeConfig.defaultModel,
        requestType,
        request: diagnosticRequest,
        messages: diagnosticRequest.messages,
        blocks: metadata.blocks,
        conversationId: metadata.conversationId,
        responderId: metadata.responderId,
        baseUrl: activeConfig.baseUrl,
        promptProfile: metadata.promptProfile,
        staticTokens: metadata.staticTokens,
        dynamicTokens: metadata.dynamicTokens,
        prefixFingerprint: metadata.prefixFingerprint,
        globalStaticTokens: metadata.globalStaticTokens,
        conversationFrozenTokens: metadata.conversationFrozenTokens,
        responderFrozenTokens: metadata.responderFrozenTokens,
        stableKinshipTokens: metadata.stableKinshipTokens,
        actualStablePrefixTokens: metadata.actualStablePrefixTokens,
        declaredStaticTokens: metadata.declaredStaticTokens,
        dynamicTailTokens: metadata.dynamicTailTokens,
        cacheDiagnosticContext: metadata.cacheDiagnosticContext
      }) || null
      : null;
    const cacheDiagnosticsObserverToken = this.createCacheDiagnosticsObserver(
      activeConfig.providerType, activeConfig.defaultModel, requestType, realRequestDiff, metadata);
    this.wireEffectiveRequestObserver(control, cacheDiagnosticsObserverToken, metadata);
    const requestStartedAt = new Date().toISOString();
    const { performanceTraceContext, ...usageMetadata } = metadata;
    const traceRequest = this.performanceTrace?.enabled && performanceTraceContext
      && (requestType === "chat" || requestType === "chat_continuation");
    const providerSpan = traceRequest
      ? this.performanceTrace.startSpan("provider.requestStart", { attribution: "PROVIDER", context: performanceTraceContext })
      : null;
    if (providerSpan) this.performanceTrace.record("provider.requestStart", { attribution: "PROVIDER", context: performanceTraceContext, wallMs: 0, result: "OK" });
    try {
      return await this.trackUsage(this.generate(provider, request, activeConfig, capabilities, control, estimatedPromptTokens), {
      ...usageMetadata,
      contextMode: capabilities.contextMode,
      contextWindowSource: capabilities.contextWindowSource,
      effectiveContextWindow: capabilities.contextWindow,
      requestBudget: budget,
      requestType,
      providerType: activeConfig.providerType,
      model: activeConfig.defaultModel,
      estimatedPromptTokens,
      realRequestDiff,
      cacheDiagnosticsObserverToken,
      requestStartedAt,
      requestControl: control,
      captureChatTiming: requestType === "chat"
      }, providerSpan);
    } catch (error) {
      try { providerSpan?.({ step: "provider.streamEnd", result: "ERROR", errorCode: "provider_error" }); } catch (_traceError) {}
      throw error;
    }
  }
  /**
   * Send a structured JSON request for Actions.
   * Uses the actions provider override if set, otherwise active provider.
   */
  async sendActionsRequest(messages, schemaName, jsonSchemaObject, signal, metadata = {}) {
    rejectRetiredDurableOutbound(metadata.requestType);
    const trustedIntroSuffix = metadata.trustedActionIntroSuffix === undefined ? "" : metadata.trustedActionIntroSuffix;
    const requestMetadata = { ...metadata };
    delete requestMetadata.trustedActionIntroSuffix;
    const selectedConfig = this.settingsRepository.getActionsProviderConfig();
    const config = selectedConfig && JSON.parse(JSON.stringify(selectedConfig));
    if (!config) {
      throw new Error("No provider configured for Actions.");
    }
    if (!config.defaultModel) {
      throw new Error(`Provider '${config.customName || config.providerType}' has no default model selected.`);
    }
    const provider = this.getProviderInstance(config);
    const isDeepseekAction = config.providerType === "deepseek" && schemaName === "votc_actions";
    const isOpenAICompatibleAction = config.providerType === "openai-compatible" && schemaName === "votc_actions";
    const actionSchemaDeliveryMode = isDeepseekAction || isOpenAICompatibleAction
      ? config.actionSchemaDeliveryMode || (isDeepseekAction ? "optimized_local_validation" : "official_full_injected") : null;
    const overlayEnabled = isDeepseekAction && config.deepseekActionStateTransitionRecallOverlay === true;
    const stablePrefixRequested = isDeepseekAction && config.deepseekActionStablePrefixOptimization === true;
    const preparedActionPrompt = isDeepseekAction ? prepareActionMessages(messages, {
      overlayEnabled,
      stablePrefixEnabled: stablePrefixRequested,
      trustedIntroSuffix
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
      response_format: isOpenAICompatibleAction && actionSchemaDeliveryMode === "optimized_local_validation" ? { type: "json_object" } : {
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
    const deepseekSchemaInjection = isDeepseekAction;
    const providerInjectsSchema = (isDeepseekAction || isOpenAICompatibleAction) && actionSchemaDeliveryMode !== "optimized_local_validation";
    const schemaCacheRole = actionSchemaDeliveryMode === "optimized_local_validation" ? "local_validation_only" : isDeepseekAction ? "provider_injected_system_message" : "response_format";
    const stableActionOrder = "deepseek_intro" + (preparedActionPrompt.overlayApplied ? "_state_transition_rules" : "")
      + "_examples_turn_identity_v1_actions" + (providerInjectsSchema ? "_provider_schema" : "")
      + "_roster_recent_actions_recent_messages_final";
    const providerSerializedOrder = preparedActionPrompt.stablePrefixApplied ? stableActionOrder : preparedActionPrompt.overlayApplied ? "deepseek_official_order_with_state_transition_overlay" : stablePrefixRequested && preparedActionPrompt.failureReason ? "messages_official_fail_open" : isOpenAICompatibleAction ? actionSchemaDeliveryMode === "optimized_local_validation" ? "messages_then_json_object_local_validation" : "messages_then_response_format_json_schema" : providerInjectsSchema ? "messages_then_provider_injected_schema_then_response_format" : "messages_then_response_format";
    const actionPromptBlocks = schemaName === "votc_actions" && (!Array.isArray(requestMetadata.blocks) || requestMetadata.blocks.length === 0) ? this.buildActionPromptBlocks(preparedActionPrompt.blockMessages, serializedSchema, providerInjectsSchema, preparedActionPrompt.stablePrefixApplied) : Array.isArray(requestMetadata.blocks) ? requestMetadata.blocks : [];
    const firstDynamicPosition = preparedActionPrompt.stablePrefixApplied ? actionPromptBlocks.findIndex((block) => block.stable !== true) : -1;
    const stablePrefixEndPosition = preparedActionPrompt.stablePrefixApplied ? firstDynamicPosition < 0 ? actionPromptBlocks.length : firstDynamicPosition : null;
    const stablePrefixTokens = stablePrefixEndPosition !== null ? actionPromptBlocks.slice(0, stablePrefixEndPosition).reduce((sum, block) => sum + (Number(block.tokens) || 0), 0) : 0;
    const overlayBlock = actionPromptBlocks.find((block) => block.id === OVERLAY_BLOCK_ID);
    console.log(`[LLMManager] Action request: provider=${config.providerType}, model=${config.defaultModel}, messages=${preparedActionPrompt.messages.length}, schema=${schemaName}, estimatedPromptTokens=${estimatedPromptTokens}`);
    const control = this.createControl(config, "ACTION", signal, requestMetadata);
    let capabilities;
    try { capabilities = await this.getProviderCapabilities("ACTION", null, control, config); }
    catch (error) { control.dispose(); throw toProviderError(error); }
    const budget = planRequestBudget({ messages: preparedActionPrompt.messages, capabilities,
      requestedOutputTokens: Number(request.max_tokens) || capabilities.maxOutputTokens,
      countTokens: items => this.TokenCounter.calculateTotalTokens(items) + (providerInjectsSchema ? schemaTokenEstimate : 0) });
    if (!budget.safe) { control.dispose(); throw new Error("action_request_budget_exceeded"); }
    const cacheDiagnosticsObserverToken = this.createCacheDiagnosticsObserver(
      config.providerType, config.defaultModel, "action", null, { ...requestMetadata, blocks: actionPromptBlocks });
    this.wireEffectiveRequestObserver(control, cacheDiagnosticsObserverToken, requestMetadata);
    return await this.trackUsage(this.generate(provider, request, config, capabilities, control, estimatedPromptTokens), {
      ...requestMetadata,
      requestControl: control,
      requestBudget: budget,
      cacheDiagnosticsObserverToken,
      contextMode: capabilities.contextMode,
      contextWindowSource: capabilities.contextWindowSource,
      effectiveContextWindow: capabilities.contextWindow,
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
  buildActionPromptBlocks(messages, serializedSchema, providerInjectsSchema = true, stablePrefixApplied = false) {
    const definitions = new Map([
      ["action_system_intro", ["Action system introduction", "action_prompt", stablePrefixApplied]],
      [OVERLAY_BLOCK_ID, ["State transition recall rules", "action_prompt", true]],
      [ACTION_TURN_IDENTITY_BLOCK_ID, ["Current action turn identity", "action_prompt", false]],
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
    const fallbackDefinitions = [...definitions.entries()]
      .filter(([id]) => id !== ACTION_TURN_IDENTITY_BLOCK_ID || messages.some((message) => message?.blockId === id))
      .map(([id, [label, type, stable]]) => [id, label, type, stable]);
    const fallbackSchemaPosition = Math.max(0, fallbackDefinitions.findIndex(([id]) => id === "action_available_actions") + 1);
    fallbackDefinitions.splice(fallbackSchemaPosition, 0, ["action_provider_schema", "Provider schema", "action_provider_schema", false]);
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
    const order = ["action_system_intro", OVERLAY_BLOCK_ID, "action_examples", ACTION_TURN_IDENTITY_BLOCK_ID,
      "action_available_actions", "action_provider_schema", "action_roster", "action_recent_actions",
      "action_recent_messages", "action_final_instruction"];
    const positions = new Map(order.map((id, index) => [id, index]));
    return [...blocks].sort((left, right) => (positions.get(left.id) ?? order.length) - (positions.get(right.id) ?? order.length)).map((block, position) => ({ ...block, position }));
  }
  /**
   * Send a request for Summaries (rolling or final).
   * Uses the summary provider override if set, otherwise active provider.
   */
  async sendSummaryRequest(messages, signal, metadata = {}) {
    rejectRetiredDurableOutbound(metadata.requestType);
    const selectedConfig = this.getRouteProviderConfig("SUMMARY", metadata.providerSnapshot);
    const config = selectedConfig && JSON.parse(JSON.stringify(selectedConfig));
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
    let capabilities;
    const control = this.createControl(config, "SUMMARY", signal, metadata);
    try {
      capabilities = await this.getProviderCapabilities("SUMMARY", metadata.providerSnapshot, control, config);
    } catch (error) {
      control.dispose();
      throw error;
    }
    const structuredSummaryMaxTokens = Number.isInteger(requestedMaxTokens) && requestedMaxTokens >= 256 ? Math.min(requestedMaxTokens, capabilities.maxOutputTokens) : Math.min(4096, capabilities.maxOutputTokens);
    const request = {
      model: config.defaultModel,
      messages: preparedMessages,
      stream: false,
      // summaries don't need streaming
      ...config.defaultParameters,
      ...useDeepseekNonThinking ? { thinking: { type: "disabled" }, max_tokens: structuredSummaryMaxTokens, response_format: { type: "json_object" } } : isStructuredSummary ? { max_tokens: structuredSummaryMaxTokens, response_format: { type: "json_object" } } : Number.isInteger(requestedMaxTokens) && requestedMaxTokens >= 256 ? { max_tokens: structuredSummaryMaxTokens } : {},
      signal
    };
    const budget = planRequestBudget({ messages: preparedMessages, capabilities, requestedOutputTokens: Number(request.max_tokens) || structuredSummaryMaxTokens, countTokens: (items) => this.TokenCounter.calculateTotalTokens(items) });
    if (!budget.safe) {
      control.dispose();
      const error = new Error("summary_request_budget_exceeded");
      error.budget = budget;
      throw error;
    }
    request.max_tokens = budget.reservedOutputTokens;
    const estimatedPromptTokens = this.TokenCounter.calculateTotalTokens(preparedMessages);
    const requestType = metadata.requestType || "summary";
    const cacheDiagnosticsObserverToken = this.createCacheDiagnosticsObserver(
      config.providerType, config.defaultModel, requestType, null, { ...metadata, blocks: summaryBlocks });
    this.wireEffectiveRequestObserver(control, cacheDiagnosticsObserverToken, metadata);
    const deepseekMode = useDeepseekNonThinking ? `, maxTokens=${structuredSummaryMaxTokens}, thinking=disabled` : "";
    console.log(`[LLMManager] Summary request: provider=${config.providerType}, model=${config.defaultModel}, messages=${preparedMessages.length}, estimatedPromptTokens=${estimatedPromptTokens}${deepseekMode}`);
    try {
      return await this.trackUsage(this.generate(provider, request, config, capabilities, control, estimatedPromptTokens), { ...metadata,
        contextMode: capabilities.contextMode, contextWindowSource: capabilities.contextWindowSource, effectiveContextWindow: capabilities.contextWindow,
        requestControl: control,
        requestBudget: budget, blocks: summaryBlocks, requestType, cacheDiagnosticsObserverToken,
        providerType: config.providerType, model: config.defaultModel, estimatedPromptTokens });
    } catch (error) {
      control.dispose();
      throw error;
    }
  }
  async trackUsage(result, metadata, performanceSpan = null) {
    const finishSpan = (status, errorCode) => {
      try { performanceSpan?.({ step: "provider.streamEnd", result: status === "COMPLETE" ? "OK" : status, errorCode }); } catch {}
    };
    let recorded = false;
    const recordUsage = (finalResponse, timing = {}, terminalStatus = undefined) => {
      if (recorded) return;
      recorded = true;
      const typed = normalizeProviderResult(finalResponse, { providerType: metadata.providerType, model: metadata.model,
        estimatedInputTokens: metadata.estimatedPromptTokens, estimateTokens: text => this.TokenCounter.estimateTokens(text), terminalStatus });
      const usage = this.buildUsageRecord(finalResponse, { ...metadata, generationStatus: typed.status });
      const safeMetadata = { ...metadata, generationStatus: typed.status, providerFinish: typed.finish.normalized,
        providerUsage: typed.usage, providerAttemptCount: metadata.requestControl?.attemptCount ?? null };
      delete safeMetadata.requestControl; delete safeMetadata.reserveAttempt; delete safeMetadata.onProviderEvent;
      delete safeMetadata.beforeTransportGuard; delete safeMetadata.promptPlanProof;
      delete safeMetadata.cacheDiagnosticContext;
      delete safeMetadata.cacheDiagnosticsObserverToken;
      this.usageAnalytics.record(safeMetadata, usage);
      const diagnosticsMetadata = { ...safeMetadata, cacheDiagnosticsObserverToken: metadata.cacheDiagnosticsObserverToken };
      this.providerDiagnostics?.recordResponse({ provider: metadata.providerType, model: metadata.model,
        requestType: metadata.requestType, response: { ...finalResponse, finish_reason: typed.finish.normalized },
        usage, metadata: diagnosticsMetadata, startedAt: metadata.requestStartedAt,
        firstReasoningAt: timing.firstReasoningAt, firstVisibleContentAt: timing.firstVisibleContentAt,
        completedAt: timing.completedAt || new Date().toISOString() });
      finishSpan(typed.status, ["ERROR", "PARTIAL"].includes(typed.status) ? "provider_error"
        : typed.status === "CANCELLED" ? "cancelled" : typed.status === "COMPLETE" ? undefined : "provider_incomplete");
    };
    let response;
    try { response = await result; }
    catch (error) {
      recordUsage({}, {}, error.name === "AbortError" ? "CANCELLED" : "ERROR");
      throw toProviderError(error, { attemptCount: metadata.requestControl?.attemptCount });
    }
    if (response && typeof response[Symbol.asyncIterator] === "function") {
      const iterator = response[Symbol.asyncIterator]();
      const generator = (async function*() {
          let firstReasoningAt = null, firstVisibleContentAt = null, firstByteTraced = false, firstVisibleTraced = false;
          let completed = false;
          const partial = { content: "", usage: undefined };
          try {
            while (true) {
              const step = await iterator.next();
              if (step.done) {
                completed = true;
                recordUsage(step.value, { firstReasoningAt, firstVisibleContentAt });
                return step.value;
              }
              if (step.value?.usage) partial.usage = step.value.usage;
              if (step.value?.usage_debug) partial.usage_debug = step.value.usage_debug;
              if (typeof step.value?.delta?.content === "string") partial.content += step.value.delta.content;
              if (performanceSpan && !firstByteTraced) {
                try { performanceSpan.mark("provider.firstByte", { attribution: "PROVIDER" }); } catch {}
                firstByteTraced = true;
              }
              if (metadata.captureChatTiming && !firstReasoningAt && step.value?.delta?.reasoning) firstReasoningAt = new Date().toISOString();
              if (metadata.captureChatTiming && !firstVisibleContentAt && step.value?.delta?.content) firstVisibleContentAt = new Date().toISOString();
              if (performanceSpan && !firstVisibleTraced && step.value?.delta?.content) {
                try { performanceSpan.mark("provider.firstVisibleToken", { attribution: "PROVIDER" }); } catch {}
                firstVisibleTraced = true;
              }
              yield step.value;
            }
          } catch (error) {
            recordUsage(partial, { firstReasoningAt, firstVisibleContentAt }, error.name === "AbortError" ? "CANCELLED" : partial.content ? "PARTIAL" : "ERROR");
            throw toProviderError(error, { responseStarted: !!partial.content, attemptCount: metadata.requestControl?.attemptCount });
          } finally {
            if (!completed) {
              metadata.requestControl?.cancel();
              try { await awaitWithSignal(iterator.return?.(), metadata.requestControl?.signal); } catch {}
              recordUsage(partial, { firstReasoningAt, firstVisibleContentAt }, "CANCELLED");
            }
            metadata.requestControl?.dispose();
          }
      })();
      return managedIterator(generator, async () => {
        metadata.requestControl?.cancel();
        try { await awaitWithSignal(iterator.return?.(), metadata.requestControl?.signal); } catch {}
        recordUsage({}, {}, "CANCELLED"); metadata.requestControl?.dispose();
      }, metadata.requestControl?.signal, () => metadata.requestControl?.cancel());
    }
    const completedAt = new Date().toISOString();
    if (performanceSpan) {
      try { performanceSpan.mark("provider.firstByte", { attribution: "PROVIDER" }); } catch {}
      if (response?.content) { try { performanceSpan.mark("provider.firstVisibleToken", { attribution: "PROVIDER" }); } catch {} }
    }
    recordUsage(response, { firstReasoningAt: metadata.captureChatTiming && response?.reasoning ? completedAt : null,
      firstVisibleContentAt: metadata.captureChatTiming && response?.content ? completedAt : null, completedAt });
    return response;
  }
  buildUsageRecord(response, metadata = {}) {
    const typed = normalizeProviderResult(response, { providerType: metadata.providerType, model: metadata.model,
      estimatedInputTokens: metadata.estimatedPromptTokens, estimateTokens: this.TokenCounter?.estimateTokens
        ? text => this.TokenCounter.estimateTokens(text) : undefined, terminalStatus: metadata.generationStatus });
    const canonical = { ...typed.usage, status: typed.status };
    if (response?.usage && typeof response.usage === "object") {
      return { ...require("./providers/usage-normalization").normalizeProviderUsage(response.usage), ...canonical };
    }
    const promptTokens = Math.max(0, Math.floor(Number(metadata.estimatedPromptTokens) || 0));
    const completionSource = typeof response?.content === "string" ? response.content : response?.tool_calls ? JSON.stringify(response.tool_calls) : "";
    const completionTokens = Math.max(0, Math.floor(Number(this.TokenCounter.estimateTokens(completionSource)) || 0));
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      votc_estimated: true,
      ...canonical
    };
  }
  // Get current context length for the active provider
  async getCurrentContextLength() {
    return (await this.getProviderCapabilities("CHAT")).contextWindow;
  }
  async getContextDiagnostics() {
    const capabilities = await this.getProviderCapabilities("CHAT");
    const budget = planRequestBudget({ messages: [], capabilities, countTokens: () => 0 });
    return { contextMode: capabilities.contextMode, contextWindowSource: capabilities.contextWindowSource,
      effectiveContextWindow: capabilities.contextWindow, configuredContextLength: capabilities.configuredContextLength,
      modelNativeContext: capabilities.modelNativeContext, outputReserveTokens: budget.reservedOutputTokens,
      usableInputBudget: budget.effectiveInputBudget, budgetStatus: budget.budgetStatus };
  }
  // Get the maximum context length for the current model
  async getMaxContextLength() {
    return (await this.getProviderCapabilities("CHAT")).contextWindow;
  }
  // Set custom context length for the active provider
  setCustomContextLength(contextLength) {
    validateContextConfiguration({ contextMode: "custom", customContextLength: contextLength });
    const activeConfig = this.settingsRepository.getActiveProviderConfig();
    if (!activeConfig) {
      throw new Error("No active and enabled LLM provider configured.");
    }
    const updatedConfig = {
      ...activeConfig,
      contextMode: "custom",
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
    configWithoutCustomContext.contextMode = "auto";
    this.settingsRepository.saveProviderConfig(configWithoutCustomContext);
  }
}

module.exports = { ProviderRegistry, TokenCounter, LLMManager };
