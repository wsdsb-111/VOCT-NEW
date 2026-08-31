"use strict";

class DynamicHistoryService {
  constructor({ identityResolver, worldlineStore }) {
    if (!identityResolver || typeof identityResolver.resolve !== "function") throw new Error("dynamic_history_identity_resolver_required");
    if (!worldlineStore || typeof worldlineStore.loadOrCreate !== "function") throw new Error("dynamic_history_worldline_store_required");
    this.identityResolver = identityResolver;
    this.worldlineStore = worldlineStore;
    this.worldlineState = null;
    this.diagnostics = [];
  }

  updateFromGameData(gameData) {
    if (!gameData || typeof gameData !== "object") throw new Error("dynamic_history_game_data_required");
    const identity = this.identityResolver.resolve(gameData.campaignToken);
    Object.defineProperty(gameData, "historicalCampaignIdentity", {
      value: identity,
      enumerable: true,
      writable: false,
      configurable: false
    });
    this.worldlineState = null;
    if (!identity.persistenceAllowed) return { status: "persistence_skipped", state: null, path: null };
    try {
      const result = this.worldlineStore.loadOrCreate(identity);
      this.worldlineState = result.state;
      return result;
    } catch (error) {
      const diagnostic = Object.freeze({
        code: "WORLDLINE_PERSISTENCE_FAILED",
        campaignId: identity.campaignId,
        message: error?.message || String(error)
      });
      this.diagnostics.push(diagnostic);
      if (this.diagnostics.length > 100) this.diagnostics.shift();
      console.error("[DynamicHistory] Worldline persistence failed:", diagnostic.message);
      return { status: "error", state: null, path: null };
    }
  }

  getWorldlineState() {
    return this.worldlineState;
  }

  getDiagnostics() {
    return [...this.diagnostics];
  }
}

module.exports = { DynamicHistoryService };
