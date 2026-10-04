"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modRoot = path.resolve(__dirname, "../compatibility-mods/VOTC_Three_Mod_Character_Name_Compatibility");
const gui = fs.readFileSync(path.join(modRoot, "gui/oe_hud.gui"), "utf8");
const traitGuiPath = path.join(modRoot, "gui/shared/00_votc_trait_tooltip.gui");
const traitGui = fs.readFileSync(traitGuiPath, "utf8");
const descriptors = [
  fs.readFileSync(path.join(modRoot, "descriptor.mod"), "utf8"),
  fs.readFileSync(path.resolve(modRoot, "../VOTC_Three_Mod_Character_Name_Compatibility.mod"), "utf8")
];

function assertBalancedGuiBraces(source, fileName) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;

  for (const char of source) {
    if (inComment) {
      if (char === "\n") inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === "#") inComment = true;
    else if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    assert(depth >= 0, `${fileName} has an unexpected closing brace`);
  }

  assert.equal(depth, 0, `${fileName} has unclosed GUI blocks`);
  assert(!inString, `${fileName} has an unclosed quoted string`);
}

assertBalancedGuiBraces(gui, "oe_hud.gui");
assertBalancedGuiBraces(traitGui, "00_votc_trait_tooltip.gui");

for (const descriptor of descriptors) {
  assert.match(descriptor, /^version="1\.0\.1"$/m);
  assert.match(descriptor, /^supported_version="1\.20\.\*"$/m);
  for (const dependency of [
    "Oriental Empires (All Under Heaven)",
    "Eastern Ritual and Governance 1.99 (oe ver.0.5)",
    "天家宗仪 V0.76"
  ]) assert(descriptor.includes(`"${dependency}"`), `missing dependency: ${dependency}`);
}

const timeline = gui.match(/type oe_timeline_widget = widget \{([\s\S]*?)\n\t\}/)?.[1];
assert(timeline, "compatibility override must retain the Oriental Empires timeline widget");
assert(!/nianhao_date|TianganName|DizhiName/.test(timeline), "the legacy Oriental Empires date text must stay suppressed");
assert.match(timeline, /hbox = \{[\s\S]*?expand = \{\}\s*\}/, "empty timeline shell must remain for the Hanfan calendar layer");
assert(gui.includes("type oe_main_tabs_widget = widget"), "the unrelated Oriental Empires sidebar override must remain intact");
assert(!/太上皇/.test(gui), "date override must not add title/name hard-coding");

assert(traitGui.startsWith("template character_trait_tooltip"), "trait fix must override only the shared tooltip template");
assert.equal([...traitGui.matchAll(/^template\s+/gm)].length, 1, "trait fix must not redefine unrelated tooltip templates");
assert(traitGui.includes("Trait.GetFullDescription( Character.Self, Character.GetRite.Self )"),
  "trait description must use the CK3 1.20 Rite API");
assert(!traitGui.includes("Faith.Self"), "trait description must not retain the stale Faith scope");
assert(traitGui.includes("Not( Trait.IsPersonality )"), "More Personality Depth's personality XP display rule must remain");
assert(!/has_trait\s*=|remove_trait|Trait\.GetTraits/.test(traitGui), "trait fix must not filter or remove traits");
assert(Buffer.compare(Buffer.from(path.basename(traitGuiPath)), Buffer.from("cooltip.gui")) < 0,
  "FIOS requires the template override filename before cooltip.gui");

console.log("Three-Mod Character Name Compatibility: PASS (1.20 descriptors, single calendar render path, Rite tooltip API, FIOS order)");
