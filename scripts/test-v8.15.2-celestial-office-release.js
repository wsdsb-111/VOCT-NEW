"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modRoot = path.resolve(__dirname, "../compatibility-mods/VOTC_Three_Mod_Character_Name_Compatibility");
const triggerPath = path.join(modRoot, "common/scripted_triggers/zzzz_votc_celestial_office_release.txt");
const effectPath = path.join(modRoot, "common/scripted_effects/zzzz_votc_celestial_office_release.txt");
const onActionPath = path.join(modRoot, "common/on_action/zzzz_votc_celestial_office_release.txt");
const eventPath = path.join(modRoot, "events/votc_celestial_office_release_events.txt");

function parsePdx(source, label) {
  const uncommented = source.replace(/#[^\r\n]*/g, "");
  const tokens = uncommented.match(/"(?:\\.|[^"\\])*"|[A-Za-z0-9_:.@-]+|>=|<=|!=|\?=|\?!=|[{}=<>+]/g) || [];
  assert.equal(tokens.join("").replace(/"/g, ""), uncommented.replace(/[\s"]/g, ""), `${label}: unsupported PDX syntax`);
  let index = 0;

  function block(nested = false) {
    const entries = [];
    while (index < tokens.length && tokens[index] !== "}") {
      const key = tokens[index++];
      const operator = tokens[index++];
      if (!["=", ">", ">=", "<", "<=", "!=", "?=", "?!=", "+="].includes(operator)) {
        index -= 1;
        entries.push({ key, operator: "=", value: "yes" });
        continue;
      }
      const value = tokens[index++];
      entries.push({ key, operator, value: value === "{" ? block(true) : value.replace(/^"|"$/g, "") });
    }
    if (nested) assert.equal(tokens[index++], "}", `${label}: missing closing brace`);
    return entries;
  }

  const entries = block();
  assert.equal(index, tokens.length, `${label}: trailing PDX tokens`);
  return entries;
}

function one(entries, key) {
  const matches = entries.filter((entry) => entry.key === key);
  assert.equal(matches.length, 1, `expected one ${key}`);
  return matches[0].value;
}

function nested(entries, key) {
  const value = one(entries, key);
  assert(Array.isArray(value), `${key} must have a block`);
  return value;
}

function findAll(entries, key) {
  const matches = [];
  for (const entry of entries) {
    if (entry.key === key) matches.push(entry);
    if (Array.isArray(entry.value)) matches.push(...findAll(entry.value, key));
  }
  return matches;
}

const triggerSource = fs.readFileSync(triggerPath, "utf8");
const effectSource = fs.readFileSync(effectPath, "utf8");
const onActionSource = fs.readFileSync(onActionPath, "utf8");
const eventSource = fs.readFileSync(eventPath, "utf8");
const triggers = parsePdx(triggerSource, path.basename(triggerPath));
const effects = parsePdx(effectSource, path.basename(effectPath));
const onActions = parsePdx(onActionSource, path.basename(onActionPath));
const events = parsePdx(eventSource, path.basename(eventPath));

const tierValues = { tier_barony: 1, tier_county: 2, tier_duchy: 3, tier_kingdom: 4, tier_empire: 5, tier_hegemony: 6 };

