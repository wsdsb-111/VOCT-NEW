/**
 * Page/view swap helper for Codex tab containers.
 * Pure UI motion: the caller owns the render function and data.
 */
import { isReducedMotion } from "./dom.js";

const transitionSequenceByHost = new WeakMap();

export function swapView(container, render, { duration = 130 } = {}) {
  if (!container || typeof render !== "function") return Promise.resolve();
  const sequence = (transitionSequenceByHost.get(container) || 0) + 1;
  transitionSequenceByHost.set(container, sequence);
  const isCurrent = () => transitionSequenceByHost.get(container) === sequence && container.isConnected;
  if (!isCurrent()) return Promise.resolve();
  if (isReducedMotion()) {
    container.classList.remove("v95-swap-out");
    render();
    if (!isCurrent()) return Promise.resolve();
    container.classList.add("v95-swap-in");
    window.requestAnimationFrame(() => {
      if (isCurrent()) container.classList.remove("v95-swap-in");
    });
    return Promise.resolve();
  }
  container.classList.add("v95-swap-out");
  return new Promise(resolve => {
    window.setTimeout(() => {
      if (!isCurrent()) {
        resolve();
        return;
      }
      try {
        render();
      } finally {
        if (isCurrent()) {
          container.classList.remove("v95-swap-out");
          container.classList.add("v95-swap-in");
          window.setTimeout(() => {
            if (isCurrent()) container.classList.remove("v95-swap-in");
          }, Math.max(0, duration));
        }
        resolve();
      }
    }, Math.max(0, duration));
  });
}

/** Add the short entrance class to a freshly mounted visual root. */
export function markEntered(node) {
  if (!node) return;
  node.classList.add("v95-view--entering");
  window.setTimeout(() => node.classList.remove("v95-view--entering"), 320);
}
