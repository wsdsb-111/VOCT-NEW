/**
 * 合并同一角色的重复文件夹
 * 
 * 问题：角色官职变化导致创建了多个文件夹
 * 例如："公爵 李煜" 和 "国王 李煜" 是同一个人
 * 
 * 解决：
 * 1. 识别同一角色（通过ID或名字匹配）
 * 2. 合并到一个文件夹：ID_名字
 * 3. 合并所有对话摘要
 */

const fs = require('fs');
const path = require('path');

const SUMMARIES_DIR = path.join(
  process.env.APPDATA || process.env.HOME,
  'VOTC',
  'votc_data',
  'conversation_summaries'
);

function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

/**
 * 从文件夹名提取可能的角色名
 * 支持格式：
 * - "公爵 李煜" -> "李煜"
 * - "国王 李煜" -> "李煜"  
 * - "李煜" -> "李煜"
 * - "12345_李煜" -> "李煜" (新格式)
 */
function extractCharacterName(folderName) {
  // 如果是新格式 "ID_名字"，提取名字部分
  if (/^\d+_/.test(folderName)) {
    return folderName.split('_').slice(1).join('_');
  }
  
  // 移除可能的官职前缀
  // 常见官职：国王、公爵、伯爵、男爵、总督、将军等
  const titlePrefixes = [
    '国王', '女王', '皇帝', '皇后',
    '公爵', '公爵夫人', '侯爵', '伯爵', '子爵', '男爵',
    '大公', '亲王', '王爷', '郡王',
    '总督', '将军', '元帅', '统帅',
    '首领', '酋长', '可汗',
  ];
  
  let name = folderName.trim();
  
  // 尝试移除官职前缀
  for (const title of titlePrefixes) {
    if (name.startsWith(title)) {
      name = name.substring(title.length).trim();
      break;
    }
  }
  
  // 如果还有空格，取最后一部分（可能是"某某 名字"格式）
  const parts = name.split(/\s+/);
  if (parts.length > 1) {
    name = parts[parts.length - 1];
  }
  
  return name;
}

/**
 * 从摘要文件中提取角色ID（如果有）
 */
function extractCharacterIdFromSummaries(summaryFilePath) {
  try {
    const content = fs.readFileSync(summaryFilePath, 'utf8');
    const summaries = JSON.parse(content);
    
    if (Array.isArray(summaries) && summaries.length > 0) {
      // 从第一个摘要中提取characterId或playerId
      const firstSummary = summaries[0];
      return firstSummary.characterId || firstSummary.playerId || null;
    }
  } catch (error) {
    console.error(`Failed to read summaries from ${summaryFilePath}:`, error.message);
  }
  return null;
}

/**
 * 分组重复的角色文件夹
 */
