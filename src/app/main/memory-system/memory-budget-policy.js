"use strict";

const PLAYER_CENTERED_RECALL_ENABLED = true;

const MEMORY_BUDGET_POLICIES = Object.freeze({
  "v9.3.5": Object.freeze({
    revision: "v9.3.5",
    tiers: Object.freeze({
      2: Object.freeze({ ratio: 0.10, capTokens: 3600 }),
      3: Object.freeze({ ratio: 0.125, capTokens: 4500 }),
      4: Object.freeze({ ratio: 0.15, capTokens: 5400 })
    })
  }),
  "v9.3.6": Object.freeze({
    revision: "v9.3.6",
    tiers: Object.freeze({
      2: Object.freeze({ ratio: 0.16, capTokens: 4800 }),
      3: Object.freeze({ ratio: 0.18, capTokens: 5600 }),
      4: Object.freeze({ ratio: 0.20, capTokens: 6400 })
    })
  })
});

const DEFAULT_MEMORY_BUDGET_POLICY_REVISION = PLAYER_CENTERED_RECALL_ENABLED ? "v9.3.6" : "v9.3.5";

function resolveMemoryBudget({ participantCount, contextWindowTokens, providerHeadroomTokens, policyRevision = DEFAULT_MEMORY_BUDGET_POLICY_REVISION } = {}) {
  const policy = MEMORY_BUDGET_POLICIES[policyRevision];
  const count = Number(participantCount);
  const contextWindow = Number(contextWindowTokens);
  const providerHeadroom = Number(providerHeadroomTokens);
  if (!policy || !Number.isSafeInteger(count) || count < 2
    || !Number.isFinite(contextWindow) || contextWindow <= 0
    || !Number.isFinite(providerHeadroom) || providerHeadroom < 0) {
    return {
      policyRevision: policy?.revision || null,
      participantTier: null,
      ratio: 0,
      policyCapTokens: 0,
      proportionalTokens: 0,
      policyBudgetTokens: 0,
      providerHeadroomTokens: Number.isFinite(providerHeadroom) && providerHeadroom >= 0 ? Math.floor(providerHeadroom) : 0,
      memoryBudgetTokens: 0
    };
  }
  const participantTier = count >= 4 ? 4 : count;
  const tier = policy.tiers[participantTier];
  const proportionalTokens = Math.floor(contextWindow * tier.ratio);
  const policyBudgetTokens = Math.min(proportionalTokens, tier.capTokens);
  const normalizedProviderHeadroom = Math.floor(providerHeadroom);
  return {
    policyRevision: policy.revision,
    participantTier,
    ratio: tier.ratio,
    policyCapTokens: tier.capTokens,
    proportionalTokens,
    policyBudgetTokens,
    providerHeadroomTokens: normalizedProviderHeadroom,
    memoryBudgetTokens: Math.min(policyBudgetTokens, normalizedProviderHeadroom)
  };
}

function isMemoryBudgetBlock(block) {
  const id = String(block?.id || "");
  const type = String(block?.type || "");
  if (id === "memory-topic-patch" || type === "memory_topic_patch") return false;
  return id.startsWith("memory-") || type.startsWith("memory_")
    || id === "third-party-evidence-patch" || type === "third_party_evidence"
    || type === "memories" || type === "past_summaries";
}

module.exports = {
  PLAYER_CENTERED_RECALL_ENABLED,
  MEMORY_BUDGET_POLICIES,
  DEFAULT_MEMORY_BUDGET_POLICY_REVISION,
  resolveMemoryBudget,
  isMemoryBudgetBlock
};
