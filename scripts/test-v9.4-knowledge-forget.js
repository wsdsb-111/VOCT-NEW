"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");
const { validatePlayerMemorySources } = require("../src/app/main/memory-system/player-centered-memory");
const { preflightPromptPlan } = require("../src/app/main/prompts/prompt-plan-compat");
const { serializePromptPlan } = require("../src/app/main/prompts/prompt-plan-serializer");
const { resealPlan, makeProof, makeSnapshot, SCOPE } = require("./fixtures/v9.4/prompt-plan-security-fixture");

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function makeSourceFixture() {
  const sourceText = "SYNTHETIC_MEMORY_SOURCE|same narrative bytes";
  const state = { revision: 7, forgetRows: [], rows: [{ text: sourceText, sourceRevision: "folder-r7" }], invalidations: 0 };
  const engine = { store: {
    listForgottenSummaryProjections: () => state.forgetRows,
    getFolderSummaryRevision: () => state.revision,
    loadFolderSummariesForCharacter: () => state.rows,
    getFolderSummarySnapshotRevision: () => state.revision,
    hasPairLedgerSourceContentChanges: () => false,
    hasOwnerSummaryContentChanges: () => false,
    invalidateFolderSummaryCache: () => { state.invalidations++; }
  } };
  const context = {
    playerCenteredRecallEnabled: true,
    respondingCharacterId: SCOPE.ownerId,
    sourceCampaignToken: SCOPE.campaignToken,
    playerAnchorId: SCOPE.playerId,
    conversationId: SCOPE.conversationId,
    sourceGameDate: "1200.1.1",
    baselineSnapshotId: "fixture-player-baseline",
    directStableText: sourceText,
    sourceForgetFingerprint: digest([]),
    sourceFolderRevision: state.revision,
    sourcePairIds: [48001],
    sourceOfficialFingerprint: digest(null)
  };
  const gameData = { campaignToken: SCOPE.campaignToken, playerID: SCOPE.playerId, date: "1200.1.1" };
  return { engine, state, context, gameData, sourceText };
}

function makeBoundProof(context) {
  const proof = makeProof();
  proof.plan.inputRevisions.source = `folder-r${context.sourceFolderRevision}`;
  proof.plan.blocks.forEach(block => {
    if (block.permission.authorizedAtRevision === "fixture-source-r7") {
      block.permission.authorizedAtRevision = proof.plan.inputRevisions.source;
    }
  });
  resealPlan(proof.plan);
  proof.serialized = serializePromptPlan(proof.plan);
  return proof;
}

function verifyCurrentSources(fixture, proof, control = null) {
  return plan => {
    if (control?.cancelDuringProof) {
      control.cancel();
      return true;
    }
    return plan.inputRevisions.source === `folder-r${fixture.context.sourceFolderRevision}`
      && validatePlayerMemorySources(fixture.engine, fixture.context, fixture.gameData, SCOPE.conversationId).valid;
  };
}

function assertPreflightRevoked(fixture, proof) {
  const snapshot = makeSnapshot(proof.serialized.messages);
  assert.throws(() => preflightPromptPlan({ snapshot, proof, budget: { safe: true }, expectedScope: SCOPE,
    proofVerifier: verifyCurrentSources(fixture, proof) }), error => error?.code === "PLAN_SOURCE_REVOKED");
}

function testForgetAndSameTextSourceRevisionRevokePlanProof() {
  const fixture = makeSourceFixture();
  const proof = makeBoundProof(fixture.context);
  const result = validatePlayerMemorySources(fixture.engine, fixture.context, fixture.gameData, SCOPE.conversationId);
  assert.deepEqual(result, { valid: true });
  preflightPromptPlan({ snapshot: makeSnapshot(proof.serialized.messages), proof, budget: { safe: true }, expectedScope: SCOPE,
    proofVerifier: verifyCurrentSources(fixture, proof) });

  fixture.state.forgetRows = [{ ownerId: SCOPE.ownerId, projectionId: "synthetic-forget-tombstone", revision: 1 }];
  assert.equal(validatePlayerMemorySources(fixture.engine, fixture.context, fixture.gameData, SCOPE.conversationId).reason, "FORGET_CHANGED",
    "a new owner-scoped Forget tombstone invalidates an already selected source");
  assertPreflightRevoked(fixture, proof);

  fixture.state.forgetRows = [];
  fixture.context.sourceForgetFingerprint = digest([]);
  const originalSourceText = fixture.state.rows[0].text;
  fixture.state.revision += 1;
  fixture.state.rows[0].sourceRevision = "folder-r8";
  assert.equal(fixture.state.rows[0].text, originalSourceText, "source body remains byte-identical across the synthetic revision update");
  assert.equal(validatePlayerMemorySources(fixture.engine, fixture.context, fixture.gameData, SCOPE.conversationId).reason, "SOURCE_REVISION_CHANGED",
    "same text with a new source revision cannot reuse an earlier authorization");
  assertPreflightRevoked(fixture, proof);

  assert.equal(fixture.state.invalidations, 0, "identity mismatch rejects without masking it as cache cleanup");
}

