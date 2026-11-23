"use strict";

const fs$1 = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PromptScriptSandbox } = require("./prompt-script-sandbox");
const { splitResponderCharacterProfile } = require("./character-profile-split");

const trustedGlmDescriptionHashes = Object.freeze({
  "pListMccTest2.js": [
    "225a991d07f921f69fd9c91a1dc866297a7c22e14c904cbd9564159f80cb4ff7",
    "5176cadd266429b3cd1309d17aca18f7f3bc2b83a185c93e445aee70ae30e934"
  ],
  "pListMccTest2JE.js": [
    "2dd86d09a32d878f842babada6063d739a7d064e59d2c8d4e6f92c5333ea2990",
    "37408e5d3ffac0757319daa87942583b30396cdc289b0f94053422a0774fb70a"
  ],
  "pListMccTest2_ZH.js": [
    "554639c376a399705eb9395d02cf2ac215bbb88d4609913ffe175a4250b5e18e"
  ],
  "pListMccTest2JE_ZH.js": [
    "d5f10f6c6bb0663aa70ad1dab555c81e8c51ae0dad3ad084608ed1d945f1b1d7"
  ]
});

function isTrustedGlmDescription(scriptPath, sourceText) {
  const hashes = trustedGlmDescriptionHashes[path.basename(scriptPath)];
  if (!Array.isArray(hashes)) return false;
  const normalizedSource = sourceText.replace(/\r\n?/g, "\n");
  const sourceHash = crypto.createHash("sha256").update(normalizedSource, "utf8").digest("hex");
  return hashes.includes(sourceHash);
}

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
  executeDescriptionForGlm(scriptPath, gameData, responderId) {
    const resolved = this.resolve(scriptPath);
    const sourceText = fs$1.readFileSync(resolved, "utf-8");
    const trusted = isTrustedGlmDescription(resolved, sourceText);
    const hasResponderId = responderId != null && String(responderId).trim() !== "";
    const capture = trusted && hasResponderId ? {} : null;
    const content = PromptScriptSandbox.executeDescription(resolved, { gameData, currentCharacterId: responderId }, sourceText, capture);
    const fallback = { content, profile: "", live: content };
    if (!capture?.items || String(capture.characterId) !== String(responderId)) return fallback;
    return { content, ...splitResponderCharacterProfile(content, responderId, capture.items) };
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
