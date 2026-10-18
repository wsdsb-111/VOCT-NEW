"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const versionModulePath = require.resolve("../src/app/main/version");
require.cache[versionModulePath] = {
  id: versionModulePath,
  filename: versionModulePath,
  loaded: true,
  exports: { MEMORY_ENGINE_VERSION: "3.0" }
};

const { TokenCounter } = require("../src/app/main/provider-service");
const { planRequestBudget } = require("../src/app/main/providers/request-budget");
const {
  MEMORY_BUDGET_POLICIES,
  resolveMemoryBudget
} = require("../src/app/main/memory-system/memory-budget-policy");
const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { Conversation } = require("../src/app/main/conversation/conversation");

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex").slice(0, 16);
}

const promptState = { v813: false };
const settingsRepository = {
  getPromptSettings: () => ({
    mainTemplate: "V936_GLOBAL_RULES",
    blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "V936_FINAL_INSTRUCTION" }
    ],
    suffix: { enabled: false, template: "" }
  }),
  getChatPromptV89Settings: () => ({
    chatPromptV89Layout: true,
    chatPromptV89RuntimeProfileSplit: false,
    chatPromptV810ProviderAdapter: true
  }),
  getChatPromptV813Layout: () => promptState.v813
};
const PromptBuilder = createPromptBuilder({
  TemplateEngine: class { renderTemplateString(template) { return String(template); } },
  PromptScriptLoader: class {},
  promptConfigManager: {
    getDefaultMainTemplateContent: () => "V936_GLOBAL_RULES",
    resolvePath: value => value
  },
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: fingerprint,
  defaultChatInstruction: "V936_FINAL_INSTRUCTION"
});
Conversation.configure({ PromptBuilder, TokenCounter, createPromptFingerprint: fingerprint });

const responder = {
  id: 2,
  shortName: "NPC-B",
  fullName: "NPC-B",
  age: 35,
  gender: "male",
  traits: [],
  parents: [],
  children: [],
  memories: [],
  conversationSummaries: [],
  primaryTitle: "无",
  heldCourtAndCouncilPositions: "无",
  titleRankConcept: "concept_none"
};
const player = {
  id: 1, shortName: "玩家-A", fullName: "玩家-A", age: 40, gender: "female",
  traits: [], parents: [], children: []
};
const gameData = {
  date: "1200.1.1",
  year: 1200,
  dynasty: "V936",
  currentEraName: "V936 era",
  scene: "V936 scene",
  playerID: 1,
  characters: new Map([[1, player], [2, responder]]),
  mentionedCharactersInContext: new Set(),
  getActiveParticipantRelationshipInfo: () => "V936_LIVE_RELATIONSHIPS",
  getMentionExclusionIds: () => new Set(),
  findMentionedCharacterIdsInHistory: () => new Set(),
  getMentionedCharactersInfo: () => "",
  getMentionableCharacterProfiles() { return this.characters; }
};
const history = [
  { role: "user", content: "V936_PRIOR_USER" },
  { role: "assistant", content: "V936_PRIOR_ASSISTANT" },
  { role: "user", content: "V936_CURRENT_USER" }
];

const memoryFormatter = Object.create(MemoryEngine.prototype);
function formatEntryBlock(title, entries) {
  return memoryFormatter.formatMemoryBlock(title, entries);
}

