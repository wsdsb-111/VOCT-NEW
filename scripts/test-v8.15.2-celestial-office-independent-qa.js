"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modRoot = path.join(__dirname, "..", "compatibility-mods", "VOTC_Three_Mod_Character_Name_Compatibility");
const triggerPath = path.join(modRoot, "common", "scripted_triggers", "zzzz_votc_celestial_office_release.txt");
const actionPath = path.join(modRoot, "common", "on_action", "zzzz_votc_celestial_office_release.txt");
const effectPath = path.join(modRoot, "common", "scripted_effects", "zzzz_votc_celestial_office_release.txt");
const eventPath = path.join(modRoot, "events", "votc_celestial_office_release_events.txt");
const successionPath = path.join(modRoot, "common", "succession_appointment", "zzzzz_votc_celestial_governor.txt");
const successionValuePath = path.join(modRoot, "common", "script_values", "votc_celestial_succession_values.txt");
const TIERS = { tier_barony: 0, tier_county: 1, tier_duchy: 2, tier_kingdom: 3, tier_empire: 4 };
const LATERAL_TARGET_VARIABLES = {
  [TIERS.tier_county]: "votc_celestial_lateral_county_target",
  [TIERS.tier_duchy]: "votc_celestial_lateral_duchy_target",
  [TIERS.tier_kingdom]: "votc_celestial_lateral_target",
  [TIERS.tier_empire]: "votc_celestial_lateral_empire_target"
};
const LATERAL_PENDING_VARIABLE = "votc_celestial_office_lateral_pending";

function tokenize(source) {
  const tokens = [];
  let index = 0;
  let line = 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\n") { line += 1; index += 1; continue; }
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "#") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === '"') {
      const startLine = line;
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === "\\" && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
        } else {
          if (source[index] === "\n") line += 1;
          value += source[index];
          index += 1;
        }
      }
      assert.equal(source[index], '"', `unterminated quoted token at line ${startLine}`);
      index += 1;
      tokens.push({ value, line: startLine });
      continue;
    }
    if ("{}".includes(char)) { tokens.push({ value: char, line }); index += 1; continue; }
    if ("=<>!".includes(char) || char === "?") {
      const start = index;
      index += 1;
      if (source[index] === "=") index += 1;
      tokens.push({ value: source.slice(start, index), line });
      continue;
    }
    const start = index;
    while (index < source.length && !/\s/.test(source[index]) && !"{}=<>!?\"#".includes(source[index])) index += 1;
    assert(index > start, `unrecognized token at line ${line}`);
    tokens.push({ value: source.slice(start, index), line });
  }
  return tokens;
}

function parsePdx(source, label) {
  const tokens = tokenize(source);
  let index = 0;
  function parseBlock(nested = false) {
    const entries = [];
    while (index < tokens.length) {
      if (tokens[index].value === "}") {
        assert(nested, `${label}:${tokens[index].line}: unexpected closing brace`);
        index += 1;
        return { entries };
      }
      const key = tokens[index++];
      const next = tokens[index];
      if (!next || !["=", "?=", ">", ">=", "<", "<=", "!=", "=="].includes(next.value)) {
        entries.push({ key: key.value, op: null, value: key.value, line: key.line });
        continue;
      }
      const op = tokens[index++];
      assert(tokens[index], `${label}:${key.line}: missing value for ${key.value}`);
      const value = tokens[index].value === "{" ? (index += 1, parseBlock(true)) : tokens[index++].value;
      entries.push({ key: key.value, op: op.value, value, line: key.line });
    }
    assert(!nested, `${label}: missing closing brace`);
    return { entries };
  }
  return parseBlock();
}

function readPdx(filePath) { return parsePdx(fs.readFileSync(filePath, "utf8"), path.basename(filePath)); }
function all(block, key) { return block.entries.filter(entry => entry.key === key); }
function first(block, key) { return all(block, key)[0] || null; }
function countDescendants(block, key) {
  return (block.entries || []).reduce((count, entry) => count + (entry.key === key ? 1 : 0) +
    (typeof entry.value === "object" ? countDescendants(entry.value, key) : 0), 0);
}
function child(block, key) {
  const entry = first(block, key);
  return entry && typeof entry.value === "object" ? entry.value : null;
}
function scalar(block, key) {
  const entry = first(block, key);
  return entry && typeof entry.value === "string" ? entry.value : null;
}
function named(root, name) {
  const matches = all(root, name).filter(entry => typeof entry.value === "object");
  assert.equal(matches.length, 1, `expected exactly one production definition ${name}`);
  return matches[0].value;
}

const triggerFile = readPdx(triggerPath);
const actionFile = readPdx(actionPath);
const effectFile = readPdx(effectPath);
const eventFile = readPdx(eventPath);
const successionFile = readPdx(successionPath);
const successionValueFile = readPdx(successionValuePath);
const triggerDefs = Object.fromEntries(triggerFile.entries.filter(entry => typeof entry.value === "object").map(entry => [entry.key, entry.value]));
const effectDefs = Object.fromEntries(effectFile.entries.filter(entry => typeof entry.value === "object").map(entry => [entry.key, entry.value]));
const actionDefs = Object.fromEntries(actionFile.entries.filter(entry => typeof entry.value === "object").map(entry => [entry.key, entry.value]));

function title(id, tier, holder, options = {}) {
  return {
    kind: "title", id, tier, holder, current_heir: options.current_heir || null,
    created: options.created !== false,
    title_law_flags: new Set(options.title_law_flags || []),
    title_laws: new Set(options.title_laws || []),
    variables: new Set(options.variables || []), variableValues: new Map(), variableLists: new Map(),
    landless: options.landless === true,
    noble_family: options.noble_family === true,
    leased_out: options.leased_out === true,
    baronies: options.baronies || [],
    de_jure_ancestors: new Set(options.de_jure_ancestors || []),
    de_jure_liege: options.de_jure_liege || null,
    vassals: []
  };
}

function character(id, options = {}) {
  return {
    kind: "character", id, alive: options.alive !== false, landed: options.landed !== false,
    independent: options.independent === true, government_flags: new Set(options.government_flags || []),
    primary_title: options.primary_title || null, top_liege: options.top_liege || null,
    highest_held_title_tier: options.highest_held_title_tier ?? options.primary_title?.tier ?? -1,
    current_heir: options.current_heir || null, held_titles: options.held_titles || [],
    variables: new Set(options.variables || []), variableValues: new Map(),
    vassals: options.vassals || [], liege: options.liege || null, flags: new Set(options.flags || [])
  };
}

function sameEntity(left, right) {
  if (left === right) return true;
  return Boolean(left && right && left.id && right.id && left.id === right.id);
}

function resolvePath(reference, env) {
  if (reference === "this") return env.current;
  if (reference === "root") return env.root;
  if (reference === "prev") return env.previous ?? null;
  if (reference.startsWith("scope:")) {
    const parts = reference.slice(6).split(".");
    let value = env.scopes[parts.shift()];
    for (const part of parts) value = value == null ? null : value[part];
    return value ?? null;
  }
  if (reference.startsWith("var:")) {
    const parts = reference.slice(4).split(".");
    const variableName = parts.shift();
    let value = env.current?.variableValues?.get(variableName) ?? null;
    for (const part of parts) value = value == null ? null : value[part];
    return value;
  }
  if (reference.startsWith("root.")) {
    return reference.slice(5).split(".").reduce((value, part) => value == null ? null : value[part], env.root);
  }
  if (reference.startsWith("this.")) {
    return reference.slice(5).split(".").reduce((value, part) => value == null ? null : value[part], env.current);
  }
  if (reference.includes(".")) {
    return reference.split(".").reduce((value, part) => value == null ? null : value[part], env.current);
  }
  if (reference.startsWith("title:")) return { kind: "title_ref", id: reference.slice(6) };
  if (reference.startsWith("flag:")) return reference.slice(5);
  if (reference in TIERS) return TIERS[reference];
  if (reference === "yes") return true;
  if (reference === "no") return false;
  return reference;
}

function currentValue(key, env) {
  if (key === "this") return env.current;
  if (key === "prev") return env.previous ?? null;
  if (key.startsWith("scope:") || key.startsWith("var:") || key.startsWith("root.") || key.startsWith("this.")) return resolvePath(key, env);
  return env.current == null ? null : env.current[key];
}

function isTruthyFlag(value) { return value === true || value === "yes"; }

function compare(left, op, right) {
  if (left && left.kind === "title" && right?.kind === "title_ref") return left.id === right.id;
  if (left && left.id && right?.kind === "title_ref") return left.id === right.id;
  if (right?.kind === "title_ref" && left?.id) return left.id === right.id;
  if (op === "=") return sameEntity(left, right) || left === right;
  if (op === "==") return sameEntity(left, right) || left === right;
  if (op === "?=") return sameEntity(left, right) || left === right;
  if (op === "!=") return !(sameEntity(left, right) || left === right);
  if (op === ">") return left > right;
  if (op === ">=") return left >= right;
  if (op === "<") return left < right;
  if (op === "<=") return left <= right;
  return false;
}

function withCurrent(env, current) { return { ...env, previous: env.current, current }; }

function evalTrigger(block, env, stack = []) {
  assert(block && Array.isArray(block.entries), "trigger interpreter received a non-block AST node");
  return block.entries.every(entry => evalTriggerEntry(entry, env, stack));
}

function evalTriggerEntry(entry, env, stack) {
  const value = entry.value;
  if (entry.key === "is_target_in_variable_list") {
    const name = scalar(value, "name");
    const target = resolvePath(scalar(value, "target"), env);
    return (env.current?.variableLists?.get(name) || []).some(item => sameEntity(item, target));
  }
  if (entry.key === "save_temporary_scope_as") {
    env.scopes[String(value)] = env.current;
    return true;
  }
  if (typeof value === "object") {
    if (entry.key === "AND") return value.entries.every(childEntry => evalTriggerEntry(childEntry, env, stack));
    if (entry.key === "OR") return value.entries.some(childEntry => evalTriggerEntry(childEntry, env, stack));
    if (entry.key === "NOT") return !evalTrigger(value, env, stack);
    if (entry.key === "root") return evalTrigger(value, withCurrent(env, env.root), stack);
    if (entry.key.startsWith("root.")) return evalTrigger(value, withCurrent(env, resolvePath(entry.key, env)), stack);
    if (entry.key.startsWith("scope:")) return evalTrigger(value, withCurrent(env, resolvePath(entry.key, env)), stack);
    if (entry.key.includes(".")) return evalTrigger(value, withCurrent(env, resolvePath(entry.key, env)), stack);
    if (entry.key === "any_vassal") return (env.current?.vassals || []).some(vassal => evalTrigger(value, withCurrent(env, vassal), stack));
    if (entry.key === "any_held_title") return (env.current?.held_titles || []).some(heldTitle => evalTrigger(value, withCurrent(env, heldTitle), stack));
    if (["top_liege", "primary_title", "current_heir", "de_jure_liege", "holder", "employer", "previous_holder"].includes(entry.key)) {
      return evalTrigger(value, withCurrent(env, currentValue(entry.key, env)), stack);
    }
    if (entry.key.startsWith("var:")) return evalTrigger(value, withCurrent(env, resolvePath(entry.key, env)), stack);
    assert.fail(`unsupported nested trigger AST key ${entry.key} at line ${entry.line}`);
  }

  if (triggerDefs[entry.key]) {
    assert(!stack.includes(entry.key) && stack.length < 20, `trigger recursion cycle: ${[...stack, entry.key].join(" -> ")}`);
    return isTruthyFlag(resolvePath(value, env)) && evalTrigger(triggerDefs[entry.key], env, [...stack, entry.key]);
  }
  if (entry.key === "exists") {
    const resolved = resolvePath(value, env);
    return (resolved === value ? currentValue(String(value), env) : resolved) != null;
  }
  if (entry.key === "government_has_flag") return env.current?.government_flags?.has(resolvePath(value, env)) === true;
  if (entry.key === "has_character_flag") return env.current?.flags?.has(resolvePath(value, env)) === true;
  if (entry.key === "has_title_law_flag") return env.current?.title_law_flags?.has(resolvePath(value, env)) === true;
  if (entry.key === "has_title_law") return env.current?.title_laws?.has(resolvePath(value, env)) === true;
  if (entry.key === "has_variable") {
    const variable = resolvePath(value, env);
    return env.current?.variables?.has(variable) === true || env.current?.flags?.has(variable) === true;
  }
  if (entry.key === "is_oe_noble_family_title") {
    // Model the OE dependency's existing trigger contract: native noble-family
    // titles OR titles carrying the oe_aristocrat_title variable.
    const isOeNobleFamily = env.current?.noble_family === true ||
      env.current?.variables?.has("oe_aristocrat_title") === true;
    return isTruthyFlag(resolvePath(value, env)) ? isOeNobleFamily : !isOeNobleFamily;
  }
  if (entry.key === "has_primary_title") return env.current?.primary_title?.id === String(value).replace(/^title:/, "");
  if (entry.key === "is_courtier_of") return sameEntity(env.current?.employer, resolvePath(value, env));
  if (entry.key === "is_alive") return env.current?.alive === isTruthyFlag(resolvePath(value, env));
  if (entry.key === "is_landed") return env.current?.landed === isTruthyFlag(resolvePath(value, env));
  if (entry.key === "is_independent_ruler") return env.current?.independent === isTruthyFlag(resolvePath(value, env));
  if (entry.key === "is_title_created") return env.current?.created === isTruthyFlag(resolvePath(value, env));
  if (entry.key === "is_landless_type_title") return env.current?.landless === isTruthyFlag(resolvePath(value, env));
  if (entry.key === "is_noble_family_title") return env.current?.noble_family === isTruthyFlag(resolvePath(value, env));
  if (entry.key === "is_leased_out") return env.current?.leased_out === isTruthyFlag(resolvePath(value, env));
  if (entry.key === "target_is_de_jure_liege_or_above") {
    const target = resolvePath(value, env);
    return Boolean(target?.id && env.current?.de_jure_ancestors?.has(target.id));
  }
  if (entry.key === "tier" || entry.key === "highest_held_title_tier") {
    return compare(currentValue(entry.key, env), entry.op, resolvePath(value, env));
  }
  return compare(currentValue(entry.key, env), entry.op, resolvePath(value, env));
}

