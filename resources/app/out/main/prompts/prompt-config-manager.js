"use strict";

function createPromptConfigManager({ fs, path, hashPromptAsset, promptsDir, promptsSystemDir, promptsCharacterDir, promptsExamplesDir, promptsHelpersDir, defaultPromptsDir, defaultMainTemplatePath, defaultLetterTemplatePath, manifestName, manifestPath, manifestVersion, legacyChatInstruction, defaultChatInstruction, legacyBundledPromptHashes }) {
  const fs$1 = fs;
  const VOTC_PROMPTS_DIR = promptsDir;
  const VOTC_PROMPTS_SYSTEM_DIR = promptsSystemDir;
  const VOTC_PROMPTS_CHARACTER_DIR = promptsCharacterDir;
  const VOTC_PROMPTS_EXAMPLES_DIR = promptsExamplesDir;
  const VOTC_PROMPTS_HELPERS_DIR = promptsHelpersDir;
  const DEFAULT_USERDATA_DIR$1 = defaultPromptsDir;
  const DEFAULT_MAIN_TEMPLATE_PATH = defaultMainTemplatePath;
  const DEFAULT_LETTER_TEMPLATE_PATH = defaultLetterTemplatePath;
  const PROMPT_DEFAULTS_MANIFEST_NAME = manifestName;
  const PROMPT_DEFAULTS_MANIFEST_PATH = manifestPath;
  const PROMPT_DEFAULTS_MANIFEST_VERSION = manifestVersion;
  const LEGACY_CHAT_INSTRUCTION = legacyChatInstruction;
  const DEFAULT_CHAT_INSTRUCTION = defaultChatInstruction;
  const LEGACY_BUNDLED_PROMPT_HASHES = legacyBundledPromptHashes;
  class PromptConfigManager {
    ensurePromptDirs() {
      [VOTC_PROMPTS_DIR, VOTC_PROMPTS_SYSTEM_DIR, VOTC_PROMPTS_CHARACTER_DIR, VOTC_PROMPTS_EXAMPLES_DIR, VOTC_PROMPTS_HELPERS_DIR].forEach((dir) => fs$1.mkdirSync(dir, { recursive: true }));
    }
    /**
     * Seed bundled prompt assets without overwriting user customizations.
     * Files are copied when missing, or when their current hash still matches the
     * bundled hash recorded by the previous release. A modified file is treated
     * as a user override and is preserved.
     */
    seedDefaults() {
      this.ensurePromptDirs();
      if (!fs$1.existsSync(DEFAULT_USERDATA_DIR$1)) {
        return;
      }
      let previousManifest = { version: 0, files: {} };
      try {
        if (fs$1.existsSync(PROMPT_DEFAULTS_MANIFEST_PATH)) {
          const parsed = JSON.parse(fs$1.readFileSync(PROMPT_DEFAULTS_MANIFEST_PATH, "utf-8"));
          if (parsed && typeof parsed === "object" && parsed.files && typeof parsed.files === "object") {
            previousManifest = parsed;
          }
        }
      } catch (error) {
        console.warn("[PromptConfig] Could not read bundled-default manifest; preserving existing prompt files:", error);
      }
      const nextManifest = {
        version: PROMPT_DEFAULTS_MANIFEST_VERSION,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        files: {}
      };
      const copyRecursive = (src, dest, relativePath = "") => {
        if (!fs$1.existsSync(src)) return;
        const stat = fs$1.statSync(src);
        if (stat.isDirectory()) {
          fs$1.mkdirSync(dest, { recursive: true });
          for (const entry of fs$1.readdirSync(src)) {
            const childRelativePath = relativePath ? `${relativePath}/${entry}` : entry;
            copyRecursive(path.join(src, entry), path.join(dest, entry), childRelativePath);
          }
        } else {
          const normalizedPath = relativePath.replace(/\\/g, "/");
          const bundledContent = fs$1.readFileSync(src);
          const bundledHash = hashPromptAsset(bundledContent);
          nextManifest.files[normalizedPath] = bundledHash;
          if (!fs$1.existsSync(dest)) {
            fs$1.mkdirSync(path.dirname(dest), { recursive: true });
            fs$1.copyFileSync(src, dest);
            return;
          }
          const installedHash = hashPromptAsset(fs$1.readFileSync(dest));
          const previousBundledHash = previousManifest.files?.[normalizedPath];
          const knownLegacyHashes = LEGACY_BUNDLED_PROMPT_HASHES[normalizedPath] || [];
          const canSafelyMigrate = previousBundledHash ? installedHash === previousBundledHash : knownLegacyHashes.includes(installedHash);
          if (canSafelyMigrate && installedHash !== bundledHash) {
            fs$1.copyFileSync(src, dest);
          }
        }
      };
      copyRecursive(DEFAULT_USERDATA_DIR$1, VOTC_PROMPTS_DIR);
      try {
        fs$1.writeFileSync(PROMPT_DEFAULTS_MANIFEST_PATH, JSON.stringify(nextManifest, null, 2), "utf-8");
      } catch (error) {
        console.warn("[PromptConfig] Could not write bundled-default manifest:", error);
      }
    }
    listFiles(category) {
      let base = VOTC_PROMPTS_DIR;
      if (category === "system") base = VOTC_PROMPTS_SYSTEM_DIR;
      if (category === "character_description") base = VOTC_PROMPTS_CHARACTER_DIR;
      if (category === "example_messages") base = VOTC_PROMPTS_EXAMPLES_DIR;
      if (category === "helpers") base = VOTC_PROMPTS_HELPERS_DIR;
      const files = [];
      const walk = (dir) => {
        if (!fs$1.existsSync(dir)) return;
        for (const entry of fs$1.readdirSync(dir)) {
          if (entry === ".gitkeep" || entry === PROMPT_DEFAULTS_MANIFEST_NAME) continue;
          const full = path.join(dir, entry);
          const stat = fs$1.statSync(full);
          if (stat.isDirectory()) {
            walk(full);
          } else {
            files.push(path.relative(VOTC_PROMPTS_DIR, full).replace(/\\/g, "/"));
          }
        }
      };
      walk(base);
      return files;
    }
    readPromptFile(relativePath) {
      const full = path.join(VOTC_PROMPTS_DIR, relativePath);
      return fs$1.readFileSync(full, "utf-8");
    }
    savePromptFile(relativePath, content) {
      const full = path.join(VOTC_PROMPTS_DIR, relativePath);
      fs$1.mkdirSync(path.dirname(full), { recursive: true });
      fs$1.writeFileSync(full, content, "utf-8");
    }
    resolvePath(relativeOrAbsolute) {
      if (path.isAbsolute(relativeOrAbsolute)) return relativeOrAbsolute;
      return path.join(VOTC_PROMPTS_DIR, relativeOrAbsolute);
    }
    getDefaultMainTemplateContent() {
      const fallback = "You are a character in a medieval strategy game.";
      try {
        this.ensurePromptDirs();
        const fullPath = path.join(VOTC_PROMPTS_DIR, DEFAULT_MAIN_TEMPLATE_PATH);
        if (fs$1.existsSync(fullPath)) {
          return fs$1.readFileSync(fullPath, "utf-8");
        }
        const bundledDefault = path.join(DEFAULT_USERDATA_DIR$1, "system", "default.hbs");
        if (fs$1.existsSync(bundledDefault)) {
          return fs$1.readFileSync(bundledDefault, "utf-8");
        }
      } catch (error) {
        console.error("Failed to read default main template:", error);
      }
      return fallback;
    }
    generateBlockId(type) {
      return `${type}-${Math.random().toString(36).slice(2, 8)}`;
    }
    getDefaultBlocks() {
      return [
        {
          id: "main-system",
          type: "main",
          label: "Main System Prompt",
          enabled: true,
          role: "system",
          template: ""
        },
        {
          id: "character-description",
          type: "description",
          label: "Character Description (pList)",
          enabled: true,
          scriptPath: "character_description/standard/pListMccTest2.js"
        },
        {
          id: "example-messages",
          type: "examples",
          label: "Example Messages (AliChat)",
          enabled: true,
          scriptPath: "example_messages/standard/mccAliChat.js"
        },
        {
          id: "past-summaries",
          type: "past_summaries",
          label: "Past Conversation Summaries",
          enabled: true,
          template: ""
        },
        {
          id: "memories",
          type: "memories",
          label: "Memories",
          enabled: true,
          template: "相关记忆：\\n{{#each memories}}- {{this.creationDate}}：{{this.desc}}\\n{{/each}}",
          limit: 5
        },
        {
          id: "rolling-summary",
          type: "rolling_summary",
          label: "Rolling Summary",
          enabled: true,
          template: "此对话中较早消息的摘要：\\n{{summary}}"
        },
        {
          id: "history",
          type: "history",
          label: "Conversation History",
          enabled: true,
          pinned: true
        },
        {
          id: "instruction",
          type: "instruction",
          label: "Main Instruction",
          enabled: true,
          role: "user",
          template: DEFAULT_CHAT_INSTRUCTION
        }
      ];
    }
    getDefaultLetterBlocks() {
      return [
        {
          id: "letter-main-system",
          type: "main",
          label: "Letter System Prompt",
          enabled: true,
          role: "system",
          template: ""
        },
        {
          id: "letter-description",
          type: "description",
          label: "Letter Character Description (pList)",
          enabled: true,
          scriptPath: "character_description/letter/pListLetter.js"
        },
        {
          id: "letter-past-summaries",
          type: "past_summaries",
          label: "Past Conversation Summaries",
          enabled: true,
          template: ""
        },
        {
          id: "letter-memories",
          type: "memories",
          label: "All Memories",
          enabled: true,
          template: "所有记忆：\n{{#each memories}}- {{this.creationDate}}：{{this.desc}}\n{{/each}}"
        },
        {
          id: "letter-instruction",
          type: "instruction",
          label: "Letter Instruction",
          enabled: true,
          role: "user",
          template: '你收到了来自 {{player.fullName}} 的信件：\n"{{letter.content}}"\n仅以 {{character.fullName}} 的身份撰写回信。'
        }
      ];
    }
    mergeBlocks(defaults, incoming) {
      const cleanedIncoming = Array.isArray(incoming) ? incoming : [];
      const normalize = (block) => {
        const base = defaults.find((d) => d.id === block.id) || defaults.find((d) => d.type === block.type) || void 0;
        const template = block.template ?? base?.template;
        return {
          ...base,
          ...block,
          id: block.id || base?.id || this.generateBlockId(block.type),
          label: block.label || base?.label || block.type,
          enabled: block.enabled ?? base?.enabled ?? true,
          role: block.role || base?.role,
          template: block.type === "instruction" && template === LEGACY_CHAT_INSTRUCTION ? DEFAULT_CHAT_INSTRUCTION : template,
          scriptPath: block.scriptPath ?? base?.scriptPath,
          limit: block.limit ?? base?.limit,
          pinned: block.pinned ?? base?.pinned ?? false
        };
      };
      const merged = cleanedIncoming.map(normalize);
      defaults.forEach((d) => {
        const exists = merged.some((b) => b.id === d.id || b.type === d.type);
        if (!exists) {
          merged.push(d);
        }
      });
      return merged;
    }
    normalizeSettings(settings, options) {
      const defaults = options?.defaultBlocks || this.getDefaultBlocks();
      const defaultMainTemplate = options?.fallbackMainTemplate || this.getDefaultMainTemplateContent();
      const defaultPath = settings?.defaultMainTemplatePath || options?.defaultMainTemplatePath || DEFAULT_MAIN_TEMPLATE_PATH;
      let mainTemplate = settings?.mainTemplate;
      if (!mainTemplate) {
        const legacyPath = settings?.systemPromptTemplate || defaultPath;
        try {
          mainTemplate = this.readPromptFile(legacyPath);
        } catch {
          mainTemplate = defaultMainTemplate;
        }
      }
      const legacyDescScript = settings?.characterDescriptionScript;
      const legacyExamples = settings?.exampleMessagesScript;
      const legacySuffixEnabled = settings?.enableSuffixPrompt;
      const legacySuffixContent = settings?.suffixPrompt;
      let blocks = [];
      if (Array.isArray(settings?.blocks) && settings.blocks.length > 0) {
        blocks = this.mergeBlocks(defaults, settings.blocks);
      } else {
        blocks = this.getDefaultBlocks().map((b) => {
          if (b.type === "description" && legacyDescScript) {
            return { ...b, scriptPath: legacyDescScript };
          }
          if (b.type === "examples" && legacyExamples) {
            return { ...b, scriptPath: legacyExamples };
          }
          return b;
        });
      }
      const suffix = {
        enabled: legacySuffixEnabled ?? settings?.suffix?.enabled ?? false,
        template: legacySuffixContent ?? settings?.suffix?.template ?? "",
        label: settings?.suffix?.label || "Suffix"
      };
      return {
        mainTemplate,
        defaultMainTemplatePath: defaultPath,
        blocks,
        suffix
      };
    }
    getPresetsPath() {
      return path.join(VOTC_PROMPTS_DIR, "prompt-presets.json");
    }
    getPresets() {
      const presetsPath = this.getPresetsPath();
      if (!fs$1.existsSync(presetsPath)) {
        return [];
      }
      try {
        const raw = fs$1.readFileSync(presetsPath, "utf-8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.error("Failed to read prompt presets:", error);
        return [];
      }
    }
    savePreset(preset) {
      const presets = this.getPresets();
      const index = presets.findIndex((p) => p.id === preset.id);
      if (index >= 0) {
        presets[index] = preset;
      } else {
        presets.push(preset);
      }
      fs$1.mkdirSync(VOTC_PROMPTS_DIR, { recursive: true });
      fs$1.writeFileSync(this.getPresetsPath(), JSON.stringify(presets, null, 2), "utf-8");
      return preset;
    }
    deletePreset(id) {
      const presets = this.getPresets().filter((p) => p.id !== id);
      fs$1.mkdirSync(VOTC_PROMPTS_DIR, { recursive: true });
      fs$1.writeFileSync(this.getPresetsPath(), JSON.stringify(presets, null, 2), "utf-8");
    }
    getDefaultLetterMainTemplateContent() {
      const fallback = "Respond with a letter in-character. Do not perform actions.";
      try {
        this.ensurePromptDirs();
        const fullPath = path.join(VOTC_PROMPTS_DIR, DEFAULT_LETTER_TEMPLATE_PATH);
        if (fs$1.existsSync(fullPath)) {
          return fs$1.readFileSync(fullPath, "utf-8");
        }
        const bundledDefault = path.join(DEFAULT_USERDATA_DIR$1, "system", "letter.hbs");
        if (fs$1.existsSync(bundledDefault)) {
          return fs$1.readFileSync(bundledDefault, "utf-8");
        }
      } catch (error) {
        console.error("Failed to read default letter template:", error);
      }
      return fallback;
    }
  }
  
  return PromptConfigManager;
}

module.exports = { createPromptConfigManager };
