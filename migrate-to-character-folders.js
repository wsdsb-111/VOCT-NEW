const fs = require('fs');
const path = require('path');

const SUMMARIES_DIR = path.join(process.env.APPDATA, 'VOTC', 'votc_data', 'conversation_summaries');

// Helper function to sanitize file names
function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

// Helper function to get character folder path
function getCharacterFolderPath(characterName) {
  const folderName = sanitizeFileName(characterName);
  return path.join(SUMMARIES_DIR, folderName);
}

// Helper function to get conversation file path
function getConversationFilePath(fromCharName, toCharName) {
  const fromFolder = getCharacterFolderPath(fromCharName);
  const toName = sanitizeFileName(toCharName);
  const fileName = `与${toName}的对话.json`;
  return path.join(fromFolder, fileName);
}

async function migrateToCharacterFolders() {
  console.log('开始迁移摘要到角色文件夹结构...');
  console.log(`摘要目录: ${SUMMARIES_DIR}`);
  
  if (!fs.existsSync(SUMMARIES_DIR)) {
    console.error(`错误: 摘要目录不存在: ${SUMMARIES_DIR}`);
    return;
  }
  
  const results = {
    migratedFiles: 0,
    migratedConversations: 0,
    errors: [],
    skippedFiles: 0
  };
  
  try {
    // Read all entries in the summaries directory
    const entries = fs.readdirSync(SUMMARIES_DIR, { withFileTypes: true });
    
    // Find all paired format files (id1_id2.json)
    const pairedFiles = entries.filter(dirent => 
      dirent.isFile() && 
      dirent.name.endsWith('.json') &&
      dirent.name.match(/^\d+_\d+\.json$/)
    );
    
    console.log(`找到 ${pairedFiles.length} 个配对格式的摘要文件`);
    
    for (const file of pairedFiles) {
      const filePath = path.join(SUMMARIES_DIR, file.name);
      
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const summaries = JSON.parse(fileContent);
        
        if (!Array.isArray(summaries) || summaries.length === 0) {
          console.log(`跳过空文件: ${file.name}`);
          results.skippedFiles++;
          continue;
        }
        
        // Extract character names from the first summary
        const firstSummary = summaries[0];
        const playerName = firstSummary.playerName;
        const characterName = firstSummary.characterName;
        const playerId = firstSummary.playerId;
        const characterId = firstSummary.characterId;
        
        if (!playerName || !characterName) {
          console.log(`跳过缺少角色名称的文件: ${file.name}`);
          results.errors.push(`${file.name}: 缺少角色名称`);
          results.skippedFiles++;
          continue;
        }
        
        console.log(`迁移对话: ${playerName} ↔ ${characterName} (${summaries.length} 条摘要)`);
        
        // Save to BOTH character folders
        // 1. Player's perspective
        const playerFile = getConversationFilePath(playerName, characterName);
        fs.mkdirSync(path.dirname(playerFile), { recursive: true });
        fs.writeFileSync(playerFile, JSON.stringify(summaries, null, '\t'));
        console.log(`  保存到: ${playerFile}`);
        
        // 2. Character's perspective (swap perspective in metadata)
        const characterPerspectiveSummaries = summaries.map(summary => ({
          ...summary,
          playerName: characterName,
          characterName: playerName,
          playerId: characterId,
          characterId: playerId
        }));
        
        const characterFile = getConversationFilePath(characterName, playerName);
        fs.mkdirSync(path.dirname(characterFile), { recursive: true });
        fs.writeFileSync(characterFile, JSON.stringify(characterPerspectiveSummaries, null, '\t'));
        console.log(`  保存到: ${characterFile}`);
        
        results.migratedFiles++;
        results.migratedConversations++;
        
        // Optional: Backup the old file before deleting
        const backupPath = filePath + '.backup';
        fs.copyFileSync(filePath, backupPath);
        console.log(`  备份原文件: ${backupPath}`);
        
      } catch (error) {
        console.error(`处理文件 ${file.name} 时出错:`, error);
        results.errors.push(`${file.name}: ${error.message}`);
      }
    }
    
    console.log('\n迁移完成!');
    console.log(`成功迁移: ${results.migratedFiles} 个文件`);
    console.log(`对话对数: ${results.migratedConversations}`);
    console.log(`跳过文件: ${results.skippedFiles}`);
    
    if (results.errors.length > 0) {
      console.log(`\n错误 (${results.errors.length}):`);
      results.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    // Ask user if they want to delete old files
    console.log('\n注意: 旧的配对格式文件已被备份为 .backup 文件');
    console.log('如果新格式工作正常，你可以手动删除这些 .backup 文件');
    
  } catch (error) {
    console.error('迁移失败:', error);
    throw error;
  }
}

// Run the migration
migrateToCharacterFolders()
  .then(() => {
    console.log('\n迁移脚本执行完成');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n迁移脚本失败:', error);
    process.exit(1);
  });
