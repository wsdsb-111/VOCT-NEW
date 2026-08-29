"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const { LegacyActionEngineV3: ActionEngine } = require(path.join(root, "resources", "app", "out", "main", "action-system", "action-engine"));

const player = { id: 1, fullName: "玩家", shortName: "玩家" };
const gameData = {
  playerID: player.id,
  playerName: player.fullName,
  characters: new Map([[player.id, player]])
};
const actionId = "traceAutoAction";
const loadedAction = {
  id: actionId,
  filePath: "trace-test",
  validation: { valid: true },
  definition: {
    signature: actionId,
    triggerCategories: ["trace"],
    semantic: { riskLevel: "low" },
    title: { zh: "Trace action" },
    description: "Trace action",
    args: [],
    check: async () => ({ canExecute: true, requiresTarget: false, validTargetCharacterIds: [] })
  }
};
const registry = {
  getActionIdsForCategories: () => new Set([actionId]),
  getAllActions: () => [loadedAction],
  getById: (id) => id === actionId ? loadedAction : null,
  getEffectiveDestructive: () => false,
  getEffectiveRiskLevel: () => "low",
  hasDestructiveOverride: () => false,
  shouldRequireApproval: () => false,
  registerValidation: () => {}
};
const actionSandbox = {
  executeAction: async (_filePath, context) => {
    context.runGameEffect("trace_effect");
    return { message: "done", sentiment: "neutral" };
  }
};

ActionEngine.configure({
  actionEngineVersion: 3,
  actionRegistry: registry,
  settingsRepository: {
    getLanguage: () => "zh",
    getActionsProviderConfig: () => ({ useMinimizedActionsSchema: true }),
    getActionApprovalSettings: () => ({ approvalMode: "all" })
  },
  usageAnalytics: { record: () => {} },
  llmManager: {
    sendActionsRequest: async () => ({ content: JSON.stringify({ actions: [{ actionId, args: {} }] }) })
  },
  ActionPromptBuilder: {
    buildActionMessages: () => [],
    getActionPromptBlocks: () => []
  },
  ActionSandbox: actionSandbox,
  ActionEffectWriter: { writeEffect: () => {} },
  buildStructuredResponseJsonSchema: () => ({}),
  buildStructuredResponseSchema: () => ({ parse: (value) => value }),
  healJsonResponseWithLogging: (content) => JSON.parse(content),
  resolveI18nString: (value) => typeof value === "object" ? value.zh || value.en : value,
  logVerboseLLM: () => {}
});

const originalShouldEvaluate = ActionEngine.shouldEvaluateForMessage;
const originalReferenceContext = ActionEngine.getConversationReferenceContext;
const originalParticipantResolution = ActionEngine.resolveEventParticipants;
const originalTraceDecision = ActionEngine.traceDecision;
const originalConsoleError = console.error;
const traces = [];

ActionEngine.shouldEvaluateForMessage = (_conversation, _message, event) => ({
  shouldEvaluate: true,
  reason: "trace",
  reasons: ["trace"],
  dedupeKey: event.eventId,
  semanticProfile: { allowedActionIds: [actionId], resolutionMode: "resolved" }
});
ActionEngine.getConversationReferenceContext = () => ({});
ActionEngine.resolveEventParticipants = ({ event, speaker }) => {
  const binding = actionSystem.createParticipantBinding({
    messageId: 1,
    eventId: event.eventId,
    traceId: event.traceId,
    actionId,
    sourceCharacterId: speaker.id,
    references: []
  });
  return { mode: "resolved", sourceCharacter: speaker, targetCharacter: null, binding };
};
ActionEngine.traceDecision = (traceActionId, stage, outcome, details = {}) => {
  traces.push({ actionId: traceActionId, stage, outcome, ...details });
};

async function evaluate(eventId) {
  return ActionEngine.evaluateForCharacter({ gameData, actionGateProcessedTriggers: new Set(), messages: [] }, player, null, {
    id: 1,
    role: "user",
    name: player.fullName,
    content: "测试动作"
  }, {
    eventId,
    traceId: `action:${eventId}`,
    category: "trace",
    evidence: { text: "测试动作", start: 0, end: 4 }
  });
}

(async () => {
  try {
    const success = await evaluate("success");
    assert.strictEqual(success.autoApproved.length, 1);
    assert.deepStrictEqual(
      traces.filter((trace) => trace.stage === "execution").map((trace) => trace.outcome),
      ["success", "effect_written"],
      "auto-approved success must be traced only by runInvocation"
    );

    traces.length = 0;
    actionSandbox.executeAction = async () => { throw new Error("trace failure"); };
    console.error = () => {};
    const failure = await evaluate("failure");
    console.error = originalConsoleError;
    assert.strictEqual(failure.autoApproved.length, 1);
    assert.deepStrictEqual(
      traces.filter((trace) => trace.stage === "execution").map((trace) => trace.outcome),
      ["failed"],
      "auto-approved failure must be traced only by runInvocation"
    );
    console.log("VOTC v6.9.1 follow-up trace dedup: PASS (single execution owner)");
  } finally {
    ActionEngine.shouldEvaluateForMessage = originalShouldEvaluate;
    ActionEngine.getConversationReferenceContext = originalReferenceContext;
    ActionEngine.resolveEventParticipants = originalParticipantResolution;
    ActionEngine.traceDecision = originalTraceDecision;
    console.error = originalConsoleError;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
