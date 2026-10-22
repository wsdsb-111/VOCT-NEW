/** Minimal CDP browser harness for the offline showCase (no external deps). */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE_ROOT = join(HERE, "_chrome-profile");

export async function launchBrowser({ url, width = 1600, height = 1000, headless = true } = {}) {
  if (!url) throw new Error("url required");
  const chrome = process.env.CHROME_PATH
    || join(process.env.LOCALAPPDATA || "", "ms-playwright/chromium-1181/chrome-win/chrome.exe");
  const port = 9600 + Math.floor(Math.random() * 300);
  const profile = join(PROFILE_ROOT, `run-${port}`);
  mkdirSync(profile, { recursive: true });
  const child = spawn(chrome, [
    headless ? "--headless=new" : "--new-window",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-breakpad",
    "--hide-scrollbars",
    "--disable-extensions",
    "--no-first-run",
    "--force-device-scale-factor=1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "about:blank"
  ], { stdio: "ignore" });
  let startupError = null;
  child.once("error", error => { startupError = error; });

  let targetUrl;
  for (let attempt = 0; attempt < 120 && !targetUrl; attempt += 1) {
    if (startupError || child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const list = await response.json();
        const target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
        if (target) targetUrl = target.webSocketDebuggerUrl;
      }
    } catch (_ignored) { /* retry */ }
    if (!targetUrl) await delay(150);
  }
  if (!targetUrl) {
    child.kill();
    throw new Error(`Chrome devtools did not start${startupError ? ` (${startupError.code})` : ""}`);
  }

  const socket = new WebSocket(targetUrl);
  await new Promise((ok, fail) => {
    socket.addEventListener("open", ok, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });

  let idCounter = 0;
  const pending = new Map();
  const waiters = new Map();
  const errors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const requests = [];

  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { ok, fail } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) fail(new Error(message.error.message));
      else ok(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      errors.push(details.exception?.description || details.text || "runtime exception");
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description ?? "").join(" "));
    }
    if (message.method === "Network.responseReceived") {
      requests.push(message.params.response.url);
      if (message.params.response.status >= 400) {
        failedRequests.push(`${message.params.response.status} ${message.params.response.url}`);
      }
    }
    if (message.method === "Network.loadingFailed") {
      failedRequests.push(`FAILED ${message.params.errorText}`);
    }
    const listeners = waiters.get(message.method);
    if (listeners) {
      waiters.delete(message.method);
      listeners.forEach(fn => fn(message.params));
    }
  });

  function send(method, params = {}) {
    idCounter += 1;
    const id = idCounter;
    return new Promise((ok, fail) => {
      pending.set(id, { ok, fail });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  function once(method, timeout = 20000) {
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`timeout ${method}`)), timeout);
      const fn = params => {
        clearTimeout(timer);
        ok(params);
      };
      waiters.set(method, [...(waiters.get(method) || []), fn]);
    });
  }

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  }

  async function waitFor(expression, { timeout = 15000, interval = 80 } = {}) {
    const started = Date.now();
    let lastError = null;
    while (Date.now() - started < timeout) {
      try {
        const value = await evaluate(`Boolean(${expression})`);
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await delay(interval);
    }
    throw new Error(`waitFor timed out: ${expression}${lastError ? ` (${lastError.message})` : ""}`);
  }

  async function setViewport(nextWidth, nextHeight, mobile = false) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: nextWidth,
      height: nextHeight,
      deviceScaleFactor: 1,
      mobile,
      screenWidth: nextWidth,
      screenHeight: nextHeight
    });
  }

  async function screenshot(path, { fullPage = false, clip = null } = {}) {
    let shot;
    if (clip) {
      shot = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    } else if (fullPage) {
      const metrics = await send("Page.getLayoutMetrics");
      const size = metrics.cssContentSize || metrics.contentSize;
      shot = await send("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 }
      });
    } else {
      shot = await send("Page.captureScreenshot", { format: "png" });
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(shot.data, "base64"));
    return path;
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await setViewport(width, height);
  const loaded = once("Page.loadEventFired");
  await send("Page.navigate", { url });
  await loaded;
  await evaluate("Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))])");
  await waitFor("document.documentElement.dataset.demoReady === 'true'", { timeout: 20000 });

  return {
    send,
    evaluate,
    waitFor,
    screenshot,
    setViewport,
    reload: async () => {
      const refreshed = once("Page.loadEventFired");
      await send("Page.reload", { ignoreCache: true });
      await refreshed;
      await waitFor("document.documentElement.dataset.demoReady === 'true'");
    },
    errors,
    consoleErrors,
    failedRequests,
    requests,
    close: async () => {
      socket.close();
      child.kill();
      await delay(200);
      try { rmSync(profile, { recursive: true, force: true }); } catch (_ignored) { }
    }
  };
}