function executeEffect(name, env) {
  assert(effectDefs[name], `missing production effect definition ${name}`);
  executeEntries(effectDefs[name], env);
}

function executeAction(name, env) {
  const action = actionDefs[name];
  assert(action, `missing production action definition ${name}`);
  const trigger = child(action, "trigger");
  if (trigger && !evalTrigger(trigger, env)) return false;
  const effect = child(action, "effect");
  if (effect) executeEntries(effect, env);
  return true;
}

function executeEntries(block, env) {
  for (let index = 0; index < block.entries.length; index += 1) {
    const entry = block.entries[index];
    if (entry.key === "if" || entry.key === "else_if" || entry.key === "else") {
      if (entry.key !== "if") continue;
      const branches = [entry];
      while (index + 1 < block.entries.length && ["else_if", "else"].includes(block.entries[index + 1].key)) {
        branches.push(block.entries[++index]);
      }
      for (const branch of branches) {
        const branchBlock = branch.value;
        const limit = child(branchBlock, "limit");
        if (!limit || evalTrigger(limit, env)) {
          executeEntries({ entries: branchBlock.entries.filter(item => item.key !== "limit") }, env);
          break;
        }
      }
      continue;
    }
    if (entry.key === "every_held_title" || entry.key === "every_vassal" || entry.key === "every_ruler" || entry.key === "every_in_list") {
      const items = entry.key === "every_held_title" ? [...(env.current?.held_titles || [])] :
        entry.key === "every_vassal" ? [...(env.current?.vassals || [])] :
        entry.key === "every_ruler" ? [...(env.worldRulers || [])] :
        [...(env.current?.variableLists?.get(scalar(entry.value, "variable")) || [])];
      const limit = child(entry.value, "limit");
      for (const item of items) {
        const nestedEnv = withCurrent(env, item);
        if (!limit || evalTrigger(limit, nestedEnv)) {
          executeEntries({ entries: entry.value.entries.filter(itemEntry =>
            itemEntry.key !== "limit" && (entry.key !== "every_in_list" || itemEntry.key !== "variable")) }, nestedEnv);
        }
      }
      continue;
    }
    if (entry.key === "votc_celestial_release_office_title_effect" ||
        entry.key === "votc_celestial_release_lower_offices_effect" ||
        entry.key === "votc_celestial_repair_foreign_admin_vassals_effect" ||
        entry.key === "votc_celestial_repair_legacy_foreign_state_effect" ||
        entry.key === "votc_celestial_office_promotion_cleanup_effect") {
      executeEffect(entry.key, env);
      continue;
    }
    if (effectDefs[entry.key]) {
      executeEffect(entry.key, env);
      continue;
    }
    if (actionDefs[entry.key] && typeof entry.value !== "object") {
      executeAction(entry.key, env);
      continue;
    }
    if (entry.key === "save_temporary_scope_as" || entry.key === "save_scope_as") {
      env.scopes[String(entry.value)] = env.current;
      continue;
    }
    if (entry.key === "create_title_and_vassal_change") {
      const name = scalar(entry.value, "save_scope_as");
      if (name) env.scopes[name] = { kind: "change", id: name };
      continue;
    }
    if (["top_liege", "primary_title", "current_heir", "de_jure_liege", "holder", "liege", "previous_holder"].includes(entry.key)) {
      const nestedScope = currentValue(entry.key, env);
      assert(nestedScope && typeof nestedScope === "object", `missing effect scope ${entry.key} at line ${entry.line}`);
      executeEntries(entry.value, withCurrent(env, nestedScope));
      continue;
    }
    if (entry.key === "change_title_holder") {
      const holderRef = scalar(entry.value, "holder");
      const takeBaronies = scalar(entry.value, "take_baronies");
      const target = resolvePath(holderRef, env);
      const transaction = resolvePath(scalar(entry.value, "change"), env);
      env.changes.push({ type: "change_title_holder", subject: env.current, target,
        take_baronies: takeBaronies, transaction });
      if (env.simulateTitleTransfers === true) {
        env.pendingTitleTransfers ||= [];
        env.pendingTitleTransfers.push({ title: env.current, previousHolder: env.current.holder,
          target, takeBaronies: takeBaronies === "yes", transaction });
      }
      continue;
    }
    if (entry.key === "change_liege") {
      const target = resolvePath(scalar(entry.value, "liege"), env);
      const formerLiege = env.current.liege;
      env.changes.push({ type: "change_liege", subject: env.current, target });
      if (formerLiege?.vassals) formerLiege.vassals = formerLiege.vassals.filter(vassal => !sameEntity(vassal, env.current));
      if (target?.vassals && !target.vassals.some(vassal => sameEntity(vassal, env.current))) target.vassals.push(env.current);
      env.current.liege = target;
      continue;
    }
    if (entry.key === "add_character_flag") {
      env.current.flags.add(String(entry.value));
      continue;
    }
    if (entry.key === "set_variable") {
      const name = scalar(entry.value, "name");
      if (name) {
        env.current.variables.add(name);
        const assignedValue = first(entry.value, "value");
        if (assignedValue) env.current.variableValues.set(name, resolvePath(assignedValue.value, env));
      }
      continue;
    }
    if (entry.key === "remove_variable") {
      env.current.variables.delete(String(entry.value));
      env.current.variableValues.delete(String(entry.value));
      continue;
    }
    if (entry.key === "clear_variable_list") {
      env.current.variableLists?.delete(String(entry.value));
      continue;
    }
    if (entry.key === "add_to_variable_list") {
      const name = scalar(entry.value, "name");
      const target = resolvePath(scalar(entry.value, "target"), env);
      assert(name && target && typeof target === "object",
        `add_to_variable_list requires a named entity target at line ${entry.line}`);
      const list = env.current.variableLists.get(name) || [];
      if (!list.some(item => sameEntity(item, target))) list.push(target);
      env.current.variableLists.set(name, list);
      continue;
    }
    if (entry.key === "set_primary_title_to") {
      const target = resolvePath(String(entry.value), env);
      assert(target?.kind === "title", `set_primary_title_to requires a title scope at line ${entry.line}`);
      env.changes.push({ type: "set_primary_title_to", subject: env.current, target });
      env.current.primary_title = target;
      continue;
    }
    if (entry.key === "set_character_flag") {
      env.current.flags.add(String(entry.value));
      continue;
    }
    if (entry.key === "remove_character_flag") {
      env.current.flags.delete(String(entry.value));
      continue;
    }
    if (entry.key === "resolve_title_and_vassal_change") {
      const transaction = resolvePath(String(entry.value), env);
      if (env.simulateTitleTransfers === true) {
        const transfers = (env.pendingTitleTransfers || []).filter(transfer => transfer.transaction === transaction);
        env.pendingTitleTransfers = (env.pendingTitleTransfers || []).filter(transfer => transfer.transaction !== transaction);
        for (const transfer of transfers) {
          const movedTitles = [transfer.title];
          if (transfer.takeBaronies) {
            movedTitles.push(...(transfer.previousHolder?.held_titles || []).filter(held =>
              held.tier === TIERS.tier_barony && held.de_jure_liege === transfer.title));
          }
          for (const movedTitle of movedTitles) {
            if (transfer.previousHolder?.held_titles) {
              transfer.previousHolder.held_titles = transfer.previousHolder.held_titles.filter(held => !sameEntity(held, movedTitle));
              if (transfer.previousHolder.primary_title === movedTitle) transfer.previousHolder.primary_title = null;
              transfer.previousHolder.highest_held_title_tier = Math.max(-1,
                ...transfer.previousHolder.held_titles.map(held => held.tier));
            }
            movedTitle.holder = transfer.target;
            if (transfer.target?.held_titles && !transfer.target.held_titles.some(held => sameEntity(held, movedTitle))) {
              transfer.target.held_titles.push(movedTitle);
              transfer.target.highest_held_title_tier = Math.max(transfer.target.highest_held_title_tier, movedTitle.tier);
            }
          }
          if (typeof env.onTitleTransfer === "function") {
            env.onTitleTransfer(transfer.title, transfer.previousHolder, transfer.target, transfer.takeBaronies);
          }
        }
      }
      if (typeof env.afterResolve === "function") env.afterResolve(transaction, env);
      continue;
    }
    if (entry.key === "trigger_event") {
      env.scheduledEvents.push({
        id: scalar(entry.value, "id"),
        days: scalar(entry.value, "days"),
        owner: env.current
      });
      continue;
    }
    if (typeof entry.value === "object") {
      const nestedScope = resolvePath(entry.key, env);
      assert(nestedScope && typeof nestedScope === "object", `unsupported effect scope ${entry.key} at line ${entry.line}`);
      executeEntries(entry.value, withCurrent(env, nestedScope));
      continue;
    }
    assert.fail(`unsupported effect AST key ${entry.key} at line ${entry.line}`);
  }
}

function envFor(root, current, scopes = {}) { return { root, current, scopes, changes: [], scheduledEvents: [] }; }
function assertTrigger(name, env, expected, reason) {
  const block = named(triggerFile, name);
  assert.equal(evalTrigger(block, env), expected, reason);
}

function invokeHook(gameOnAction, env) {
  const onAction = actionDefs[gameOnAction];
  assert(onAction, `missing production game on_action ${gameOnAction}`);
  const registrations = child(onAction, "on_actions");
  assert(registrations, `${gameOnAction} must register a production callback`);
  let invoked = 0;
  for (const registration of registrations.entries) {
    if (actionDefs[registration.key] && executeAction(registration.key, env)) invoked += 1;
  }
  return invoked;
}

function runRegionRecheckEvent(env) {
  const event = named(eventFile, "votc_celestial_office_release.0002");
  const trigger = child(event, "trigger");
  assert(trigger && evalTrigger(trigger, env), "the deferred region event must have its pending marker");
  executeEntries(child(event, "immediate"), env);
}

function runLateralRecheckEvent(env) {
  const event = named(eventFile, "votc_celestial_office_release.0003");
  const trigger = child(event, "trigger");
  assert(trigger && evalTrigger(trigger, env), "the deferred lateral event must have its pending marker");
  executeEntries(child(event, "immediate"), env);
}

function testAstAndPromotionGate() {
  const primaryHook = child(actionFile, "on_primary_title_change");
  assert(primaryHook, "production must hook the documented primary-title-change action");
  assert(all(child(primaryHook, "on_actions"), "votc_celestial_office_release_primary_title").length === 1);
  const hook = named(actionFile, "votc_celestial_office_release_primary_title");
  assert.equal(scalar(child(hook, "effect"), "trigger_event"), null,
    "the deferred event is nested; parser must not mistake a block for a scalar");
  const schedule = child(child(hook, "effect"), "trigger_event");
  assert.equal(scalar(schedule, "id"), "votc_celestial_office_release.0001");
  assert.equal(scalar(schedule, "days"), "1", "office release must wait for title settlement");
  assert.equal(scalar(child(child(hook, "effect"), "set_variable"), "name"), "votc_celestial_office_release_pending");

  const emperorTitle = title("h_china", TIERS.tier_empire, null);
  const emperor = character("emperor", { primary_title: emperorTitle, highest_held_title_tier: TIERS.tier_empire,
    government_flags: ["government_is_celestial"] });
  emperorTitle.holder = emperor;
  const oldPrimary = title("d_old", TIERS.tier_duchy, null, { title_law_flags: ["appointment_type_succession"] });
  const newPrimary = title("k_new", TIERS.tier_kingdom, null, { title_law_flags: ["appointment_type_succession"] });
  const root = character("promoted-governor", { top_liege: emperor, primary_title: newPrimary,
    highest_held_title_tier: TIERS.tier_kingdom, government_flags: ["government_use_bureaucracy"] });
  oldPrimary.holder = root;
  newPrimary.holder = root;
  const promotion = { root, current: root, scopes: { previous_title: oldPrimary, transfer_type: "appointment" }, changes: [] };
  assertTrigger("votc_celestial_office_promotion_trigger", promotion, true,
    "a documented appointment primary-title change from lower to higher tier must schedule cleanup");
  promotion.scopes.transfer_type = "appointment_succession";
  assertTrigger("votc_celestial_office_promotion_trigger", promotion, true,
    "appointment succession is also an office-promotion transfer");
  promotion.scopes.transfer_type = null;
  assertTrigger("votc_celestial_office_promotion_trigger", promotion, false,
    "a missing transfer_type fixture must fail closed");
  promotion.scopes.transfer_type = "granted";
  assertTrigger("votc_celestial_office_promotion_trigger", promotion, true,
    "a granted higher appointment title may schedule the same bounded office cleanup");
  promotion.scopes.transfer_type = "stepped_down";
  assertTrigger("votc_celestial_office_promotion_trigger", promotion, true,
    "a stepped-down ruler may schedule cleanup of lower appointment offices");
  promotion.scopes.transfer_type = "inheritance";
  assertTrigger("votc_celestial_office_promotion_trigger", promotion, false,
    "inheritance remains outside the rank-up cleanup transfer set");
  promotion.scopes.transfer_type = "abdication";
  assertTrigger("votc_celestial_office_promotion_trigger", promotion, false,
    "abdication remains outside the rank-up cleanup transfer set");
  promotion.scopes.transfer_type = "appointment";
  promotion.scopes.previous_title = newPrimary;
  assertTrigger("votc_celestial_office_promotion_trigger", promotion, false,
    "same-rank or higher previous title is not a promotion eligible for cleanup");

  const event = named(eventFile, "votc_celestial_office_release.0001");
  assert.equal(scalar(event, "hidden"), "yes");
  assert.equal(scalar(child(event, "trigger"), "has_variable"), "votc_celestial_office_release_pending");
  assert(first(child(child(event, "immediate"), "if"), "limit"));
  assert(all(child(child(event, "immediate"), "if"), "votc_celestial_office_promotion_cleanup_effect").length === 1);
  const cleanup = named(effectFile, "votc_celestial_office_promotion_cleanup_effect");
  assert(all(cleanup, "remove_variable").some(entry => entry.value === "votc_celestial_office_release_pending"),
    "deferred marker must be cleared after the cleanup attempt");
}

