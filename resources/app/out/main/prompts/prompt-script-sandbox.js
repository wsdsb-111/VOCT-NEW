"use strict";

const fs__namespace = require("fs");
const scriptSandbox = require("../script-sandbox");

class PromptScriptSandbox {
  /**
   * Execute a description script (pList) in a sandboxed VM context
   * Expected to return a string
   */
  static executeDescription(scriptFilePath, context) {
    const scriptCode = fs__namespace.readFileSync(scriptFilePath, "utf-8");
    const sandbox = this.createBaseSandbox();
    sandbox.gameData = context.gameData;
    sandbox.currentCharacterId = context.currentCharacterId;
    const result = this.executeScript(scriptFilePath, scriptCode, sandbox, "description");
    return result;
  }
  /**
   * Execute an example script (aliChat) in a sandboxed VM context
   * Expected to return an array of message objects
   */
  static executeExamples(scriptFilePath, context) {
    const scriptCode = fs__namespace.readFileSync(scriptFilePath, "utf-8");
    const sandbox = this.createBaseSandbox();
    sandbox.gameData = context.gameData;
    sandbox.currentCharacterId = context.currentCharacterId;
    const result = this.executeScript(scriptFilePath, scriptCode, sandbox, "examples");
    return Array.isArray(result) ? result : [];
  }
  /**
   * Execute a helper script in a sandboxed VM context
   * Helper scripts register Handlebars helpers
   */
  static executeHelper(scriptFilePath, Handlebars2) {
    const scriptCode = fs__namespace.readFileSync(scriptFilePath, "utf-8");
    const sandbox = this.createBaseSandbox();
    sandbox.Handlebars = Handlebars2;
    this.executeScript(scriptFilePath, scriptCode, sandbox, "helper");
  }
  /**
   * Create the base sandbox with safe globals
   */
  static createBaseSandbox() {
    return scriptSandbox.createSandbox();
  }
  /**
   * Execute script in VM context with appropriate wrapper
   * Synchronous execution for compatibility with existing API
   */
  static executeScript(filePath, scriptCode, sandbox, scriptType) {
    const wrapperCode = `
      (function() {
        // Create a module-like structure for CommonJS style exports
        const module = { exports: {} };
        const exports = module.exports;
        
        // Execute the script code to populate module.exports
        ${scriptCode}
        
        // Get the exported function (support both module.exports and default export)
        const exportedFn = module.exports && module.exports.default 
          ? module.exports.default 
          : module.exports;
        
        if (typeof exportedFn !== 'function') {
          throw new Error('Script must export a function');
        }
        
        // Execute based on script type
        ${this.getExecutionCode(scriptType)}
      })();
    `;
    try {
      const result = scriptSandbox.runScript(wrapperCode, { filename: filePath, sandbox });
      if (scriptType === "description" && typeof result !== "string") {
        throw new Error(`Description script must return a string, got ${typeof result}`);
      }
      if (scriptType === "examples" && !Array.isArray(result)) {
        throw new Error(`Example script must return an array, got ${typeof result}`);
      }
      return result;
    } catch (error) {
      console.error("[PromptScriptSandbox] Execution error:", error);
      throw new Error(`Script execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /**
   * Get the execution code based on script type
   */
  static getExecutionCode(scriptType) {
    switch (scriptType) {
      case "description":
      case "examples":
        return `
          const result = exportedFn(gameData, currentCharacterId);
          return result;
        `;
      case "helper":
        return `
          exportedFn(Handlebars);
          return undefined;
        `;
    }
  }
}


module.exports = { PromptScriptSandbox };