function camelCase(value) {
  return value.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function readPath(value, parts) {
  return parts.reduce((current, part) => current?.[part] ?? current?.[camelCase(part)], value);
}

function resolvePath(expression, context) {
  if (expression === "root") return context.root;
  if (expression === "this") return context.scope;
  if (expression === "prev") return context.previousScope;
  if (expression.startsWith("scope:")) {
    const [name, ...path] = expression.slice("scope:".length).split(".");
    const alias = name === "oe_stream_fix_target" ? "fixTarget"
      : camelCase(name.replace(/^votc_celestial_/, ""));
    return readPath(context.scopes[name] ?? context.scopes[alias], path);
  }
  if (expression.startsWith("root.")) return readPath(context.root, expression.slice(5).split("."));
  if (expression.startsWith("this.")) return readPath(context.scope, expression.slice(5).split("."));
  if (expression.includes(".")) return readPath(context.scope, expression.split("."));
  if (expression === "primary_title") return context.scope?.primaryTitle;
  if (expression === "top_liege") return context.scope?.topLiege;
  if (expression === "current_heir") return context.scope?.currentHeir;
  if (expression === "employer") return context.scope?.employer;
  if (expression === "liege") return context.scope?.liege;
  if (expression.startsWith("flag:")) return expression;
  if (Object.hasOwn(tierValues, expression)) return tierValues[expression];
  return expression;
}

function asContext(context, scope) {
  return { ...context, previousScope: context.scope, scope };
}

function sameEntity(left, right) {
  if (left === right) return true;
  return Boolean(left && right && left.id && right.id && left.id === right.id);
}

function evalEntry(entry, context) {
  const { key, operator, value } = entry;
  if (key === "OR") return value.some((child) => evalEntry(child, context));
  if (key === "AND") return value.every((child) => evalEntry(child, context));
  if (key === "NOR") return !value.some((child) => evalEntry(child, context));
  if (key === "NOT") return !evalBlock(value, context);
  if (key === "save_temporary_scope_as") {
    context.scopes[value] = context.scope;
    return true;
  }

  if (Array.isArray(value)) {
    if (key === "any_held_title") {
      return (context.scope?.heldTitles || []).some((title) => evalBlock(value, asContext(context, title)));
    }
    if (key === "any_vassal") {
      return (context.scope?.vassals || []).some((vassal) => evalBlock(value, asContext(context, vassal)));
    }
    const childScope = resolvePath(key, context);
    if (key === "employer" && !childScope) return false;
    assert(childScope, `fixture missing scope ${key}`);
    return evalBlock(value, asContext(context, childScope));
  }

  if (triggers.some((entry) => entry.key === key) && value === "yes") {
    return evalBlock(nested(triggers, key), context);
  }

  if (key === "exists") return resolvePath(value, context) !== undefined && resolvePath(value, context) !== null;
  if (key === "scope:transfer_type") return operator === "=" && context.scopes.transferType === value;
  if (key === "has_variable") return (context.scope?.variables || []).includes(value) || (context.scope?.flags || []).includes(value);
  if (key === "has_character_flag") return (context.scope?.flags || []).includes(value);
  if (key === "tier" || key === "highest_held_title_tier") {
    const actual = key === "tier" ? context.scope?.tier : context.scope?.highestHeldTitleTier;
    const expected = resolvePath(value, context);
    if (operator === "=") return actual === expected;
    if (operator === ">") return actual > expected;
    if (operator === ">=") return actual >= expected;
    if (operator === "<") return actual < expected;
    if (operator === "<=") return actual <= expected;
  }
  if (key === "has_title_law_flag") return context.scope?.lawFlags?.includes(value) === (operator === "=");
  if (key === "has_title_law") return context.scope?.lawIds?.includes(value) === (operator === "=");
  if (key === "is_oe_noble_family_title") {
    const variables = context.scope?.variables;
    const isOeNobleFamily = context.scope?.nobleFamilyTitle === true ||
      Boolean(variables?.oe_aristocrat_title) || (Array.isArray(variables) && variables.includes("oe_aristocrat_title"));
    return isOeNobleFamily === (value === "yes");
  }
  if (key === "government_has_flag") return context.scope?.governmentFlags?.includes(value) === (operator === "=");
  if (key === "has_primary_title") return context.scope?.primaryTitle?.id === value.replace(/^title:/, "");
  if (key === "target_is_de_jure_liege_or_above") {
    const target = resolvePath(value, context);
    const actual = Boolean(target?.id && context.scope?.deJureTargets?.includes(target.id));
    return actual === (operator === "=");
  }
  if (key === "holder") return sameEntity(context.scope?.holder, resolvePath(value, context)) === (operator === "=");
  if (key === "this") return sameEntity(context.scope, resolvePath(value, context)) === (operator === "=");
  if (["is_alive", "is_landed", "is_independent_ruler", "is_title_created", "is_landless_type_title", "is_noble_family_title", "is_leased_out"].includes(key)) {
    const actual = context.scope?.[{
      is_alive: "alive",
      is_landed: "landed",
      is_independent_ruler: "independent",
      is_title_created: "created",
      is_landless_type_title: "landlessTypeTitle",
      is_noble_family_title: "nobleFamilyTitle",
      is_leased_out: "leasedOut"
    }[key]];
    const expected = value === "yes";
    return actual === (operator === "=" ? expected : !expected);
  }
  if (key === "top_liege") return sameEntity(context.scope?.topLiege, resolvePath(value, context)) === (operator === "=");
  if (key === "is_courtier_of") return sameEntity(context.scope?.courtierOf, resolvePath(value, context)) === (operator === "=");
  assert.fail(`unhandled condition ${key} ${operator} ${value}`);
}

function evalBlock(entries, context) {
  return entries.every((entry) => evalEntry(entry, context));
}

function evalTrigger(name, context) {
  return evalBlock(nested(triggers, name), context);
}

function executeEntries(entries, context) {
  for (let index = 0; index < entries.length; index += 1) {
    const { key, value } = entries[index];
    if (key === "if" || key === "else_if" || key === "else") {
      if (key !== "if") continue;
      const branches = [entries[index]];
      while (index + 1 < entries.length && ["else_if", "else"].includes(entries[index + 1].key)) branches.push(entries[++index]);
      for (const branch of branches) {
        const limit = branch.value.find((entry) => entry.key === "limit");
        if (!limit || evalBlock(limit.value, context)) {
          executeEntries(branch.value.filter((entry) => entry.key !== "limit"), context);
          break;
        }
      }
      continue;
    }
    if (key === "every_held_title" || key === "every_vassal" || key === "every_ruler") {
      const items = key === "every_held_title" ? context.scope?.heldTitles || []
        : key === "every_vassal" ? context.scope?.vassals || [] : context.worldRulers || [];
      const limit = value.find((entry) => entry.key === "limit");
      for (const item of items) {
        const childContext = asContext(context, item);
        if (!limit || evalBlock(limit.value, childContext)) {
          executeEntries(value.filter((entry) => entry.key !== "limit"), childContext);
        }
      }
      continue;
    }
    if (key === "save_temporary_scope_as" || key === "save_scope_as") {
      context.scopes[value] = context.scope;
      continue;
    }
    if (key === "set_variable") {
      const name = value.find((entry) => entry.key === "name")?.value;
      if (name) {
        context.scope.variables ||= [];
        if (!context.scope.variables.includes(name)) context.scope.variables.push(name);
      }
      continue;
    }
    if (key === "remove_variable") {
      context.scope.variables = (context.scope.variables || []).filter((name) => name !== value);
      continue;
    }
    if (key === "add_character_flag") {
      context.scope.flags ||= [];
      if (!context.scope.flags.includes(value)) context.scope.flags.push(value);
      continue;
    }
    if (key === "trigger_event") {
      context.scheduledEvents.push({
        id: value.find((entry) => entry.key === "id")?.value,
        days: value.find((entry) => entry.key === "days")?.value,
        owner: context.scope
      });
      continue;
    }
    if (key === "create_title_and_vassal_change") {
      const name = value.find((entry) => entry.key === "save_scope_as")?.value;
      if (name) context.scopes[name] = { id: name, kind: "title_vassal_change" };
      continue;
    }
    if (key === "change_title_holder") {
      const target = resolvePath(value.find((entry) => entry.key === "holder")?.value, context);
      context.changes.push({
        type: key,
        subject: context.scope,
        target
      });
      context.scope.holder = target;
      continue;
    }
    if (key === "change_liege") {
      const target = resolvePath(value.find((entry) => entry.key === "liege")?.value, context);
      const formerLiege = context.scope.liege;
      context.changes.push({ type: key, subject: context.scope, target });
      if (formerLiege?.vassals) formerLiege.vassals = formerLiege.vassals.filter((vassal) => !sameEntity(vassal, context.scope));
      target.vassals ||= [];
      if (!target.vassals.some((vassal) => sameEntity(vassal, context.scope))) target.vassals.push(context.scope);
      context.scope.liege = target;
      continue;
    }
    if (key === "resolve_title_and_vassal_change") continue;
    if (key === "votc_celestial_repair_legacy_foreign_state_effect" ||
        key === "votc_celestial_repair_foreign_admin_vassals_effect" ||
        key === "votc_celestial_release_office_title_effect" ||
        key === "votc_celestial_release_lower_offices_effect" ||
        key === "votc_celestial_office_promotion_cleanup_effect" ||
        key === "votc_celestial_office_schedule_region_recheck_effect") {
      executeEntries(nested(effects, key), context);
      continue;
    }
    if (Array.isArray(value)) {
      const childScope = resolvePath(key, context);
      assert(childScope, `fixture missing effect scope ${key}`);
      executeEntries(value, asContext(context, childScope));
    }
  }
}

function dispatchOnAction(nativeName, context) {
  const nativeHook = nested(onActions, nativeName);
  const names = nested(nativeHook, "on_actions").map((entry) => entry.key);
  for (const name of names) {
    const action = nested(onActions, name);
    const actionTrigger = action.find((entry) => entry.key === "trigger");
    if (actionTrigger && !evalBlock(actionTrigger.value, context)) continue;
    const actionEffect = action.find((entry) => entry.key === "effect");
    if (actionEffect) executeEntries(actionEffect.value, context);
  }
}

function executeEvent(name, context) {
  const event = nested(events, name);
  const trigger = event.find((entry) => entry.key === "trigger");
  if (trigger && !evalBlock(trigger.value, context)) return false;
  const immediate = event.find((entry) => entry.key === "immediate");
  if (immediate) executeEntries(immediate.value, context);
  return true;
}

function effectContext(root, scope = root, scopes = {}) {
  return { root, scope, scopes: { ...scopes }, scheduledEvents: [], changes: [] };
}

const emperor = {
  id: "h_china_holder",
  alive: true,
  landed: true,
  highestHeldTitleTier: tierValues.tier_hegemony,
  governmentFlags: ["government_is_celestial"],
  primaryTitle: { id: "h_china", tier: tierValues.tier_hegemony },
  topLiege: null
};
emperor.topLiege = emperor;

function rulerFixture({ governmentFlags = ["government_is_celestial"], topTitle = "h_china", primaryTitleTier = 4, primaryLaw = "appointment_type_succession", lawIds = [], independent = false } = {}) {
  const topLiege = topTitle === "h_china" ? emperor : { ...emperor, id: "foreign_emperor", primaryTitle: { id: topTitle, tier: 5 } };
  return {
    id: "guangdong_governor",
    alive: true,
    landed: true,
    independent,
    highestHeldTitleTier: primaryTitleTier,
    governmentFlags,
    primaryTitle: { id: "k_guangdong", tier: primaryTitleTier, lawFlags: primaryLaw ? [primaryLaw] : [], lawIds },
    topLiege
  };
}

function promotionContext({ root = rulerFixture(), previousTier = 3, transferType = "flag:appointment" } = {}) {
  const previousTitle = { id: "d_guangdong", tier: previousTier };
  return { scope: root, root, scopes: { previousTitle, transferType } };
}

const attachable = nested(triggers, "oe_stream_patch_attachable_trigger");
const legacyAttachable = parsePdx(`
oe_stream_patch_attachable_trigger = {
  is_title_created = yes
  tier >= tier_county
  is_landless_type_title = no
  is_noble_family_title = no
  is_leased_out = no
  tier < scope:oe_stream_fix_target.highest_held_title_tier
}`, "legacy OE trigger");
const legacyTrigger = nested(legacyAttachable, "oe_stream_patch_attachable_trigger");
const guangdongFixTarget = { id: "guangdong_governor", highestHeldTitleTier: 4, primaryTitle: { id: "k_guangdong" }, topLiege: emperor };
const hebeiDuchy = {
  id: "d_hebei",
  tier: 3,
  created: true,
  landlessTypeTitle: false,
  nobleFamilyTitle: false,
  leasedOut: false,
  lawFlags: ["appointment_type_succession"],
  deJureTargets: ["k_hebei", "h_china"]
};
const crossRegionContext = { scope: hebeiDuchy, root: rulerFixture(), scopes: { fixTarget: guangdongFixTarget } };
assert.equal(evalBlock(legacyTrigger, crossRegionContext), true, "old OE filter incorrectly rejects the foreign-title control fixture");
assert.equal(evalBlock(attachable, crossRegionContext), false, "Hebei duchy must not be attached to the Guangdong king");
const localDuchy = { ...hebeiDuchy, id: "d_guangdong", deJureTargets: ["k_guangdong", "h_china"] };
assert.equal(evalBlock(attachable, { ...crossRegionContext, scope: localDuchy }), true, "same-region duchy remains attachable");
assert.equal(evalBlock(attachable, { ...crossRegionContext, scope: { ...localDuchy, lawIds: ["SanGong_zongfan_succession_law"] } }), false, "an explicitly hereditary Chinese title is never attached");
const oeAristocratTitle = { ...localDuchy, variables: { oe_aristocrat_title: true } };
assert.equal(evalBlock(legacyTrigger, { ...crossRegionContext, scope: oeAristocratTitle }), true, "old OE filter misses a variable-marked noble-family title");
assert.equal(evalBlock(attachable, { ...crossRegionContext, scope: oeAristocratTitle }), false, "Chinese repair excludes OE variable-marked noble-family titles");
const byzantineFixTarget = { ...guangdongFixTarget, topLiege: { ...emperor, primaryTitle: { id: "e_roman_empire", tier: 5 } } };
assert.equal(evalBlock(attachable, { ...crossRegionContext, scopes: { fixTarget: byzantineFixTarget }, scope: { ...localDuchy, lawFlags: [] } }), true, "non-Chinese upstream repair retains non-appointment titles in-region");
assert.equal(evalBlock(attachable, { ...crossRegionContext, scopes: { fixTarget: byzantineFixTarget }, scope: hebeiDuchy }), true, "non-Chinese upstream repair retains foreign-de-jure titles accepted by the original OE filter");

const promotionCases = [
  ["Guangdong duke promoted to emperor", promotionContext(), true],
  ["granted upward title transfer", promotionContext({ transferType: "flag:granted" }), true],
  ["stepped-down upward title transfer", promotionContext({ transferType: "flag:stepped_down" }), true],
  ["same-rank appointment transfer", promotionContext({ previousTier: 4 }), false],
  ["down-rank title transfer", promotionContext({ previousTier: 5 }), false],
  ["missing transfer scope", promotionContext({ transferType: null }), false],
  ["inheritance transfer", promotionContext({ transferType: "flag:inheritance" }), false],
  ["Chinese non-administrative candidate may queue before its government transition", promotionContext({ root: rulerFixture({ governmentFlags: ["government_is_administrative"] }) }), true],
  ["Chinese feudal candidate may queue before its government transition", promotionContext({ root: rulerFixture({ governmentFlags: [] }) }), true],
  ["non-Chinese top liege", promotionContext({ root: rulerFixture({ topTitle: "e_roman_empire" }) }), false],
  ["primary title uses the explicit hereditary law", promotionContext({ root: rulerFixture({ lawIds: ["SanGong_zongfan_succession_law"] }) }), false]
];
for (const [label, context, expected] of promotionCases) {
  assert.equal(evalTrigger("votc_celestial_office_promotion_trigger", context), expected, label);
}

const newPrimary = rulerFixture({ primaryTitleTier: 5 }).primaryTitle;
const releaseRoot = { ...rulerFixture({ primaryTitleTier: 5 }), primaryTitle: newPrimary };
function officeFixture({ id = "d_old_office", tier = 3, lawFlags = ["appointment_type_succession"], lawIds = [], leasedOut = false, nobleFamilyTitle = false, variables = {}, landlessTypeTitle = false } = {}) {
  return {
    id,
    tier,
    holder: releaseRoot,
    lawFlags,
    lawIds,
    leasedOut,
    nobleFamilyTitle,
    variables,
    landlessTypeTitle,
    created: true,
    deJureTargets: []
  };
}
function titleContext(title) {
  return { scope: title, root: releaseRoot, scopes: { cleanupRoot: releaseRoot, cleanupEmperor: emperor } };
}

const releaseCases = [
  ["old duchy appointment", officeFixture(), true],
  ["old county appointment", officeFixture({ id: "c_old_office", tier: 2 }), true],
  ["barony is not separately enumerated", officeFixture({ id: "b_old_office", tier: 1 }), false],
  ["new higher office stays with promoted ruler", officeFixture({ id: "e_new_office", tier: 5 }), false],
  ["inherited office title stays", officeFixture({ lawIds: ["SanGong_zongfan_succession_law"] }), false],
  ["OE aristocrat variable title stays", officeFixture({ variables: { oe_aristocrat_title: true } }), false],
  ["leased title stays", officeFixture({ leasedOut: true }), false],
  ["noble family title stays", officeFixture({ nobleFamilyTitle: true }), false],
  ["landless title stays", officeFixture({ landlessTypeTitle: true }), false],
  ["non-appointment title stays", officeFixture({ lawFlags: [] }), false]
];
for (const [label, title, expected] of releaseCases) {
  assert.equal(evalTrigger("votc_celestial_office_release_title_trigger", titleContext(title)), expected, label);
}
const legacyForeignOffice = officeFixture({ id: "d_old_hebei_office" });
legacyForeignOffice.deJureTargets = ["k_hebei", "h_china"];
const legacyLocalOffice = officeFixture({ id: "d_local_office" });
legacyLocalOffice.deJureTargets = ["k_guangdong", "h_china"];
assert.equal(evalTrigger("votc_celestial_legacy_foreign_office_title_trigger", titleContext(legacyForeignOffice)), true, "legacy repair releases only a provably foreign old office");
assert.equal(evalTrigger("votc_celestial_legacy_foreign_office_title_trigger", titleContext(legacyLocalOffice)), false, "legacy repair cannot infer that a local lower title is stale");
assert.equal(evalTrigger("votc_celestial_legacy_foreign_office_title_trigger", titleContext(officeFixture({ lawIds: ["SanGong_zongfan_succession_law"] }))), false, "legacy repair preserves an explicitly hereditary office");

const releaseTitle = officeFixture();
const sameEmpireHeir = {
  id: "same_region_count",
  alive: true,
  landed: true,
  highestHeldTitleTier: 2,
  topLiege: emperor,
  primaryTitle: { id: "c_guangdong", tier: 2, lawFlags: ["appointment_type_succession"], deJureTargets: [releaseTitle.id] }
};
const releaseHeirContext = { scope: sameEmpireHeir, root: emperor, scopes: { releaseTitle, cleanupRoot: releaseRoot, cleanupEmperor: emperor } };
assert.equal(evalTrigger("votc_celestial_office_release_heir_trigger", releaseHeirContext), true, "same-empire, lower-rank, same-region current heir is eligible");
const foreignOfficial = { ...sameEmpireHeir, primaryTitle: { ...sameEmpireHeir.primaryTitle, id: "d_hebei", deJureTargets: ["k_hebei"] } };
assert.equal(evalTrigger("votc_celestial_office_release_heir_trigger", { ...releaseHeirContext, scope: foreignOfficial }), true, "an old office's same-empire lower-ranked current heir may be appointed from another region");
const guangdongCountyHeir = { ...sameEmpireHeir, primaryTitle: { ...sameEmpireHeir.primaryTitle, id: "c_guangdong", deJureTargets: ["d_guangdong"] } };
assert.equal(evalTrigger("votc_celestial_office_release_heir_trigger", { ...releaseHeirContext, scope: guangdongCountyHeir }), true, "being from the new-primary region does not invalidate the old title's own current heir");
assert.equal(evalTrigger("votc_celestial_office_release_heir_trigger", { ...releaseHeirContext, scope: releaseRoot }), false, "the promoted ruler cannot inherit its own lower office");
assert.equal(evalTrigger("votc_celestial_office_release_heir_trigger", { ...releaseHeirContext, scope: { ...sameEmpireHeir, alive: false } }), false, "dead heir is not eligible");
assert.equal(evalTrigger("votc_celestial_office_release_heir_trigger", { ...releaseHeirContext, scope: { ...sameEmpireHeir, landed: false } }), true, "a landless current heir belonging to the same empire is eligible");
assert.equal(evalTrigger("votc_celestial_office_release_heir_trigger", { ...releaseHeirContext, scope: { ...sameEmpireHeir, highestHeldTitleTier: 4 } }), false, "equal-or-higher title rank is not eligible");
assert.equal(evalTrigger("votc_celestial_office_release_heir_trigger", { ...releaseHeirContext, scope: { ...sameEmpireHeir, topLiege: { id: "other_empire" } } }), false, "other-empire heir is not eligible");
const unlandedHeir = { id: "court_heir", alive: true, landed: false, courtierOf: emperor };
assert.equal(evalTrigger("votc_celestial_office_release_heir_trigger", { ...releaseHeirContext, scope: unlandedHeir }), true, "unlanded court heir has a provable same-empire court chain");
assert.equal(evalTrigger("votc_celestial_office_release_heir_trigger", { ...releaseHeirContext, scope: { ...unlandedHeir, courtierOf: undefined } }), false, "unlanded heir without a same-empire court chain is ineligible");
const employedHeir = { id: "employed_heir", alive: true, landed: false, employer: { id: "employer", topLiege: emperor } };
assert.equal(evalTrigger("votc_celestial_office_release_heir_trigger", { ...releaseHeirContext, scope: employedHeir }), true, "unlanded heir with a same-empire employer chain is eligible");

const cleanupRoot = { ...releaseRoot, primaryTitle: { id: "k_guangdong", tier: 4, lawFlags: ["appointment_type_succession"] } };
function vassalFixture({ id, lawFlags = ["appointment_type_succession"], lawIds = [], variables = {}, deJureTargets = ["k_hebei"] }) {
  return {
    id,
    alive: true,
    landed: true,
    independent: false,
    governmentFlags: ["government_use_bureaucracy"],
    topLiege: emperor,
    primaryTitle: { id, tier: 3, lawFlags, lawIds, variables, deJureTargets }
  };
}
const foreignVassalContext = {
  scope: vassalFixture({ id: "d_hebei" }),
  root: cleanupRoot,
  scopes: { cleanupRoot, cleanupEmperor: emperor }
};
assert.equal(evalTrigger("votc_celestial_foreign_admin_vassal_trigger", foreignVassalContext), true, "foreign administrative vassal is eligible for scoped repair");
assert.equal(evalTrigger("votc_celestial_foreign_admin_vassal_trigger", {
  ...foreignVassalContext,
  scope: vassalFixture({ id: "c_guangdong", deJureTargets: ["k_guangdong", "h_china"] })
}), false, "local county remains under its current liege");
assert.equal(evalTrigger("votc_celestial_foreign_admin_vassal_trigger", {
  ...foreignVassalContext,
  scope: vassalFixture({ id: "d_hebei", lawIds: ["SanGong_zongfan_succession_law"] })
}), false, "hereditary vassal is outside legacy repair");
assert.equal(evalTrigger("votc_celestial_foreign_admin_vassal_trigger", {
  ...foreignVassalContext,
  scope: vassalFixture({ id: "d_hebei", variables: { oe_aristocrat_title: true } })
}), false, "OE variable-marked noble-family vassal is outside legacy repair");
assert.equal(evalTrigger("votc_celestial_foreign_admin_vassal_trigger", {
  ...foreignVassalContext,
  scope: vassalFixture({ id: "d_hebei", lawFlags: [] })
}), false, "non-administrative vassal is outside legacy repair");

const releaseEffect = nested(effects, "votc_celestial_release_office_title_effect");
assert.equal(releaseEffect.some((entry) => entry.key === "change_title_holder_include_vassals"), false, "release must not recursively move protected hereditary descendants");
assert.equal(releaseEffect.some((entry) => entry.key === "destroy_landed_title"), false, "release must transfer titles instead of destroying them");
const changeHolderEntries = findAll(releaseEffect, "change_title_holder");
assert.equal(changeHolderEntries.length, 2, "county and higher office use one recipient and transaction path");
assert.deepEqual(changeHolderEntries.map((entry) => one(entry.value, "take_baronies")).sort(), ["no", "yes"], "county transfers take baronies, higher titles do not");
assert.equal(findAll(releaseEffect, "create_title_and_vassal_change").length, 1, "one transfer transaction is opened per old office");
assert.equal(findAll(releaseEffect, "resolve_title_and_vassal_change").length, 1, "one transfer transaction is resolved per old office");
assert.equal(one(findAll(releaseEffect, "create_title_and_vassal_change")[0].value, "type"), "appointment");
assert(findAll(releaseEffect, "save_temporary_scope_as").some((entry) => entry.value === "votc_celestial_release_recipient"), "fallback emperor is the default recipient before checking the old office heir");
assert(findAll(releaseEffect, "current_heir").length >= 1, "a valid current heir overrides the fallback recipient");

const promotionOnAction = nested(onActions, "votc_celestial_office_release_primary_title");
const promotionEffect = nested(promotionOnAction, "effect");
const scheduledEvent = nested(promotionEffect, "trigger_event");
assert.equal(one(scheduledEvent, "days"), "1", "title cleanup waits for the native transfer tick");
assert.equal(one(scheduledEvent, "id"), "votc_celestial_office_release.0001");
assert(!onActionSource.includes("?="), "missing transfer scopes must not be treated as a match");

const legacyCleanup = nested(onActions, "votc_celestial_office_legacy_vassal_cleanup");
const legacyEffect = nested(legacyCleanup, "effect");
const rulerLoop = nested(legacyEffect, "every_ruler");
assert(rulerLoop.some((entry) => entry.key === "votc_celestial_repair_legacy_foreign_state_effect"), "legacy scan invokes the per-ruler, explicit-scope repair");
assert(!rulerLoop.some((entry) => entry.key === "votc_celestial_release_lower_offices_effect"), "legacy scan must not release local counties on load");
assert(findAll(rulerLoop, "has_character_flag").some((entry) => entry.value === "votc_celestial_office_v104_state_checked"), "one-time migration is gated by the v1.0.4 per-ruler completion flag");
assert(findAll(rulerLoop, "add_character_flag").some((entry) => entry.value === "votc_celestial_office_legacy_state_checked"), "migration preserves the legacy completion marker");
assert(findAll(rulerLoop, "add_character_flag").some((entry) => entry.value === "votc_celestial_office_v104_state_checked"), "migration records its own per-ruler completion flag");
const legacyRepair = nested(effects, "votc_celestial_repair_legacy_foreign_state_effect");
const legacyRepairPasses = legacyRepair.map((entry, index) => entry.key === "votc_celestial_repair_foreign_admin_vassals_effect" ? index : -1).filter((index) => index >= 0);
assert.equal(legacyRepairPasses.length, 2, "legacy cleanup repairs foreign administrative vassals before and after title transfers");
const legacyTitleLoop = nested(legacyRepair, "every_held_title");
const legacyTitleLoopIndex = legacyRepair.findIndex((entry) => entry.key === "every_held_title");
assert(legacyRepairPasses[0] < legacyTitleLoopIndex && legacyRepairPasses[1] > legacyTitleLoopIndex, "legacy post-transfer repair runs after all foreign office transactions resolve");
assert(nested(legacyTitleLoop, "limit").some((entry) => entry.key === "votc_celestial_legacy_foreign_office_title_trigger"), "legacy title cleanup is restricted to provably foreign old offices");
assert(legacyTitleLoop.some((entry) => entry.key === "votc_celestial_release_office_title_effect"), "foreign old offices use the same safe title transfer transaction");

const promotionCleanup = nested(effects, "votc_celestial_office_promotion_cleanup_effect");
const promotionCleanupBody = nested(promotionCleanup, "if");
const promotionRepairPasses = promotionCleanupBody.map((entry, index) => entry.key === "votc_celestial_repair_foreign_admin_vassals_effect" ? index : -1).filter((index) => index >= 0);
const promotionReleaseIndex = promotionCleanupBody.findIndex((entry) => entry.key === "votc_celestial_release_lower_offices_effect");
assert.equal(promotionRepairPasses.length, 2, "promotion cleanup repairs foreign administrative vassals before and after title transfers");
assert(promotionRepairPasses[0] < promotionReleaseIndex && promotionRepairPasses[1] > promotionReleaseIndex, "promotion post-transfer repair runs after all lower-office transactions resolve");

const repairEffect = nested(effects, "votc_celestial_repair_foreign_admin_vassals_effect");
assert(findAll(repairEffect, "this").some((entry) => entry.operator === "!=" && entry.value === "scope:votc_celestial_cleanup_root"), "a de-jure target equal to the cleanup root is rejected so emperor fallback can run");
assert(findAll(repairEffect, "else_if").length > 0, "invalid or non-higher de-jure targets fall back to the Chinese emperor");

const hiddenEvent = nested(events, "votc_celestial_office_release.0001");
assert.equal(one(nested(hiddenEvent, "trigger"), "has_variable"), "votc_celestial_office_release_pending");
assert(findAll(nested(hiddenEvent, "immediate"), "votc_celestial_office_promotion_cleanup_effect").length > 0);

const regionHooks = [
  ["on_primary_title_change", "votc_celestial_office_region_recheck"],
  ["on_title_gain", "votc_celestial_office_region_title_gain"],
  ["on_title_lost", "votc_celestial_office_region_recheck"],
  ["on_vassal_change", "votc_celestial_office_region_recheck"],
  ["on_vassal_gained", "votc_celestial_office_region_vassal_gain"]
];
for (const [nativeHook, handler] of regionHooks) {
  assert(nested(nested(onActions, nativeHook), "on_actions").some((entry) => entry.key === handler), `${nativeHook} must reach ${handler}`);
}
const regionQueue = nested(onActions, "votc_celestial_office_region_recheck");
assert(findAll(nested(regionQueue, "trigger"), "has_variable").some((entry) => entry.value === "votc_celestial_office_region_pending"), "region scheduling is idempotent on its own marker");
assert(!findAll(nested(regionQueue, "trigger"), "has_variable").some((entry) => entry.value === "votc_celestial_office_release_pending"), "promotion pending cannot suppress a region recheck");
const regionSchedule = nested(effects, "votc_celestial_office_schedule_region_recheck_effect");
assert.equal(one(nested(regionSchedule, "set_variable"), "name"), "votc_celestial_office_region_pending");
assert.equal(one(nested(regionSchedule, "set_variable"), "days"), "2");
assert.equal(one(nested(regionSchedule, "trigger_event"), "id"), "votc_celestial_office_release.0002");
assert.equal(one(nested(regionSchedule, "trigger_event"), "days"), "1");
const regionEvent = nested(events, "votc_celestial_office_release.0002");
assert.equal(one(nested(regionEvent, "trigger"), "has_variable"), "votc_celestial_office_region_pending");
assert(findAll(nested(regionEvent, "immediate"), "votc_celestial_office_cleanup_root_trigger").length > 0, "deferred repair rechecks full current cleanup eligibility");
assert(findAll(nested(regionEvent, "immediate"), "remove_variable").some((entry) => entry.value === "votc_celestial_office_region_pending"), "region pending clears after recheck");

function regionTitle(id, tier, holder, options = {}) {
  return {
    id,
    tier,
    holder,
    lawFlags: options.lawFlags || [],
    lawIds: options.lawIds || [],
    variables: options.variables || [],
    deJureTargets: options.deJureTargets || [],
    deJureLiege: options.deJureLiege,
    created: true,
    landlessTypeTitle: options.landlessTypeTitle === true,
    nobleFamilyTitle: options.nobleFamilyTitle === true,
    leasedOut: options.leasedOut === true,
    currentHeir: options.currentHeir
  };
}

function regionFixture({ governmentFlags = ["government_use_bureaucracy"], topTitle = "h_china", secondaryKind = null } = {}) {
  const emperorTitle = regionTitle(topTitle, 5, null);
  const regionalEmperor = {
    id: `emperor_${topTitle}`,
    alive: true,
    landed: true,
    independent: true,
    governmentFlags: ["government_is_celestial"],
    primaryTitle: emperorTitle,
    highestHeldTitleTier: 5,
    topLiege: null,
    heldTitles: [emperorTitle],
    vassals: [],
    variables: [],
    flags: []
  };
  regionalEmperor.topLiege = regionalEmperor;
  emperorTitle.holder = regionalEmperor;
  const primaryTitle = regionTitle("k_guangdong", 4, null, {
    lawFlags: ["appointment_type_succession"], deJureTargets: ["h_china"]
  });
  const root = {
    id: "regional_governor",
    alive: true,
    landed: true,
    independent: false,
    governmentFlags,
    primaryTitle,
    highestHeldTitleTier: 4,
    topLiege: regionalEmperor,
    liege: regionalEmperor,
    heldTitles: [primaryTitle],
    vassals: [],
    variables: [],
    flags: []
  };
  primaryTitle.holder = root;
  const secondaryTitle = secondaryKind ? regionTitle("k_hebei", 4, root, {
    lawIds: secondaryKind === "zongfan" ? ["SanGong_zongfan_succession_law"] : ["partition_succession_law"]
  }) : null;
  if (secondaryTitle) root.heldTitles.push(secondaryTitle);
  const foreignOffice = regionTitle("d_hebei", 3, root, {
    lawFlags: ["appointment_type_succession"], deJureTargets: ["k_hebei", "h_china"]
  });
  const localOffice = regionTitle("d_guangdong", 3, root, {
    lawFlags: ["appointment_type_succession"], deJureTargets: ["k_guangdong", "h_china"]
  });
  const hereditaryOffice = regionTitle("d_hebei_hereditary", 3, root, {
    lawFlags: ["appointment_type_succession"], lawIds: ["SanGong_zongfan_succession_law"], deJureTargets: ["k_hebei"]
  });
  const familyOffice = regionTitle("d_family_office", 3, root, {
    lawFlags: ["appointment_type_succession"], variables: ["oe_aristocrat_title"], deJureTargets: ["k_hebei"]
  });
  const ordinaryOffice = regionTitle("d_non_appointment", 3, root, { deJureTargets: ["k_hebei"] });
  root.heldTitles.push(foreignOffice, localOffice, hereditaryOffice, familyOffice, ordinaryOffice);
  return { emperor: regionalEmperor, root, primaryTitle, secondaryTitle, foreignOffice, localOffice, hereditaryOffice, familyOffice, ordinaryOffice };
}

function runRegionEvent(world) {
  world.root.variables ||= [];
  if (!world.root.variables.includes("votc_celestial_office_region_pending")) {
    world.root.variables.push("votc_celestial_office_region_pending");
  }
  return executeEvent("votc_celestial_office_release.0002", effectContext(world.root));
}

const secondaryWorld = regionFixture({ secondaryKind: "zongfan" });
const secondaryRegionContext = effectContext(secondaryWorld.root, secondaryWorld.foreignOffice, { regionHolder: secondaryWorld.root });
assert.equal(evalTrigger("votc_celestial_title_in_holder_region_trigger", secondaryRegionContext), true,
  "a legally held, higher hereditary/SanGong secondary kingdom supplies its own de-jure region");
assert.equal(evalTrigger("votc_celestial_legacy_foreign_office_title_trigger", effectContext(secondaryWorld.root, secondaryWorld.foreignOffice, {
  cleanupRoot: secondaryWorld.root, cleanupEmperor: secondaryWorld.emperor
})), false, "the higher secondary kingdom prevents a false foreign-office classification");
runRegionEvent(secondaryWorld);
assert.equal(secondaryWorld.foreignOffice.holder, secondaryWorld.root, "a cross-primary title inside the legal secondary kingdom stays with its holder");
assert(!secondaryWorld.root.variables.includes("votc_celestial_office_region_pending"), "the deferred regional check clears its independent pending marker");

const titleLostContext = effectContext(secondaryWorld.root);
secondaryWorld.root.heldTitles = secondaryWorld.root.heldTitles.filter((title) => title !== secondaryWorld.secondaryTitle);
dispatchOnAction("on_title_lost", titleLostContext);
assert.deepEqual(titleLostContext.scheduledEvents.map((item) => item.id), ["votc_celestial_office_release.0002"],
  "losing a secondary kingdom schedules a region recheck even when the primary kingdom is unchanged");
executeEvent("votc_celestial_office_release.0002", titleLostContext);
assert.equal(secondaryWorld.foreignOffice.holder, secondaryWorld.emperor, "after the secondary region is lost, only the outside lower office transfers");
assert.equal(secondaryWorld.localOffice.holder, secondaryWorld.root, "the remaining primary-region office stays put");
assert.equal(secondaryWorld.hereditaryOffice.holder, secondaryWorld.root, "the old hereditary/SanGong office remains protected");
assert.equal(secondaryWorld.familyOffice.holder, secondaryWorld.root, "family-marked lower titles remain protected");
assert.equal(secondaryWorld.ordinaryOffice.holder, secondaryWorld.root, "non-appointment lower titles remain protected");
assert.deepEqual(titleLostContext.changes.filter((change) => change.type === "change_title_holder").map((change) => change.subject.id), ["d_hebei"],
  "the lifecycle repair transfers only the out-of-region appointed office");

const sameRankWorld = regionFixture();
const sameRankContext = effectContext(sameRankWorld.root, sameRankWorld.root, {
  previousTitle: regionTitle("k_old_guangdong", 4, sameRankWorld.root),
  transferType: "flag:appointment"
});
dispatchOnAction("on_primary_title_change", sameRankContext);
assert.deepEqual(sameRankContext.scheduledEvents.map((item) => item.id), ["votc_celestial_office_release.0002"],
  "same-rank primary-title switches still run regional validation but do not enter promotion release");

const gainWorld = regionFixture({ governmentFlags: [] });
gainWorld.root.primaryTitle.lawFlags = [];
const incomingOffice = regionTitle("k_incoming_kingdom", 4, gainWorld.root, {
  lawFlags: ["appointment_type_succession"], deJureTargets: ["h_china"]
});
const titleGainContext = effectContext(gainWorld.root, gainWorld.root, { title: incomingOffice });
dispatchOnAction("on_title_gain", titleGainContext);
assert.deepEqual(titleGainContext.scheduledEvents.map((item) => item.id), ["votc_celestial_office_release.0002"],
  "an incoming appointed title is detected even before it becomes primary and before the government changes");
gainWorld.root.governmentFlags = ["government_use_bureaucracy"];
gainWorld.root.primaryTitle = incomingOffice;
gainWorld.root.heldTitles.push(incomingOffice);
executeEvent("votc_celestial_office_release.0002", titleGainContext);
assert(titleGainContext.changes.some((change) => change.type === "change_title_holder" && change.subject === gainWorld.foreignOffice),
  "the delayed event rechecks after the government transition and cleans the foreign office");

const promotionPendingWorld = regionFixture();
promotionPendingWorld.root.variables.push("votc_celestial_office_region_pending");
const promotionPendingContext = effectContext(promotionPendingWorld.root, promotionPendingWorld.root, {
  previousTitle: regionTitle("d_previous", 3, promotionPendingWorld.root),
  transferType: "flag:stepped_down"
});
dispatchOnAction("on_primary_title_change", promotionPendingContext);
assert.deepEqual(promotionPendingContext.scheduledEvents.map((item) => item.id), ["votc_celestial_office_release.0001"],
  "a region pending marker does not suppress an eligible promotion queue");

const regionPendingWorld = regionFixture();
regionPendingWorld.root.variables.push("votc_celestial_office_release_pending");
const regionPendingContext = effectContext(regionPendingWorld.root);
dispatchOnAction("on_vassal_change", regionPendingContext);
assert.deepEqual(regionPendingContext.scheduledEvents.map((item) => item.id), ["votc_celestial_office_release.0002"],
  "a promotion pending marker does not suppress an independent regional recheck");

const nonChinaWorld = regionFixture({ topTitle: "e_byzantium" });
const nonChinaContext = effectContext(nonChinaWorld.root, nonChinaWorld.root, {
  previousTitle: regionTitle("d_previous", 3, nonChinaWorld.root), transferType: "flag:appointment"
});
dispatchOnAction("on_primary_title_change", nonChinaContext);
dispatchOnAction("on_vassal_change", nonChinaContext);
assert.deepEqual(nonChinaContext.scheduledEvents, [], "a non-China top liege never queues promotion or region repair");
assert.deepEqual(nonChinaContext.changes, [], "a non-China top liege receives no title or liege changes");

const nonAdminWorld = regionFixture({ governmentFlags: ["government_is_administrative"] });
const nonAdminContext = effectContext(nonAdminWorld.root, nonAdminWorld.root, {
  previousTitle: regionTitle("d_previous", 3, nonAdminWorld.root), transferType: "flag:appointment"
});
dispatchOnAction("on_primary_title_change", nonAdminContext);
assert(nonAdminContext.scheduledEvents.some((item) => item.id === "votc_celestial_office_release.0001"),
  "a Chinese appointment candidate may queue before a government conversion settles");
executeEvent("votc_celestial_office_release.0001", nonAdminContext);
executeEvent("votc_celestial_office_release.0002", nonAdminContext);
assert.deepEqual(nonAdminContext.changes, [], "a still non-administrative Chinese candidate is rechecked and receives no cleanup changes");

const gainedVassalWorld = regionFixture();
gainedVassalWorld.root.heldTitles = gainedVassalWorld.root.heldTitles.filter((title) => title !== gainedVassalWorld.foreignOffice);
const gainedVassalTitle = regionTitle("d_new_hebei", 3, null, {
  lawFlags: ["appointment_type_succession"], deJureTargets: ["k_hebei", "h_china"]
});
const gainedVassal = {
  id: "new_hebei_official", alive: true, landed: true, independent: false,
  governmentFlags: [], primaryTitle: gainedVassalTitle, highestHeldTitleTier: 3,
  topLiege: gainedVassalWorld.emperor, heldTitles: [gainedVassalTitle], vassals: [], variables: [], flags: [], liege: gainedVassalWorld.root
};
gainedVassalTitle.holder = gainedVassal;
gainedVassalWorld.root.vassals.push(gainedVassal);
const vassalGainContext = effectContext(gainedVassalWorld.root, gainedVassalWorld.root, { vassal: gainedVassal });
dispatchOnAction("on_vassal_gained", vassalGainContext);
assert.deepEqual(vassalGainContext.scheduledEvents.map((item) => item.id), ["votc_celestial_office_release.0002"],
  "vassal-gained recognizes an outside appointed title before the vassal government conversion");
executeEvent("votc_celestial_office_release.0002", vassalGainContext);
assert.deepEqual(vassalGainContext.changes, [], "a vassal that remains outside the administrative governments is not repaired");
gainedVassal.variables = [];
gainedVassal.governmentFlags = ["government_use_bureaucracy"];
const afterGovernmentTransition = effectContext(gainedVassalWorld.root, gainedVassalWorld.root, { vassal: gainedVassal });
dispatchOnAction("on_vassal_gained", afterGovernmentTransition);
assert.deepEqual(afterGovernmentTransition.scheduledEvents.map((item) => item.id), ["votc_celestial_office_release.0002"],
  "after government conversion the same lifecycle hook queues a fresh deferred recheck");
executeEvent("votc_celestial_office_release.0002", afterGovernmentTransition);
assert(vassalGainContext.changes.length === 0, "the earlier event did not mutate the pre-conversion vassal");
assert.equal(gainedVassal.liege, gainedVassalWorld.emperor, "a newly administrative foreign direct vassal is reparented after the delayed eligibility check");
assert(afterGovernmentTransition.changes.some((change) => change.type === "change_liege" && change.subject === gainedVassal),
  "the requalified administrative vassal is corrected by the delayed repair");

const selfVassalWorld = regionFixture();
const selfVassal = {
  id: "self_de_jure_vassal", alive: true, landed: true, independent: false,
  governmentFlags: ["government_use_bureaucracy"], topLiege: selfVassalWorld.emperor,
  highestHeldTitleTier: 3, heldTitles: [], vassals: [], variables: [], flags: [], liege: selfVassalWorld.root
};
const selfDeJureKingdom = regionTitle("k_remote_self", 4, selfVassal);
const selfDeJureDuchy = regionTitle("d_remote_self", 3, selfVassal, {
  lawFlags: ["appointment_type_succession"], deJureTargets: ["k_remote_self", "h_china"], deJureLiege: selfDeJureKingdom
});
selfVassal.primaryTitle = selfDeJureDuchy;
selfVassal.heldTitles.push(selfDeJureKingdom, selfDeJureDuchy);
selfVassalWorld.root.vassals.push(selfVassal);
const selfVassalEvent = effectContext(selfVassalWorld.root);
selfVassalEvent.scope.variables.push("votc_celestial_office_region_pending");
executeEvent("votc_celestial_office_release.0002", selfVassalEvent);
const selfReparentChanges = selfVassalEvent.changes.filter((change) => change.type === "change_liege");
assert.deepEqual(selfReparentChanges.map((change) => [change.subject.id, change.target.id]), [[selfVassal.id, selfVassalWorld.emperor.id]],
  "when the de-jure holder is the foreign vassal itself, repair falls back to the emperor without creating a self-liege edge");
assert.notEqual(selfVassal.liege, selfVassal, "the repair never leaves a foreign administrative vassal self-lieged");

console.log(`Celestial office release: PASS (${promotionCases.length} promotion, ${releaseCases.length} title-scope, region lifecycle, heir, cross-region and migration fixtures)`);