function makeMemoryContext(overrides = {}) {
  return {
    playerCenteredRecallEnabled: true,
    tokenBudget: 4096,
    activeParticipantIds: [1, 2],
    playerAnchorId: 1,
    baselineSnapshotId: "v936-baseline-snapshot-a",
    sourceFolderRevision: 7,
    sourceCampaignToken: "v936-fixture-campaign",
    sourcePairIds: [1],
    budgetPolicyRevision: "v9.3.6",
    conversationId: "v936-fixture-conversation",
    officialRecollectionText: formatEntryBlock("TK07 官方追忆", [{ memory: {
      type: "folder_summary", subtype: "official_recollection", content: "V936_OFFICIAL_FIXED_TITLE_DATE_EVIDENCE"
    } }]),
    directStableText: formatEntryBlock("TK01 最近一篇直接关系摘要", [{ memory: {
      type: "conversation", subtype: "event", epistemicStatus: "KNOWN", eventDate: "1199.1.1",
      content: "V936_RECENT1_FIXED_TITLE_DATE_EVIDENCE"
    } }]),
    playerLedgerFrozenText: formatEntryBlock("TK01 玩家长期事项", [{ memory: {
      type: "conversation", subtype: "event", epistemicStatus: "KNOWN", eventDate: "1198.1.1",
      content: "V936_PLAYER_LEDGER_FIXED_TITLE_DATE_EVIDENCE"
    } }]),
    stableText: "V936_STABLE_MEMORY_DYNAMIC",
    mentionedSnapshotText: "V936_MENTIONED_MEMORY_DYNAMIC",
    temporalExtraText: null,
    topicPatchText: null,
    turnRecallText: null,
    thirdPartyEvidenceText: null,
    presenceText: "V936_PRESENCE_NONMEMORY",
    worldStableText: "V936_WORLD_STABLE_NONMEMORY",
    worldTopicText: "V936_WORLD_TOPIC_NONMEMORY",
    worldSupplementalText: "V936_WORLD_SUPPLEMENTAL_NONMEMORY",
    worldCurrentText: "V936_WORLD_CURRENT_NONMEMORY",
    worldTurnRecallText: "V936_WORLD_TURN_NONMEMORY",
    confirmedActionText: "V936_CONFIRMED_ACTION_NONMEMORY",
    freezePromptPrefix: true,
    stableProfileCache: new Map(),
    stableDescriptionCache: new Map(),
    cacheV2FrozenSnapshots: {
      conversation: null,
      responders: new Map(),
      prefixByResponder: new Map()
    },
    ...overrides
  };
}

function buildPrompt(layout, memoryContext = makeMemoryContext(), sourceHistory = history) {
  promptState.v813 = layout === "v813";
  const providerConfig = layout === "glm"
    ? { providerType: "zhipu", defaultModel: "glm-5.3-flash" }
    : { providerType: "openai-compatible", defaultModel: layout === "v813" ? "fixture-v813" : "fixture-normal" };
  const promptBuild = PromptBuilder.buildMessagesWithTokenCount(
    sourceHistory, responder, gameData, "V936_ROLLING_SUMMARY", memoryContext, providerConfig
  );
  const metadata = Conversation.buildPromptBlockMetadata(promptBuild);
  return {
    promptBuild,
    metadata,
    memoryTokens: PromptBuilder.getMemoryBlockTokenCount(promptBuild),
    providerConfig,
    memoryContext
  };
}

function nonMemoryPlan({ contextWindow, outputReserve, messages }) {
  const plan = planRequestBudget({
    messages,
    capabilities: { contextWindow, maxOutputTokens: contextWindow },
    requestedOutputTokens: outputReserve,
    countTokens: items => TokenCounter.calculateTotalTokens(items)
  });
  const providerHeadroomTokens = Math.max(0, plan.effectiveInputBudget - plan.estimatedInputTokens);
  return { plan, providerHeadroomTokens };
}

function expectedPolicyBudget(revision, participantCount, contextWindowTokens) {
  const tiers = MEMORY_BUDGET_POLICIES[revision].tiers;
  const tier = tiers[participantCount >= 4 ? 4 : participantCount];
  return Math.min(Math.floor(contextWindowTokens * tier.ratio), tier.capTokens);
}

function memoryBlocks(promptBuild) {
  return promptBuild.blocks.filter(entry => {
    const id = String(entry.block?.id || "");
    const type = String(entry.block?.type || "");
    return id.startsWith("memory-") && id !== "memory-topic-patch"
      || type.startsWith("memory_") && type !== "memory_topic_patch"
      || id === "third-party-evidence-patch" || type === "third_party_evidence";
  });
}

