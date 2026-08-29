"use strict";

function record(analytics, proposal, stage, outcome, details = {}) {
  analytics?.record?.({
    requestType: "action_v4_funnel",
    proposalId: proposal?.proposalId ?? null,
    messageId: proposal?.messageId ?? null,
    engineVersion: "4.0",
    actionSystemMode: proposal?.mode ?? null,
    origin: proposal?.origin ?? null,
    actionId: proposal?.actionId ?? null,
    stage,
    outcome,
    failureStage: outcome === "rejected" || outcome === "failed" ? stage : null,
    failureReason: details.reason || null,
    ...details
  }, null);
}

module.exports = { record };