function eligibleOfficeFixtures(root, emperor, primary) {
  const oldHeir = character("old-office-heir", { top_liege: emperor, primary_title: null, highest_held_title_tier: TIERS.tier_county });
  const newPrimaryHeir = character("new-primary-heir", { top_liege: emperor, primary_title: null, highest_held_title_tier: TIERS.tier_kingdom });
  const oldOffice = title("d_old_office", TIERS.tier_duchy, root, {
    title_law_flags: ["appointment_type_succession"], current_heir: oldHeir
  });
  const oldHeirCounty = title("c_old_heir", TIERS.tier_county, oldHeir, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: ["k_old_heir_region"]
  });
  oldHeir.primary_title = oldHeirCounty;
  const newHeirTitle = title("c_new_primary_heir", TIERS.tier_county, newPrimaryHeir, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: [primary.id]
  });
  newPrimaryHeir.primary_title = newHeirTitle;
  newPrimaryHeir.highest_held_title_tier = TIERS.tier_county;
  root.current_heir = newPrimaryHeir;

  const countyOfficeHeir = character("old-county-heir", { landed: false, top_liege: emperor,
    highest_held_title_tier: -1 });
  const countyOffice = title("c_old_office", TIERS.tier_county, root, {
    title_law_flags: ["appointment_type_succession"], current_heir: countyOfficeHeir
  });

  const specialZongfan = title("k_zongfan", TIERS.tier_kingdom, root, {
    title_law_flags: ["appointment_type_succession"], title_laws: ["SanGong_zongfan_succession_law"]
  });
  const nobleFamily = title("k_noble_family", TIERS.tier_kingdom, root, {
    title_law_flags: ["appointment_type_succession"], noble_family: true
  });
  const landless = title("k_landless", TIERS.tier_kingdom, root, {
    title_law_flags: ["appointment_type_succession"], landless: true
  });
  const leased = title("c_leased", TIERS.tier_county, root, {
    title_law_flags: ["appointment_type_succession"], leased_out: true
  });
  const customAristocrat = title("d_custom_aristocrat", TIERS.tier_duchy, root, {
    title_law_flags: ["appointment_type_succession"], variables: ["oe_aristocrat_title"]
  });
  const hereditary = title("d_hereditary", TIERS.tier_duchy, root, { title_laws: ["partition_succession_law"] });
  const newPrimaryOffice = title("k_new_primary", TIERS.tier_kingdom, root, {
    title_law_flags: ["appointment_type_succession"]
  });
  root.primary_title = primary;
  root.held_titles = [primary, oldOffice, countyOffice, specialZongfan, nobleFamily, landless, leased, customAristocrat, hereditary, newPrimaryOffice];
  return { oldOffice, countyOffice, oldHeir, newPrimaryHeir, countyOfficeHeir, specialZongfan, nobleFamily, landless, leased, customAristocrat, hereditary, newPrimaryOffice };
}

function testReleaseBoundariesAndTitleHeir() {
  const emperorTitle = title("h_china", TIERS.tier_empire, null);
  const emperor = character("emperor", { primary_title: emperorTitle, highest_held_title_tier: TIERS.tier_empire,
    government_flags: ["government_is_celestial"] });
  emperorTitle.holder = emperor;
  const primary = title("k_new_primary", TIERS.tier_kingdom, null, { title_law_flags: ["appointment_type_succession"] });
  const root = character("promoted-governor", { top_liege: emperor, primary_title: primary,
    highest_held_title_tier: TIERS.tier_kingdom, government_flags: ["government_use_bureaucracy"] });
  primary.holder = root;
  const fixtures = eligibleOfficeFixtures(root, emperor, primary);
  const cleanupScopes = { votc_celestial_cleanup_root: root, votc_celestial_cleanup_emperor: emperor };
  const eligible = envFor(root, fixtures.oldOffice, { ...cleanupScopes, votc_celestial_release_title: fixtures.oldOffice });
  assertTrigger("votc_celestial_office_release_title_trigger", eligible, true,
    "a lower-tier, held, non-leased appointment duchy is releasable");
  assert.equal(fixtures.customAristocrat.noble_family, false,
    "fixture deliberately bypasses the native noble-family title predicate");
  assert(fixtures.customAristocrat.variables.has("oe_aristocrat_title"),
    "fixture carries OE's independent custom aristocrat marker");
  const oeNobleYes = { key: "is_oe_noble_family_title", op: "=", value: "yes", line: 0 };
  const oeNobleNo = { ...oeNobleYes, value: "no" };
  assert.equal(evalTriggerEntry(oeNobleYes, envFor(root, fixtures.customAristocrat)), true,
    "OE's scripted predicate is true from oe_aristocrat_title even while native noble-family is false");
  assert.equal(evalTriggerEntry(oeNobleNo, envFor(root, fixtures.customAristocrat)), false,
    "the OE scripted predicate must reject its custom aristocrat variable");
  assert.equal(evalTriggerEntry(oeNobleNo, envFor(root, fixtures.oldOffice)), true,
    "an ordinary title with neither native nor OE noble-family markers remains eligible");
  assert.equal(evalTriggerEntry(oeNobleYes, envFor(root, fixtures.nobleFamily)), true,
    "OE's scripted predicate also preserves native noble-family titles through its OR branch");
  for (const protectedTitle of [fixtures.specialZongfan, fixtures.nobleFamily, fixtures.landless,
    fixtures.leased, fixtures.customAristocrat, fixtures.hereditary, fixtures.newPrimaryOffice]) {
    const context = envFor(root, protectedTitle, { ...cleanupScopes, votc_celestial_release_title: protectedTitle });
    assertTrigger("votc_celestial_office_release_title_trigger", context, false,
      `${protectedTitle.id} is outside the old-office release set`);
  }

  const releaseContext = envFor(root, fixtures.oldOffice, { ...cleanupScopes, votc_celestial_release_title: fixtures.oldOffice });
  const previousRegionalGuard = parsePdx(`
    previous_regional_guard = {
      NOT = {
        primary_title = {
          has_title_law_flag = appointment_type_succession
          NOT = { target_is_de_jure_liege_or_above = scope:votc_celestial_release_title }
        }
      }
    }
  `, "pre-fix-heir-regional-guard").entries[0].value;
  assert.equal(evalTrigger(previousRegionalGuard, withCurrent(releaseContext, fixtures.oldOffice.current_heir)), false,
    "the pre-fix regional gate is a retained negative control: it rejected the old title's cross-region current heir");
  assertTrigger("votc_celestial_office_release_heir_trigger", withCurrent(releaseContext, fixtures.oldOffice.current_heir), true,
    "the old duchy's own lower-ranked, same-empire appointed county heir remains eligible even when their county is in another region");
  assertTrigger("votc_celestial_office_release_heir_trigger", withCurrent(releaseContext, root.current_heir), true,
    "the new primary heir can pass candidate safety independently, so release must select by the old title's current_heir scope");
  assert.notEqual(fixtures.oldOffice.current_heir, root.current_heir,
    "fixture separates old title succession from the new primary office successor");

  const sameTierHeir = character("same-tier-old-office-heir", { top_liege: emperor,
    highest_held_title_tier: TIERS.tier_duchy });
  const higherTierHeir = character("higher-tier-old-office-heir", { top_liege: emperor,
    highest_held_title_tier: TIERS.tier_kingdom });
  const foreignEmperor = character("foreign-emperor", { independent: true,
    highest_held_title_tier: TIERS.tier_empire, government_flags: ["government_is_celestial"] });
  const foreignEmpireHeir = character("foreign-empire-old-office-heir", { top_liege: foreignEmperor,
    highest_held_title_tier: TIERS.tier_county });
  const deadHeir = character("dead-old-office-heir", { alive: false, top_liege: emperor,
    highest_held_title_tier: TIERS.tier_county });
  for (const [candidate, reason] of [
    [sameTierHeir, "a same-tier holder must not receive the released lower office"],
    [higherTierHeir, "a higher-tier holder must not receive the released lower office"],
    [foreignEmpireHeir, "an heir outside the cleanup emperor's realm must not receive the office"],
    [deadHeir, "a dead current heir must fall back safely"]
  ]) {
    assertTrigger("votc_celestial_office_release_heir_trigger", withCurrent(releaseContext, candidate), false, reason);
  }

  const lowRankOwner = character("low-rank-old-office-owner", { top_liege: emperor,
    highest_held_title_tier: TIERS.tier_county });
  assertTrigger("votc_celestial_office_release_heir_trigger", envFor(lowRankOwner, lowRankOwner, {
    votc_celestial_cleanup_root: lowRankOwner,
    votc_celestial_cleanup_emperor: emperor,
    votc_celestial_release_title: fixtures.oldOffice
  }), false, "the old office owner cannot be selected as its own heir even when all rank and realm checks pass");

  const landlessHeir = fixtures.countyOfficeHeir;
  assert(!Object.prototype.hasOwnProperty.call(landlessHeir, "employer"),
    "the landless fixture has no employer relationship to rely on");
  assertTrigger("votc_celestial_office_release_heir_trigger", withCurrent(releaseContext, landlessHeir), true,
    "a safe landless heir in the same Chinese empire can receive the title without a court/employer link");

  const run = envFor(root, root);
  executeEffect("votc_celestial_release_lower_offices_effect", run);
  const movedTitles = run.changes.filter(change => change.type === "change_title_holder");
  assert.deepStrictEqual(movedTitles.map(change => change.subject.id), [fixtures.oldOffice.id, fixtures.countyOffice.id],
    "release every lower eligible office while leaving special, hereditary and new-primary titles untouched");
  assert.deepStrictEqual(movedTitles.map(change => change.take_baronies), ["no", "yes"],
    "only county offices take their baronies; a higher office must not recursively consume them");
  assert.deepStrictEqual(movedTitles.map(change => change.target?.id), [fixtures.oldHeir.id, fixtures.countyOfficeHeir.id],
    "each office uses its own title heir, including a safe landless heir whose only realm proof is top_liege");
  assert(!movedTitles.some(change => change.target === root.current_heir),
    "new primary title's heir must not inherit a released old office");
  assert(!movedTitles.some(change => change.target === root), "a character must never receive their own old office through a self-heir loop");

  const independentRoot = character("independent-admin", { independent: true, top_liege: null, primary_title: primary,
    highest_held_title_tier: TIERS.tier_kingdom, government_flags: ["government_use_bureaucracy"] });
  primary.holder = independentRoot;
  const rootGate = envFor(independentRoot, independentRoot);
  assertTrigger("votc_celestial_office_cleanup_root_trigger", rootGate, false,
    "independent rulers do not enter the office release scope");
}