function assertPolicyMatrix() {
  const windows = [8192, 16384, 32768, 131072];
  const participantCounts = [2, 3, 4, 6];
  const cases = [];
  for (const window of windows) {
    for (const participants of participantCounts) {
      for (const revision of ["v9.3.5", "v9.3.6"]) {
        const result = resolveMemoryBudget({
          participantCount: participants,
          contextWindowTokens: window,
          providerHeadroomTokens: window,
          policyRevision: revision
        });
        const expected = expectedPolicyBudget(revision, participants, window);
        assert.equal(result.memoryBudgetTokens, expected,
          `${revision} ${window} tokens/${participants} participants must follow ratio and hard cap`);
        cases.push({
          policyRevision: revision,
          contextWindowTokens: window,
          participantCount: participants,
          tier: result.participantTier,
          ratio: result.ratio,
          policyCapTokens: result.policyCapTokens,
          policyBudgetTokens: result.policyBudgetTokens
        });
      }
    }
  }
  for (const participants of [4, 6]) {
    const current32k = resolveMemoryBudget({ participantCount: participants, contextWindowTokens: 32768, providerHeadroomTokens: 32768, policyRevision: "v9.3.6" });
    const current128k = resolveMemoryBudget({ participantCount: participants, contextWindowTokens: 131072, providerHeadroomTokens: 131072, policyRevision: "v9.3.6" });
    assert.equal(current32k.memoryBudgetTokens, 6400, "32K/4+ must stop at the new tier hard cap");
    assert.equal(current128k.memoryBudgetTokens, 6400, "128K/4+ must retain the hard cap");
  }
  return cases;
}

function assertHeadroomAndOutputReserve() {
  const ordinaryNonMemory = [{ role: "system", content: "V936_WORLDLINE_AND_HISTORY_".repeat(440) }];
  const ordinary = nonMemoryPlan({ contextWindow: 16384, outputReserve: 4096, messages: ordinaryNonMemory });
  const tk02 = resolveMemoryBudget({
    participantCount: 3,
    contextWindowTokens: 16384,
    providerHeadroomTokens: ordinary.providerHeadroomTokens,
    policyRevision: "v9.3.6"
  });
  assert.equal(tk02.memoryBudgetTokens, Math.min(2949, ordinary.providerHeadroomTokens),
    "16K/3 memory budget must take the minimum of policy allocation and already-margined Provider headroom");
  assert(ordinary.plan.safe && ordinary.providerHeadroomTokens > 0);

  const lowReserve = nonMemoryPlan({ contextWindow: 16384, outputReserve: 1024, messages: ordinaryNonMemory });
  const highReserve = nonMemoryPlan({ contextWindow: 16384, outputReserve: 11000, messages: ordinaryNonMemory });
  const lowReserveBudget = resolveMemoryBudget({
    participantCount: 3, contextWindowTokens: 16384, providerHeadroomTokens: lowReserve.providerHeadroomTokens
  });
  const highReserveBudget = resolveMemoryBudget({
    participantCount: 3, contextWindowTokens: 16384, providerHeadroomTokens: highReserve.providerHeadroomTokens
  });
  assert(highReserve.plan.reservedOutputTokens > lowReserve.plan.reservedOutputTokens);
  assert(highReserveBudget.memoryBudgetTokens < lowReserveBudget.memoryBudgetTokens,
    "a higher output reserve must reduce memory headroom before the request is sent");

  const lowHeadroomInput = [{ role: "system", content: "V936_LONG_WORLDLINE_".repeat(2100) }];
  const lowHeadroom = nonMemoryPlan({ contextWindow: 16384, outputReserve: 2048, messages: lowHeadroomInput });
  const lowHeadroomBudget = resolveMemoryBudget({
    participantCount: 3,
    contextWindowTokens: 16384,
    providerHeadroomTokens: lowHeadroom.providerHeadroomTokens
  });
  assert(lowHeadroom.plan.safe && lowHeadroom.providerHeadroomTokens > 0);
  assert(lowHeadroom.providerHeadroomTokens < 2949, "fixture must exercise Provider headroom below the tier policy budget");
  assert.equal(lowHeadroomBudget.memoryBudgetTokens, lowHeadroom.providerHeadroomTokens,
    "providerHeadroom is already margin-adjusted and must not be reduced a second time");
  return {
    tk02: {
      contextWindowTokens: 16384,
      participantCount: 3,
      nonMemoryInputEstimate: ordinary.plan.estimatedInputTokens,
      reservedOutputTokens: ordinary.plan.reservedOutputTokens,
      safetyMarginTokens: ordinary.plan.safetyMarginTokens,
      protocolOverheadTokens: ordinary.plan.protocolOverheadTokens,
      providerHeadroomTokens: ordinary.providerHeadroomTokens,
      policyBudgetTokens: tk02.policyBudgetTokens,
      memoryBudgetTokens: tk02.memoryBudgetTokens
    },
    tk05: {
      lowReserveTokens: lowReserve.plan.reservedOutputTokens,
      lowReserveMemoryBudgetTokens: lowReserveBudget.memoryBudgetTokens,
      highReserveTokens: highReserve.plan.reservedOutputTokens,
      highReserveMemoryBudgetTokens: highReserveBudget.memoryBudgetTokens
    },
    lowHeadroom: {
      providerHeadroomTokens: lowHeadroom.providerHeadroomTokens,
      memoryBudgetTokens: lowHeadroomBudget.memoryBudgetTokens,
      policyBudgetTokens: lowHeadroomBudget.policyBudgetTokens
    }
  };
}

