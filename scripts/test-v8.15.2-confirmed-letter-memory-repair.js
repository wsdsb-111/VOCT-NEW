"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { captureConfirmedLetter: capture } = require("./repair-confirmed-letter-memory");
const captureConfirmedLetter = options => capture({ assertAppStopped: () => {}, ...options });

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-confirmed-letter-memory-"));
try {
  const context = { campaignToken: "repair-fixture", letterId: "letter_repair", senderId: 1, recipientId: 2,
    sourceDate: "1038.4.1", acceptedDate: "1038.4.4", sourceTotalDays: 100, acceptedTotalDays: 103,
    text: "Please keep the seal.", reply: "The seal is safe.",
    participantProfiles: [{ id: 1, shortName: "Sender" }, { id: 2, shortName: "Recipient" }], relationshipEvidence: [] };
  const pendingFile = path.join(root, "pending-letters.json");
  const state = { version: 4, awaitingAcceptanceLetterId: context.letterId, failedLetters: [], letters: [{
    letter: { letterId: context.letterId, content: context.text, totalDays: 100, delay: 3 }, reply: context.reply,
    expectedDeliveryDay: 103,
    disclosureBinding: { campaignToken: context.campaignToken, playerId: 1, aiId: 2,
      sourceDate: context.sourceDate, sourceTotalDays: 100 },
    status: { responseStatus: "effect_file_written", effectFileWrittenAt: 1, runCommandId: "fixture_written", summaryStatus: "not_started" }
  }, { letter: { letterId: "unrelated" }, reply: "Preserve this unrelated payload." }] };
  fs.writeFileSync(pendingFile, JSON.stringify(state), "utf8");
  const original = fs.readFileSync(pendingFile, "utf8");
  assert.throws(() => captureConfirmedLetter({ dataDir: root, letterId: context.letterId, context }), /explicit_received/);
  assert.throws(() => captureConfirmedLetter({ dataDir: root, letterId: context.letterId,
    context: { ...context, campaignToken: "another-campaign" }, confirmedReceived: true }), /context_mismatch/);
  assert.equal(fs.readFileSync(pendingFile, "utf8"), original);
  assert.throws(() => captureConfirmedLetter({ dataDir: root, letterId: context.letterId, context,
    confirmedReceived: true, assertAppStopped: () => { throw new Error("app_must_be_stopped_for_confirmed_repair"); } }), /app_must_be_stopped/);
  state.letters[0].sourceMemoryContext = { participantProfiles: context.participantProfiles, relationshipEvidence: [] };
  fs.writeFileSync(pendingFile, JSON.stringify(state), "utf8");
  assert.throws(() => captureConfirmedLetter({ dataDir: root, letterId: context.letterId,
    context: { ...context, participantProfiles: [{ id: 1, shortName: "Wrong" }, context.participantProfiles[1]] },
    confirmedReceived: true }), /source_snapshot_mismatch/);
  delete state.letters[0].sourceMemoryContext;
  fs.writeFileSync(pendingFile, original, "utf8");
  const result = captureConfirmedLetter({ dataDir: root, letterId: context.letterId, context, confirmedReceived: true });
  assert.equal(fs.readFileSync(result.backup, "utf8"), original);
  const job = JSON.parse(fs.readFileSync(result.recoveryPath, "utf8"));
  assert.equal(job.narrative.status, "PENDING");
  assert.equal(job.context.text, context.text);
  assert.equal(job.context.reply, context.reply);
  const repaired = JSON.parse(fs.readFileSync(pendingFile, "utf8"));
  assert.equal(repaired.awaitingAcceptanceLetterId, null);
  assert.equal(repaired.letters[0].status.responseStatus, "sent");
  assert.equal(repaired.letters[0].status.acceptanceProofSource, "user_confirmed_artifact");
  assert.equal(repaired.letters[0].status.runCommandId, "fixture_written");
  assert.deepEqual(repaired.letters[1], state.letters[1]);
  assert.equal(result.providerRequests, 0);
  assert.equal(result.gameEffectsWritten, 0);
  assert(!fs.existsSync(path.join(root, "run")));
  assert(!fs.existsSync(path.join(root, "run-command-queue.json")));
  const duplicate = captureConfirmedLetter({ dataDir: root, letterId: context.letterId, context, confirmedReceived: true });
  assert.equal(duplicate.jobId, result.jobId);
  assert.equal(fs.readdirSync(path.dirname(result.recoveryPath)).filter(name => /^letter_.*\.json$/.test(name)).length, 1);
  console.log("V8.15.2 confirmed letter memory repair: PASS (explicit consent, exact binding, backup, no game/provider writes)");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
