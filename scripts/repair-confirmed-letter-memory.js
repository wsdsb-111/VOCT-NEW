"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { LetterMemoryFinalization } = require("../resources/app/out/main/memory-system/letter-memory-finalization");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

function requireStoppedApp() {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "if (Get-Process -Name VOTC -ErrorAction SilentlyContinue) { exit 2 }; exit 0"], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error("app_must_be_stopped_for_confirmed_repair");
  }
}

// Explicit human confirmation only. This tool never writes a game RunFile or calls a provider.
function captureConfirmedLetter({ dataDir, letterId, context, confirmedReceived = false, assertAppStopped = requireStoppedApp }) {
  if (!confirmedReceived) throw new Error("explicit_received_confirmation_required");
  assertAppStopped();
  const file = path.join(path.resolve(dataDir), "pending-letters.json");
  const original = fs.readFileSync(file, "utf8");
  const state = JSON.parse(original);
  const rows = (state.letters || []).filter(row => row.letter?.letterId === letterId);
  if (rows.length !== 1) throw new Error("confirmed_letter_not_unique");
  const row = rows[0], binding = row.disclosureBinding;
  if (!binding || !Number.isFinite(row.status?.effectFileWrittenAt) || row.status.effectFileWrittenAt <= 0
    || !["effect_file_written", "sent"].includes(row.status.responseStatus)
    || context.letterId !== letterId || context.campaignToken !== binding.campaignToken
    || context.senderId !== binding.playerId || context.recipientId !== binding.aiId
    || context.sourceDate !== binding.sourceDate || context.sourceTotalDays !== binding.sourceTotalDays
    || context.text !== row.letter.content || context.reply !== row.reply
    || context.acceptedTotalDays < row.expectedDeliveryDay) throw new Error("confirmed_letter_context_mismatch");
  if (row.sourceMemoryContext && hash(row.sourceMemoryContext) !== hash({
    participantProfiles: context.participantProfiles, relationshipEvidence: context.relationshipEvidence
  })) throw new Error("confirmed_letter_source_snapshot_mismatch");
  const recoveryDir = path.join(path.resolve(dataDir), "memory", "memory4-recovery");
  const store = { paths: { memory4Recovery: recoveryDir },
    writeJson(target, value) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, target);
    } };
  const archive = new LetterMemoryFinalization({ memoryEngine: { store } });
  const jobId = archive.jobId(context);
  if (fs.readFileSync(file, "utf8") !== original) throw new Error("pending_letters_changed_during_repair");
  const backup = `${file}.confirmed-memory-${Date.now()}.bak`;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  const job = archive.captureAccepted(context);
  archive.readJob(jobId);
  row.acceptedMemoryContext = context;
  row.acceptedMemoryAwaitingProof = false;
  row.status = { ...row.status, responseStatus: "sent", pipelineState: "DELIVERED",
    summaryStatus: "not_started", summaryError: null,
    acceptanceProofSource: "user_confirmed_artifact", manuallyConfirmedReceivedAt: Date.now() };
  if (state.awaitingAcceptanceLetterId === letterId) state.awaitingAcceptanceLetterId = null;
  assertAppStopped();
  if (fs.readFileSync(file, "utf8") !== original) throw new Error("pending_letters_changed_during_repair");
  const temporary = `${file}.${randomUUID()}.confirmed-memory.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, file);
  return { success: true, letterId, jobId: job.jobId, recoveryPath: job.recoveryPath, backup,
    providerRequests: 0, gameEffectsWritten: 0 };
}

if (require.main === module) {
  const [dataDir, letterId, contextFile, confirmation] = process.argv.slice(2);
  if (!dataDir || !letterId || !contextFile || confirmation !== "--confirmed-received") {
    throw new Error("usage: node repair-confirmed-letter-memory.js DATA_DIR LETTER_ID CONTEXT_JSON --confirmed-received");
  }
  const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  console.log(JSON.stringify(captureConfirmedLetter({ dataDir, letterId, context, confirmedReceived: true }), null, 2));
}

module.exports = { captureConfirmedLetter };