function testLegacyVassalRepair() {
  const empireTitle = title("h_china", TIERS.tier_empire, null);
  const emperor = character("emperor", { primary_title: empireTitle, highest_held_title_tier: TIERS.tier_empire,
    government_flags: ["government_is_celestial"] });
  empireTitle.holder = emperor;
  const primaryKingdom = title("k_primary", TIERS.tier_kingdom, null, {
    title_law_flags: ["appointment_type_succession"]
  });
  const root = character("regional-governor", { top_liege: emperor, primary_title: primaryKingdom,
    highest_held_title_tier: TIERS.tier_kingdom, government_flags: ["government_use_bureaucracy"] });
  primaryKingdom.holder = root;

  const regionalKingdom = title("k_remote", TIERS.tier_kingdom, null, {
    title_law_flags: ["appointment_type_succession"]
  });
  const regionalKing = character("remote-dejure-liege", { top_liege: emperor, primary_title: regionalKingdom,
    highest_held_title_tier: TIERS.tier_kingdom, government_flags: ["government_use_bureaucracy"] });
  regionalKingdom.holder = regionalKing;

  const foreignDuchy = title("d_remote", TIERS.tier_duchy, null, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: [regionalKingdom.id], de_jure_liege: regionalKingdom
  });
  const foreignGovernor = character("foreign-admin-vassal", { top_liege: emperor, primary_title: foreignDuchy,
    highest_held_title_tier: TIERS.tier_duchy, government_flags: ["government_use_bureaucracy"], liege: root });
  foreignDuchy.holder = foreignGovernor;
  regionalKingdom.de_jure_liege = null;
  foreignDuchy.de_jure_liege.holder = regionalKing;

  const otherRootDuchy = title("d_other_held_king", TIERS.tier_duchy, null, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: ["k_secondary"], de_jure_liege: null
  });
  const rootSecondaryKingdom = title("k_secondary", TIERS.tier_kingdom, root, {
    title_law_flags: ["appointment_type_succession"]
  });
  otherRootDuchy.de_jure_liege = rootSecondaryKingdom;
  const sameRootVassal = character("other-region-direct-vassal", { top_liege: emperor, primary_title: otherRootDuchy,
    highest_held_title_tier: TIERS.tier_duchy, government_flags: ["government_use_bureaucracy"], liege: root });
  otherRootDuchy.holder = sameRootVassal;
  rootSecondaryKingdom.holder = root;
  otherRootDuchy.de_jure_liege.holder = root;

  const localCounty = title("c_local", TIERS.tier_county, null, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: [primaryKingdom.id]
  });
  const localVassal = character("local-admin-vassal", { top_liege: emperor, primary_title: localCounty,
    highest_held_title_tier: TIERS.tier_county, liege: root });
  localCounty.holder = localVassal;
  const hereditaryTitle = title("d_inherited", TIERS.tier_duchy, null, { title_laws: ["partition_succession_law"] });
  const hereditaryVassal = character("hereditary-vassal", { top_liege: emperor, primary_title: hereditaryTitle,
    highest_held_title_tier: TIERS.tier_duchy, liege: root });
  hereditaryTitle.holder = hereditaryVassal;
  const zongfanTitle = title("d_zongfan", TIERS.tier_duchy, null, {
    title_law_flags: ["appointment_type_succession"], title_laws: ["SanGong_zongfan_succession_law"]
  });
  const zongfanVassal = character("zongfan-vassal", { top_liege: emperor, primary_title: zongfanTitle,
    highest_held_title_tier: TIERS.tier_duchy, liege: root });
  zongfanTitle.holder = zongfanVassal;
  const aristocratTitle = title("d_aristocrat_vassal", TIERS.tier_duchy, null, {
    title_law_flags: ["appointment_type_succession"], variables: ["oe_aristocrat_title"],
    de_jure_ancestors: ["k_remote"]
  });
  const aristocratVassal = character("aristocrat-direct-vassal", { top_liege: emperor, primary_title: aristocratTitle,
    highest_held_title_tier: TIERS.tier_duchy, government_flags: ["government_use_bureaucracy"], liege: root });
  aristocratTitle.holder = aristocratVassal;
  root.vassals = [foreignGovernor, sameRootVassal, localVassal, hereditaryVassal, zongfanVassal, aristocratVassal];
  root.held_titles = [primaryKingdom, rootSecondaryKingdom];

  const rootContext = envFor(root, root, { votc_celestial_cleanup_root: root, votc_celestial_cleanup_emperor: emperor });
  for (const candidate of root.vassals) {
    const candidateContext = envFor(root, candidate, { votc_celestial_cleanup_root: root });
    const shouldBeForeign = [foreignGovernor].includes(candidate);
    assertTrigger("votc_celestial_foreign_admin_vassal_trigger", candidateContext, shouldBeForeign,
      `${candidate.id} must match only when outside every qualifying higher held-title region`);
  }

  executeEffect("votc_celestial_repair_foreign_admin_vassals_effect", rootContext);
  const repaired = rootContext.changes.filter(change => change.type === "change_liege");
  assert.deepStrictEqual(repaired.map(change => [change.subject.id, change.target?.id]), [
    [foreignGovernor.id, regionalKing.id]
  ], "legacy repair must use a higher same-empire de-jure liege and leave the qualified secondary region alone");
  assert(!repaired.some(change => change.subject === root || change.target === change.subject),
    "legacy repair must not create self-liege or root-as-vassal edges");
  assert.equal(hereditaryVassal.liege, root, "hereditary vassals must remain untouched");
  assert.equal(zongfanVassal.liege, root, "SanGong zongfan vassals must remain untouched");
  assert.equal(localVassal.liege, root, "same-primary-region administrative vassals must remain untouched");
  assert.equal(sameRootVassal.liege, root, "an appointment county under a held secondary kingdom is not foreign");
  assert.equal(aristocratVassal.liege, root,
    "a direct vassal title marked oe_aristocrat_title remains protected even though native noble-family predicate is false");

  const independent = character("independent-admin", { independent: true, top_liege: null,
    primary_title: foreignDuchy, highest_held_title_tier: TIERS.tier_duchy,
    government_flags: ["government_use_bureaucracy"] });
  assertTrigger("votc_celestial_foreign_admin_vassal_trigger", envFor(root, independent, {
    votc_celestial_cleanup_root: root, votc_celestial_cleanup_emperor: emperor
  }), false, "independent rulers cannot pass the full Chinese Celestial cleanup boundary");
  assert(all(named(effectFile, "votc_celestial_repair_foreign_admin_vassals_effect"), "every_vassal_or_below").length === 0,
    "legacy repair must scan direct vassals only, never inherited descendant trees");
}

function testLegacySelfHeldForeignOfficeRepairUsesRulerScope() {
  const emperorTitle = title("h_china", TIERS.tier_empire, null);
  const emperor = character("emperor", { independent: true, primary_title: emperorTitle,
    highest_held_title_tier: TIERS.tier_empire, government_flags: ["government_is_celestial"] });
  emperorTitle.holder = emperor;

  const primary = title("k_primary", TIERS.tier_kingdom, null, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: []
  });
  const governor = character("legacy-governor", { top_liege: emperor, primary_title: primary,
    highest_held_title_tier: TIERS.tier_kingdom, government_flags: ["government_use_bureaucracy"],
    flags: ["votc_celestial_office_legacy_state_checked"] });
  primary.holder = governor;

  const duchyHeir = character("legacy-duchy-heir", { top_liege: emperor, highest_held_title_tier: TIERS.tier_county });
  duchyHeir.primary_title = title("c_duchy_heir", TIERS.tier_county, duchyHeir, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: ["d_foreign_office"]
  });
  const foreignDuchy = title("d_foreign_office", TIERS.tier_duchy, governor, {
    title_law_flags: ["appointment_type_succession"], current_heir: duchyHeir,
    de_jure_ancestors: ["k_foreign"]
  });

  const countyHeir = character("legacy-county-heir", { top_liege: emperor, highest_held_title_tier: TIERS.tier_barony });
  countyHeir.primary_title = title("b_county_heir", TIERS.tier_barony, countyHeir, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: ["c_foreign_office"]
  });
  const foreignCounty = title("c_foreign_office", TIERS.tier_county, governor, {
    title_law_flags: ["appointment_type_succession"], current_heir: countyHeir,
    de_jure_ancestors: ["k_foreign"]
  });
  const foreignBarony = title("b_foreign_office", TIERS.tier_barony, governor, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: [foreignCounty.id, "k_foreign"]
  });

  const localCounty = title("c_local_office", TIERS.tier_county, governor, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: [primary.id]
  });
  governor.held_titles = [primary, foreignDuchy, foreignCounty, foreignBarony, localCounty];

  const migration = named(actionFile, "votc_celestial_office_legacy_vassal_cleanup");
  const migrationBody = child(migration, "effect");
  assert.equal(countDescendants(migrationBody, "votc_celestial_repair_legacy_foreign_state_effect"), 1,
    "the startup migration must call the combined per-ruler repair, including self-held foreign office titles");
  assert.equal(countDescendants(migrationBody, "votc_celestial_repair_foreign_admin_vassals_effect"), 0,
    "the startup migration must not bypass the helper that releases legacy self-held foreign offices");

  const run = envFor(emperor, emperor);
  run.worldRulers = [emperor, governor];
  executeEntries(migrationBody, run);
  const transfers = run.changes.filter(change => change.type === "change_title_holder");
  assert.deepStrictEqual(transfers.map(change => change.subject.id), [foreignDuchy.id, foreignCounty.id],
    "startup repair releases foreign old duchy/county offices but keeps the legal same-primary-region county");
  assert.deepStrictEqual(transfers.map(change => change.take_baronies), ["no", "yes"],
    "legacy foreign county carries its baronies, while the duchy does not recursively consume titles");
  assert.deepStrictEqual(transfers.map(change => change.target?.id), [duchyHeir.id, countyHeir.id],
    "the legacy release uses each old office title's own current heir");
  assert(governor.flags.has("votc_celestial_office_legacy_state_checked"),
    "the selected administrative ruler is marked after the one-time migration");
  assert(governor.flags.has("votc_celestial_office_v104_state_checked"),
    "the new v1.0.4 marker upgrades a character that already carries the older migration flag");
  assert(!emperor.flags.has("votc_celestial_office_legacy_state_checked"),
    "the independent event root is not mistaken for the administrative ruler being iterated");
  assert(!emperor.flags.has("votc_celestial_office_v104_state_checked"),
    "the independent Emperor does not receive the administrative migration marker");
  const changesAfterUpgrade = run.changes.length;
  executeEntries(migrationBody, run);
  assert.equal(run.changes.length, changesAfterUpgrade,
    "a second startup pass skips the character already carrying the v1.0.4 migration marker");
}

function transactionRepairFixture() {
  const empireTitle = title("h_china", TIERS.tier_empire, null);
  const emperor = character("transaction-emperor", { independent: true, primary_title: empireTitle,
    highest_held_title_tier: TIERS.tier_empire, government_flags: ["government_is_celestial"] });
  empireTitle.holder = emperor;

  const remoteKingdom = title("k_hebei", TIERS.tier_kingdom, null);
  const remoteKing = character("transaction-hebei-king", { top_liege: emperor, primary_title: remoteKingdom,
    highest_held_title_tier: TIERS.tier_kingdom, government_flags: ["government_use_bureaucracy"] });
  remoteKingdom.holder = remoteKing;

  const primary = title("k_guangdong", TIERS.tier_kingdom, null, {
    title_law_flags: ["appointment_type_succession"]
  });
  const owner = character("transaction-guangdong-governor", { top_liege: emperor, primary_title: primary,
    highest_held_title_tier: TIERS.tier_kingdom, government_flags: ["government_use_bureaucracy"] });
  primary.holder = owner;

  const originalCounty = title("c_old_hebei_county", TIERS.tier_county, null, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: ["d_old_hebei_office", remoteKingdom.id]
  });
  const heir = character("original-hebei-countyholder", { top_liege: emperor, primary_title: originalCounty,
    highest_held_title_tier: TIERS.tier_county, government_flags: ["government_use_bureaucracy"], liege: remoteKing });
  originalCounty.holder = heir;
  remoteKing.vassals.push(heir);

  const oldOffice = title("d_old_hebei_office", TIERS.tier_duchy, owner, {
    title_law_flags: ["appointment_type_succession"], current_heir: heir,
    de_jure_ancestors: [remoteKingdom.id], de_jure_liege: remoteKingdom
  });
  const localHereditary = title("c_local_hereditary", TIERS.tier_county, owner, {
    title_laws: ["partition_succession_law"], de_jure_ancestors: [primary.id]
  });
  const localCounty = title("c_local_vassal", TIERS.tier_county, null, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: [primary.id]
  });
  const localVassal = character("local-direct-vassal", { top_liege: emperor, primary_title: localCounty,
    highest_held_title_tier: TIERS.tier_county, government_flags: ["government_use_bureaucracy"], liege: owner });
  localCounty.holder = localVassal;
  owner.vassals = [localVassal];
  owner.held_titles = [primary, oldOffice, localHereditary];

  return { emperor, remoteKing, remoteKingdom, owner, primary, oldOffice, originalCounty, heir,
    localHereditary, localVassal, injected: false };
}

function injectConservativePostTransferVassalFixture(fixture) {
  return (transaction, env) => {
    if (transaction?.id !== "votc_celestial_release_change" || fixture.injected) return;
    assert.equal(env.current, fixture.oldOffice,
      "synthetic consequence is injected only after the old office title transfer resolves");
    fixture.injected = true;
    // Test-only conservative side effect: suppose transferring the title makes its
    // former non-root countyholder a new direct ruler under the cleanup root.
    // This does not claim that CK3's native title transaction always does this.
    fixture.oldOffice.holder = fixture.heir;
    fixture.owner.held_titles = fixture.owner.held_titles.filter(heldTitle => heldTitle !== fixture.oldOffice);
    fixture.heir.primary_title = fixture.oldOffice;
    fixture.heir.highest_held_title_tier = TIERS.tier_duchy;
    fixture.heir.held_titles = [fixture.oldOffice, fixture.originalCounty];
    fixture.heir.liege = fixture.owner;
    fixture.owner.vassals.push(fixture.heir);
    fixture.remoteKing.vassals = fixture.remoteKing.vassals.filter(vassal => !sameEntity(vassal, fixture.heir));
  };
}

function assertPostTransferRepairResult(fixture, run, sourceLabel) {
  assert(fixture.injected, `${sourceLabel} fixture injected the conservative new-vassal side effect`);
  const transfers = run.changes.filter(change => change.type === "change_title_holder");
  assert.deepStrictEqual(transfers.map(change => change.subject.id), [fixture.oldOffice.id],
    `${sourceLabel} transfers only the selected old office title`);
  const repairs = run.changes.filter(change => change.type === "change_liege");
  assert.deepStrictEqual(repairs.map(change => [change.subject.id, change.target?.id]), [
    [fixture.heir.id, fixture.remoteKing.id]
  ], `${sourceLabel} final repair reparents the injected foreign direct duke to its same-empire de-jure liege`);
  assert.equal(fixture.heir.liege, fixture.remoteKing,
    `${sourceLabel} leaves no injected foreign administrative duke directly under the original root`);
  assert(!fixture.owner.vassals.some(vassal => sameEntity(vassal, fixture.heir)),
    `${sourceLabel} removes the repaired duke from the old root's direct-vassal list`);
  assert(fixture.remoteKing.vassals.some(vassal => sameEntity(vassal, fixture.heir)),
    `${sourceLabel} keeps direct-vassal traversal consistent after reparenting`);
  assert.equal(fixture.localVassal.liege, fixture.owner,
    `${sourceLabel} leaves a local-region direct administrative vassal untouched`);
  assert(fixture.owner.vassals.some(vassal => sameEntity(vassal, fixture.localVassal)),
    `${sourceLabel} retains the local vassal in the original root's direct-vassal list`);
  assert.equal(fixture.localHereditary.holder, fixture.owner,
    `${sourceLabel} preserves the locally held hereditary county`);
  assert(fixture.owner.held_titles.includes(fixture.localHereditary),
    `${sourceLabel} keeps the hereditary county among the root's held titles`);
}

