"use strict";

const fs = require("fs");
const path = require("path");
const events = require("events");
const actionRuleRegistry = require("./action-rule-registry");
const riskPolicy = require("./risk-policy");
const scriptSandbox = require("../script-sandbox");

const STANDARD_SUBDIR = "standard";
const CUSTOM_SUBDIR = "custom";
const RETIRED_STANDARD_ACTION_FILES = ["z_performCombatAction.js", "z_performDailyAction.js", "z_performIntimateAction.js"];
const RETIRED_STANDARD_ACTION_IDS = new Set(["performCombatAction", "performDailyAction", "performIntimateAction"]);
let VOTC_ACTIONS_DIR = null;
let VOTC_DATA_DIR = null;
let DEFAULT_USERDATA_DIR = null;

class ActionRegistry extends events.EventEmitter {
  static configure(paths = {}) {
    VOTC_ACTIONS_DIR = paths.actionsDir || VOTC_ACTIONS_DIR;
    VOTC_DATA_DIR = paths.dataDir || VOTC_DATA_DIR;
    DEFAULT_USERDATA_DIR = paths.defaultUserdataDir || DEFAULT_USERDATA_DIR;
    return this;
  }
  constructor() {
    super();
    this.actions = /* @__PURE__ */ new Map();
    this.categoryIndex = /* @__PURE__ */ new Map();
    this.settings = {
      disabledActions: [],
      validation: {}
    };
  }
  static getInstance() {
    if (!ActionRegistry.instance) {
      ActionRegistry.instance = new ActionRegistry();
    }
    return ActionRegistry.instance;
  }
  setSettings(settings) {
    if (!settings) {
      this.settings = { disabledActions: [], validation: {}, destructiveOverrides: {} };
      return;
    }
    this.settings = {
      ...settings,
      destructiveOverrides: settings.destructiveOverrides || {}
    };
  }
  getSettings() {
    return this.settings;
  }
  getAllActions(includeDisabled = false) {
    const disabled = new Set(this.settings.disabledActions);
    return Array.from(this.actions.values()).filter((action) => {
      if (includeDisabled) {
        return true;
      }
      return !disabled.has(action.id) && action.validation.valid;
    });
  }
  getActionIdsForCategories(categories, includeDisabled = false) {
    const indexed = actionRuleRegistry.getActionIdsForCategories(this.categoryIndex, categories);
    const availableIds = new Set(this.getAllActions(includeDisabled).map((action) => action.id));
    return new Set([...indexed].filter((actionId) => availableIds.has(actionId)));
  }
  isActionDisabled(signature) {
    return this.settings.disabledActions.includes(signature);
  }
  getValidationStatus(signature) {
    return this.settings.validation[signature] ?? {
      valid: this.actions.has(signature)
    };
  }
  setActionDisabled(signature, disabled) {
    const current = new Set(this.settings.disabledActions);
    if (disabled) {
      current.add(signature);
    } else {
      current.delete(signature);
    }
    this.settings = {
      ...this.settings,
      disabledActions: Array.from(current)
    };
  }
  setDestructiveOverride(signature, isDestructive) {
    const overrides = { ...this.settings.destructiveOverrides };
    if (this.getEffectiveRiskLevel(signature) === "high" && isDestructive === false) {
      delete overrides[signature];
      this.settings = {
        ...this.settings,
        destructiveOverrides: overrides
      };
      return;
    }
    if (isDestructive === null) {
      delete overrides[signature];
    } else {
      overrides[signature] = isDestructive;
    }
    this.settings = {
      ...this.settings,
      destructiveOverrides: overrides
    };
  }
  getEffectiveDestructive(signature) {
    const action = this.actions.get(signature);
    if (!action) return false;
    return riskPolicy.getEffectiveDestructive(action, this.settings);
  }
  getEffectiveRiskLevel(signature) {
    const action = this.actions.get(signature);
    return riskPolicy.getEffectiveRiskLevel(action, this.settings);
  }
  shouldRequireApproval(signature, approvalMode) {
    return riskPolicy.requiresApproval(this.actions.get(signature), this.settings, approvalMode);
  }
  hasDestructiveOverride(signature) {
    return !!(this.settings.destructiveOverrides && signature in this.settings.destructiveOverrides);
  }
  registerValidation(signature, status) {
    this.settings = {
      ...this.settings,
      validation: {
        ...this.settings.validation,
        [signature]: status
      }
    };
  }
  getById(signature) {
    return this.actions.get(signature);
  }
  async reloadActions() {
    this.actions.clear();
    this.settings.validation = {};
    await this.ensureBaseStructure();
    await this.seedDefaults();
    const loaded = [];
    const standardActions = await this.loadDirectory(STANDARD_SUBDIR, "standard");
    const customActions = await this.loadDirectory(CUSTOM_SUBDIR, "custom");
    for (const action of [...standardActions, ...customActions]) {
      this.actions.set(action.id, action);
      loaded.push(action);
    }
    this.categoryIndex = actionRuleRegistry.buildCategoryIndex(loaded);
    const valid = loaded.filter((action) => action.validation.valid);
    const deterministic = valid.filter((action) => action.definition?.semantic?.deterministicInvocation === true).length;
    const bilateral = valid.filter((action) => action.definition?.semantic?.bilateralPersistentEffect === true).length;
    console.log(`[ActionRegistry] ${loaded.length} loaded, ${valid.length} valid, ${loaded.length - valid.length} invalid, ${deterministic} deterministic, ${bilateral} bilateral, 0 legacy semantic`);
    this.emit("actions-reloaded", loaded);
  }
  on(event, listener) {
    return super.on(event, listener);
  }
  async ensureBaseStructure() {
    await fs.promises.mkdir(VOTC_ACTIONS_DIR, { recursive: true });
    await fs.promises.mkdir(
      path.join(VOTC_ACTIONS_DIR, STANDARD_SUBDIR),
      { recursive: true }
    );
    await fs.promises.mkdir(
      path.join(VOTC_ACTIONS_DIR, CUSTOM_SUBDIR),
      { recursive: true }
    );
  }
  /**
   * Copy default action files into user data, always updating existing files.
   */
  async seedDefaults() {
    await this.ensureBaseStructure();
    if (!fs.existsSync(DEFAULT_USERDATA_DIR)) {
      return;
    }
    const copyRecursive = (src, dest) => {
      if (!fs.existsSync(src)) return;
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
          copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    };
    const defaultStandardDir = path.join(DEFAULT_USERDATA_DIR, STANDARD_SUBDIR);
    const userStandardDir = path.join(VOTC_ACTIONS_DIR, STANDARD_SUBDIR);
    for (const filename of RETIRED_STANDARD_ACTION_FILES) {
      const stalePath = path.join(userStandardDir, filename);
      try {
        await fs.promises.unlink(stalePath);
      } catch (error) {
        if (error?.code !== "ENOENT") console.warn(`[ActionRegistry] Could not remove retired standard action ${filename}:`, error);
      }
    }
    if (fs.existsSync(defaultStandardDir)) {
      copyRecursive(defaultStandardDir, userStandardDir);
    }
    const defaultTypeDefsPath = path.join(path.dirname(DEFAULT_USERDATA_DIR), "gamedata_typedefs.js");
    const userTypeDefsPath = path.join(VOTC_DATA_DIR, "gamedata_typedefs.js");
    if (fs.existsSync(defaultTypeDefsPath)) {
      fs.copyFileSync(defaultTypeDefsPath, userTypeDefsPath);
    }
  }
  /**
   * pList-style descriptions end with a date/location/scenario record. Split
   * only that known volatile tail; all original character information remains
   * present, merely earlier in the cacheable prefix. Custom scripts without
   * this marker keep their original single-message behaviour.
   */
  static splitDescriptionForCache(description) {
    if (typeof description !== "string") return { stableContent: "", dynamicContent: "" };
    const match = /\n(\[date\([^\n]*\)\])\s*$/.exec(description);
    if (!match || match.index <= 0) return { stableContent: description, dynamicContent: "" };
    return {
      stableContent: description.slice(0, match.index).trimEnd(),
      dynamicContent: match[1]
    };
  }
  async loadDirectory(subdir, scope) {
    const dirPath = path.join(VOTC_ACTIONS_DIR, subdir);
    const files = await fs.promises.readdir(dirPath);
    const loaded = [];
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = await fs.promises.stat(fullPath);
      if (!stat.isFile()) {
        continue;
      }
      const ext = path.extname(fullPath).toLowerCase();
      if (![".js", ".cjs", ".mjs"].includes(ext)) {
        continue;
      }
      const result = await this.importAction(fullPath, scope);
      if (result) {
        loaded.push(result);
      }
    }
    return loaded;
  }
  async importAction(filePath, scope) {
    try {
      const actionDef = await this.loadActionDefinition(filePath);
      const validation = this.validateCandidate(actionDef);
      const id = actionDef?.signature ?? path.basename(filePath);
      if (scope === "standard" && RETIRED_STANDARD_ACTION_IDS.has(id)) {
        console.warn(`[ActionRegistry] Ignoring retired standard action: ${id}`);
        return null;
      }
      this.registerValidation(id, validation);
      return {
        definition: actionDef,
        id,
        scope,
        filePath,
        validation
      };
    } catch (error) {
      const id = path.basename(filePath);
      const errorMessage = error.message;
      const validation = {
        valid: false,
        message: `Failed to load action: ${errorMessage}`
      };
      this.registerValidation(id, validation);
      return {
        definition: {},
        id,
        scope,
        filePath,
        validation
      };
    }
  }
  /**
   * Load action definition from file using VM sandbox
   */
  async loadActionDefinition(filePath) {
    const actionCode = await fs.promises.readFile(filePath, "utf-8");
    const moduleObject = { exports: {} };
    const sandbox = scriptSandbox.createSandbox({ module: moduleObject, exports: moduleObject.exports });
    try {
      scriptSandbox.runScript(actionCode, { filename: filePath, sandbox });
      return sandbox.module.exports;
    } catch (error) {
      throw new Error(`Failed to parse action: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  validateCandidate(candidate) {
    if (!candidate || typeof candidate !== "object") {
      return {
        valid: false,
        message: "Action module must export an object."
      };
    }
    const action = candidate;
    if (typeof action.signature !== "string" || action.signature.length === 0) {
      return {
        valid: false,
        message: "Action must define a non-empty string signature."
      };
    }
    if (!(typeof action.description === "string" || typeof action.description === "function")) {
      return {
        valid: false,
        message: "Action must include a description string or description(context) function."
      };
    }
    if (!Array.isArray(action.args) && typeof action.args !== "function") {
      return {
        valid: false,
        message: "Action args must be an array or args(context) function."
      };
    }
    if (Array.isArray(action.args)) {
      const argsValidation = this.validateArguments(action.args);
      if (!argsValidation.valid) {
        return argsValidation;
      }
    }
    if (typeof action.check !== "function") {
      return {
        valid: false,
        message: "Action must provide a check(context) function."
      };
    }
    if (typeof action.run !== "function") {
      return {
        valid: false,
        message: "Action must provide a run(context) function."
      };
    }
    const ruleValidation = actionRuleRegistry.validateActionRules(action);
    if (!ruleValidation.valid) return ruleValidation;
    return { valid: true };
  }
  validateArguments(args) {
    for (const arg of args) {
      if (typeof arg.name !== "string" || arg.name.length === 0) {
        return {
          valid: false,
          message: "Action argument must include a non-empty name."
        };
      }
      if (typeof arg.description !== "string") {
        return {
          valid: false,
          message: `Argument '${arg.name}' must include a description.`
        };
      }
      if (arg.type === "number") {
        if (arg.min !== void 0 && typeof arg.min !== "number") {
          return {
            valid: false,
            message: `Argument '${arg.name}' has invalid min value.`
          };
        }
        if (arg.max !== void 0 && typeof arg.max !== "number") {
          return {
            valid: false,
            message: `Argument '${arg.name}' has invalid max value.`
          };
        }
      } else if (arg.type === "string") {
        if ("pattern" in arg && arg.pattern !== void 0 && !(typeof arg.pattern === "string" || arg.pattern instanceof RegExp)) {
          return {
            valid: false,
            message: `Argument '${arg.name}' has invalid pattern.`
          };
        }
      } else if (arg.type === "enum") {
        if (!Array.isArray(arg.options) || arg.options.length === 0 || arg.options.some((opt) => typeof opt !== "string")) {
          return {
            valid: false,
            message: `Argument '${arg.name}' enum must provide non-empty string options.`
          };
        }
      } else if (arg.type === "boolean") ;
      else {
        const exhaustiveCheck = arg;
        return {
          valid: false,
          message: `Argument '${exhaustiveCheck.name ?? "unknown"}' has unsupported type.`
        };
      }
    }
    return { valid: true };
  }
}

module.exports = { ActionRegistry };
