"use strict";

const fs = require("fs");
const path = require("path");
const events = require("events");
const vm = require("vm");

const STANDARD_SUBDIR = "standard";
const CUSTOM_SUBDIR = "custom";
const OFFICIAL_STANDARD_FILES = Object.freeze([
  "z_agreedToTruceWith.js",
  "z_becomeBestFriendsWith.js",
  "z_becomeBloodBrothersWith.js",
  "z_becomeFriendsWith.js",
  "z_becomeLoversWith.js",
  "z_becomeNemesisWith.js",
  "z_becomeRivalsWith.js",
  "z_becomeSoulmatesWith.js",
  "z_changeLocation.js",
  "z_changeOpinionOf.js",
  "z_characterIsKilled.js",
  "z_convertsToReligionOf.js",
  "z_intercourse.js",
  "z_isAssignedToCouncilBy.js",
  "z_isAssignedToCourtPositionBy.js",
  "z_isEmployedAsKnightBy.js",
  "z_isEmployedBy.js",
  "z_isFiredFromCouncilOf.js",
  "z_isImprisonedBy.js",
  "z_isInjured.js",
  "z_isUndressed.js",
  "z_isVassalizedBy.js",
  "z_leavesConversation.js",
  "z_makeAlliance.js",
  "z_noOp.js",
  "z_paysGoldTo.js",
  "z_playerPaysGoldTo.js",
  "z_setEmotion.js"
]);

let actionsDir = null;
let dataDir = null;
let defaultUserdataDir = null;

class ActionRegistry extends events.EventEmitter {
  static configure(paths = {}) {
    actionsDir = paths.actionsDir || actionsDir;
    dataDir = paths.dataDir || dataDir;
    defaultUserdataDir = paths.defaultUserdataDir || defaultUserdataDir;
    return this;
  }

  constructor() {
    super();
    this.actions = new Map();
    this.settings = { disabledActions: [], validation: {} };
  }

  static getInstance() {
    if (!ActionRegistry.instance) ActionRegistry.instance = new ActionRegistry();
    return ActionRegistry.instance;
  }

  setSettings(settings) {
    if (!settings) {
      this.settings = { disabledActions: [], validation: {}, destructiveOverrides: {} };
      return;
    }
    this.settings = { ...settings, destructiveOverrides: settings.destructiveOverrides || {} };
  }

  getSettings() {
    return this.settings;
  }

  getAllActions(includeDisabled = false) {
    const disabled = new Set(this.settings.disabledActions);
    return Array.from(this.actions.values()).filter((action) => includeDisabled || !disabled.has(action.id) && action.validation.valid);
  }

  isActionDisabled(signature) {
    return this.settings.disabledActions.includes(signature);
  }

  getValidationStatus(signature) {
    return this.settings.validation[signature] ?? { valid: this.actions.has(signature) };
  }

  setActionDisabled(signature, disabled) {
    const current = new Set(this.settings.disabledActions);
    if (disabled) current.add(signature);
    else current.delete(signature);
    this.settings = { ...this.settings, disabledActions: Array.from(current) };
  }

  setDestructiveOverride(signature, isDestructive) {
    const overrides = { ...this.settings.destructiveOverrides };
    if (isDestructive === null) delete overrides[signature];
    else overrides[signature] = isDestructive;
    this.settings = { ...this.settings, destructiveOverrides: overrides };
  }

  getEffectiveDestructive(signature) {
    const action = this.actions.get(signature);
    if (!action) return false;
    if (this.settings.destructiveOverrides && signature in this.settings.destructiveOverrides) return this.settings.destructiveOverrides[signature];
    return action.definition.isDestructive ?? false;
  }

  hasDestructiveOverride(signature) {
    return !!(this.settings.destructiveOverrides && signature in this.settings.destructiveOverrides);
  }

  registerValidation(signature, status) {
    this.settings = { ...this.settings, validation: { ...this.settings.validation, [signature]: status } };
  }

  getById(signature) {
    return this.actions.get(signature);
  }

  async reloadActions() {
    this.actions.clear();
    this.settings.validation = {};
    await this.ensureBaseStructure();
    await this.seedDefaults();
    const loaded = await this.loadDirectory(STANDARD_SUBDIR, "standard");
    for (const action of loaded) this.actions.set(action.id, action);
    this.emit("actions-reloaded", loaded);
  }

  async ensureBaseStructure() {
    await fs.promises.mkdir(actionsDir, { recursive: true });
    await fs.promises.mkdir(path.join(actionsDir, STANDARD_SUBDIR), { recursive: true });
    await fs.promises.mkdir(path.join(actionsDir, CUSTOM_SUBDIR), { recursive: true });
  }

