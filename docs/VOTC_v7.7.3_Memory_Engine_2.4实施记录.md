# VOTC v7.7.3 / Memory Engine 2.4 实施记录

## 目标

本版本收口 Memory Engine 2.3 审查中剩余的两个运行时缺口，并合并摘要管理页的重复操作入口：降低人物目录反复读取成本，在信任模型抽取结果前独立核验来源消息，同时保留既有视角投影、人物在场窗口和 recovery 事务边界。

## 人物目录读取缓存

- `MemoryStore` 以人物数字 ID 缓存 `loadFolderSummariesForCharacter()` 的完整解析结果。同一人物在缓存有效期间不再重复扫描 `conversation_summaries` 和解析全部 JSON。
- 缓存只改变读取成本，不改变召回排序、Token 预算、场外人物快照或人物目录所有权。
- 终局有向摘要写入、摘要编辑、单条删除、整份对话文件删除、人物目录删除和全量清理会使对应人物或全部缓存失效。下一次召回按需从磁盘重建。

## 来源 messageId 第四层校验

在 Extractor 结构解析、Knowledge 知情窗口和 Perspective Projector 投影检查之外，Memory Engine 2.4 新增独立来源校验：

1. 从本场真实 `context.messages` 建立消息 ID 集合和最小/最大范围。
2. 检查每个 `summarySegment` 和每条 durable memory 都提供来源 ID。
3. 任一 ID 不存在、越出范围或落在范围内但实际 history 缺号时，拒绝整个抽取。
4. 失败进入已有质量重试；连续失败保留 recovery snapshot，且不会写入 episode、knowledge 或人物摘要目录。

该校验只验证来源存在性和会话归属，不尝试用字符串相似度替代模型语义判断。

## UI 合并

摘要页删除原先独立的“对话摘要管理”按钮块。“刷新”“打开摘要文件夹”“清除全部摘要”统一放在“摘要与记忆管理器”标题栏，继续复用原有确认、执行结果和重新加载逻辑。

## 兼容与验证边界

- 新写入视角摘要标记 `engineVersion: "2.4"`；既有 `2.3` 记录仍可读取并通过有向落盘核验，不执行批量迁移。
- `scripts/test-v7.7.3-memory-cache-message-id.js` 自动覆盖缓存与可信校验主路径；完整发布门禁为 36 组。
- 自动测试不等同于真实 CK3、Provider 与窗口点击冒烟。发布前仍应实际结束一场对话，确认生成双向人物文件，并在摘要页验证三项合并操作。
