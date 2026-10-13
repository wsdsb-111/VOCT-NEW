"use strict";

const assert = require("assert");
const path = require("path");
const { createActionEngine } = require(path.join(__dirname, "..", "src", "app", "main", "actions", "action-engine"));

const failures = [];

function expect(name, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

function createFixture({ writeEffect, sandboxMode = "effect" } = {}) {
  const action = { id: "syntheticAction", filePath: "synthetic-action.js", validation: { valid: true } };
  const player = { id: 1, shortName: "Synthetic Player", gold: 100 };
  const npc = { id: 2, shortName: "Synthetic NPC", gold: 50 };
  const target = { id: 3, shortName: "Synthetic Target", gold: 20 };
  const gameData = { playerID: player.id, revision: 7, characters: new Map([[player.id, player], [npc.id, npc], [target.id, target]]) };
  const conversation = {
    id: "synthetic-action-conversation",
    conversationEpoch: 4,
    gameDataRevision: gameData.revision,
    gameData,
    getHistory: () => []
  };
  const writes = [];
  const engine = createActionEngine({
    actionRegistry: { getById: id => id === action.id ? action : null },
    settingsRepository: { getLanguage: () => "en" },
    ActionSandbox: {
      executeAction: async (_filePath, context) => {
        if (sandboxMode !== "no-effect") context.runGameEffect("synthetic_effect = yes");
        if (sandboxMode === "effect-twice") context.runGameEffect("synthetic_effect = yes");
        if (sandboxMode === "throw-after-effect") throw new Error("synthetic_sandbox_failure_after_dispatch");
        return { message: "Synthetic action result" };
      }
    },
    ActionEffectWriter: {
      writeEffect(...args) {
        writes.push(args);
        return writeEffect(...args);
      }
    },
    resolveI18nString: value => value
  });

  return {
    engine,
    writes,
    conversation,
    npc,
    invocation: { actionId: action.id, targetCharacterId: target.id, args: {} }
  };
}

async function runFixture(options) {
  const fixture = createFixture(options);
  const result = await fixture.engine.runInvocation(fixture.conversation, fixture.npc, fixture.invocation, options?.dryRun ? { dryRun: true } : undefined);
  return { ...fixture, result };
}

async function main() {
  // A01: A writer exception may follow a partial physical write. Keep the
  // failure evidence, but never claim acceptance or replay the effect.
  const thrown = await runFixture({ writeEffect: () => { throw new Error("synthetic_partial_write_unknown_delivery"); } });
  expect("A01_writer_throw_success_false", thrown.result.success, false);
  expect("A01_writer_throw_dispatched_false", thrown.result.lifecycle.dispatched, false);
  expect("A01_writer_throw_lifecycle_failed", thrown.result.lifecycle.status, "DISPATCH_FAILED");
  expect("A01_writer_throw_attempted", thrown.result.diagnostic.dispatchAttempted, true);
  expect("A01_writer_throw_not_accepted", thrown.result.diagnostic.dispatchAccepted, false);
  expect("A01_writer_throw_not_confirmed", thrown.result.lifecycle.confirmed, false);
  expect("A01_writer_throw_legacy_status", thrown.result.diagnostic.dispatchStatus, "FAILED");
  expect("A01_writer_throw_no_command_id", thrown.result.diagnostic.commandId, null);
  expect("A01_writer_throw_no_ack_confirmation", thrown.result.confirmation, undefined);
  expect("A01_writer_throw_failure_evidence", thrown.result.diagnostic.dispatchEvidence?.status, "FAILED");
  expect("A01_writer_throw_no_replay", thrown.writes.length, 1);

  // A02: A result object is not acceptance unless it contains the expected
  // command envelope and an accepted queue/ACK-wait status.
  const failedEnvelope = await runFixture({ writeEffect: () => ({ status: "FAILED", commandId: "synthetic-unaccepted-id" }) });
  expect("A02_failed_status_success_false", failedEnvelope.result.success, false);
  expect("A02_failed_status_dispatched_false", failedEnvelope.result.lifecycle.dispatched, false);
  expect("A02_failed_status_attempted", failedEnvelope.result.diagnostic.dispatchAttempted, true);
  expect("A02_failed_status_not_accepted", failedEnvelope.result.diagnostic.dispatchAccepted, false);
  expect("A02_failed_status_no_command_id", failedEnvelope.result.diagnostic.commandId, null);
  expect("A02_failed_status_not_confirmed", failedEnvelope.result.lifecycle.confirmed, false);
  expect("A02_failed_status_no_replay", failedEnvelope.writes.length, 1);

  // A03/A04: both valid envelopes are accepted, while only awaiting_ack is
  // physically dispatched; neither state confirms a CK3 effect.
  const queued = await runFixture({ writeEffect: () => ({ status: "queued", commandId: "synthetic-queued-id" }) });
  expect("A03_queued_attempted", queued.result.diagnostic.dispatchAttempted, true);
  expect("A03_queued_accepted", queued.result.diagnostic.dispatchAccepted, true);
  expect("A03_queued_lifecycle", queued.result.lifecycle.status, "QUEUED");
  expect("A03_queued_not_dispatched", queued.result.lifecycle.dispatched, false);
  expect("A03_queued_command_id", queued.result.diagnostic.commandId, "synthetic-queued-id");
  expect("A03_queued_pending_confirmation", queued.result.diagnostic.confirmationStatus, "PENDING_CONFIRMATION");
  expect("A03_queued_not_confirmed", queued.result.lifecycle.confirmed, false);
  expect("A03_queued_single_write", queued.writes.length, 1);

  const awaitingAck = await runFixture({ writeEffect: () => ({ status: "awaiting_ack", commandId: "synthetic-awaiting-id" }) });
  expect("A04_awaiting_attempted", awaitingAck.result.diagnostic.dispatchAttempted, true);
  expect("A04_awaiting_accepted", awaitingAck.result.diagnostic.dispatchAccepted, true);
  expect("A04_awaiting_dispatched", awaitingAck.result.lifecycle.dispatched, true);
  expect("A04_awaiting_lifecycle", awaitingAck.result.lifecycle.status, "DISPATCHED");
  expect("A04_awaiting_command_id", awaitingAck.result.diagnostic.commandId, "synthetic-awaiting-id");
  expect("A04_awaiting_pending_confirmation", awaitingAck.result.diagnostic.confirmationStatus, "PENDING_CONFIRMATION");
  expect("A04_awaiting_not_confirmed", awaitingAck.result.lifecycle.confirmed, false);

  // A05: status without commandId is an invalid/unknown delivery envelope,
  // and must not be upgraded to accepted or attempted again automatically.
  const missingId = await runFixture({ writeEffect: () => ({ status: "queued" }) });
  expect("A05_missing_id_success_false", missingId.result.success, false);
  expect("A05_missing_id_dispatched_false", missingId.result.lifecycle.dispatched, false);
  expect("A05_missing_id_attempted", missingId.result.diagnostic.dispatchAttempted, true);
  expect("A05_missing_id_not_accepted", missingId.result.diagnostic.dispatchAccepted, false);
  expect("A05_missing_id_no_command_id", missingId.result.diagnostic.commandId, null);
  expect("A05_missing_id_not_confirmed", missingId.result.lifecycle.confirmed, false);
  expect("A05_missing_id_no_replay", missingId.writes.length, 1);

  for (const [label, commandId] of [["numeric", 123], ["blank", "  "]]) {
    const invalidId = await runFixture({ writeEffect: () => ({ status: "queued", commandId }) });
    expect(`A05_${label}_id_success_false`, invalidId.result.success, false);
    expect(`A05_${label}_id_dispatch_failed`, invalidId.result.lifecycle.status, "DISPATCH_FAILED");
    expect(`A05_${label}_id_not_accepted`, invalidId.result.diagnostic.dispatchAccepted, false);
    expect(`A05_${label}_id_no_command_id`, invalidId.result.diagnostic.commandId, null);
    expect(`A05_${label}_id_no_replay`, invalidId.writes.length, 1);
  }

  // A06: if the sandbox throws after a valid envelope was returned, preserve
  // the accepted command evidence and pending ACK state.
  const sandboxFailure = await runFixture({
    writeEffect: () => ({ status: "awaiting_ack", commandId: "synthetic-accepted-before-sandbox-error" }),
    sandboxMode: "throw-after-effect"
  });
  expect("A06_sandbox_error_success_false", sandboxFailure.result.success, false);
  expect("A06_sandbox_error_dispatched", sandboxFailure.result.lifecycle.dispatched, true);
  expect("A06_sandbox_error_keeps_failure_lifecycle", sandboxFailure.result.lifecycle.status, "DISPATCH_FAILED");
  expect("A06_sandbox_error_attempted", sandboxFailure.result.diagnostic.dispatchAttempted, true);
  expect("A06_sandbox_error_keeps_acceptance", sandboxFailure.result.diagnostic.dispatchAccepted, true);
  expect("A06_sandbox_error_keeps_dispatch_status", sandboxFailure.result.diagnostic.dispatchStatus, "awaiting_ack");
  expect("A06_sandbox_error_keeps_command_id", sandboxFailure.result.diagnostic.commandId, "synthetic-accepted-before-sandbox-error");
  expect("A06_sandbox_error_keeps_evidence", sandboxFailure.result.diagnostic.dispatchEvidence?.commandId, "synthetic-accepted-before-sandbox-error");
  expect("A06_sandbox_error_pending_ack", sandboxFailure.result.diagnostic.confirmationStatus, "PENDING_CONFIRMATION");
  expect("A06_sandbox_error_not_confirmed", sandboxFailure.result.lifecycle.confirmed, false);
  expect("A06_sandbox_error_no_replay", sandboxFailure.writes.length, 1);

  // If a sandbox invokes runGameEffect again and that later write fails, the
  // first accepted command remains authoritative evidence and is not replayed.
  let doubleWriteAttempts = 0;
  const secondWriteFailure = await runFixture({
    writeEffect: () => {
      doubleWriteAttempts++;
      if (doubleWriteAttempts === 1) return { status: "awaiting_ack", commandId: "synthetic-first-accepted-id" };
      throw new Error("synthetic_second_write_unknown_delivery");
    },
    sandboxMode: "effect-twice"
  });
  expect("A06_second_write_failure_success_false", secondWriteFailure.result.success, false);
  expect("A06_second_write_failure_dispatched", secondWriteFailure.result.lifecycle.dispatched, true);
  expect("A06_second_write_failure_attempted", secondWriteFailure.result.diagnostic.dispatchAttempted, true);
  expect("A06_second_write_failure_keeps_acceptance", secondWriteFailure.result.diagnostic.dispatchAccepted, true);
  expect("A06_second_write_failure_keeps_dispatch_status", secondWriteFailure.result.diagnostic.dispatchStatus, "awaiting_ack");
  expect("A06_second_write_failure_keeps_first_command", secondWriteFailure.result.diagnostic.commandId, "synthetic-first-accepted-id");
  expect("A06_second_write_failure_keeps_first_evidence", secondWriteFailure.result.diagnostic.dispatchEvidence?.commandId, "synthetic-first-accepted-id");
  expect("A06_second_write_failure_pending_ack", secondWriteFailure.result.diagnostic.confirmationStatus, "PENDING_CONFIRMATION");
  expect("A06_second_write_failure_no_automatic_replay", doubleWriteAttempts, 2);

  // No effect and dryRun keep the existing zero-write contract.
  const noEffect = await runFixture({ writeEffect: () => ({ status: "awaiting_ack", commandId: "must-not-exist" }), sandboxMode: "no-effect" });
  expect("A09_no_effect_success", noEffect.result.success, true);
  expect("A09_no_effect_not_attempted", noEffect.result.diagnostic.dispatchAttempted, false);
  expect("A09_no_effect_not_accepted", noEffect.result.diagnostic.dispatchAccepted, false);
  expect("A09_no_effect_status", noEffect.result.diagnostic.dispatchStatus, "NOT_REQUIRED");
  expect("A09_no_effect_zero_writes", noEffect.writes.length, 0);

  const dryRun = await runFixture({ writeEffect: () => ({ status: "awaiting_ack", commandId: "must-not-exist" }), dryRun: true });
  expect("A08_dry_run_lifecycle", dryRun.result.lifecycle.status, "VALIDATED");
  expect("A08_dry_run_not_dispatched", dryRun.result.lifecycle.dispatched, false);
  expect("A08_dry_run_not_attempted", dryRun.result.diagnostic.dispatchAttempted, false);
  expect("A08_dry_run_not_accepted", dryRun.result.diagnostic.dispatchAccepted, false);
  expect("A08_dry_run_status", dryRun.result.diagnostic.dispatchStatus, "NOT_DISPATCHED");
  expect("A08_dry_run_zero_writes", dryRun.writes.length, 0);

  if (failures.length) {
    console.error(`V9.3.1 Action dispatch diagnostics: FAIL (${failures.length} assertions)`);
    for (const failure of failures) console.error(`[RED] ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("V9.3.1 Action dispatch diagnostics: PASS");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
