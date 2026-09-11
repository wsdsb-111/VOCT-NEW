"use strict";

const ACTION_SCHEMA_NAME = "votc_actions";

const ACTION_LIFECYCLE_STATUSES = Object.freeze({
  SELECTED: "SELECTED",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  VALIDATED: "VALIDATED",
  DISPATCHED: "DISPATCHED",
  CONFIRMED: "CONFIRMED",
  NO_EFFECT: "NO_EFFECT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  DISPATCH_FAILED: "DISPATCH_FAILED",
  UNCONFIRMED: "UNCONFIRMED",
  STATE_MISMATCH: "STATE_MISMATCH",
  TIMEOUT: "TIMEOUT"
});

function createActionLifecycle({ selected = false, validated = false, dispatched = false, confirmed = null, status = ACTION_LIFECYCLE_STATUSES.SELECTED } = {}) {
  return {
    selected: Boolean(selected),
    validated: Boolean(validated),
    dispatched: Boolean(dispatched),
    confirmed: confirmed === null ? null : Boolean(confirmed),
    status
  };
}

function createActionDiagnostic({ actionId, type = actionId, sourceRuntimeId = null, targetRuntimeId = null, args = {}, stateBefore = null, stateAfter = null, revisionBefore = null, revisionAfter = null, dispatchStatus = "NOT_DISPATCHED", confirmationStatus = "NOT_STARTED", expectedStateChange = null, requestedArgs = null, requestedByUser = requestedArgs?.amount ?? null, selectedArgs = args, effectiveArgs = args, confirmedStateChange = null, commandId = null, commandStatus = null, dispatchEvidence = null, argumentDrift = null } = {}) {
  return {
    actionId: actionId ?? null,
    type: type ?? null,
    sourceRuntimeId,
    targetRuntimeId,
    args: args && typeof args === "object" ? { ...args } : {},
    stateBefore,
    stateAfter,
    revisionBefore,
    revisionAfter,
    dispatchStatus,
    confirmationStatus,
    expectedStateChange,
    requestedArgs,
    requestedByUser,
    selectedArgs: selectedArgs && typeof selectedArgs === "object" ? { ...selectedArgs } : {},
    effectiveArgs: effectiveArgs && typeof effectiveArgs === "object" ? { ...effectiveArgs } : {},
    confirmedStateChange,
    commandId,
    commandStatus,
    dispatchEvidence,
    argumentDrift
  };
}

module.exports = { ACTION_SCHEMA_NAME, ACTION_LIFECYCLE_STATUSES, createActionLifecycle, createActionDiagnostic };
