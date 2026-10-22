import { startServer } from "../serve.mjs";
import { launchBrowser } from "./browser.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const server = await startServer({ port: 0 });
const browser = await launchBrowser({ url: server.url, width: 1600, height: 1100 });
const shot = name => fileURLToPath(new URL(`../screenshots/${name}`, import.meta.url));
try {
  for (const state of ["empty", "loading", "error", "stale", "refreshing", "idle"]) {
    await browser.evaluate(`window.__v95demo.setAsyncState("${state}")`);
    await delay(250);
    const info = await browser.evaluate(`({
      state: window.__v95demo.getState().asyncState,
      skeletons: document.querySelectorAll('.v95-skeleton-row').length,
      statePanels: document.querySelectorAll('.v95-state-panel').length,
      inline: document.querySelectorAll('.v95-inline-status').length,
      rows: document.querySelectorAll('.v95-row').length,
      busy: document.querySelectorAll('.v95-view[aria-busy="true"]').length
    })`);
    console.log(info);
    await browser.screenshot(shot(`state-${state}.png`), { fullPage: true });
  }
  console.log("errors", browser.errors, browser.consoleErrors, browser.failedRequests.slice(0, 5));
} finally {
  await browser.close();
  await server.close();
}
