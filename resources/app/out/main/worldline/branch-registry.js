"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { normalizeGameDate } = require("./character-temporal-facts");
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

class BranchRegistry {
  constructor({ root }) {
    this.file = path.join(root, "branch-registry.json");
  }

  load() {
    let state;
    try { state = JSON.parse(fs.readFileSync(this.file, "utf8")); }
    catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: 1, branches: [] };
      throw new Error("branch_registry_unreadable");
    }
    if (state.schemaVersion !== 1 || !Array.isArray(state.branches)) throw new Error("branch_registry_invalid");
    const ids = new Set();
    const paths = new Set();
    for (const item of state.branches) {
      const key = `${item.campaignId}:${item.sourcePath}`;
      if (!/^campaign_[a-f0-9]{64}$/.test(item.campaignId) || !/^branch_[a-f0-9-]{36}$/.test(item.branchId) || typeof item.sourcePath !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint) || !normalizeGameDate(item.gameDate) || ids.has(item.branchId) || item.archived !== true && paths.has(key)) throw new Error("branch_registry_invalid");
      ids.add(item.branchId);
      if (item.archived !== true) paths.add(key);
    }
    return state;
  }

  save(state) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temporary, "wx");
      fs.writeFileSync(fd, JSON.stringify(state));
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
    if (typeof input?.campaignToken !== "string" || !input.campaignToken.trim() || input.campaignToken.length > 256 || typeof input.sourcePath !== "string" || !path.win32.isAbsolute(input.sourcePath) || !/^[a-f0-9]{64}$/.test(input.fingerprint || "") || !normalizeGameDate(input.gameDate)) return null;
    return { campaignId: `campaign_${digest(input.campaignToken)}`, sourcePath: path.win32.normalize(input.sourcePath).toLowerCase(), fingerprint: input.fingerprint, gameDate: input.gameDate };
  }

  observe(input) {
    const evidence = this.identity(input);
    if (!evidence) return { state: "BRANCH_UNKNOWN", campaignId: null, branchId: null };
    try {
      const state = this.load();
      const current = state.branches.find((item) => item.archived !== true && item.campaignId === evidence.campaignId && item.sourcePath === evidence.sourcePath);
      if (current) {
        const oldDate = normalizeGameDate(current.gameDate).serial;
        const newDate = normalizeGameDate(evidence.gameDate).serial;
        if (newDate < oldDate || newDate === oldDate && current.fingerprint !== evidence.fingerprint) return { state: "BRANCH_CONFLICT", campaignId: evidence.campaignId, branchId: null };
        if (current.fingerprint !== evidence.fingerprint && input.confirmedContinuationOf !== current.fingerprint) return { state: "BRANCH_UNKNOWN", campaignId: evidence.campaignId, branchId: null, reason: "save_continuity_unverified" };
        if (current.fingerprint !== evidence.fingerprint) {
          Object.assign(current, evidence);
          this.save(state);
        }
        return { state: "SAME_BRANCH", campaignId: current.campaignId, branchId: current.branchId };
      }
      const sameCampaign = state.branches.some((item) => item.campaignId === evidence.campaignId);
      const created = { ...evidence, branchId: `branch_${crypto.randomUUID()}` };
      state.branches.push(created);
      this.save(state);
      return { state: sameCampaign ? "BRANCH_FORK_DETECTED" : "NEW_CAMPAIGN", campaignId: created.campaignId, branchId: created.branchId };
    } catch (error) {
      return { state: "BRANCH_CONFLICT", campaignId: evidence.campaignId, branchId: null, reason: error.message };
    }
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
    this.save(state);
    return { state: "BRANCH_RENAMED", campaignId: current.campaignId, branchId: current.branchId };
  }

  fork(input) {
    const evidence = this.identity(input);
    if (!evidence) throw new Error("branch_identity_required");
    const state = this.load();
    const current = state.branches.find(item => item.archived !== true && item.campaignId === evidence.campaignId && item.sourcePath === evidence.sourcePath);
    if (current) current.archived = true;
    const created = { ...evidence, branchId: `branch_${crypto.randomUUID()}` };
    state.branches.push(created);
    this.save(state);
    return { state: "BRANCH_FORK_DETECTED", campaignId: created.campaignId, branchId: created.branchId };
  }

  adoptRename(input, sourceBranchId, emptyTargetBranchId) {
    const evidence = this.identity(input);
    if (!evidence) throw new Error("branch_rename_invalid");
    const state = this.load();
    const source = state.branches.find(item => item.archived !== true && item.branchId === sourceBranchId && item.campaignId === evidence.campaignId && item.fingerprint === evidence.fingerprint);
    const target = state.branches.find(item => item.archived !== true && item.branchId === emptyTargetBranchId && item.sourcePath === evidence.sourcePath && item.campaignId === evidence.campaignId);
    if (!source || !target || source === target) throw new Error("branch_rename_conflict");
    target.archived = true;
    source.sourcePath = evidence.sourcePath;
    this.save(state);
    return { state: "BRANCH_RENAMED", campaignId: source.campaignId, branchId: source.branchId };
  }
}

module.exports = { BranchRegistry };
