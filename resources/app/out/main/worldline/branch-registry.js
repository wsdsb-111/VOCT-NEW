"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { normalizeGameDate } = require("./character-temporal-facts");

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const MAX_FINGERPRINT_HISTORY = 512;

function validFingerprint(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validLoadSessionId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{8,160}$/.test(value);
}

function addFingerprint(history, fingerprint) {
  return [...new Set([...(Array.isArray(history) ? history.filter(validFingerprint) : []), fingerprint])].slice(-MAX_FINGERPRINT_HISTORY);
}

class BranchRegistry {
  constructor({ root, clock = () => new Date().toISOString() }) {
    this.file = path.join(root, "branch-registry.json");
    this.clock = clock;
  }

  _normalizeBranch(item) {
    if (!item || typeof item !== "object" || !/^campaign_[a-f0-9]{64}$/.test(item.campaignId) || !/^branch_[a-f0-9-]{36}$/.test(item.branchId) || typeof item.sourcePath !== "string" || !validFingerprint(item.fingerprint) || !normalizeGameDate(item.gameDate)) throw new Error("branch_registry_invalid");
    const archived = item.archived === true || item.status === "ARCHIVED";
    const fingerprint = validFingerprint(item.currentFingerprint) ? item.currentFingerprint : item.fingerprint;
    const gameDate = normalizeGameDate(item.latestGameDate) ? item.latestGameDate : item.gameDate;
    const normalized = {
      ...item,
      fingerprint,
      currentFingerprint: fingerprint,
      fingerprintHistory: addFingerprint(item.fingerprintHistory, fingerprint),
      gameDate,
      latestGameDate: gameDate,
      loadSessionId: validLoadSessionId(item.loadSessionId) ? item.loadSessionId : null,
      status: archived ? "ARCHIVED" : "ACTIVE",
      archived
    };
    if (normalized.parentBranchId != null && !/^branch_[a-f0-9-]{36}$/.test(normalized.parentBranchId)) throw new Error("branch_registry_invalid");
    return normalized;
  }

