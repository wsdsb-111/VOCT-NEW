"use strict";
const OpenAI = require("openai");

function isOpenRouterErrorResponse(e) {
  return typeof e === "object" && e !== null && "error" in e && typeof e.error === "object" && typeof e.error.message === "string" && typeof e.error.code === "number";
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
  async testConnection(config) {
    try {
      this.validateConfig(config);
      const testMessages = [{
        role: "user",
        content: "Hi."
      }];
      await this.chatCompletion({
        model: config.defaultModel,
        messages: testMessages,
        max_tokens: 10,
        stream: false
      }, config);
      return {
        success: true,
        message: `Successfully connected to ${this.name}`
      };
    } catch (error) {
      console.error(`[${this.providerId}] Connection test failed:`, error);
      return {
        success: false,
        error: error.message || `Failed to connect to ${this.name}`
      };
    }
  }
  /**
   * Lists available models (if provider supports it)
   * @param config - Provider configuration
   * @returns Array of available models
   */
  async listModels(config) {
    try {
      this.validateConfig(config);
      console.warn(`[${this.providerId}] Model listing not implemented for ${this.name}`);
      return [];
    } catch (error) {
      console.error(`[${this.providerId}] Error listing models:`, error);
      throw error;
    }
  }
  /**
   * Helper method to create consistent error messages
   */
  createErrorMessage(operation, error) {
    return `[${this.providerId}] ${operation} failed: ${error.message || "Unknown error"}`;
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
   * @param maxRetries Maximum number of retry attempts (default: 3)
   * @param initialDelay Initial delay in milliseconds (default: 1000)
   * @param shouldRetry Function to determine if error is retryable (default: always retry)
   * @returns Promise resolving to operation result
   */
  async retryWithBackoff(operation, maxRetries = 3, initialDelay = 1e3, shouldRetry = () => true) {
    let delay = initialDelay;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries || !shouldRetry(error)) {
          throw error;
        }
        console.log(`[${this.providerId}] Retry attempt ${attempt + 1}/${maxRetries + 1} after ${delay}ms delay`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
    throw lastError;
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
    if (error instanceof OpenAI.APIError) {
      const status = error.status;
      return status === 429 || status >= 500 && status < 600;
    }
    return error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND";
  }
  async listModels(config) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.getAPIKey(config)}`,
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`OpenRouter API error (${response.status}): ${errorBody}`);
        throw new Error(`Failed to fetch models from OpenRouter: ${response.statusText}`);
      }
      const { data } = await response.json();
      if (!Array.isArray(data)) {
        console.error("Unexpected response format from OpenRouter /models endpoint:", data);
        throw new Error("Unexpected response format from OpenRouter /models endpoint.");
      }
      return data.map((modelData) => ({
        id: modelData.id,
        name: modelData.name || modelData.id,
        isFree: isOpenRouterFreeModel(modelData),
        contextLength: modelData.context_length
        // Add other properties as needed, e.g., pricing details
      }));
    } catch (error) {
      console.error("Error fetching OpenRouter models:", error);
      throw error;
    }
  }
  chatCompletion(request, config) {
    const openAIClient = new OpenAI({
      apiKey: this.getAPIKey(config),
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/Voices-of-the-Court/VOTC",
        "X-Title": "Voices of the Court 2.0"
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
      return this._streamChatCompletion(requestParams, openAIClient, request.signal);
    } else {
      return this._nonStreamChatCompletion(requestParams, openAIClient);
    }
  }
  async _nonStreamChatCompletion(request, openAIClient) {
    try {
      const data = await this.retryWithBackoff(
        () => openAIClient.chat.completions.create(request),
        3,
        1e3,
        this.shouldRetryOpenRouter.bind(this)
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
          prompt_cache_miss_tokens: data.usage.prompt_cache_miss_tokens
        } : void 0
      };
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        console.error(
          `[OpenRouterProvider] API error for model ${request.model}:`,
          error.status,
          error.name,
          error.message,
          error.metadata?.raw
        );
        throw new Error(`OpenRouter API error via SDK: ${error.status} ${error.name} - ${error.message}`);
      }
      console.error(`[OpenRouterProvider] Unexpected error for model ${request.model}:`, error);
      throw new Error(`Unexpected OpenRouter SDK error: ${error.message || error}`);
    }
  }
  async *_streamChatCompletion(request, openAIClient, signal) {
    try {
      const stream = await this.retryWithBackoff(
        () => openAIClient.chat.completions.create(request),
        7,
        1e3,
        this.shouldRetryOpenRouter.bind(this)
      );
      const contentParts = [];
      const toolCallsMap = {};
      let finalUsage = void 0;
      let finalFinishReason = null;
      let firstChunkId = "";
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (choice?.finish_reason === "error") {
          const choiceWithError = choice;
          if (choiceWithError.error) {
            const error = choiceWithError.error;
            console.error(
              `OpenRouter Mid-Stream Error: ${error?.code || "Unknown"} - ${error?.message || "Unknown error"}`
            );
            const errorDetails = typeof error === "object" ? JSON.stringify(error, null, 2) : String(error);
            throw new Error(`OpenRouter Mid-Stream Error: ${errorDetails}`);
          } else {
            throw new Error(
              `OpenRouter Mid-Stream Error: Stream terminated with error status but no error details provided`
            );
          }
        }
        if (!firstChunkId && chunk.id) {
          firstChunkId = chunk.id;
        }
        if (!choice) continue;
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
            reasoning: delta.reasoning_content || delta.reasoning || void 0,
            role: delta.role,
            tool_calls: delta.tool_calls
          } : void 0,
          finish_reason
        };
        yield streamChunk;
        if (delta?.content) {
          contentParts.push(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const key = `${tc.index}_${tc.id}`;
            if (!toolCallsMap[key]) {
              toolCallsMap[key] = {
                id: tc.id,
                type: "function",
                function: { name: "", arguments: "" }
              };
            }
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
      if (signal?.aborted) {
        console.info(`[OpenRouterProvider] OpenAI SDK stream cancelled for model ${request.model}:`, error);
        throw new Error(`AbortError: Message cancelled`);
      }
      console.error(`[OpenRouterProvider] OpenAI SDK stream error for model ${request.model}:`, error);
      if (isOpenRouterErrorResponse(error)) {
        const openRouterError = error.error;
        const metadataStr = openRouterError.metadata ? `
Metadata: ${JSON.stringify(openRouterError.metadata, null, 2)}` : "";
        console.error(`OpenRouter API stream error via SDK: ${openRouterError.code} - ${openRouterError.message} ${metadataStr}`);
        throw new Error(`OpenRouter API stream error via SDK: ${openRouterError.code} - ${openRouterError.message} ${metadataStr}`);
      }
      if (error instanceof OpenAI.APIError) {
        throw new Error(`OpenRouter API stream error via SDK: ${error.status} ${error.name} - ${error.message}`);
      }
      throw new Error(`OpenRouter API stream error via SDK: ${error.message || "Unknown error"}`);
    }
  }
  async testConnection(config) {
    try {
      const testRequest = {
        model: config.defaultModel || "openrouter/auto",
        // Use a known cheap/fast model or user's default
        messages: [{ role: "user", content: "Test" }],
        max_tokens: 1,
        stream: false
      };
      const response = await this.chatCompletion(testRequest, config);
      if (response && (response.content || response.id)) {
        return { success: true, message: `Successfully connected to OpenRouter. Received response ID: ${response.id}` };
      }
      return { success: false, error: "Test connection to OpenRouter failed to get a valid response." };
    } catch (e) {
      console.error("OpenRouter testConnection error:", e);
      return { success: false, error: e.message || "Unknown error during OpenRouter test connection." };
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
    if (error instanceof OpenAI.APIError) {
      const status = error.status;
      return status === 429 || status >= 500 && status < 600;
    }
    return error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND";
  }
  async listModels(config) {
    const headers = {
      "Content-Type": "application/json",
      "X-Title": "Voices of the Court 2.0",
      "User-Agent": "VOTC/2.0.4",
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
        () => openAIClient.models.list(),
        3,
        1e3,
        this.shouldRetry.bind(this)
      );
      return response.data.map((modelData) => ({
        id: modelData.id,
        name: modelData.id
      }));
    } catch (error) {
      console.warn("OpenAICompatibleProvider: Failed to fetch models using OpenAI library, falling back to fetch:", error);
      try {
        const response = await fetch(`${this.getBaseUrl(config)}/models`, {
          method: "GET",
          headers
        });
        if (!response.ok) {
          const errorBody = await response.text();
          console.warn(`OpenAICompatibleProvider: Failed to fetch models from ${this.getBaseUrl(config)} (${response.status}): ${errorBody}`);
          return [];
        }
        const { data } = await response.json();
        if (!Array.isArray(data)) {
          console.warn("OpenAICompatibleProvider: Unexpected response format from /models endpoint:", data);
          return [];
        }
        return data.map((modelData) => ({
          id: modelData.id,
          name: modelData.id
        }));
      } catch (fallbackError) {
        console.warn("OpenAICompatibleProvider: Error fetching models with fallback:", fallbackError);
        return [];
      }
    }
  }
  chatCompletion(request, config) {
    const headers = {
      "Content-Type": "application/json",
      "X-Title": "Voices of the Court 2.0",
      "User-Agent": "VOTC/2.0.4",
      // Custom User-Agent to avoid Cloudflare blocking
      ...config.apiKey && { "Authorization": `Bearer ${config.apiKey}` }
    };
    const openAIClient = new OpenAI({
      apiKey: this.getAPIKey(config),
      baseURL: this.getBaseUrl(config),
      defaultHeaders: headers,
      maxRetries: 0
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
      ...request.stream ? { stream_options: { include_usage: true } } : {}
    };
    if (requestParams.stream) {
      return this._streamChatCompletion(requestParams, openAIClient, request.signal);
    } else {
      return this._nonStreamChatCompletion(requestParams, openAIClient);
    }
  }
  async _nonStreamChatCompletion(request, openAIClient) {
    try {
      const data = await this.retryWithBackoff(
        () => openAIClient.chat.completions.create(request),
        3,
        1e3,
        this.shouldRetry.bind(this)
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
          prompt_cache_miss_tokens: data.usage.prompt_cache_miss_tokens
        } : void 0
      };
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        console.error(
          `[OpenAICompatibleProvider] API error for model ${request.model}:`,
          error.status,
          error.name,
          error.message
        );
        throw new Error(`OpenAI-Compatible API error via SDK: ${error.status} ${error.name} - ${error.message}`);
      }
      console.error(`[OpenAICompatibleProvider] Unexpected error for model ${request.model}:`, error);
      throw new Error(`Unexpected OpenAI-Compatible SDK error: ${error.message || error}`);
    }
  }
  async *_streamChatCompletion(request, openAIClient, signal) {
    try {
      const stream = await this.retryWithBackoff(
        () => openAIClient.chat.completions.create(request, signal ? { signal } : void 0),
        7,
        1e3,
        this.shouldRetry.bind(this)
      );
      const contentParts = [];
      const toolCallsMap = {};
      let finalUsage = void 0;
      let finalFinishReason = null;
      let firstChunkId = "";
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!firstChunkId && chunk.id) {
          firstChunkId = chunk.id;
        }
        if (!choice) continue;
        const delta = choice.delta;
        const finish_reason = choice.finish_reason;
        if (chunk.usage) {
          finalUsage = chunk.usage;
        }
        const streamChunk = {
          id: chunk.id,
          delta: delta ? {
            content: delta.content || void 0,
            reasoning: delta.reasoning_content || delta.reasoning || void 0,
            role: delta.role,
            tool_calls: delta.tool_calls
          } : void 0,
          finish_reason
        };
        yield streamChunk;
        if (delta?.content) {
          contentParts.push(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const key = `${tc.index}_${tc.id}`;
            if (!toolCallsMap[key]) {
              toolCallsMap[key] = {
                id: tc.id,
                type: "function",
                function: { name: "", arguments: "" }
              };
            }
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
      if (signal?.aborted) {
        console.info(`[OpenAICompatibleProvider] OpenAI SDK stream cancelled for model ${request.model}:`, error);
        throw new Error(`AbortError: Message cancelled`);
      }
      console.error(`[OpenAICompatibleProvider] OpenAI SDK stream error for model ${request.model}:`, error);
      if (error instanceof OpenAI.APIError) {
        throw new Error(`OpenAI-Compatible API stream error via SDK: ${error.status} ${error.name} - ${error.message}`);
      }
      throw new Error(`OpenAI-Compatible API stream error via SDK: ${error.message || "Unknown error"}`);
    }
  }
  async testConnection(config) {
    try {
      const testRequest = {
        model: config.defaultModel || "gpt-3.5-turbo",
        messages: [{ role: "user", content: "Test" }],
        max_tokens: 1,
        stream: false
      };
      const response = await this.chatCompletion(testRequest, config);
      if (response && (response.content || response.id)) {
        return { success: true, message: `Successfully connected to OpenAI-Compatible API. Received response ID: ${response.id}` };
      }
      return { success: false, error: "Test connection to OpenAI-Compatible API failed to get a valid response." };
    } catch (e) {
      console.error("OpenAI-Compatible testConnection error:", e);
      return { success: false, error: e.message || "Unknown error during OpenAI-Compatible test connection." };
    }
  }
}
class OllamaProvider {
  constructor() {
    this.providerId = "ollama";
    this.name = "Ollama";
  }
  getConfig(config) {
    if (config.providerType !== "ollama" || !config.baseUrl) {
      throw new Error("Invalid configuration for OllamaProvider: Base URL is missing or type is incorrect.");
    }
    return config;
  }
  async listModels(config) {
    const providerConfig = this.getConfig(config);
    const endpoint = `${providerConfig.baseUrl.replace(/\/$/, "")}/api/tags`;
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Ollama API error (${response.status}) listing models: ${errorBody}`);
        throw new Error(`Failed to fetch models from Ollama: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data.models || !Array.isArray(data.models)) {
        console.error("Unexpected response format from Ollama /api/tags endpoint:", data);
        throw new Error("Unexpected response format from Ollama /api/tags endpoint.");
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
      console.error("Error fetching Ollama models:", error);
      throw error;
    }
  }
  // Implementation
  chatCompletion(request, config) {
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
      return this._streamChatCompletion(request, endpoint, body);
    } else {
      return this._nonStreamChatCompletion(request, endpoint, body);
    }
  }
  async _nonStreamChatCompletion(request, endpoint, body) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream: false })
      // Ensure stream is false
    });
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Ollama API error (${response.status}) for model ${request.model}: ${errorBody}`);
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }
    const data = await response.json();
    if (!data.message || typeof data.message.content !== "string") {
      throw new Error("Invalid response from Ollama: No message content found.");
    }
    return {
      id: data.created_at,
      // Ollama doesn't have a specific response ID like OpenAI, use created_at or generate one
      content: data.message.content,
      // tool_calls: undefined, // Ollama native API doesn't support OpenAI-style tool calls directly
      finish_reason: data.done ? data.done_reason || "stop" : null,
      // done_reason might exist
      usage: {
        // Ollama provides token counts in the response
        prompt_tokens: data.prompt_eval_count,
        completion_tokens: data.eval_count,
        total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
      }
    };
  }
  async *_streamChatCompletion(request, endpoint, body) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream: true })
    });
    if (!response.ok || !response.body) {
      const errorBody = await response.text();
      console.error(`Ollama API stream error (${response.status}) for model ${request.model}: ${errorBody}`);
      throw new Error(`Ollama API stream error: ${response.status} ${response.statusText} - ${errorBody}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let aggregatedResponse = {
      id: "",
      // Will be set from first chunk or generated
      content: "",
      // tool_calls: [], // Ollama native API doesn't support OpenAI-style tool calls directly
      finish_reason: null,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
    let firstChunk = true;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let eolIndex;
        while ((eolIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.substring(0, eolIndex).trim();
          buffer = buffer.substring(eolIndex + 1);
          if (line) {
            try {
              const chunkData = JSON.parse(line);
              if (firstChunk) {
                aggregatedResponse.id = chunkData.created_at || Date.now().toString();
                firstChunk = false;
              }
              const streamChunk = {
                delta: chunkData.message?.content ? { content: chunkData.message.content } : void 0,
                finish_reason: chunkData.done ? chunkData.done_reason || "stop" : null
              };
              yield streamChunk;
              if (chunkData.message?.content) {
                aggregatedResponse.content = (aggregatedResponse.content || "") + chunkData.message.content;
              }
              if (chunkData.done) {
                aggregatedResponse.finish_reason = chunkData.done_reason || "stop";
                aggregatedResponse.usage = {
                  prompt_tokens: chunkData.prompt_eval_count,
                  completion_tokens: chunkData.eval_count,
                  total_tokens: (chunkData.prompt_eval_count || 0) + (chunkData.eval_count || 0)
                };
                return aggregatedResponse;
              }
            } catch (e) {
              console.error("Error parsing Ollama stream chunk:", e, "Raw line:", line);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return aggregatedResponse;
  }
  async testConnection(config) {
    const providerConfig = this.getConfig(config);
    try {
      await this.listModels(providerConfig);
      return { success: true, message: `Successfully connected to Ollama at ${providerConfig.baseUrl}.` };
    } catch (e) {
      console.error(`Ollama testConnection error for ${providerConfig.baseUrl}:`, e);
      return { success: false, error: e.message || `Unknown error during Ollama test connection to ${providerConfig.baseUrl}.` };
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
  async listModels() {
    return [];
  }
  /**
   * Determine if an error should trigger a retry
   * @param error The error to check
   * @returns true if the error is retryable
   */
  shouldRetryPlayer2(error) {
    if (error instanceof OpenAI.APIError) {
      const status = error.status;
      return status === 429 || status >= 500 && status < 600;
    }
    return error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND";
  }
  chatCompletion(request) {
    const openAIClient = new OpenAI({
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
      return this._streamChatCompletion(requestParams, openAIClient, request.signal);
    } else {
      return this._nonStreamChatCompletion(requestParams, openAIClient);
    }
  }
  async _nonStreamChatCompletion(request, openAIClient) {
    try {
      const data = await this.retryWithBackoff(
        () => openAIClient.chat.completions.create(request),
        3,
        1e3,
        this.shouldRetryPlayer2.bind(this)
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
      if (error instanceof OpenAI.APIError) {
        console.error(
          `[Player2Provider] API error for model ${request.model}:`,
          error.status,
          error.name,
          error.message
        );
        throw new Error(`Player2 API error via SDK: ${error.status} ${error.name} - ${error.message}`);
      }
      console.error(`[Player2Provider] Unexpected error for model ${request.model}:`, error);
      throw new Error(`Unexpected Player2 SDK error: ${error.message || error}`);
    }
  }
  async *_streamChatCompletion(request, openAIClient, signal) {
    try {
      const stream = await this.retryWithBackoff(
        () => openAIClient.chat.completions.create(request, signal ? { signal } : void 0),
        7,
        1e3,
        this.shouldRetryPlayer2.bind(this)
      );
      const contentParts = [];
      const toolCallsMap = {};
      let finalUsage = void 0;
      let finalFinishReason = null;
      let firstChunkId = "";
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (choice?.finish_reason === "error") {
          const choiceWithError = choice;
          if (choiceWithError.error) {
            const error = choiceWithError.error;
            console.error(
              `Player2 Mid-Stream Error: ${error?.code || "Unknown"} - ${error?.message || "Unknown error"}`
            );
            const errorDetails = typeof error === "object" ? JSON.stringify(error, null, 2) : String(error);
            throw new Error(`Player2 Mid-Stream Error: ${errorDetails}`);
          } else {
            throw new Error(
              `Player2 Mid-Stream Error: Stream terminated with error status but no error details provided`
            );
          }
        }
        if (!firstChunkId && chunk.id) {
          firstChunkId = chunk.id;
        }
        if (!choice) continue;
        const delta = choice.delta;
        const finish_reason = choice.finish_reason;
        if (chunk.usage) {
          finalUsage = chunk.usage;
        }
        const streamChunk = {
          id: chunk.id,
          delta: delta ? {
            content: delta.content || void 0,
            reasoning: delta.reasoning_content || delta.reasoning || void 0,
            role: delta.role,
            tool_calls: delta.tool_calls
          } : void 0,
          finish_reason
        };
        yield streamChunk;
        if (delta?.content) {
          contentParts.push(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const key = `${tc.index}_${tc.id}`;
            if (!toolCallsMap[key]) {
              toolCallsMap[key] = {
                id: tc.id,
                type: "function",
                function: { name: "", arguments: "" }
              };
            }
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
      if (signal?.aborted) {
        console.info(`[Player2Provider] OpenAI SDK stream cancelled for model ${request.model}:`, error);
        throw new Error(`AbortError: Message cancelled`);
      }
      console.error(`[Player2Provider] OpenAI SDK stream error for model ${request.model}:`, error);
      if (error instanceof OpenAI.APIError) {
        throw new Error(`Player2 API stream error via SDK: ${error.status} ${error.name} - ${error.message}`);
      }
      throw new Error(`Player2 API stream error via SDK: ${error.message || "Unknown error"}`);
    }
  }
  async testConnection() {
    try {
      const testRequest = {
        model: "gpt-oss-120b",
        // Use a known cheap/fast model or user's default
        messages: [{ role: "user", content: "Test" }],
        max_tokens: 1,
        stream: false
      };
      const response = await this.chatCompletion(testRequest);
      if (response && (response.content || response.id)) {
        return { success: true, message: `Successfully connected to Player2. Received response ID: ${response.id}` };
      }
      return { success: false, error: "Test connection to Player2 failed to get a valid response." };
    } catch (e) {
      console.error("Player2 testConnection error:", e);
      return { success: false, error: e.message || "Unknown error during Player2 test connection." };
    }
  }
  async checkHealth() {
    try {
      const baseHeaders = {
        Accept: "application/json",
        "player2-game-key": this.player2GameKey
      };
      const response = await fetch(this.player2HealthUrl, {
        method: "GET",
        headers: baseHeaders
      });
      return await this.handleHealthErrorResponse(response);
    } catch (error) {
      console.error("[Player2Provider] Health check error:", error);
      return { success: false, error: error.message || "Unable to reach Player2 health endpoint." };
    }
  }
  async handleHealthErrorResponse(response) {
    if (response.status === 200) {
      return { success: true };
    }
    if (response.status === 401) {
      return { success: false, code: 401, error: "Authentication required in Player2 App." };
    }
    if (response.status === 402) {
      const data = await response.json().catch(() => ({}));
      return { success: false, code: 402, error: data.message || "Insufficient credits." };
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
    const fallback = await response.text().catch(() => "Unknown error");
    return { success: false, code: response.status, error: fallback || "Unknown error." };
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
    if (error instanceof OpenAI.APIError) {
      const status = error.status;
      return status === 429 || status >= 500 && status < 600;
    }
    return error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND";
  }
  /**
   * Get the base URL for Deepseek API
   */
  getDeepseekBaseUrl(config) {
    return config.baseUrl || this.DEFAULT_BASE_URL;
  }
  async listModels(_) {
    return [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }
    ];
  }
  chatCompletion(request, config) {
    const baseUrl = this.getDeepseekBaseUrl(config);
    const openAIClient = new OpenAI({
      apiKey: this.getAPIKey(config),
      baseURL: baseUrl,
      maxRetries: 0
    });
    const transformedRequest = this.transformRequestForDeepseek(request);
    const requestParams = {
      model: transformedRequest.model,
      messages: transformedRequest.messages,
      stream: transformedRequest.stream,
      temperature: transformedRequest.temperature,
      max_tokens: transformedRequest.max_tokens,
      top_p: transformedRequest.top_p,
      presence_penalty: transformedRequest.presence_penalty,
      frequency_penalty: transformedRequest.frequency_penalty,
      // DeepSeek structured action requests disable thinking in the provider
      // adapter; ordinary chat and summary request parameters remain unchanged.
      ...transformedRequest.thinking ? { thinking: transformedRequest.thinking } : {},
      // Deepseek only supports json_object, not json_schema
      ...transformedRequest.response_format ? { response_format: transformedRequest.response_format } : {},
      ...transformedRequest.stream ? { stream_options: { include_usage: true } } : {}
    };
    if (requestParams.stream) {
      return this._streamChatCompletion(requestParams, openAIClient, request.signal);
    } else {
      return this._nonStreamChatCompletion(requestParams, openAIClient);
    }
  }
  /**
   * Transform the request for Deepseek compatibility
   * - Converts json_schema response_format to json_object with schema in prompt
   */
  transformRequestForDeepseek(request) {
    const transformed = { ...request };
    if (request.response_format?.type === "json_schema" && request.response_format.json_schema) {
      const jsonSchemaObj = request.response_format.json_schema;
      const schemaName = jsonSchemaObj.name || "response";
      const schemaObj = jsonSchemaObj.schema;
      transformed.response_format = { type: "json_object" };
      if (schemaName === "votc_actions") {
        transformed.thinking = { type: "disabled" };
      }
      const schemaDescription = this.buildSchemaDescription(schemaName, schemaObj);
      const messages = [...request.messages];
      let schemaInjected = false;
      // The action list and its schema change together. Keeping the schema beside
      // Available Actions lets DeepSeek cache both before volatile recent dialogue.
      // Other structured requests retain the original last-system-message behavior.
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
      transformed.messages = messages;
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
  async _nonStreamChatCompletion(request, openAIClient) {
    try {
      const data = await this.retryWithBackoff(
        () => openAIClient.chat.completions.create(request),
        3,
        1e3,
        this.shouldRetry.bind(this)
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
      if (error instanceof OpenAI.APIError) {
        console.error(
          `[DeepseekProvider] API error for model ${request.model}:`,
          error.status,
          error.name,
          error.message
        );
        throw new Error(`Deepseek API error: ${error.status} ${error.name} - ${error.message}`);
      }
      console.error(`[DeepseekProvider] Unexpected error for model ${request.model}:`, error);
      throw new Error(`Unexpected Deepseek API error: ${error.message || error}`);
    }
  }
  async *_streamChatCompletion(request, openAIClient, signal) {
    try {
      const stream = await this.retryWithBackoff(
        () => openAIClient.chat.completions.create(request, signal ? { signal } : void 0),
        7,
        1e3,
        this.shouldRetry.bind(this)
      );
      const contentParts = [];
      const toolCallsMap = {};
      let finalUsage = void 0;
      let finalFinishReason = null;
      let firstChunkId = "";
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!firstChunkId && chunk.id) {
          firstChunkId = chunk.id;
        }
        if (!choice) continue;
        const delta = choice.delta;
        const finish_reason = choice.finish_reason;
        if (chunk.usage) {
          finalUsage = chunk.usage;
        }
        const streamChunk = {
          id: chunk.id,
          delta: delta ? {
            content: delta.content || void 0,
            reasoning: delta.reasoning_content || delta.reasoning || void 0,
            role: delta.role,
            tool_calls: delta.tool_calls
          } : void 0,
          finish_reason
        };
        yield streamChunk;
        if (delta?.content) {
          contentParts.push(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const key = `${tc.index}_${tc.id}`;
            if (!toolCallsMap[key]) {
              toolCallsMap[key] = {
                id: tc.id,
                type: "function",
                function: { name: "", arguments: "" }
              };
            }
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
      if (signal?.aborted) {
        console.info(`[DeepseekProvider] Stream cancelled for model ${request.model}:`, error);
        throw new Error(`AbortError: Message cancelled`);
      }
      console.error(`[DeepseekProvider] Stream error for model ${request.model}:`, error);
      if (error instanceof OpenAI.APIError) {
        throw new Error(`Deepseek API stream error: ${error.status} ${error.name} - ${error.message}`);
      }
      throw new Error(`Deepseek API stream error: ${error.message || "Unknown error"}`);
    }
  }
  async testConnection(config) {
    try {
      const testRequest = {
        model: config.defaultModel || "deepseek-v4-flash",
        messages: [{ role: "user", content: "Test" }],
        max_tokens: 1,
        stream: false
      };
      const response = await this.chatCompletion(testRequest, config);
      if (response && (response.content || response.id)) {
        return { success: true, message: `Successfully connected to Deepseek. Received response ID: ${response.id}` };
      }
      return { success: false, error: "Test connection to Deepseek failed to get a valid response." };
    } catch (e) {
      console.error("Deepseek testConnection error:", e);
      return { success: false, error: e.message || "Unknown error during Deepseek test connection." };
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
    if (error.status) {
      const status = error.status;
      return status === 429 || status >= 500 && status < 600;
    }
    return error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND";
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
  async listModels(config) {
    const baseUrl = this.getGeminiBaseUrl(config);
    const apiKey = this.getAPIKey(config);
    try {
      const response = await fetch(`${baseUrl}/models?key=${apiKey}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        console.warn(`GeminiProvider: Failed to fetch models (${response.status})`);
        return this.getDefaultModels();
      }
      const data = await response.json();
      if (!data.models || !Array.isArray(data.models)) {
        console.warn("GeminiProvider: Unexpected response format from /models endpoint");
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
      console.warn("GeminiProvider: Error fetching models:", error);
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
  chatCompletion(request, config) {
    const baseUrl = this.getGeminiBaseUrl(config);
    const apiKey = this.getAPIKey(config);
    const modelName = request.model.startsWith("models/") ? request.model : `models/${request.model}`;
    if (request.stream) {
      return this._streamChatCompletion(baseUrl, apiKey, modelName, request);
    } else {
      return this._nonStreamChatCompletion(baseUrl, apiKey, modelName, request);
    }
  }
  async _nonStreamChatCompletion(baseUrl, apiKey, modelName, request) {
    const body = this.buildRequestBody(request);
    try {
      const response = await this.retryWithBackoff(
        async () => {
          const res = await fetch(`${baseUrl}/${modelName}:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
          });
          if (!res.ok) {
            const errorBody = await res.text();
            const error = new Error(`Gemini API error: ${res.status} - ${errorBody}`);
            error.status = res.status;
            throw error;
          }
          return res.json();
        },
        3,
        1e3,
        this.shouldRetry.bind(this)
      );
      return this.parseGeminiResponse(response);
    } catch (error) {
      console.error(`[GeminiProvider] API error for model ${request.model}:`, error);
      throw new Error(`Gemini API error: ${error.message || error}`);
    }
  }
  async *_streamChatCompletion(baseUrl, apiKey, modelName, request) {
    const body = this.buildRequestBody(request);
    const url = `${baseUrl}/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`;
    let response;
    try {
      response = await this.retryWithBackoff(
        async () => {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body),
            signal: request.signal
          });
          if (!res.ok) {
            const errorBody = await res.text();
            const error = new Error(`Gemini API error: ${res.status} - ${errorBody}`);
            error.status = res.status;
            throw error;
          }
          return res;
        },
        3,
        1e3,
        this.shouldRetry.bind(this)
      );
    } catch (error) {
      if (request.signal?.aborted) {
        throw new Error("AbortError: Message cancelled");
      }
      console.error(`[GeminiProvider] Stream error for model ${request.model}:`, error);
      throw new Error(`Gemini API stream error: ${error.message || error}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Gemini API: No response body");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedContent = "";
    let firstChunkId = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const chunk = this.parseGeminiStreamChunk(parsed);
              if (!firstChunkId && chunk.id) {
                firstChunkId = chunk.id;
              }
              if (chunk.delta?.content) {
                accumulatedContent += chunk.delta.content;
              }
              yield chunk;
            } catch (parseError) {
              console.warn("[GeminiProvider] Failed to parse SSE data:", data);
            }
          }
        }
      }
      return {
        id: firstChunkId,
        content: accumulatedContent,
        finish_reason: "stop"
      };
    } finally {
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
      "RECITATION": "content_filter",
      "OTHER": "stop"
    };
    const usage = response.usageMetadata ? {
      prompt_tokens: response.usageMetadata.promptTokenCount,
      completion_tokens: response.usageMetadata.candidatesTokenCount,
      total_tokens: response.usageMetadata.totalTokenCount
    } : void 0;
    return {
      id: response.responseId || void 0,
      content: content || null,
      finish_reason: candidate.finishReason ? finishReasonMap[candidate.finishReason] || "stop" : "stop",
      usage
    };
  }
  /**
   * Parse Gemini streaming chunk
   */
  parseGeminiStreamChunk(chunk) {
    const candidate = chunk.candidates?.[0];
    if (!candidate) {
      return {
        id: chunk.responseId,
        delta: void 0,
        finish_reason: null
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
      "RECITATION": "content_filter",
      "OTHER": "stop"
    };
    return {
      id: chunk.responseId,
      delta: {
        content: content || void 0,
        role: "assistant"
      },
      finish_reason: candidate.finishReason ? finishReasonMap[candidate.finishReason] || null : null
    };
  }
  async testConnection(config) {
    try {
      const testRequest = {
        model: config.defaultModel || "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
        stream: false
      };
      const response = await this.chatCompletion(testRequest, config);
      if (response && (response.content !== null || response.id)) {
        return { success: true, message: `Successfully connected to Gemini. Response: ${response.content?.substring(0, 50) || "(empty)"}` };
      }
      return { success: false, error: "Test connection to Gemini failed to get a valid response." };
    } catch (e) {
      console.error("Gemini testConnection error:", e);
      return { success: false, error: e.message || "Unknown error during Gemini test connection." };
    }
  }
}

function registerProviderImplementations(providerRegistry) {
  providerRegistry.register("openrouter", OpenRouterProvider);
  providerRegistry.register("openai-compatible", OpenAICompatibleProvider);
  providerRegistry.register("ollama", OllamaProvider);
  providerRegistry.register("player2", Player2Provider);
  providerRegistry.register("deepseek", DeepseekProvider);
  providerRegistry.register("gemini", GeminiProvider);
}

module.exports = {
  BaseProvider,
  OpenRouterProvider,
  OpenAICompatibleProvider,
  OllamaProvider,
  Player2Provider,
  DeepseekProvider,
  GeminiProvider,
  registerProviderImplementations
};
