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

// Parse the delivered scoring rules so fixtures exercise the Mod, not a JS copy.
function parseRules(source) {
  const plain = source.replace(/#[^\r\n]*/g, "");
  const tokens = plain.match(/[A-Za-z_][\w:.]*|\d+|>=|>|=|[{}]/g) || [];
  assert.equal(tokens.join(""), plain.replace(/\s/g, ""), "unsupported script syntax in scoring fixture");
  let index = 0;
  function block(nested = false) {
    const entries = [];
    while (index < tokens.length && tokens[index] !== "}") {
      const key = tokens[index++];
      const operator = tokens[index++];
      assert(["=", ">", ">="].includes(operator), `unsupported operator: ${operator}`);
      const token = tokens[index++];
      entries.push({ key, operator, value: token === "{" ? block(true) : token });
    }
    if (nested) assert.equal(tokens[index++], "}", "missing block close");
    return entries;
  }
  const result = block();
  assert.equal(index, tokens.length, "unexpected trailing script");
  return result;
}

function one(entries, key) {
  const matches = entries.filter((entry) => entry.key === key);
  assert.equal(matches.length, 1, `expected one ${key}`);
  return matches[0].value;
}

const scoringPath = "common/script_values/votc_celestial_succession_values.txt";
const scoringSource = fs.readFileSync(path.join(modRoot, scoringPath), "utf8");
assertBalancedGuiBraces(scoringSource, scoringPath);
const penalty = one(parseRules(scoringSource), "votc_celestial_lower_title_penalty");
assert.deepEqual(penalty.map((entry) => entry.key), ["value", "if"]);
const conditional = one(penalty, "if");
assert.deepEqual(conditional.map((entry) => entry.key), ["limit", "subtract"]);
const limits = one(conditional, "limit");
assert.equal(limits.length, 4);
assert.equal(one(one(conditional, "subtract"), "desc"), "votc_celestial_lower_title_penalty_desc");

function evaluatePenalty({ held, target, vassal = true }) {
  const applies = limits.every(({ key, operator, value }) => {
    if (key === "exists") {
      assert.equal(operator, "=");
      assert(["scope:title", "liege"].includes(value));
      return value === "scope:title" ? target !== undefined : vassal;
    }
    assert.equal(key, "highest_held_title_tier");
    assert([">=", ">"].includes(operator));
    assert(["tier_kingdom", "scope:title.tier"].includes(value));
    const right = value === "tier_kingdom" ? 4 : target;
    return operator === ">=" ? held >= right : held > right;
  });
  return Number(one(penalty, "value")) - (applies ? Number(one(one(conditional, "subtract"), "value")) : 0);
}

const rankCases = [
  ["king to duchy", { held: 4, target: 3 }, -10000],
  ["king to county", { held: 4, target: 2 }, -10000],
  ["emperor to duchy", { held: 5, target: 3 }, -10000],
  ["emperor to kingdom", { held: 5, target: 4 }, -10000],
  ["hegemony to empire", { held: 6, target: 5 }, -10000],
  ["same-rank king", { held: 4, target: 4 }, 0],
  ["same-rank emperor", { held: 5, target: 5 }, 0],
  ["king promotion", { held: 4, target: 5 }, 0],
  ["duke promotion", { held: 3, target: 4 }, 0],
  ["ordinary duke to county", { held: 3, target: 2 }, 0],
  ["unlanded candidate", { held: 0, target: 3 }, 0],
  ["independent king", { held: 4, target: 3, vassal: false }, 0],
  ["missing appointment title", { held: 5 }, 0]
];
for (const [label, candidate, expected] of rankCases) assert.equal(evaluatePenalty(candidate), expected, label);

const appointmentName = "zzzzz_votc_celestial_governor.txt";
const appointmentSource = fs.readFileSync(path.join(modRoot, "common/succession_appointment", appointmentName), "utf8");
assertBalancedGuiBraces(appointmentSource, appointmentName);
const appointments = parseRules(appointmentSource);
assert.deepEqual(appointments.map((entry) => entry.key), ["celestial_civic_governor", "celestial_military_governor"]);
assert(appointmentName > "zzzz_celestial_governor.txt", "script override must sort after Hanfan's definition");
for (const [type, retained] of [
  ["civic", ["base", "civic", "celestial", "governor", "non_military"]],
  ["military", ["base", "military", "celestial", "governor", "final_factors"]]
]) {
  const definition = one(appointments, `celestial_${type}_governor`);
  assert.deepEqual(definition.map((entry) => entry.key), ["allowed_candidate_tier", "cooldown", "level", "candidate_score"]);
  assert.equal(one(definition, "allowed_candidate_tier"), "lower_or_equal");
  assert.equal(one(definition, "cooldown"), "yes");
  assert.equal(one(definition, "level"), "merit");
  const adds = one(one(definition, "candidate_score"), "value");
  assert(adds.every((entry) => entry.key === "add" && entry.operator === "="));
  assert.deepEqual(adds.map((entry) => entry.value), [
    ...retained.map((suffix) => `appointment_score_${suffix}`),
    `hanfan_appointment_score_${type}`,
    "votc_celestial_lower_title_penalty"
  ], "preserve upstream scoring and apply the fixed penalty after all existing factors");
}

// Exercise the configured candidate-tier policy independently from candidate_score.
// These deterministic fixtures are not a simulation of CK3's appointment engine.
function evaluateCandidateTier({ policy, candidateLanded, candidateOfficeTier, targetTier }) {
  if (!candidateLanded) return true;
  assert(Number.isInteger(candidateOfficeTier), "landed candidate fixture needs an office tier");
  if (policy === "lower_or_equal") return candidateOfficeTier <= targetTier;
  if (policy === "lower") return candidateOfficeTier < targetTier;
  if (policy === "any") return true;
  assert.fail(`unsupported candidate-tier policy: ${policy}`);
}

const candidateTierCases = [
  ["king to non-de-jure duchy", { candidateLanded: true, candidateOfficeTier: 4, targetTier: 3, deJureLiege: false }, false],
  ["king to non-de-jure county", { candidateLanded: true, candidateOfficeTier: 4, targetTier: 2, deJureLiege: false }, false],
  ["duke to non-de-jure county", { candidateLanded: true, candidateOfficeTier: 3, targetTier: 2, deJureLiege: false }, false],
  ["same-rank king sidegrade", { candidateLanded: true, candidateOfficeTier: 4, targetTier: 4 }, true],
  ["same-rank duke sidegrade", { candidateLanded: true, candidateOfficeTier: 3, targetTier: 3 }, true],
  ["duke promotion to kingdom", { candidateLanded: true, candidateOfficeTier: 3, targetTier: 4 }, true],
  ["unlanded family title is not an office tier", { candidateLanded: false, candidateOfficeTier: null, familyTitleTier: 5, targetTier: 3 }, true]
];
for (const type of ["celestial_civic_governor", "celestial_military_governor"]) {
  const policy = one(one(appointments, type), "allowed_candidate_tier");
  for (const [label, candidate, expected] of candidateTierCases) {
    if (candidate.deJureLiege !== undefined) assert.equal(candidate.deJureLiege, false, `${label} fixture must remain non-de-jure`);
    assert.equal(evaluateCandidateTier({ ...candidate, policy }), expected, `${type}: ${label}`);
  }
}

const penaltyLoc = fs.readFileSync(path.join(modRoot, "localization/simp_chinese/votc_celestial_succession_l_simp_chinese.yml"), "utf8");
assert(penaltyLoc.startsWith("\uFEFFl_simp_chinese:"), "CK3 localization must have UTF-8 BOM and language header");
assert.match(penaltyLoc, /^\s+votc_celestial_lower_title_penalty_desc:0 "[^"\r\n]+"$/m);

for (const descriptor of descriptors) {
  assert.match(descriptor, /^version="1\.0\.6"$/m);
  assert.match(descriptor, /^supported_version="1\.20\.\*"$/m);
  for (const dependency of [
    "Oriental Empires (All Under Heaven)",
    "Eastern Ritual and Governance 1.99 (oe ver.0.55)",
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

console.log(`Three-Mod Character Name Compatibility: PASS (1.0.6 descriptors, calendar/trait UI, both celestial appointments, ${rankCases.length} score fixtures, ${candidateTierCases.length} candidate-tier fixtures per appointment type)`);
