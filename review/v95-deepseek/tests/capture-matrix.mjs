import { startServer } from "../serve.mjs";
import { launchBrowser } from "./browser.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const server = await startServer({ port: 0 });
const browser = await launchBrowser({ url: server.url, width: 1600, height: 1100 });
const shot = name => fileURLToPath(new URL(`../screenshots/${name}`, import.meta.url));
try {
  for (const theme of ["parchment", "knight", "ink"]) {
    await browser.evaluate(`window.__v95demo.setTheme("${theme}"); window.__v95demo.setLanguage("zh-CN")`);
    await delay(350);
    await browser.screenshot(shot(`matrix-${theme}-zh.png`), { fullPage: true });
  }
  await browser.evaluate(`window.__v95demo.setTheme("knight"); window.__v95demo.setLanguage("en-US")`);
  await delay(450);
  await browser.screenshot(shot("matrix-knight-en.png"), { fullPage: true });

  await browser.evaluate(`window.__v95demo.setLanguage("zh-CN"); window.__v95demo.setTheme("knight"); window.__v95demo.setAsyncState("ready")`);
  await delay(300);
  for (const [width, height] of [[1280, 720], [1600, 900], [1920, 1080], [2560, 1440]]) {
    await browser.setViewport(width, height);
    await delay(250);
    await browser.screenshot(shot(`size-${width}x${height}.png`), { fullPage: true });
  }
  // Simulated Windows scaling: reduce CSS viewport, not page scale.
  for (const [label, width, height] of [["125", 1280, 720], ["150", 1067, 600]]) {
    await browser.setViewport(width, height);
    await delay(180);
    await browser.screenshot(shot(`dpi-${label}.png`), { fullPage: true });
  }
  await browser.setViewport(390, 844, true);
  await delay(250);
  await browser.screenshot(shot("mobile-390.png"), { fullPage: true });

  await browser.setViewport(1600, 1100);
  await browser.evaluate(`window.__v95demo.setTheme("knight"); window.__v95demo.setLanguage("zh-CN"); document.querySelector("#demo-open-detail").click()`);
  await delay(500);
  await browser.screenshot(shot("dialog-detail.png"), { fullPage: false });
  const dialogState = await browser.evaluate(`({
    open: Boolean(document.querySelector('.v95-dialog')),
    role: document.querySelector('.v95-dialog')?.getAttribute('role'),
    width: Math.round(document.querySelector('.v95-dialog')?.getBoundingClientRect().width || 0),
    activeInside: Boolean(document.activeElement?.closest?.('.v95-dialog')),
    title: document.querySelector('.v95-dialog-title')?.textContent
  })`);
  console.log("dialog", dialogState);

  await browser.evaluate(`document.querySelector('.v95-dialog .v95-icon-button')?.click()`);
  await delay(300);
  await browser.evaluate(`document.querySelector("#demo-open-confirm").click()`);
  await delay(450);
  await browser.screenshot(shot("dialog-confirm.png"), { fullPage: false });

  console.log("errors", browser.errors);
  console.log("console", browser.consoleErrors);
  console.log("failed", browser.failedRequests.slice(0, 8));
} finally {
  await browser.close();
  await server.close();
}
