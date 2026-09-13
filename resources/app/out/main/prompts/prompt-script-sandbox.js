"use strict";

const fs__namespace = require("fs");
const scriptSandbox = require("../script-sandbox");
const { inferGenderFromPronoun } = require("../game-data/character");
const { resolveCharacterSexConsensus } = require("../worldline/character-demographic-normalizer");

// Adapt known legacy pList ternaries at execution time, preserving user files.
function adaptLegacyGenderLabels(code) {
  const neutralLabels = new Map([
    ["son|daughter", "child"], ["brother|sister", "sibling"], ["man|woman", "person"],
    ["儿子|女儿", "子女"], ["兄弟|姐妹", "手足"], ["男性|女性", "性别未知"]
  ]);
  const replaceLabel = (expression, object, maleFirst, yes, no) => {
    const male = maleFirst ? yes : no;
    const female = maleFirst ? no : yes;
    const neutral = neutralLabels.get(male + "|" + female);
    return neutral ? "__votcGenderLabel(" + object + "," + [male, female, neutral].map(value => JSON.stringify(value)).join(",") + ")" : expression;
  };
  return code.replace(/(\w+)\.sheHe\s*===\s*["'](he|she|他|她)["']\s*\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']/g,
    (expression, object, pronoun, yes, no) => replaceLabel(expression, object, pronoun === "he" || pronoun === "他", yes, no))
    .replace(/is(Male|Female)\((\w+)\)\s*\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']/g,
      (expression, sex, object, yes, no) => replaceLabel(expression, object, sex === "Male", yes, no));
}

class PromptScriptSandbox {
  /**
   * Execute a description script (pList) in a sandboxed VM context
   * Expected to return a string
   */
  static executeDescription(scriptFilePath, context) {
    const scriptCode = adaptLegacyGenderLabels(fs__namespace.readFileSync(scriptFilePath, "utf-8"));
    const sandbox = this.createBaseSandbox();
    sandbox.__votcGenderLabel = (character, male, female, neutral) => {
      const canonical = context.gameData?.characters?.get(Number(character?.id));
      const subject = canonical || character;
      const consensus = resolveCharacterSexConsensus({ snapshot: subject });
      const sex = consensus.sex;
      const resolved = consensus.conflict || sex !== "unknown" || subject?.gender != null ? sex : inferGenderFromPronoun(subject?.sheHe);
      return resolved === "male" ? male : resolved === "female" ? female : neutral;
    };
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
