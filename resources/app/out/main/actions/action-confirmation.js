"use strict";

const { ACTION_LIFECYCLE_STATUSES, createActionLifecycle, createActionDiagnostic } = require("./types");

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readGold(gameData, runtimeId) {
  const character = gameData?.characters?.get(Number(runtimeId));
  return numberOrNull(character?.income?.gold ?? character?.gold);
}

function extractRequestedActionArgs(actionId, history = []) {
  if (!new Set(["paysGoldTo", "playerPaysGoldTo"]).has(actionId)) return null;
  const latestUserText = [...(Array.isArray(history) ? history : [])].reverse().find((entry) => entry?.role === "user")?.content;
  if (typeof latestUserText !== "string") return null;
  const amountToken = "([0-9][0-9,]*(?:\\.[0-9]+)?)";
  const paymentVerb = "(?:给|付给|支付|赠予|赠给|赏给|交给|转给|送给|拿出|pay|give|gift|transfer)";
  const match = latestUserText.match(new RegExp(`${paymentVerb}.{0,24}?${amountToken}`, "i"));
  const amount = numberOrNull(match?.[1]?.replace(/,/g, ""));
  return amount !== null && amount > 0 ? { amount: Math.floor(amount) } : null;
}

function captureActionConfirmation({ actionId, expectedStateChange, gameData, gameDataRevision, dispatch = null } = {}) {
  if (!expectedStateChange || expectedStateChange.type !== "GOLD_TRANSFER") return null;
  const sourceRuntimeId = Number(expectedStateChange.sourceRuntimeId);
  const targetRuntimeId = Number(expectedStateChange.targetRuntimeId);
  const amount = numberOrNull(expectedStateChange.amount);
  const sourceGold = readGold(gameData, sourceRuntimeId);
  const targetGold = readGold(gameData, targetRuntimeId);
  if (!Number.isFinite(sourceRuntimeId) || !Number.isFinite(targetRuntimeId) || amount === null || sourceGold === null || targetGold === null) return null;
  return {
    actionId,
    type: "GOLD_TRANSFER",
    sourceRuntimeId,
    targetRuntimeId,
    amount,
    before: { sourceGold, targetGold, gameDataRevision: numberOrNull(gameDataRevision) },
    dispatch: dispatch ? {
      commandId: dispatch.commandId || null,
      status: dispatch.status || null,
      sourceIndex: numberOrNull(dispatch.sourceIndex),
      targetIndex: numberOrNull(dispatch.targetIndex),
      effectBody: dispatch.effectBody || null,
      writtenAt: dispatch.writtenAt ?? dispatch.lastWrittenAt ?? null,
      queuedAt: dispatch.queuedAt ?? null,
      writeAttempts: numberOrNull(dispatch.writeAttempts)
    } : null
  };
}

function verifyActionConfirmation({ confirmation, gameData, gameDataRevision } = {}) {
  if (!confirmation) return { status: ACTION_LIFECYCLE_STATUSES.UNCONFIRMED, stateAfter: null, confirmedStateChange: null };
  const revisionAfter = numberOrNull(gameDataRevision);
  const revisionBefore = numberOrNull(confirmation.before?.gameDataRevision);
  if (revisionBefore !== null && (revisionAfter === null || revisionAfter <= revisionBefore)) {
    return { status: "PENDING", stateAfter: null, confirmedStateChange: null, revisionAfter };
  }
  const sourceGold = readGold(gameData, confirmation.sourceRuntimeId);
  const targetGold = readGold(gameData, confirmation.targetRuntimeId);
  const stateAfter = { sourceGold, targetGold };
  if (sourceGold === null || targetGold === null) return { status: ACTION_LIFECYCLE_STATUSES.UNCONFIRMED, stateAfter, confirmedStateChange: null, revisionAfter };
  const sourceMatches = sourceGold === confirmation.before.sourceGold - confirmation.amount;
  const targetMatches = targetGold === confirmation.before.targetGold + confirmation.amount;
  if (sourceMatches && targetMatches) {
    return {
      status: ACTION_LIFECYCLE_STATUSES.CONFIRMED,
      stateAfter,
      revisionAfter,
      confirmedStateChange: { type: confirmation.type, sourceRuntimeId: confirmation.sourceRuntimeId, targetRuntimeId: confirmation.targetRuntimeId, amount: confirmation.amount }
    };
  }
  return {
    status: sourceGold === confirmation.before.sourceGold && targetGold === confirmation.before.targetGold
      ? ACTION_LIFECYCLE_STATUSES.UNCONFIRMED
      : ACTION_LIFECYCLE_STATUSES.STATE_MISMATCH,
    stateAfter,
    revisionAfter,
    confirmedStateChange: null
  };
}

function settleActionResult(result, verification) {
  const status = verification.status;
  const confirmed = status === ACTION_LIFECYCLE_STATUSES.CONFIRMED;
  const lifecycle = createActionLifecycle({ selected: true, validated: true, dispatched: true, confirmed, status });
  const diagnostic = createActionDiagnostic({
    ...(result.diagnostic || {}),
    stateAfter: verification.stateAfter,
    revisionAfter: verification.revisionAfter ?? null,
    confirmationStatus: status,
    commandStatus: verification.commandStatus ?? result.diagnostic?.commandStatus ?? null,
    confirmedStateChange: verification.confirmedStateChange
  });
  return {
    ...result,
    success: confirmed,
    lifecycle,
    diagnostic,
    feedback: result.feedback ? {
      ...result.feedback,
      message: confirmed ? result.feedback.confirmedMessage || result.feedback.message : status === ACTION_LIFECYCLE_STATUSES.TIMEOUT ? "动作等待 CK3 确认超时" : status === ACTION_LIFECYCLE_STATUSES.STATE_MISMATCH ? "游戏状态与动作预期不一致" : "动作未获 CK3 状态确认"
    } : result.feedback
  };
}

function detectActionArgumentDrift(requestedArgs, selectedArgs) {
  const requestedAmount = numberOrNull(requestedArgs?.amount ?? requestedArgs);
  const selectedAmount = numberOrNull(selectedArgs?.amount);
  if (requestedAmount === null || selectedAmount === null || requestedAmount === selectedAmount) return null;
  return { code: "ACTION_ARGUMENT_DRIFT", requestedAmount, selectedAmount };
}

module.exports = { captureActionConfirmation, verifyActionConfirmation, settleActionResult, detectActionArgumentDrift, extractRequestedActionArgs };
