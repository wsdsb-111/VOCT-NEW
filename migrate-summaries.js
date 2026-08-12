/**
 * 摘要格式迁移脚本
 * 将旧格式 (playerId/characterId.json) 迁移到新格式 (id1_id2.json)
 */

const fs = require('fs');
const path = require('path');

// 获取用户数据目录 - 使用正确的应用名称
// Windows: C:\Users\{用户名}\AppData\Roaming\Voices of the Court
const userDataPath = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.local/share');
const VOTC_SUMMARIES_DIR = path.join(userDataPath, 'Voices of the Court', 'votc_data', 'conversation_summaries');

console.log('==========================================');
console.log('摘要格式迁移工具');
console.log('==========================================');
console.log('');
console.log('摘要目录:', VOTC_SUMMARIES_DIR);
console.log('');

// Helper function to generate conversation pair key
function getConversationPairKey(characterId1, characterId2) {
  const id1 = Number(characterId1);
  const id2 = Number(characterId2);
  return id1 < id2 ? `${id1}_${id2}` : `${id2}_${id1}`;
}

async function migrateSummaries() {
  const results = {
    success: false,
    migratedFiles: 0,
    mergedPairs: 0,
    errors: [],
    skippedFiles: 0
  };

  try {
    if (!fs.existsSync(VOTC_SUMMARIES_DIR)) {
      console.error('错误: 摘要目录不存在');
      return results;
    }

    // Get all subdirectories (old format playerID directories)
    const entries = fs.readdirSync(VOTC_SUMMARIES_DIR, { withFileTypes: true });
    const playerDirs = entries.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);

    if (playerDirs.length === 0) {
      console.log('没有找到旧格式目录');
      results.success = true;
      return results;
    }

    console.log(`找到 ${playerDirs.length} 个玩家目录需要迁移`);
    console.log('');

    // Track which pairs we've already processed
    const pairSummaries = new Map();

    // First pass: collect all summaries by pair key
    console.log('第一阶段: 收集摘要...');
    for (const playerId of playerDirs) {
      const playerPath = path.join(VOTC_SUMMARIES_DIR, playerId);

      try {
        const characterFiles = fs.readdirSync(playerPath).filter(file => file.endsWith('.json'));

        for (const characterFile of characterFiles) {
          const characterId = path.basename(characterFile, '.json');
          const oldFilePath = path.join(playerPath, characterFile);

          try {
            const fileContent = fs.readFileSync(oldFilePath, 'utf8');
            const summaries = JSON.parse(fileContent);

            if (!Array.isArray(summaries) || summaries.length === 0) {
              results.skippedFiles++;
              continue;
            }

            const pairKey = getConversationPairKey(playerId, characterId);

            if (!pairSummaries.has(pairKey)) {
              pairSummaries.set(pairKey, []);
            }

            for (const summary of summaries) {
              pairSummaries.get(pairKey).push({
                ...summary,
                _sourcePlayerId: playerId,
                _sourceCharacterId: characterId
              });
            }

            console.log(`  ✓ 从 ${playerId}/${characterId} 收集了 ${summaries.length} 条摘要 (配对: ${pairKey})`);

          } catch (error) {
            results.errors.push(`读取失败 ${oldFilePath}: ${error.message}`);
            console.error(`  ✗ 读取失败 ${oldFilePath}:`, error.message);
          }
        }
      } catch (error) {
        results.errors.push(`处理目录失败 ${playerId}: ${error.message}`);
        console.error(`  ✗ 处理目录失败 ${playerId}:`, error.message);
      }
    }

    console.log('');
    console.log(`收集完成! 找到 ${pairSummaries.size} 个角色配对`);
    console.log('');

    // Second pass: merge and write to new format
    console.log('第二阶段: 合并并写入新格式...');
    for (const [pairKey, allSummaries] of pairSummaries.entries()) {
      const newFormatPath = path.join(VOTC_SUMMARIES_DIR, `${pairKey}.json`);

      try {
        let existingSummaries = [];
        if (fs.existsSync(newFormatPath)) {
          const existingContent = fs.readFileSync(newFormatPath, 'utf8');
          existingSummaries = JSON.parse(existingContent);
          if (!Array.isArray(existingSummaries)) {
            existingSummaries = [];
          }
        }

        // Create set of existing summary keys
        const existingKeys = new Set();
        existingSummaries.forEach(summary => {
          const key = `${summary.date}_${summary.totalDays}_${summary.content?.substring(0, 100) || ''}`;
          existingKeys.add(key);
        });

        // Filter duplicates
        const newSummaries = allSummaries.filter(summary => {
          const key = `${summary.date}_${summary.totalDays}_${summary.content?.substring(0, 100) || ''}`;
          return !existingKeys.has(key);
        });

        // Merge and sort
        const mergedSummaries = [...newSummaries, ...existingSummaries].sort((a, b) => {
          if (a.totalDays !== undefined && b.totalDays !== undefined) {
            return b.totalDays - a.totalDays;
          }
          return b.date.localeCompare(a.date);
        });

        // Clean source tracking fields
        const cleanedSummaries = mergedSummaries.map(summary => {
          const { _sourcePlayerId, _sourceCharacterId, ...cleanSummary } = summary;
          return cleanSummary;
        });

        // Write to file
        fs.writeFileSync(newFormatPath, JSON.stringify(cleanedSummaries, null, '\t'));

        results.migratedFiles++;
        results.mergedPairs++;

        console.log(`  ✓ 配对 ${pairKey}: ${newSummaries.length} 新摘要 + ${existingSummaries.length} 已存在 = ${cleanedSummaries.length} 总计`);

      } catch (error) {
        results.errors.push(`写入失败 ${newFormatPath}: ${error.message}`);
        console.error(`  ✗ 写入失败 ${newFormatPath}:`, error.message);
      }
    }

    results.success = true;
    console.log('');
    console.log('==========================================');
    console.log('迁移完成!');
    console.log(`成功迁移: ${results.migratedFiles} 个文件`);
    console.log(`合并配对: ${results.mergedPairs} 对`);
    console.log(`跳过文件: ${results.skippedFiles} 个`);
    if (results.errors.length > 0) {
      console.log(`错误数量: ${results.errors.length}`);
      console.log('错误详情:');
      results.errors.forEach(err => console.log(`  - ${err}`));
    }
    console.log('==========================================');

  } catch (error) {
    results.errors.push(`迁移失败: ${error.message}`);
    console.error('迁移错误:', error);
  }

  return results;
}

// Run migration
migrateSummaries()
  .then(results => {
    if (results.success) {
      console.log('');
      console.log('迁移成功完成!');
      process.exit(0);
    } else {
      console.error('');
      console.error('迁移失败!');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('迁移过程中发生错误:', error);
    process.exit(1);
  });
