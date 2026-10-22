import { createContextEpoch } from "./context-epoch.js";
import { createScopedResourceStore } from "./scoped-resource-store.js";
import { createRequestController } from "./request-controller.js";

// The caller supplies an already-whitelisted read, never a write operation.
export function createReadBoundary(runtime, viewKey) {
  const contextEpoch = createContextEpoch();
  const resourceStore = createScopedResourceStore(contextEpoch);
  const controller = createRequestController({ contextEpoch, resourceStore });
  let identity = null;
  let disposed = false;
  let generation = 0;
  const sequences = new Map();
  function sync(context) {
    const next = JSON.stringify([context?.campaignTag ?? null, context?.ownerTag ?? null,
      context?.conversationTag ?? null, context?.conversationEpoch ?? null, context?.isActive ?? false]);
    if (next === identity) return;
    identity = next;
    generation += 1;
    sequences.clear();
    controller.cancelAll();
    contextEpoch.setContext({ campaignKey: context?.campaignTag ?? null,
      conversationKey: JSON.stringify([context?.conversationTag ?? null, context?.conversationEpoch ?? null]),
      viewKey: JSON.stringify([viewKey, context?.ownerTag ?? null]) });
    resourceStore.activateScope(`view:${viewKey}`);
  }
  sync(runtime.getContext());
  const unsubscribe = runtime.subscribeContext(sync);
  return Object.freeze({
    async run(resourceKey, load) {
      if (disposed) return Promise.resolve({ committed: false, errorCode: "REQUEST_CANCELLED" });
      const expectedGeneration = generation;
      const sequence = (sequences.get(resourceKey) || 0) + 1;
      sequences.set(resourceKey, sequence);
      const result = await controller.read(resourceKey, load);
      return { ...result, isCurrent: () => !disposed && generation === expectedGeneration
        && sequences.get(resourceKey) === sequence };
    },
    cancel(resourceKey) {
      sequences.set(resourceKey, (sequences.get(resourceKey) || 0) + 1);
      controller.cancel(resourceKey);
    },
    capture() {
      const expectedGeneration = generation;
      return () => !disposed && generation === expectedGeneration;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      unsubscribe();
      controller.dispose();
      resourceStore.clear();
    }
  });
}