function loadOpenAICompatibleProvider() {
  const providerIndexPath = path.resolve(__dirname, "../src/app/main/providers/index.js");
  let transportCalls = 0;
  class MockOpenAI {
    constructor() {
      this.chat = { completions: { create: async () => {
        transportCalls++;
        return { id: "synthetic-response", choices: [{ message: { content: "synthetic-response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 } };
      } } };
    }
  }
  const originalLoad = Module._load;
  Module._load = function loadFixtureModules(request, parent, isMain) {
    if (request === "openai") return MockOpenAI;
    if (request === "../version" && parent?.filename === providerIndexPath) {
      return { VOTC_CORE_VERSION: "9.4.0-fixture", VOTC_APP_VERSION: "9.4.0-fixture" };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { OpenAICompatibleProvider } = require(providerIndexPath);
    return { provider: new OpenAICompatibleProvider(), get transportCalls() { return transportCalls; } };
  } finally {
    Module._load = originalLoad;
  }
}

async function runAdapterPreflight({ fixture, proof, cancelDuringProof = false }) {
  const { createRequestControl } = require("../src/app/main/providers/provider-cancellation");
  const adapter = loadOpenAICompatibleProvider();
  let guardCalls = 0;
  let sendGuardCalls = 0;
  let control;
  control = createRequestControl({
    requestType: "chat",
    planStatus: "PROMPT_PLAN_V9",
    ownerEvidence: "PRESENT",
    promptPlanProof: proof,
    beforeTransport: (snapshot, receivedProof, budget) => {
      guardCalls++;
      return preflightPromptPlan({ snapshot, proof: receivedProof, budget: budget || { safe: true }, expectedScope: SCOPE,
        proofVerifier: verifyCurrentSources(fixture, receivedProof, cancelDuringProof ? { cancelDuringProof: true, cancel: () => control.cancel() } : null) });
    },
    beforeSend: () => { sendGuardCalls++; }
  });
  control.setEffectiveRequestBudget(() => ({ safe: true }));
  const config = { apiKey: "fixture-only", baseUrl: "https://provider.fixture.invalid/v1", defaultModel: "synthetic-model" };
  const request = { model: "synthetic-model", messages: proof.serialized.messages, stream: false, max_tokens: 128 };
  try {
    await adapter.provider.chatCompletion(request, config, control);
    return { error: null, guardCalls, sendGuardCalls, transportCalls: adapter.transportCalls };
  } catch (error) {
    return { error, guardCalls, sendGuardCalls, transportCalls: adapter.transportCalls };
  } finally {
    control.dispose();
  }
}

async function testProviderPreflightFailureAndCancellationNeverFallBackToTransport() {
  const failureFixture = makeSourceFixture();
  const failureProof = makeBoundProof(failureFixture.context);
  failureFixture.state.forgetRows = [{ ownerId: SCOPE.ownerId, projectionId: "synthetic-provider-forget", revision: 1 }];
  const failed = await runAdapterPreflight({ fixture: failureFixture, proof: failureProof });
  assert.equal(failed.error?.code, "PLAN_SOURCE_REVOKED", "preflight failure remains the visible error");
  assert.equal(failed.guardCalls, 1, "the failed source proof is checked once");
  assert.equal(failed.sendGuardCalls, 0, "the existing send guard is skipped after plan/source rejection");
  assert.equal(failed.transportCalls, 0, "a rejected plan never reaches provider transport or a legacy-message fallback");

  const cancelFixture = makeSourceFixture();
  const cancelProof = makeBoundProof(cancelFixture.context);
  const cancelled = await runAdapterPreflight({ fixture: cancelFixture, proof: cancelProof, cancelDuringProof: true });
  assert.equal(cancelled.error?.name, "AbortError", "cancellation during the trusted proof check remains a cancellation");
  assert.equal(cancelled.guardCalls, 1);
  assert.equal(cancelled.sendGuardCalls, 0);
  assert.equal(cancelled.transportCalls, 0, "cancellation does not retry or fall back to a stale prompt");
}

async function run() {
  const savedConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = console.info = console.warn = console.error = () => {};
  try {
    testForgetAndSameTextSourceRevisionRevokePlanProof();
    await testProviderPreflightFailureAndCancellationNeverFallBackToTransport();
    process.stdout.write("PASS V9.4 Forget/source-revision preflight revocation and provider fail-closed boundary\n");
  } finally {
    Object.assign(console, savedConsole);
  }
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`FAIL V9.4 Forget/source-revision QA\n${error?.stack || error?.message || "unknown"}\n`);
  process.exitCode = 1;
});

module.exports = { run };
