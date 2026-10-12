# 持久数据责任登记

日期：2026-10-11。路径为逻辑用户数据根相对路径，实例中的玩家正文、Key及存档不进入仓库。

| 数据／Source of Truth | producer／writer | Scope与schema | 原子性／恢复／删除条件 |
| --- | --- | --- | --- |
| 有向 Legacy 摘要 | `summaries/summaries-manager.js`、`memory-system/memory-store.js` | Owner→Counterpart，摘要2.5兼容 | 既有文件合同；绑定Campaign需证据；不能按文件年代批量删除 |
| Memory4 entry／metadata／index | `memory-system/memory4-store.js`、`memory4-engine.js` | Campaign×Owner，engineVersion3.0 | Store原子写入／修订校验；entry为来源事实，index为派生定位；Forget/Tombstone先过滤，重建不能复活 |
| years／life／派生指针 | `memory-system/memory4-derived.js` | 同Owner/Campaign、sourceRevision，Year1500/Life1000硬限 | 来源当前且权限合法才发布；保留手改策略；脏数据可重建，不能替代Detail |
| episodes／memory记录／index | `memory-system/memory-store.js`、`finalization-coordinator.js` | Finalization/source provenance | 多文件完成有恢复边界，单文件rename不宣称多文件事务；Legacy reader继续保留 |
| Forget／Disclosure／Known Entity | `memory4-store.js`、`memory4-forget.js`、`memory4-disclosure.js` | 来源修订、knownBy与Owner | 永久撤销授权优先；不是可随意删的缓存；错误读失败关闭 |
| Finalization／接收恢复快照 | `finalization-coordinator.js`、`letter-memory-finalization.js` | finalizationId＋双方来源证明 | 持久交接后才清恢复记录；重启不重复请求、不重复归档 |
| pending-letters.json | `letters/letter-manager.js` | version4、收信证明、待投递状态 | 临时文件rename；锁与真实Effect/ACK/回执联合校验；未知效果不重寄 |
| run-command-queue.json／run/votc.txt | `actions/run-file-manager.js` | 命令ID、owner、epoch | 持久awaiting_ack先于UTF8 BOM原子载体；写入未知但无ACK为STALLED，绝不盲目重放 |
| Worldline checkpoint／supplemental／archive | `worldline/`、`historical-system/worldline-store.js` | Campaign、Branch、时点与实体绑定 | Current Truth只读；定义／运行身份一对一，冲突拒绝，历史规划不覆盖现实 |
| 设置／Provider secret／用户Prompt | `config/settings-repository.js`、PromptConfig及SecureProviderSecrets | 用户安装实例 | 保留既有安全读写；不导出key、不批量改默认Prompt，不纳入性能trace |
| usage analytics | `analytics/usage-analytics.js` | 原生usage／明确估算 | 厂商Cache Hit与本地前缀结构估计分开；非游戏事实权威 |
| 性能诊断 | `runtime/startup-performance-trace.js` | 每次启动随机盐、匿名会话、有限样本 | 默认关闭，有限内存，用户触发脱敏JSON导出；诊断失败不能阻塞业务，无恢复重放职责 |

每项的备份程序为V9私有冻结副本加哈希校验；恢复必须核对Scope/当前版本，不覆盖唯一存档或撤销已确认ACK。JsonRepository规划端口尚未实现；V9.2才治理多文件事务与索引闭环。

## V9.2 更新

上文 JsonRepository 尚未实现为前阶段快照。当前 ScopedJsonRepository 注入同一个 Memory4Store／MemoryStore，仅协调授权读取、候选、原写命令和只读审计。完整 logicalKey／canonicalOwner／writer／scope／schemaVersion／revision／hash／indexType／recoveryAuthority／legacyReader／cleanupPolicy／proof 映射见 [V9.2 数据权威与恢复](V9_2_JSON_AUTHORITY_AND_RECOVERY.md)。RunFile、Letter、Worldline、设置和凭据仍归各自 owner。
