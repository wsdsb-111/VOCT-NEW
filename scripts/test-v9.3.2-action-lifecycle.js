"use strict";

const assert = require("assert");
const path = require("path");
const { createActionEngine } = require(path.join(__dirname, "..", "src", "app", "main", "actions", "action-engine"));
const { Conversation } = require(path.join(__dirname, "..", "src", "app", "main", "conversation", "conversation"));
const { createActionLifecycle } = require(path.join(__dirname, "..", "src", "app", "main", "actions", "types"));

function createRunFileManager(commands) {
  const pendingStatuses = new Set(["queued", "blocked", "awaiting_ack", "stalled"]);
  return {
    expireQueuedActions() {},
    getPendingCommands: () => commands.filter((command) => pendingStatuses.has(command.status)),
    getRecentCommands: () => commands.filter((command) => !pendingStatuses.has(command.status)),
    hasWriteHistory: (command) => Number(command?.writeAttempts || 0) > 0 || command?.lastWrittenAt != null || command?.writtenAt != null
  };
}

async function settleWithCommands(result, commands) {
  Conversation.configure({ runFileManager: createRunFileManager(commands) });
  const conversation = Object.create(Conversation.prototype);
  conversation.gameDataRevision = 11;
  return conversation.waitForActionConfirmation(result, { timeoutMs: 10, pollMs: 0 });
}

async function createMultiEffectResult({ effectCount = 2, writeEffect = null } = {}) {
  const action = { id: "syntheticMultiEffect", filePath: "synthetic-multi-effect.js", validation: { valid: true } };
  const player = { id: 1, shortName: "Synthetic Player", gold: 100 };
  const npc = { id: 2, shortName: "Synthetic NPC", gold: 50 };
  const target = { id: 3, shortName: "Synthetic Target", gold: 20 };
  const gameData = { playerID: player.id, revision: 7, characters: new Map([[player.id, player], [npc.id, npc], [target.id, target]]) };
  const conversation = { id: "synthetic-multi-effect-conversation", conversationEpoch: 4, gameDataRevision: 7, gameData, getHistory: () => [] };
  const writes = [];
  const engine = createActionEngine({
    actionRegistry: { getById: (id) => id === action.id ? action : null },
    settingsRepository: { getLanguage: () => "en" },
    ActionSandbox: {
      executeAction: async (_filePath, context) => {
        for (let index = 0; index < effectCount; index += 1) context.runGameEffect(`synthetic_effect_${index + 1} = yes`);
        return { message: "Synthetic action result" };
      }
    },
    ActionEffectWriter: {
      writeEffect() {
        const attempt = writes.length + 1;
        const commandId = `synthetic-multi-${attempt}`;
        writes.push(commandId);
        if (writeEffect) return writeEffect(attempt);
        return { status: "queued", commandId, writeAttempts: 0 };
      }
    },
    resolveI18nString: (value) => value
  });
  const result = await engine.runInvocation(conversation, npc, { actionId: action.id, targetCharacterId: target.id, args: {} });
  return { result, writes };
}

async function main() {
  const zeroWriteResult = {
    success: false,
    lifecycle: createActionLifecycle({ selected: true, validated: true, dispatched: false, confirmed: false, status: "QUEUED" }),
    confirmation: { type: "RUN_ACK", dispatch: { commandId: "synthetic-zero-write", status: "queued" } },
    diagnostic: { actionId: "synthetic" }
  };
  const zeroWriteCancelled = await settleWithCommands(zeroWriteResult, [{ commandId: "synthetic-zero-write", status: "cancelled", writeAttempts: 0 }]);
  assert.strictEqual(zeroWriteCancelled.lifecycle.status, "UNCONFIRMED");
  assert.strictEqual(zeroWriteCancelled.lifecycle.dispatched, false, "zero-write cancellation must preserve physical dispatch=false");
  assert.strictEqual(zeroWriteCancelled.lifecycle.confirmed, false);

  const missingCommand = await settleWithCommands(zeroWriteResult, []);
  assert.strictEqual(missingCommand.lifecycle.status, "UNCONFIRMED");
  assert.strictEqual(missingCommand.lifecycle.dispatched, true, "missing accepted-command evidence remains an ambiguous possible write");

  const writtenCancelled = await settleWithCommands(zeroWriteResult, [{ commandId: "synthetic-zero-write", status: "cancelled", writeAttempts: 1, lastWrittenAt: 100 }]);
  assert.strictEqual(writtenCancelled.lifecycle.status, "UNCONFIRMED");
  assert.strictEqual(writtenCancelled.lifecycle.dispatched, true, "cancelled command with write history remains possibly dispatched");
  assert.strictEqual(writtenCancelled.success, false);

  const multi = await createMultiEffectResult();
  assert.deepStrictEqual(multi.writes, ["synthetic-multi-1", "synthetic-multi-2"]);
  assert.deepStrictEqual(multi.result.confirmation.dispatches.map((dispatch) => dispatch.commandId), multi.writes);
  assert.deepStrictEqual(multi.result.diagnostic.dispatches.map((dispatch) => dispatch.commandId), multi.writes);
  const multiCancelled = await settleWithCommands(multi.result, [
    { commandId: "synthetic-multi-1", status: "cancelled", writeAttempts: 1, lastWrittenAt: 101 },
    { commandId: "synthetic-multi-2", status: "cancelled", writeAttempts: 0 }
  ]);
  assert.strictEqual(multiCancelled.lifecycle.status, "UNCONFIRMED");
  assert.strictEqual(multiCancelled.lifecycle.dispatched, true, "earlier accepted Effect write evidence survives later zero-write cancellation");
  assert.strictEqual(multiCancelled.success, false);
  assert.strictEqual(multi.writes.length, 2, "settlement must not replay accepted Effects");

  const multiAcknowledged = await settleWithCommands(multi.result, [
    { commandId: "synthetic-multi-1", status: "acknowledged", writeAttempts: 1, lastWrittenAt: 101 },
    { commandId: "synthetic-multi-2", status: "acknowledged", writeAttempts: 1, lastWrittenAt: 102 }
  ]);
  assert.strictEqual(multiAcknowledged.lifecycle.status, "UNCONFIRMED", "one command acknowledgement cannot confirm a multi-Effect Action");
  assert.strictEqual(multiAcknowledged.lifecycle.dispatched, true);
  assert.strictEqual(multiAcknowledged.lifecycle.confirmed, false);
  assert.strictEqual(multiAcknowledged.success, false);

  const originalConsoleError = console.error;
  let unknownWrite;
  try {
    console.error = () => {};
    unknownWrite = await createMultiEffectResult({ effectCount: 1, writeEffect: () => { throw new Error("synthetic_unknown_delivery"); } });
  } finally {
    console.error = originalConsoleError;
  }
  assert.strictEqual(unknownWrite.writes.length, 1, "unknown physical delivery is not automatically replayed");
  assert.strictEqual(unknownWrite.result.diagnostic.dispatchAttempted, true);
  assert.strictEqual(unknownWrite.result.diagnostic.dispatchAccepted, false);
  assert.strictEqual(unknownWrite.result.confirmation, undefined);

  console.log("V9.3.2 Action lifecycle: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