  async seedDefaults() {
    await this.ensureBaseStructure();
    if (!fs.existsSync(defaultUserdataDir)) return;
    const defaultStandardDir = path.join(defaultUserdataDir, STANDARD_SUBDIR);
    const userStandardDir = path.join(actionsDir, STANDARD_SUBDIR);
    for (const file of OFFICIAL_STANDARD_FILES) {
      const source = path.join(defaultStandardDir, file);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(userStandardDir, file));
    }
    const defaultTypeDefsPath = path.join(path.dirname(defaultUserdataDir), "gamedata_typedefs.js");
    const userTypeDefsPath = path.join(dataDir, "gamedata_typedefs.js");
    if (fs.existsSync(defaultTypeDefsPath)) fs.copyFileSync(defaultTypeDefsPath, userTypeDefsPath);
  }

  async loadDirectory(subdir, scope) {
    const dirPath = path.join(actionsDir, subdir);
    const loaded = [];
    for (const file of OFFICIAL_STANDARD_FILES) {
      const fullPath = path.join(dirPath, file);
      if (!fs.existsSync(fullPath)) continue;
      const result = await this.importAction(fullPath, scope);
      if (result) loaded.push(result);
    }
    return loaded;
  }

  async importAction(filePath, scope) {
    try {
      const actionDef = await this.loadActionDefinition(filePath);
      const validation = this.validateCandidate(actionDef);
      const id = actionDef?.signature ?? path.basename(filePath);
      this.registerValidation(id, validation);
      return { definition: actionDef, id, scope, filePath, validation };
    } catch (error) {
      const id = path.basename(filePath);
      const validation = { valid: false, message: `Failed to load action: ${error.message}` };
      this.registerValidation(id, validation);
      return { definition: {}, id, scope, filePath, validation };
    }
  }

  async loadActionDefinition(filePath) {
    const actionCode = await fs.promises.readFile(filePath, "utf-8");
    const sandbox = { module: { exports: {} }, exports: {}, console, require: undefined, process: undefined, global: undefined, globalThis: undefined, eval: undefined, Function: undefined, Buffer: undefined, __dirname: undefined, __filename: undefined };
    const vmContext = vm.createContext(sandbox);
    try {
      new vm.Script(actionCode, { filename: filePath }).runInContext(vmContext);
      return sandbox.module.exports;
    } catch (error) {
      throw new Error(`Failed to parse action: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  validateCandidate(candidate) {
    if (!candidate || typeof candidate !== "object") return { valid: false, message: "Action module must export an object." };
    if (typeof candidate.signature !== "string" || candidate.signature.length === 0) return { valid: false, message: "Action must define a non-empty string signature." };
    if (!(typeof candidate.description === "string" || typeof candidate.description === "function")) return { valid: false, message: "Action must include a description string or description(context) function." };
    if (!Array.isArray(candidate.args) && typeof candidate.args !== "function") return { valid: false, message: "Action args must be an array or args(context) function." };
    if (Array.isArray(candidate.args)) {
      const argsValidation = this.validateArguments(candidate.args);
      if (!argsValidation.valid) return argsValidation;
    }
    if (typeof candidate.check !== "function") return { valid: false, message: "Action must provide a check(context) function." };
    if (typeof candidate.run !== "function") return { valid: false, message: "Action must provide a run(context) function." };
    return { valid: true };
  }

  validateArguments(args) {
    for (const arg of args) {
      if (typeof arg.name !== "string" || arg.name.length === 0) return { valid: false, message: "Action argument must include a non-empty name." };
      if (typeof arg.description !== "string") return { valid: false, message: `Argument '${arg.name}' must include a description.` };
      if (arg.type === "number") {
        if (arg.min !== undefined && typeof arg.min !== "number") return { valid: false, message: `Argument '${arg.name}' has invalid min value.` };
        if (arg.max !== undefined && typeof arg.max !== "number") return { valid: false, message: `Argument '${arg.name}' has invalid max value.` };
      } else if (arg.type === "string") {
        if ("pattern" in arg && arg.pattern !== undefined && !(typeof arg.pattern === "string" || arg.pattern instanceof RegExp)) return { valid: false, message: `Argument '${arg.name}' has invalid pattern.` };
      } else if (arg.type === "enum") {
        if (!Array.isArray(arg.options) || arg.options.length === 0 || arg.options.some((option) => typeof option !== "string")) return { valid: false, message: `Argument '${arg.name}' enum must provide non-empty string options.` };
      } else if (arg.type !== "boolean") {
        return { valid: false, message: `Argument '${arg.name ?? "unknown"}' has unsupported type.` };
      }
    }
    return { valid: true };
  }
}

module.exports = { ActionRegistry, OFFICIAL_STANDARD_FILES };
