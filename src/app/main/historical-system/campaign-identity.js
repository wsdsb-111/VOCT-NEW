"use strict";

const crypto = require("node:crypto");

const CK3_CAMPAIGN_TOKEN_PATTERN = /^votc8c-[0-9]{12}$/;

class CampaignIdentityResolver {
  constructor({ createSessionId = () => crypto.randomUUID() } = {}) {
    this.sessionId = String(createSessionId());
    if (!/^[A-Za-z0-9_-]+$/.test(this.sessionId)) throw new Error("campaign_session_id_invalid");
    this.sessionIdentity = Object.freeze({
      campaignId: `session-${this.sessionId}`,
      source: "session",
      persistenceAllowed: false,
      tokenFingerprint: null
    });
  }

  resolve(stableToken) {
    const normalized = typeof stableToken === "string" ? stableToken.trim() : "";
    if (!CK3_CAMPAIGN_TOKEN_PATTERN.test(normalized)) return this.sessionIdentity;
    const tokenFingerprint = crypto.createHash("sha256").update(normalized).digest("hex");
    return Object.freeze({
      campaignId: `ck3-${tokenFingerprint.slice(0, 32)}`,
      source: "ck3_mod_token",
      persistenceAllowed: true,
      tokenFingerprint
    });
  }
}

module.exports = { CK3_CAMPAIGN_TOKEN_PATTERN, CampaignIdentityResolver };
