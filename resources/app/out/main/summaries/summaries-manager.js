"use strict";

function createSummariesManager({ fs, path, summariesDir, memoryEngine, memorySystem }) {
  const fs$1 = fs;
  const VOTC_SUMMARIES_DIR = summariesDir;
  class SummariesManager {
    static writeSummaryJsonAtomic(filePath, summaries) {
      fs$1.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs$1.writeFileSync(tempPath, JSON.stringify(summaries, null, "\t"), "utf8");
      fs$1.renameSync(tempPath, filePath);
    }
    
    /**
     * List all summaries across all character folders with metadata
     * New format: character_name/与other_character的对话.json
     */
    static async listAllSummaries() {
      const results = [];
      try {
        if (!fs$1.existsSync(VOTC_SUMMARIES_DIR)) {
          return results;
        }
        
        // Read all entries in the summaries directory
        const entries = fs$1.readdirSync(VOTC_SUMMARIES_DIR, { withFileTypes: true });
        
        // Process character folders (new format)
        const characterFolders = entries.filter((dirent) => dirent.isDirectory());
        
        for (const folder of characterFolders) {
          const characterFolderName = folder.name;
          const characterFolderPath = path.join(VOTC_SUMMARIES_DIR, characterFolderName);
          
          try {
            // Read all conversation files in this character's folder
            const conversationFiles = fs$1.readdirSync(characterFolderPath).filter((file) => file.endsWith('.json'));
            
            for (const conversationFile of conversationFiles) {
              const filePath = path.join(characterFolderPath, conversationFile);
              
              try {
                const fileContent = fs$1.readFileSync(filePath, "utf8");
                const summaries = JSON.parse(fileContent);
                
                if (!Array.isArray(summaries) || summaries.length === 0) {
                  continue;
                }
                results.push(memorySystem.buildSummaryCatalogEntry({
                  folderName: characterFolderName,
                  conversationFile,
                  summaries,
                  filePath
                }));
              } catch (error) {
                console.error(`Failed to read summaries from ${filePath}:`, error);
              }
            }
          } catch (error) {
            console.error(`Failed to process character folder ${characterFolderName}:`, error);
          }
        }
        
      } catch (error) {
        console.error("Failed to list summaries:", error);
      }
      return results;
    }
    /**
     * Helper method to find summary file paths in character folder structure
     * Returns an object with both character perspectives' file paths
     */
    static findSummaryFilePath(playerId, characterId, playerName = null, characterName = null) {
      const result = {
        playerPerspectivePath: null,
        characterPerspectivePath: null
      };
      
      // Try new format: character folders
      if (playerName && characterName) {
        // We have names, so we can construct the exact paths
        const sanitize = (name) => name.replace(/[<>:"/\\|?*]/g, '_').trim();
        
        const playerFolder = path.join(VOTC_SUMMARIES_DIR, sanitize(playerName));
        const playerFile = path.join(playerFolder, `与${sanitize(characterName)}的对话.json`);
        if (fs$1.existsSync(playerFile)) {
          result.playerPerspectivePath = playerFile;
        }
        
        const characterFolder = path.join(VOTC_SUMMARIES_DIR, sanitize(characterName));
        const characterFile = path.join(characterFolder, `与${sanitize(playerName)}的对话.json`);
        if (fs$1.existsSync(characterFile)) {
          result.characterPerspectivePath = characterFile;
        }
      } else {
        // Try to search by scanning folders
        try {
          if (fs$1.existsSync(VOTC_SUMMARIES_DIR)) {
            const entries = fs$1.readdirSync(VOTC_SUMMARIES_DIR, { withFileTypes: true });
            const folders = entries.filter(dirent => dirent.isDirectory());
            
            for (const folder of folders) {
              const folderPath = path.join(VOTC_SUMMARIES_DIR, folder.name);
              const files = fs$1.readdirSync(folderPath).filter(f => f.endsWith('.json'));
              
              for (const file of files) {
                const filePath = path.join(folderPath, file);
                try {
                  const content = fs$1.readFileSync(filePath, "utf8");
                  const summaries = JSON.parse(content);
                  
                  if (Array.isArray(summaries) && summaries.length > 0) {
                    const summary = summaries[0];
                    
                    // Check if this file is for the requested conversation
                    if ((summary.playerId == playerId && summary.characterId == characterId) ||
                        (summary.playerId == characterId && summary.characterId == playerId)) {
                      
                      // Determine which perspective this file represents
                      if (summary.playerId == playerId) {
                        result.playerPerspectivePath = filePath;
                        if (!playerName) playerName = summary.playerName;
                        if (!characterName) characterName = summary.characterName;
                      } else {
                        result.characterPerspectivePath = filePath;
                        if (!playerName) playerName = summary.characterName;
                        if (!characterName) characterName = summary.playerName;
                      }
                    }
                  }
                } catch (error) {
                  console.error(`Failed to read ${filePath}:`, error);
                }
              }
            }
          }
        } catch (error) {
          console.error('Failed to search character folders:', error);
        }
      }
      
      return result;
    }
    
    /**
     * Get summaries for a specific Memory Engine 2.2 character conversation.
     */
    static async getSummariesForCharacter(playerId, characterId) {
      // Try new format first: look for character folders
      // The playerId could be a character name (folder name) or an ID
      const characterFolderPath = path.join(VOTC_SUMMARIES_DIR, playerId);
      
      if (fs$1.existsSync(characterFolderPath) && fs$1.statSync(characterFolderPath).isDirectory()) {
        // New format: look for conversation files in the character folder
        try {
          const conversationFiles = fs$1.readdirSync(characterFolderPath).filter((file) => file.endsWith('.json'));
          
          // Try to find a file that matches the characterId
          for (const file of conversationFiles) {
            const filePath = path.join(characterFolderPath, file);
            try {
              const fileContent = fs$1.readFileSync(filePath, "utf8");
              const summaries = JSON.parse(fileContent);
              
              if (Array.isArray(summaries) && summaries.length > 0) {
                // Check if this file is for the requested character
                const firstSummary = summaries[0];
                if (firstSummary.characterId == characterId || firstSummary.characterName === characterId) {
                  return summaries;
                }
              }
            } catch (error) {
              console.error(`Failed to read ${filePath}:`, error);
            }
          }
        } catch (error) {
          console.error(`Failed to read character folder ${characterFolderPath}:`, error);
        }
      }
      
      return [];
    }
    /**
     * Update a specific summary's content
     * Updates only the selected owner-folder record.
     */
    static async updateSummary(playerId, characterId, summaryIndex, newContent) {
      const paths = this.findSummaryFilePath(playerId, characterId);
      const filePath = paths.playerPerspectivePath;
      if (!filePath) {
        return { success: false, error: "Summary file not found" };
      }
      try {
        const summaries = JSON.parse(fs$1.readFileSync(filePath, "utf8"));
        if (!Array.isArray(summaries) || summaryIndex < 0 || summaryIndex >= summaries.length) return { success: false, error: "Invalid summary index" };
        summaries[summaryIndex].content = newContent;
        this.writeSummaryJsonAtomic(filePath, summaries);
        memoryEngine.invalidateSummaryFolderCache([playerId]);
        return { success: true };
      } catch (error) {
        console.error(`Failed to update summary for character ${characterId} from player ${playerId}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
    /**
     * Delete a specific summary
     * Deletes only the selected owner-folder record.
     */
    static async deleteSummary(playerId, characterId, summaryIndex) {
      const paths = this.findSummaryFilePath(playerId, characterId);
      const filePath = paths.playerPerspectivePath;
      if (!filePath) {
        return { success: false, error: "Summary file not found" };
      }
      try {
        const summaries = JSON.parse(fs$1.readFileSync(filePath, "utf8"));
        if (!Array.isArray(summaries) || summaryIndex < 0 || summaryIndex >= summaries.length) {
          return { success: false, error: "Invalid summary index" };
        }
        summaries.splice(summaryIndex, 1);
        if (summaries.length === 0) {
          fs$1.unlinkSync(filePath);
        } else {
          this.writeSummaryJsonAtomic(filePath, summaries);
        }
        memoryEngine.invalidateSummaryFolderCache([playerId]);
        return { success: true };
      } catch (error) {
        console.error(`Failed to delete summary for character ${characterId} from player ${playerId}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
    /**
     * Delete all summaries for a character conversation
     * Deletes only the selected owner-folder record.
     */
    static async deleteCharacterSummaries(playerId, characterId) {
      const paths = this.findSummaryFilePath(playerId, characterId);
      const filePath = paths.playerPerspectivePath;
      if (!filePath || !fs$1.existsSync(filePath)) {
        return { success: false, error: "No summary files found" };
      }
      try {
        fs$1.unlinkSync(filePath);
        memoryEngine.invalidateSummaryFolderCache([playerId]);
        return { success: true };
      } catch (error) {
        console.error(`Failed to delete owner summary file at ${filePath}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
    /**
     * Get a character name from canonical owner-folder summaries.
     */
    static async getCharacterNameFromFile(playerId, characterId) {
      // Find the summary file(s)
      const paths = this.findSummaryFilePath(playerId, characterId);
      
      // Try new format files first
      const filesToCheck = [];
      if (paths.playerPerspectivePath) {
        filesToCheck.push(paths.playerPerspectivePath);
      }
      if (paths.characterPerspectivePath) {
        filesToCheck.push(paths.characterPerspectivePath);
      }
      for (const filePath of filesToCheck) {
        try {
          if (fs$1.existsSync(filePath)) {
            const fileContent = fs$1.readFileSync(filePath, "utf8");
            const summaries = JSON.parse(fileContent);
            if (Array.isArray(summaries) && summaries.length > 0 && summaries[0].characterName) {
              return summaries[0].characterName;
            }
          }
        } catch (error) {
          console.error(`Failed to get character name from ${filePath}:`, error);
        }
      }
      
      return `Character ID: ${characterId}`;
    }
    
  }
  
  return SummariesManager;
}

module.exports = { createSummariesManager };
