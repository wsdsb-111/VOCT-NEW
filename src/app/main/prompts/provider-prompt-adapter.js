"use strict";

const DEFAULT_PROFILE = Object.freeze({
  id: "v89_default",
  label: "V8.9 Default Layout",
  historyWindow: null,
  glmCacheLayout: false
});

const DEEPSEEK_PROFILE = Object.freeze({
  id: "deepseek_v89",
  label: "DeepSeek V8.9 Layout",
  historyWindow: null,
  glmCacheLayout: false
});

const GLM_CACHE_PROFILE = Object.freeze({
  id: "glm_cache_v2",
  label: "GLM Cache v2",
  historyWindow: null,
  glmCacheLayout: true
});

function resolveProviderPromptProfile(providerConfig, adapterEnabled) {
  if (adapterEnabled !== true) return DEFAULT_PROFILE;
  if (providerConfig?.providerType === "zhipu" && String(providerConfig.defaultModel || "").toLowerCase() === "glm-5.3-flash") return GLM_CACHE_PROFILE;
  if (providerConfig?.providerType === "deepseek" || providerConfig?.providerType === "openai-compatible" && String(providerConfig.defaultModel || "").toLowerCase() === "deepseek-v4-flash-0731") return DEEPSEEK_PROFILE;
  return DEFAULT_PROFILE;
}

function resolvePromptLayoutId(promptProfile, { v89LayoutEnabled, runtimeProfileSplit, v813Layout } = {}) {
  if (v813Layout === true) return "v813";
  if (v89LayoutEnabled !== true) return "v5";
  if (promptProfile?.glmCacheLayout === true) return "glm_cache_v2";
  return runtimeProfileSplit === true ? "v7" : "v6";
}

module.exports = {
  DEFAULT_PROFILE,
  DEEPSEEK_PROFILE,
  GLM_CACHE_PROFILE,
  resolveProviderPromptProfile,
  resolvePromptLayoutId
};
