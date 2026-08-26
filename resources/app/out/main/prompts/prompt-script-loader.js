"use strict";

const fs$1 = require("fs");
const path = require("path");
const { PromptScriptSandbox } = require("./prompt-script-sandbox");

class PromptScriptLoader {
  resolve(scriptPath) {
    return path.resolve(scriptPath);
  }
  executeDescription(scriptPath, gameData, currentCharacterId) {
    const resolved = this.resolve(scriptPath);
    if (!fs$1.existsSync(resolved)) {
      throw new Error(`Prompt script not found: ${resolved}`);
    }
    return PromptScriptSandbox.executeDescription(resolved, { gameData, currentCharacterId });
  }
  executeExamples(scriptPath, gameData, currentCharacterId) {
    const resolved = this.resolve(scriptPath);
    if (!fs$1.existsSync(resolved)) {
      throw new Error(`Prompt script not found: ${resolved}`);
    }
    return PromptScriptSandbox.executeExamples(resolved, { gameData, currentCharacterId });
  }
}


module.exports = { PromptScriptLoader };
