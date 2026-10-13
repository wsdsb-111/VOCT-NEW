"use strict";
const OpenAI = require("openai");
const { VOTC_CORE_VERSION, VOTC_APP_VERSION } = require("../version");
const { retryOperation } = require("./provider-retry-policy");
const { SOURCE_GUARD_CODE, toProviderError, safeProviderConsole } = require("./provider-errors");
const { assertActive, awaitWithSignal } = require("./provider-cancellation");
const { validateGenerationOutcome } = require("./generation-outcome");
const console = safeProviderConsole;

function isRetryableProviderStatus(error) {
  const status = Number(error?.status);
  return status === 429 || [502, 503, 504].includes(status);
}

function isRequestControlStop(error, requestControl) {
  return error?.message === SOURCE_GUARD_CODE || requestControl?.signal?.aborted === true || error?.name === "AbortError" || error?.name === "TimeoutError";
}

function requestControlWithSignal(requestControl, request) {
  const signal = requestControl?.signal || request?.signal;
  if (!signal || requestControl?.signal === signal) return requestControl;
  return { ...(requestControl || {}), signal };
}

function checkRequestControl(requestControl) {
  assertActive(requestControl?.signal);
  requestControl?.check?.();
  assertActive(requestControl?.signal);
}

function isStrictlyComplete(response, provider) {
  const outcome = validateGenerationOutcome(response, { providerType: provider });
  return outcome.status === "COMPLETE" && outcome.complete === true;
}

function testConnectionFailure(error, provider, model, requestControl) {
  if (isRequestControlStop(error, requestControl)) throw error;
  const providerError = safeError(error, provider, model);
  safeProviderConsole.error(providerError);
  return { success: false, error: providerError.message };
}

function safeError(error, provider, model, responseStarted = false) {
  return toProviderError(error, {
    provider,
    model,
    responseStarted,
    attemptCount: Number.isSafeInteger(error?.votcAttemptCount) ? error.votcAttemptCount : 1
  });
}

function nativeUsage(promptTokens, completionTokens) {
  const usage = {};
  if (Number.isFinite(promptTokens)) usage.prompt_tokens = promptTokens;
  if (Number.isFinite(completionTokens)) usage.completion_tokens = completionTokens;
  if (Number.isFinite(promptTokens) && Number.isFinite(completionTokens)) usage.total_tokens = promptTokens + completionTokens;
  return Object.keys(usage).length ? usage : void 0;
}

