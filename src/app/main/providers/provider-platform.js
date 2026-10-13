"use strict";

const { normalizeProviderResult, toLegacyResult } = require("./provider-result");
const { assertCapabilityNotUnsupported } = require("./provider-capabilities");
const { createRequestControl, awaitWithSignal, managedIterator } = require("./provider-cancellation");
const { toProviderError } = require("./provider-errors");

function observeChunk(state, chunk) {
  if (typeof chunk?.delta?.content === "string") state.content += chunk.delta.content;
  if (chunk?.delta?.reasoning) state.reasoning = true;
  if (chunk?.usage) state.usage = chunk.usage;
  if (chunk?.usage_debug) state.usageDebug = chunk.usage_debug;
  if (chunk?.id && !state.id) state.id = chunk.id;
  if (chunk?.finish_reason != null) {
    if (state.finish != null && state.finish !== chunk.finish_reason) state.conflictingFinish = true;
    state.finish = chunk.finish_reason;
  }
}

function normalizeLegacy(response, config, options, state = null) {
  const clean = { ...(response || {}) };
  const reasoningPresent = !!(clean.reasoning || clean.reasoning_content || state?.reasoning);
  delete clean.reasoning; delete clean.reasoning_content; delete clean.reasoningContent;
  if (reasoningPresent) clean.reasoning = true;
  const typed = normalizeProviderResult(clean, { providerType: config.providerType, model: options.model || config.defaultModel,
    estimatedInputTokens: options.estimatedPromptTokens, estimateTokens: options.estimateTokens,
    terminalStatus: options.terminalStatus });
  if (reasoningPresent) typed.reasoning = { ...typed.reasoning, present: true };
  return toLegacyResult(clean, typed);
}

function terminalEvent(result) {
  const status = result.votc_result.status;
  return status === "COMPLETE" || status === "TOOL_CALLS" ? "FINISHED"
    : status === "CANCELLED" ? "ABORTED"
      : ["PARTIAL", "TRUNCATED"].includes(status) ? "PARTIAL"
        : status === "UNKNOWN" ? "UNKNOWN" : "FAILED";
}

class ProviderPlatformFacade {
  async generate(provider, request, config, options = {}) {
    const control = options.control || createRequestControl({ signal: request.signal, deadline: options.deadline,
      beforeSend: options.beforeSend, reserveAttempt: options.reserveAttempt, maxAttempts: options.maxAttempts, onEvent: options.onEvent });
    const capabilities = options.capabilities;
    try {
      control.check();
      assertCapabilityNotUnsupported(capabilities, request.stream ? "streaming" : "nonStreaming");
      if (request.response_format) {
        assertCapabilityNotUnsupported(capabilities, request.response_format.type === "json_schema" ? "structuredJsonSchema" : "structuredJsonObject");
        assertCapabilityNotUnsupported(capabilities, "structuredDelivery");
      }
      const result = await awaitWithSignal(provider.chatCompletion({ ...request, signal: control.signal }, config, control), control.signal);
      if (result && typeof result[Symbol.asyncIterator] === "function") return this.stream(result, config, { ...options, model: request.model }, control);
      control.check();
      const legacy = normalizeLegacy(result, config, { ...options, model: request.model });
      if (legacy.usage) control.emit({ type: "USAGE_UPDATE", usage: legacy.votc_result.usage });
      control.emit({ type: terminalEvent(legacy), finish: legacy.votc_result.finish.normalized });
      control.dispose(); return legacy;
    } catch (error) {
      control.emit({ type: control.signal.aborted ? "ABORTED" : "FAILED" });
      control.dispose(); throw toProviderError(error, { attemptCount: control.attemptCount });
    }
  }

  stream(source, config, options, control) {
    const iterator = source[Symbol.asyncIterator]();
    const state = { content: "", reasoning: false, usage: undefined, id: "", finish: null, conflictingFinish: false };
    const generator = (async function*() {
        let completed = false, terminalEmitted = false, responseStarted = false;
        try {
          while (true) {
            control.check();
            const step = await awaitWithSignal(iterator.next(), control.signal);
            if (step.done) {
              control.check();
              const final = { ...(step.value || {}), content: typeof step.value?.content === "string" ? step.value.content : state.content,
                finish_reason: step.value?.finish_reason ?? state.finish, usage: step.value?.usage ?? state.usage,
                usage_debug: step.value?.usage_debug ?? state.usageDebug };
              if (state.finish != null && step.value?.finish_reason != null && state.finish !== step.value.finish_reason) state.conflictingFinish = true;
              const legacy = normalizeLegacy(final, config, { ...options,
                terminalStatus: state.conflictingFinish ? "UNKNOWN" : undefined }, state);
              if (legacy.usage) control.emit({ type: "USAGE_UPDATE", usage: legacy.votc_result.usage });
              control.emit({ type: terminalEvent(legacy), finish: legacy.votc_result.finish.normalized });
              terminalEmitted = true; completed = true; return legacy;
            }
            responseStarted = true;
            observeChunk(state, step.value);
            const chunk = { ...step.value };
            if (chunk.delta?.reasoning) chunk.delta = { ...chunk.delta, reasoning: true };
            if (chunk.delta?.content) control.emit({ type: "DELTA_CONTENT", characters: chunk.delta.content.length });
            if (chunk.delta?.reasoning) control.emit({ type: "DELTA_REASONING_PRESENT" });
            if (chunk.delta?.tool_calls) control.emit({ type: "TOOL_CALL_DELTA", count: chunk.delta.tool_calls.length });
            if (chunk.usage) control.emit({ type: "USAGE_UPDATE", usage: normalizeProviderResult(chunk, { providerType: config.providerType }).usage });
            yield chunk;
          }
        } catch (error) {
          control.emit({ type: control.signal.aborted ? "ABORTED" : responseStarted ? "PARTIAL" : "FAILED" });
          terminalEmitted = true;
          throw toProviderError(error, { responseStarted, attemptCount: control.attemptCount });
        } finally {
          if (!completed) {
            control.cancel();
            try { await awaitWithSignal(iterator.return?.(), control.signal); } catch {}
            if (!terminalEmitted) control.emit({ type: "ABORTED" });
          }
          control.dispose();
        }
    })();
    return managedIterator(generator, async () => {
      control.cancel();
      try { await awaitWithSignal(iterator.return?.(), control.signal); } catch {}
      control.emit({ type: "ABORTED" }); control.dispose();
    }, control.signal, () => control.cancel());
  }
}

module.exports = { ProviderPlatformFacade, observeChunk };