function testFinalRepairAfterSyntheticTitleTransactionSideEffect() {
  const promotionFixture = transactionRepairFixture();
  const promotion = envFor(promotionFixture.owner, promotionFixture.owner);
  promotion.afterResolve = injectConservativePostTransferVassalFixture(promotionFixture);
  executeEffect("votc_celestial_office_promotion_cleanup_effect", promotion);
  assertPostTransferRepairResult(promotionFixture, promotion, "promotion");

  const legacyFixture = transactionRepairFixture();
  const migration = named(actionFile, "votc_celestial_office_legacy_vassal_cleanup");
  const legacy = envFor(legacyFixture.emperor, legacyFixture.emperor);
  legacy.worldRulers = [legacyFixture.emperor, legacyFixture.owner];
  legacy.afterResolve = injectConservativePostTransferVassalFixture(legacyFixture);
  executeEntries(child(migration, "effect"), legacy);
  assertPostTransferRepairResult(legacyFixture, legacy, "legacy migration");
}

function makeRegionFixture(prefix, options = {}) {
  const empireTitle = title("h_china", TIERS.tier_empire, null);
  const emperor = character(`${prefix}_emperor`, { independent: true, primary_title: empireTitle,
    highest_held_title_tier: TIERS.tier_empire, government_flags: ["government_is_celestial"] });
  empireTitle.holder = emperor;
  const primary = title(`${prefix}_k_guangdong`, TIERS.tier_kingdom, null, {
    title_law_flags: ["appointment_type_succession"]
  });
  const root = character(`${prefix}_guangdong-governor`, { top_liege: emperor, primary_title: primary,
    highest_held_title_tier: TIERS.tier_kingdom,
    government_flags: options.rootGovernment === false ? [] : ["government_use_bureaucracy"],
    liege: emperor });
  empireTitle.holder = emperor;
  primary.holder = root;
  emperor.vassals.push(root);
  root.held_titles = [primary];
  return { emperor, empireTitle, root, primary };
}

function makeTierLateralFixture(prefix, tier, oldOfficeCount, options = {}) {
  const fixture = makeRegionFixture(prefix);
  fixture.root.government_flags.add("government_is_celestial");
  if (tier === TIERS.tier_empire) {
    fixture.empireTitle.tier = TIERS.tier_empire + 1;
    fixture.emperor.highest_held_title_tier = TIERS.tier_empire + 1;
  }
  const target = title(`${prefix}_incoming_${tier}`, tier, fixture.root, {
    title_law_flags: ["appointment_type_succession"]
  });
  const oldOffices = [];
  const heirs = [];
  const baronies = [];
  for (let index = 0; index < oldOfficeCount; index += 1) {
    const heir = character(`${prefix}_heir_${index}`, { top_liege: fixture.emperor,
      highest_held_title_tier: tier, government_flags: ["government_is_celestial"] });
    const hereditaryTitle = title(`${prefix}_heir_${index}_hereditary_${tier}`, tier, heir, {
      title_laws: ["partition_succession_law"]
    });
    heir.primary_title = hereditaryTitle;
    heir.held_titles = [hereditaryTitle];
    const office = title(`${prefix}_old_${tier}_${index}`, tier, fixture.root, {
      title_law_flags: ["appointment_type_succession"], current_heir: heir
    });
    oldOffices.push(office);
    heirs.push(heir);
    if (tier === TIERS.tier_county) {
      const barony = title(`${prefix}_old_${tier}_${index}_barony`, TIERS.tier_barony, fixture.root, {
        de_jure_liege: office
      });
      office.baronies.push(barony);
      baronies.push(barony);
    }
  }
  fixture.root.held_titles.push(target, ...oldOffices, ...baronies);
  if (tier === TIERS.tier_kingdom) {
    fixture.root.held_titles = fixture.root.held_titles.filter(held => held !== fixture.primary);
    fixture.primary.holder = null;
    fixture.root.primary_title = options.primaryMode === "target" ? target : oldOffices[0] || target;
  } else if (options.primaryMode === "target") {
    fixture.root.primary_title = target;
  } else if (options.primaryMode === "old") {
    fixture.root.primary_title = oldOffices[0] || fixture.primary;
  }
  fixture.root.highest_held_title_tier = Math.max(fixture.root.highest_held_title_tier,
    ...fixture.root.held_titles.map(held => held.tier));
  return { ...fixture, target, oldOffices, heirs, baronies };
}

function captureIncomingTitle(env, incoming, previousHolder, transferType = "inheritance") {
  env.scopes.title = incoming;
  env.scopes.transfer_type = transferType;
  env.scopes.previous_holder = previousHolder;
  invokeHook("on_title_gain", env);
  return env;
}

function testSecondaryHeldRegionAndExclusions() {
  for (const [suffix, titleLaws] of [
    ["hereditary", ["partition_succession_law"]],
    ["zongfan", ["SanGong_zongfan_succession_law"]]
  ]) {
    const fixture = makeRegionFixture(`secondary_${suffix}`);
    const secondary = title(`k_hebei_${suffix}`, TIERS.tier_kingdom, fixture.root, { title_laws: titleLaws });
    const office = title(`d_hebei_office_${suffix}`, TIERS.tier_duchy, fixture.root, {
      title_law_flags: ["appointment_type_succession"], de_jure_ancestors: [secondary.id]
    });
    fixture.root.held_titles = [fixture.primary, secondary, office];
    const scope = { votc_celestial_region_holder: fixture.root,
      votc_celestial_cleanup_root: fixture.root, votc_celestial_cleanup_emperor: fixture.emperor,
      votc_celestial_release_title: office };
    const region = envFor(fixture.root, office, scope);
    assertTrigger("votc_celestial_title_in_holder_region_trigger", region, true,
      `${suffix} higher held kingdom is a valid secondary de-jure region despite not being an appointed office`);
    assert.equal(region.scopes.votc_celestial_region_checked_title, office,
      "the shared region helper must retain the exact checked title scope");
    assertTrigger("votc_celestial_legacy_foreign_office_title_trigger", region, false,
      `${suffix} secondary-region county must not be treated as a foreign old office`);
    const run = envFor(fixture.root, fixture.root);
    executeEffect("votc_celestial_repair_legacy_foreign_state_effect", run);
    assert.equal(run.changes.filter(change => change.type === "change_title_holder").length, 0,
      `${suffix} secondary-region office must survive legacy cleanup`);
  }

  const invalidHigherTitles = [
    ["native-noble", { noble_family: true }],
    ["oe-aristocrat", { variables: ["oe_aristocrat_title"] }],
    ["leased", { leased_out: true }],
    ["landless", { landless: true }]
  ];
  for (const [suffix, exclusions] of invalidHigherTitles) {
    const fixture = makeRegionFixture(`excluded_${suffix}`);
    const secondary = title(`k_secondary_${suffix}`, TIERS.tier_kingdom, fixture.root, exclusions);
    const office = title(`d_foreign_office_${suffix}`, TIERS.tier_duchy, fixture.root, {
      title_law_flags: ["appointment_type_succession"], de_jure_ancestors: [secondary.id]
    });
    fixture.root.held_titles = [fixture.primary, secondary, office];
    const scope = { votc_celestial_region_holder: fixture.root,
      votc_celestial_cleanup_root: fixture.root, votc_celestial_cleanup_emperor: fixture.emperor,
      votc_celestial_release_title: office };
    assertTrigger("votc_celestial_title_in_holder_region_trigger", envFor(fixture.root, office, scope), false,
      `${suffix} higher title must not create a qualifying region anchor`);
    const run = envFor(fixture.root, fixture.root);
    executeEffect("votc_celestial_repair_legacy_foreign_state_effect", run);
    assert.deepStrictEqual(run.changes.filter(change => change.type === "change_title_holder")
      .map(change => change.subject.id), [office.id],
    `${suffix} higher title cannot protect an unrelated-region appointed office`);
  }
}

function addForeignVassal(fixture, suffix, governmentFlags = ["government_use_bureaucracy"], options = {}) {
  const primary = title(`${suffix}_k_foreign`, TIERS.tier_kingdom, null, {
    title_law_flags: ["appointment_type_succession"], de_jure_liege: options.deJureLiege || null
  });
  const vassal = character(`${suffix}_foreign-governor`, { top_liege: fixture.emperor, primary_title: primary,
    highest_held_title_tier: TIERS.tier_kingdom, government_flags: governmentFlags, liege: fixture.root });
  primary.holder = vassal;
  vassal.held_titles = [primary];
  fixture.root.vassals.push(vassal);
  return vassal;
}

function testForeignVassalGateAndNextDayGovernmentChange() {
  const staysFeudal = makeRegionFixture("feudal_vassal");
  const feudal = addForeignVassal(staysFeudal, "stays_feudal", []);
  assertTrigger("votc_celestial_foreign_admin_vassal_trigger", envFor(staysFeudal.root, feudal, {
    votc_celestial_cleanup_root: staysFeudal.root, votc_celestial_cleanup_emperor: staysFeudal.emperor
  }), false, "an appointed foreign direct vassal with feudal government must fail its own full cleanup gate");
  const feudalRepair = envFor(staysFeudal.root, staysFeudal.root, {
    votc_celestial_cleanup_root: staysFeudal.root, votc_celestial_cleanup_emperor: staysFeudal.emperor
  });
  executeEffect("votc_celestial_repair_foreign_admin_vassals_effect", feudalRepair);
  assert.equal(feudalRepair.changes.filter(change => change.type === "change_liege").length, 0,
    "the direct-vassal repair must leave an appointed but feudal target untouched");
  assert.equal(feudal.liege, staysFeudal.root);

  const promotedByNextDay = makeRegionFixture("next_day_admin");
  const pending = addForeignVassal(promotedByNextDay, "pre_admin", []);
  const scheduled = envFor(promotedByNextDay.root, promotedByNextDay.root, { vassal: pending });
  assertTrigger("votc_celestial_office_region_candidate_trigger", scheduled, true,
    "the scheduler's Chinese appointment liege is a region-recheck candidate");
  assertTrigger("votc_celestial_office_region_title_trigger", withCurrent(scheduled, pending.primary_title), true,
    "the incoming vassal has an appointed primary title eligible for region revalidation");
  assertTrigger("votc_celestial_title_in_holder_region_trigger", withCurrent(scheduled, pending.primary_title), false,
    "the incoming title is outside the liege's primary and held-secondary regions");
  assert(evalTrigger(child(named(actionFile, "votc_celestial_office_region_vassal_gain"), "trigger"), scheduled),
    "a Chinese administrative liege can schedule a foreign appointed vassal before it changes government");
  invokeHook("on_vassal_gained", scheduled);
  assert.deepStrictEqual(scheduled.scheduledEvents.map(event => [event.id, event.days]), [
    ["votc_celestial_office_release.0002", "1"]
  ], "on_vassal_gained may queue a pre-government candidate for next-day revalidation");
  assert(promotedByNextDay.root.variables.has("votc_celestial_office_region_pending"));
  pending.government_flags.add("government_use_bureaucracy");
  runRegionRecheckEvent(scheduled);
  const moved = scheduled.changes.filter(change => change.type === "change_liege");
  assert.deepStrictEqual(moved.map(change => [change.subject.id, change.target?.id]), [
    [pending.id, promotedByNextDay.emperor.id]
  ], "the next-day event revalidates and repairs a foreign vassal that became administrative after scheduling");
  assert.equal(pending.liege, promotedByNextDay.emperor);
  assert(!promotedByNextDay.root.variables.has("votc_celestial_office_region_pending"),
    "the deferred marker clears after the successful repair");
}

function testFeudalPromotionFailsClosedUntilGovernmentIsEligible() {
  const fixture = makeRegionFixture("feudal_promotion", { rootGovernment: false });
  const oldOffice = title("feudal_promotion_d_old", TIERS.tier_duchy, fixture.root, {
    title_law_flags: ["appointment_type_succession"]
  });
  fixture.root.held_titles.push(oldOffice);
  const env = envFor(fixture.root, fixture.root, {
    previous_title: oldOffice, transfer_type: "granted"
  });
  invokeHook("on_primary_title_change", env);
  assert.deepStrictEqual(env.scheduledEvents.map(event => event.id), [
    "votc_celestial_office_release.0001", "votc_celestial_office_release.0002"
  ], "a still-feudal appointment candidate can queue bounded promotion and region rechecks");
  const before = env.changes.length;
  const promotionEvent = named(eventFile, "votc_celestial_office_release.0001");
  assert(evalTrigger(child(promotionEvent, "trigger"), env));
  executeEntries(child(promotionEvent, "immediate"), env);
  assert.equal(env.changes.length, before,
    "the .0001 full cleanup root gate must fail closed for a feudal candidate without releasing titles or changing lieges");
  assert(fixture.root.variables.has("votc_celestial_office_release_pending"),
    "the feudal promotion marker remains bounded by its configured two-day expiry when .0001 does no cleanup");

  runRegionRecheckEvent(env);
  assert.equal(env.changes.length, before,
    "the .0002 full cleanup gate must also make no mutations while the ruler remains feudal");
  assert(!fixture.root.variables.has("votc_celestial_office_region_pending"),
    "a failed next-day region recheck still clears its pending marker");
}