class BaseProvider {
  constructor() {
    this.requiresBaseUrl = false;
  }
  /**
   * Validates the provider configuration
   * @param config - The provider configuration to validate
   */
  validateConfig(config) {
    if (!config.apiKey) {
      throw new Error(`API key is required for ${this.name}`);
    }
    if (this.requiresBaseUrl && !config.baseUrl) {
      throw new Error(`Base URL is required for ${this.name}`);
    }
    if (!config.defaultModel) {
      throw new Error(`Default model is required for ${this.name}`);
    }
  }
  /**
   * Tests connection to the LLM provider
   * @param config - Provider configuration
   * @returns Connection test result
   */
  async testConnection(config, requestControl = null) {
    try {
      checkRequestControl(requestControl);
      this.validateConfig(config);
      const testMessages = [{
        role: "user",
        content: "Hi."
      }];
      const response = await this.chatCompletion({
        model: config.defaultModel,
        messages: testMessages,
        max_tokens: 10,
        stream: false
      }, config, requestControl);
      checkRequestControl(requestControl);
      if (!isStrictlyComplete(response, this.providerId)) {
        return { success: false, error: "Provider returned an incomplete test response." };
      }
      return {
        success: true,
        message: `Successfully connected to ${this.name}`
      };
    } catch (error) {
      return testConnectionFailure(error, this.providerId, config?.defaultModel, requestControl);
    }
  }
  /**
   * Lists available models (if provider supports it)
   * @param config - Provider configuration
   * @returns Array of available models
   */
  async listModels(config, requestControl = null) {
    try {
      this.validateConfig(config);
      checkRequestControl(requestControl);
      console.warn(`[${this.providerId}] Model listing not implemented for ${this.name}`);
      return [];
    } catch (error) {
      if (isRequestControlStop(error, requestControl)) throw error;
      console.error(`[${this.providerId}] Error listing models:`, error);
      throw error;
    }
  }
  /**
   * Helper method to create consistent error messages
   */
  createErrorMessage(operation, error) {
    const providerError = safeError(error, this.providerId, void 0);
    return `[${this.providerId}] ${operation} failed: ${providerError.code || "provider_unknown"}`;
  }
  /**
   * Helper method to validate messages format
   */
  validateMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("Messages must be a non-empty array");
    }
    for (const message of messages) {
      if (!message.role || !message.content) {
        throw new Error("Each message must have role and content");
      }
    }
  }
  getAPIKey(config) {
    if (!config.apiKey) {
      throw new Error(`Invalid configuration for ${this.name}: API key is missing.`);
    }
    return config.apiKey;
  }
  getBaseUrl(config) {
    if (!config.baseUrl) {
      throw new Error(`Invalid configuration for ${this.name}: Base URL is missing.`);
    }
    return config.baseUrl;
  }
  /**
   * Retry an async operation with exponential backoff
   * @param operation The async operation to retry
   * @param maxRetries Retained for existing call sites; the adapter policy caps requests at two total attempts
   * @param initialDelay Initial delay in milliseconds (default: 1000)
   * @param shouldRetry Function to determine if a classified HTTP status may be retried
   * @returns Promise resolving to operation result
   */
  async retryWithBackoff(operation, _maxRetries = 1, initialDelay = 1e3, shouldRetry = isRetryableProviderStatus, requestControl = null) {
    return retryOperation(operation, {
      signal: requestControl?.signal,
      deadline: requestControl?.deadline,
      maxAttempts: requestControl?.maxAttempts ?? 2,
      initialDelay,
      shouldRetry,
      check: requestControl?.check
    });
  }
}
const isOpenRouterFreeModel = (modelData) => {
  return modelData.id.endsWith(":free") || modelData.pricing?.prompt === "0.000000" && modelData.pricing?.completion === "0.000000";
};
class OpenRouterProvider extends BaseProvider {
  constructor() {
    super(...arguments);
    this.providerId = "openrouter";
    this.name = "OpenRouter";
  }
  /**
   * Determine if an error should trigger a retry
   * @param error The error to check
   * @returns true if the error is retryable
   */
  shouldRetryOpenRouter(error) {
    return isRetryableProviderStatus(error);
  }
  async listModels(config, requestControl = null) {
    try {
      const response = await this.retryWithBackoff(() => {
        requestControl?.beforeSend?.();
        return fetch("https://openrouter.ai/api/v1/models", {
          ...requestControl?.signal ? { signal: requestControl.signal } : {},
          method: "GET",
          headers: {
            "Authorization": `Bearer ${this.getAPIKey(config)}`,
            "Content-Type": "application/json"
          }
        });
      }, 1, 1e3, isRetryableProviderStatus, requestControl);
      checkRequestControl(requestControl);
      if (!response.ok) {
        const error = new Error("provider_http_error");
        error.status = response.status;
        error.headers = response.headers;
        throw error;
      }
      const { data } = await response.json();
      if (!Array.isArray(data)) {
        throw Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
      }
      return data.map((modelData) => ({
        id: modelData.id,
        name: modelData.name || modelData.id,
        isFree: isOpenRouterFreeModel(modelData),
        contextLength: modelData.context_length
        // Add other properties as needed, e.g., pricing details
      }));
    } catch (error) {
      const providerError = safeError(error, "openrouter", "models");
      console.error(providerError);
      throw providerError;
    }
  }
  chatCompletion(request, config, requestControl = null) {
    requestControl = requestControlWithSignal(requestControl, request);
    const openAIClient = new OpenAI({
      maxRetries: 0,
      apiKey: this.getAPIKey(config),
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/Voices-of-the-Court/VOTC",
        "X-Title": `Voices of the Court V${VOTC_CORE_VERSION}`
      }
    });
    const requestParams = {
      model: request.model,
      messages: request.messages,
      stream: request.stream,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      top_p: request.top_p,
      presence_penalty: request.presence_penalty,
      frequency_penalty: request.frequency_penalty,
      ...request.response_format ? { response_format: request.response_format } : {},
      // OpenRouter-specific: exclude reasoning/thinking tokens from the response
      reasoning: {
        exclude: true
      }
    };
    if (requestParams.stream) {
      return this._streamChatCompletion(requestParams, openAIClient, requestControl?.signal || request.signal, requestControl);
    } else {
      return this._nonStreamChatCompletion(requestParams, openAIClient, requestControl);
    }
  }
  async _nonStreamChatCompletion(request, openAIClient, requestControl = null) {
    try {
      const data = await this.retryWithBackoff(
        () => {
          requestControl?.beforeSend?.();
          return openAIClient.chat.completions.create(request, requestControl?.signal ? { signal: requestControl.signal } : void 0);
        },
        3,
        1e3,
        this.shouldRetryOpenRouter.bind(this),
        requestControl
      );
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error(`OpenRouter SDK: No choices returned for model ${request.model}`);
      }
      return {
        id: data.id,
        content: choice.message?.content ?? null,
        tool_calls: choice.message?.tool_calls,
        finish_reason: choice.finish_reason ?? null,
        usage: data.usage ? {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens,
          prompt_cache_hit_tokens: data.usage.prompt_cache_hit_tokens,
          prompt_cache_miss_tokens: data.usage.prompt_cache_miss_tokens,
          prompt_tokens_details: data.usage.prompt_tokens_details,
          completion_tokens_details: data.usage.completion_tokens_details,
          reasoning_tokens: data.usage.reasoning_tokens,
          visible_completion_tokens: data.usage.visible_completion_tokens
        } : void 0
      };
    } catch (error) {
      const providerError = safeError(error, "openrouter", request.model);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
  }
  async *_streamChatCompletion(request, openAIClient, signal, requestControl = null) {
    let responseStarted = false;
    try {
      const stream = await this.retryWithBackoff(
        () => {
          requestControl?.beforeSend?.();
          return openAIClient.chat.completions.create(request, signal ? { signal } : void 0);
        },
        7,
        1e3,
        this.shouldRetryOpenRouter.bind(this),
        requestControl
      );
      const contentParts = [];
      const toolCallsMap = {};
      let finalUsage = void 0;
      let finalFinishReason = null;
      let firstChunkId = "";
      for await (const chunk of stream) {
        responseStarted = true;
        const choice = chunk.choices[0];
        if (choice?.finish_reason === "error") {
          const choiceWithError = choice;
          if (choiceWithError.error) {
            throw Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
          } else {
            throw new Error(
              `OpenRouter Mid-Stream Error: Stream terminated with error status but no error details provided`
            );
          }
        }
        if (!firstChunkId && chunk.id) {
          firstChunkId = chunk.id;
        }
        if (!choice) {
          if (chunk.usage) {
            finalUsage = chunk.usage;
            yield { id: chunk.id, usage: chunk.usage, finish_reason: null };
          }
          continue;
        }
        const delta = choice.delta;
        const finish_reason = choice.finish_reason;
        if (chunk.usage) {
          finalUsage = chunk.usage;
        }
        const streamChunk = {
          id: chunk.id,
          delta: delta ? {
            content: delta.content || void 0,
            // Some providers emit hidden reasoning before the visible answer.
            // Forward only a presence marker; the reasoning text is never
            // shown in the UI or retained in the conversation history.
            reasoning: delta.reasoning_content || delta.reasoning ? true : void 0,
            role: delta.role,
            tool_calls: delta.tool_calls
          } : void 0,
          finish_reason,
          ...chunk.usage ? { usage: chunk.usage } : {}
        };
        yield streamChunk;
        if (delta?.content) {
          contentParts.push(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const key = Number.isInteger(tc.index) ? String(tc.index) : `unindexed-${Object.keys(toolCallsMap).length}`;
            if (!toolCallsMap[key]) {
              toolCallsMap[key] = {
                id: tc.id || void 0,
                type: "function",
                function: { name: "", arguments: "" }
              };
            }
            if (tc.id) toolCallsMap[key].id = tc.id;
            if (tc.function?.name) {
              toolCallsMap[key].function.name = tc.function.name;
            }
            if (tc.function?.arguments) {
              toolCallsMap[key].function.arguments += tc.function.arguments;
            }
          }
        }
        if (finish_reason) {
          finalFinishReason = finish_reason;
        }
      }
      const toolCalls = Object.values(toolCallsMap);
      return {
        id: firstChunkId,
        content: contentParts.join(""),
        tool_calls: toolCalls.length > 0 ? toolCalls : void 0,
        finish_reason: finalFinishReason,
        usage: finalUsage
      };
    } catch (error) {
      const providerError = safeError(error, "openrouter", request.model, responseStarted);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
  }
  async testConnection(config, requestControl = null) {
    try {
      checkRequestControl(requestControl);
      const testRequest = {
        model: config.defaultModel || "openrouter/auto",
        // Use a known cheap/fast model or user's default
        messages: [{ role: "user", content: "Test" }],
        max_tokens: 1,
        stream: false
      };
      const response = await this.chatCompletion(testRequest, config, requestControl);
      checkRequestControl(requestControl);
      if (isStrictlyComplete(response, "openrouter")) {
        return { success: true, message: `Successfully connected to OpenRouter. Received response ID: ${response.id}` };
      }
      return { success: false, error: "Test connection to OpenRouter failed to get a valid response." };
    } catch (error) {
      return testConnectionFailure(error, "openrouter", config?.defaultModel, requestControl);
    }
  }
}
class OpenAICompatibleProvider extends BaseProvider {
  constructor() {
    super(...arguments);
    this.providerId = "openai-compatible";
    this.name = "OpenAI-Compatible API";
  }
  /**
   * Determine if an error should trigger a retry
   * @param error The error to check
   * @returns true if the error is retryable
   */
  shouldRetry(error) {
    return isRetryableProviderStatus(error);
  }
  async listModels(config, requestControl = null) {
    const headers = {
      "Content-Type": "application/json",
      "X-Title": `Voices of the Court V${VOTC_CORE_VERSION}`,
      "User-Agent": `VOTC/${VOTC_APP_VERSION}`,
      // Custom User-Agent to avoid Cloudflare blocking
      ...this.getAPIKey(config) && { "Authorization": `Bearer ${this.getAPIKey(config)}` }
    };
    try {
      const openAIClient = new OpenAI({
        apiKey: this.getAPIKey(config),
        baseURL: this.getBaseUrl(config),
        defaultHeaders: headers,
        maxRetries: 0
      });
      const response = await this.retryWithBackoff(
        () => {
          requestControl?.beforeSend?.();
          return openAIClient.models.list(requestControl?.signal ? { signal: requestControl.signal } : void 0);
        },
        3,
        1e3,
        this.shouldRetry.bind(this),
        requestControl
      );
      checkRequestControl(requestControl);
      return response.data.map((modelData) => ({
        id: modelData.id,
        name: modelData.id
      }));
    } catch (error) {
      if (isRequestControlStop(error, requestControl)) throw error;
      safeProviderConsole.warn(error);
      try {
        const response = await this.retryWithBackoff(() => {
          requestControl?.beforeSend?.();
          return fetch(`${this.getBaseUrl(config)}/models`, {
            ...requestControl?.signal ? { signal: requestControl.signal } : {},
            method: "GET",
            headers
          });
        }, 1, 1e3, this.shouldRetry.bind(this), requestControl);
        checkRequestControl(requestControl);
        if (!response.ok) {
          const responseError = new Error("provider_http_error");
          responseError.status = response.status;
          responseError.headers = response.headers;
          safeProviderConsole.warn(safeError(responseError, "openai-compatible", "models"));
          return [];
        }
        const { data } = await response.json();
        if (!Array.isArray(data)) {
          const responseError = Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
          safeProviderConsole.warn(safeError(responseError, "openai-compatible", "models"));
          return [];
        }
        return data.map((modelData) => ({
          id: modelData.id,
          name: modelData.id
        }));
      } catch (fallbackError) {
        if (isRequestControlStop(fallbackError, requestControl)) throw fallbackError;
        safeProviderConsole.warn(safeError(fallbackError, "openai-compatible", "models"));
        return [];
      }
    }
  }
  buildDiagnosticRequest(request) {
    return {
      model: request.model,
      messages: request.messages,
      stream: request.stream,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      top_p: request.top_p,
      presence_penalty: request.presence_penalty,
      frequency_penalty: request.frequency_penalty,
      ...request.response_format ? { response_format: request.response_format } : {},
      ...request.stream ? { stream_options: { include_usage: true } } : {}
    };
  }
  chatCompletion(request, config, requestControl = null) {
    requestControl = requestControlWithSignal(requestControl, request);
    const headers = {
      "Content-Type": "application/json",
      "X-Title": `Voices of the Court V${VOTC_CORE_VERSION}`,
      "User-Agent": `VOTC/${VOTC_APP_VERSION}`,
      // Custom User-Agent to avoid Cloudflare blocking
      ...config.apiKey && { "Authorization": `Bearer ${config.apiKey}` }
    };
    const openAIClient = new OpenAI({
      apiKey: this.getAPIKey(config),
      baseURL: this.getBaseUrl(config),
      defaultHeaders: headers,
      maxRetries: 0
    });
    const requestParams = this.buildDiagnosticRequest(request, config);
    if (requestParams.stream) {
      return this._streamChatCompletion(requestParams, openAIClient, requestControl?.signal || request.signal, requestControl);
    } else {
      return this._nonStreamChatCompletion(requestParams, openAIClient, requestControl);
    }
  }
  async _nonStreamChatCompletion(request, openAIClient, requestControl = null) {
    try {
      const data = await this.retryWithBackoff(
        () => {
          requestControl?.beforeSend?.();
          return openAIClient.chat.completions.create(request, requestControl?.signal ? { signal: requestControl.signal } : void 0);
        },
        3,
        1e3,
        this.shouldRetry.bind(this),
        requestControl
      );
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error(`OpenAI-Compatible SDK: No choices returned for model ${request.model}`);
      }
      return {
        id: data.id,
        content: choice.message?.content ?? null,
        tool_calls: choice.message?.tool_calls,
        finish_reason: choice.finish_reason ?? null,
        usage: data.usage ? {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens,
          prompt_cache_hit_tokens: data.usage.prompt_cache_hit_tokens,
          prompt_cache_miss_tokens: data.usage.prompt_cache_miss_tokens,
          prompt_tokens_details: data.usage.prompt_tokens_details,
          completion_tokens_details: data.usage.completion_tokens_details,
          reasoning_tokens: data.usage.reasoning_tokens,
          visible_completion_tokens: data.usage.visible_completion_tokens
        } : void 0
      };
    } catch (error) {
      const providerError = safeError(error, "openai-compatible", request.model);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
  }
  async *_streamChatCompletion(request, openAIClient, signal, requestControl = null) {
    let responseStarted = false;
    try {
      const stream = await this.retryWithBackoff(
        () => {
          requestControl?.beforeSend?.();
          return openAIClient.chat.completions.create(request, signal ? { signal } : void 0);
        },
        7,
        1e3,
        this.shouldRetry.bind(this),
        requestControl
      );
      const contentParts = [];
      const toolCallsMap = {};
      let finalUsage = void 0;
      let finalFinishReason = null;
      let firstChunkId = "";
      for await (const chunk of stream) {
        responseStarted = true;
        const choice = chunk.choices[0];
        if (!firstChunkId && chunk.id) {
          firstChunkId = chunk.id;
        }
        if (!choice) {
          if (chunk.usage) {
            finalUsage = chunk.usage;
            yield { id: chunk.id, usage: chunk.usage, finish_reason: null };
          }
          continue;
        }
        const delta = choice.delta;
        const finish_reason = choice.finish_reason;
        if (chunk.usage) {
          finalUsage = chunk.usage;
        }
        const streamChunk = {
          id: chunk.id,
          delta: delta ? {
            content: delta.content || void 0,
            reasoning: delta.reasoning_content || delta.reasoning ? true : void 0,
            role: delta.role,
            tool_calls: delta.tool_calls
          } : void 0,
          finish_reason,
          ...chunk.usage ? { usage: chunk.usage } : {}
        };
        yield streamChunk;
        if (delta?.content) {
          contentParts.push(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const key = Number.isInteger(tc.index) ? String(tc.index) : `unindexed-${Object.keys(toolCallsMap).length}`;
            if (!toolCallsMap[key]) {
              toolCallsMap[key] = {
                id: tc.id || void 0,
                type: "function",
                function: { name: "", arguments: "" }
              };
            }
            if (tc.id) toolCallsMap[key].id = tc.id;
            if (tc.function?.name) {
              toolCallsMap[key].function.name = tc.function.name;
            }
            if (tc.function?.arguments) {
              toolCallsMap[key].function.arguments += tc.function.arguments;
            }
          }
        }
        if (finish_reason) {
          finalFinishReason = finish_reason;
        }
      }
      const toolCalls = Object.values(toolCallsMap);
      return {
        id: firstChunkId,
        content: contentParts.join(""),
        tool_calls: toolCalls.length > 0 ? toolCalls : void 0,
        finish_reason: finalFinishReason,
        usage: finalUsage
      };
    } catch (error) {
      const providerError = safeError(error, "openai-compatible", request.model, responseStarted);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
  }
  async testConnection(config, requestControl = null) {
    try {
      checkRequestControl(requestControl);
      const testRequest = {
        model: config.defaultModel || "gpt-3.5-turbo",
        messages: [{ role: "user", content: "Test" }],
        max_tokens: 1,
        stream: false
      };
      const response = await this.chatCompletion(testRequest, config, requestControl);
      checkRequestControl(requestControl);
      if (isStrictlyComplete(response, "openai-compatible")) {
        return { success: true, message: `Successfully connected to OpenAI-Compatible API. Received response ID: ${response.id}` };
      }
      return { success: false, error: "Test connection to OpenAI-Compatible API failed to get a valid response." };
    } catch (error) {
      return testConnectionFailure(error, "openai-compatible", config?.defaultModel, requestControl);
    }
  }
}
class ZhipuProvider extends OpenAICompatibleProvider {
  constructor() {
    super();
    this.providerId = "zhipu";
    this.name = "智谱 GLM";
    this.DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
  }
  getBaseUrl(config) {
    return config.baseUrl || this.DEFAULT_BASE_URL;
  }
  getReasoningEffort(config) {
    return ["low", "high", "max"].includes(config.glmReasoningEffort) ? config.glmReasoningEffort : "low";
  }
  normalizeUsage(usage) {
    if (!usage || typeof usage !== "object") return void 0;
    const normalized = require("./usage-normalization").normalizeProviderUsage(usage);
    return { ...normalized, prompt_tokens_details: usage.prompt_tokens_details, completion_tokens_details: usage.completion_tokens_details, reasoning_tokens: normalized.reasoning_tokens ?? 0 };
  }
  buildUsageDebug(rawUsage, normalizedUsage) {
    if (!rawUsage || typeof rawUsage !== "object") return null;
    const raw = {};
    for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
      if (Object.prototype.hasOwnProperty.call(rawUsage, key)) raw[key] = Number(rawUsage[key]) || 0;
    }
    if (rawUsage.prompt_tokens_details && typeof rawUsage.prompt_tokens_details === "object" && Object.prototype.hasOwnProperty.call(rawUsage.prompt_tokens_details, "cached_tokens")) {
      raw.prompt_tokens_details = { cached_tokens: require("./usage-normalization").usageNumber(rawUsage.prompt_tokens_details.cached_tokens) };
    }
    if (rawUsage.completion_tokens_details && typeof rawUsage.completion_tokens_details === "object" && Object.prototype.hasOwnProperty.call(rawUsage.completion_tokens_details, "reasoning_tokens")) {
      raw.completion_tokens_details = { reasoning_tokens: Number(rawUsage.completion_tokens_details.reasoning_tokens) || 0 };
    }
    return {
      provider: "zhipu",
      raw_usage: raw,
      normalized_usage: normalizedUsage || null
    };
  }
  buildRequestParams(request, config) {
    return {
      model: request.model,
      messages: request.messages,
      stream: request.stream,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      top_p: request.top_p,
      presence_penalty: request.presence_penalty,
      frequency_penalty: request.frequency_penalty,
      reasoning_effort: this.getReasoningEffort(config),
      thinking: {
        type: "enabled",
        clear_thinking: config.glmClearThinking !== false
      },
      ...request.response_format ? { response_format: request.response_format } : {},
      ...request.stream ? { stream_options: { include_usage: true } } : {}
    };
  }
  createOpenAIClient(config) {
    return new OpenAI({
      apiKey: this.getAPIKey(config),
      baseURL: this.getBaseUrl(config),
      defaultHeaders: {
        "Content-Type": "application/json",
        "User-Agent": `VOTC/${VOTC_APP_VERSION}`,
        "Authorization": `Bearer ${this.getAPIKey(config)}`
      },
      maxRetries: 0
    });
  }
  buildDiagnosticRequest(request, config) {
    return this.buildRequestParams(request, config);
  }
  chatCompletion(request, config, requestControl = null) {
    requestControl = requestControlWithSignal(requestControl, request);
    const requestParams = this.buildRequestParams(request, config);
    const openAIClient = this.createOpenAIClient(config);
    return requestParams.stream ? this._streamZhipuChatCompletion(requestParams, openAIClient, requestControl?.signal || request.signal, requestControl) : this._nonStreamZhipuChatCompletion(requestParams, openAIClient, requestControl);
  }
  async _nonStreamZhipuChatCompletion(request, openAIClient, requestControl = null) {
    const response = await super._nonStreamChatCompletion(request, openAIClient, requestControl);
    const normalizedUsage = this.normalizeUsage(response.usage);
    return { ...response, usage: normalizedUsage, usage_debug: this.buildUsageDebug(response.usage, normalizedUsage) };
  }
  async *_streamZhipuChatCompletion(request, openAIClient, signal, requestControl = null) {
    const iterator = super._streamChatCompletion(request, openAIClient, signal, requestControl)[Symbol.asyncIterator]();
    try {
      while (true) {
      const step = await iterator.next();
      if (step.done) {
        const normalizedUsage = this.normalizeUsage(step.value?.usage);
        return { ...step.value, usage: normalizedUsage, usage_debug: this.buildUsageDebug(step.value?.usage, normalizedUsage) };
      }
      if (step.value?.usage !== void 0) {
        const normalizedUsage = this.normalizeUsage(step.value.usage);
        yield { ...step.value, usage: normalizedUsage, usage_debug: this.buildUsageDebug(step.value.usage, normalizedUsage) };
      } else {
        yield step.value;
      }
      }
    } finally {
      try { await awaitWithSignal(iterator.return?.(), signal); } catch {}
    }
  }
  async listModels(config, requestControl = null) {
    try {
      const response = await this.retryWithBackoff(() => {
        requestControl?.beforeSend?.();
        return this.createOpenAIClient(config).models.list(requestControl?.signal ? { signal: requestControl.signal } : void 0);
      }, 1, 1e3, this.shouldRetry.bind(this), requestControl);
      checkRequestControl(requestControl);
      const models = Array.isArray(response?.data) ? response.data.map((model) => ({ id: model.id, name: model.id })) : [];
      return models.length > 0 ? models : [{ id: "glm-5.3-flash", name: "GLM-5.3-Flash" }];
    } catch (error) {
      if (isRequestControlStop(error, requestControl)) throw error;
      safeProviderConsole.warn(safeError(error, "zhipu", "models"));
      return [{ id: "glm-5.3-flash", name: "GLM-5.3-Flash" }];
    }
  }
  async testConnection(config, requestControl = null) {
    try {
      checkRequestControl(requestControl);
      const response = await this.chatCompletion({
        model: config.defaultModel || "glm-5.3-flash",
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 128,
        stream: false
      }, config, requestControl);
      checkRequestControl(requestControl);
      return isStrictlyComplete(response, "zhipu") ? { success: true, message: `Successfully connected to 智谱 GLM. Received response ID: ${response.id}` } : { success: false, error: "Test connection to 智谱 GLM returned an incomplete response." };
    } catch (error) {
      return testConnectionFailure(error, "zhipu", config?.defaultModel, requestControl);
    }
  }
}
class OllamaProvider extends BaseProvider {
  constructor() {
    super();
    this.providerId = "ollama";
    this.name = "Ollama";
  }
  getConfig(config) {
    if (config.providerType !== "ollama" || !config.baseUrl) {
      throw new Error("Invalid configuration for OllamaProvider: Base URL is missing or type is incorrect.");
    }
    return config;
  }
  async listModels(config, requestControl = null) {
    const providerConfig = this.getConfig(config);
    const endpoint = `${providerConfig.baseUrl.replace(/\/$/, "")}/api/tags`;
    try {
      const response = await this.retryWithBackoff(() => {
        requestControl?.beforeSend?.();
        return fetch(endpoint, {
          ...requestControl?.signal ? { signal: requestControl.signal } : {},
          method: "GET",
          headers: { "Content-Type": "application/json" }
        });
      }, 1, 1e3, isRetryableProviderStatus, requestControl);
      checkRequestControl(requestControl);
      if (!response.ok) {
        const error = new Error("provider_http_error");
        error.status = response.status;
        error.headers = response.headers;
        throw error;
      }
      const data = await response.json();
      if (!data.models || !Array.isArray(data.models)) {
        throw Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
      }
      return data.models.map((modelData) => ({
        id: modelData.name,
        // Ollama uses 'name' as the model identifier (e.g., 'llama3:latest')
        name: modelData.name
        // Ollama doesn't directly provide isFree or contextLength in /api/tags in a standard way.
        // These might need to be fetched via /api/show or configured manually.
        // For now, we'll leave them undefined.
        // contextLength: modelData.details?.parameter_size ? parseInt(modelData.details.parameter_size) : undefined, // Example, might not be correct
      }));
    } catch (error) {
      const providerError = safeError(error, "ollama", "models");
      safeProviderConsole.error(providerError);
      throw providerError;
    }
  }
  // Implementation
  chatCompletion(request, config, requestControl = null) {
    requestControl = requestControlWithSignal(requestControl, request);
    const providerConfig = this.getConfig(config);
    const endpoint = `${providerConfig.baseUrl.replace(/\/$/, "")}/api/chat`;
    const ollamaMessages = request.messages.map((msg) => ({
      role: msg.role === "tool" ? "assistant" : msg.role,
      // Ollama might not have 'tool' role; map to assistant or handle appropriately
      content: msg.content
      // Ollama specific: images array for multimodal
      // tool_calls are not directly supported in the same way as OpenAI by Ollama's native API.
      // If tool use is needed, it would typically be handled by a wrapper or by prompting.
    }));
    const body = {
      model: request.model,
      messages: ollamaMessages,
      stream: request.stream ?? false,
      // Ollama expects stream to be explicitly false for non-streaming
      options: {
        // Ollama puts parameters under an 'options' object
        temperature: request.temperature,
        num_predict: request.max_tokens,
        // Ollama uses num_predict for max_tokens
        top_p: request.top_p,
        presence_penalty: request.presence_penalty,
        // Check Ollama docs for exact mapping
        frequency_penalty: request.frequency_penalty
        // Check Ollama docs for exact mapping
      }
    };
    for (const key in body.options) {
      if (body.options[key] === void 0) {
        delete body.options[key];
      }
    }
    if (request.stream) {
      return this._streamChatCompletion(request, endpoint, body, requestControl);
    } else {
      return this._nonStreamChatCompletion(request, endpoint, body, requestControl);
    }
  }
  async _nonStreamChatCompletion(request, endpoint, body, requestControl = null) {
    try {
      const response = await this.retryWithBackoff(async () => {
        requestControl?.beforeSend?.();
        const result = await fetch(endpoint, {
          ...requestControl?.signal ? { signal: requestControl.signal } : {},
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, stream: false })
          // Ensure stream is false
        });
        if (!result.ok) {
          const error = new Error("provider_http_error");
          error.status = result.status;
          error.headers = result.headers;
          throw error;
        }
        return result;
      }, 1, 1e3, isRetryableProviderStatus, requestControl);
      const data = await response.json();
      if (!data.message || typeof data.message.content !== "string") {
        throw Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
      }
      return {
        id: data.created_at,
        // Ollama doesn't have a specific response ID like OpenAI, use created_at or generate one
        content: data.message.content,
        // tool_calls: undefined, // Ollama native API doesn't support OpenAI-style tool calls directly
        finish_reason: data.done ? data.done_reason || "stop" : null,
        // done_reason might exist
        usage: nativeUsage(data.prompt_eval_count, data.eval_count)
      };
    } catch (error) {
      const providerError = safeError(error, "ollama", request.model);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
  }
  async *_streamChatCompletion(request, endpoint, body, requestControl = null) {
    const signal = requestControl?.signal || request.signal;
    let response;
    try {
      response = await this.retryWithBackoff(async () => {
        requestControl?.beforeSend?.();
        const result = await fetch(endpoint, {
          ...signal ? { signal } : {},
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, stream: true })
        });
        if (!result.ok || !result.body) {
          const error = new Error(result.body ? "provider_http_error" : "provider_invalid_response");
          error.status = result.status;
          error.headers = result.headers;
          if (!result.body) error.code = "provider_invalid_response";
          throw error;
        }
        return result;
      }, 1, 1e3, isRetryableProviderStatus, requestControl);
    } catch (error) {
      const providerError = safeError(error, "ollama", request.model);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const aggregatedResponse = {
      id: "",
      content: "",
      finish_reason: void 0,
      usage: void 0
    };
    let firstChunk = true;
    let terminalFrameSeen = false;
    let readerCompleted = false;
    const parseLine = (line) => {
      if (!line.trim()) return null;
      let chunkData;
      try {
        chunkData = JSON.parse(line);
      } catch {
        throw Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
      }
      if (!chunkData || typeof chunkData !== "object" || Array.isArray(chunkData)) {
        throw Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
      }
      if (firstChunk) {
        aggregatedResponse.id = chunkData.created_at || Date.now().toString();
        firstChunk = false;
      }
      const usage = nativeUsage(chunkData.prompt_eval_count, chunkData.eval_count);
      const streamChunk = {
        delta: chunkData.message?.content ? { content: chunkData.message.content } : void 0,
        finish_reason: chunkData.done ? chunkData.done_reason || "stop" : null,
        ...usage ? { usage } : {}
      };
      if (chunkData.message?.content) aggregatedResponse.content += chunkData.message.content;
      if (usage !== void 0) aggregatedResponse.usage = usage;
      if (chunkData.done) {
        terminalFrameSeen = true;
        aggregatedResponse.finish_reason = chunkData.done_reason || "stop";
      }
      return streamChunk;
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          readerCompleted = true;
          buffer += decoder.decode();
          if (buffer.length > 0) {
            const streamChunk = parseLine(buffer.replace(/\r$/, ""));
            buffer = "";
            if (streamChunk) yield streamChunk;
            if (terminalFrameSeen) return aggregatedResponse;
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let eolIndex;
        while ((eolIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.substring(0, eolIndex).replace(/\r$/, "");
          buffer = buffer.substring(eolIndex + 1);
          const streamChunk = parseLine(line);
          if (streamChunk) yield streamChunk;
          if (terminalFrameSeen) return aggregatedResponse;
        }
      }
    } catch (error) {
      const providerError = safeError(error, "ollama", request.model, true);
      safeProviderConsole.error(providerError);
      throw providerError;
    } finally {
      if (!readerCompleted) {
        try { await reader.cancel(); } catch {}
      }
      reader.releaseLock();
    }
    return aggregatedResponse;
  }
  async testConnection(config, requestControl = null) {
    const providerConfig = this.getConfig(config);
    try {
      checkRequestControl(requestControl);
      await this.listModels(providerConfig, requestControl);
      checkRequestControl(requestControl);
      return { success: true, message: "Ollama model directory is reachable; generation was not tested." };
    } catch (error) {
      return testConnectionFailure(error, "ollama", config?.defaultModel, requestControl);
    }
  }
}
class Player2Provider extends BaseProvider {
  constructor() {
    super(...arguments);
    this.providerId = "player2";
    this.name = "Player2";
    this.player2BaseUrl = "http://127.0.0.1:4315/v1";
    this.player2GameKey = "019b93eb-33ae-7e7e-ae21-0a1903c63ebb";
    this.player2HealthUrl = this.player2BaseUrl + "/health";
  }
  /**
   * Override validateConfig to skip API key requirement for Player2
   * Player2 runs locally and doesn't need a real API key
   */
  validateConfig(config) {
    if (!config.defaultModel) {
      throw new Error(`Default model is required for ${this.name}`);
    }
  }
  /**
   * Override listModels to return empty array since Player2 doesn't support model listing
   */
  async listModels(_config, requestControl = null) {
    checkRequestControl(requestControl);
    return [];
  }
  /**
   * Determine if an error should trigger a retry
   * @param error The error to check
   * @returns true if the error is retryable
   */
  shouldRetryPlayer2(error) {
    return isRetryableProviderStatus(error);
  }
  chatCompletion(request, _config, requestControl = null) {
    requestControl = requestControlWithSignal(requestControl, request);
    const openAIClient = new OpenAI({
      maxRetries: 0,
      apiKey: "sk-dummy-key",
      baseURL: this.player2BaseUrl,
      defaultHeaders: {
        "player2-game-key": this.player2GameKey
      }
    });
    const requestParams = {
      model: request.model,
      messages: request.messages,
      stream: request.stream,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      top_p: request.top_p,
      presence_penalty: request.presence_penalty,
      frequency_penalty: request.frequency_penalty,
      ...request.response_format ? { response_format: request.response_format } : {}
    };
    if (requestParams.stream) {
      return this._streamChatCompletion(requestParams, openAIClient, requestControl?.signal || request.signal, requestControl);
    } else {
      return this._nonStreamChatCompletion(requestParams, openAIClient, requestControl);
    }
  }
  async _nonStreamChatCompletion(request, openAIClient, requestControl = null) {
    try {
      const data = await this.retryWithBackoff(
        () => {
          requestControl?.beforeSend?.();
          return openAIClient.chat.completions.create(request, requestControl?.signal ? { signal: requestControl.signal } : void 0);
        },
        3,
        1e3,
        this.shouldRetryPlayer2.bind(this),
        requestControl
      );
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error(`Player2 SDK: No choices returned for model ${request.model}`);
      }
      return {
        id: data.id,
        content: choice.message?.content ?? null,
        tool_calls: choice.message?.tool_calls,
        finish_reason: choice.finish_reason ?? null,
        usage: data.usage ? {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens,
          prompt_cache_hit_tokens: data.usage.prompt_cache_hit_tokens,
          prompt_cache_miss_tokens: data.usage.prompt_cache_miss_tokens
        } : void 0
      };
    } catch (error) {
      const providerError = safeError(error, "player2", request.model);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
  }
  async *_streamChatCompletion(request, openAIClient, signal, requestControl = null) {
    let responseStarted = false;
    try {
      const stream = await this.retryWithBackoff(
        () => {
          requestControl?.beforeSend?.();
          return openAIClient.chat.completions.create(request, signal ? { signal } : void 0);
        },
        7,
        1e3,
        this.shouldRetryPlayer2.bind(this),
        requestControl
      );
      const contentParts = [];
      const toolCallsMap = {};
      let finalUsage = void 0;
      let finalFinishReason = null;
      let firstChunkId = "";
      for await (const chunk of stream) {
        responseStarted = true;
        const choice = chunk.choices[0];
        if (choice?.finish_reason === "error") {
          const choiceWithError = choice;
          if (choiceWithError.error) {
            throw Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
          } else {
            throw new Error(
              `Player2 Mid-Stream Error: Stream terminated with error status but no error details provided`
            );
          }
        }
        if (!firstChunkId && chunk.id) {
          firstChunkId = chunk.id;
        }
        if (!choice) {
          if (chunk.usage) {
            finalUsage = chunk.usage;
            yield { id: chunk.id, usage: chunk.usage, finish_reason: null };
          }
          continue;
        }
        const delta = choice.delta;
        const finish_reason = choice.finish_reason;
        if (chunk.usage) {
          finalUsage = chunk.usage;
        }
        const streamChunk = {
          id: chunk.id,
          delta: delta ? {
            content: delta.content || void 0,
            reasoning: delta.reasoning_content || delta.reasoning ? true : void 0,
            role: delta.role,
            tool_calls: delta.tool_calls
          } : void 0,
          finish_reason,
          ...chunk.usage ? { usage: chunk.usage } : {}
        };
        yield streamChunk;
        if (delta?.content) {
          contentParts.push(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const key = Number.isInteger(tc.index) ? String(tc.index) : `unindexed-${Object.keys(toolCallsMap).length}`;
            if (!toolCallsMap[key]) {
              toolCallsMap[key] = {
                id: tc.id || void 0,
                type: "function",
                function: { name: "", arguments: "" }
              };
            }
            if (tc.id) toolCallsMap[key].id = tc.id;
            if (tc.function?.name) {
              toolCallsMap[key].function.name = tc.function.name;
            }
            if (tc.function?.arguments) {
              toolCallsMap[key].function.arguments += tc.function.arguments;
            }
          }
        }
        if (finish_reason) {
          finalFinishReason = finish_reason;
        }
      }
      const toolCalls = Object.values(toolCallsMap);
      return {
        id: firstChunkId,
        content: contentParts.join(""),
        tool_calls: toolCalls.length > 0 ? toolCalls : void 0,
        finish_reason: finalFinishReason,
        usage: finalUsage
      };
    } catch (error) {
      const providerError = safeError(error, "player2", request.model, responseStarted);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
  }
  async testConnection(config, requestControl = null) {
    try {
      checkRequestControl(requestControl);
      const testRequest = {
        model: "gpt-oss-120b",
        // Use a known cheap/fast model or user's default
        messages: [{ role: "user", content: "Test" }],
        max_tokens: 1,
        stream: false
      };
      const response = await this.chatCompletion(testRequest, config, requestControl);
      checkRequestControl(requestControl);
      if (isStrictlyComplete(response, "player2")) {
        return { success: true, message: `Successfully connected to Player2. Received response ID: ${response.id}` };
      }
      return { success: false, error: "Test connection to Player2 failed to get a valid response." };
    } catch (error) {
      return testConnectionFailure(error, "player2", "gpt-oss-120b", requestControl);
    }
  }
  async checkHealth(requestControl = null) {
    try {
      checkRequestControl(requestControl);
      const baseHeaders = {
        Accept: "application/json",
        "player2-game-key": this.player2GameKey
      };
      requestControl?.beforeSend?.();
      const response = await fetch(this.player2HealthUrl, {
        ...requestControl?.signal ? { signal: requestControl.signal } : {},
        method: "GET",
        headers: baseHeaders
      });
      checkRequestControl(requestControl);
      return await this.handleHealthErrorResponse(response);
    } catch (error) {
      if (isRequestControlStop(error, requestControl)) throw error;
      const providerError = safeError(error, "player2", "health");
      console.error(providerError);
      return { success: false, error: providerError.message };
    }
  }
  async handleHealthErrorResponse(response) {
    if (response.status === 200) {
      return { success: true, message: "Player2 health endpoint is reachable; generation was not tested." };
    }
    if (response.status === 401) {
      return { success: false, code: 401, error: "Authentication required in Player2 App." };
    }
    if (response.status === 402) {
      return { success: false, code: 402, error: "Insufficient credits." };
    }
    if (response.status === 429) {
      return { success: false, code: 429, error: "Too many requests. Please try again." };
    }
    if (response.status >= 500) {
      return { success: false, code: response.status, error: "Player2 server error." };
    }
    if (response.status === 404) {
      return {
        success: false,
        code: 404,
        error: "Health endpoint not found. Check Player2 app version or base URL."
      };
    }
    return { success: false, code: response.status, error: "Player2 health check failed." };
  }
}
class DeepseekProvider extends BaseProvider {
  constructor() {
    super(...arguments);
    this.providerId = "deepseek";
    this.name = "Deepseek";
    this.DEFAULT_BASE_URL = "https://api.deepseek.com";
  }
  /**
   * Determine if an error should trigger a retry
   */
  shouldRetry(error) {
    return isRetryableProviderStatus(error);
  }
  /**
   * Get the base URL for Deepseek API
   */
  getDeepseekBaseUrl(config) {
    return config.baseUrl || this.DEFAULT_BASE_URL;
  }
  async listModels(_, requestControl = null) {
    checkRequestControl(requestControl);
    return [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
      { id: "deepseek-v4.1-flash-expires-on-0910", name: "deepseek-v4.1-flash-expires-on-0910" }
    ];
  }
  buildDiagnosticRequest(request, config) {
    const transformedRequest = this.transformRequestForDeepseek(request, config);
    return {
      model: transformedRequest.model,
      messages: transformedRequest.messages,
      stream: transformedRequest.stream,
      temperature: transformedRequest.temperature,
      max_tokens: transformedRequest.max_tokens,
      top_p: transformedRequest.top_p,
      presence_penalty: transformedRequest.presence_penalty,
      frequency_penalty: transformedRequest.frequency_penalty,
      ...transformedRequest.thinking ? { thinking: transformedRequest.thinking } : {},
      ...transformedRequest.response_format ? { response_format: transformedRequest.response_format } : {},
      ...transformedRequest.stream ? { stream_options: { include_usage: true } } : {}
    };
  }
  chatCompletion(request, config, requestControl = null) {
    requestControl = requestControlWithSignal(requestControl, request);
    const baseUrl = this.getDeepseekBaseUrl(config);
    const openAIClient = new OpenAI({
      apiKey: this.getAPIKey(config),
      baseURL: baseUrl,
      maxRetries: 0
    });
    const requestParams = this.buildDiagnosticRequest(request, config);
    if (requestParams.stream) {
      return this._streamChatCompletion(requestParams, openAIClient, requestControl?.signal || request.signal, requestControl);
    } else {
      return this._nonStreamChatCompletion(requestParams, openAIClient, requestControl);
    }
  }
  /**
   * Transform the request for Deepseek compatibility
   * - Converts json_schema response_format to json_object with schema in prompt
   */
  transformRequestForDeepseek(request, config = {}) {
    const transformed = { ...request };
    if (request.response_format?.type === "json_schema" && request.response_format.json_schema) {
      const jsonSchemaObj = request.response_format.json_schema;
      const schemaName = jsonSchemaObj.name || "response";
      const schemaObj = jsonSchemaObj.schema;
      transformed.response_format = { type: "json_object" };
      if (schemaName === "votc_actions") {
        transformed.thinking = { type: "disabled" };
      }
      const messages = [...request.messages];
      const actionSchemaDeliveryMode = schemaName === "votc_actions" ? config.actionSchemaDeliveryMode || "optimized_local_validation" : "official_full_injected";
      if (schemaName !== "votc_actions" || actionSchemaDeliveryMode === "official_full_injected") {
        const schemaDescription = this.buildSchemaDescription(schemaName, schemaObj);
        let schemaInjected = false;
        // Baseline mode keeps the prior provider fallback exactly available for A/B.
        if (schemaName === "votc_actions") {
          const actionListIndex = messages.findIndex((message) => message.role === "system" && typeof message.content === "string" && message.content.startsWith("Available Actions:"));
          if (actionListIndex >= 0) {
            messages[actionListIndex] = {
              ...messages[actionListIndex],
              content: messages[actionListIndex].content + "\n\n" + schemaDescription
            };
            schemaInjected = true;
          }
        }
        for (let i = messages.length - 1; i >= 0 && !schemaInjected; i--) {
          if (messages[i].role === "system") {
            messages[i] = {
              ...messages[i],
              content: messages[i].content + "\n\n" + schemaDescription
            };
            schemaInjected = true;
            break;
          }
        }
        if (!schemaInjected) {
          messages.unshift({
            role: "system",
            content: schemaDescription
          });
        }
      }
      transformed.messages = messages.map(({ blockId, ...message }) => ({ ...message }));
    }
    return transformed;
  }
  /**
   * Build a human-readable schema description for the prompt
   */
  buildSchemaDescription(schemaName, schema2) {
    let description = `You MUST respond with valid JSON matching this schema:
`;
    description += `Schema name: ${schemaName}
`;
    if (schema2.properties) {
      description += this.describeObjectSchema(schema2, 0);
    }
    description += `
IMPORTANT: Your response must be ONLY valid JSON. No prose, no code fences, no explanations.`;
    return description;
  }
  /**
   * Recursively describe an object schema
   */
  describeObjectSchema(schema2, indent) {
    const spaces = "  ".repeat(indent);
    let result = "";
    if (schema2.type === "object" && schema2.properties) {
      const required = schema2.required || [];
      for (const [key, value] of Object.entries(schema2.properties)) {
        const isRequired = required.includes(key);
        const reqMarker = isRequired ? " (required)" : " (optional)";
        if (value.type === "array") {
          const items = value.items;
          if (items.anyOf) {
            result += `${spaces}- ${key}: array of objects${reqMarker}
`;
            result += this.describeAnyOfSchema(items, indent + 1);
          } else if (items.type === "object") {
            result += `${spaces}- ${key}: array of objects${reqMarker}
`;
            result += this.describeObjectSchema(items, indent + 1);
          } else {
            result += `${spaces}- ${key}: array of ${items.type}${reqMarker}
`;
          }
        } else if (value.type === "object") {
          result += `${spaces}- ${key}: object${reqMarker}
`;
          result += this.describeObjectSchema(value, indent + 1);
        } else if (value.anyOf) {
          result += `${spaces}- ${key}: ${value.anyOf.map((t) => t.type).join(" | ")}${reqMarker}
`;
        } else if (value.const !== void 0) {
          result += `${spaces}- ${key}: "${value.const}" (constant)${reqMarker}
`;
        } else if (value.enum) {
          result += `${spaces}- ${key}: enum{${value.enum.join(", ")}}${reqMarker}
`;
        } else {
          result += `${spaces}- ${key}: ${value.type}${reqMarker}
`;
        }
      }
    }
    return result;
  }
  /**
   * Describe an anyOf schema (used for action variants)
   */
  describeAnyOfSchema(schema2, indent) {
    const spaces = "  ".repeat(indent);
    let result = "";
    if (schema2.anyOf) {
      schema2.anyOf.forEach((variant, index) => {
        if (variant.properties?.actionId?.const) {
          const actionId = variant.properties.actionId.const;
          result += `${spaces}Variant ${index + 1} (actionId: "${actionId}"):
`;
          result += this.describeObjectSchema(variant, indent + 1);
        }
      });
    }
    return result;
  }
  async _nonStreamChatCompletion(request, openAIClient, requestControl = null) {
    try {
      const data = await this.retryWithBackoff(
        () => {
          requestControl?.beforeSend?.();
          return openAIClient.chat.completions.create(request, requestControl?.signal ? { signal: requestControl.signal } : void 0);
        },
        3,
        1e3,
        this.shouldRetry.bind(this),
        requestControl
      );
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error(`Deepseek: No choices returned for model ${request.model}`);
      }
      return {
        id: data.id,
        content: choice.message?.content ?? null,
        tool_calls: choice.message?.tool_calls,
        finish_reason: choice.finish_reason ?? null,
        usage: data.usage ? {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens,
          prompt_cache_hit_tokens: data.usage.prompt_cache_hit_tokens,
          prompt_cache_miss_tokens: data.usage.prompt_cache_miss_tokens
        } : void 0
      };
    } catch (error) {
      const providerError = safeError(error, "deepseek", request.model);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
  }
  async *_streamChatCompletion(request, openAIClient, signal, requestControl = null) {
    let responseStarted = false;
    try {
      const stream = await this.retryWithBackoff(
        () => {
          requestControl?.beforeSend?.();
          return openAIClient.chat.completions.create(request, signal ? { signal } : void 0);
        },
        7,
        1e3,
        this.shouldRetry.bind(this),
        requestControl
      );
      const contentParts = [];
      const toolCallsMap = {};
      let finalUsage = void 0;
      let finalFinishReason = null;
      let firstChunkId = "";
      for await (const chunk of stream) {
        responseStarted = true;
        const choice = chunk.choices[0];
        if (!firstChunkId && chunk.id) {
          firstChunkId = chunk.id;
        }
        if (!choice) {
          if (chunk.usage) {
            finalUsage = chunk.usage;
            yield { id: chunk.id, usage: chunk.usage, finish_reason: null };
          }
          continue;
        }
        const delta = choice.delta;
        const finish_reason = choice.finish_reason;
        if (chunk.usage) {
          finalUsage = chunk.usage;
        }
        const streamChunk = {
          id: chunk.id,
          delta: delta ? {
            content: delta.content || void 0,
            reasoning: delta.reasoning_content || delta.reasoning ? true : void 0,
            role: delta.role,
            tool_calls: delta.tool_calls
          } : void 0,
          finish_reason,
          ...chunk.usage ? { usage: chunk.usage } : {}
        };
        yield streamChunk;
        if (delta?.content) {
          contentParts.push(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const key = Number.isInteger(tc.index) ? String(tc.index) : `unindexed-${Object.keys(toolCallsMap).length}`;
            if (!toolCallsMap[key]) {
              toolCallsMap[key] = {
                id: tc.id || void 0,
                type: "function",
                function: { name: "", arguments: "" }
              };
            }
            if (tc.id) toolCallsMap[key].id = tc.id;
            if (tc.function?.name) {
              toolCallsMap[key].function.name = tc.function.name;
            }
            if (tc.function?.arguments) {
              toolCallsMap[key].function.arguments += tc.function.arguments;
            }
          }
        }
        if (finish_reason) {
          finalFinishReason = finish_reason;
        }
      }
      const toolCalls = Object.values(toolCallsMap);
      return {
        id: firstChunkId,
        content: contentParts.join(""),
        tool_calls: toolCalls.length > 0 ? toolCalls : void 0,
        finish_reason: finalFinishReason,
        usage: finalUsage
      };
    } catch (error) {
      const providerError = safeError(error, "deepseek", request.model, responseStarted);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
  }
  async testConnection(config, requestControl = null) {
    try {
      checkRequestControl(requestControl);
      const testRequest = {
        model: config.defaultModel || "deepseek-v4-flash",
        messages: [{ role: "user", content: "Test" }],
        max_tokens: 1,
        stream: false
      };
      const response = await this.chatCompletion(testRequest, config, requestControl);
      checkRequestControl(requestControl);
      if (isStrictlyComplete(response, "deepseek")) {
        return { success: true, message: `Successfully connected to Deepseek. Received response ID: ${response.id}` };
      }
      return { success: false, error: "Test connection to Deepseek failed to get a valid response." };
    } catch (error) {
      return testConnectionFailure(error, "deepseek", config?.defaultModel, requestControl);
    }
  }
}
class GeminiProvider extends BaseProvider {
  constructor() {
    super(...arguments);
    this.providerId = "gemini";
    this.name = "Google Gemini";
    this.DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
  }
  /**
   * Determine if an error should trigger a retry
   */
  shouldRetry(error) {
    return isRetryableProviderStatus(error);
  }
  /**
   * Get the base URL for Gemini API
   */
  getGeminiBaseUrl(config) {
    return config.baseUrl || this.DEFAULT_BASE_URL;
  }
  /**
   * Convert OpenAI-style messages to Gemini contents format
   */
  convertMessagesToGeminiFormat(messages) {
    const contents = [];
    let systemInstruction;
    for (const message of messages) {
      if (message.role === "system") {
        if (systemInstruction) {
          systemInstruction.parts.push({ text: "\n\n" + message.content });
        } else {
          systemInstruction = {
            role: "user",
            parts: [{ text: message.content }]
          };
        }
        continue;
      }
      const geminiRole = message.role === "assistant" ? "model" : "user";
      const content = {
        role: geminiRole,
        parts: [{ text: message.content }]
      };
      contents.push(content);
    }
    return { contents, systemInstruction };
  }
  /**
   * Build generation config from request parameters
   */
  buildGenerationConfig(request) {
    const config = {};
    if (request.temperature !== void 0) {
      config.temperature = request.temperature;
    }
    if (request.max_tokens !== void 0) {
      config.maxOutputTokens = request.max_tokens;
    }
    if (request.top_p !== void 0) {
      config.topP = request.top_p;
    }
    if (request.top_k !== void 0) {
      config.topK = request.top_k;
    }
    if (request.response_format) {
      if (request.response_format.type === "json_schema" && request.response_format.json_schema) {
        config.responseMimeType = "application/json";
        config.responseJsonSchema = this.convertJsonSchemaToGeminiFormat(
          request.response_format.json_schema.schema || request.response_format.json_schema
        );
      } else if (request.response_format.type === "json_object") {
        config.responseMimeType = "application/json";
      }
    }
    return config;
  }
  /**
   * Convert JSON Schema to Gemini-compatible format
   * Gemini supports a subset of JSON Schema
   */
  convertJsonSchemaToGeminiFormat(schema2) {
    if (!schema2 || typeof schema2 !== "object") {
      return schema2;
    }
    const result = {};
    const supportedProps = [
      "type",
      "properties",
      "required",
      "items",
      "enum",
      "description",
      "minimum",
      "maximum",
      "minItems",
      "maxItems",
      "additionalProperties",
      "anyOf",
      "oneOf",
      "$ref",
      "$defs",
      "prefixItems",
      "format",
      "title"
    ];
    for (const prop of supportedProps) {
      if (schema2[prop] !== void 0) {
        if (prop === "properties") {
          result[prop] = {};
          for (const [key, value] of Object.entries(schema2[prop])) {
            result[prop][key] = this.convertJsonSchemaToGeminiFormat(value);
          }
        } else if (prop === "items" || prop === "additionalProperties") {
          result[prop] = this.convertJsonSchemaToGeminiFormat(schema2[prop]);
        } else if (prop === "anyOf" || prop === "oneOf" || prop === "prefixItems") {
          result[prop] = schema2[prop].map((s) => this.convertJsonSchemaToGeminiFormat(s));
        } else {
          result[prop] = schema2[prop];
        }
      }
    }
    return result;
  }
  /**
   * Build the request body for Gemini API
   */
  buildRequestBody(request) {
    const { contents, systemInstruction } = this.convertMessagesToGeminiFormat(request.messages);
    const generationConfig = this.buildGenerationConfig(request);
    const body = {
      contents,
      generationConfig
    };
    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }
    return body;
  }
  async listModels(config, requestControl = null) {
    const baseUrl = this.getGeminiBaseUrl(config);
    const apiKey = this.getAPIKey(config);
    try {
      const response = await this.retryWithBackoff(() => {
        requestControl?.beforeSend?.();
        return fetch(`${baseUrl}/models?key=${apiKey}`, {
          ...requestControl?.signal ? { signal: requestControl.signal } : {},
          method: "GET",
          headers: { "Content-Type": "application/json" }
        });
      }, 1, 1e3, isRetryableProviderStatus, requestControl);
      checkRequestControl(requestControl);
      if (!response.ok) {
        const error = new Error("provider_http_error");
        error.status = response.status;
        error.headers = response.headers;
        safeProviderConsole.warn(safeError(error, "gemini", "models"));
        return this.getDefaultModels();
      }
      const data = await response.json();
      if (!data.models || !Array.isArray(data.models)) {
        const error = Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
        safeProviderConsole.warn(safeError(error, "gemini", "models"));
        return this.getDefaultModels();
      }
      return data.models.filter(
        (model) => model.supportedGenerationMethods?.includes("generateContent") && model.name?.includes("gemini")
      ).map((model) => ({
        id: model.name.replace("models/", ""),
        name: model.displayName || model.name.replace("models/", ""),
        contextLength: model.inputTokenLimit
      }));
    } catch (error) {
      if (isRequestControlStop(error, requestControl)) throw error;
      safeProviderConsole.warn(safeError(error, "gemini", "models"));
      return this.getDefaultModels();
    }
  }
  /**
   * Default models if API call fails
   */
  getDefaultModels() {
    return [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextLength: 2e6 },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextLength: 1e6 },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", contextLength: 1e6 },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextLength: 1e6 }
    ];
  }
  chatCompletion(request, config, requestControl = null) {
    requestControl = requestControlWithSignal(requestControl, request);
    const baseUrl = this.getGeminiBaseUrl(config);
    const apiKey = this.getAPIKey(config);
    const modelName = request.model.startsWith("models/") ? request.model : `models/${request.model}`;
    if (request.stream) {
      return this._streamChatCompletion(baseUrl, apiKey, modelName, request, requestControl);
    } else {
      return this._nonStreamChatCompletion(baseUrl, apiKey, modelName, request, requestControl);
    }
  }
  async _nonStreamChatCompletion(baseUrl, apiKey, modelName, request, requestControl = null) {
    const body = this.buildRequestBody(request);
    try {
      const response = await this.retryWithBackoff(
        async () => {
          requestControl?.beforeSend?.();
          const res = await fetch(`${baseUrl}/${modelName}:generateContent?key=${apiKey}`, {
            ...requestControl?.signal ? { signal: requestControl.signal } : {},
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
          });
          if (!res.ok) {
            const error = new Error("provider_http_error");
            error.status = res.status;
            error.headers = res.headers;
            throw error;
          }
          return res.json();
        },
        3,
        1e3,
        this.shouldRetry.bind(this),
        requestControl
      );
      return this.parseGeminiResponse(response);
    } catch (error) {
      const providerError = safeError(error, "gemini", request.model);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
  }
  async *_streamChatCompletion(baseUrl, apiKey, modelName, request, requestControl = null) {
    const body = this.buildRequestBody(request);
    const url = `${baseUrl}/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`;
    let response;
    try {
      response = await this.retryWithBackoff(
        async () => {
          requestControl?.beforeSend?.();
          const res = await fetch(url, {
            ...(requestControl?.signal || request.signal) ? { signal: requestControl?.signal || request.signal } : {},
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
          });
          if (!res.ok) {
            const error = new Error("provider_http_error");
            error.status = res.status;
            error.headers = res.headers;
            throw error;
          }
          if (!res.body) throw Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
          return res;
        },
        3,
        1e3,
        this.shouldRetry.bind(this),
        requestControl
      );
    } catch (error) {
      const providerError = safeError(error, "gemini", request.model);
      safeProviderConsole.error(providerError);
      throw providerError;
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw safeError(Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" }), "gemini", request.model);
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedContent = "";
    let firstChunkId = "";
    let finalFinishReason = null;
    let finalUsage = void 0;
    let readerCompleted = false;
    const eventData = [];
    const parseEvent = () => {
      if (!eventData.length) return null;
      const data = eventData.join("\n");
      eventData.length = 0;
      if (data.trim() === "[DONE]") return null;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
      }
      return this.parseGeminiStreamChunk(parsed);
    };
    const recordChunk = (chunk) => {
      if (!firstChunkId && chunk.id) firstChunkId = chunk.id;
      if (chunk.finish_reason !== null && chunk.finish_reason !== void 0) finalFinishReason = chunk.finish_reason;
      if (chunk.usage !== void 0) finalUsage = chunk.usage;
      if (chunk.delta?.content) accumulatedContent += chunk.delta.content;
      return chunk;
    };
    const processLine = (rawLine) => {
      const line = rawLine.replace(/\r$/, "");
      if (!line) return parseEvent();
      if (line.startsWith(":")) return null;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      if (field !== "data") {
        if (["event", "id", "retry"].includes(field)) return null;
        throw Object.assign(new Error("provider_invalid_response"), { code: "provider_invalid_response" });
      }
      const value = colon < 0 ? "" : line.slice(colon + 1);
      eventData.push(value.startsWith(" ") ? value.slice(1) : value);
      return null;
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          readerCompleted = true;
          buffer += decoder.decode();
          if (buffer.length > 0) {
            const chunk = processLine(buffer);
            buffer = "";
            if (chunk) yield recordChunk(chunk);
          }
          const chunk = parseEvent();
          if (chunk) yield recordChunk(chunk);
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const chunk = processLine(line);
          if (chunk) yield recordChunk(chunk);
        }
      }
      return {
        id: firstChunkId,
        content: accumulatedContent,
        finish_reason: finalFinishReason,
        usage: finalUsage
      };
    } catch (error) {
      const providerError = safeError(error, "gemini", request.model, true);
      safeProviderConsole.error(providerError);
      throw providerError;
    } finally {
      if (!readerCompleted) {
        try { await reader.cancel(); } catch {}
      }
      reader.releaseLock();
    }
  }
  /**
   * Parse Gemini API response to our format
   */
  parseGeminiResponse(response) {
    const candidate = response.candidates?.[0];
    if (!candidate) {
      if (response.promptFeedback?.blockReason) {
        throw new Error(`Gemini API: Prompt blocked - ${response.promptFeedback.blockReason}`);
      }
      throw new Error("Gemini API: No candidates in response");
    }
    let content = "";
    if (candidate.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          content += part.text;
        }
      }
    }
    const finishReasonMap = {
      "STOP": "stop",
      "MAX_TOKENS": "length",
      "SAFETY": "content_filter",
      "RECITATION": "content_filter"
    };
    const usage = response.usageMetadata ? {
      prompt_tokens: response.usageMetadata.promptTokenCount,
      completion_tokens: response.usageMetadata.candidatesTokenCount,
      total_tokens: response.usageMetadata.totalTokenCount
    } : void 0;
    return {
      id: response.responseId || void 0,
      content: content || null,
      finish_reason: candidate.finishReason ? finishReasonMap[candidate.finishReason] || candidate.finishReason : null,
      usage
    };
  }
  /**
   * Parse Gemini streaming chunk
   */
  parseGeminiStreamChunk(chunk) {
    const candidate = chunk.candidates?.[0];
    const usage = chunk.usageMetadata ? {
      prompt_tokens: chunk.usageMetadata.promptTokenCount,
      completion_tokens: chunk.usageMetadata.candidatesTokenCount,
      total_tokens: chunk.usageMetadata.totalTokenCount
    } : void 0;
    if (!candidate) {
      return {
        id: chunk.responseId,
        delta: void 0,
        finish_reason: null,
        usage
      };
    }
    let content = "";
    if (candidate.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          content += part.text;
        }
      }
    }
    const finishReasonMap = {
      "STOP": "stop",
      "MAX_TOKENS": "length",
      "SAFETY": "content_filter",
      "RECITATION": "content_filter"
    };
    return {
      id: chunk.responseId,
      delta: {
        content: content || void 0,
        role: "assistant"
      },
      finish_reason: candidate.finishReason ? finishReasonMap[candidate.finishReason] || candidate.finishReason : null,
      usage
    };
  }
  async testConnection(config, requestControl = null) {
    try {
      checkRequestControl(requestControl);
      const testRequest = {
        model: config.defaultModel || "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
        stream: false
      };
      const response = await this.chatCompletion(testRequest, config, requestControl);
      checkRequestControl(requestControl);
      if (isStrictlyComplete(response, "gemini")) {
        return { success: true, message: `Successfully connected to Gemini. Received response ID: ${response.id}` };
      }
      return { success: false, error: "Test connection to Gemini returned an incomplete response." };
    } catch (error) {
      return testConnectionFailure(error, "gemini", config?.defaultModel, requestControl);
    }
  }
}

function registerProviderImplementations(providerRegistry) {
  providerRegistry.register("openrouter", OpenRouterProvider);
  providerRegistry.register("openai-compatible", OpenAICompatibleProvider);
  providerRegistry.register("zhipu", ZhipuProvider);
  providerRegistry.register("ollama", OllamaProvider);
  providerRegistry.register("player2", Player2Provider);
  providerRegistry.register("deepseek", DeepseekProvider);
  providerRegistry.register("gemini", GeminiProvider);
}

module.exports = {
  BaseProvider,
  OpenRouterProvider,
  OpenAICompatibleProvider,
  ZhipuProvider,
  OllamaProvider,
  Player2Provider,
  DeepseekProvider,
  GeminiProvider,
  registerProviderImplementations
};
