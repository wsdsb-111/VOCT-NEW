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
  if (expectedStateChange?.type === "OPINION_CHANGE") return { ...expectedStateChange, actionId, dispatch, requireCommandReadback: true };
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
    requireCommandReadback: dispatch?.hasGoldReadback === true,
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

function verifyActionConfirmation({ confirmation, gameData, gameDataRevision, commandReadback = null } = {}) {
  if (!confirmation) return { status: ACTION_LIFECYCLE_STATUSES.UNCONFIRMED, stateAfter: null, confirmedStateChange: null };
  if (confirmation.requireCommandReadback) {
    if (!commandReadback?.acknowledged || commandReadback.commandId !== confirmation.dispatch?.commandId) return { status: "UNCONFIRMED", stateAfter: null, confirmedStateChange: null };
    if (commandReadback.sourceRuntimeId !== confirmation.sourceRuntimeId || confirmation.targetRuntimeId != null && commandReadback.targetRuntimeId !== confirmation.targetRuntimeId) return { status: "BINDING_FAILED", stateAfter: null, confirmedStateChange: null };
  }
  if (commandReadback?.bindingFailed) return { status: "BINDING_FAILED", stateAfter: null, confirmedStateChange: null };
  if (commandReadback?.insufficientGold) return { status: "INSUFFICIENT_GOLD", stateAfter: null, confirmedStateChange: null };
  if (confirmation.type === "RUN_ACK") return { status: "ACKNOWLEDGED", stateAfter: null, confirmedStateChange: null };
  if (confirmation.type === "STATE_UNVERIFIABLE") return { status: "UNCONFIRMED", stateAfter: null, confirmedStateChange: null };
  if (confirmation.requireCommandReadback) {
    if (!commandReadback?.acknowledged || commandReadback.commandId !== confirmation.dispatch?.commandId) return { status: "UNCONFIRMED", stateAfter: null, confirmedStateChange: null };
    if (confirmation.type === "OPINION_CHANGE") {
      const observed = commandReadback.opinion[confirmation.sourceRuntimeId + ":" + confirmation.targetRuntimeId];
      if (!observed || observed.count < 2) return { status: "UNCONFIRMED", stateAfter: null, confirmedStateChange: null };
      const delta = observed.after - observed.before;
      const status = delta === confirmation.amount ? "CONFIRMED" : delta === 0 ? "NO_EFFECT" : "STATE_MISMATCH";
      return { status, stateBefore: { opinion: observed.before }, stateAfter: { opinion: observed.after }, confirmedStateChange: status === "CONFIRMED" ? { type: "OPINION_CHANGE", amount: delta } : null };
    }
    const source = commandReadback.gold[confirmation.sourceRuntimeId];
    const target = commandReadback.gold[confirmation.targetRuntimeId];
    if (!source || !target || source.count < 2 || target.count < 2 || confirmation.sourceRuntimeId === confirmation.targetRuntimeId) return { status: "UNCONFIRMED", stateAfter: null, confirmedStateChange: null };
    const verified = verifyActionConfirmation({
      confirmation: { ...confirmation, requireCommandReadback: false, before: { sourceGold: source.before, targetGold: target.before, gameDataRevision: null } },
      gameData: { characters: new Map([[confirmation.sourceRuntimeId, { gold: source.after }], [confirmation.targetRuntimeId, { gold: target.after }]]) }
    });
    return { ...verified, stateBefore: { sourceGold: source.before, targetGold: target.before } };
  }
  const revisionAfter = numberOrNull(gameDataRevision);
  const revisionBefore = numberOrNull(confirmation.before?.gameDataRevision);
  if (revisionBefore !== null && (revisionAfter === null || revisionAfter <= revisionBefore)) {
    return { status: "PENDING", stateAfter: null, confirmedStateChange: null, revisionAfter };
  }
  const sourceGold = readGold(gameData, confirmation.sourceRuntimeId);
  const targetGold = readGold(gameData, confirmation.targetRuntimeId);
  const stateAfter = { sourceGold, targetGold };
  if (sourceGold === null || targetGold === null) return { status: ACTION_LIFECYCLE_STATUSES.UNCONFIRMED, stateAfter, confirmedStateChange: null, revisionAfter };
  const sourceMatches = Math.abs(sourceGold - (confirmation.before.sourceGold - confirmation.amount)) < 0.00001;
  const targetMatches = Math.abs(targetGold - (confirmation.before.targetGold + confirmation.amount)) < 0.00001;
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
  const dispatched = status !== "QUEUE_BLOCKED" && status !== "QUEUE_EXPIRED";
  const lifecycle = createActionLifecycle({ selected: true, validated: true, dispatched, confirmed, status });
  const diagnostic = createActionDiagnostic({
    ...(result.diagnostic || {}),
    stateBefore: verification.stateBefore || result.diagnostic?.stateBefore || null,
    stateAfter: verification.stateAfter,
    revisionAfter: verification.revisionAfter ?? null,
    confirmationStatus: status,
    commandStatus: verification.commandStatus ?? result.diagnostic?.commandStatus ?? null,
    confirmedStateChange: verification.confirmedStateChange
  });
  const failureMessages = {
    INSUFFICIENT_GOLD: "执行时游戏内金币不足，未转账",
    BINDING_FAILED: "动作角色绑定缺失或不符，请重新进入对话后再操作",
    ACKNOWLEDGED: "游戏已接收动作指令；尚无该效果的状态核验，不能视为执行成功",
    NO_EFFECT: "游戏已执行核验，但未观察到好感度变化（对话修正上限为正负10，总好感度也有上限）",
    QUEUE_BLOCKED: "动作尚未写入游戏：命令队列被未确认命令阻塞",
    QUEUE_EXPIRED: "动作排队超时，已取消未写入的命令",
    TIMEOUT: "动作等待 CK3 确认超时",
    STATE_MISMATCH: "游戏状态与动作预期不一致；实测 " + JSON.stringify(verification.stateBefore || {}) + " → " + JSON.stringify(verification.stateAfter || {})
  };
  return {
    ...result,
    success: confirmed,
    lifecycle,
    diagnostic,
    feedback: result.feedback ? {
      ...result.feedback,
      sentiment: confirmed ? result.feedback.sentiment : "neutral",
      message: confirmed ? result.feedback.confirmedMessage || result.feedback.message : failureMessages[status] || "动作未获 CK3 状态确认"
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