function testRegionLifecycleHooksAndReentrantCleanup() {
  const sameRank = makeRegionFixture("same_rank_hook");
  const sameRankPrevious = title("same_rank_previous_k", TIERS.tier_kingdom, null, {
    title_law_flags: ["appointment_type_succession"]
  });
  const sameRankEnv = envFor(sameRank.root, sameRank.root, {
    previous_title: sameRankPrevious, transfer_type: "granted"
  });
  assertTrigger("votc_celestial_office_promotion_trigger", sameRankEnv, false,
    "a same-rank appointment remains outside the rank-up-specific cleanup");

  const cases = [
    ["on_primary_title_change", sameRankEnv],
    ["on_title_gain", (() => {
      const fixture = makeRegionFixture("title_gain_hook");
      const incoming = title("title_gain_hook_d_incoming", TIERS.tier_duchy, fixture.root, {
        title_law_flags: ["appointment_type_succession"]
      });
      return envFor(fixture.root, fixture.root, { title: incoming });
    })()],
    ["on_title_lost", (() => {
      const fixture = makeRegionFixture("title_lost_hook");
      return envFor(fixture.root, fixture.root);
    })()],
    ["on_vassal_change", (() => {
      const fixture = makeRegionFixture("vassal_change_hook");
      return envFor(fixture.root, fixture.root);
    })()],
    ["on_vassal_gained", (() => {
      const fixture = makeRegionFixture("vassal_gained_hook");
      const target = addForeignVassal(fixture, "gained_hook_target");
      return envFor(fixture.root, fixture.root, { vassal: target });
    })()]
  ];
  for (const [hook, env] of cases) {
    invokeHook(hook, env);
    assert.deepStrictEqual(env.scheduledEvents.map(event => [event.id, event.days]), [
      ["votc_celestial_office_release.0002", "1"]
    ], `${hook} schedules one shared next-day region recheck`);
    assert(env.current.variables.has("votc_celestial_office_region_pending"),
      `${hook} sets the per-character pending guard`);
    invokeHook(hook, env);
    assert.equal(env.scheduledEvents.length, 1,
      `${hook} repeated while pending does not enqueue a duplicate event`);
  }

  const reentry = makeRegionFixture("region_reentry");
  const target = addForeignVassal(reentry, "region_reentry_vassal");
  const env = envFor(reentry.root, reentry.root, { vassal: target });
  invokeHook("on_vassal_gained", env);
  env.afterResolve = () => {
    assert(reentry.root.variables.has("votc_celestial_office_region_pending"),
      "the pending marker remains set while the synthetic cleanup transaction resolves");
    invokeHook("on_vassal_change", env);
  };
  runRegionRecheckEvent(env);
  assert.deepStrictEqual(env.changes.filter(change => change.type === "change_liege")
    .map(change => [change.subject.id, change.target?.id]), [
      [target.id, reentry.emperor.id]
    ], "the deferred event performs one direct-vassal repair");
  assert.equal(env.scheduledEvents.length, 1,
    "a synthetic on_vassal_change callback during cleanup cannot recursively schedule another region event");
  assert(!reentry.root.variables.has("votc_celestial_office_region_pending"),
    "the region pending guard clears only after cleanup resolves");
  assert.equal(evalTrigger(child(named(eventFile, "votc_celestial_office_release.0002"), "trigger"), env), false,
    "a repeated .0002 delivery after completion fails closed without a pending marker");
}

function makeCrossRegionHeirFixture(prefix, options = {}) {
  const fixture = makeRegionFixture(prefix);
  const remoteKingdom = title(`${prefix}_k_sichuan`, TIERS.tier_kingdom, null, {
    title_law_flags: ["appointment_type_succession"]
  });
  const wrongKing = character(`${prefix}_wrong-region-king`, { top_liege: fixture.emperor,
    primary_title: remoteKingdom, highest_held_title_tier: TIERS.tier_kingdom,
    government_flags: ["government_use_bureaucracy"], liege: fixture.emperor });
  remoteKingdom.holder = wrongKing;
  wrongKing.held_titles = [remoteKingdom];
  fixture.emperor.vassals.push(wrongKing);

  let regionalKing = null;
  let hebei = null;
  if (options.hasRegionalKing) {
    hebei = title(`${prefix}_k_hebei`, TIERS.tier_kingdom, null, {
      title_law_flags: ["appointment_type_succession"]
    });
    regionalKing = character(`${prefix}_hebei-king`, { top_liege: fixture.emperor,
      primary_title: hebei, highest_held_title_tier: TIERS.tier_kingdom,
      government_flags: ["government_use_bureaucracy"], liege: fixture.emperor });
    hebei.holder = regionalKing;
    regionalKing.held_titles = [hebei];
    fixture.emperor.vassals.push(regionalKing);
  }

  const heirCounty = title(`${prefix}_c_hebei-heir`, TIERS.tier_county, null, {
    title_law_flags: ["appointment_type_succession"],
    de_jure_ancestors: options.hasRegionalKing ? ["PLACEHOLDER", hebei.id] : []
  });
  const heir = character(`${prefix}_old-office-heir`, { top_liege: fixture.emperor,
    primary_title: heirCounty, highest_held_title_tier: TIERS.tier_county,
    government_flags: ["government_use_bureaucracy"], liege: wrongKing });
  heirCounty.holder = heir;
  wrongKing.vassals.push(heir);
  heir.held_titles = [heirCounty];

  const office = title(`${prefix}_d_hebei-office`, TIERS.tier_duchy, fixture.root, {
    title_law_flags: ["appointment_type_succession"], current_heir: heir,
    de_jure_ancestors: options.hasRegionalKing ? [hebei.id] : [],
    de_jure_liege: options.hasRegionalKing ? hebei : null
  });
  if (options.hasRegionalKing) {
    heirCounty.de_jure_ancestors = new Set([office.id, hebei.id]);
  }
  fixture.root.held_titles.push(office);
  return { ...fixture, wrongKing, regionalKing, heirCounty, heir, office,
    regionalKingdom: hebei };
}

function testReleasedTitleHeirGetsNextDayLiegeRepair() {
  for (const hasRegionalKing of [true, false]) {
    const fixture = makeCrossRegionHeirFixture(`successor_${hasRegionalKing ? "de_jure" : "fallback"}`, {
      hasRegionalKing
    });
    const ownerCleanup = envFor(fixture.root, fixture.root);
    ownerCleanup.afterResolve = (transaction, env) => {
      if (transaction?.id !== "votc_celestial_release_change") return;
      assert.equal(env.current, fixture.office,
        "the synthetic title transfer consequence runs only in the old office scope");
      fixture.office.holder = fixture.heir;
      fixture.root.held_titles = fixture.root.held_titles.filter(held => held !== fixture.office);
      fixture.heir.primary_title = fixture.office;
      fixture.heir.highest_held_title_tier = TIERS.tier_duchy;
      fixture.heir.held_titles.push(fixture.office);
      // Deliberate synthetic side effect: title transfer grants the old office,
      // while its new holder remains attached to a different same-empire king.
      // This tests our repair path and does not assert native CK3 transaction behavior.
    };
    executeEffect("votc_celestial_repair_legacy_foreign_state_effect", ownerCleanup);
    assert(ownerCleanup.changes.some(change => change.type === "change_title_holder" && change.subject === fixture.office),
      "the old office's own safe cross-region current_heir receives the title");
    assert.equal(fixture.heir.liege, fixture.wrongKing,
      "the synthetic title transaction leaves the heir under the prior foreign-region king until deferred recheck");
    assert(!ownerCleanup.changes.some(change => change.type === "change_liege" && change.subject === fixture.heir),
      "the immediate owner cleanup cannot claim to repair a heir who was not its direct vassal");

    const titleGain = envFor(fixture.heir, fixture.heir, { title: fixture.office });
    invokeHook("on_title_gain", titleGain);
    assert.deepStrictEqual(titleGain.scheduledEvents.map(event => [event.id, event.days]), [
      ["votc_celestial_office_release.0002", "1"]
    ], "the new holder's title-gain callback schedules a next-day liege recheck");
    runRegionRecheckEvent(titleGain);
    const expectedLiege = hasRegionalKing ? fixture.regionalKing : fixture.emperor;
    assert.deepStrictEqual(titleGain.changes.filter(change => change.type === "change_liege")
      .map(change => [change.subject.id, change.target?.id]), [
        [fixture.heir.id, expectedLiege.id]
      ], hasRegionalKing
      ? "the heir returns to the valid same-empire de-jure kingdom holder"
      : "the heir falls back to the same-empire emperor when no valid de-jure holder exists");
    assert.equal(fixture.heir.liege, expectedLiege);
    assert(!fixture.wrongKing.vassals.some(vassal => sameEntity(vassal, fixture.heir)),
      "reparenting removes the heir from the previous king's direct-vassal collection");
    assert(expectedLiege.vassals.some(vassal => sameEntity(vassal, fixture.heir)),
      "reparenting adds the heir exactly to the selected new liege's direct-vassal collection");
    assert(fixture.heir.held_titles.includes(fixture.office),
      "liege repair does not undo the old title succession");
  }
}

function testSameRankCandidateRemainsEligible() {
  for (const name of ["celestial_civic_governor", "celestial_military_governor"]) {
    const appointment = named(successionFile, name);
    assert.equal(scalar(appointment, "allowed_candidate_tier"), "lower_or_equal",
      name + " must continue accepting equal-tier candidates");
    const scoreValue = child(child(appointment, "candidate_score"), "value");
    assert(all(scoreValue, "add").some(entry => entry.value === "votc_celestial_lower_title_penalty"),
      name + " retains the existing rank penalty without turning it into an eligibility ban");
  }
  const penalty = named(successionValueFile, "votc_celestial_lower_title_penalty");
  const penaltyLimit = child(first(penalty, "if").value, "limit");
  const ranking = makeRegionFixture("equal_rank_candidate");
  const equalCandidate = envFor(ranking.root, ranking.root, { title: ranking.primary });
  assert.equal(evalTrigger(penaltyLimit, equalCandidate), false,
    "a King candidate receives no higher-rank penalty for another Kingdom title");
  const lowerTitle = title("equal_rank_candidate_d_open", TIERS.tier_duchy, null);
  assert.equal(evalTrigger(penaltyLimit, envFor(ranking.root, ranking.root, { title: lowerTitle })), true,
    "the same King remains penalized for a lower Duchy appointment");
}

function testAllTierLateralHandoffs() {
  const cases = [
    [TIERS.tier_county, 2, "county"],
    [TIERS.tier_duchy, 3, "duchy"],
    [TIERS.tier_kingdom, 2, "kingdom"],
    [TIERS.tier_empire, 3, "empire"]
  ];
  for (const [tier, oldOfficeCount, tierName] of cases) {
    const fixture = makeTierLateralFixture(`lateral_${tierName}`, tier, oldOfficeCount,
      { primaryMode: tier === TIERS.tier_kingdom ? "old" : undefined });
    if (tier === TIERS.tier_empire) {
      assert(fixture.emperor.primary_title.tier > fixture.target.tier,
        "the Chinese top liege's H title remains above an appointed Empire title in the synthetic hierarchy");
    }
    const previousPrimary = fixture.root.primary_title;
    const previousHolder = character(`lateral_${tierName}_previous_holder`, { top_liege: fixture.emperor });
    previousHolder.variables.add(LATERAL_PENDING_VARIABLE);
    fixture.root.variables.add("votc_celestial_office_lateral_ambiguous");
    const env = envFor(fixture.root, fixture.root);
    env.simulateTitleTransfers = true;
    captureIncomingTitle(env, fixture.target, previousHolder, "inheritance");
    assert.equal(env.scheduledEvents.filter(event => event.id === "votc_celestial_office_release.0003").length, 1,
      `a real incoming appointed ${tierName} schedules exactly one next-day batch`);
    assert.equal(fixture.root.variableValues.get(LATERAL_TARGET_VARIABLES[tier]), fixture.target,
      `the ${tierName} callback saves its actual incoming title scope`);
    runLateralRecheckEvent(env);

    for (let index = 0; index < fixture.oldOffices.length; index += 1) {
      const oldOffice = fixture.oldOffices[index];
      const heir = fixture.heirs[index];
      const handoff = env.changes.find(change => change.type === "change_title_holder" && change.subject === oldOffice);
      assert(handoff, `${tierName} batch transfers every other same-tier appointed office`);
      assert.equal(handoff.target, heir, `${tierName} transfer uses that old title's own safe current_heir`);
      assert.equal(handoff.take_baronies, tier === TIERS.tier_county ? "yes" : "no",
        `${tierName} transfers set barony inheritance only for county office titles`);
      assert.equal(oldOffice.holder, heir, `synthetic ${tierName} transaction removes the old office from the new appointee`);
      assert(!fixture.root.held_titles.includes(oldOffice), `the new ${tierName} office holder no longer retains the old office`);
      if (tier === TIERS.tier_county) {
        const barony = fixture.baronies[index];
        assert.equal(barony.holder, heir, "a county appointment carries its attached barony with take_baronies=yes");
        assert(heir.held_titles.includes(barony));
      }
    }

    const shouldPromotePrimary = tier >= previousPrimary.tier;
    assert.equal(fixture.root.primary_title, shouldPromotePrimary ? fixture.target : previousPrimary,
      `incoming ${tierName} must not lower a higher primary title`);
    assert.equal(env.changes.some(change => change.type === "set_primary_title_to" && change.target === fixture.target),
      shouldPromotePrimary, `only a non-lower ${tierName} title may become primary`);
    assert(!fixture.root.variables.has(LATERAL_PENDING_VARIABLE));
    assert(!fixture.root.variables.has("votc_celestial_office_lateral_ambiguous"),
      "the legacy ambiguity marker is ignored and cleared after a real target batch");
    assert(!fixture.root.variableValues.has(LATERAL_TARGET_VARIABLES[tier]));
  }
}

