import { createContractError } from "../contracts/errors.v1.js";

export function createEventSubscriptions() {
  const entries = new Map();

  function unsubscribeEntry(key, entry) {
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    entry.active = false;
    entry.listeners.clear();
    const unsubscribe = entry.unsubscribe;
    entry.unsubscribe = null;
    if (typeof unsubscribe === "function") {
      try {
        unsubscribe();
      } catch (_ignored) {
        // Never expose host event errors to the renderer.
      }
    }
  }

  function subscribe(key, register, listener) {
    if (typeof key !== "string" || key.length === 0 || typeof register !== "function" || typeof listener !== "function") {
      throw createContractError("VALIDATION_ERROR");
    }
    let entry = entries.get(key);
    const subscription = { listener };
    if (entry) {
      entry.listeners.add(subscription);
    } else {
      entry = { active: true, listeners: new Set([subscription]), unsubscribe: null };
      entries.set(key, entry);
      const dispatch = value => {
        if (!entry.active) return;
        for (const item of Array.from(entry.listeners)) {
          try {
            item.listener(value);
          } catch (_ignored) {
            // A broken view listener must not interrupt other subscribers.
          }
        }
      };
      try {
        const unsubscribe = register(dispatch);
        if (typeof unsubscribe !== "function") throw createContractError("IPC_UNAVAILABLE");
        entry.unsubscribe = unsubscribe;
      } catch (_ignored) {
        unsubscribeEntry(key, entry);
        throw createContractError("IPC_UNAVAILABLE");
      }
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      entry.listeners.delete(subscription);
      if (entry.listeners.size === 0) unsubscribeEntry(key, entry);
    };
  }

  function dispose() {
    for (const [key, entry] of Array.from(entries.entries())) unsubscribeEntry(key, entry);
  }

  return Object.freeze({ subscribe, dispose, activeCount: () => entries.size });
}
