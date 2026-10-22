/** Offline browser test suite for the V9.5 visual delivery. */
import { startServer } from "../serve.mjs";
import { launchBrowser } from "./browser.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
}
async function step(name, fn) {
  try {
    const detail = await fn();
    check(name, true, detail === undefined ? "" : String(detail));
  } catch (error) {
    check(name, false, error?.message || String(error));
  }
}
async function key(browser, keyName, code, virtualKeyCode, shift = false) {
  await browser.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: keyName, code, windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode, modifiers: shift ? 8 : 0
  });
  await browser.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: keyName, code, windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode, modifiers: shift ? 8 : 0
  });
  await delay(70);
}

const server = await startServer({ port: 0 });
const browser = await launchBrowser({ url: server.url, width: 1600, height: 1100 });
try {
  const api = "window.__v95demo";

  await step("showcase boots with eight lanes", async () => {
    const data = await browser.evaluate(`({ lanes: ${api}.laneCount(), views: document.querySelectorAll('.v95-view').length, kinds: ${api}.kinds })`);
    if (data.lanes !== 8 || data.views !== 9 || data.kinds.length !== 8) throw new Error(JSON.stringify(data));
    return `${data.lanes} lanes / ${data.views} views`;
  });

  await step("no raw keys, undefined or object text", async () => {
    const bad = await browser.evaluate(`(() => {
      const text = document.querySelector('.demo-shell').innerText;
      return { undef: text.includes('undefined'), obj: text.includes('[object Object]'), template: text.includes('{{') };
    })()`);
    if (bad.undef || bad.obj || bad.template) throw new Error(JSON.stringify(bad));
  });

  await step("icons are offline svg and unknown falls back", async () => {
    const data = await browser.evaluate(`({
      count: ${api}.icons.length,
      fallback: Boolean(document.querySelector('svg[data-icon-fallback="unknown"]')),
      external: Array.from(document.querySelectorAll('svg.v95-icon use, svg.v95-icon image')).length
    })`);
    if (data.count < 18 || !data.fallback || data.external !== 0) throw new Error(JSON.stringify(data));
    return `${data.count} icons`;
  });

  await step("all view kinds present", async () => {
    const kinds = await browser.evaluate(`Array.from(document.querySelectorAll('.demo-lane'), lane => lane.dataset.laneKind)`);
    const expected = ["conversation-feed", "memory-list", "knowledge-facts", "worldline-timeline", "letter-list", "action-activity", "provider-diagnostics", "settings-section"];
    if (JSON.stringify(kinds) !== JSON.stringify(expected)) throw new Error(kinds.join(","));
  });

  await step("ready state renders keyed rows", async () => {
    const data = await browser.evaluate(`({ rows: document.querySelectorAll('.v95-row').length, ready: document.querySelectorAll('.v95-view[data-state="ready"]').length })`);
    if (data.rows < 20 || data.ready !== 9) throw new Error(JSON.stringify(data));
    return `${data.rows} rows`;
  });

  await step("three themes expose host tokens", async () => {
    const expected = { parchment: "rgb(233, 237, 229)", knight: "rgb(48, 51, 50)", ink: "rgb(226, 232, 222)" };
    for (const theme of Object.keys(expected)) {
      await browser.evaluate(`${api}.setTheme("${theme}")`);
      await delay(90);
      const data = await browser.evaluate(`(() => {
        const shell = document.querySelector('#demo-shell');
        const probe = document.createElement('span');
        probe.style.color = 'var(--v95-surface)';
        shell.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return { attr: document.documentElement.dataset.votcTheme, value };
      })()`);
      if (data.attr !== theme || data.value !== expected[theme]) throw new Error(`${theme}: ${JSON.stringify(data)}`);
    }
    await browser.evaluate(`${api}.setTheme("knight")`);
    return "parchment / knight / ink";
  });

  await step("English UI renders without missing text", async () => {
    await browser.evaluate(`${api}.setLanguage("en-US")`);
    await delay(350);
    const data = await browser.evaluate(`({
      lang: document.documentElement.lang,
      title: document.querySelector('.v95-view-title')?.textContent,
      bad: document.querySelector('.demo-shell').innerText.includes('{{') || document.querySelector('.demo-shell').innerText.includes('undefined')
    })`);
    if (data.lang !== "en-US" || data.bad) throw new Error(JSON.stringify(data));
    await browser.evaluate(`${api}.setLanguage("zh-CN")`);
    await delay(350);
    return data.title;
  });

  await step("async states render all five surfaces", async () => {
    const counts = {};
    for (const state of ["empty", "loading", "error", "stale", "refreshing", "idle"]) {
      await browser.evaluate(`${api}.setAsyncState("${state}")`);
      await delay(140);
      counts[state] = await browser.evaluate(`({
        panels: document.querySelectorAll('.v95-state-panel').length,
        rows: document.querySelectorAll('.v95-row').length,
        skeletons: document.querySelectorAll('.v95-skeleton-row').length,
        inline: document.querySelectorAll('.v95-inline-status').length,
        busy: document.querySelectorAll('.v95-view[aria-busy="true"]').length,
        errorText: document.querySelector('.v95-state-panel--error, .v95-state-panel--stale')?.textContent || ''
      })`);
    }
    if (counts.empty.panels !== 9 || counts.empty.rows !== 0) throw new Error("empty " + JSON.stringify(counts.empty));
    if (counts.loading.skeletons < 20 || counts.loading.busy !== 9) throw new Error("loading " + JSON.stringify(counts.loading));
    if (counts.error.panels !== 9 || !counts.error.errorText) throw new Error("error " + JSON.stringify(counts.error));
    if (counts.stale.panels !== 9 || !counts.stale.errorText) throw new Error("stale " + JSON.stringify(counts.stale));
    if (counts.refreshing.rows < 20 || counts.refreshing.inline !== 9) throw new Error("refreshing " + JSON.stringify(counts.refreshing));
    if (counts.idle.panels !== 9) throw new Error("idle " + JSON.stringify(counts.idle));
    await browser.evaluate(`${api}.setAsyncState("ready")`);
    await delay(180);
    return "empty/loading/error/stale/refreshing/idle";
  });

  await step("page switch swaps without losing the host", async () => {
    await browser.evaluate(`document.querySelector('[data-page-kind="memory-list"]').click()`);
    await delay(380);
    const memory = await browser.evaluate(`({ kind: ${api}.pageKind(), title: document.querySelector('#demo-page-stage .v95-view-title')?.textContent, staging: Boolean(document.querySelector('#demo-page-stage')) })`);
    if (memory.kind !== "memory-list" || !memory.staging) throw new Error(JSON.stringify(memory));
    await browser.evaluate(`document.querySelector('[data-page-kind="provider-diagnostics"]').click()`);
    await delay(380);
    const diagnostics = await browser.evaluate(`({ kind: ${api}.pageKind(), title: document.querySelector('#demo-page-stage .v95-view-title')?.textContent })`);
    if (diagnostics.kind !== "provider-diagnostics") throw new Error(JSON.stringify(diagnostics));
    await browser.evaluate(`document.querySelector('[data-page-kind="conversation-feed"]').click()`);
    return `${memory.title} → ${diagnostics.title}`;
  });

  await step("pagination emits CHANGE_PAGE and updates the page label", async () => {
    await browser.evaluate(`document.querySelector('[data-page-kind="memory-list"]').click()`);
    await delay(380);
    const before = await browser.evaluate(`document.querySelector('#demo-page-stage .v95-page-label')?.textContent || ''`);
    await browser.evaluate(`document.querySelector('#demo-page-stage .v95-pagination .v95-icon-button:last-child')?.click()`);
    await delay(200);
    const after = await browser.evaluate(`({ label: document.querySelector('#demo-page-stage .v95-page-label')?.textContent || '', log: document.querySelector('#demo-log').innerText })`);
    if (after.label === before || !after.log.includes("CHANGE_PAGE")) throw new Error(JSON.stringify({ before, after }));
    await browser.evaluate(`document.querySelector('[data-page-kind="conversation-feed"]').click()`);
    await delay(300);
    return after.label;
  });

  await step("row detail opens and closes with focus restored", async () => {
    await browser.evaluate(`(() => { const button = document.querySelector('#demo-open-detail'); button.focus(); button.click(); })()`);
    await delay(350);
    const open = await browser.evaluate(`({
      open: Boolean(document.querySelector('.v95-dialog[role="dialog"][aria-modal="true"]')),
      inside: Boolean(document.activeElement?.closest?.('.v95-dialog')),
      lock: document.documentElement.classList.contains('v95-dialog-open')
    })`);
    if (!open.open || !open.inside || !open.lock) throw new Error(JSON.stringify(open));
    for (let index = 0; index < 6; index += 1) await key(browser, "Tab", "Tab", 9);
    const trapped = await browser.evaluate(`Boolean(document.activeElement?.closest?.('.v95-dialog'))`);
    if (!trapped) throw new Error("focus escaped dialog");
    await key(browser, "Escape", "Escape", 27);
    await delay(300);
    const closed = await browser.evaluate(`({
      open: Boolean(document.querySelector('.v95-dialog')),
      lock: document.documentElement.classList.contains('v95-dialog-open'),
      restored: document.activeElement?.id
    })`);
    if (closed.open || closed.lock || closed.restored !== "demo-open-detail") throw new Error(JSON.stringify(closed));
    return "focus trap + escape + restore";
  });

  await step("dialog backdrop closes", async () => {
    await browser.evaluate(`document.querySelector('#demo-open-detail').click()`);
    await delay(250);
    await browser.evaluate(`document.querySelector('.v95-dialog-backdrop').click()`);
    await delay(300);
    const open = await browser.evaluate(`Boolean(document.querySelector('.v95-dialog'))`);
    if (open) throw new Error("dialog still open");
  });

  await step("confirm dialog keeps actions explicit", async () => {
    await browser.evaluate(`document.querySelector('#demo-open-confirm').click()`);
    await delay(300);
    const data = await browser.evaluate(`({
      confirm: Boolean(document.querySelector('.v95-dialog--confirm')),
      buttons: Array.from(document.querySelectorAll('.v95-dialog-foot button'), b => b.textContent.trim()),
      lock: document.documentElement.classList.contains('v95-dialog-open')
    })`);
    if (!data.confirm || data.buttons.length < 2 || !data.lock) throw new Error(JSON.stringify(data));
    await browser.evaluate(`document.querySelectorAll('.v95-dialog-foot button')[0].click()`);
    await delay(300);
    return data.buttons.join(" / ");
  });

  await step("non-dismissible dialog hides close controls and ignores Escape", async () => {
    const data = await browser.evaluate(`(async () => {
      const { mountConfirmDialog } = await import('/src/app/renderer/v95/visual/dialog-shell.js');
      const dialog = mountConfirmDialog(document.body, {
        title: 'Blocking check',
        body: 'No close controls while dismissing is disabled.',
        dismissible: false,
        t: window.__v95demo.t,
        iconRegistry: window.__v95demo.iconRegistry,
        actions: [{ labelKey: 'common.cancel', tone: 'surface', onClick: () => dialog.close('cancel') }]
      });
      await new Promise(resolve => setTimeout(resolve, 60));
      const closeButtons = document.querySelectorAll('.v95-dialog .v95-icon-button').length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 260));
      const stillOpen = Boolean(document.querySelector('.v95-dialog'));
      dialog.destroy();
      return { closeButtons, stillOpen, lock: document.documentElement.classList.contains('v95-dialog-open') };
    })()`);
    if (data.closeButtons !== 0 || !data.stillOpen || data.lock) throw new Error(JSON.stringify(data));
    return "no close controls / Escape ignored";
  });

  await step("settings control emits only CHANGE_FILTER", async () => {
    const before = await browser.evaluate(`document.documentElement.lang`);
    await browser.evaluate(`(() => {
      const select = document.querySelector('.v95-view--settings-section select.v95-select');
      select.value = 'en-US';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await delay(500);
    const data = await browser.evaluate(`({ lang: document.documentElement.lang, log: document.querySelector('#demo-log').innerText })`);
    if (data.lang !== "en-US" || !data.log.includes("CHANGE_FILTER")) throw new Error(JSON.stringify(data));
    await browser.evaluate(`${api}.setLanguage("zh-CN")`);
    await delay(350);
    return `${before} → ${data.lang}`;
  });

  await step("no horizontal overflow at 1280/1920/2560/1067/390", async () => {
    for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440], [1067, 600], [390, 844]]) {
      await browser.setViewport(width, height);
      await delay(250);
      const overflow = await browser.evaluate(`document.documentElement.scrollWidth > window.innerWidth + 1`);
      if (overflow) throw new Error(`overflow at ${width}`);
    }
    await browser.setViewport(1600, 1100);
    return "1280 / 1920 / 2560 / 1067 / 390";
  });

  await step("narrow 420px container wraps long text without horizontal overflow", async () => {
    const data = await browser.evaluate(`(async () => {
      const stage = document.createElement('div');
      stage.style.cssText = 'position:fixed;left:-10000px;top:0;width:420px;height:620px;';
      document.body.appendChild(stage);
      const [{ createViewFixtures }, { mountView }] = await Promise.all([
        import('/src/app/renderer/v95/contracts/view-fixtures.v1.js'),
        import('/src/app/renderer/v95/visual/memory-visual.js')
      ]);
      const view = createViewFixtures('zh-CN').find(item => item.kind === 'memory-list' && item.state === 'ready');
      const instance = mountView(stage, view, {
        t: ${api}.t,
        emit: () => {},
        iconRegistry: ${api}.iconRegistry
      });
      const root = stage.querySelector('.v95-view');
      const first = stage.querySelector('.v95-row-actions button');
      if (first) first.focus();
      const beforeFocus = document.activeElement === first;
      instance.update({ ...view, rows: view.rows.map(row => ({ ...row, title: '更新后的标题' })) });
      const afterFocus = document.activeElement === first;
      const overflow = root.scrollWidth > root.clientWidth + 1;
      const subtitle = stage.querySelector('.v95-row-subtitle');
      const subtitleOverflow = subtitle ? subtitle.scrollWidth > subtitle.clientWidth + 1 : false;
      instance.destroy();
      const empty = stage.children.length === 0;
      stage.remove();
      return { overflow, subtitleOverflow, beforeFocus, afterFocus, empty };
    })()`);
    if (data.overflow || data.subtitleOverflow || !data.afterFocus || !data.empty) throw new Error(JSON.stringify(data));
    return "long text + focus preserved";
  });

  await step("mount/update/destroy is repeatable", async () => {
    const data = await browser.evaluate(`(async () => {
      const stage = document.createElement('div');
      stage.style.cssText = 'position:fixed;left:-10000px;top:0;width:520px;height:620px;';
      document.body.appendChild(stage);
      const [{ createViewFixtures }, { mountView }] = await Promise.all([
        import('/src/app/renderer/v95/contracts/view-fixtures.v1.js'),
        import('/src/app/renderer/v95/visual/letter-visual.js')
      ]);
      const view = createViewFixtures('en-US').find(item => item.kind === 'letter-list' && item.state === 'ready');
      let cycles = 0;
      for (let index = 0; index < 3; index += 1) {
        const instance = mountView(stage, view, { t: ${api}.t, emit: () => {}, iconRegistry: ${api}.iconRegistry });
        instance.update({ ...view, titleKey: 'letters.title' });
        instance.destroy();
        if (stage.children.length !== 0) throw new Error('container not empty');
        cycles += 1;
      }
      stage.remove();
      return { cycles };
    })()`);
    if (data.cycles !== 3) throw new Error(JSON.stringify(data));
    return "3 cycles";
  });

  await step("no runtime errors, console errors or failed requests", async () => {
    const failed = browser.failedRequests.filter(item => !item.includes("favicon"));
    if (browser.errors.length || browser.consoleErrors.length || failed.length) {
      throw new Error(JSON.stringify({ errors: browser.errors, console: browser.consoleErrors, failed }));
    }
  });

  await step("no external network requests", async () => {
    const origin = new URL(server.url).origin;
    const external = browser.requests.filter(url => /^https?:/.test(url) && !url.startsWith(origin));
    if (external.length) throw new Error(external.slice(0, 5).join(", "));
  });

  await step("intent log contains no forbidden execution", async () => {
    const log = await browser.evaluate(`document.querySelector('#demo-log').innerText`);
    for (const forbidden of ["EXECUTE_ACTION", "FORGET_SOURCE", "RETRY_EFFECT"]) {
      if (log.includes(forbidden)) throw new Error(forbidden);
    }
  });

  await step("reduced motion keeps content visible", async () => {
    await browser.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }]
    });
    await delay(200);
    const data = await browser.evaluate(`({
      visible: Boolean(document.querySelector('.v95-view')),
      dialog: Boolean(document.querySelector('.v95-dialog')),
      opacity: getComputedStyle(document.querySelector('.v95-view')).opacity
    })`);
    if (!data.visible || data.dialog) throw new Error(JSON.stringify(data));
    return data.opacity;
  });
} finally {
  await browser.close();
  await server.close();
}

let failed = 0;
for (const result of results) {
  if (!result.ok) failed += 1;
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.detail ? `  [${result.detail}]` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