  load() {
    let state;
    try { state = JSON.parse(fs.readFileSync(this.file, "utf8")); }
    catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: 2, branches: [] };
      throw new Error("branch_registry_unreadable");
    }
    if (![1, 2].includes(state.schemaVersion) || !Array.isArray(state.branches)) throw new Error("branch_registry_invalid");
    const ids = new Set();
    const paths = new Set();
    const branches = state.branches.map((item) => this._normalizeBranch(item));
    for (const item of branches) {
      const key = `${item.campaignId}:${item.sourcePath}`;
      if (ids.has(item.branchId) || item.archived !== true && paths.has(key)) throw new Error("branch_registry_invalid");
      ids.add(item.branchId);
      if (item.archived !== true) paths.add(key);
    }
    return { schemaVersion: 2, branches };
  }

  save(state) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temporary, "wx");
      fs.writeFileSync(fd, JSON.stringify({ schemaVersion: 2, branches: state.branches }));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, this.file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  identity(input) {
    if (typeof input?.campaignToken !== "string" || !input.campaignToken.trim() || input.campaignToken.length > 256 || typeof input.sourcePath !== "string" || !path.win32.isAbsolute(input.sourcePath) || !validFingerprint(input.fingerprint) || !normalizeGameDate(input.gameDate)) return null;
    return { campaignId: `campaign_${digest(input.campaignToken)}`, sourcePath: path.win32.normalize(input.sourcePath).toLowerCase(), fingerprint: input.fingerprint, gameDate: input.gameDate, loadSessionId: validLoadSessionId(input.loadSessionId) ? input.loadSessionId : null };
  }

  _touch(branch, evidence) {
    branch.fingerprint = evidence.fingerprint;
    branch.currentFingerprint = evidence.fingerprint;
    branch.fingerprintHistory = addFingerprint(branch.fingerprintHistory, evidence.fingerprint);
    branch.gameDate = evidence.gameDate;
    branch.latestGameDate = evidence.gameDate;
    branch.loadSessionId = evidence.loadSessionId;
    branch.lastSeenAt = this.clock();
  }

  _archive(branch) {
    branch.archived = true;
    branch.status = "ARCHIVED";
    branch.archivedAt = this.clock();
    branch.lastSeenAt = branch.archivedAt;
  }

  _resume(state, evidence, branch) {
    const current = state.branches.find((item) => item.archived !== true && item.campaignId === evidence.campaignId && item.sourcePath === evidence.sourcePath && item.branchId !== branch.branchId);
    if (current) this._archive(current);
    branch.archived = false;
    branch.status = "ACTIVE";
    branch.archivedAt = null;
    this._touch(branch, evidence);
    return { state: "BRANCH_RESUMED", campaignId: branch.campaignId, branchId: branch.branchId };
  }

  _resumableBranches(state, evidence) {
    return state.branches.filter((item) => item.archived === true && item.campaignId === evidence.campaignId && item.sourcePath === evidence.sourcePath && item.fingerprintHistory.includes(evidence.fingerprint));
  }

  observe(input) {
    const evidence = this.identity(input);
    if (!evidence) return { state: "BRANCH_UNKNOWN", campaignId: null, branchId: null };
    try {
      const state = this.load();
      const resumable = this._resumableBranches(state, evidence);
      const current = state.branches.find((item) => item.archived !== true && item.campaignId === evidence.campaignId && item.sourcePath === evidence.sourcePath);
      if (current) {
        const oldDate = normalizeGameDate(current.latestGameDate).serial;
        const newDate = normalizeGameDate(evidence.gameDate).serial;
        if (newDate === oldDate && current.fingerprint === evidence.fingerprint) {
          return { state: "SAME_BRANCH", campaignId: current.campaignId, branchId: current.branchId };
        }
      }
      if (resumable.length > 1) return {
        state: "BRANCH_RESUME_AMBIGUOUS",
        campaignId: evidence.campaignId,
        branchId: null,
        resumeCandidates: resumable.map((item) => ({ branchId: item.branchId, sourcePath: item.sourcePath, gameDate: item.latestGameDate || item.gameDate }))
      };
      if (resumable.length === 1 && (!current || current.fingerprint !== evidence.fingerprint)) {
        const result = this._resume(state, evidence, resumable[0]);
        this.save(state);
        return result;
      }
      if (current) {
        const oldDate = normalizeGameDate(current.latestGameDate).serial;
        const newDate = normalizeGameDate(evidence.gameDate).serial;
        if (newDate > oldDate) {
          // Old registry rows created before V8.7.2 have no load marker. Keep
          // their established autosave continuity, but once either side has a
          // marker, absence or mismatch is a hard load boundary.
          if ((evidence.loadSessionId || current.loadSessionId) && (!evidence.loadSessionId || !current.loadSessionId || evidence.loadSessionId !== current.loadSessionId)) return {
            state: "LOAD_BOUNDARY_CANDIDATE",
            campaignId: current.campaignId,
            branchId: current.branchId,
            reason: evidence.loadSessionId && current.loadSessionId ? "load_session_changed" : "load_session_unavailable"
          };
          this._touch(current, evidence);
          this.save(state);
          return { state: "SAME_BRANCH", campaignId: current.campaignId, branchId: current.branchId };
        }
        if (newDate < oldDate) return { state: "ROLLBACK_CANDIDATE", campaignId: evidence.campaignId, branchId: null, reason: "save_date_moved_backward" };
        if (newDate === oldDate && current.fingerprint !== evidence.fingerprint) return { state: "BRANCH_CONFLICT", campaignId: evidence.campaignId, branchId: null, reason: "same_date_different_content" };
        return { state: "SAME_BRANCH", campaignId: current.campaignId, branchId: current.branchId };
      }
      const sameCampaign = state.branches.some((item) => item.campaignId === evidence.campaignId);
      const timestamp = this.clock();
      const created = { ...evidence, currentFingerprint: evidence.fingerprint, fingerprintHistory: [evidence.fingerprint], latestGameDate: evidence.gameDate, status: "ACTIVE", archived: false, parentBranchId: null, forkedAt: null, archivedAt: null, lastSeenAt: timestamp, branchId: `branch_${crypto.randomUUID()}` };
      state.branches.push(created);
      this.save(state);
      return { state: sameCampaign ? "BRANCH_FORK_DETECTED" : "NEW_CAMPAIGN", campaignId: created.campaignId, branchId: created.branchId };
    } catch (error) {
      return { state: "BRANCH_CONFLICT", campaignId: evidence.campaignId, branchId: null, reason: error.message };
    }
  }

  resume(input, branchId) {
    const evidence = this.identity(input);
    if (!evidence || !/^branch_[a-f0-9-]{36}$/.test(branchId || "")) throw new Error("branch_resume_invalid");
    const state = this.load();
    const branch = state.branches.find((item) => item.archived === true && item.branchId === branchId && item.campaignId === evidence.campaignId && item.sourcePath === evidence.sourcePath && item.fingerprintHistory.includes(evidence.fingerprint));
    if (!branch) throw new Error("branch_resume_invalid");
    const result = this._resume(state, evidence, branch);
    this.save(state);
    return result;
  }

  confirmContinuation(input, branchId) {
    const evidence = this.identity(input);
    if (!evidence || !/^branch_[a-f0-9-]{36}$/.test(branchId || "")) throw new Error("branch_confirmation_invalid");
    const state = this.load();
    const branch = state.branches.find((item) => item.archived !== true && item.branchId === branchId && item.campaignId === evidence.campaignId && item.sourcePath === evidence.sourcePath);
    if (!branch) throw new Error("branch_confirmation_invalid");
    this._touch(branch, evidence);
    this.save(state);
    return { state: "SAME_BRANCH", campaignId: branch.campaignId, branchId: branch.branchId };
  }

  // Called only for an explicit rename, never inferred from an identical copy.
  rename(input, destination, expectedBranchId) {
    const evidence = this.identity(input);
    const next = this.identity({ ...input, sourcePath: destination });
    if (!evidence || !next) throw new Error("branch_rename_invalid");
    const state = this.load();
    const current = state.branches.find((item) => item.archived !== true && item.branchId === expectedBranchId && item.campaignId === evidence.campaignId && item.sourcePath === evidence.sourcePath && item.fingerprint === evidence.fingerprint);
    if (!current || state.branches.some((item) => item.archived !== true && item.campaignId === next.campaignId && item.sourcePath === next.sourcePath)) throw new Error("branch_rename_conflict");
    current.sourcePath = next.sourcePath;
    current.lastSeenAt = this.clock();
    this.save(state);
    return { state: "BRANCH_RENAMED", campaignId: current.campaignId, branchId: current.branchId };
  }

  fork(input) {
    const evidence = this.identity(input);
    if (!evidence) throw new Error("branch_identity_required");
    const state = this.load();
    const current = state.branches.find((item) => item.archived !== true && item.campaignId === evidence.campaignId && item.sourcePath === evidence.sourcePath);
    if (current) this._archive(current);
    const timestamp = this.clock();
    const created = { ...evidence, currentFingerprint: evidence.fingerprint, fingerprintHistory: [evidence.fingerprint], latestGameDate: evidence.gameDate, status: "ACTIVE", archived: false, parentBranchId: current?.branchId || null, forkedAt: timestamp, archivedAt: null, lastSeenAt: timestamp, branchId: `branch_${crypto.randomUUID()}` };
    state.branches.push(created);
    this.save(state);
    return { state: "BRANCH_FORK_DETECTED", campaignId: created.campaignId, branchId: created.branchId };
  }

  adoptRename(input, sourceBranchId, emptyTargetBranchId) {
    const evidence = this.identity(input);
    if (!evidence) throw new Error("branch_rename_invalid");
    const state = this.load();
    const source = state.branches.find((item) => item.archived !== true && item.branchId === sourceBranchId && item.campaignId === evidence.campaignId && item.fingerprint === evidence.fingerprint);
    const target = state.branches.find((item) => item.archived !== true && item.branchId === emptyTargetBranchId && item.sourcePath === evidence.sourcePath && item.campaignId === evidence.campaignId);
    if (!source || !target || source === target) throw new Error("branch_rename_conflict");
    this._archive(target);
    source.sourcePath = evidence.sourcePath;
    source.lastSeenAt = this.clock();
    this.save(state);
    return { state: "BRANCH_RENAMED", campaignId: source.campaignId, branchId: source.branchId };
  }
}

module.exports = { BranchRegistry };
