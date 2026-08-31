"use strict";

class DynamicHistoryService {
  constructor({ identityResolver, worldlineStore }) {
    if (!identityResolver || typeof identityResolver.resolve !== "function") throw new Error("dynamic_history_identity_resolver_required");
    if (!worldlineStore || typeof worldlineStore.loadOrCreate !== "function") throw new Error("dynamic_history_worldline_store_required");
    this.identityResolver = identityResolver;
    this.worldlineStore = worldlineStore;
    this.diagnostics = [];
  }

  updateFromGameData(gameData) {
    if (!gameData || typeof gameData !== "object") throw new Error("dynamic_history_game_data_required");
    const identity = this.identityResolver.resolve(gameData.campaignToken);
    const dynamicHistory = this.getOrCreateContext(gameData);
    dynamicHistory.campaignId = identity.campaignId;
    dynamicHistory.campaignIdentity = identity;
    dynamicHistory.worldlineState = null;
    if (!identity.persistenceAllowed) {
      dynamicHistory.persistenceStatus = "persistence_skipped";
      return { status: "persistence_skipped", state: null, path: null };
    }
    try {
      const result = this.worldlineStore.loadOrCreate(identity);
      dynamicHistory.worldlineState = result.state;
      dynamicHistory.persistenceStatus = result.status;
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
      dynamicHistory.persistenceStatus = "error";
      return { status: "error", state: null, path: null };
    }
  }

  getOrCreateContext(gameData) {
    if (Object.prototype.hasOwnProperty.call(gameData, "dynamicHistory")) {
      const context = gameData.dynamicHistory;
      if (!context || typeof context !== "object") throw new Error("dynamic_history_context_invalid");
      return context;
    }
    const context = {
      campaignId: null,
      campaignIdentity: null,
      worldlineState: null,
      persistenceStatus: null
    };
    Object.defineProperty(gameData, "dynamicHistory", {
      value: context,
      enumerable: false,
      writable: false,
      configurable: false
    });
    Object.defineProperty(gameData, "historicalCampaignIdentity", {
      get: () => context.campaignIdentity,
      enumerable: false,
      configurable: false
    });
    return context;
  }

  getWorldlineState(gameData) {
    if (!gameData || typeof gameData !== "object") return null;
    return gameData.dynamicHistory?.worldlineState || null;
  }

  getDiagnostics() {
    return [...this.diagnostics];
  }
}

module.exports = { DynamicHistoryService };
