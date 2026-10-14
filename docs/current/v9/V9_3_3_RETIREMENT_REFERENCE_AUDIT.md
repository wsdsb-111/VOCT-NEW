# V9.3.3 Year/Life 生产引用清债

2026-10-14；检查 editable source、build 映射和部署输出。历史方案及归档测试不改写为本版验收。实际用户数据删除仍待单独确认。

| 范围 | 处理结果与保留理由 |
|---|---|
| `memory4-derived.js` | 源码、运行映射及部署文件移除；不再有生成、重建、编辑、选择旧派生视图的生产服务。 |
| Coordinator / Main / Engine / Letter / Profile | 解除派生实例、任务与指针；提取端口改为 `configureExtraction`，完成仅依据 canonical 提交及可验证 Recovery。 |
| Recall | 不读取旧 `years` / `life`；旧 SourceRef 明确拒绝。保留 YEAR/LIFE 自然查询意图与即时 `conversation_year`，后者只使用当前授权 Detail。 |
| Store | 停止旧视图失效与写盘；正常 canonical 更新只移除 metadata 的 `derivedDirty` / `derivedRevision` 专属字段，其他数据保持。 |
| Source validity | 原共享授权谓词移入独立模块；冻结 15 个合同用例，保留旧缺 revision 兼容；新覆盖证明另行严格验证。 |
| IPC / Preload / Renderer | 四页签；删除 Year/Life 展示、修改、生成和任务按钮。遗留操作名仅用于明确拒绝，不映射到其他操作。 |
| `DERIVED_REBUILD_FAILED` | 仅历史 Recovery 只读识别；必须有真实 canonical 提交证明才清理，坏记录、跨 Campaign 和未知状态保留。 |
| `derivedInvalidated: 0` | Forget 结果兼容字段，不触发旧文件写入。 |
| `memory-trace.js` | 历史诊断类型兼容，不是生产生成服务或新任务入口。 |
| 日期 / 索引 / 文字 | `eventTime.precision: year`、byEventYear/byConversationYear/byAcquiredYear、条件中的 years 及 lifetime 描述是 canonical 语义，保留。 |
| 文件名和迁移 key | 只在一次性迁移器中用于精确校验、事务删除及中断恢复；不参与 Prompt 或 Recall。 |
| Summary folder merge | 不再合并写旧派生 sidecar；遇到这些旧视图阻止合并，等待受控迁移，避免静默删改。 |

扫描命令：`rg -n 'derived|year|life' src/app/main/memory-system -g 'memory4-*.js'`，并检查 `summaries-manager.js`、`main.js`、IPC、Preload、Renderer、`build/runtime-inputs.json` 和 Provider structured-request 类型。详细路径与命中行记录在忽略的 `.build/v933-final-reference-inventory.txt`；不含玩家正文。

纯旧生成生命周期测试分类为 ARCHIVED；混合测试的 Source/Forget/Recall/Owner/Campaign/Recovery 安全断言迁移保留。V9.3.3 测试清单为 441 发布组，最终结果以验证报告为准。

混合 `test-v8.15.2-fix5-independent-qa.js` 的两项已退役压缩案例保留于 `test-v8.15.2-fix5-derived-budget-history.js`（ARCHIVED）；原 20 项信件、物理日志、回执、UTF-8 日期和持久化安全检查继续作为发布组执行。
