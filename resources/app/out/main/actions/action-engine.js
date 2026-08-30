"use strict";

function createActionEngine({ actionRegistry, settingsRepository, llmManager, ActionPromptBuilder, ActionSandbox, ActionEffectWriter, buildStructuredResponseJsonSchema, buildStructuredResponseSchema, healJsonResponseWithLogging, resolveI18nString, logVerboseLLM }) {
  return class ActionEngine {
    static async evaluateForCharacter(conv, npc, signal) {
      try {
        if (signal?.aborted) return { autoApproved: [], needsApproval: [] };
        const userLang = settingsRepository.getLanguage();
        const loaded = actionRegistry.getAllActions(false);
        const available = [];
        for (const action of loaded) {
          if (signal?.aborted) return { autoApproved: [], needsApproval: [] };
          try {
            const checkResult = await action.definition.check({ gameData: conv.gameData, sourceCharacter: npc });
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
            actionRegistry.registerValidation(action.id, { valid: false, message: `check() threw: ${error instanceof Error ? error.message : String(error)}` });
          }
        }
        if (available.length === 0) return { autoApproved: [], needsApproval: [] };
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
        if (!content || typeof content !== "string" || signal?.aborted) return { autoApproved: [], needsApproval: [] };
        let parsed;
        try {
          const maybeJson = healJsonResponseWithLogging(content, "ActionEngine", logVerboseLLM);
          if (!maybeJson) return { autoApproved: [], needsApproval: [] };
          parsed = zodSchema.parse(maybeJson);
        } catch {
          return { autoApproved: [], needsApproval: [] };
        }
        if (!parsed || !Array.isArray(parsed.actions) || parsed.actions.length === 0) {
          console.log("[ActionEngine] No actions to process");
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
              invocation
            });
          } else {
            autoApproved.push(await this.runInvocation(conv, npc, invocation));
          }
        }
        return { autoApproved, needsApproval };
      } catch (error) {
        if (!signal?.aborted) console.error("ActionEngine error:", error);
        return { autoApproved: [], needsApproval: [] };
      }
    }

    static async runInvocation(conv, npc, invocation, options) {
      const loaded = actionRegistry.getById(invocation.actionId);
      if (!loaded || !loaded.validation.valid) return { actionId: invocation.actionId, success: false, error: "Action not found or invalid" };
      const targetId = invocation.targetCharacterId ?? null;
      const target = targetId != null ? conv.gameData.characters.get(targetId) ?? undefined : undefined;
      const userLang = settingsRepository.getLanguage();
      const runGameEffect = (effectBody) => {
        if (!options?.dryRun) ActionEffectWriter.writeEffect(conv.gameData, npc.id, targetId, effectBody);
      };
      try {
        const result = await ActionSandbox.executeAction(loaded.filePath, {
          gameData: conv.gameData,
          sourceCharacter: npc,
          targetCharacter: target,
          runGameEffect,
          args: invocation.args ?? {},
          conversation: conv,
          dryRun: options?.dryRun,
          lang: userLang
        });
        let feedback;
        if (result) {
          if (typeof result === "string") feedback = { message: result, sentiment: "neutral" };
          else if (typeof result === "object") {
            feedback = "message" in result ? { message: resolveI18nString(result.message, userLang), sentiment: result.sentiment || "neutral" } : { message: resolveI18nString(result, userLang), sentiment: "neutral" };
          }
        }
        return { actionId: invocation.actionId, success: true, feedback };
      } catch (error) {
        console.error(`Action ${invocation.actionId} failed:`, error);
        return { actionId: invocation.actionId, success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  };
}

module.exports = { createActionEngine };
