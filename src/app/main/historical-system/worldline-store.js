"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");

const WORLDLINE_SCHEMA_VERSION = 1;
const PERSISTENT_CAMPAIGN_ID_PATTERN = /^ck3-[a-f0-9]{32}$/;
const TOKEN_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

function assertPersistentIdentity(identity) {
  if (!identity || typeof identity !== "object") throw new Error("worldline_identity_required");
  if (identity.persistenceAllowed !== true || identity.source !== "ck3_mod_token") throw new Error("worldline_identity_not_persistent");
  if (!PERSISTENT_CAMPAIGN_ID_PATTERN.test(identity.campaignId || "")) throw new Error("worldline_campaign_id_invalid");
  if (!TOKEN_FINGERPRINT_PATTERN.test(identity.tokenFingerprint || "")) throw new Error("worldline_token_fingerprint_invalid");
  return identity;
}

function assertIsoDate(value, label) {
  if (typeof value !== "string") throw new Error(`${label}_invalid`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(`${label}_invalid`);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function validateWorldlineState(state, expectedCampaignId = null) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("worldline_state_invalid");
  if (state.schemaVersion !== WORLDLINE_SCHEMA_VERSION) throw new Error(`worldline_schema_unsupported:${state.schemaVersion}`);
  if (!PERSISTENT_CAMPAIGN_ID_PATTERN.test(state.campaignId || "")) throw new Error("worldline_campaign_id_invalid");
  if (expectedCampaignId !== null && state.campaignId !== expectedCampaignId) throw new Error(`worldline_campaign_mismatch:${state.campaignId}:${expectedCampaignId}`);
  if (!state.identity || state.identity.source !== "ck3_mod_token") throw new Error("worldline_identity_source_invalid");
  if (!TOKEN_FINGERPRINT_PATTERN.test(state.identity.tokenFingerprint || "")) throw new Error("worldline_token_fingerprint_invalid");
  if (state.mode !== "shadow") throw new Error(`worldline_mode_invalid:${state.mode}`);
  assertIsoDate(state.createdAt, "worldline_created_at");
  assertIsoDate(state.updatedAt, "worldline_updated_at");
  if (state.updatedAt < state.createdAt) throw new Error("worldline_timestamp_order_invalid");
  return state;
}

function createWorldlineState(identity, timestamp) {
  assertPersistentIdentity(identity);
  assertIsoDate(timestamp, "worldline_timestamp");
  return deepFreeze({
    schemaVersion: WORLDLINE_SCHEMA_VERSION,
    campaignId: identity.campaignId,
    identity: {
      source: identity.source,
      tokenFingerprint: identity.tokenFingerprint
    },
    mode: "shadow",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

class WorldlineStore {
  constructor({ rootDir, clock = () => new Date().toISOString() }) {
    if (typeof rootDir !== "string" || !rootDir.trim()) throw new Error("worldline_root_dir_required");
    this.rootDir = path.resolve(rootDir);
    this.clock = clock;
  }

  getWorldlinePath(identity) {
    assertPersistentIdentity(identity);
    return path.join(this.rootDir, identity.campaignId, "worldline.json");
  }

  load(identity) {
    const worldlinePath = this.getWorldlinePath(identity);
    if (!fs.existsSync(worldlinePath)) return null;
    const raw = fs.readFileSync(worldlinePath, "utf8");
    let state;
    try {
      state = JSON.parse(raw);
    } catch (error) {
      throw new Error(`worldline_json_invalid:${error.message}`);
    }
    validateWorldlineState(state, identity.campaignId);
    if (state.identity.tokenFingerprint !== identity.tokenFingerprint) throw new Error("worldline_token_fingerprint_mismatch");
    return deepFreeze(state);
  }

  save(identity, state) {
    const worldlinePath = this.getWorldlinePath(identity);
    validateWorldlineState(state, identity.campaignId);
    if (state.identity.tokenFingerprint !== identity.tokenFingerprint) throw new Error("worldline_token_fingerprint_mismatch");
    const directory = path.dirname(worldlinePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = path.join(directory, `.worldline.json.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`);
    let fileDescriptor = null;
    try {
      fileDescriptor = fs.openSync(tempPath, "wx");
      fs.writeFileSync(fileDescriptor, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      fs.fsyncSync(fileDescriptor);
      fs.closeSync(fileDescriptor);
      fileDescriptor = null;
      fs.renameSync(tempPath, worldlinePath);
    } catch (error) {
      try {
        if (fileDescriptor !== null) fs.closeSync(fileDescriptor);
      } catch {}
      try {
        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      } catch {}
      throw error;
    }
    return worldlinePath;
  }

  loadOrCreate(identity) {
    if (!identity || identity.persistenceAllowed !== true) return { status: "persistence_skipped", state: null, path: null };
    const existing = this.load(identity);
    if (existing) return { status: "loaded", state: existing, path: this.getWorldlinePath(identity) };
    const state = createWorldlineState(identity, this.clock());
    const worldlinePath = this.save(identity, state);
    return { status: "created", state, path: worldlinePath };
  }
}

module.exports = {
  WORLDLINE_SCHEMA_VERSION,
  validateWorldlineState,
  createWorldlineState,
  WorldlineStore
};
