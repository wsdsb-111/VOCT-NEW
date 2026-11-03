"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createHookHarness, nodeText, findNode } = require("./test-v9.6-bridge-ui");
const load = file => import(pathToFileURL(path.resolve(__dirname, "../src/app/renderer", file)).href);
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
async function main() {
  const { CampaignBackgroundEditor } = await load("campaign-background-editor.js");
  const originalWindow = globalThis.window;
  try {
    for (const language of ["zh-CN", "en-US"]) {
      const catalog = (await load(`v95/i18n/locales/${language}.js`)).default;
      const t = (key, params = {}) => {
        const phrase = key.split(".").reduce((value, part) => value?.[part], catalog);
        assert.equal(typeof phrase, "string", `missing UI translation ${language}:${key}`);
        return phrase.replace(/\{\{(\w+)\}\}/g, (_all, name) => String(params[name]));
      };
      let current = { available: true, bindingKey: "a".repeat(64), revision: 1, text: "A" };
      let update, resolveRead, delayed = false, unsubscribed = 0;
      const writes = [];
      globalThis.window = { worldlineAPI: {
        getBackgroundSetting: () => delayed ? new Promise(resolve => { resolveRead = resolve; }) : Promise.resolve({ ...current }),
        saveBackgroundSetting: async request => {
          writes.push(request);
          if (request.bindingKey !== current.bindingKey) throw new Error("world_background_campaign_changed");
          current = { ...current, revision: current.revision + 1, text: request.text };
          return { ...current };
        },
        onUpdated: handler => { update = handler; return () => { unsubscribed++; }; }
      } };
      const rig = createHookHarness((R, J) => {
        R.createElement = (type, props, ...children) => J.jsx(type, { ...props, children });
        return props => CampaignBackgroundEditor({ react: R, ...props });
      }, { t });
      let tree = rig.render();
      await flush(); tree = rig.render();
      assert(nodeText(tree).includes(catalog.worldBackground.title));
      const textarea = () => findNode(tree, node => node.type === "textarea");
      const save = () => findNode(tree, node => node.type === "button" && nodeText(node) === catalog.worldBackground.save);
      assert.equal(textarea().props.value, "A");
      assert.equal(textarea().props.maxLength, undefined, "UTF-16 maxLength cannot reject valid Unicode code points");
      textarea().props.onChange({ target: { value: "🐉".repeat(3001) } }); tree = rig.render();
      assert.equal(save().props.disabled, true);
      const full = "🐉".repeat(3000);
      textarea().props.onChange({ target: { value: full } }); tree = rig.render();
      assert.equal(save().props.disabled, false);
      await save().props.onClick(); tree = rig.render();
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0], { bindingKey: "a".repeat(64), revision: 1, text: full });
      assert(nodeText(tree).includes(catalog.worldBackground.saved));
      textarea().props.onChange({ target: { value: "unsaved draft" } }); tree = rig.render();
      update(); await flush(); tree = rig.render();
      assert.equal(textarea().props.value, "unsaved draft", "same-campaign refresh retains typing");
      current = { ...current, revision: current.revision + 1, text: "another editor's update" };
      update(); await flush(); tree = rig.render();
      assert.equal(save().props.disabled, true, "refresh cannot adopt a new revision for an older draft");
      assert.equal(textarea().props.value, "unsaved draft");
      findNode(tree, node => node.type === "button" && nodeText(node) === catalog.worldBackground.reloadSaved).props.onClick();
      tree = rig.render();
      assert.equal(textarea().props.value, "another editor's update", "discarding a conflicted draft requires an explicit reload");
      current = { available: true, bindingKey: "b".repeat(64), revision: 0, text: "" };
      update(); await flush(); tree = rig.render();
      assert.equal(textarea().props.value, "", "campaign B never inherits campaign A's draft");
      assert.equal(save().props.disabled, true);
      textarea().props.onChange({ target: { value: "B draft" } }); tree = rig.render();
      current = { available: true, bindingKey: "c".repeat(64), revision: 0, text: "" };
      await save().props.onClick(); tree = rig.render();
      assert(nodeText(tree).includes(catalog.worldBackground.world_background_campaign_changed));
      assert.equal(writes.at(-1).bindingKey, "b".repeat(64));
      delayed = true; update();
      rig.unmount(); resolveRead({ ...current }); await flush();
      assert.equal(rig.postUnmountUpdates, 0);
      assert.equal(unsubscribed, 1);
    }
  } finally { globalThis.window = originalWindow; }
  console.log("PASS V9.7.1 background UI: two languages, Unicode limits, scoped payload, draft preservation/reset, stale save rejection and cancellation");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