function assertActualPromptFormats() {
  const layouts = [];
  for (const layout of ["normal", "glm", "v813"]) {
    const result = buildPrompt(layout);
    const blocks = memoryBlocks(result.promptBuild);
    for (const id of ["memory-official-recollection", "memory-direct-frozen", "memory-player-ledger-frozen"]) {
      assert.equal(blocks.filter(entry => entry.block.id === id).length, 1,
        `${layout} must render each Official, Recent1, and PlayerLedger fixed slot once`);
    }
    assert(result.memoryTokens > 0);
    assert(result.metadata.blocks.filter(block => block.id.startsWith("memory-")
      && block.id !== "memory-topic-patch").every(block => Number.isSafeInteger(block.messageStartPosition) && block.messageCount > 0),
    `${layout} must produce real mapped PromptBuilder/Conversation memory spans`);
    layouts.push({
      layout,
      messageCount: result.promptBuild.messages.length,
      memoryBlockCount: blocks.length,
      renderedMemoryTokens: result.memoryTokens,
      fixedBlocks: ["memory-official-recollection", "memory-direct-frozen", "memory-player-ledger-frozen"]
    });
  }

  const engineFormatted = formatEntryBlock("TK07 格式化标题：谈话证据", [{ memory: {
    type: "conversation", subtype: "event", epistemicStatus: "KNOWN", eventDate: "1200.1.1",
    content: "TK07_SOURCE_EVIDENCE: NPC-B promised to return the book."
  } }]);
  assert(engineFormatted.includes("TK07 格式化标题：谈话证据"));
  assert(engineFormatted.includes("1200.1.1"));
  assert(engineFormatted.includes("TK07_SOURCE_EVIDENCE"));
  const formattedTokens = TokenCounter.estimateMessageTokens({ role: "system", content: engineFormatted }) + 8;
  const onlyRawEvidenceTokens = TokenCounter.estimateTokens("TK07_SOURCE_EVIDENCE");
  const formattedMemoryTokens = PromptBuilder.getMemoryBlockTokenCount({ blocks: [{
    block: { id: "memory-player-ledger-frozen", type: "memory_player_ledger_frozen" },
    content: engineFormatted,
    tokens: onlyRawEvidenceTokens
  }] });
  assert.equal(formattedMemoryTokens, formattedTokens,
    "the production PromptBuilder helper must count the final title/date/evidence formatting and per-message overhead");
  assert(formattedMemoryTokens > onlyRawEvidenceTokens + 8,
    "formatted TokenCount must include title, date, labels, and evidence beyond raw entry tokens");

  const ledgerEntries = Array.from({ length: 16 }, (_, index) => ({ memory: {
    type: "conversation", subtype: "event", epistemicStatus: "KNOWN", eventDate: `11${String(index).padStart(2, "0")}.1.1`,
    content: `TK08_LEDGER_ITEM_${String(index + 1).padStart(2, "0")}: a confirmed promise and outcome.`
  } }));
  const fullLegacyOne = `TK08_FULL_LEGACY_ORIGINAL_ONE ${"complete original source detail ".repeat(20)}`;
  const fullLegacyTwo = `TK08_FULL_LEGACY_ORIGINAL_TWO ${"complete original source detail ".repeat(20)}`;
  const tk08Context = makeMemoryContext({
    playerLedgerFrozenText: formatEntryBlock("TK08 玩家长期事项（16条）", ledgerEntries),
    temporalExtraText: `TK08 时间召回完整摘要：\n${fullLegacyOne}`,
    turnRecallText: `TK08 历史回查完整摘要：\n${fullLegacyTwo}`
  });
  const tk08 = buildPrompt("normal", tk08Context);
  assert(tk08.memoryTokens <= 1310,
    "16 ledger matters and two complete Legacy originals must share the 8K/2 aggregate memory budget");
  const tk08Text = memoryBlocks(tk08.promptBuild).map(entry => entry.content).join("\n");
  for (let index = 1; index <= 16; index += 1) {
    assert(tk08Text.includes(`TK08_LEDGER_ITEM_${String(index).padStart(2, "0")}`),
      `the fitting 8K fixture must retain ledger item ${index}`);
  }
  assert(tk08Text.includes(fullLegacyOne) && tk08Text.includes(fullLegacyTwo),
    "both complete source summaries must be present in the same aggregate memory count");
  return {
    layouts,
    tk07: {
      formattedTextTokens: formattedMemoryTokens,
      rawEvidenceTokens: onlyRawEvidenceTokens,
      includesTitleDateEvidence: true
    },
    tk08: {
      contextWindowTokens: 8192,
      participantCount: 2,
      budgetTokens: 1310,
      renderedMemoryTokens: tk08.memoryTokens,
      ledgerItemCount: ledgerEntries.length,
      completeLegacyOriginalCount: 2
    }
  };
}

