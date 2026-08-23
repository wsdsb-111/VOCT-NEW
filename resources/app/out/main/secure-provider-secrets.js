"use strict";

class SecureProviderSecrets {
  constructor({ safeStorage, store, logger = console } = {}) {
    this.safeStorage = safeStorage;
    this.store = store;
    this.logger = logger;
  }

  isAvailable() {
    try {
      return this.safeStorage?.isEncryptionAvailable() === true;
    } catch {
      return false;
    }
  }

  readCiphertexts() {
    const stored = this.store.get("providerKeys", {});
    return stored && typeof stored === "object" ? { ...stored } : {};
  }

  writeCiphertexts(values) {
    this.store.set("providerKeys", values);
  }

  encrypt(apiKey) {
    if (!this.isAvailable()) throw new Error("secure_storage_unavailable");
    return this.safeStorage.encryptString(String(apiKey)).toString("base64");
  }

  decrypt(ciphertext) {
    if (!ciphertext || !this.isAvailable()) return "";
    try {
      return this.safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
    } catch (error) {
      this.logger.error("[SecureProviderSecrets] Failed to decrypt a provider key:", error);
      return "";
    }
  }

  hydrateSettings(settings) {
    const ciphertexts = this.readCiphertexts();
    const hydrate = (config) => {
      if (!config?.instanceId) return { ...config };
      const decrypted = this.decrypt(ciphertexts[config.instanceId]);
      return { ...config, apiKey: decrypted || config.apiKey || "" };
    };
    return {
      ...settings,
      providers: (settings?.providers || []).map(hydrate),
      presets: (settings?.presets || []).map(hydrate)
    };
  }

  sealSettings(settings) {
    if (!this.isAvailable()) throw new Error("secure_storage_unavailable");
    const ciphertexts = this.readCiphertexts();
    const seal = (config) => {
      if (!config?.instanceId) return { ...config, apiKey: "" };
      const apiKey = String(config.apiKey || "");
      if (apiKey) ciphertexts[config.instanceId] = this.encrypt(apiKey);
      else delete ciphertexts[config.instanceId];
      return { ...config, apiKey: "" };
    };
    const sealed = {
      ...settings,
      providers: (settings?.providers || []).map(seal),
      presets: (settings?.presets || []).map(seal)
    };
    this.writeCiphertexts(ciphertexts);
    return sealed;
  }

  migratePlaintextSettings(settings) {
    const configs = [...(settings?.providers || []), ...(settings?.presets || [])];
    if (!configs.some((config) => String(config?.apiKey || ""))) return { migrated: false, settings };
    if (!this.isAvailable()) return { migrated: false, deferred: true, settings };
    return { migrated: true, settings: this.sealSettings(settings) };
  }
}

module.exports = { SecureProviderSecrets };
