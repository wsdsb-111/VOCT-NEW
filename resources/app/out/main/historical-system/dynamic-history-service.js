"use strict";

class DynamicHistoryService {
  constructor({ identityResolver, worldlineStore, historicalFigureResolver = null }) {
    if (!identityResolver || typeof identityResolver.resolve !== "function") throw new Error("dynamic_history_identity_resolver_required");
    if (!worldlineStore || typeof worldlineStore.loadOrCreate !== "function") throw new Error("dynamic_history_worldline_store_required");
    if (historicalFigureResolver !== null && typeof historicalFigureResolver.resolve !== "function") throw new Error("dynamic_history_figure_resolver_invalid");
    this.identityResolver = identityResolver;
    this.worldlineStore = worldlineStore;
    this.historicalFigureResolver = historicalFigureResolver;
    this.diagnostics = [];
  }

  updateFromGameData(gameData) {
    if (!gameData || typeof gameData !== "object") throw new Error("dynamic_history_game_data_required");
    const identity = this.identityResolver.resolve(gameData.campaignToken);
    const dynamicHistory = this.getOrCreateContext(gameData);
    dynamicHistory.campaignId = identity.campaignId;
    dynamicHistory.campaignIdentity = identity;
    dynamicHistory.worldlineState = null;
    dynamicHistory.figureResolution = null;
    let result;
    if (!identity.persistenceAllowed) {
      dynamicHistory.persistenceStatus = "persistence_skipped";
      result = { status: "persistence_skipped", state: null, path: null };
    } else {
      try {
        result = this.worldlineStore.loadOrCreate(identity);
        dynamicHistory.worldlineState = result.state;
        dynamicHistory.persistenceStatus = result.status;
      } catch (error) {
        const diagnostic = this.recordDiagnostic("WORLDLINE_PERSISTENCE_FAILED", identity.campaignId, error);
        console.error("[DynamicHistory] Worldline persistence failed:", diagnostic.message);
        dynamicHistory.persistenceStatus = "error";
        result = { status: "error", state: null, path: null };
      }
    }
    this.updateFigureResolution(gameData, dynamicHistory, identity);
    return result;
  }

  updateFigureResolution(gameData, dynamicHistory, identity) {
    if (!this.historicalFigureResolver) return;
    try {
      dynamicHistory.figureResolution = this.historicalFigureResolver.resolve(gameData);
    } catch (error) {
      const diagnostic = this.recordDiagnostic("HISTORICAL_FIGURE_RESOLUTION_FAILED", identity.campaignId, error);
      console.error("[DynamicHistory] Historical figure resolution failed:", diagnostic.message);
      dynamicHistory.figureResolution = Object.freeze({ status: "error", summary: null, results: Object.freeze([]) });
    }
  }

  recordDiagnostic(code, campaignId, error) {
    const diagnostic = Object.freeze({ code, campaignId, message: error?.message || String(error) });
    this.diagnostics.push(diagnostic);
    if (this.diagnostics.length > 100) this.diagnostics.shift();
    return diagnostic;
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
      persistenceStatus: null,
      figureResolution: null
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