function makeLateralHeirCycleFixture() {
  const empireTitle = title("h_china", TIERS.tier_empire + 1, null);
  const emperor = character("lateral_cycle_emperor", { independent: true, primary_title: empireTitle,
    highest_held_title_tier: TIERS.tier_empire + 1, government_flags: ["government_is_celestial"] });
  empireTitle.holder = emperor;
  const rulers = Object.fromEntries(["A", "B", "C"].map(name => {
    const primary = title(`lateral_cycle_${name}_old_k`, TIERS.tier_kingdom, null, {
      title_law_flags: ["appointment_type_succession"]
    });
    const ruler = character(`lateral_cycle_${name}`, { top_liege: emperor, liege: emperor,
      primary_title: primary, highest_held_title_tier: TIERS.tier_kingdom,
      government_flags: ["government_use_bureaucracy", "government_is_celestial"] });
    primary.holder = ruler;
    ruler.held_titles = [primary];
    emperor.vassals.push(ruler);
    return [name, { ruler, primary }];
  }));
  const nextRuler = {
    [rulers.A.ruler.id]: rulers.B.ruler,
    [rulers.B.ruler.id]: rulers.C.ruler,
    [rulers.C.ruler.id]: rulers.A.ruler
  };
  const oldA = rulers.A.primary;
  const oldB = rulers.B.primary;
  const oldC = rulers.C.primary;
  oldA.current_heir = rulers.B.ruler;
  oldB.current_heir = rulers.C.ruler;
  oldC.current_heir = rulers.A.ruler;
  const incomingA = title("lateral_cycle_A_incoming_k", TIERS.tier_kingdom, rulers.A.ruler, {
    title_law_flags: ["appointment_type_succession"], current_heir: rulers.B.ruler
  });
  rulers.A.ruler.held_titles.push(incomingA);
  return { emperor, empireTitle, rulers, nextRuler, oldOffices: { A: oldA, B: oldB, C: oldC }, incomingA };
}

function runDelayedLateralCycleBatch(root, nextRuler) {
  const env = envFor(root, root);
  env.simulateTitleTransfers = true;
  const delayedTitleGains = [];
  env.onTitleTransfer = (transferredTitle, previousHolder, recipient) => {
    const handoffPath = transferredTitle.variableLists.get("votc_celestial_lateral_handoff_path") || [];
    delayedTitleGains.push({ transferredTitle, previousHolder, recipient,
      handoffPathBeforeGain: handoffPath.map(member => member.id),
      readyBeforeGain: transferredTitle.variables.has("votc_celestial_lateral_handoff_ready") });
    transferredTitle.current_heir = nextRuler[recipient.id];
  };
  runLateralRecheckEvent(env);
  assert.equal(root.variables.has(LATERAL_PENDING_VARIABLE), false,
    "the source event clears its pending marker before the synthetic delayed title-gain callback runs");
  const processedTarget = env.scopes.votc_celestial_lateral_target_title;
  assert(processedTarget, "the event retains a fixture reference to the processed incoming title");
  assert.equal(processedTarget.variableLists.has("votc_celestial_lateral_handoff_path"), false,
    "the event clears the selected title's visited path after its release batch");
  const followups = [];
  for (const transfer of delayedTitleGains) {
    const gainEnv = envFor(transfer.recipient, transfer.recipient);
    captureIncomingTitle(gainEnv, transfer.transferredTitle, transfer.previousHolder, "inheritance");
    transfer.pathAfterGain = (transfer.transferredTitle.variableLists.get("votc_celestial_lateral_handoff_path") || [])
      .map(member => member.id);
    transfer.readyAfterGain = transfer.transferredTitle.variables.has("votc_celestial_lateral_handoff_ready");
    if (gainEnv.scheduledEvents.some(event => event.id === "votc_celestial_office_release.0003")) {
      transfer.followupScheduled = true;
      followups.push({ root: transfer.recipient, env: gainEnv });
    } else {
      transfer.followupScheduled = false;
    }
  }
  return { env, delayedTitleGains, followups };
}

function testLateralCurrentHeirCycleFailsClosed() {
  const fixture = makeLateralHeirCycleFixture();
  const stalePathMember = character("lateral_cycle_stale_path_member");
  fixture.incomingA.variableLists.set("votc_celestial_lateral_handoff_path", [stalePathMember]);
  const firstGain = envFor(fixture.rulers.A.ruler, fixture.rulers.A.ruler);
  captureIncomingTitle(firstGain, fixture.incomingA, fixture.emperor, "inheritance");
  assert.equal(fixture.incomingA.variableLists.has("votc_celestial_lateral_handoff_path"), false,
    "a genuine new appointment without the ready marker discards stale title-hosted cycle state");
  const firstEvent = runDelayedLateralCycleBatch(fixture.rulers.A.ruler, fixture.nextRuler);
  assert.equal(firstEvent.delayedTitleGains[0].recipient.id, fixture.rulers.B.ruler.id,
    "the first old Kingdom office follows A's actual current_heir B");
  assert.deepStrictEqual(firstEvent.delayedTitleGains[0].handoffPathBeforeGain, [fixture.rulers.A.ruler.id]);
  assert.deepStrictEqual(firstEvent.delayedTitleGains[0].pathAfterGain, [fixture.rulers.A.ruler.id],
    "a ready transferred title preserves its path through the delayed on_title_gain callback");
  assert.equal(firstEvent.delayedTitleGains[0].readyBeforeGain, true);
  assert.equal(firstEvent.delayedTitleGains[0].readyAfterGain, false,
    "the delayed title-gain callback consumes the one-shot ready marker");
  captureIncomingTitle(firstEvent.followups[0].env, firstEvent.delayedTitleGains[0].transferredTitle,
    firstEvent.delayedTitleGains[0].previousHolder, "inheritance");
  assert.deepStrictEqual((firstEvent.delayedTitleGains[0].transferredTitle
    .variableLists.get("votc_celestial_lateral_handoff_path") || []).map(member => member.id),
  [fixture.rulers.A.ruler.id],
  "a repeated callback for the same already-pending title must preserve its handoff path");
  assert.equal(firstEvent.followups[0].env.scheduledEvents.filter(event =>
    event.id === "votc_celestial_office_release.0003").length, 1,
  "a duplicate callback for an already-pending same target cannot schedule a duplicate event");

  const secondEvent = runDelayedLateralCycleBatch(firstEvent.followups[0].root, fixture.nextRuler);
  assert.equal(secondEvent.delayedTitleGains[0].recipient.id, fixture.rulers.C.ruler.id,
    "the second old Kingdom office follows B's actual current_heir C");
  assert.deepStrictEqual(secondEvent.delayedTitleGains[0].handoffPathBeforeGain,
    [fixture.rulers.A.ruler.id, fixture.rulers.B.ruler.id]);

  const thirdEvent = runDelayedLateralCycleBatch(secondEvent.followups[0].root, fixture.nextRuler);
  assert.equal(thirdEvent.delayedTitleGains[0].recipient.id, fixture.emperor.id,
    "when the third heir would return the office to already-visited A, lateral handoff must fall back to the Emperor");
  assert.deepStrictEqual(thirdEvent.delayedTitleGains[0].handoffPathBeforeGain,
    [fixture.rulers.A.ruler.id, fixture.rulers.B.ruler.id, fixture.rulers.C.ruler.id],
  "the title-hosted visited path is carried across three asynchronous ruler handoffs");
  assert.deepStrictEqual(thirdEvent.delayedTitleGains[0].pathAfterGain, [],
    "a non-eligible fallback recipient clears the transferred title path");
  assert.equal(thirdEvent.delayedTitleGains[0].readyAfterGain, false,
    "the fallback recipient's on_title_gain callback consumes the ready marker even when no lateral batch is queued");
  assert.equal(thirdEvent.followups.length, 0,
    "the A→B→C→A heir ring must stop before it schedules another lateral transfer batch");
}

function testStaleOwnerEventDoesNotClearRecipientHandoffPath() {
  const source = makeTierLateralFixture("stale_lateral_owner", TIERS.tier_kingdom, 1);
  const recipient = makeRegionFixture("stale_lateral_recipient");
  recipient.emperor.vassals = recipient.emperor.vassals.filter(vassal => vassal !== recipient.root);
  recipient.root.top_liege = source.emperor;
  recipient.root.liege = source.emperor;
  source.emperor.vassals.push(recipient.root);
  const previousHolder = character("stale_lateral_grantor", { top_liege: source.emperor });
  const sourceGain = envFor(source.root, source.root);
  captureIncomingTitle(sourceGain, source.target, previousHolder, "inheritance");
  const pathAncestor = character("stale_lateral_path_ancestor");
  source.target.variableLists.set("votc_celestial_lateral_handoff_path", [pathAncestor]);
  source.target.variables.add("votc_celestial_lateral_handoff_ready");

  source.root.held_titles = source.root.held_titles.filter(held => held !== source.target);
  source.target.holder = recipient.root;
  recipient.root.held_titles.push(source.target);
  const recipientGain = envFor(recipient.root, recipient.root);
  captureIncomingTitle(recipientGain, source.target, source.root, "inheritance");
  assert.deepStrictEqual(source.target.variableLists.get("votc_celestial_lateral_handoff_path")
    .map(member => member.id), [pathAncestor.id],
  "the compatibility handoff recipient preserves and queues the inherited target path");
  assert(recipient.root.variables.has(LATERAL_PENDING_VARIABLE));
  assert.equal(recipient.root.variableValues.get(LATERAL_TARGET_VARIABLES[TIERS.tier_kingdom]), source.target);

  const staleSourceEvent = envFor(source.root, source.root);
  runLateralRecheckEvent(staleSourceEvent);
  assert.deepStrictEqual((source.target.variableLists.get("votc_celestial_lateral_handoff_path") || [])
    .map(member => member.id), [pathAncestor.id],
  "the old owner's stale event must not clear a title path after its holder moved to the recipient");
  assert(recipient.root.variables.has(LATERAL_PENDING_VARIABLE),
    "the stale source event cannot invalidate the recipient's already-pending cleanup");
}

function testRepeatedIneligibleGainPreservesPendingTargetPath() {
  const fixture = makeTierLateralFixture("repeat_lateral_gain", TIERS.tier_kingdom, 1);
  const previousHolder = character("repeat_lateral_grantor", { top_liege: fixture.emperor });
  const env = envFor(fixture.root, fixture.root);
  captureIncomingTitle(env, fixture.target, previousHolder, "inheritance");
  const pathMember = character("repeat_lateral_path_member");
  fixture.target.variableLists.set("votc_celestial_lateral_handoff_path", [pathMember]);
  fixture.root.held_titles = fixture.root.held_titles.filter(held => held !== fixture.oldOffices[0]);
  fixture.oldOffices[0].holder = fixture.emperor;
  assert.equal(evalTrigger(named(triggerFile, "votc_celestial_office_lateral_gain_trigger"), env), false,
    "after the old same-tier office leaves, a duplicate callback no longer meets the gain trigger");
  assert.equal(fixture.root.variableValues.get(LATERAL_TARGET_VARIABLES[TIERS.tier_kingdom]), fixture.target);
  assert(fixture.root.variables.has(LATERAL_PENDING_VARIABLE));

  captureIncomingTitle(env, fixture.target, previousHolder, "inheritance");
  assert.deepStrictEqual((fixture.target.variableLists.get("votc_celestial_lateral_handoff_path") || [])
    .map(member => member.id), [pathMember.id],
  "a repeated callback for the still-held pending target must retain its path even if its gain trigger has become false");
}

function testMixedTierTargetsAndLastIncomingWins() {
  const fixture = makeRegionFixture("mixed_lateral");
  fixture.empireTitle.tier = TIERS.tier_empire + 1;
  fixture.emperor.highest_held_title_tier = TIERS.tier_empire + 1;
  fixture.root.government_flags.add("government_is_celestial");
  const targets = new Map();
  const priorOffices = new Map();
  const pathSeeds = new Map();
  const tiers = [TIERS.tier_county, TIERS.tier_duchy, TIERS.tier_kingdom, TIERS.tier_empire];
  for (const tier of tiers) {
    const deJureAncestors = tier < TIERS.tier_empire ? ["mixed_lateral_incoming_4_1"] : [];
    const oldOffice = title(`mixed_lateral_old_${tier}`, tier, fixture.root, {
      title_law_flags: ["appointment_type_succession"], de_jure_ancestors: deJureAncestors
    });
    const incoming = [0, 1].map(index => title(`mixed_lateral_incoming_${tier}_${index}`, tier, fixture.root, {
      title_law_flags: ["appointment_type_succession"], de_jure_ancestors: deJureAncestors
    }));
    priorOffices.set(tier, [oldOffice]);
    targets.set(tier, incoming);
    pathSeeds.set(tier, character(`mixed_lateral_previous_path_${tier}`));
    fixture.root.held_titles.push(oldOffice, ...incoming);
  }
  fixture.root.highest_held_title_tier = Math.max(...fixture.root.held_titles.map(held => held.tier));
  const env = envFor(fixture.root, fixture.root);
  env.simulateTitleTransfers = true;
  const previousHolder = character("mixed_lateral_grantor", { top_liege: fixture.emperor });
  for (const tier of [TIERS.tier_county, TIERS.tier_duchy, TIERS.tier_kingdom, TIERS.tier_empire]) {
    const [firstIncoming, lastIncoming] = targets.get(tier);
    captureIncomingTitle(env, firstIncoming, previousHolder, "inheritance");
    firstIncoming.variableLists.set("votc_celestial_lateral_handoff_path", [pathSeeds.get(tier)]);
    const staleMember = character(`mixed_lateral_stale_incoming_path_${tier}`);
    lastIncoming.variableLists.set("votc_celestial_lateral_handoff_path", [staleMember]);
    captureIncomingTitle(env, lastIncoming, previousHolder, "inheritance");
    assert.deepStrictEqual(lastIncoming.variableLists.get("votc_celestial_lateral_handoff_path")
      .map(member => member.id), [pathSeeds.get(tier).id],
    `the last ${tier}-tier scope merges the superseded title path after discarding stale unready state`);
  }
  assert.equal(env.scheduledEvents.filter(event => event.id === "votc_celestial_office_release.0003").length, 1,
    "all same-day tier gains share one bounded lateral event");
  for (const tier of tiers) {
    assert.equal(fixture.root.variableValues.get(LATERAL_TARGET_VARIABLES[tier]), targets.get(tier)[1],
      `the last incoming ${tier} title replaces only that tier's saved target`);
  }

  runLateralRecheckEvent(env);
  assert.equal(fixture.root.primary_title, targets.get(TIERS.tier_empire)[1],
    "a higher incoming Empire may become primary, while later lower-tier cleanup cannot demote it");
  assert.deepStrictEqual(env.changes.filter(change => change.type === "set_primary_title_to")
    .map(change => change.target), [targets.get(TIERS.tier_empire)[1]],
  "the mixed-tier event sets primary only for the incoming highest-ranked target");
  for (const tier of tiers) {
    const selected = targets.get(tier)[1];
    const released = [priorOffices.get(tier)[0], targets.get(tier)[0]];
    for (const oldOffice of released) {
      assert(env.changes.some(change => change.type === "change_title_holder" && change.subject === oldOffice),
        `the ${tier} pass relinquishes its former and superseded same-tier appointments`);
      assert.notEqual(oldOffice.holder, fixture.root);
      assert.deepStrictEqual(oldOffice.variableLists.get("votc_celestial_lateral_handoff_path")
        .map(member => member.id), [pathSeeds.get(tier).id, fixture.root.id],
      `the ${tier} pass carries only its own merged target path to each title it transfers`);
    }
    assert.equal(selected.holder, fixture.root, "the latest selected title for each tier remains held");
    assert.equal(selected.variableLists.has("votc_celestial_lateral_handoff_path"), false,
      `the processed ${tier} target path is cleared after its pass`);
  }
  for (const variableName of Object.values(LATERAL_TARGET_VARIABLES)) {
    assert(!fixture.root.variableValues.has(variableName), `processed target ${variableName} is cleared`);
  }
  assert(!fixture.root.variables.has(LATERAL_PENDING_VARIABLE), "shared pending clears after all four tier passes");
}

