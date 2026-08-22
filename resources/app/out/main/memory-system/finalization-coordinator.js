"use strict";

class FinalizationCoordinator {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.tail = Promise.resolve();
    this.inFlight = new Map();
    this.pendingCount = 0;
  }

  enqueue(key, task) {
    const taskKey = String(key || "unknown");
    if (this.inFlight.has(taskKey)) return this.inFlight.get(taskKey);
    if (typeof task !== "function") throw new Error("finalization_task_required");
    this.pendingCount++;
    const prior = this.tail.catch(() => void 0);
    let tracked;
    const result = prior.then(() => task());
    tracked = result.finally(() => {
      if (this.inFlight.get(taskKey) === tracked) this.inFlight.delete(taskKey);
      this.pendingCount = Math.max(0, this.pendingCount - 1);
    });
    this.inFlight.set(taskKey, tracked);
    this.tail = tracked.catch((error) => {
      this.logger?.error?.(`[FinalizationCoordinator] ${taskKey} failed:`, error);
    });
    return tracked;
  }

  async drain({ timeoutMs = 15000 } = {}) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (this.pendingCount > 0) {
      const currentTail = this.tail;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return { drained: false, timedOut: true, pendingCount: this.pendingCount };
      let timeoutId;
      const outcome = await Promise.race([
        currentTail.then(() => "settled"),
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve("timeout"), remainingMs);
        })
      ]);
      if (timeoutId) clearTimeout(timeoutId);
      if (outcome === "timeout") return { drained: false, timedOut: true, pendingCount: this.pendingCount };
      if (currentTail === this.tail && this.pendingCount === 0) break;
    }
    return { drained: true, timedOut: false, pendingCount: 0 };
  }
}

module.exports = { FinalizationCoordinator };
