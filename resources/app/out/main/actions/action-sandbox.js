"use strict";

const fs = require("fs");
const vm = require("vm");

class ActionSandbox {
  static async executeAction(actionFilePath, context) {
    const actionCode = fs.readFileSync(actionFilePath, "utf-8");
    const sandbox = {
      gameData: context.gameData,
      sourceCharacter: context.sourceCharacter,
      targetCharacter: context.targetCharacter,
      runGameEffect: context.runGameEffect,
      args: context.args,
      conversation: context.conversation,
      dryRun: context.dryRun,
      lang: context.lang,
      console,
      require: undefined,
      process: undefined,
      global: undefined,
      globalThis: undefined,
      eval: undefined,
      Function: undefined,
      Buffer: undefined,
      __dirname: undefined,
      __filename: undefined
    };
    const wrapperCode = `
      (async function() {
        const module = { exports: {} };
        const exports = module.exports;
        ${actionCode}
        const actionDef = module.exports;
        if (!actionDef || typeof actionDef.run !== 'function') {
          throw new Error('Action must export an object with a run function');
        }
        return actionDef.run({ gameData, sourceCharacter, targetCharacter, runGameEffect, args, conversation, dryRun, lang });
      })();
    `;
    try {
      return await new vm.Script(wrapperCode, { filename: actionFilePath }).runInContext(vm.createContext(sandbox), { breakOnSigint: true });
    } catch (error) {
      console.error("[ActionSandbox] Execution error:", error);
      throw new Error(`Action execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

module.exports = { ActionSandbox };