function assertFixedBytesAndOverflow() {
  const memoryContext = makeMemoryContext();
  const first = buildPrompt("v813", memoryContext);
  const fixedIds = ["memory-official-recollection", "memory-direct-frozen", "memory-player-ledger-frozen"];
  const fixedBytes = Object.fromEntries(fixedIds.map(id => [id,
    first.promptBuild.blocks.find(entry => entry.block.id === id)?.content || null]));
  assert(Object.values(fixedBytes).every(Boolean), "V813 fixture must have all fixed memory block bytes");

  memoryContext.temporalExtraText = "V936_DYNAMIC_TURN_CHANGED_WITHIN_SAME_MEMORY_SCOPE";
  const second = buildPrompt("v813", memoryContext);
  for (const id of fixedIds) {
    assert.equal(second.promptBuild.blocks.find(entry => entry.block.id === id)?.content, fixedBytes[id],
      "same source/player/session scope must reuse identical fixed block bytes");
  }
  assert(memoryBlocks(second.promptBuild).some(entry => entry.content.includes("V936_DYNAMIC_TURN_CHANGED_WITHIN_SAME_MEMORY_SCOPE")),
    "dynamic turn material must still update when fixed-scope bytes are reused");

  memoryContext.sourceFolderRevision += 1;
  memoryContext.baselineSnapshotId = "v936-baseline-snapshot-b";
  memoryContext.officialRecollectionText = "V936_REVISED_OFFICIAL_AFTER_SOURCE_REVISION";
  memoryContext.directStableText = "V936_REVISED_RECENT1_AFTER_SOURCE_REVISION";
  memoryContext.playerLedgerFrozenText = "V936_REVISED_LEDGER_AFTER_SOURCE_REVISION";
  const revised = buildPrompt("v813", memoryContext);
  for (const [id, marker] of [
    ["memory-official-recollection", "V936_REVISED_OFFICIAL_AFTER_SOURCE_REVISION"],
    ["memory-direct-frozen", "V936_REVISED_RECENT1_AFTER_SOURCE_REVISION"],
    ["memory-player-ledger-frozen", "V936_REVISED_LEDGER_AFTER_SOURCE_REVISION"]
  ]) {
    assert.equal(revised.promptBuild.blocks.find(entry => entry.block.id === id)?.content, marker,
      `source revision change must invalidate ${id} frozen bytes`);
  }

  const longHistory = [{ role: "system", content: `V936_LONG_HISTORY_WORLDLINE_${"x".repeat(70000)}` }];
  const longPlan = nonMemoryPlan({ contextWindow: 8192, outputReserve: 2048, messages: longHistory });
  assert.equal(longPlan.plan.safe, false,
    "TK06 long history/worldline must be detected as exceeding the final request budget");
  return {
    fixedBytesSameScope: true,
    sourceScopeRevisionInvalidatesAllFixedBlocks: true,
    tk06: {
      contextWindowTokens: 8192,
      longPromptEstimatedInputTokens: longPlan.plan.estimatedInputTokens,
      effectiveInputBudget: longPlan.plan.effectiveInputBudget,
      safe: longPlan.plan.safe,
      providerFinalGuardRegression: "scripts/test-v9.3.6-provider-memory-budget.js",
      duplicateBackgroundRequest: "NOT_MEASURED_OFFLINE"
    }
  };
}

