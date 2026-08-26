"use strict";

function createTemplateEngine({ Handlebars, fs, path, promptsHelpersDir, defaultPromptsDir, PromptScriptSandbox }) {
  const fs$1 = fs;
  const VOTC_PROMPTS_HELPERS_DIR = promptsHelpersDir;
  const DEFAULT_USERDATA_DIR$1 = defaultPromptsDir;
  class TemplateEngine {
    constructor() {
      this.helpersRegistered = false;
    }
    ensureHelpers() {
      if (this.helpersRegistered) return;
      Handlebars.registerHelper("gt", (a, b) => a > b);
      Handlebars.registerHelper("lt", (a, b) => a < b);
      Handlebars.registerHelper("eq", (a, b) => a === b);
      Handlebars.registerHelper("ageDescription", (age) => {
        if (age < 3) return "infant";
        if (age < 6) return "small child";
        if (age < 10) return "child";
        if (age < 13) return "preteen";
        if (age < 16) return "adolescent";
        if (age < 20) return "young adult";
        if (age < 30) return "adult";
        if (age < 40) return "experienced adult";
        if (age < 60) return "seasoned adult";
        return "elder";
      });
      Handlebars.registerHelper("opinionLevel", (opinion) => {
        if (opinion > 60) return "very favorable";
        if (opinion > 20) return "positive";
        if (opinion > -20) return "neutral";
        if (opinion > -60) return "negative";
        return "hostile";
      });
      Handlebars.registerHelper("prowessDescription", (prowess) => {
        if (prowess >= 15) return "formidable warrior";
        if (prowess >= 10) return "skilled combatant";
        if (prowess >= 5) return "trained fighter";
        if (prowess > 0) return "inexperienced fighter";
        return "non-combatant";
      });
      Handlebars.registerHelper("goldStatus", (gold) => {
        if (gold >= 500) return "wealthy";
        if (gold > 100) return "comfortable";
        if (gold > 50) return "poor";
        if (gold > 0) return "struggling";
        if (gold === 0) return "broke";
        return "in debt";
      });
      Handlebars.registerHelper("filterTraits", (traits, category) => {
        if (!Array.isArray(traits)) return [];
        return traits.filter((t) => t.category === category);
      });
      Handlebars.registerHelper("otherCharacters", (characters, currentId) => {
        if (!characters || typeof characters.values !== "function") return [];
        return Array.from(characters.values()).filter((c) => c.id !== currentId);
      });
      Handlebars.registerHelper("formatRelations", (relations) => {
        if (!relations || relations.length === 0) return "";
        return relations.join(", ");
      });
      this.loadCustomHelpers();
      this.helpersRegistered = true;
    }
    renderTemplate(templatePath, context) {
      this.ensureHelpers();
      const resolved = path.resolve(templatePath);
      const content = fs$1.readFileSync(resolved, "utf-8");
      return this.renderTemplateString(content, context);
    }
    renderTemplateString(content, context) {
      this.ensureHelpers();
      const template = Handlebars.compile(content);
      const rootContext = {
        ...context.character || {},
        character: context.character,
        gameData: context.gameData,
        description: context.description,
        examples: context.examples,
        ...context
      };
      return template(rootContext, {
        allowProtoPropertiesByDefault: true,
        allowProtoMethodsByDefault: true
      });
    }
    /**
     * Validate a Handlebars template string without rendering it.
     * Returns validation result with error details if invalid.
     */
    static validateTemplate(templateString) {
      try {
        Handlebars.precompile(templateString);
        return { valid: true };
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        const lineMatch = errorMsg.match(/on line (\d+)/);
        const columnMatch = errorMsg.match(/column (\d+)/);
        return {
          valid: false,
          error: errorMsg,
          line: lineMatch ? parseInt(lineMatch[1]) : void 0,
          column: columnMatch ? parseInt(columnMatch[1]) : void 0
        };
      }
    }
    loadCustomHelpers() {
      const defaultHelpersDir = path.join(DEFAULT_USERDATA_DIR$1, "helpers");
      const userHelpersDir = VOTC_PROMPTS_HELPERS_DIR;
      const loadHelpersFromDir = (helpersDir) => {
        if (!fs$1.existsSync(helpersDir)) return;
        const helperFiles = fs$1.readdirSync(helpersDir).filter((file) => file.endsWith(".js"));
        for (const file of helperFiles) {
          try {
            const helperPath = path.join(helpersDir, file);
            PromptScriptSandbox.executeHelper(helperPath, Handlebars);
          } catch (error) {
            console.error(`Failed to load helper ${file}:`, error);
          }
        }
      };
      loadHelpersFromDir(defaultHelpersDir);
      loadHelpersFromDir(userHelpersDir);
    }
  }
  
  return TemplateEngine;
}

module.exports = { createTemplateEngine };
