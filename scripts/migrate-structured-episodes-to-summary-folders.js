"use strict";

const fs = require("fs");
const path = require("path");

function sanitizeName(name) {
  return String(name || "未知角色").replace(/[<>:"/\\|?*]/g, "_").trim() || "未知角色";
}

function readSummaryFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const summaries = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(summaries)) throw new Error(`summary_file_not_array:${path.basename(filePath)}`);
  return summaries;
}

function writeSummaryFile(filePath, summaries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(summaries, null, "\t"), "utf8");
  fs.renameSync(tempPath, filePath);
}

function appendDirectedSummary({ summariesDir, owner, other, episode, content }) {
  const ownerFolder = `${Number(owner.id)}_${sanitizeName(owner.name || owner.fullName)}`;
  const filePath = path.join(summariesDir, ownerFolder, `与${sanitizeName(other.name || other.fullName)}的对话.json`);
  const summaries = readSummaryFile(filePath);
  const exists = summaries.some((summary) => summary.totalDays === episode.totalDays && summary.content === content && Number(summary.playerId) === Number(owner.id) && Number(summary.characterId) === Number(other.id));
  if (exists) return false;
  summaries.unshift({
    date: episode.date || null,
    totalDays: episode.totalDays ?? null,
    content,
    playerName: owner.name || owner.fullName,
    playerId: Number(owner.id),
    characterName: other.name || other.fullName,
    characterId: Number(other.id),
    conversationType: episode.participants.length > 2 ? "group" : "pair",
    participants: episode.participants
  });
  writeSummaryFile(filePath, summaries);
  return true;
}

function migrateStructuredEpisodes({ episodesDir, summariesDir }) {
  const result = { episodesScanned: 0, summariesWritten: 0, existingSkipped: 0, invalidEpisodes: 0 };
  if (!fs.existsSync(episodesDir)) return result;
  const episodeFiles = fs.readdirSync(episodesDir).filter((name) => name.startsWith("episode_") && name.endsWith(".json"));
  for (const fileName of episodeFiles) {
    result.episodesScanned++;
    let episode;
    try {
      episode = JSON.parse(fs.readFileSync(path.join(episodesDir, fileName), "utf8"));
    } catch (error) {
      result.invalidEpisodes++;
      continue;
    }
    const participants = (episode.participants || []).filter((participant) => Number.isFinite(Number(participant?.id)) && (participant?.name || participant?.fullName));
    const content = typeof episode.sessionSummary === "string" ? episode.sessionSummary.trim() : "";
    if (participants.length < 2 || !content) {
      result.invalidEpisodes++;
      continue;
    }
    episode.participants = participants;
    for (let left = 0; left < participants.length; left++) {
      for (let right = left + 1; right < participants.length; right++) {
        for (const [owner, other] of [[participants[left], participants[right]], [participants[right], participants[left]]]) {
          if (appendDirectedSummary({ summariesDir, owner, other, episode, content })) result.summariesWritten++;
          else result.existingSkipped++;
        }
      }
    }
  }
  return result;
}

if (require.main === module) {
  const dataDir = process.argv[2] || path.join(process.env.APPDATA || "", "VOTC", "votc_data");
  if (!dataDir) throw new Error("votc_data_directory_required");
  const result = migrateStructuredEpisodes({
    episodesDir: path.join(dataDir, "memory", "episodes"),
    summariesDir: path.join(dataDir, "conversation_summaries")
  });
  console.log(`Structured episode migration: episodes=${result.episodesScanned}, written=${result.summariesWritten}, existing=${result.existingSkipped}, invalid=${result.invalidEpisodes}`);
}

module.exports = { migrateStructuredEpisodes };
