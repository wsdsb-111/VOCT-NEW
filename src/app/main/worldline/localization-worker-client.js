"use strict";

const fs = require("fs");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { CK3LocalizationResolver } = require("./localization-resolver");

if (!isMainThread && workerData?.worldlineLocalization) {
  const resolver = new CK3LocalizationResolver({ fs, path, getCK3UserFolderPath: () => workerData.userFolder });
  parentPort.on("message", ({ key, method, args }) => {
    try { parentPort.postMessage({ key, result: resolver[method](...args) }); }
    catch (_error) { parentPort.postMessage({ key, failed: true }); }
  });
}

// The synchronous Prompt path only reads this cache. File discovery and scans
// run in a worker; incomplete evidence must never become a guessed identity.
class LocalizationWorkerClient {
  constructor({ getCK3UserFolderPath, onUpdated = () => {}, WorkerClass = Worker } = {}) {
    this.getFolder = getCK3UserFolderPath || (() => null);
    this.onUpdated = onUpdated;
    this.WorkerClass = WorkerClass;
    this.cache = new Map();
    this.pending = new Map();
    this.worker = null;
    this.signature = null;
    this.failed = false;
    this.revision = 0;
  }

  invalidate() {
    this.revision += 1;
    const previous = this.worker;
    this.worker = null;
    if (previous) previous.terminate();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.finish(); }
    this.pending.clear();
    this.cache.clear();
    this.failed = false;
    this.signature = null;
  }

  _request(method, args, fallback) {
    const userFolder = this.getFolder();
    let signature = userFolder || "none";
    if (userFolder) {
      try { const stat = fs.statSync(path.join(userFolder, "dlc_load.json")); signature += `:${stat.size}:${stat.mtimeMs}`; }
      catch (_error) { signature += ":unavailable"; }
    }
    if (signature !== this.signature) { this.invalidate(); this.signature = signature; }
    if (!userFolder) return { ...fallback, pending: false };
    const key = JSON.stringify([method, ...args]);
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.failed) return { ...fallback, pending: false, workerFailed: true };
    if (this.pending.has(key) || this.pending.size >= 32) return fallback;
    try {
      if (!this.worker) {
        const worker = new this.WorkerClass(__filename, { workerData: { worldlineLocalization: true, userFolder } });
        this.worker = worker;
        worker.unref();
        worker.on("message", ({ key: resultKey, result, failed }) => {
          if (this.worker !== worker) return;
          const request = this.pending.get(resultKey);
          if (!request) return;
          this.cache.set(resultKey, failed ? { ...request.fallback, pending: false, workerFailed: true } : result);
          if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value);
          clearTimeout(request.timer);
          this.pending.delete(resultKey);
          this.revision += 1;
          request.finish();
          if (!this.pending.size) this.onUpdated();
        });
        const fail = () => {
          if (this.worker !== worker) return;
          this.invalidate();
          this.signature = signature;
          this.failed = true;
          this.onUpdated();
        };
        worker.on("error", fail);
        worker.on("exit", fail);
      }
      let finish;
      const promise = new Promise(resolve => { finish = resolve; });
      const timer = setTimeout(() => {
        this.invalidate(); this.signature = signature; this.failed = true; this.onUpdated();
      }, 30000);
      timer.unref();
      this.pending.set(key, { promise, finish, timer, fallback });
      this.worker.postMessage({ key, method, args });
    } catch (_error) {
      this.invalidate(); this.signature = signature; this.failed = true;
    }
    return fallback;
  }

  resolve(type, rawKey) {
    return this._request("resolve", [type, rawKey], { rawKey, localizedValue: rawKey, language: "simp_chinese", confidence: "INCOMPLETE_SOURCE_SCAN", pending: true });
  }

  resolveForDisplay(type, rawKey) {
    if (/[^\x00-\x7F]|\s/.test(String(rawKey || ""))) return { rawKey, localizedValue: rawKey, confidence: "DISPLAY_LITERAL" };
    return this._request("resolveForDisplay", [type, rawKey], { rawKey, localizedValue: rawKey, confidence: "INCOMPLETE_SOURCE_SCAN", pending: true });
  }

  findRawKeysByLocalizedValue(type, value, options = {}) {
    return this._request("findRawKeysByLocalizedValue", [type, value, options], { status: "INCOMPLETE_SOURCE_SCAN", matches: [], matchedRawKeys: [], sourceComplete: false, scannedFiles: 0, missingDescriptors: [], pending: true });
  }

  async settle(timeoutMs) {
    if (!this.pending.size) return;
    let timer;
    try { await Promise.race([Promise.all([...this.pending.values()].map(request => request.promise)), new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }

  dispose() { this.invalidate(); }
}

module.exports = { LocalizationWorkerClient };
