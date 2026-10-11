"use strict";

// All timestamps stay in this Renderer. Only durations and counts cross IPC.
(async () => {
  const api = window.performanceDiagnosticsAPI;
  if (!api) return;
  try {
    if (!(await api.getState()).enabled) return;
  } catch (_error) {
    return;
  }
  const queue = [];
  const observers = [];
  let frameRequest = null;
  let previousFrame = null;
  let inputPending = false;
  let stopped = false;
  function record(step, wallMs) {
    if (stopped || !Number.isFinite(wallMs) || wallMs < 0 || wallMs > 60000 || queue.length >= 32) return;
    queue.push({ step, wallMs, count: 1, result: "OK" });
  }
  function nextFrame(timestamp) {
    if (stopped) return;
    if (!document.hidden && previousFrame !== null && timestamp - previousFrame > 50) {
      record("renderer.frameGap", timestamp - previousFrame);
    }
    previousFrame = document.hidden ? null : timestamp;
    frameRequest = requestAnimationFrame(nextFrame);
  }
  function onInput() {
    if (inputPending || stopped || document.hidden) return;
    inputPending = true;
    const started = performance.now();
    requestAnimationFrame(() => {
      inputPending = false;
      record("renderer.inputToFrame", performance.now() - started);
    });
  }
  if (typeof PerformanceObserver === "function") {
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (queue.length >= 32) break;
          record("renderer.longTask", entry.duration);
        }
      });
      observer.observe({ type: "longtask", buffered: false });
      observers.push(observer);
    } catch (_error) {
      // Some Electron builds do not expose the Long Task API.
    }
  }
  record("renderer.firstReady", performance.now());
  document.addEventListener("pointerdown", onInput, { passive: true });
  document.addEventListener("keydown", onInput, { passive: true });
  frameRequest = requestAnimationFrame(nextFrame);
  const flushTimer = setInterval(() => {
    try {
      if (queue.length) api.recordRendererMetrics(queue.splice(0, 32)).catch(() => {});
    } catch (_error) {
      // Diagnostics must not make an otherwise working window fail.
    }
  }, 1000);
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "导出性能诊断";
  exportButton.style.cssText = "position:fixed;right:16px;bottom:48px;z-index:10000;padding:6px 10px;background:#ecf0e8;color:#253a35;border:1px solid #8aaba0;border-radius:4px;cursor:pointer";
  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    try {
      const result = await api.exportReport();
      exportButton.textContent = result.exported ? "诊断已导出" : result.reason === "CANCELLED" ? "导出性能诊断" : "诊断导出失败";
    } catch (_error) {
      exportButton.textContent = "诊断导出失败";
    } finally {
      exportButton.disabled = false;
    }
  });
  document.body.appendChild(exportButton);
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearInterval(flushTimer);
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    for (const observer of observers) observer.disconnect();
    document.removeEventListener("pointerdown", onInput);
    document.removeEventListener("keydown", onInput);
    exportButton.remove();
  }, { once: true });
})();
