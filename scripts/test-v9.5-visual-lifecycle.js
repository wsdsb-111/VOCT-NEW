"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { setTimeout: delay } = require("node:timers/promises");

const results = [];
function check(name, detail = "") {
  results.push({ name, detail });
}

async function step(name, fn) {
  try {
    const detail = await fn();
    check(name, detail === undefined ? "" : String(detail));
  } catch (error) {
    results.push({ name, error: error?.message || String(error) });
  }
}

async function key(browser, shift = false) {
  await browser.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0
  });
  await browser.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0
  });
  await delay(50);
}

(async () => {
  const [{ startServer }, { launchBrowser }] = await Promise.all([
    import(pathToFileURL(path.resolve(__dirname, "../review/v95-deepseek/serve.mjs")).href),
    import(pathToFileURL(path.resolve(__dirname, "../review/v95-deepseek/tests/browser.mjs")).href)
  ]);
  const server = await startServer({ port: 0 });
  let browser;
  try {
    browser = await launchBrowser({ url: server.url, width: 1200, height: 900 });
    await browser.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }]
    });
    const moduleRoot = `${new URL(server.url).origin}/src/app/renderer/v95/visual`;

    await step("dialog traps panel and outside focus, then releases on destroy", async () => {
      await browser.evaluate(`(async () => {
        const { mountDialog } = await import(${JSON.stringify(`${moduleRoot}/dialog-shell.js`)});
        const outside = document.createElement('button');
        outside.textContent = 'Outside';
        document.body.appendChild(outside);
        outside.focus();
        const t = key => ({ 'common.close': 'Close', 'common.detail': 'Detail' })[key] || key;
        const outer = mountDialog(document.body, { title: 'Outer', body: 'Body', t });
        await new Promise(resolve => setTimeout(resolve, 20));
        window.__v95Lifecycle = { outside, outer, t };
        return document.activeElement === outer.panel;
      })()`);
      await key(browser, true);
      let state = await browser.evaluate(`(() => ({
        trapped: window.__v95Lifecycle.outer.element.contains(document.activeElement),
        active: document.activeElement?.textContent || ''
      }))()`);
      assert.equal(state.trapped, true, `Shift+Tab escaped the default panel focus: ${JSON.stringify(state)}`);

      await browser.evaluate(`window.__v95Lifecycle.outside.focus()`);
      state = await browser.evaluate(`({ trapped: window.__v95Lifecycle.outer.element.contains(document.activeElement) })`);
      assert.equal(state.trapped, true, "programmatic outside focus escaped the top dialog");

      await browser.evaluate(`(async () => {
        const { mountDialog } = await import(${JSON.stringify(`${moduleRoot}/dialog-shell.js`)});
        const { outside, t } = window.__v95Lifecycle;
        const inner = mountDialog(document.body, { title: 'Inner', body: 'Body', t });
        await new Promise(resolve => setTimeout(resolve, 20));
        window.__v95Lifecycle.inner = inner;
        outside.focus();
        return inner.element.contains(document.activeElement);
      })()`);
      state = await browser.evaluate(`({ trapped: window.__v95Lifecycle.inner.element.contains(document.activeElement) })`);
      assert.equal(state.trapped, true, "the outer dialog intercepted focus from the nested top dialog");

      await browser.evaluate(`window.__v95Lifecycle.inner.destroy()`);
      await browser.evaluate(`window.__v95Lifecycle.outside.focus()`);
      state = await browser.evaluate(`({ trapped: window.__v95Lifecycle.outer.element.contains(document.activeElement) })`);
      assert.equal(state.trapped, true, "outer dialog did not resume focus trapping after nested close");

      await browser.evaluate(`window.__v95Lifecycle.outer.destroy()`);
      state = await browser.evaluate(`({ released: document.activeElement === window.__v95Lifecycle.outside })`);
      assert.equal(state.released, true, "destroy did not restore outside focus");
      return "nested topmost guard / close cleanup";
    });

    await step("row replacements retain action focus and preserve active input", async () => {
      const state = await browser.evaluate(`(async () => {
        const { createRow } = await import(${JSON.stringify(`${moduleRoot}/row-components.js`)});
        const t = key => key;
        const view = { kind: 'letter-list', state: 'ready', scopeTag: 'scope-ui-test', revisionTag: 'rev-ui-test' };
        const row = createRow({
          kind: 'letter-list', view, t, emit: () => {},
          row: { id: 'ui-row-1', title: 'Letter', actions: ['OPEN_DETAIL', 'REQUEST_APPROVAL'] }
        });
        document.body.appendChild(row.element);
        row.element.querySelector('[data-action="REQUEST_APPROVAL"]').focus();
        row.update({ id: 'ui-row-1', title: 'Letter', actions: ['OPEN_DETAIL'] });
        const retainedAction = document.activeElement?.dataset?.action || '';
        row.update({ id: 'ui-row-1', title: 'Letter', actions: [] });
        const rowFallback = document.activeElement === row.element;
        row.destroy();

        const settingsView = { kind: 'settings-section', state: 'ready', scopeTag: 'scope-ui-test', revisionTag: 'rev-ui-test' };
        const settings = createRow({
          kind: 'settings-section', view: settingsView, t, emit: () => {},
          row: { id: 'ui-row-2', title: 'Input', actions: ['CHANGE_FILTER'], control: { type: 'text', value: 'server' } }
        });
        document.body.appendChild(settings.element);
        const input = settings.element.querySelector('input');
        input.focus();
        input.value = 'unsaved user text';
        settings.update({ id: 'ui-row-2', title: 'Input', actions: ['CHANGE_FILTER'], control: { type: 'text', value: 'server refresh' } });
        const inputPreserved = document.activeElement === input && input.value === 'unsaved user text';
        settings.destroy();
        return { retainedAction, rowFallback, inputPreserved };
      })()`);
      assert.equal(state.retainedAction, "OPEN_DETAIL", JSON.stringify(state));
      assert.equal(state.rowFallback, true, JSON.stringify(state));
      assert.equal(state.inputPreserved, true, JSON.stringify(state));
      return "replacement action / row fallback / unsaved text";
    });

    await step("view swaps ignore superseded and disconnected renders", async () => {
      const state = await browser.evaluate(`(async () => {
        const { swapView } = await import(${JSON.stringify(`${moduleRoot}/view-transition.js`)});
        const host = document.createElement('div');
        document.body.appendChild(host);
        const rendered = [];
        const old = swapView(host, () => rendered.push('old'), { duration: 80 });
        const latest = swapView(host, () => rendered.push('latest'), { duration: 8 });
        await Promise.all([old, latest]);
        const orphan = document.createElement('div');
        document.body.appendChild(orphan);
        let orphanRendered = false;
        const pending = swapView(orphan, () => { orphanRendered = true; }, { duration: 20 });
        orphan.remove();
        await pending;
        host.remove();
        return { rendered, orphanRendered };
      })()`);
      assert.deepEqual(state.rendered, ["latest"], JSON.stringify(state));
      assert.equal(state.orphanRendered, false, JSON.stringify(state));
      return "latest only / disconnected host skipped";
    });

    const failed = results.filter(result => result.error);
    for (const result of results) {
      console.log(`${result.error ? "FAIL" : "PASS"}  ${result.name}${result.error ? `  [${result.error}]` : result.detail ? `  [${result.detail}]` : ""}`);
    }
    if (browser.errors.length || browser.consoleErrors.length) {
      failed.push({ name: "browser runtime", error: JSON.stringify({ errors: browser.errors, console: browser.consoleErrors }) });
      console.log(`FAIL  browser runtime  [${failed[failed.length - 1].error}]`);
    }
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