function main() {
  const report = {
    suite: "V9.3.6 offline memory-token comparison",
    measurementMode: "deterministic local estimate; no real Provider calls, billed usage, cache-hit telemetry, or cost data",
    policyGrid: assertPolicyMatrix(),
    headroom: assertHeadroomAndOutputReserve(),
    promptFormatting: assertActualPromptFormats(),
    fixedScopeAndOverflow: assertFixedBytesAndOverflow(),
    tk01: {
      status: "OFFLINE_RENDERED_BOUNDARY_PASS",
      note: "8K/2 policy and all three actual PromptBuilder fixed blocks are measured together; source-specific Recent1/Official clipping remains covered by the production memory fitting path, not simulated here."
    },
    tk03: { status: "PASS", hardCapTokens: 6400, contextWindowTokens: 32768, participantTier: "4+" },
    tk04: { status: "PASS", hardCapTokens: 6400, contextWindowTokens: 131072, participantTier: "4+", dynamicExtrasRemainInAggregateCount: true },
    tk09: {
      status: "NOT_MEASURED",
      requirement: "20-30 turn and 80-100 turn soak comparing tokens, cache, latency, CPU/IO, and roleplay continuity",
      evidenceNeeded: "real packaged-runtime soak with reproducible fixtures and provider observations"
    },
    tk10: {
      status: "NOT_MEASURED",
      requirement: "old versus new same-scene real Provider Usage comparison",
      evidenceNeeded: "actual provider-reported input, cached input, and output usage; estimates are not billed usage"
    },
    offlineCrossTestEvidence: {
      tk06FinalProviderGuard: "scripts/test-v9.3.6-provider-memory-budget.js",
      actualThreeLayoutFinalProviderGuard: "scripts/test-v9.3.6-provider-memory-budget.js",
      conversationDryRunAndHeadroom: "scripts/test-v9.3.6-conversation-budget.js",
      ledgerBudgetFitting: "scripts/test-v9.3.6-player-baseline-ledger.js"
    }
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