function groupDuplicateFolders() {
  if (!fs.existsSync(SUMMARIES_DIR)) {
    console.log('摘要目录不存在');
    return {};
  }
  
  const folders = fs.readdirSync(SUMMARIES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  console.log(`找到 ${folders.length} 个文件夹`);
  
  // 按角色名分组
  const groupsByName = {};
  const groupsById = {};
  
  for (const folder of folders) {
    // 跳过新格式（已经是ID_名字格式）
    if (/^\d+_/.test(folder)) {
      console.log(`跳过新格式文件夹: ${folder}`);
      continue;
    }
    
    const charName = extractCharacterName(folder);
    
    // 尝试从文件中提取ID
    const folderPath = path.join(SUMMARIES_DIR, folder);
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.json'));
    let charId = null;
    
    if (files.length > 0) {
      const firstFile = path.join(folderPath, files[0]);
      charId = extractCharacterIdFromSummaries(firstFile);
    }
    
    if (charId) {
      // 按ID分组（最准确）
      if (!groupsById[charId]) {
        groupsById[charId] = {
          id: charId,
          name: charName,
          folders: []
        };
      }
      groupsById[charId].folders.push(folder);
    } else {
      // 按名字分组（备选）
      if (!groupsByName[charName]) {
        groupsByName[charName] = {
          name: charName,
          folders: []
        };
      }
      groupsByName[charName].folders.push(folder);
    }
  }
  
  // 合并两种分组方式
  const duplicates = {};
  
  // 优先使用ID分组
  for (const id in groupsById) {
    const group = groupsById[id];
    if (group.folders.length > 1) {
      duplicates[id] = group;
    }
  }
  
  // 添加名字分组（没有ID的）
  for (const name in groupsByName) {
    const group = groupsByName[name];
    if (group.folders.length > 1) {
      // 检查是否已经在ID分组中
      const alreadyGrouped = Object.values(duplicates).some(g => 
        g.folders.some(f => group.folders.includes(f))
      );
      
      if (!alreadyGrouped) {
        duplicates[`name_${name}`] = group;
      }
    }
  }
  
  return duplicates;
}

/**
 * 合并一组重复文件夹
 */
function mergeFolderGroup(group) {
  console.log(`\n合并角色: ${group.name || group.id}`);
  console.log(`文件夹数量: ${group.folders.length}`);
  group.folders.forEach(f => console.log(`  - ${f}`));
  
  // 创建新文件夹名
  const newFolderName = group.id 
    ? `${group.id}_${sanitizeFileName(group.name)}`
    : sanitizeFileName(group.name);
  
  const newFolderPath = path.join(SUMMARIES_DIR, newFolderName);
  
  // 创建新文件夹
  if (!fs.existsSync(newFolderPath)) {
    fs.mkdirSync(newFolderPath, { recursive: true });
    console.log(`创建新文件夹: ${newFolderName}`);
  }
  
  // 收集所有对话文件
  const conversationFiles = {};
  
  for (const oldFolder of group.folders) {
    const oldFolderPath = path.join(SUMMARIES_DIR, oldFolder);
    const files = fs.readdirSync(oldFolderPath).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      const filePath = path.join(oldFolderPath, file);
      
      try {
        const summaries = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        if (!conversationFiles[file]) {
          conversationFiles[file] = [];
        }
        
        // 合并摘要
        conversationFiles[file].push(...summaries);
      } catch (error) {
        console.error(`  读取文件失败 ${file}:`, error.message);
      }
    }
  }
  
  // 保存合并后的文件
  let mergedCount = 0;
  for (const fileName in conversationFiles) {
    const summaries = conversationFiles[fileName];
    
    // 按日期排序（最新的在前）
    summaries.sort((a, b) => {
      if (a.totalDays !== undefined && b.totalDays !== undefined) {
        return b.totalDays - a.totalDays;
      }
      return 0;
    });
    
    // 去重（基于日期和内容）
    const uniqueSummaries = [];
    const seen = new Set();
    
    for (const summary of summaries) {
      const key = `${summary.date}_${summary.content?.substring(0, 50)}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueSummaries.push(summary);
      }
    }
    
    const newFilePath = path.join(newFolderPath, fileName);
    fs.writeFileSync(newFilePath, JSON.stringify(uniqueSummaries, null, '\t'));
    
    console.log(`  合并文件: ${fileName} (${summaries.length} -> ${uniqueSummaries.length} 条摘要)`);
    mergedCount++;
  }
  
  console.log(`✅ 合并完成: ${mergedCount} 个对话文件`);
  
  // 询问是否删除旧文件夹
  console.log('\n旧文件夹保留在原位置，请手动验证后删除：');
  group.folders.forEach(f => {
    console.log(`  ${path.join(SUMMARIES_DIR, f)}`);
  });
}

/**
 * 主函数
 */
function main() {
  console.log('='.repeat(60));
  console.log('合并同一角色的重复文件夹');
  console.log('='.repeat(60));
  console.log(`摘要目录: ${SUMMARIES_DIR}\n`);
  
  // 查找重复文件夹
  const duplicates = groupDuplicateFolders();
  
  const duplicateCount = Object.keys(duplicates).length;
  
  if (duplicateCount === 0) {
    console.log('✅ 没有发现重复的角色文件夹');
    return;
  }
  
  console.log(`\n找到 ${duplicateCount} 组重复的角色文件夹：`);
  
  // 显示所有重复组
  for (const key in duplicates) {
    const group = duplicates[key];
    console.log(`\n${group.name || group.id}:`);
    group.folders.forEach(f => console.log(`  - ${f}`));
  }
  
  // 执行合并
  console.log('\n开始合并...\n');
  
  for (const key in duplicates) {
    mergeFolderGroup(duplicates[key]);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ 所有合并完成！');
  console.log('='.repeat(60));
  console.log('\n请验证合并结果，然后手动删除旧文件夹。');
  console.log('新文件夹格式: ID_名字 (例如: 12345_李煜)');
}

// 运行
main();