function testGovernmentChangeHooksRecheckWithDeferredFullGate() {
  const requiredHooks = ["on_government_change", "on_liege_government_change"];
  const missingHooks = requiredHooks.filter(name => !actionDefs[name]);
  assert.deepStrictEqual(missingHooks, [],
    "the compatibility mod must register recheck callbacks for native government and liege-government changes");

  const changedGovernment = makeRegionFixture("government_changed");
  changedGovernment.primary.title_law_flags.clear();
  const oldOfficeHeir = character("government_changed_old_heir", { top_liege: changedGovernment.emperor,
    highest_held_title_tier: TIERS.tier_county, government_flags: ["government_use_bureaucracy"] });
  const oldOfficeHeirTitle = title("government_changed_old_heir_c", TIERS.tier_county, oldOfficeHeir, {
    title_law_flags: ["appointment_type_succession"]
  });
  oldOfficeHeir.primary_title = oldOfficeHeirTitle;
  const oldOffice = title("government_changed_old_d", TIERS.tier_duchy, changedGovernment.root, {
    title_law_flags: ["appointment_type_succession"], current_heir: oldOfficeHeir
  });
  changedGovernment.root.held_titles.push(oldOffice);
  const governmentEvent = envFor(changedGovernment.root, changedGovernment.root);
  invokeHook("on_government_change", governmentEvent);
  assert.deepStrictEqual(governmentEvent.scheduledEvents.map(event => [event.id, event.days]), [
    ["votc_celestial_office_release.0002", "1"]
  ], "a China character's government change queues a recheck before its primary law is updated");
  changedGovernment.primary.title_law_flags.add("appointment_type_succession");
  runRegionRecheckEvent(governmentEvent);
  assert(governmentEvent.changes.some(change => change.type === "change_title_holder" && change.subject === oldOffice),
    "a same-day appointment-law update is visible to the next-day full guard and releases the now-foreign old office");

  const newCelestialLiege = makeRegionFixture("liege_government_changed");
  const oldDirectVassal = addForeignVassal(newCelestialLiege, "liege_change_target");
  const liegeEvent = envFor(newCelestialLiege.root, newCelestialLiege.root);
  invokeHook("on_liege_government_change", liegeEvent);
  assert.deepStrictEqual(liegeEvent.scheduledEvents.map(event => [event.id, event.days]), [
    ["votc_celestial_office_release.0002", "1"]
  ], "a direct vassal rechecks when its liege changes to the Celestial government");
  runRegionRecheckEvent(liegeEvent);
  assert(liegeEvent.changes.some(change => change.type === "change_liege" && change.subject === oldDirectVassal),
    "the liege-government callback reaches the same next-day direct-vassal repair");

  const nonChina = makeRegionFixture("non_china_government_changed");
  const nonChinaEmpire = title("e_non_china_government_changed", TIERS.tier_empire, null);
  const nonChinaEmperor = character("non_china_government_emperor", { independent: true,
    primary_title: nonChinaEmpire, highest_held_title_tier: TIERS.tier_empire,
    government_flags: ["government_is_celestial"] });
  nonChinaEmpire.holder = nonChinaEmperor;
  nonChina.root.top_liege = nonChinaEmperor;
  const nonChinaEvent = envFor(nonChina.root, nonChina.root);
  invokeHook("on_government_change", nonChinaEvent);
  assert.equal(nonChinaEvent.scheduledEvents.length, 0,
    "a government-change recheck must not schedule for a non-China top liege");
  assert.equal(nonChinaEvent.changes.length, 0);

  const remainsFeudal = makeRegionFixture("government_still_feudal", { rootGovernment: false });
  const feudalEvent = envFor(remainsFeudal.root, remainsFeudal.root);
  invokeHook("on_government_change", feudalEvent);
  assert.equal(feudalEvent.scheduledEvents.length, 1,
    "the character-based callback can defer a potential candidate even when the resulting government is still ineligible");
  runRegionRecheckEvent(feudalEvent);
  assert.equal(feudalEvent.changes.length, 0,
    "the next-day full cleanup gate leaves a still-feudal candidate unchanged");
}

function testNoGlobalStepDownAndDeJureScope() {
  const releaseEffects = named(effectFile, "votc_celestial_release_office_title_effect");
  const legacyEffects = named(effectFile, "votc_celestial_repair_foreign_admin_vassals_effect");
  const allNodes = [];
  function visit(node) {
    for (const entry of node.entries || []) {
      allNodes.push(entry);
      if (typeof entry.value === "object") visit(entry.value);
    }
  }
  visit(releaseEffects);
  visit(legacyEffects);
  assert(!allNodes.some(entry => ["force_step_down_landed_titles", "destroy_title"].includes(entry.key)),
    "office release and migration cannot globally step down or destroy titles");

  const promotionSequence = first(named(effectFile, "votc_celestial_office_promotion_cleanup_effect"), "if").value.entries
    .filter(entry => entry.key !== "limit").map(entry => entry.key);
  assert.deepStrictEqual(promotionSequence, [
    "votc_celestial_repair_foreign_admin_vassals_effect",
    "votc_celestial_release_lower_offices_effect",
    "votc_celestial_repair_foreign_admin_vassals_effect"
  ], "promotion must repair again after all title transfers and transaction resolves");
  const legacySequence = named(effectFile, "votc_celestial_repair_legacy_foreign_state_effect").entries.map(entry => entry.key);
  assert.deepStrictEqual(legacySequence.filter(key => [
    "votc_celestial_repair_foreign_admin_vassals_effect",
    "every_held_title"
  ].includes(key)), [
    "votc_celestial_repair_foreign_admin_vassals_effect",
    "every_held_title",
    "votc_celestial_repair_foreign_admin_vassals_effect"
  ], "legacy migration must repair newly formed foreign direct vassals after releasing old titles");

  const attachable = named(triggerFile, "oe_stream_patch_attachable_trigger");
  const chinaBranch = first(child(attachable, "OR"), "AND");
  assert(chinaBranch, "OE attachability must retain a dedicated Chinese Celestial branch");
  const regionCheck = all(chinaBranch.value, "votc_celestial_title_in_holder_region_trigger");
  assert.equal(all(attachable, "target_is_de_jure_liege_or_above").length, 0,
    "de-jure restriction must not leak into non-China OE targets");
  assert.equal(regionCheck.length, 1, "China repair override must delegate region eligibility to the shared held-title-aware helper");
  const regionHelper = named(triggerFile, "votc_celestial_title_in_holder_region_trigger");
  assert.equal(countDescendants(regionHelper, "target_is_de_jure_liege_or_above"), 2,
    "the shared helper must check both primary-region and qualifying held-secondary-title ancestry");
  const empireTitle = title("h_china", TIERS.tier_empire, null);
  const emperor = character("emperor", { independent: true, primary_title: empireTitle,
    highest_held_title_tier: TIERS.tier_empire, government_flags: ["government_is_celestial"] });
  empireTitle.holder = emperor;
  const governorPrimary = title("k_guangdong", TIERS.tier_kingdom, null, {
    title_law_flags: ["appointment_type_succession"]
  });
  const governor = character("promoted-guangdong-governor", { top_liege: emperor,
    primary_title: governorPrimary, highest_held_title_tier: TIERS.tier_kingdom,
    government_flags: ["government_use_bureaucracy"] });
  governorPrimary.holder = governor;
  const targetPrimary = title("d_hebei", TIERS.tier_duchy, null, {
    title_law_flags: ["appointment_type_succession"]
  });
  const target = character("new-hebei-duke", { top_liege: emperor,
    primary_title: targetPrimary, highest_held_title_tier: TIERS.tier_duchy,
    government_flags: ["government_use_bureaucracy"] });
  targetPrimary.holder = target;
  const inRegion = title("c_in_target_region", TIERS.tier_county, governor, {
    title_law_flags: ["appointment_type_succession"], de_jure_ancestors: [targetPrimary.id]
  });
  const outsideRegion = title("c_outside_target_region", TIERS.tier_county, governor, {
    title_law_flags: ["appointment_type_succession"]
  });
  const hereditaryCounty = title("c_hereditary_target_region", TIERS.tier_county, null, {
    title_laws: ["partition_succession_law"], de_jure_ancestors: [targetPrimary.id]
  });
  hereditaryCounty.holder = governor;
  const customAristocratCounty = title("c_aristocrat_target_region", TIERS.tier_county, governor, {
    title_law_flags: ["appointment_type_succession"], variables: ["oe_aristocrat_title"],
    de_jure_ancestors: [targetPrimary.id]
  });
  const inEnv = envFor(governor, inRegion, { oe_stream_fix_target: target });
  const outEnv = envFor(governor, outsideRegion, { oe_stream_fix_target: target });
  const hereditaryEnv = envFor(governor, hereditaryCounty, { oe_stream_fix_target: target });
  const aristocratEnv = envFor(governor, customAristocratCounty, { oe_stream_fix_target: target });
  assertTrigger("oe_stream_patch_attachable_trigger", inEnv, true,
    "an otherwise eligible county in the repair target's primary-title region may be attached");
  assertTrigger("oe_stream_patch_attachable_trigger", outEnv, false,
    "a same-emperor but foreign-de-jure county must not be attached");
  assertTrigger("oe_stream_patch_attachable_trigger", hereditaryEnv, false,
    "a hereditary county in the correct de-jure region must not be swept into OE's include-vassals title repair");
  assert.equal(customAristocratCounty.noble_family, false,
    "OE aristocrat fixture deliberately remains false for the native noble-family predicate");
  assertTrigger("oe_stream_patch_attachable_trigger", aristocratEnv, false,
    "a title marked by oe_aristocrat_title must not be attached even inside the target region");

  const nonChinaEmpireTitle = title("e_non_china", TIERS.tier_empire, null);
  const nonChinaEmperor = character("non-china-emperor", { independent: true,
    primary_title: nonChinaEmpireTitle, highest_held_title_tier: TIERS.tier_empire });
  nonChinaEmpireTitle.holder = nonChinaEmperor;
  const nonChinaPrimary = title("k_non_china_target", TIERS.tier_kingdom, null);
  const nonChinaTarget = character("non-china-target", { top_liege: nonChinaEmperor,
    primary_title: nonChinaPrimary, highest_held_title_tier: TIERS.tier_kingdom });
  nonChinaPrimary.holder = nonChinaTarget;
  const ordinaryForeignCounty = title("c_non_china_foreign", TIERS.tier_county, governor);
  assertTrigger("oe_stream_patch_attachable_trigger",
    envFor(governor, ordinaryForeignCounty, { oe_stream_fix_target: nonChinaTarget }), true,
    "a foreign-de-jure ordinary county remains attachable for a non-China OE target under the original filter");
}

function run() {
  testAstAndPromotionGate();
  testReleaseBoundariesAndTitleHeir();
  testLegacyVassalRepair();
  testLegacySelfHeldForeignOfficeRepairUsesRulerScope();
  testFinalRepairAfterSyntheticTitleTransactionSideEffect();
  testSecondaryHeldRegionAndExclusions();
  testForeignVassalGateAndNextDayGovernmentChange();
  testFeudalPromotionFailsClosedUntilGovernmentIsEligible();
  testRegionLifecycleHooksAndReentrantCleanup();
  testReleasedTitleHeirGetsNextDayLiegeRepair();
  testNoGlobalStepDownAndDeJureScope();
  const transitionFailures = [];
  for (const [name, test] of [
    ["same-rank appointment eligibility", testSameRankCandidateRemainsEligible],
    ["all-tier lateral handoffs", testAllTierLateralHandoffs],
    ["mixed-tier target replacement and path merging", testMixedTierTargetsAndLastIncomingWins],
    ["lateral current-heir cycle", testLateralCurrentHeirCycleFailsClosed],
    ["stale source event title path", testStaleOwnerEventDoesNotClearRecipientHandoffPath],
    ["repeated pending target callback", testRepeatedIneligibleGainPreservesPendingTargetPath],
    ["government-change recheck hooks", testGovernmentChangeHooksRecheckWithDeferredFullGate]
  ]) {
    try {
      test();
    } catch (error) {
      transitionFailures.push({ name, error });
    }
  }
  for (const failure of transitionFailures) {
    console.error(`[transition QA] ${failure.name}: ${failure.error.message}`);
  }
  assert.equal(transitionFailures.length, 0, "all transition and government-hook checks must pass");
  console.log("V8.15.2 celestial office independent QA: PASS");
}

run();
