"use strict";

const { inferGenderFromPronoun } = require("./character");
const { createRelationshipResolver } = require("./relationship-resolver");
const { MEMORY_ENGINE_VERSION } = require("../version");

function createGameData({ fs, path, memorySystem, memoryEngine, summariesDir, getHistoricalReferenceByYear }) {
  const fs$1 = fs;
  const VOTC_SUMMARIES_DIR = summariesDir;
  function removeTooltip$2(text) {
    return text.replace(/<.*?>.*?<\/.*?>/gi, "").trim();
  }
  class GameData {
    constructor(data) {
      this.playerID = Number(data[0]), this.playerName = removeTooltip$2(data[1]), this.aiID = Number(data[2]), this.aiName = removeTooltip$2(data[3]), this.date = data[4], this.scene = data[5].substring(11), this.location = data[6], this.locationController = data[7], this.totalDays = Number(data[8]), this.characters = /* @__PURE__ */ new Map(), this.letterData = null;
      this.relationshipDiagnostics = [];
      this.relationshipDiagnosticKeys = /* @__PURE__ */ new Set();
      this.relationshipResolver = createRelationshipResolver({
        onDiagnostic: (diagnostic) => {
          const key = JSON.stringify({ ...diagnostic, recordedAt: void 0 });
          if (this.relationshipDiagnosticKeys.has(key)) return false;
          this.relationshipDiagnosticKeys.add(key);
          this.relationshipDiagnostics.push(diagnostic);
          if (this.relationshipDiagnostics.length > 100) this.relationshipDiagnostics.shift();
          return true;
        }
      });
      
      // 解析动态历史信息
      this.parseHistoricalContext();
    }
    
    /**
     * 解析当前游戏时间的历史背景信息
     * 注意：不使用硬编码的真实历史皇帝，而是从游戏实际数据获取
     */
    parseHistoricalContext() {
      // 从日期字符串提取年份，例如 "976年5月3日" -> 976
      const yearMatch = this.date.match(/(\d+)年/);
      this.year = yearMatch ? parseInt(yearMatch[1]) : 976;
      
      // 根据年份判断朝代
      if (this.year < 907) {
        this.dynasty = '唐朝';
      } else if (this.year < 960) {
        this.dynasty = '五代十国';
      } else if (this.year < 1127) {
        this.dynasty = '北宋';
      } else if (this.year < 1279) {
        this.dynasty = '南宋';
      } else {
        this.dynasty = '元朝';
      }
      
      // 当前皇帝、年号等信息从游戏中获取
      // 这些会在 characters 加载后更新
      this.currentEmperor = null;
      this.currentEmperorTitle = null;
      this.currentEraName = null;
      
      // 历史背景：根据年份提供真实历史的参考信息
      // 这些是"历史知识"，即使游戏中历史改变了，这些人物和事件仍作为背景知识存在
      this.historicalReferenceInfo = getHistoricalReferenceByYear(this.year);
    }
    
    /**
     * 根据年份返回真实历史的参考信息
     * 这些信息作为"历史知识背景"，帮助AI理解时代特征
     * 即使游戏中历史改变了，这些历史人物和事件仍然作为可能的知识存在
     * 
     * 涵盖时期：唐末(875年)至南宋灭亡(1279年)
     */
    updateCurrentEmperorInfo() {
      // 从游戏角色中查找皇帝
      // 皇帝通常有特定的标题，如"皇帝"、"陛下"等
      for (const char of this.characters.values()) {
        if (char.primaryTitle && (
          char.primaryTitle.includes('皇帝') || 
          char.primaryTitle.includes('天子') ||
          char.primaryTitle.includes('陛下')
        )) {
          this.currentEmperor = char.shortName;
          this.currentEmperorTitle = char.primaryTitle;
          break;
        }
      }
      
      // 如果找到了玩家是皇帝
      const player = this.getPlayer();
      if (player && player.primaryTitle && (
        player.primaryTitle.includes('皇帝') || 
        player.primaryTitle.includes('天子')
      )) {
        this.currentEmperor = player.shortName;
        this.currentEmperorTitle = player.primaryTitle;
      }
      
      // 年号通常在primaryTitle中，尝试提取
      // 例如："宋淳祐皇帝" -> "淳祐"
      if (this.currentEmperorTitle) {
        const eraMatch = this.currentEmperorTitle.match(/宋(.+?)皇帝/);
        if (eraMatch) {
          this.currentEraName = eraMatch[1];
        }
      }
    }
    
    getPlayer() {
      return this.characters.get(this.playerID);
    }
    /**
     * 
     * @return {Character} ai
     */
    getAi() {
      return this.characters.get(this.aiID);
    }
    // Helper function to generate safe folder/file names
    sanitizeFileName(name) {
      // Remove or replace characters that are invalid in filenames
      return name.replace(/[<>:"/\\|?*]/g, '_').trim();
    }
    getCharacterPersonalName(characterId, fallbackName = "") {
      const character = this.characters?.get(Number(characterId)) || { id: characterId, shortName: fallbackName };
      return memorySystem.getCharacterPersonalName(character, fallbackName);
    }
    
    // Helper function to get character folder path
    // IMPORTANT: Use character ID + short name (pure name without titles)
    // This ensures the same person always uses the same folder, even when titles change
    // Example: "62984_赵光义" (stable) instead of "宋淳祐皇帝，赵光义" (changes with title)
    getCharacterFolderPath(characterId, characterName) {
      const character = this.characters?.get(Number(characterId)) || { id: characterId, shortName: characterName };
      const folderName = memorySystem.getCharacterStorageDirectoryName(character, characterName);
      return path.join(VOTC_SUMMARIES_DIR, folderName);
    }
    
    // Helper function to get summary file path for a conversation
    getConversationFilePath(fromCharId, fromCharName, toCharId, toCharName) {
      const fromFolder = this.getCharacterFolderPath(fromCharId, fromCharName);
      const toName = this.sanitizeFileName(this.getCharacterPersonalName(toCharId, toCharName));
      const fileName = `与${toName}的对话.json`;
      return path.join(fromFolder, fileName);
    }
    
    /**
     * Load all conversation summaries for a character from their folder
     * This allows the character to remember conversations with other people
     */
    loadAllConversationsForCharacter(character) {
      const characterFolder = this.getCharacterFolderPath(character.id, character.shortName);
      
      // Initialize array to store all summaries from different conversations
      if (!character.allConversationSummaries) {
        character.allConversationSummaries = [];
      }
      
      try {
        if (!fs$1.existsSync(characterFolder)) {
          return;
        }
        
        // Read all conversation files in the character's folder
        const files = fs$1.readdirSync(characterFolder).filter(f => f.endsWith('.json'));
        
        for (const file of files) {
          const filePath = path.join(characterFolder, file);
          try {
            const fileContent = fs$1.readFileSync(filePath, 'utf8');
            const summaries = JSON.parse(fileContent);
            
            if (Array.isArray(summaries) && summaries.length > 0) {
              // Extract the other character's name from filename: "与XXX的对话.json"
              const match = file.match(/^与(.+)的对话\.json$/);
              const otherCharacterName = match ? match[1] : '未知角色';
              
              // Add recent summaries (last 5 from each conversation).
              const recentSummaries = summaries.slice(0, 5).map(s => ({
                ...s,
                conversationWith: otherCharacterName,
                sourceFile: file
              }));
              
              character.allConversationSummaries.push(...recentSummaries);
            }
          } catch (error) {
            console.error(`Failed to load summaries from ${filePath}:`, error);
          }
        }
        
        // Sort all summaries by date (most recent first)
        character.allConversationSummaries.sort((a, b) => {
          if (a.totalDays && b.totalDays) {
            return b.totalDays - a.totalDays;
          }
          return b.date.localeCompare(a.date);
        });
        
        // Keep only the most recent 5 summaries across all conversations
        character.allConversationSummaries = character.allConversationSummaries.slice(0, 5);
        
      } catch (error) {
        console.error(`Failed to load all conversations for character ${character.shortName}:`, error);
      }
    }
    
    /**
     * Dynamically load specific conversation summaries when mentioned in dialogue
     * Only loads summaries for characters mentioned by name in the conversation
     * @param {Character} character - The character whose memory to load
     * @param {string} mentionedCharacterName - Name of the character mentioned in conversation
     * @returns {Array} Array of summaries for the mentioned conversation
     */
    loadConversationWithMentionedCharacter(character, mentionedCharacterName) {
      const characterFolder = this.getCharacterFolderPath(character.id, character.shortName);
      
      // Initialize cache if not exists (use separate property for per-conversation cache)
      if (!character.conversationCache) {
        character.conversationCache = new Map();
      }
      
      // Return cached memory if already loaded
      if (character.conversationCache.has(mentionedCharacterName)) {
        return character.conversationCache.get(mentionedCharacterName);
      }
      
      try {
        if (!fs$1.existsSync(characterFolder)) {
          return [];
        }
        
        // Sanitize the mentioned character name for filename matching
        const sanitizedName = this.sanitizeFileName(mentionedCharacterName);
        const conversationFile = `与${sanitizedName}的对话.json`;
        const filePath = path.join(characterFolder, conversationFile);
        
        if (fs$1.existsSync(filePath)) {
          const fileContent = fs$1.readFileSync(filePath, 'utf8');
          const summaries = JSON.parse(fileContent);
          
          if (Array.isArray(summaries) && summaries.length > 0) {
            // Take the 5 most recent summaries for a directly mentioned person.
            const recentSummaries = summaries.slice(0, 5).map(s => ({
              ...s,
              conversationWith: mentionedCharacterName,
              sourceFile: conversationFile,
              dynamicallyLoaded: true
            }));
            
            // Cache the loaded summaries
            character.conversationCache.set(mentionedCharacterName, recentSummaries);
            
            console.log(`Dynamically loaded ${recentSummaries.length} summaries: ${character.shortName} ↔ ${mentionedCharacterName}`);
            
            return recentSummaries;
          }
        }
      } catch (error) {
        console.error(`Failed to dynamically load conversation ${character.shortName} ↔ ${mentionedCharacterName}:`, error);
      }
      
      return [];
    }
    
    /**
     * Detect mentioned character names in conversation history and load their memories
     * 
     * PERFORMANCE OPTIMIZATION (v5.1):
     * - Caches detection results to avoid re-scanning history
     * - Only re-scans when new player messages are added
     * 
     * @param {Array} history - Conversation history
     * @param {Character} character - The AI character
     * @returns {Array} Dynamically loaded summaries for mentioned characters
     */
    loadDynamicMemoriesFromHistory(history, character) {
      const dynamicMemories = [];
      
      // Performance optimization: Only check if history has at least 1 message
      if (!history || history.length === 0) {
        return dynamicMemories;
      }
      
      // Cache and scan the latest player messages, not merely the last array
      // entries. In a multi-NPC turn the player's line is quickly followed by
      // several assistant replies and would otherwise fall out of the window.
      const recentPlayerMessages = history.filter((m) => m.role === "user").slice(-3);
      const cacheKey = recentPlayerMessages.map(m => m.content || '').join('|');
      
      // Check if we've already processed this exact set of messages
      if (character.dynamicMemoryCache && character.dynamicMemoryCache.key === cacheKey) {
        console.log(`[Performance] Using cached dynamic memories (no new player messages)`);
        
        // Still need to update mentionedCharactersInContext for character info
        if (character.dynamicMemoryCache.mentionedCharacterIds) {
          if (!this.mentionedCharactersInContext) {
            this.mentionedCharactersInContext = new Set();
          }
          const mentionableProfiles = this.getMentionableCharacterProfiles();
          for (const id of character.dynamicMemoryCache.mentionedCharacterIds) {
            if (mentionableProfiles.has(id)) this.mentionedCharactersInContext.add(id);
          }
        }
        if (character.dynamicMemoryCache.mentionedNames) {
          if (!this.mentionedCharactersInContext) {
            this.mentionedCharactersInContext = new Set();
          }
          for (const name of character.dynamicMemoryCache.mentionedNames) {
            const char = this.getCharacterByName(name);
            if (char) {
              this.mentionedCharactersInContext.add(char.id);
            }
          }
        }
        
        return character.dynamicMemoryCache.memories || [];
      }
      
      console.log(`[Performance] Scanning for mentioned characters (new player messages detected)`);
      
      // CRITICAL FIX: Only get names of characters who have conversation files
      // Don't iterate through ALL characters in the game (could be hundreds!)
      // Check BOTH character's folder AND player's folder for conversation files
      const characterFolder = this.getCharacterFolderPath(character.id, character.shortName);
      const player = this.characters.get(this.playerID);
      const playerFolder = player ? this.getCharacterFolderPath(this.playerID, player.shortName) : null;
      
      let relevantCharacterNames = new Set();
      
      try {
        // 1. Check character's folder (AI's conversations)
        if (fs$1.existsSync(characterFolder)) {
          const files = fs$1.readdirSync(characterFolder).filter(f => f.endsWith('.json'));
          files.forEach(file => {
            const match = file.match(/^与(.+)的对话\.json$/);
            if (match) relevantCharacterNames.add(match[1]);
          });
        }
        
        // 2. Check player's folder (Player's conversations)
        if (playerFolder && fs$1.existsSync(playerFolder)) {
          const files = fs$1.readdirSync(playerFolder).filter(f => f.endsWith('.json'));
          files.forEach(file => {
            const match = file.match(/^与(.+)的对话\.json$/);
            if (match) relevantCharacterNames.add(match[1]);
          });
        }
        
        // Convert Set to Array
        relevantCharacterNames = Array.from(relevantCharacterNames);
        
        console.log(`[Performance] Only checking ${relevantCharacterNames.length} characters with conversation history (instead of all ${this.characters.size} characters)`);
      } catch (error) {
        console.error('Failed to read character folders:', error);
        return dynamicMemories;
      }
      
      // If no relevant characters found, cache and return early
      if (relevantCharacterNames.length === 0) {
        // No conversation memories are available, but a mentioned third person
        // can still have useful CK3 family/relationship data.
        const mentionedCharacterIds = this.findMentionedCharacterIdsInHistory(history, character);
        if (!this.mentionedCharactersInContext) {
          this.mentionedCharactersInContext = new Set();
        }
        for (const id of mentionedCharacterIds) {
          this.mentionedCharactersInContext.add(id);
        }
        if (!character.dynamicMemoryCache) {
          character.dynamicMemoryCache = {};
        }
        character.dynamicMemoryCache = {
          key: cacheKey,
          memories: [],
          mentionedNames: [],
          mentionedCharacterIds: Array.from(mentionedCharacterIds)
        };
        return dynamicMemories;
      }
      
      // Check the latest player messages. This keeps third-party mentions
      // available to every NPC responding in the same turn.
      const recentMessages = recentPlayerMessages;
      const mentionedCharacters = new Set();
      
      for (const message of recentMessages) {
        if (!message.content) continue;
        
        // Performance optimization: Only check player messages (not AI responses)
        if (message.role !== 'user') continue;
        
        // Check if any relevant character name is mentioned
        for (const charName of relevantCharacterNames) {
          if (message.content.includes(charName)) {
            mentionedCharacters.add(charName);
          }
        }
      }
      
      // Load summaries for each mentioned character
      // Try loading from BOTH character's folder AND player's folder
      if (mentionedCharacters.size > 0) {
        console.log(`Detected mentioned characters: ${Array.from(mentionedCharacters).join(', ')}`);
        
        for (const mentionedName of mentionedCharacters) {
          // Try loading from character's folder first
          let summaries = this.loadConversationWithMentionedCharacter(character, mentionedName);
          
          if (summaries.length > 0) {
            dynamicMemories.push(...summaries);
          }
          
          // 【新增】标记提到的角色为"上下文相关"
          // 这样在构建prompt时，可以包含这些角色的完整信息
          const mentionedChar = this.getCharacterByName(mentionedName);
          if (mentionedChar) {
            if (!this.mentionedCharactersInContext) {
              this.mentionedCharactersInContext = new Set();
            }
            this.mentionedCharactersInContext.add(mentionedChar.id);
            console.log(`Marked character ${mentionedName} (ID: ${mentionedChar.id}) as contextually relevant`);
          }
        }
      }
      
      // PERFORMANCE: Cache the result
      // Relationship context must not depend on whether this third character has
      // an existing conversation-summary file. Memories stay selectively loaded
      // above, while game-data relationships are detected from all loaded CK3
      // characters here.
      const mentionedCharacterIds = this.findMentionedCharacterIdsInHistory(history, character);
      if (!this.mentionedCharactersInContext) {
        this.mentionedCharactersInContext = new Set();
      }
      for (const id of mentionedCharacterIds) {
        this.mentionedCharactersInContext.add(id);
      }
      if (!character.dynamicMemoryCache) {
        character.dynamicMemoryCache = {};
      }
      character.dynamicMemoryCache = {
        key: cacheKey,
        memories: dynamicMemories,
        mentionedNames: Array.from(mentionedCharacters),
        mentionedCharacterIds: Array.from(mentionedCharacterIds)
      };
      
      return dynamicMemories;
    }
    
    loadCharactersSummaries() {
      // 更新当前皇帝信息（从游戏角色中获取实际的当前皇帝）
      this.updateCurrentEmperorInfo();
      
      const player = this.characters.get(this.playerID);
      const playerName = player ? player.shortName : null;
      
      for (const character of this.characters.values()) {
        // Skip loading summaries for the player character itself
        if (character.id === this.playerID) continue;
        
        // Load summaries from player's perspective (A ↔ B conversation)
        const summaryFile = this.getConversationFilePath(
          this.playerID,
          playerName,
          character.id,
          character.shortName
        );
        
        character.loadSummaries(summaryFile);
        
        // ❌ 不再自动加载所有跨角色对话
        // 改为：只在对话中提到其他角色时动态加载
        // this.loadAllConversationsForCharacter(character);
        
        // Initialize dynamic memory caches
        // conversationCache: Map for caching individual conversations
        // dynamicMemoryCache: Object for caching scan results
        if (!character.conversationCache) {
          character.conversationCache = new Map();
        }
        if (!character.dynamicMemoryCache) {
          character.dynamicMemoryCache = {};
        }
      }
      
      // Initialize mentioned characters tracking
      this.mentionedCharactersInContext = new Set();
    }
    
    /**
     * 通过名字查找角色（支持shortName和fullName）
     * @param {string} name - 角色名字
     * @returns {Character|null} - 找到的角色或null
     */
    getCharacterByName(name) {
      for (const char of this.characters.values()) {
        if (char.fullName === name || char.shortName === name || char.firstName === name) {
          return char;
        }
      }
      return null;
    }
    /**
     * Build lightweight profiles for both active participants and their directly
     * logged parents, children, and siblings. Relatives do not become speakers or
     * action targets; their profiles are used only for mentioned-person context.
     */
    getMentionableCharacterProfiles() {
      const resolver = this.relationshipResolver || createRelationshipResolver();
      const profiles = resolver.buildCanonicalProfiles(this.characters, this.totalDays, inferGenderFromPronoun);
      const addRelationAliases = (characterId, aliases) => {
        const profile = profiles.get(Number(characterId));
        if (!profile) return;
        profile.mentionAliases = [...new Set([...(profile.mentionAliases || []), ...aliases])];
      };
      for (const participant of this.characters.values()) {
        for (const parent of participant.parents || []) {
          const gender = profiles.get(Number(parent.id))?.gender || "unknown";
          addRelationAliases(parent.id, gender === "male" ? ["令尊", "家父", "父亲"] : gender === "female" ? ["令堂", "家母", "母亲"] : ["父母"]);
        }
        for (const sibling of participant.siblings || []) {
          const siblingProfile = profiles.get(Number(sibling.id));
          const participantProfile = profiles.get(Number(participant.id)) || participant;
          const resolution = resolver.resolveSiblingKinship(siblingProfile, participantProfile);
          if (resolution?.label === "哥哥") addRelationAliases(sibling.id, ["家兄", "兄长"]);
          else if (resolution?.label === "姐姐") addRelationAliases(sibling.id, ["家姐", "姐姐"]);
          else if (resolution?.label === "年长手足") addRelationAliases(sibling.id, ["年长手足"]);
        }
      }
      return profiles;
    }
    /**
     * Find third-party characters mentioned by any speaker. This intentionally
     * scans active CK3 characters and their directly logged relatives instead of
     * only summary-file names: relationship data exists even when nobody has
     * previously talked to the mentioned person.
     */
    getMentionExclusionIds(activeParticipantIds = null) {
      const participantIds = Array.isArray(activeParticipantIds) ? activeParticipantIds : [...this.characters.keys()];
      return [...new Set([this.playerID, ...participantIds].map(Number).filter(Number.isFinite))];
    }
    findMentionedCharacterIdsInHistory(history, activeCharacter, excludedCharacterIds = null) {
      if (!Array.isArray(history) || history.length === 0) return /* @__PURE__ */ new Set();
      const exclusions = this.getMentionExclusionIds(
        Array.isArray(excludedCharacterIds) ? [activeCharacter?.id, ...excludedCharacterIds] : null
      );
      return new Set(memoryEngine.findMentionedCharactersInHistory({
        history,
        candidates: [...this.getMentionableCharacterProfiles().values()],
        excludedIds: exclusions
      }));
    }
    findFamilyEntry(entries, characterId) {
      return (this.relationshipResolver || createRelationshipResolver()).findFamilyEntry(entries, characterId);
    }
    /** Return a precise sibling title for subject relative to other. */
    getSiblingRelation(subject, other) {
      const resolver = this.relationshipResolver || createRelationshipResolver();
      const profiles = typeof this.getMentionableCharacterProfiles === "function" ? this.getMentionableCharacterProfiles() : new Map(this.characters || []);
      return resolver.resolveSiblingKinship(profiles.get(Number(subject?.id)) || subject, profiles.get(Number(other?.id)) || other)?.label || null;
    }
    /**
     * Describe subject's relationship to other using parsed family data first.
     * CK3's plain relation string often only says "brother", so siblings are
     * resolved with birth date (and age as a fallback) before using that string.
     */
    describeCharacterRelationship(subject, other) {
      if (!subject || !other || subject.id === other.id) return null;
      const resolver = this.relationshipResolver || createRelationshipResolver();
      const profiles = typeof this.getMentionableCharacterProfiles === "function" ? this.getMentionableCharacterProfiles() : new Map(this.characters || []);
      const canonicalSubject = profiles.get(Number(subject.id)) || subject;
      const canonicalOther = profiles.get(Number(other.id)) || other;
      const kinship = resolver.resolveDirectKinship(canonicalSubject, canonicalOther);
      if (kinship) return `${canonicalSubject.fullName}是${canonicalOther.fullName}的${kinship.label}`;
      const direct = subject.relationsToCharacters?.find((relation) => relation.id === other.id)?.relations || [];
      if (direct.length > 0) return `${subject.fullName}与${other.fullName}的游戏关系：${direct.join("、")}`;
      if (other.id === this.playerID && subject.relationsToPlayer?.length > 0) {
        return `${subject.fullName}与${other.fullName}的游戏关系：${subject.relationsToPlayer.join("、")}`;
      }
      const reverse = other.relationsToCharacters?.find((relation) => relation.id === subject.id)?.relations || [];
      if (reverse.length > 0) return `${other.fullName}与${subject.fullName}的游戏关系：${reverse.join("、")}`;
      return null;
    }
    /**
     * The age-resolved sibling wording was previously emitted only for a third
     * character mentioned in the dialogue. The active pair therefore still saw
     * CK3's ambiguous raw `brother` / `sister` relation in the main prompt.
    */
    getActiveParticipantRelationshipInfo(activeCharacter, counterpartIds = []) {
      if (!activeCharacter) return "";
      const counterpartIdSet = /* @__PURE__ */ new Set([this.playerID, ...counterpartIds]);
      counterpartIdSet.delete(activeCharacter.id);
      const sections = [];
      const resolver = this.relationshipResolver || createRelationshipResolver();
      const mentionableProfiles = typeof this.getMentionableCharacterProfiles === "function" ? this.getMentionableCharacterProfiles() : new Map(this.characters || []);
      const getOpinion = (subject, other) => {
        if (Number(other.id) === Number(this.playerID) && subject.opinionOfPlayer != null && Number.isFinite(Number(subject.opinionOfPlayer))) return Number(subject.opinionOfPlayer);
        const entry = subject.opinions?.find((opinion) => Number(opinion.id) === Number(other.id));
        const value = entry?.opinion ?? entry?.opinon;
        return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
      };
      const getFormalRelations = (subject, other) => {
        const direct = subject.relationsToCharacters?.find((relation) => Number(relation.id) === Number(other.id))?.relations || [];
        if (direct.length > 0) return direct.join("、");
        if (Number(other.id) === Number(this.playerID) && subject.relationsToPlayer?.length > 0) return subject.relationsToPlayer.join("、");
        return "无明确正式关系";
      };
      const getKinship = (subject, other) => {
        const canonicalSubject = mentionableProfiles.get(Number(subject.id)) || subject;
        const canonicalOther = mentionableProfiles.get(Number(other.id)) || other;
        const resolution = resolver.resolveDirectKinship(canonicalSubject, canonicalOther);
        return resolution ? `${canonicalSubject.fullName}是${canonicalOther.fullName}的${resolution.label}` : "无";
      };
      for (const counterpartId of counterpartIdSet) {
        const counterpart = this.characters.get(counterpartId);
        if (!counterpart) continue;
        const activeOpinion = getOpinion(activeCharacter, counterpart);
        const counterpartOpinion = getOpinion(counterpart, activeCharacter);
        sections.push([
          `【${activeCharacter.fullName} ↔ ${counterpart.fullName}】`,
          `- 正式关系（${activeCharacter.fullName}视角）：${getFormalRelations(activeCharacter, counterpart)}`,
          `- 亲属关系（${activeCharacter.fullName}相对${counterpart.fullName}）：${getKinship(activeCharacter, counterpart)}`,
          `- 正式关系（${counterpart.fullName}视角）：${getFormalRelations(counterpart, activeCharacter)}`,
          `- 亲属关系（${counterpart.fullName}相对${activeCharacter.fullName}）：${getKinship(counterpart, activeCharacter)}`,
          `- 当前好感（${activeCharacter.fullName}对${counterpart.fullName}）：${activeOpinion == null ? "未提供" : activeOpinion}`,
          `- 当前好感（${counterpart.fullName}对${activeCharacter.fullName}）：${counterpartOpinion == null ? "未提供" : counterpartOpinion}`
        ].join("\n"));
      }
      if (sections.length === 0) return "";
      return `=== 全部当前在场人物关系权威层（高优先级当前 CK3 数据） ===\n${sections.join("\n")}\n权威规则：正式关系与好感数值必须分开理解；好感高低不能改写亲属、配偶、恋人、朋友、敌对等正式关系。当前 CK3 数据表示现在，摘要/记忆只表示过去；发生冲突时以当前 CK3 正式关系和好感为准。称谓必须服从亲属关系与长幼，不得把哥哥称为弟弟、把姐姐称为妹妹。`;
    }
    
    /**
     * 获取提到的角色的详细信息（用于添加到prompt上下文）
     * @returns {string} - 格式化的角色信息字符串
     */
    getMentionedCharactersInfo(activeCharacter) {
      if (!this.mentionedCharactersInContext || this.mentionedCharactersInContext.size === 0) {
        return '';
      }
      
      const player = this.characters.get(this.playerID);
      const dialoguePartner = activeCharacter || this.characters.get(this.aiID);
      const mentionableProfiles = this.getMentionableCharacterProfiles();
      
      let info = '\n=== 对话中提到的其他角色信息 ===\n\n';
      
      for (const charId of this.mentionedCharactersInContext) {
        const char = mentionableProfiles.get(charId);
        if (!char || charId === this.playerID || charId === dialoguePartner?.id) continue;
        
        info += `【${char.fullName}】\n`;
        if (Number.isFinite(char.age)) info += `- 年龄：${char.age}岁\n`;
        info += `- 性别：${char.gender === 'male' ? '男性' : char.gender === 'female' ? '女性' : '未知'}\n`;
        
        if (char.primaryTitle) {
          info += `- 头衔：${char.primaryTitle}\n`;
        }
        
        // 特质（最多显示5个）
        if (char.traits && char.traits.length > 0) {
          const traitNames = char.traits.slice(0, 5).map(t => t.name).join('、');
          info += `- 性格特质：${traitNames}\n`;
        }
        
        // With both participants. Do not assume GameData.aiID is the current
        // responder: one conversation can generate replies for several NPCs.
        if (player) {
          const relation = this.describeCharacterRelationship(char, player);
          if (relation) info += `- 与${player.fullName}的关系：${relation}\n`;
        }
        
        if (dialoguePartner && dialoguePartner.id !== this.playerID) {
          const relation = this.describeCharacterRelationship(char, dialoguePartner);
          if (relation) info += `- 与${dialoguePartner.fullName}的关系：${relation}\n`;
        }
        
        // 配偶
        if (char.consort) {
          info += `- 配偶：${char.consort}\n`;
        }
        
        // 领主
        if (char.liege) {
          info += `- 领主：${char.liege}\n`;
        }
        
        info += '\n';
      }
      
      console.log(`Built mentioned characters info for ${this.mentionedCharactersInContext.size} character(s)`);
      return info;
    }
    
    saveCharacterSummary(characterId, summary) {
      const target = this.characters.get(characterId);
      if (!target) return;
      
      const player = this.characters.get(this.playerID);
      const playerName = player ? player.shortName : null;
      
      const summaryWithMetadata = {
        ...summary,
        characterName: target.shortName,
        playerName: playerName || `角色 ${this.playerID}`,
        playerId: this.playerID,
        characterId: characterId
      };
      
      target.conversationSummaries.unshift(summaryWithMetadata);
      
      // Save to BOTH character folders for memory sharing
      // 1. Save to player's folder (player's perspective of conversation with target)
      const playerFile = this.getConversationFilePath(
        this.playerID,
        playerName,
        characterId,
        target.shortName
      );
      fs$1.mkdirSync(path.dirname(playerFile), { recursive: true });
      target.saveSummaries(playerFile);
      
      // 2. Save to target character's folder (target's perspective of conversation with player)
      // Need to swap the perspective in metadata
      const targetFile = this.getConversationFilePath(
        characterId,
        target.shortName,
        this.playerID,
        playerName
      );
      fs$1.mkdirSync(path.dirname(targetFile), { recursive: true });
      
      // Create a swapped version for target's perspective
      const swappedSummaries = target.conversationSummaries.map(s => ({
        ...s,
        playerName: s.characterName,
        characterName: s.playerName,
        playerId: s.characterId,
        characterId: s.playerId
      }));
      
      fs$1.writeFileSync(targetFile, JSON.stringify(swappedSummaries, null, "\t"));
    }
    
    readConversationSummariesFile(filePath) {
      try {
        if (!fs$1.existsSync(filePath)) return [];
        const parsed = JSON.parse(fs$1.readFileSync(filePath, "utf8"));
        return Array.isArray(parsed) ? parsed.map((summary) => memorySystem.normalizeSummaryRecord(summary)) : [];
      } catch (error) {
        console.error(`[Summary] Failed to read ${filePath}; existing file was left untouched:`, error);
        return null;
      }
    }
    writeConversationSummariesFile(filePath, summaries) {
      fs$1.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs$1.writeFileSync(tempPath, JSON.stringify(summaries, null, "\t"), "utf8");
      fs$1.renameSync(tempPath, filePath);
    }
    saveSummaryForDirectedPair(owner, other, finalSummary, participantMetadata, options = {}) {
      const filePath = this.getConversationFilePath(owner.id, owner.shortName, other.id, other.shortName);
      const ownerName = this.getCharacterPersonalName(owner.id, owner.shortName);
      const otherName = this.getCharacterPersonalName(other.id, other.shortName);
      fs$1.mkdirSync(path.dirname(filePath), { recursive: true });
      const summaries = this.readConversationSummariesFile(filePath);
      if (!summaries) throw new Error(`summary_file_read_failed:${filePath}`);
      const projectionKey = `${Number(owner.id)}->${Number(other.id)}`;
      const projection = options.directedSummaries instanceof Map
        ? options.directedSummaries.get(projectionKey)
        : options.directedSummaries?.[projectionKey];
      if (options.directedSummaries && !projection) throw new Error(`missing_directed_summary_projection:${projectionKey}`);
      const directedContent = projection?.content || finalSummary;
      const alreadySaved = summaries.some((summary) => options.finalizationId ? summary.finalizationId === options.finalizationId : summary.totalDays === this.totalDays && summary.content === directedContent && summary.playerId === owner.id && summary.characterId === other.id);
      if (!alreadySaved) {
        summaries.unshift({
          schemaVersion: memorySystem.CURRENT_SUMMARY_SCHEMA_VERSION,
          date: options.date ?? this.date,
          totalDays: options.totalDays ?? this.totalDays,
          content: directedContent,
          playerName: ownerName,
          playerId: owner.id,
          characterName: otherName,
          characterId: other.id,
          conversationType: participantMetadata.length > 2 ? "group" : "pair",
          participants: participantMetadata,
          finalizationId: options.finalizationId || null,
          engineVersion: projection ? MEMORY_ENGINE_VERSION : "2.2",
          perspectiveOwnerId: projection?.ownerId ?? owner.id,
          perspectiveMemoryIds: projection?.memoryIds || [],
          perspectiveSummarySegmentIds: projection?.summarySegmentIds || [],
          projectionHash: projection?.projectionHash || null,
          presenceJoins: Array.isArray(options.presenceJoins) ? options.presenceJoins : [],
          presenceLeaves: Array.isArray(options.presenceLeaves) ? options.presenceLeaves : [],
          pinned: projection?.pinned === true,
          open: projection?.open === true
        });
        this.writeConversationSummariesFile(filePath, summaries);
      }
      return summaries;
    }
    /**
     * Save one generated summary to every directed participant pair. This keeps
     * A↔B compatibility while adding A↔C, B↔C, and all other group pair files
     * without making extra LLM summary requests.
     */
    saveCharactersSummaries(finalSummary, participantIds = null, options = {}) {
      const excludedOwnerIds = new Set((options.excludedOwnerIds || []).map(Number).filter(Number.isFinite));
      const requestedIds = Array.isArray(participantIds) ? participantIds : Array.from(this.characters.keys());
      const participants = memorySystem.resolveSummaryParticipants({
        playerId: options.directedSummaries ? requestedIds[0] : this.playerID,
        participantIds: requestedIds,
        currentCharacters: this.characters,
        participantProfiles: options.participantProfiles
      });
      if (participants.length < 2) {
        return { success: false, error: "insufficient_summary_participants", participantCount: participants.length };
      }
      const participantMetadata = participants.map((character) => ({
        id: character.id,
        name: this.getCharacterPersonalName(character.id, character.shortName),
        firstName: character.firstName,
        shortName: this.getCharacterPersonalName(character.id, character.shortName),
        fullName: character.fullName,
        primaryTitle: character.primaryTitle,
        heldCourtAndCouncilPositions: character.heldCourtAndCouncilPositions,
        titleRankConcept: character.titleRankConcept
      }));
      const directedPairs = memorySystem.buildDirectedParticipantPairs(participants, excludedOwnerIds);
      for (const { owner, counterpart } of directedPairs) {
        const summaries = this.saveSummaryForDirectedPair(owner, counterpart, finalSummary, participantMetadata, options);
        // Keep the in-memory compatibility field synchronized for extensions;
        // Engine 2.2 reads the canonical owner folders directly for prompts.
        if (owner.id === this.playerID) counterpart.conversationSummaries = summaries;
      }
      const verification = memorySystem.verifyDirectedSummaryPersistence({
        directedPairs,
        finalizationId: options.finalizationId,
        requirePerspective: options.directedSummaries instanceof Map,
        getFilePath: (owner, counterpart) => this.getConversationFilePath(owner.id, owner.shortName, counterpart.id, counterpart.shortName),
        readSummaries: (filePath) => this.readConversationSummariesFile(filePath)
      });
      if (!verification.success) {
        throw new Error(`${verification.error}:${verification.missingPairs.map((pair) => `${pair.ownerId}->${pair.counterpartId}`).join(",")}`);
      }
      const directedFilesWritten = directedPairs.length;
      console.log(`[Summary] Saved finalization ${options.finalizationId || "untracked"} for ${participants.length} participants across ${directedFilesWritten} directed pair files`);
      return { success: true, participantCount: participants.length, directedFilesWritten };
    }
  }
  
  return GameData;
}

module.exports = { createGameData };
