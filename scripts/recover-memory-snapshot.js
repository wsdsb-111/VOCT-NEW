"use strict";

const fs = require("fs");
const path = require("path");
const {
  MemoryEngine,
  buildDirectedParticipantPairs,
  getCharacterPersonalName,
  getCharacterStorageDirectoryName,
  resolveSummaryParticipants,
  sanitizeStorageName
} = require(path.join(__dirname, "..", "resources", "app", "out", "main", "memory-system"));

function readSummaries(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(value)) throw new Error(`invalid_summary_file:${filePath}`);
  return value;
}

function writeSummaries(filePath, summaries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(summaries, null, "\t"), "utf8");
  fs.renameSync(tempPath, filePath);
}

function createFolderPersistence(summariesDir) {
  return (finalSummary, context) => {
    const participants = resolveSummaryParticipants({
      playerId: context.participants?.[0]?.id,
      participantIds: (context.participants || []).map((participant) => participant.id),
      currentCharacters: new Map(),
      participantProfiles: context.participants
    });
    if (participants.length < 2) return { success: false, error: "insufficient_summary_participants" };
    const excludedOwnerIds = new Set((context.excludedSummaryOwnerIds || []).map(Number));
    const participantMetadata = participants.map((participant) => ({
      ...participant,
      name: getCharacterPersonalName(participant, participant.name),
      shortName: getCharacterPersonalName(participant, participant.name)
    }));
    let directedFilesWritten = 0;
    const saveDirected = (owner, counterpart) => {
      if (excludedOwnerIds.has(Number(owner.id))) return;
      const folder = path.join(summariesDir, getCharacterStorageDirectoryName(owner, owner.name));
      const counterpartName = sanitizeStorageName(getCharacterPersonalName(counterpart, counterpart.name));
      const filePath = path.join(folder, `与${counterpartName}的对话.json`);
      const summaries = readSummaries(filePath);
      if (!summaries.some((entry) => entry.finalizationId === context.finalizationId)) {
        summaries.unshift({
          date: context.date,
          totalDays: context.totalDays,
          content: finalSummary,
          playerName: getCharacterPersonalName(owner, owner.name),
          playerId: Number(owner.id),
          characterName: getCharacterPersonalName(counterpart, counterpart.name),
          characterId: Number(counterpart.id),
          conversationType: participants.length > 2 ? "group" : "pair",
          participants: participantMetadata,
          finalizationId: context.finalizationId
        });
        writeSummaries(filePath, summaries);
      }
      const verified = readSummaries(filePath).some((entry) => entry.finalizationId === context.finalizationId);
      if (!verified) throw new Error(`summary_file_verification_failed:${filePath}`);
      directedFilesWritten++;
    };
    for (const { owner, counterpart } of buildDirectedParticipantPairs(participants, excludedOwnerIds)) saveDirected(owner, counterpart);
    return { success: true, directedFilesWritten };
  };
}

async function main() {
  const dataDir = path.resolve(process.argv[2] || path.join(process.env.APPDATA || "", "VOTC", "votc_data"));
  const recoveryDir = path.join(dataDir, "memory_recovery");
  const snapshotPath = path.resolve(process.argv[3] || "");
  const relativeSnapshot = path.relative(recoveryDir, snapshotPath);
  if (!snapshotPath || relativeSnapshot.startsWith("..") || path.isAbsolute(relativeSnapshot) || !snapshotPath.endsWith(".json")) {
    throw new Error("snapshot_path_must_be_inside_memory_recovery");
  }
  if (!fs.existsSync(snapshotPath)) throw new Error("recovery_snapshot_not_found");
  const backupDir = path.join(dataDir, "memory_recovery_backup_manual");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${Date.now()}_${path.basename(snapshotPath)}`);
  fs.copyFileSync(snapshotPath, backupPath);

  const engine = new MemoryEngine({
    baseDir: path.join(dataDir, "memory"),
    summaryFoldersDir: path.join(dataDir, "conversation_summaries"),
    recoveryDir
  });
  const result = await engine.recoverFailedFinalization(snapshotPath, {
    requestSummary: async () => { throw new Error("provider_output_missing_from_snapshot"); },
    buildPrompt: () => [],
    persistCharacterFolders: createFolderPersistence(path.join(dataDir, "conversation_summaries"))
  });
  if (!result.success) throw result.error || new Error(result.reason || "snapshot_recovery_failed");
  console.log(`Recovered ${path.basename(snapshotPath)}; participants=${result.participants?.length || 0}; backup=${backupPath}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
