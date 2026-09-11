"use strict";

const { CriticalActionRecallObserver: DefaultCriticalActionRecallObserver } = require("./critical-action-recall-diagnostics");
const { ACTION_LIFECYCLE_STATUSES, createActionLifecycle, createActionDiagnostic } = require("./types");
const { captureActionConfirmation, detectActionArgumentDrift, extractRequestedActionArgs } = require("./action-confirmation");

function createActionEngine({ actionRegistry, settingsRepository, usageAnalytics, llmManager, ActionPromptBuilder, ActionSandbox, ActionEffectWriter, CriticalActionRecallObserver = DefaultCriticalActionRecallObserver, buildStructuredResponseJsonSchema, buildStructuredResponseSchema, healJsonResponseWithLogging, resolveI18nString, logVerboseLLM }) {
  return class ActionEngine {
    static async evaluateForCharacter(conv, npc, signal) {
      let diagnosticsObserver = null;
      let diagnosticsRecorded = false;
      const observeDiagnostics = (method, ...args) => {
        try {
          diagnosticsObserver?.[method]?.(...args);
        } catch (error) {
          console.warn(`[ActionRecallDiagnostics] ${method} failed:`, error);
        }
      };
      const recordDiagnostics = (evaluationStatus, selectedInvocations = [], autoApproved = [], needsApproval = []) => {
        if (!diagnosticsObserver || diagnosticsRecorded || signal?.aborted) return;
        diagnosticsRecorded = true;
        try {
          const actionsConfig = settingsRepository.getActionsProviderConfig();
          const overlayEnabled = actionsConfig?.deepseekActionStateTransitionRecallOverlay === true;
          const stablePrefixEnabled = actionsConfig?.deepseekActionStablePrefixOptimization === true;
          const actionExperimentStage = !overlayEnabled && !stablePrefixEnabled ? "A" : overlayEnabled && !stablePrefixEnabled ? "B" : overlayEnabled && stablePrefixEnabled ? "C" : "CUSTOM_STABLE_ONLY";
          usageAnalytics?.record({
            requestType: "action_recall_diagnostic",
            character: npc.shortName,
            characterId: npc.id,
            actionRecallEvaluationStatus: evaluationStatus,
            actionExperimentStage,
            deepseekActionStateTransitionRecallOverlay: overlayEnabled,
            deepseekActionStablePrefixOptimization: stablePrefixEnabled,
            criticalActionDiagnostics: diagnosticsObserver.build({ selectedInvocations, autoApproved, needsApproval, evaluationStatus })
          }, null);
        } catch (error) {
          console.warn("[ActionRecallDiagnostics] record failed:", error);
        }
      };
      try {
        if (signal?.aborted) return { autoApproved: [], needsApproval: [] };
        const userLang = settingsRepository.getLanguage();
        const loaded = actionRegistry.getAllActions(false);
        try {
          diagnosticsObserver = new CriticalActionRecallObserver(npc, conv.gameData);
          observeDiagnostics("observeMissingActions", loaded.map((action) => action.id));
        } catch (error) {
          console.warn("[ActionRecallDiagnostics] initialization failed:", error);
          diagnosticsObserver = null;
        }
        const available = [];
        for (const action of loaded) {
          if (signal?.aborted) return { autoApproved: [], needsApproval: [] };
          try {
            const checkResult = await action.definition.check({ gameData: conv.gameData, sourceCharacter: npc });
            observeDiagnostics("observeCheck", action.id, checkResult);
            if (!checkResult?.canExecute) continue;
            const requiresTarget = !!(checkResult.validTargetCharacterIds && checkResult.validTargetCharacterIds.length > 0);
            const args = typeof action.definition.args === "function" ? action.definition.args({ gameData: conv.gameData, sourceCharacter: npc }) : action.definition.args;
            const resolvedArgs = args.map((arg) => ({ ...arg, description: resolveI18nString(arg.description, userLang) }));
            const descriptionValue = typeof action.definition.description === "function" ? action.definition.description({ gameData: conv.gameData, sourceCharacter: npc }) : action.definition.description;
            available.push({
              signature: action.id,
              args: resolvedArgs,
              requiresTarget,
              validTargetCharacterIds: checkResult.validTargetCharacterIds,
              description: resolveI18nString(descriptionValue, userLang)
            });
          } catch (error) {
            observeDiagnostics("observeCheckFailure", action.id);
            actionRegistry.registerValidation(action.id, { valid: false, message: `check() threw: ${error instanceof Error ? error.message : String(error)}` });
          }
        }
        if (available.length === 0) {
          recordDiagnostics("no_available_action");
          return { autoApproved: [], needsApproval: [] };
        }
        if (signal?.aborted) return { autoApproved: [], needsApproval: [] };
        const messages = ActionPromptBuilder.buildActionMessages(conv, npc, available);
        const actionsConfig = settingsRepository.getActionsProviderConfig();
        const useMinimizedSchema = actionsConfig?.useMinimizedActionsSchema !== undefined ? actionsConfig.useMinimizedActionsSchema : actionsConfig?.defaultModel?.toLowerCase().includes("gemini") ?? false;
        console.log(`[DEBUG] ActionEngine: Using minimized schema: ${useMinimizedSchema}`);
        const jsonSchema = buildStructuredResponseJsonSchema({ availableActions: available }, useMinimizedSchema);
        const zodSchema = buildStructuredResponseSchema({ availableActions: available });
        const output = await llmManager.sendActionsRequest(messages, "votc_actions", jsonSchema, signal);
        if (signal?.aborted) return { autoApproved: [], needsApproval: [] };
        const result = await output;
        const content = result && typeof result === "object" ? result.content : null;
        console.log("[DEBUG] ActionEngine: Received LLM response", content);
        if (!content || typeof content !== "string" || signal?.aborted) {
          recordDiagnostics("empty_response");
          return { autoApproved: [], needsApproval: [] };
        }
        let parsed;
        try {
          const maybeJson = healJsonResponseWithLogging(content, "ActionEngine", logVerboseLLM);
          if (!maybeJson) {
            recordDiagnostics("invalid_json");
            return { autoApproved: [], needsApproval: [] };
          }
          parsed = zodSchema.parse(maybeJson);
        } catch {
          recordDiagnostics("invalid_schema");
          return { autoApproved: [], needsApproval: [] };
        }
        if (!parsed || !Array.isArray(parsed.actions) || parsed.actions.length === 0) {
          console.log("[ActionEngine] No actions to process");
          recordDiagnostics("no_action_selected");
          return { autoApproved: [], needsApproval: [] };
        }
        if (signal?.aborted) return { autoApproved: [], needsApproval: [] };
        const approvalSettings = settingsRepository.getActionApprovalSettings();
        const autoApproved = [];
        const needsApproval = [];
        for (const invocation of parsed.actions) {
          if (signal?.aborted) break;
          const loadedAction = actionRegistry.getById(invocation.actionId);
          if (!loadedAction || !loadedAction.validation.valid) continue;
          const isDestructive = actionRegistry.getEffectiveDestructive(invocation.actionId);
          let needsUserApproval = false;
          switch (approvalSettings.approvalMode) {
            case "none":
              needsUserApproval = true;
              break;
            case "non-destructive":
              needsUserApproval = isDestructive;
              break;
            case "all":
              needsUserApproval = false;
              break;
          }
          if (needsUserApproval) {
            const targetId = invocation.targetCharacterId ?? null;
            const target = targetId != null ? conv.gameData.characters.get(targetId) ?? undefined : undefined;
            needsApproval.push({
              actionId: invocation.actionId,
              actionTitle: loadedAction.definition.title ? resolveI18nString(loadedAction.definition.title, userLang) : undefined,
              sourceCharacterId: npc.id,
              sourceCharacterName: npc.shortName,
              targetCharacterId: targetId ?? undefined,
              targetCharacterName: target?.shortName,
              args: invocation.args ?? {},
              isDestructive,
              invocation,
              lifecycle: createActionLifecycle({ selected: true, validated: true, confirmed: false, status: ACTION_LIFECYCLE_STATUSES.PENDING_APPROVAL }),
              diagnostic: createActionDiagnostic({
                actionId: invocation.actionId,
                sourceRuntimeId: npc.id,
                targetRuntimeId: targetId,
                args: invocation.args ?? {},
                selectedArgs: invocation.args ?? {},
                dispatchStatus: "NOT_DISPATCHED",
                confirmationStatus: "NOT_STARTED",
                revisionBefore: conv.gameData?.revision ?? conv.gameData?.gameDataRevision ?? null
              })
            });
          } else {
            autoApproved.push(await this.runInvocation(conv, npc, invocation));
          }
        }
        recordDiagnostics("completed", parsed.actions, autoApproved, needsApproval);
        return { autoApproved, needsApproval };
      } catch (error) {
        if (!signal?.aborted) console.error("ActionEngine error:", error);
        recordDiagnostics("engine_error");
        return { autoApproved: [], needsApproval: [] };
      }
    }

    static async runInvocation(conv, npc, invocation, options) {
      const loaded = actionRegistry.getById(invocation.actionId);
      if (!loaded || !loaded.validation.valid) return { actionId: invocation.actionId, success: false, error: "Action not found or invalid" };
      const targetId = invocation.targetCharacterId ?? null;
      const target = targetId != null ? conv.gameData.characters.get(targetId) ?? undefined : undefined;
      const userLang = settingsRepository.getLanguage();
      const dispatchSourceId = invocation.actionId === "playerPaysGoldTo" ? conv.gameData.playerID : npc.id;
      const dispatchRecords = [];
      const selectedArgs = invocation.args ?? {};
      const requestedArgs = invocation.requestedArgs ?? extractRequestedActionArgs(invocation.actionId, conv.getHistory?.() || conv.messages || []);
      const argumentDrift = detectActionArgumentDrift(requestedArgs, selectedArgs);
      const executionArgs = argumentDrift ? { ...selectedArgs, amount: argumentDrift.requestedAmount } : selectedArgs;
      const runGameEffect = (effectBody) => {
        if (options?.dryRun) return { status: "NOT_DISPATCHED" };
        try {
          const result = ActionEffectWriter.writeEffect(conv.gameData, dispatchSourceId, targetId, effectBody);
          if (!result?.commandId || !["queued", "awaiting_ack"].includes(result.status)) throw new Error(`action_effect_dispatch_failed:${result?.status || "no_result"}`);
          dispatchRecords.push({ status: result?.status || "WRITTEN", ...result });
          return result;
        } catch (error) {
          dispatchRecords.push({ status: "FAILED" });
          throw error;
        }
      };
      try {
        const result = await ActionSandbox.executeAction(loaded.filePath, {
          gameData: conv.gameData,
          sourceCharacter: npc,
          targetCharacter: target,
          runGameEffect,
          args: executionArgs,
          conversation: conv,
          dryRun: options?.dryRun,
          lang: userLang
        });
        let feedback;
        if (result) {
          if (typeof result === "string") feedback = { message: result, sentiment: "neutral" };
          else if (typeof result === "object") {
            feedback = "message" in result ? { message: resolveI18nString(result.message, userLang), confirmedMessage: result.confirmedMessage ? resolveI18nString(result.confirmedMessage, userLang) : null, sentiment: result.sentiment || "neutral" } : { message: resolveI18nString(result, userLang), sentiment: "neutral" };
          }
        }
        const dispatched = dispatchRecords.length > 0;
        const expectedStateChange = result && typeof result === "object" ? result.expectedStateChange ?? null : null;
        const validationFailed = !dispatched && result && typeof result === "object" && result.sentiment === "negative";
        const confirmation = !options?.dryRun && dispatched ? captureActionConfirmation({
          actionId: invocation.actionId,
          expectedStateChange,
          gameData: conv.gameData,
          gameDataRevision: conv.gameDataRevision ?? conv.gameData?.revision ?? conv.gameData?.gameDataRevision ?? null,
          dispatch: dispatchRecords.at(-1)
        }) : null;
        const requiresConfirmation = confirmation !== null;
        const lifecycle = createActionLifecycle({
          selected: true,
          validated: true,
          dispatched,
          confirmed: false,
          status: options?.dryRun ? ACTION_LIFECYCLE_STATUSES.VALIDATED : validationFailed ? ACTION_LIFECYCLE_STATUSES.VALIDATION_FAILED : requiresConfirmation ? ACTION_LIFECYCLE_STATUSES.DISPATCHED : ACTION_LIFECYCLE_STATUSES.NO_EFFECT
        });
        const diagnostic = createActionDiagnostic({
          actionId: invocation.actionId,
          sourceRuntimeId: expectedStateChange?.sourceRuntimeId ?? dispatchSourceId,
          targetRuntimeId: targetId,
          args: executionArgs,
          selectedArgs,
          effectiveArgs: executionArgs,
          dispatchStatus: options?.dryRun ? "NOT_DISPATCHED" : dispatchRecords.at(-1)?.status || "NOT_REQUIRED",
          confirmationStatus: options?.dryRun ? "PREVIEW_ONLY" : validationFailed ? "NOT_CONFIRMED" : requiresConfirmation ? "PENDING_CONFIRMATION" : "NOT_REQUIRED",
          revisionBefore: conv.gameDataRevision ?? conv.gameData?.revision ?? conv.gameData?.gameDataRevision ?? null,
          stateBefore: confirmation?.before || null,
          expectedStateChange,
          requestedArgs,
          commandId: confirmation?.dispatch?.commandId || null,
          commandStatus: confirmation?.dispatch?.status || null,
          dispatchEvidence: confirmation?.dispatch || dispatchRecords.at(-1) || null,
          argumentDrift
        });
        return { actionId: invocation.actionId, success: !requiresConfirmation && !validationFailed, feedback, lifecycle, diagnostic, confirmation };
      } catch (error) {
        console.error(`Action ${invocation.actionId} failed:`, error);
        const dispatched = dispatchRecords.length > 0;
        return {
          actionId: invocation.actionId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          lifecycle: createActionLifecycle({ selected: true, validated: true, dispatched, confirmed: false, status: dispatched ? ACTION_LIFECYCLE_STATUSES.DISPATCH_FAILED : ACTION_LIFECYCLE_STATUSES.VALIDATION_FAILED }),
          diagnostic: createActionDiagnostic({
            actionId: invocation.actionId,
            sourceRuntimeId: dispatchSourceId,
            targetRuntimeId: targetId,
            args: executionArgs,
            selectedArgs,
            effectiveArgs: executionArgs,
            dispatchStatus: dispatched ? "FAILED" : "NOT_DISPATCHED",
            confirmationStatus: "NOT_CONFIRMED",
            revisionBefore: conv.gameData?.revision ?? conv.gameData?.gameDataRevision ?? null,
            requestedArgs,
            argumentDrift
          })
        };
      }
    }
  };
}

module.exports = { createActionEngine };
